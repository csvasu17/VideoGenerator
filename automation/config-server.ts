import express from 'express';
import cors from 'cors';
import { spawn, ChildProcess, execSync } from 'child_process';
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

// ── Voice-regen singleton ─────────────────────────────────────────────────────
let voiceProcess: ChildProcess | null = null;
let voiceLog: string[] = [];
let voiceStatus: 'idle' | 'running' | 'success' | 'failed' = 'idle';
const voiceSseClients = new Set<Response>();

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

/**
 * Serialise a value for writing to a dotenv file, compatible with dotenv v16.
 *
 * dotenv v16 does NOT unescape `\"` inside double-quoted values (only `\n`/`\r`
 * are expanded).  Using `\"` for embedded double-quotes therefore leaves a
 * literal backslash in the parsed result, breaking JSON.parse etc.
 *
 * Strategy:
 *  - Value has `"` but no `'` → single-quote wrap (dotenv treats as literal ✓)
 *  - Value has newlines → double-quote wrap with `\n` escape (v16 expands these)
 *  - Other values needing quoting (spaces, #, $) → double-quote wrap
 *  - No special chars → bare value
 */
function quoteEnvValue(value: string): string {
  if (!value) return value;

  // Normalise literal escape sequences to actual characters BEFORE re-encoding.
  // Without this, a value containing literal \n (backslash+n) goes through the
  // cycle: backslash escaped → \\n in file → dotenv decodes → \n again → doubled
  // on every save, causing exponential growth (16 MB files after ~20 saves).
  const v = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');

  const hasDQ  = v.includes('"');
  const hasSQ  = v.includes("'");
  const hasNL  = /[\n\r]/.test(v);

  // JSON / values with double-quotes but no single-quotes → single-quote wrap
  if (hasDQ && !hasSQ && !hasNL) {
    return "'" + v + "'";
  }

  // Needs quoting (newlines, special chars, or whitespace trim mismatch)
  if (hasNL || hasDQ || hasSQ || v !== v.trim() || /[#$`\\]/.test(v)) {
    return '"' + v
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r') + '"';
  }

  return v;
}

/**
 * Write key=value pairs to .env, preserving comment/blank lines from the
 * original file but replacing all value entries cleanly (no multi-line
 * accumulation, no double-escaping, no garbage continuation lines).
 *
 * Algorithm:
 *  1. Parse the existing file with dotenv to get correctly-decoded values.
 *  2. Merge with incoming (non-empty incoming wins).
 *  3. Rebuild the file line-by-line: keep comments/blanks, replace each
 *     KEY= entry (skipping its original multi-line continuations), drop
 *     garbage lines that don't match KEY= / comment / blank.
 *  4. Append any new keys not seen in the original file.
 */
function writeEnvFile(incoming: Record<string, string>): void {
  const rawContent = readEnvFile();

  // Step 1: get correctly-decoded existing values
  const existingValues: Record<string, string> = rawContent ? dotenv.parse(rawContent) : {};

  // Step 2: merge
  const final: Record<string, string> = { ...existingValues };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== '') final[key] = value;
  }

  if (!rawContent) {
    fs.writeFileSync(ENV_PATH,
      Object.entries(final).filter(([, v]) => v !== '').map(([k, v]) => `${k}=${quoteEnvValue(v)}`).join('\n'),
      'utf-8',
    );
    return;
  }

  // Step 3: rebuild preserving comments, rewriting values as single lines
  const rawLines = rawContent.split('\n');
  const output: string[] = [];
  const written = new Set<string>();
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];

    // Keep comment lines and blank lines exactly as-is
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      output.push(line);
      i++;
      continue;
    }

    const keyMatch = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (!keyMatch) {
      // Garbage line (raw JSON, continuation of a corrupted multi-line, etc.) — drop it
      i++;
      continue;
    }

    const key = keyMatch[1];

    // Determine how many raw lines this entry spans (handles original multi-line values)
    const rawVal = line.slice(keyMatch[0].length).trimStart();
    let entryLineCount = 1; // default: just the current line

    if (rawVal.startsWith('"')) {
      // Scan for the closing unescaped " (dotenv multi-line detection)
      let closed = false;
      for (let ci = 1; ci < rawVal.length; ci++) {
        if (rawVal[ci] === '\\') { ci++; continue; }
        if (rawVal[ci] === '"') { closed = true; break; }
      }
      if (!closed) {
        // Spans multiple lines — find where it ends
        let j = i + 1;
        while (j < rawLines.length) {
          const cl = rawLines[j];
          // Stop before a new KEY= line or a comment/blank (malformed .env)
          if (cl.trim() === '' || cl.trimStart().startsWith('#') || /^[A-Z][A-Z0-9_]*=/.test(cl)) break;
          j++;
          // Check if the just-scanned line contains the closing quote
          const scanned = rawLines[j - 1];
          let lineCloses = false;
          for (let ci = 0; ci < scanned.length; ci++) {
            if (scanned[ci] === '\\') { ci++; continue; }
            if (scanned[ci] === '"') { lineCloses = true; break; }
          }
          if (lineCloses) { entryLineCount = j - i; break; }
        }
        if (entryLineCount === 1) entryLineCount = j - i; // fallback: skip to j
      }
    }

    // Write this key's value (first occurrence wins; duplicates are dropped)
    if (!written.has(key)) {
      if (key in final) {
        output.push(`${key}=${quoteEnvValue(final[key])}`);
        written.add(key);
      }
    }

    // Skip all original lines belonging to this entry (including continuations)
    i += Math.max(entryLineCount, 1);
  }

  // Step 4: append keys that were not present in the original file
  for (const [key, value] of Object.entries(final)) {
    if (!written.has(key) && value !== '') {
      output.push(`${key}=${quoteEnvValue(value)}`);
    }
  }

  fs.writeFileSync(ENV_PATH, output.join('\n'), 'utf-8');
}

// ── Output dir helpers ────────────────────────────────────────────────────────

function getProductOutDir(): string {
  const env = parseEnvValues();
  const slug = (env['APP_PRODUCT_NAME'] ?? 'localhost').toLowerCase();
  return path.join(OUT_DIR, '..', slug);
}

// ── SSE helpers ───────────────────────────────────────────────────────────────

function broadcastSSE(data: object): void {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(message); } catch { sseClients.delete(client); }
  }
}

function pushLog(line: string): void {
  pipelineLog.push(line);
  if (pipelineLog.length > 500) pipelineLog.shift();
  broadcastSSE({ type: 'log', line, ts: Date.now() });
}

function broadcastVoiceSSE(data: object): void {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of voiceSseClients) {
    try { client.write(message); } catch { voiceSseClients.delete(client); }
  }
}

function pushVoiceLog(line: string): void {
  voiceLog.push(line);
  if (voiceLog.length > 200) voiceLog.shift();
  broadcastVoiceSSE({ type: 'log', line, ts: Date.now() });
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003'] }));
app.use(express.json({ limit: '50mb' }));

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

// ── Recording status ──────────────────────────────────────────────────────────

app.get('/api/recording-status', (_req, res) => {
  try {
    const outDir = getProductOutDir();
    const recDir = path.join(outDir, 'recordings');
    const pkgPath = path.join(outDir, 'demo-package.json');
    const voicePath = path.join(outDir, 'voice-script.json');

    if (!fs.existsSync(recDir)) {
      res.json({ hasRecordings: false, clipCount: 0, hasPackage: false, hasVoiceScript: false });
      return;
    }

    const clips = fs.readdirSync(recDir)
      .filter(f => f.endsWith('.mp4') && !f.startsWith('broll-'));
    const hasPackage = fs.existsSync(pkgPath);
    const hasVoiceScript = fs.existsSync(voicePath);

    res.json({
      hasRecordings: clips.length > 0,
      clipCount: clips.length,
      hasPackage,
      hasVoiceScript,
      recDir,
      outDir,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Voice script CRUD ─────────────────────────────────────────────────────────

app.get('/api/voice-script', (_req, res) => {
  try {
    const scriptPath = path.join(getProductOutDir(), 'voice-script.json');
    if (!fs.existsSync(scriptPath)) {
      res.status(404).json({ error: 'voice-script.json not found — run the pipeline first' });
      return;
    }
    const data = JSON.parse(fs.readFileSync(scriptPath, 'utf-8'));
    res.json({ script: data });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/voice-script', (req, res) => {
  const { script } = req.body as { script: unknown };
  if (!script) { res.status(400).json({ error: 'Missing script body' }); return; }
  try {
    const scriptPath = path.join(getProductOutDir(), 'voice-script.json');
    fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2), 'utf-8');
    res.json({ saved: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── B-Roll clips listing ──────────────────────────────────────────────────────

app.get('/api/broll-clips', (_req, res) => {
  try {
    const outDir = getProductOutDir();
    const recDir = path.join(outDir, 'recordings');
    if (!fs.existsSync(recDir)) { res.json({ clips: [] }); return; }

    // Load subtitle labels from demo-package.json brollScenes if available
    const subtitleMap: Record<string, string> = {};
    const pkgPath = path.join(outDir, 'demo-package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        for (const scene of (pkg.brollScenes ?? [])) {
          if (scene.id && scene.subtitle) subtitleMap[scene.id] = scene.subtitle;
        }
      } catch { /* ignore parse errors */ }
    }

    const clips = fs.readdirSync(recDir)
      .filter(f => f.startsWith('broll-') && f.endsWith('.mp4'))
      .sort()
      .map((f, i) => {
        const id = f.replace('.mp4', '');
        const framePath = path.join(recDir, `${id}-frame.png`);
        const stat = fs.statSync(path.join(recDir, f));
        return {
          id,
          file: f,
          index: i,
          label: subtitleMap[id] ?? `B-Roll ${i + 1}`,
          sizeMb: Math.round(stat.size / 1024 / 10.24) / 100,
          hasFrame: fs.existsSync(framePath),
        };
      });
    res.json({ clips });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Regenerate voice (voice:only) ─────────────────────────────────────────────

app.post('/api/regenerate-voice', (req, res) => {
  if (voiceStatus === 'running') {
    res.status(409).json({ error: 'Voice generation already running' });
    return;
  }

  voiceLog = [];
  voiceStatus = 'running';
  broadcastVoiceSSE({ type: 'status', status: 'running' });

  voiceProcess = spawn('npm', ['run', 'voice:only'], {
    cwd: ROOT,
    shell: true,
    env: { ...process.env },
  });

  voiceProcess.stdout?.on('data', (chunk: Buffer) => {
    String(chunk).split('\n').filter(Boolean).forEach(pushVoiceLog);
  });
  voiceProcess.stderr?.on('data', (chunk: Buffer) => {
    String(chunk).split('\n').filter(Boolean).forEach(pushVoiceLog);
  });
  voiceProcess.on('close', (code: number | null) => {
    voiceStatus = code === 0 ? 'success' : 'failed';
    voiceProcess = null;
    broadcastVoiceSSE({ type: 'done', status: voiceStatus });
  });

  res.json({ started: true });
});

app.get('/api/voice-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  for (const line of voiceLog) {
    res.write(`data: ${JSON.stringify({ type: 'log', line, ts: 0 })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ type: 'status', status: voiceStatus })}\n\n`);

  voiceSseClients.add(res);
  const keepalive = setInterval(() => {
    try { res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`); } catch { /* ignore */ }
  }, 15_000);
  req.on('close', () => { clearInterval(keepalive); voiceSseClients.delete(res); });
});

// ── Pipeline ──────────────────────────────────────────────────────────────────

app.get('/api/pipeline-status', (_req, res) => {
  res.json({ status: pipelineStatus });
});

app.post('/api/run-pipeline', (req, res) => {
  if (pipelineStatus === 'running') {
    res.status(409).json({ error: 'Pipeline is already running' });
    return;
  }

  const { values, forceRerecord } = ((req.body ?? {}) as {
    values?: Record<string, string>;
    forceRerecord?: boolean;
  });
  if (values && typeof values === 'object') {
    try { writeEnvFile(values); } catch { /* best-effort */ }
  }

  pipelineLog = [];
  pipelineStatus = 'running';
  broadcastSSE({ type: 'status', status: 'running' });

  const currentEnv = parseEnvValues();
  const videoTemplate = currentEnv['VIDEO_TEMPLATE'] ?? 'modern_saas';
  const pipelineScript = videoTemplate === 'enterprise' ? 'pipeline:enterprise' : 'e2e-test';

  console.log(`  Pipeline: ${pipelineScript}  (VIDEO_TEMPLATE=${videoTemplate}, forceRerecord=${forceRerecord ?? false})`);

  pipelineProcess = spawn('npm', ['run', pipelineScript], {
    cwd: ROOT,
    shell: true,
    env: {
      ...process.env,
      FORCE_RERECORD: forceRerecord ? 'true' : 'false',
    },
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

app.post('/api/stop-pipeline', (_req, res) => {
  if (pipelineProcess) {
    pipelineProcess.kill('SIGTERM');
    pipelineProcess = null;
  }
  pipelineStatus = 'failed';
  broadcastSSE({ type: 'done', status: 'failed' });
  res.json({ stopped: true });
});

app.get('/api/pipeline-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  for (const line of pipelineLog) {
    res.write(`data: ${JSON.stringify({ type: 'log', line, ts: 0 })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ type: 'status', status: pipelineStatus })}\n\n`);

  sseClients.add(res);

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
    hasDemoPackage: fs.existsSync(path.join(getProductOutDir(), 'demo-package.json')),
  });
});

app.listen(PORT, () => {
  console.log(`\n  ┌──────────────────────────────────────────────────────────┐`);
  console.log(`  │  Config UI API server → http://localhost:${PORT}            │`);
  console.log(`  │  Open Remotion Studio and click "Config" in the sidebar.  │`);
  console.log(`  └──────────────────────────────────────────────────────────┘\n`);
});
