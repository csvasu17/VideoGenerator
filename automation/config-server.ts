import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { spawn, ChildProcess, execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as dotenv from 'dotenv';
import type { Response } from 'express';
import { chat } from './chat-service';
import { OUT_DIR, toSlug } from './config';
import { getVideoInfo } from './utils/ffprobe';

const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
// Kept outside Remotion's own 3000-3100 auto-port-selection range (see
// @remotion/renderer's get-port.js) — Studio's in-browser Render feature
// spins up its own auxiliary server in that range, and a collision with
// this API here made Render fail with "Cannot GET /index.html".
const PORT = parseInt(process.env.CONFIG_PORT ?? '4001', 10);

// ── Pipeline singleton state ──────────────────────────────────────────────────
let pipelineProcess: ChildProcess | null = null;
let pipelineLog: string[] = [];
let pipelineStatus: 'idle' | 'running' | 'success' | 'failed' = 'idle';
const sseClients = new Set<Response>();

// pipelineStatus alone doesn't survive this server process restarting (e.g. a dev-mode
// reload while a pipeline is mid-run): a fresh instance boots with pipelineStatus='idle'
// and no memory of the still-alive child, so the in-memory guard below silently lets a
// second run start alongside the orphaned first one — both writing into the same
// out/<slug> directory and interleaving their stdout into whatever log each request
// happens to be reading. A PID-file lock survives the restart because it's on disk.
const PIPELINE_LOCK_PATH = path.join(ROOT, '.tmp', 'pipeline.lock');

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Returns the PID of a still-running locked pipeline, if any — self-healing by
 *  deleting the lock file when it points at a process that's no longer alive. */
function readActiveLockPid(): number | null {
  try {
    const pid = parseInt(fs.readFileSync(PIPELINE_LOCK_PATH, 'utf-8').trim(), 10);
    if (!pid || !isProcessAlive(pid)) {
      try { fs.unlinkSync(PIPELINE_LOCK_PATH); } catch {}
      return null;
    }
    return pid;
  } catch {
    return null;
  }
}

// ── Voice-regen singleton ─────────────────────────────────────────────────────
let voiceProcess: ChildProcess | null = null;
let voiceLog: string[] = [];
let voiceStatus: 'idle' | 'running' | 'success' | 'failed' = 'idle';
const voiceSseClients = new Set<Response>();

// ── Manual Recording singleton (independent of the template pipeline above) ───
let mrProcess: ChildProcess | null = null;
let mrLog: string[] = [];
let mrStatus: 'idle' | 'running' | 'success' | 'failed' = 'idle';
const mrSseClients = new Set<Response>();

// ── Agent Recording singleton (independent of both of the above) ──────────────
let arProcess: ChildProcess | null = null;
let arLog: string[] = [];
let arStatus: 'idle' | 'running' | 'success' | 'failed' = 'idle';
const arSseClients = new Set<Response>();

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
  const slug = toSlug(env['APP_PRODUCT_NAME'] ?? 'localhost');
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

function broadcastMrSSE(data: object): void {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of mrSseClients) {
    try { client.write(message); } catch { mrSseClients.delete(client); }
  }
}

function pushMrLog(line: string): void {
  mrLog.push(line);
  if (mrLog.length > 500) mrLog.shift();
  broadcastMrSSE({ type: 'log', line, ts: Date.now() });
}

function broadcastArSSE(data: object): void {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of arSseClients) {
    try { client.write(message); } catch { arSseClients.delete(client); }
  }
}

function pushArLog(line: string): void {
  arLog.push(line);
  if (arLog.length > 500) arLog.shift();
  broadcastArSSE({ type: 'log', line, ts: Date.now() });
}

// ── Express app ───────────────────────────────────────────────────────────────

// Studio and this API both bind to all interfaces, so the Config UI is already
// reachable from other devices via the host machine's LAN IP. Without listing
// that IP here too, the browser's Origin header (e.g. http://10.1.123.122:3000)
// would fail this CORS check even though the request itself succeeds.
function getLocalNetworkIPs(): string[] {
  const ips: string[] = [];
  for (const configs of Object.values(os.networkInterfaces())) {
    for (const config of configs ?? []) {
      if (config.family === 'IPv4' && !config.internal) ips.push(config.address);
    }
  }
  return ips;
}

const ALLOWED_HOSTS = ['localhost', '127.0.0.1', ...getLocalNetworkIPs()];
// 3443/4443 are the self-signed HTTPS proxy's ports (automation/https-proxy.ts) —
// needed so WebCodecs works when Studio is opened from a LAN IP. Listing both
// schemes for every port is simplest; unused combinations are harmless here.
const STUDIO_PORTS = ['3000', '3001', '3002', '3003', '4001', '3443', '4443'];
const ALLOWED_ORIGINS = ALLOWED_HOSTS.flatMap((host) =>
  STUDIO_PORTS.flatMap((port) => [`http://${host}:${port}`, `https://${host}:${port}`]),
);

const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS }));
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
  const lockedPid = readActiveLockPid();
  if (lockedPid) {
    res.status(409).json({
      error: `A pipeline process (PID ${lockedPid}) is already running, possibly left over from ` +
             `before this server last restarted. Wait for it to finish, or stop it manually, before starting another.`,
    });
    return;
  }

  const { values, forceRerecord } = ((req.body ?? {}) as {
    values?: Record<string, string>;
    forceRerecord?: boolean;
  });
  if (values && typeof values === 'object') {
    try { writeEnvFile(values); } catch { /* best-effort */ }
  }

  // "End to End" isn't a WorkflowOrchestrator pipeline — it's Agent Recording /
  // Manual Recording, each triggered through their own dedicated endpoints
  // (/api/agent-recording/run, /api/manual-recording/process). Reject explicitly
  // rather than silently falling through to the e2e-test default script below —
  // that exact silent-fallback shape is what made app_flow's leftover pipeline
  // run unexpectedly when this template was selected.
  const currentEnv = parseEnvValues();
  const videoTemplate = currentEnv['VIDEO_TEMPLATE'] ?? 'modern_saas';
  if (videoTemplate === 'end_to_end') {
    res.status(400).json({ error: 'End to End has no single Render pipeline — use the Agent Recording / Manual Recording buttons below instead.' });
    return;
  }

  pipelineLog = [];
  pipelineStatus = 'running';
  broadcastSSE({ type: 'status', status: 'running' });

  const pipelineScript =
    videoTemplate === 'enterprise' ? 'pipeline:enterprise' :
    videoTemplate === 'teaser'     ? 'pipeline:teaser' :
    'e2e-test';

  console.log(`  Pipeline: ${pipelineScript}  (VIDEO_TEMPLATE=${videoTemplate}, forceRerecord=${forceRerecord ?? false})`);

  pipelineProcess = spawn('npm', ['run', pipelineScript], {
    cwd: ROOT,
    shell: true,
    env: {
      ...process.env,
      FORCE_RERECORD: forceRerecord ? 'true' : 'false',
    },
  });
  try {
    fs.mkdirSync(path.dirname(PIPELINE_LOCK_PATH), { recursive: true });
    fs.writeFileSync(PIPELINE_LOCK_PATH, String(pipelineProcess.pid), 'utf-8');
  } catch { /* best-effort — in-memory guard still applies within this process's lifetime */ }

  pipelineProcess.stdout?.on('data', (chunk: Buffer) => {
    String(chunk).split('\n').filter(Boolean).forEach(pushLog);
  });
  pipelineProcess.stderr?.on('data', (chunk: Buffer) => {
    String(chunk).split('\n').filter(Boolean).forEach(pushLog);
  });
  // Without this, a spawn-level failure (e.g. shell/command not found) throws an
  // unhandled 'error' event and surfaces as a silent, log-less 'failed' status.
  pipelineProcess.on('error', (err: Error) => {
    pushLog(`✗ Failed to launch pipeline process: ${err.message}`);
  });

  pipelineProcess.on('close', (code: number | null) => {
    pipelineStatus = code === 0 ? 'success' : 'failed';
    pipelineProcess = null;
    try { fs.unlinkSync(PIPELINE_LOCK_PATH); } catch {}
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
  try { fs.unlinkSync(PIPELINE_LOCK_PATH); } catch {}
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

// ── Manual Recording — upload + ingest ────────────────────────────────────────

const ALLOWED_UPLOAD_EXT = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi']);

const mrUploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(getProductOutDir(), 'manual-recording');
    fs.mkdirSync(dir, { recursive: true });
    // Clear any previous raw upload / stale outputs so a re-upload always starts clean.
    for (const f of fs.readdirSync(dir)) {
      if (/^raw\.[a-z0-9]+$/i.test(f)) {
        try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
      }
    }
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.mp4';
    cb(null, `raw${ext}`);
  },
});

const mrUpload = multer({
  storage: mrUploadStorage,
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_UPLOAD_EXT.has(ext)) {
      cb(new Error(`Unsupported file type "${ext}". Allowed: ${[...ALLOWED_UPLOAD_EXT].join(', ')}`));
      return;
    }
    cb(null, true);
  },
});

app.post('/api/manual-recording/upload', (req, res) => {
  mrUpload.single('file')(req, res, (err: unknown) => {
    if (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }
    const file = (req as express.Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded (expected multipart field "file")' });
      return;
    }
    try {
      const info = getVideoInfo(file.path);
      if (!info.duration || info.duration < 5) {
        fs.unlinkSync(file.path);
        res.status(400).json({ error: 'Uploaded file does not look like a valid video (duration too short or unreadable).' });
        return;
      }
      res.json({ uploaded: true, path: file.path, sizeMb: Math.round(file.size / 1024 / 1024), durationSec: Math.round(info.duration) });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });
});

app.get('/api/manual-recording/status', (_req, res) => {
  const dir = path.join(getProductOutDir(), 'manual-recording');
  const rawFile = fs.existsSync(dir) ? fs.readdirSync(dir).find(f => /^raw\.[a-z0-9]+$/i.test(f)) : undefined;
  const finalPath = path.join(dir, 'final-demo-video.mp4');
  res.json({
    status: mrStatus,
    hasUpload: !!rawFile,
    uploadFile: rawFile ?? null,
    hasFinalVideo: fs.existsSync(finalPath),
  });
});

app.post('/api/manual-recording/process', (_req, res) => {
  if (mrStatus === 'running') {
    res.status(409).json({ error: 'Manual Recording processing is already running' });
    return;
  }
  const dir = path.join(getProductOutDir(), 'manual-recording');
  const rawFile = fs.existsSync(dir) ? fs.readdirSync(dir).find(f => /^raw\.[a-z0-9]+$/i.test(f)) : undefined;
  if (!rawFile) {
    res.status(400).json({ error: 'No uploaded recording found — upload a video first.' });
    return;
  }

  mrLog = [];
  mrStatus = 'running';
  broadcastMrSSE({ type: 'status', status: 'running' });

  mrProcess = spawn('npm', ['run', 'manual-recording:process'], {
    cwd: ROOT,
    shell: true,
    env: { ...process.env },
  });

  mrProcess.stdout?.on('data', (chunk: Buffer) => {
    String(chunk).split('\n').filter(Boolean).forEach(pushMrLog);
  });
  mrProcess.stderr?.on('data', (chunk: Buffer) => {
    String(chunk).split('\n').filter(Boolean).forEach(pushMrLog);
  });
  mrProcess.on('error', (err: Error) => {
    pushMrLog(`✗ Failed to launch process: ${err.message}`);
  });
  mrProcess.on('close', (code: number | null) => {
    mrStatus = code === 0 ? 'success' : 'failed';
    mrProcess = null;
    broadcastMrSSE({ type: 'done', status: mrStatus });
  });

  res.json({ started: true });
});

app.post('/api/manual-recording/stop', (_req, res) => {
  if (mrProcess) {
    mrProcess.kill('SIGTERM');
    mrProcess = null;
  }
  mrStatus = 'failed';
  broadcastMrSSE({ type: 'done', status: 'failed' });
  res.json({ stopped: true });
});

app.get('/api/manual-recording/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  for (const line of mrLog) {
    res.write(`data: ${JSON.stringify({ type: 'log', line, ts: 0 })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ type: 'status', status: mrStatus })}\n\n`);

  mrSseClients.add(res);
  const keepalive = setInterval(() => {
    try { res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`); } catch { /* ignore */ }
  }, 15_000);
  req.on('close', () => { clearInterval(keepalive); mrSseClients.delete(res); });
});

// Dynamic (not express.static) because getProductOutDir() depends on .env values
// that the Config UI can rewrite at runtime without restarting this server — a
// root bound once at startup would go stale. res.sendFile() still handles Range
// headers correctly, so <video controls> scrubbing/seeking works.
app.get('/manual-recording-output/:file', (req, res) => {
  if (!/^[a-zA-Z0-9._-]+\.mp4$/.test(req.params.file)) {
    res.status(400).end();
    return;
  }
  const filePath = path.join(getProductOutDir(), 'manual-recording', req.params.file);
  if (!fs.existsSync(filePath)) {
    res.status(404).end();
    return;
  }
  res.sendFile(filePath);
});

// ── Agent Recording — exhaustive, safe, all-roles ─────────────────────────────

app.get('/api/agent-recording/status', (_req, res) => {
  const outDir = getProductOutDir();
  const walkthroughPath = path.join(outDir, 'agent-recording', 'agent-walkthrough.mp4');
  const reportPath = path.join(outDir, 'agent-safety-report.json');
  let report: unknown = null;
  if (fs.existsSync(reportPath)) {
    try { report = JSON.parse(fs.readFileSync(reportPath, 'utf-8')); } catch { /* ignore */ }
  }
  res.json({
    status: arStatus,
    hasWalkthrough: fs.existsSync(walkthroughPath),
    hasSafetyReport: fs.existsSync(reportPath),
    report,
  });
});

app.post('/api/agent-recording/run', (req, res) => {
  if (arStatus === 'running') {
    res.status(409).json({ error: 'Agent Recording is already running' });
    return;
  }
  const { narrate } = ((req.body ?? {}) as { narrate?: boolean });

  arLog = [];
  arStatus = 'running';
  broadcastArSSE({ type: 'status', status: 'running' });

  const script = narrate ? 'record:agent-exhaustive:narrate' : 'record:agent-exhaustive';
  arProcess = spawn('npm', ['run', script], {
    cwd: ROOT,
    shell: true,
    env: { ...process.env },
  });

  arProcess.stdout?.on('data', (chunk: Buffer) => {
    String(chunk).split('\n').filter(Boolean).forEach(pushArLog);
  });
  arProcess.stderr?.on('data', (chunk: Buffer) => {
    String(chunk).split('\n').filter(Boolean).forEach(pushArLog);
  });
  arProcess.on('error', (err: Error) => {
    pushArLog(`✗ Failed to launch process: ${err.message}`);
  });
  arProcess.on('close', (code: number | null) => {
    arStatus = code === 0 ? 'success' : 'failed';
    arProcess = null;
    broadcastArSSE({ type: 'done', status: arStatus });
  });

  res.json({ started: true });
});

app.post('/api/agent-recording/stop', (_req, res) => {
  if (arProcess) {
    arProcess.kill('SIGTERM');
    arProcess = null;
  }
  arStatus = 'failed';
  broadcastArSSE({ type: 'done', status: 'failed' });
  res.json({ stopped: true });
});

app.get('/api/agent-recording/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  for (const line of arLog) {
    res.write(`data: ${JSON.stringify({ type: 'log', line, ts: 0 })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ type: 'status', status: arStatus })}\n\n`);

  arSseClients.add(res);
  const keepalive = setInterval(() => {
    try { res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`); } catch { /* ignore */ }
  }, 15_000);
  req.on('close', () => { clearInterval(keepalive); arSseClients.delete(res); });
});

app.get('/agent-recording-output/:file', (req, res) => {
  if (!/^[a-zA-Z0-9._-]+\.mp4$/.test(req.params.file)) {
    res.status(400).end();
    return;
  }
  const filePath = path.join(getProductOutDir(), 'agent-recording', req.params.file);
  if (!fs.existsSync(filePath)) {
    res.status(404).end();
    return;
  }
  res.sendFile(filePath);
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

const server = app.listen(PORT, () => {
  console.log(`\n  Config UI API server:`);
  console.log(`    Local:   http://localhost:${PORT}`);
  for (const ip of getLocalNetworkIPs()) {
    console.log(`    Network: http://${ip}:${PORT}`);
  }
  console.log(`  Open Remotion Studio (same Local/Network hosts, port 3000) and click "Config" in the sidebar.\n`);
});

// Node's default 5-minute request/headers timeout would kill a large (500MB-2GB+)
// Manual Recording upload mid-transfer. Disabled (0 = no timeout) for this server only.
server.requestTimeout = 0;
server.headersTimeout = 0;
