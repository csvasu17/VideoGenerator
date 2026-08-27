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
import { fetchBackgroundMusic, MUSIC_FILE } from './fetch-background-music';
import { generateWithAzureOpenAI } from './utils/tts';

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
  locale?:          string;  // BCP-47 locale code (e.g. 'fr', 'de') — used for SAPI voice selection
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
// --video/--output let a caller point this at a non-Remotion-rendered source video
// (e.g. Agent Recording's real continuous walkthrough footage, or an uploaded Manual
// Recording) instead of the default demo-video.mp4 — the merge step itself (`-c:v copy`)
// never cared which produced the input, so this is a pure additive parameterization.
const OUTPUT_PATH = getArg('--output', path.join(OUT_DIR, 'demo-video-with-voice.mp4'));
const VIDEO_PATH  = getArg('--video', path.join(OUT_DIR, 'demo-video.mp4'));
// NARR_PATH lives alongside OUTPUT_PATH rather than always under the global OUT_DIR,
// so a scoped output dir (e.g. out/<slug>/agent-recording/) keeps its narration mp3
// next to it instead of leaking into the shared product-level out dir.
const NARR_PATH   = path.join(path.dirname(OUTPUT_PATH), 'voice-narration.mp3');
// SEG_DIR is resolved inside main() from script.voiceDir (set after the script is loaded)
const NO_MERGE    = process.argv.includes('--no-merge');
// --no-sync skips syncTimingsToActualDurations() — meaningless against a source video
// whose timestamps are already real wall-clock cut points (Agent/Manual Recording),
// and risky if an unrelated demo-package.json for a different template happens to
// exist for the same product (that function would otherwise try to resync ITS scenes
// using these narration segment ids).
const NO_SYNC     = process.argv.includes('--no-sync');

// Background music config (read from .env)
const MUSIC_VOLUME   = parseFloat(process.env['BACKGROUND_MUSIC_VOLUME']      ?? '0.08');
const MUSIC_FADE_SEC = parseFloat(process.env['BACKGROUND_MUSIC_FADE_OUT_SEC'] ?? '3');
const MUSIC_OVERRIDE = (process.env['BACKGROUND_MUSIC_PATH'] ?? '').trim();

// ─────────────────────────────────────────────────────────────────────────────
// ffmpeg — direct binary, bypasses cmd.exe quoting issues with spaces in paths
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find Remotion's bundled ffmpeg binary.
 * We use it directly (not via `npx remotion ffmpeg --`) so that spawnSync can
 * pass arguments as a proper Win32 args array, avoiding cmd.exe quoting issues
 * when paths contain spaces (e.g. "My Product Video").
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

function findFfprobeBin(): string {
  const candidates = [
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-win32-x64-msvc', 'ffprobe.exe'),
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-darwin-arm64',   'ffprobe'),
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-darwin-x64',     'ffprobe'),
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-linux-x64-gnu',  'ffprobe'),
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-linux-arm64-gnu', 'ffprobe'),
  ];
  for (const c of candidates) { if (fs.existsSync(c)) return c; }
  return 'ffprobe'; // fall back to system PATH
}
let _ffprobeBin: string | null = null;
function ffprobeBin(): string {
  if (!_ffprobeBin) _ffprobeBin = findFfprobeBin();
  return _ffprobeBin;
}

/** Returns actual audio duration in seconds by probing the MP3 file. */
function getMp3DurationSec(filePath: string): number {
  const result = spawnSync(ffprobeBin(), [
    '-v', 'quiet',
    '-show_entries', 'format=duration',
    '-of', 'csv=p=0',
    filePath,
  ], { encoding: 'utf-8', shell: false });
  const dur = parseFloat((result.stdout ?? '').trim());
  return isNaN(dur) ? 0 : dur;
}

/**
 * Teaser-specific variant of the sync below. Teaser's demo-package.json shape
 * (teaserBroll[]/teaserFeatures[]/teaserOutro) differs from enterprise's
 * (brollScenes[]/scenes[]/benefitSlide/presenterClose) — each teaser entry
 * already carries its own explicit `id` (e.g. "broll-hook", "scene-login"), so
 * entries are looked up directly by id instead of reconstructing an index-based
 * `broll-${i}`/`scene-${i+1}` id the way the enterprise branch below does.
 */
function syncTeaserTimings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pkg:        Record<string, any>,
  script:     { segments: Array<{ id: string; startSec: number; durationSec: number; [k: string]: unknown }>; totalDurationSec?: number; [k: string]: unknown },
  actualDur:  Record<string, number>,
  fps:        number,
  bufferSec:  number,
  pkgPath:    string,
  scriptPath: string,
): void {
  type Beat = { id: string; from: number; durationInFrames: number; [k: string]: unknown };
  const broll:    Beat[] = Array.isArray(pkg.teaserBroll)    ? pkg.teaserBroll    : [];
  const features: Beat[] = Array.isArray(pkg.teaserFeatures) ? pkg.teaserFeatures : [];
  const outro:    Beat | undefined = pkg.teaserOutro;

  // Chronological order = original `from` order across both arrays (broll cards
  // are interleaved between feature clips, not simply appended after them).
  const beats = [...broll, ...features].sort((a, b) => a.from - b.from);

  let cursor = beats[0]?.from ?? 0;
  for (const beat of beats) {
    const dur = actualDur[beat.id];
    beat.from = cursor;
    if (dur) beat.durationInFrames = Math.ceil((dur + bufferSec) * fps);
    cursor += beat.durationInFrames;
  }

  if (outro) {
    const dur = actualDur['outro'];
    outro.from = cursor;
    if (dur) outro.durationInFrames = Math.ceil((dur + bufferSec) * fps);
    cursor += outro.durationInFrames;
  }

  if (pkg.composition) pkg.composition.durationInFrames = cursor;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf-8');
  console.log(`  ✓  demo-package.json updated (total: ${(cursor / fps).toFixed(1)}s)`);

  const positionById = new Map<string, Beat>();
  for (const b of beats) positionById.set(b.id, b);
  if (outro) positionById.set('outro', outro);

  for (const seg of script.segments) {
    const pos = positionById.get(seg.id);
    if (pos) {
      seg.startSec    = parseFloat((pos.from / fps + 0.5).toFixed(3));
      seg.durationSec = actualDur[seg.id] ?? seg.durationSec;
    }
  }

  script.totalDurationSec = parseFloat((cursor / fps).toFixed(1));
  fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2), 'utf-8');
  console.log(`  ✓  voice-script.json startSec values updated`);
}

/**
 * After TTS generation, measure each segment's actual MP3 duration and rebuild
 * the video timeline so screen scenes are exactly as long as their narration.
 * Writes updated timings back to demo-package.json and voice-script.json.
 */
function syncTimingsToActualDurations(
  segDir:     string,
  scriptPath: string,
): void {
  const pkgPath = path.join(OUT_DIR, 'demo-package.json');
  if (!fs.existsSync(pkgPath)) return; // only enterprise/teaser pipelines have this

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pkg    = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as any;
  const script = JSON.parse(fs.readFileSync(scriptPath, 'utf-8')) as {
    segments: Array<{ id: string; startSec: number; durationSec: number; [k: string]: unknown }>;
    fps?: number; totalDurationSec?: number; [k: string]: unknown;
  };

  const fps = pkg.composition?.fps ?? 30;

  // Map segment id → actual MP3 duration
  const actualDur: Record<string, number> = {};
  for (const seg of script.segments) {
    const mp3 = path.join(segDir, `${seg.id}.mp3`);
    if (fs.existsSync(mp3)) {
      const d = getMp3DurationSec(mp3);
      if (d > 0) actualDur[seg.id] = d;
    }
  }

  if (Object.keys(actualDur).length === 0) return;

  console.log('\n  ⏱  Syncing scene durations to actual MP3 lengths …');

  const BUFFER_SEC = 2.0; // breathing room after each voice segment ends

  if (Array.isArray(pkg.teaserBroll) || Array.isArray(pkg.teaserFeatures)) {
    // Teaser is a short, punchy "quick overview" cut — 2s of dead air after
    // every single beat (8 beats × 2s ≈ 16s) makes a ~50s video feel sluggish.
    // A tighter buffer keeps pacing snappy without clipping narration (the
    // buffer only pads AFTER the measured MP3 duration, never trims it).
    const TEASER_BUFFER_SEC = 0.8;
    syncTeaserTimings(pkg, script, actualDur, fps, TEASER_BUFFER_SEC, pkgPath, scriptPath);
    return;
  }

  // ── Rebuild brollScenes timeline ────────────────────────────────────────────
  let cursor = pkg.brollScenes?.[0]?.from ?? 0; // keep original start
  if (Array.isArray(pkg.brollScenes)) {
    for (let i = 0; i < pkg.brollScenes.length; i++) {
      const id  = `broll-${i}`;
      const dur = actualDur[id];
      pkg.brollScenes[i].from = cursor;
      if (dur) {
        pkg.brollScenes[i].durationInFrames = Math.ceil((dur + BUFFER_SEC) * fps);
      }
      cursor += pkg.brollScenes[i].durationInFrames;
    }
  }

  // ── Rebuild product scenes timeline ─────────────────────────────────────────
  if (Array.isArray(pkg.scenes)) {
    for (let i = 0; i < pkg.scenes.length; i++) {
      const id    = `scene-${i + 1}`;
      const dur   = actualDur[id];
      const scene = pkg.scenes[i];
      scene.from  = cursor;
      if (dur) {
        const narrationFrames = Math.ceil((dur + BUFFER_SEC) * fps);
        // Cap at the real recorded footage: recordedDurationSec (ffprobe-measured,
        // see record-app-clips.ts) minus the seek offset already applied to it
        // (recordingStartSec). Without this, narration longer than the available
        // clip makes OffthreadVideo hold the last decoded frame for the shortfall —
        // a multi-second freeze (worst case, a near-blank UI state held on screen).
        const recordedSec = typeof scene.recordedDurationSec === 'number' ? scene.recordedDurationSec : undefined;
        const startSec     = typeof scene.recordingStartSec  === 'number' ? scene.recordingStartSec  : 0;
        const availableSec = recordedSec !== undefined ? recordedSec - startSec : undefined;
        const maxFrames     = availableSec !== undefined ? Math.floor(availableSec * fps) : undefined;
        if (maxFrames !== undefined && maxFrames < narrationFrames) {
          console.warn(
            `  ⚠️   [${id}] narration (${(narrationFrames / fps).toFixed(1)}s) exceeds available ` +
            `footage (${(maxFrames / fps).toFixed(1)}s after a ${startSec}s seek) — capping scene ` +
            `duration and truncating audio. Shorten this scene's narration text to fit.`,
          );
          scene.durationInFrames = Math.max(1, maxFrames);
        } else {
          scene.durationInFrames = narrationFrames;
        }
      }
      cursor += scene.durationInFrames;
    }
  }

  // ── Benefit slide & presenter close (keep original duration, shift from) ─────
  if (pkg.benefitSlide) {
    pkg.benefitSlide.from = cursor;
    cursor += pkg.benefitSlide.durationInFrames;
  }
  if (pkg.presenterClose) {
    pkg.presenterClose.from = cursor;
    cursor += pkg.presenterClose.durationInFrames;
  }

  // ── Write updated demo-package.json ────────────────────────────────────────
  if (pkg.composition) pkg.composition.durationInFrames = cursor;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf-8');
  console.log(`  ✓  demo-package.json updated (total: ${(cursor / fps).toFixed(1)}s)`);

  // ── Recompute voice-script.json startSec based on new from values ───────────
  const brollScenes = pkg.brollScenes ?? [];
  const scenes      = pkg.scenes      ?? [];

  for (const seg of script.segments) {
    if (seg.id.startsWith('broll-')) {
      const idx   = parseInt(seg.id.replace('broll-', ''), 10);
      const broll = brollScenes[idx];
      if (broll) {
        seg.startSec    = parseFloat((broll.from / fps + 1.5).toFixed(3));
        seg.durationSec = actualDur[seg.id] ?? seg.durationSec;
      }
    } else if (seg.id.startsWith('scene-')) {
      const idx   = parseInt(seg.id.replace('scene-', ''), 10) - 1;
      const scene = scenes[idx];
      if (scene) {
        seg.startSec = parseFloat((scene.from / fps + 1.0).toFixed(3));
        // Keep the Audio sequence's own length in lockstep with the (possibly
        // footage-capped) scene duration above — otherwise a capped scene's
        // narration keeps playing after the picture has already cut to the next
        // scene. durationSec here is what EnterpriseVideo.tsx uses directly to
        // size the <Audio> Sequence, independent of the scene's visual duration.
        const fullDur = actualDur[seg.id] ?? seg.durationSec;
        const sceneMaxSec = scene.durationInFrames / fps - 1.0; // mirror the +1.0s startSec offset above
        seg.durationSec = Math.min(fullDur, Math.max(0.1, sceneMaxSec));
      }
    } else if (seg.id === 'benefit-slide' && pkg.benefitSlide) {
      seg.startSec = parseFloat((pkg.benefitSlide.from / fps + 1.0).toFixed(3));
    } else if (seg.id === 'presenter-close' && pkg.presenterClose) {
      seg.startSec = parseFloat((pkg.presenterClose.from / fps + 2.0).toFixed(3));
    }
  }

  script.totalDurationSec = parseFloat((cursor / fps).toFixed(1));
  fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2), 'utf-8');
  console.log(`  ✓  voice-script.json startSec values updated`);
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
 * Maps a BCP-47 locale code to the Windows SAPI voice name.
 * Falls back to Microsoft David Desktop (English) if no locale-specific
 * voice is installed or the locale is unknown.
 */
function resolveSapiVoice(locale: string): string {
  const map: Record<string, string> = {
    fr: 'Microsoft Hortense Desktop',   // French
    de: 'Microsoft Hedda Desktop',      // German
    es: 'Microsoft Helena Desktop',     // Spanish
    it: 'Microsoft Elsa Desktop',       // Italian
    pt: 'Microsoft Heami Desktop',      // Portuguese
    ja: 'Microsoft Haruka Desktop',     // Japanese
  };
  const code = locale.split('-')[0].toLowerCase();
  return map[code] ?? 'Microsoft David Desktop';
}

/**
 * Provider B: Windows SAPI (no API key required).
 * Uses Microsoft David Desktop (male, English) by default; selects a
 * locale-appropriate voice when locale is provided.
 * Quality is acceptable but less natural than OpenAI TTS.
 *
 * All paths passed to PowerShell via a temp .ps1 file to avoid escaping issues.
 * All spawnSync calls use shell:false so Win32 handles spaces in paths directly.
 */
function generateWithSAPI(text: string, outMp3: string, speed: number, locale = 'en'): void {
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
  // Paths here are the OS tmpdir paths which never have product-name spaces.
  const preferredVoice = resolveSapiVoice(locale);
  const psLines = [
    `Add-Type -AssemblyName System.Speech`,
    `$text  = [System.IO.File]::ReadAllText('${textFile.replace(/\\/g, '\\\\')}', [Text.Encoding]::UTF8)`,
    `$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer`,
    // Try locale-specific voice; fall back to David Desktop if not installed
    `try { $synth.SelectVoice('${preferredVoice}') } catch { $synth.SelectVoice('Microsoft David Desktop') }`,
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

  // ── Background music — auto-fetch if needed ───────────────────────────────
  let musicFilePath: string | null = null;

  if (MUSIC_OVERRIDE) {
    if (fs.existsSync(MUSIC_OVERRIDE)) {
      musicFilePath = MUSIC_OVERRIDE;
      console.log(`  ♪  Background music : ${MUSIC_OVERRIDE}  (from BACKGROUND_MUSIC_PATH)`);
    } else {
      console.warn(`  ⚠️  BACKGROUND_MUSIC_PATH not found: ${MUSIC_OVERRIDE} — skipping music.`);
    }
  } else if (process.env['PIXABAY_API_KEY']) {
    if (fs.existsSync(MUSIC_FILE)) {
      musicFilePath = MUSIC_FILE;
      console.log(`  ♪  Background music : using cached  ${path.relative(ROOT, MUSIC_FILE)}`);
    } else {
      console.log('\n  ♪  Auto-fetching background music from Pixabay …');
      musicFilePath = await fetchBackgroundMusic();
    }
  }

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

  // Log locale info — Azure/OpenAI TTS auto-detect language from text content.
  // SAPI requires a locale-specific voice to be installed on the host machine.
  const scriptLocale = script.locale ?? process.env['APP_LANGUAGE'] ?? 'en';
  if (scriptLocale !== 'en') {
    console.log(`\n  🌐  Locale : ${scriptLocale}`);
    if (provider === 'azure' || provider === 'openai') {
      console.log(`           Azure/OpenAI TTS auto-detects language from text — no extra config needed.`);
    } else {
      const sapiVoiceName = resolveSapiVoice(scriptLocale);
      console.log(`           SAPI voice : ${sapiVoiceName} (must be installed on this machine)`);
    }
  }

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

  const voice  = script.voice  ?? 'onyx';
  const model  = script.model  ?? 'tts-1-hd';
  const speed  = script.speed  ?? 1.0;
  const locale = script.locale ?? process.env['APP_LANGUAGE'] ?? 'en';

  if (provider === 'azure' || provider === 'openai') {
    console.log(`  Voice    : ${voice}  (model: ${model},  speed: ${speed})`);
  } else {
    const sapiVoice = resolveSapiVoice(locale);
    console.log(`  Voice    : ${sapiVoice}  (SAPI rate ≈ ${Math.round((speed - 0.9) * 15)})`);
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
        generateWithSAPI(seg.text, segFile, speed, locale);
      }
    } else if (provider === 'openai') {
      await generateWithOpenAI(seg.text, segFile, voice, model, speed);
    } else {
      generateWithSAPI(seg.text, segFile, speed, locale);
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

  // Segment N's nominal startSec (a real scene-cut timestamp for Agent/Manual
  // Recording, or an estimated slot for Remotion-driven templates) has no
  // guaranteed relationship to how long its OWN synthesized speech actually runs.
  // Positioning every segment strictly at its nominal startSec means a long
  // narration can still be playing when the next segment's delay point arrives —
  // both voices then sound simultaneously. `cursorMs` tracks the actual end of the
  // previous segment's speech (+ a small breathing gap) and never lets a segment
  // start earlier than that, guaranteeing segments never overlap.
  const GAP_SEC = 0.3;
  let cursorMs = 0;
  activeSegments.forEach((seg, i) => {
    const segFile = path.join(SEG_DIR, `${seg.id}.mp3`);
    const nominalMs = Math.round(seg.startSec * 1000);
    const delayMs   = Math.max(nominalMs, cursorMs);
    const idx     = i + 1;
    mixArgs.push('-i', segFile);
    filterLines.push(`[${idx}:a]adelay=${delayMs}|${delayMs}[a${idx}]`);
    mixLabels.push(`[a${idx}]`);
    const actualDurSec = getMp3DurationSec(segFile);
    cursorMs = delayMs + Math.round((actualDurSec || 0) * 1000) + Math.round(GAP_SEC * 1000);
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

  // Sync scene durations in demo-package.json + voice-script.json to actual MP3 lengths.
  // Skipped entirely under --no-sync (Agent/Manual Recording's scene timestamps are
  // already real wall-clock cut points — there's no Remotion-rendered timeline to
  // resync, and doing so risks rewriting an unrelated demo-package.json from a
  // different template's prior run against the same product).
  if (!NO_SYNC) {
    try {
      syncTimingsToActualDurations(SEG_DIR, SCRIPT_PATH);
    } catch (e) {
      console.warn(`  ⚠️  Timing sync skipped: ${(e as Error).message}`);
    }
  }

  // Stamp voice-script.json so the Remotion composition knows audio is ready.
  try {
    const vsRaw = JSON.parse(fs.readFileSync(SCRIPT_PATH, 'utf-8')) as Record<string, unknown>;
    vsRaw['voiceReady'] = true;
    fs.writeFileSync(SCRIPT_PATH, JSON.stringify(vsRaw, null, 2), 'utf-8');
    console.log('  ✓  voice-script.json → voiceReady: true');
  } catch {}

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

  if (musicFilePath) {
    console.log(`\n  Merging narration + background music with video …`);
    console.log(`     Music volume : ${MUSIC_VOLUME}  |  fade-out : ${MUSIC_FADE_SEC}s`);

    // Fade starts MUSIC_FADE_SEC before the end of the video
    const fadeStart = Math.max(0, (script.totalDurationSec ?? 44) - MUSIC_FADE_SEC);

    // filter_complex:
    //   [1:a] narration at full volume
    //   [2:a] music at reduced volume, faded out near the end
    //   amix  mixes both without normalising (keeps narration dominant)
    const filterStr =
      `[1:a]volume=1.0[narr];` +
      `[2:a]volume=${MUSIC_VOLUME},afade=t=out:st=${fadeStart}:d=${MUSIC_FADE_SEC}[music];` +
      `[narr][music]amix=inputs=2:normalize=0[aout]`;

    runFfmpeg([
      '-i',            VIDEO_PATH,
      '-i',            NARR_PATH,
      '-stream_loop',  '-1',        // loop music if shorter than video
      '-i',            musicFilePath,
      '-filter_complex', filterStr,
      '-map',          '0:v:0',
      '-map',          '[aout]',
      '-c:v',          'copy',
      '-c:a',          'aac',
      '-b:a',          '192k',      // higher bitrate for richer mixed audio
      '-shortest',
      '-y',            OUTPUT_PATH,
    ]);
  } else {
    console.log('\n  Merging narration with video …');

    runFfmpeg([
      '-i',       VIDEO_PATH,
      '-i',       NARR_PATH,
      '-map',     '0:v:0',
      '-map',     '1:a:0',
      '-c:v',     'copy',
      '-c:a',     'aac',
      '-b:a',     '128k',
      '-shortest',
      '-y',       OUTPUT_PATH,
    ]);
  }

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
