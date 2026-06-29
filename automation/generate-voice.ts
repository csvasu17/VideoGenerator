#!/usr/bin/env node
/**
 * generate-voice.ts — Generate TTS narration and merge with demo-video.mp4.
 *
 * Usage:
 *   npm run voice                  — generate narration + merge with video
 *   npm run voice:only             — generate narration MP3 only (skip merge)
 *   npm run render:demo:voice      — render video, then add voice in one step
 *
 * TTS provider (auto-selected):
 *   1. Azure OpenAI TTS — if AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT set (premium quality)
 *   2. OpenAI TTS       — if OPENAI_API_KEY is in .env                         (premium quality)
 *   3. Windows SAPI     — if no API key present                                (no-key fallback)
 *
 * Azure OpenAI TTS deployment name: set AZURE_OPENAI_TTS_DEPLOYMENT in .env
 *   (defaults to "tts" — must be a TTS model deployment, not a chat model)
 *
 * What it does:
 *   1. Reads out/localhost/voice-script.json  ← EDIT THIS to change narration
 *   2. Generates a per-segment MP3 in out/localhost/voice-segments/
 *   3. Mixes all segments into a timed narration track:
 *        out/localhost/voice-narration.mp3
 *   4. Merges narration with demo-video.mp4 →
 *        out/localhost/demo-video-with-voice.mp4
 *
 * Quick iteration (text change — no re-render needed):
 *   1. Edit  out/localhost/voice-script.json
 *   2. Run   npm run voice
 */

import * as path        from 'path';
import * as fs          from 'fs';
import * as os          from 'os';
import { spawnSync }    from 'child_process';
import * as dotenv      from 'dotenv';
import { OUT_DIR, ROOT } from './config';

// Load .env before reading process.env
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface VoiceSegment {
  id:           string;
  label:        string;
  startSec:     number;
  durationSec:  number;
  enabled:      boolean;
  text:         string;
}

interface VoiceScript {
  voice:            string;  // OpenAI voice name  (onyx / echo / alloy / nova / shimmer)
  model:            string;  // tts-1 or tts-1-hd
  speed:            number;  // 0.25–4.0; 1.0 = normal
  fps:              number;
  totalDurationSec: number;
  segments:         VoiceSegment[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Paths & flags
// ─────────────────────────────────────────────────────────────────────────────

function getArg(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const SCRIPT_PATH = getArg('--script', path.join(OUT_DIR, 'voice-script.json'));
const NARR_PATH   = path.join(OUT_DIR, 'voice-narration.mp3');
// SEG_DIR is resolved inside main() from script.voiceDir (set after the script is loaded)
const VIDEO_PATH  = path.join(OUT_DIR, 'demo-video.mp4');
const OUTPUT_PATH = path.join(OUT_DIR, 'demo-video-with-voice.mp4');
const NO_MERGE    = process.argv.includes('--no-merge');

// ─────────────────────────────────────────────────────────────────────────────
// ffmpeg — direct binary, bypasses cmd.exe quoting issues with spaces in paths
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find Remotion's bundled ffmpeg binary.
 * We use it directly (not via `npx remotion ffmpeg --`) so that spawnSync can
 * pass arguments as a proper Win32 args array, avoiding cmd.exe quoting issues
 * when paths contain spaces (e.g. "Rheem Video").
 */
function findFfmpegBin(): string {
  const candidates = [
    // Windows x64 (most common)
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-win32-x64-msvc', 'ffmpeg.exe'),
    // macOS ARM + Intel
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-darwin-arm64',   'ffmpeg'),
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-darwin-x64',     'ffmpeg'),
    // Linux
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-linux-x64-gnu',  'ffmpeg'),
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-linux-arm64-gnu', 'ffmpeg'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    'Could not find Remotion bundled ffmpeg.\n' +
    'Tried:\n' + candidates.map(c => `  ${c}`).join('\n') + '\n' +
    'Run  npm install  then try again.',
  );
}

let _ffmpegBin: string | null = null;
function ffmpegBin(): string {
  if (!_ffmpegBin) _ffmpegBin = findFfmpegBin();
  return _ffmpegBin;
}

/**
 * Run ffmpeg with an explicit args array.
 * spawnSync (shell:false) passes args directly to Win32 CreateProcess —
 * no cmd.exe layer, no quoting ambiguity with spaces in path segments.
 */
function runFfmpeg(args: string[]): void {
  const result = spawnSync(ffmpegBin(), args, {
    cwd:   ROOT,
    stdio: 'inherit',
    // shell: false (the default) — bypass cmd.exe entirely
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`ffmpeg exited with code ${result.status ?? '(signal)'}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TTS providers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Provider A: Azure OpenAI TTS (premium quality).
 * Requires AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT in .env.
 * Optionally AZURE_OPENAI_TTS_DEPLOYMENT (defaults to "tts").
 * Voices: onyx, echo, alloy, fable, nova, shimmer.
 */
async function generateWithAzureOpenAI(
  text:    string,
  outMp3:  string,
  voice:   string,
  model:   string,
  speed:   number,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { AzureOpenAI } = require('openai');

  // Prefer dedicated TTS resource vars; fall back to main Azure vars
  const endpoint    = (process.env['AZURE_OPENAI_TTS_ENDPOINT'] ?? process.env['AZURE_OPENAI_ENDPOINT']!).replace(/\/$/, '');
  const apiKey      = process.env['AZURE_OPENAI_TTS_KEY'] ?? process.env['AZURE_OPENAI_API_KEY']!;
  const apiVersion  = process.env['OPENAI_API_VERSION'] ?? '2025-01-01-preview';
  // model param = the TTS deployment name (e.g. "tts-hd", "tts-1-hd")
  const deployment  = model;

  const client = new AzureOpenAI({ endpoint, apiKey, apiVersion, deployment });

  const response = await client.audio.speech.create({
    model:           deployment,   // Azure uses the deployment name here
    voice:           voice as 'onyx' | 'echo' | 'alloy' | 'fable' | 'nova' | 'shimmer',
    input:           text,
    response_format: 'mp3',
    speed:           speed,
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outMp3, buffer);
}

/**
 * Provider B: OpenAI TTS (premium quality).
 * Requires OPENAI_API_KEY in .env.
 * Voices: onyx, echo, alloy, fable, nova, shimmer.
 */
async function generateWithOpenAI(
  text:    string,
  outMp3:  string,
  voice:   string,
  model:   string,
  speed:   number,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const OpenAI = require('openai').default ?? require('openai');
  const client = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] });

  const response = await client.audio.speech.create({
    model:           model,
    voice:           voice,
    input:           text,
    response_format: 'mp3',
    speed:           speed,
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outMp3, buffer);
}

/**
 * Provider B: Windows SAPI (no API key required).
 * Uses Microsoft David Desktop (male) via PowerShell.
 * Quality is acceptable but less natural than OpenAI TTS.
 *
 * All paths passed to PowerShell via a temp .ps1 file to avoid escaping issues.
 * All spawnSync calls use shell:false so Win32 handles spaces in paths directly.
 */
function generateWithSAPI(text: string, outMp3: string, speed: number): void {
  // Put temp WAV/ps1/text in the OS temp dir to avoid path-with-space issues
  // in the PowerShell SetOutputToWaveFile call.
  const tmpDir   = path.join(os.tmpdir(), 'rheem-voice-gen');
  fs.mkdirSync(tmpDir, { recursive: true });

  const segId    = path.basename(outMp3, '.mp3');
  const textFile = path.join(tmpDir, `${segId}-text.txt`);
  const wavFile  = path.join(tmpDir, `${segId}.wav`);
  const ps1File  = path.join(tmpDir, `${segId}.ps1`);

  // Map OpenAI speed float → SAPI integer rate (-10..10).
  // Speed 1.0 → rate 1 (slightly faster than SAPI default, which tends to drag).
  const sapiRate = Math.round((speed - 0.9) * 15);

  // Write narration text to a file — avoids all PowerShell string-escaping
  // headaches with em-dashes, apostrophes, etc.
  fs.writeFileSync(textFile, text, 'utf-8');

  // PowerShell script that reads text file → synthesises to WAV
  // Paths here are the OS tmpdir paths which never have "Rheem Video" spaces.
  const psLines = [
    `Add-Type -AssemblyName System.Speech`,
    `$text  = [System.IO.File]::ReadAllText('${textFile.replace(/\\/g, '\\\\')}', [Text.Encoding]::UTF8)`,
    `$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer`,
    `$synth.SelectVoice('Microsoft David Desktop')`,
    `$synth.Rate   = ${sapiRate}`,
    `$synth.Volume = 100`,
    `$synth.SetOutputToWaveFile('${wavFile.replace(/\\/g, '\\\\')}')`,
    `$synth.Speak($text)`,
    `$synth.Dispose()`,
  ];
  fs.writeFileSync(ps1File, psLines.join('\r\n'), 'utf-8');

  // Run PowerShell — spawnSync shell:false passes -File path directly
  // to CreateProcess; Win32 handles spaces in ps1File path correctly.
  const psResult = spawnSync(
    'powershell.exe',
    ['-ExecutionPolicy', 'Bypass', '-NonInteractive', '-File', ps1File],
    { cwd: ROOT, stdio: 'inherit' },
  );
  if (psResult.error) throw psResult.error;
  if (psResult.status !== 0) {
    throw new Error(`PowerShell SAPI synthesis failed (exit ${psResult.status})`);
  }

  if (!fs.existsSync(wavFile)) {
    throw new Error(`SAPI did not produce WAV file at: ${wavFile}`);
  }

  // Convert WAV → MP3 via direct ffmpeg binary (no cmd.exe, no quoting issues)
  runFfmpeg(['-i', wavFile, '-c:a', 'libmp3lame', '-b:a', '128k', '-y', outMp3]);

  // Clean up temp files
  for (const f of [textFile, wavFile, ps1File]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const SEP = '═'.repeat(63);
  console.log(`\n${SEP}`);
  console.log('  🎙️  Voice Narration Generator');
  console.log(`      Script : ${SCRIPT_PATH}`);
  console.log(SEP);

  // ── Detect TTS provider ────────────────────────────────────────────────────
  const azureKey    = process.env['AZURE_OPENAI_API_KEY'];
  const azureEndpt  = process.env['AZURE_OPENAI_ENDPOINT'];
  const openaiKey   = process.env['OPENAI_API_KEY'];

  type Provider = 'azure' | 'openai' | 'sapi';
  const provider: Provider =
    (azureKey && azureEndpt) ? 'azure' :
    openaiKey                ? 'openai' :
                               'sapi';

  const ttsDeploy = process.env['AZURE_OPENAI_TTS_DEPLOYMENT'] ?? 'tts';

  if (provider === 'azure') {
    const ttsEndptDisplay = (process.env['AZURE_OPENAI_TTS_ENDPOINT'] ?? process.env['AZURE_OPENAI_ENDPOINT'] ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    console.log(`\n  Provider : Azure OpenAI TTS  (${ttsEndptDisplay}  ·  deployment: ${ttsDeploy})`);
  } else if (provider === 'openai') {
    console.log('\n  Provider : OpenAI TTS  (premium quality)');
  } else {
    console.log('\n  Provider : Windows SAPI  (no API key — acceptable quality)');
    console.log('  Tip      : AZURE_OPENAI_API_KEY or OPENAI_API_KEY enables premium TTS');
  }

  // ── Validate ffmpeg binary exists before starting ─────────────────────────
  const bin = ffmpegBin();
  console.log(`  ffmpeg   : ${path.relative(ROOT, bin)}`);

  // ── Load voice-script.json ─────────────────────────────────────────────────
  if (!fs.existsSync(SCRIPT_PATH)) {
    console.error(`\n  ✗  Not found: ${SCRIPT_PATH}`);
    process.exit(1);
  }

  const script         = JSON.parse(fs.readFileSync(SCRIPT_PATH, 'utf-8')) as VoiceScript;

  // Resolve voice-segments directory from script.voiceDir (supports multi-voice setups).
  // Falls back to 'voice-segments' for backward compatibility.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const voiceDir = (script as any).voiceDir ?? 'voice-segments';
  const SEG_DIR  = path.join(OUT_DIR, voiceDir);

  const activeSegments = script.segments.filter(
    s => s.enabled && typeof s.text === 'string' && s.text.trim().length > 0,
  );

  if (activeSegments.length === 0) {
    console.error('\n  ✗  No enabled segments with text in voice-script.json.');
    process.exit(1);
  }

  const voice = script.voice ?? 'onyx';
  const model = script.model ?? 'tts-1-hd';
  const speed = script.speed ?? 1.0;

  if (provider === 'azure' || provider === 'openai') {
    console.log(`  Voice    : ${voice}  (model: ${model},  speed: ${speed})`);
  } else {
    console.log(`  Voice    : Microsoft David Desktop  (SAPI rate ≈ ${Math.round((speed - 0.9) * 15)})`);
  }
  console.log(`  Segments : ${activeSegments.length} active\n`);

  // ── Generate per-segment MP3s ──────────────────────────────────────────────
  fs.mkdirSync(SEG_DIR, { recursive: true });

  for (const seg of activeSegments) {
    const segFile      = path.join(SEG_DIR, `${seg.id}.mp3`);
    const wordCount    = seg.text.trim().split(/\s+/).length;
    const estimatedSec = Math.round(wordCount / (2.5 * speed));

    console.log(`  [${seg.id}]  "${seg.label}"`);
    console.log(`         ${wordCount} words ≈ ${estimatedSec}s  |  scene: ${seg.durationSec}s`);

    if (estimatedSec > seg.durationSec + 1) {
      console.warn(`  ⚠️   Text may overflow by ~${estimatedSec - seg.durationSec}s`);
      console.warn(`         Shorten text or increase "speed" in voice-script.json`);
    }

    process.stdout.write('         Synthesising … ');

    if (provider === 'azure') {
      // Try each TTS deployment variant in order; fall back to SAPI on 404.
      const ttsVariants = [ttsDeploy, 'tts-1-hd', 'tts-1', 'tts'];
      // deduplicate, keep order
      const tryList = [...new Set(ttsVariants)];
      let azureOk = false;
      for (const dep of tryList) {
        try {
          await generateWithAzureOpenAI(seg.text, segFile, voice, dep, speed);
          azureOk = true;
          break;
        } catch (err: unknown) {
          const msg = (err as Error)?.message ?? '';
          const is404 = msg.includes('404') || msg.includes('deployment');
          if (is404) {
            // try next variant
            continue;
          }
          throw err;  // non-404 error — propagate
        }
      }
      if (!azureOk) {
        // No TTS deployment found on this Azure resource — fall back to SAPI
        if (seg === activeSegments[0]) {
          console.warn('\n  ⚠️   Azure TTS: no TTS deployment found on this resource.');
          console.warn('       To enable premium Azure TTS, go to Azure Portal →');
          console.warn('       Azure OpenAI → Deployments → Add deployment → tts-1-hd.');
          console.warn('       Falling back to Windows SAPI for this run.\n');
        }
        generateWithSAPI(seg.text, segFile, speed);
      }
    } else if (provider === 'openai') {
      await generateWithOpenAI(seg.text, segFile, voice, model, speed);
    } else {
      generateWithSAPI(seg.text, segFile, speed);
    }

    const stat = fs.statSync(segFile);
    console.log(`done  (${(stat.size / 1024).toFixed(0)} KB)`);
  }

  // ── Mix segments into a timed narration track ─────────────────────────────
  console.log('\n  Mixing narration track …');

  // Build ffmpeg args array — no string interpolation, no shell quoting issues
  const mixArgs: string[] = ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo'];
  const filterLines: string[] = [];
  const mixLabels:   string[] = ['[0:a]'];

  activeSegments.forEach((seg, i) => {
    const segFile = path.join(SEG_DIR, `${seg.id}.mp3`);
    const delayMs = Math.round(seg.startSec * 1000);
    const idx     = i + 1;
    mixArgs.push('-i', segFile);
    filterLines.push(`[${idx}:a]adelay=${delayMs}|${delayMs}[a${idx}]`);
    mixLabels.push(`[a${idx}]`);
  });

  filterLines.push(
    `${mixLabels.join('')}amix=inputs=${mixLabels.length}:normalize=0[aout]`,
  );

  // Write filter to file — avoids any inline `|` being interpreted as shell pipe
  const filterFile = path.join(SEG_DIR, 'mix-filter.txt');
  fs.writeFileSync(filterFile, filterLines.join(';'), 'utf-8');

  const totalDuration = (script.totalDurationSec ?? 44) + 5;

  runFfmpeg([
    ...mixArgs,
    '-filter_complex_script', filterFile,
    '-map',  '[aout]',
    '-t',    String(totalDuration),
    '-c:a',  'libmp3lame',
    '-b:a',  '128k',
    '-y',    NARR_PATH,
  ]);

  const narrStat = fs.statSync(NARR_PATH);
  console.log(
    `\n  ✓  Narration : ${NARR_PATH}  (${(narrStat.size / 1_048_576).toFixed(2)} MB)`,
  );

  if (NO_MERGE) {
    console.log('\n  --no-merge set — skipping video merge.');
    console.log(`\n${SEP}\n  ✅  Narration done!\n${SEP}\n`);
    return;
  }

  // ── Merge narration with demo-video.mp4 ───────────────────────────────────
  if (!fs.existsSync(VIDEO_PATH)) {
    console.log('\n  ℹ️  demo-video.mp4 not found — skipping merge.');
    console.log('     Run  npm run render:demo  first, then  npm run voice  again.');
    console.log(`\n${SEP}\n  ✅  Narration generated!\n${SEP}\n`);
    return;
  }

  console.log('\n  Merging narration with video …');

  runFfmpeg([
    '-i',       VIDEO_PATH,
    '-i',       NARR_PATH,
    '-map',     '0:v:0',   // video from demo-video.mp4
    '-map',     '1:a:0',   // audio from voice-narration.mp3 (explicit — demo-video already has audio)
    '-c:v',     'copy',
    '-c:a',     'aac',
    '-b:a',     '128k',
    '-shortest',
    '-y',       OUTPUT_PATH,
  ]);

  const outStat = fs.statSync(OUTPUT_PATH);

  console.log(`\n${SEP}`);
  console.log('  ✅  Done!');
  console.log(`\n     Output : ${OUTPUT_PATH}`);
  console.log(`     Size   : ${(outStat.size / 1_048_576).toFixed(1)} MB`);
  console.log(`\n  To update narration: edit voice-script.json → npm run voice`);
  console.log(`${SEP}\n`);
}

main().catch(err => {
  console.error('\n  ✗  Error:', (err as Error).message ?? err);
  process.exit(1);
});
