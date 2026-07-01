import express from 'express';
import cors from 'cors';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import type { Response } from 'express';
import { chat } from './chat-service';
import { OUT_DIR } from './config';

const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const PORT = parseInt(process.env.CONFIG_PORT ?? '3001', 10);

// ── Pipeline singleton state ──────────────────────────────────────────────────
let pipelineProcess: ChildProcess | null = null;
let pipelineLog: string[] = [];
let pipelineStatus: 'idle' | 'running' | 'success' | 'failed' = 'idle';
const sseClients = new Set<Response>();

// ── .env helpers ─────────────────────────────────────────────────────────────

function readEnvFile(): string {
  try {
    return fs.readFileSync(ENV_PATH, 'utf-8');
  } catch {
    return '';
  }
}

function parseEnvValues(): Record<string, string> {
  const raw = readEnvFile();
  if (!raw) return {};
  return dotenv.parse(raw);
}

function quoteEnvValue(value: string): string {
  // Wrap in double-quotes if value contains newlines, #, $, or leading/trailing whitespace
  if (/[\n\r#$"]/.test(value) || value !== value.trim()) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

function writeEnvFile(incoming: Record<string, string>): void {
  const existing = readEnvFile();
  const lines = existing ? existing.split('\n') : [];
  const written = new Set<string>();

  // Update in-place for keys that already exist
  const updated = lines.map(line => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (match) {
      const key = match[1];
      if (key in incoming && incoming[key] !== '') {
        written.add(key);
        return `${key}=${quoteEnvValue(incoming[key])}`;
      }
    }
    return line;
  });

  // Append keys not found in existing file
  for (const [key, value] of Object.entries(incoming)) {
    if (!written.has(key) && value !== '') {
      updated.push(`${key}=${quoteEnvValue(value)}`);
    }
  }

  fs.writeFileSync(ENV_PATH, updated.join('\n'), 'utf-8');
}

// ── SSE helpers ───────────────────────────────────────────────────────────────

function broadcastSSE(data: object): void {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch {
      sseClients.delete(client);
    }
  }
}

function pushLog(line: string): void {
  pipelineLog.push(line);
  if (pipelineLog.length > 500) pipelineLog.shift();
  broadcastSSE({ type: 'log', line, ts: Date.now() });
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003'] }));
app.use(express.json({ limit: '10mb' }));

// Read current .env values
app.get('/api/config', (_req, res) => {
  res.json({ values: parseEnvValues() });
});

// Write .env values
app.post('/api/config', (req, res) => {
  const { values } = req.body as { values: Record<string, string> };
  if (!values || typeof values !== 'object') {
    res.status(400).json({ error: 'Invalid body: expected { values: object }' });
    return;
  }
  try {
    writeEnvFile(values);
    res.json({ saved: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get current pipeline status (for page load / reconnect)
app.get('/api/pipeline-status', (_req, res) => {
  res.json({ status: pipelineStatus });
});

// Launch the pipeline
app.post('/api/run-pipeline', (req, res) => {
  if (pipelineStatus === 'running') {
    res.status(409).json({ error: 'Pipeline is already running' });
    return;
  }

  // Optional: save values first before launching
  const { values } = ((req.body ?? {}) as { values?: Record<string, string> });
  if (values && typeof values === 'object') {
    try { writeEnvFile(values); } catch { /* best-effort */ }
  }

  pipelineLog = [];
  pipelineStatus = 'running';
  broadcastSSE({ type: 'status', status: 'running' });

  pipelineProcess = spawn('npm', ['run', 'e2e-test'], {
    cwd: ROOT,
    shell: true,
    env: { ...process.env },
  });

  pipelineProcess.stdout?.on('data', (chunk: Buffer) => {
    String(chunk).split('\n').filter(Boolean).forEach(pushLog);
  });
  pipelineProcess.stderr?.on('data', (chunk: Buffer) => {
    String(chunk).split('\n').filter(Boolean).forEach(pushLog);
  });

  pipelineProcess.on('close', (code: number | null) => {
    pipelineStatus = code === 0 ? 'success' : 'failed';
    pipelineProcess = null;
    broadcastSSE({ type: 'done', status: pipelineStatus, studioUrl: 'http://localhost:3000' });
    console.log(`  Pipeline finished with status: ${pipelineStatus}`);
  });

  res.json({ started: true });
});

// SSE stream for pipeline output
app.get('/api/pipeline-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Catch-up: send accumulated log lines and current status
  for (const line of pipelineLog) {
    res.write(`data: ${JSON.stringify({ type: 'log', line, ts: 0 })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ type: 'status', status: pipelineStatus })}\n\n`);

  sseClients.add(res);

  // Keepalive ping every 15 seconds
  const keepalive = setInterval(() => {
    try { res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`); } catch { /* ignore */ }
  }, 15_000);

  req.on('close', () => {
    clearInterval(keepalive);
    sseClients.delete(res);
  });
});

// ── Chat API ─────────────────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { message } = req.body as { message?: string };
  if (!message || typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: 'message is required' });
    return;
  }
  try {
    const result = await chat(message.trim());
    res.json(result);
  } catch (err) {
    console.error('[chat] error:', err);
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/chat/status', (_req, res) => {
  res.json({
    ok: true,
    hasDemoPackage: fs.existsSync(path.join(OUT_DIR, 'demo-package.json')),
  });
});

app.listen(PORT, () => {
  console.log(`\n  ┌──────────────────────────────────────────────────────────┐`);
  console.log(`  │  Config UI API server → http://localhost:${PORT}            │`);
  console.log(`  │  Open Remotion Studio and click "Config" in the sidebar.  │`);
  console.log(`  └──────────────────────────────────────────────────────────┘\n`);
});
