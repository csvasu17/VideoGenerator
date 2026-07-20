/**
 * process-manual-recording.ts — Manual Recording ingestion: takes a user's own
 * long (15+ minute) raw screen-capture video (uploaded via the Config UI), detects
 * scenes, analyzes each with AI vision, generates a narration script, synthesizes
 * voiceover, and assembles a final branded demo video.
 *
 * Speech-to-text is an explicit non-goal for v1 — automation/generate-voice.ts's
 * merge command (reused unmodified here) already maps only the synthesized
 * narration audio (`-map 1:a:0`), never the source video's own audio track, so
 * ignoring any spoken narration in the raw upload isn't extra scope-cutting, it's
 * the behavior the reuse target already has.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json automation/process-manual-recording.ts
 *
 * Expects an uploaded file at out/<slug>/manual-recording/raw.<ext> (written by
 * config-server.ts's upload endpoint, or placed there manually for CLI use).
 *
 * Output:
 *   out/<slug>/manual-recording/final-demo-video.mp4   — the deliverable
 *   out/<slug>/manual-recording-validation-report.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { execSync } from 'child_process';
import { AzureOpenAI } from 'openai';
import { OUT_DIR, ROOT } from './config';
import { getVideoInfo } from './utils/ffprobe';
import { detectScenes } from './utils/sceneDetection';
import type { DetectedScene } from './utils/sceneDetection';
import { analyzeAllScenes } from './utils/manualRecordingVision';
import { validateDemoScenes, printValidationReport } from './utils/demoValidation';
import type { ValidationClipInput, ValidationFlag, ValidationReport } from './utils/demoValidation';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

// ─── Config ───────────────────────────────────────────────────────────────────

const PRODUCT_NAME = process.env['APP_PRODUCT_NAME'] || 'Product';
const APP_CONTEXT   = process.env['APP_CONTEXT_TEXT'] ?? '';

const FPS       = 30;
const OPEN_SEC  = 3;
const CLOSE_SEC = 4;

const MR_DIR              = path.join(OUT_DIR, 'manual-recording');
const NORMALIZED_PATH     = path.join(MR_DIR, 'normalized.mp4');
const SAMPLE_DIR          = path.join(MR_DIR, 'sample-frames');
const SCENE_FRAME_DIR     = path.join(MR_DIR, 'scene-frames');
const SCENES_JSON_PATH    = path.join(MR_DIR, 'scenes.json');
const VOICE_SCRIPT_PATH   = path.join(MR_DIR, 'voice-script.json');
const BOOKEND_DIR         = path.join(MR_DIR, 'bookend-render');
const BOOKEND_OPEN_PATH   = path.join(MR_DIR, 'bookend-open.mp4');
const BOOKEND_CLOSE_PATH  = path.join(MR_DIR, 'bookend-close.mp4');
const NARRATED_PATH       = path.join(MR_DIR, 'demo-video-with-voice.mp4');
const FINAL_PATH          = path.join(MR_DIR, 'final-demo-video.mp4');
const VALIDATION_PATH     = path.join(OUT_DIR, 'manual-recording-validation-report.json');

// ─── ffmpeg binary (Remotion's bundled copy) ───────────────────────────────────

function findFfmpegBin(): string {
  const candidates = [
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-win32-x64-msvc', 'ffmpeg.exe'),
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-darwin-arm64',   'ffmpeg'),
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-darwin-x64',     'ffmpeg'),
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-linux-x64-gnu',  'ffmpeg'),
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-linux-arm64-gnu', 'ffmpeg'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('Could not find Remotion bundled ffmpeg. Run `npm install` then try again.');
}

// Remotion's bundled ffmpeg is a minimal build with `crop` compiled out (see the
// normalize() comment below), so cropping a browser/OS chrome border out of a raw
// upload needs a full ffmpeg build. Not bundled with this repo — genuinely optional,
// so this only activates when MANUAL_REC_CROP_TOP_PX is set AND a full build happens
// to be discoverable on the host machine; otherwise cropping is skipped with a warning.
let _cropFfmpegBin: string | null | undefined;
function findCropCapableFfmpegBin(): string | null {
  if (_cropFfmpegBin !== undefined) return _cropFfmpegBin;
  const candidates = [
    process.env['FFMPEG_PATH'],
    'ffmpeg',
    'C:/ffmpeg/bin/ffmpeg.exe',
    'C:/Program Files/ffmpeg/bin/ffmpeg.exe',
  ].filter(Boolean) as string[];
  for (const cmd of candidates) {
    try {
      const out = execSync(`"${cmd}" -filters`, { encoding: 'utf-8', timeout: 8000 });
      if (/^\s*\S*\s+crop\s/m.test(out)) { _cropFfmpegBin = cmd; return cmd; }
    } catch { /* try next candidate */ }
  }
  _cropFfmpegBin = null;
  return null;
}

function findRawUpload(): string {
  if (!fs.existsSync(MR_DIR)) {
    throw new Error(`No manual-recording directory found at ${MR_DIR} — upload a recording first.`);
  }
  const match = fs.readdirSync(MR_DIR).find(f => /^raw\.[a-z0-9]+$/i.test(f));
  if (!match) {
    throw new Error(`No uploaded recording found in ${MR_DIR} (expected a file named raw.<ext>).`);
  }
  return path.join(MR_DIR, match);
}

// ─── Step 0: normalize (resolution/fps/codec) ──────────────────────────────────

function normalize(rawPath: string): void {
  let ffmpeg = findFfmpegBin();
  console.log('  🎬  Normalizing uploaded video (resolution/fps/codec)…');

  // Optional: crop out a fixed top strip (e.g. the browser tab/address bar, or an
  // OS title bar) before scaling — common when the raw upload is a whole-window
  // capture rather than a browser extension that captures only the page content.
  // Pixel count is app/tool-specific, so it's operator-configured per product
  // (JSON-in-env-var convention), not auto-detected.
  const cropTopPx = parseInt(process.env['MANUAL_REC_CROP_TOP_PX'] ?? '0', 10) || 0;
  let videoFilter = 'scale=1920:1080';
  if (cropTopPx > 0) {
    const cropFfmpeg = findCropCapableFfmpegBin();
    if (cropFfmpeg) {
      ffmpeg = cropFfmpeg;
      videoFilter = `crop=iw:ih-${cropTopPx}:0:${cropTopPx},scale=1920:1080`;
      console.log(`     Cropping top ${cropTopPx}px (chrome/title bar) using ${cropFfmpeg}`);
    } else {
      console.warn(`  ⚠️  MANUAL_REC_CROP_TOP_PX=${cropTopPx} set, but no full ffmpeg build with the 'crop' filter was found on this machine (Remotion's bundled ffmpeg doesn't include it). Skipping crop.`);
    }
  }

  // Remotion's bundled ffmpeg is a minimal build (--disable-filters plus a curated
  // --enable-filter allowlist) that does NOT include `pad`, `fps`, or `setsar` —
  // only `scale` survives for video. So this can't letterbox non-16:9 sources the
  // usual way; it stretches to exactly 1920x1080 instead, which is the one approach
  // that always succeeds and guarantees the exact canvas size the concat filter (in
  // assembleFinalVideo) requires from every input. Frame rate is normalized via `-r`
  // as an output option (a muxer-level frame duplication/drop, not a filter), which
  // works regardless of which filters this ffmpeg build has enabled.
  //
  // Real screen-capture tools (e.g. Xbox/Windows Game Bar) can embed a non-square
  // pixel aspect ratio (SAR) in the source container. `scale` alone carries that
  // through rather than resetting it to 1:1, and without `setsar` there's no video
  // filter to force it back — but the concat filter later requires an EXACT SAR
  // match between this footage and the always-1:1 Remotion-rendered bookends, or it
  // fails outright ("Input link parameters do not match"). `-bsf:v
  // h264_metadata=sample_aspect_ratio=1/1` looked like the fix (rewrites the H.264
  // SPS directly) but empirically did NOT change what ffmpeg's demuxer reports back
  // on re-read — MP4's container-level pasp/track-header aspect apparently wins over
  // the bitstream SPS here. `-aspect 1920:1080` (a plain muxer output option, not a
  // filter) sets that container-level aspect directly and was verified (via an
  // isolated concat test) to actually fix it.
  execSync(
    `"${ffmpeg}" -y -i "${rawPath}" ` +
    `-vf "${videoFilter}" -r ${FPS} -aspect 1920:1080 ` +
    `-c:v libx264 -crf 18 -c:a aac -ar 44100 -ac 2 -b:a 192k "${NORMALIZED_PATH}"`,
    { stdio: 'inherit' },
  );
}

// ─── Per-scene representative frame ────────────────────────────────────────────

function extractSceneFrame(scene: DetectedScene): string {
  const ffmpeg = findFfmpegBin();
  const mid = (scene.startSec + scene.endSec) / 2;
  const framePath = path.join(SCENE_FRAME_DIR, `scene-${String(scene.index).padStart(2, '0')}.png`);
  fs.mkdirSync(SCENE_FRAME_DIR, { recursive: true });
  execSync(`"${ffmpeg}" -y -ss ${mid} -i "${NORMALIZED_PATH}" -frames:v 1 -q:v 2 "${framePath}"`, { stdio: 'ignore' });
  return framePath;
}

// ─── Bookend branding — real DemoVideo/OpeningTitleScene/ClosingCardScene renders ──

function renderBookends(): void {
  console.log('  🎨  Rendering opening/closing title cards…');
  fs.mkdirSync(BOOKEND_DIR, { recursive: true });

  const openFrames  = OPEN_SEC * FPS;
  const closeFrames = CLOSE_SEC * FPS;
  const bookendPkg = {
    schemaVersion: '1.0' as const,
    id: 'manual-recording-bookend',
    meta: {
      productName: PRODUCT_NAME, targetAudience: '', primaryBenefit: '',
      totalDurationSec: OPEN_SEC + CLOSE_SEC, totalScenes: 0, narrativeArc: '',
      generatedAt: new Date().toISOString(), journeyId: '', storyboardId: '',
    },
    composition: { id: 'DemoVideo', fps: FPS, width: 1920, height: 1080, durationInFrames: openFrames + closeFrames },
    openingCard: { from: 0, durationInFrames: openFrames, title: PRODUCT_NAME, subtitle: 'Product Walkthrough', backgroundColor: '#0a0f1a' },
    scenes: [],
    closingCard: { from: openFrames, durationInFrames: closeFrames, callToAction: 'Thanks for watching', productName: PRODUCT_NAME, backgroundColor: '#0a0f1a' },
  };
  fs.writeFileSync(path.join(BOOKEND_DIR, 'demo-package.json'), JSON.stringify(bookendPkg, null, 2), 'utf-8');

  const publicDirFwd = BOOKEND_DIR.replace(/\\/g, '/');
  execSync(
    `npx remotion render DemoVideo "${BOOKEND_OPEN_PATH.replace(/\\/g, '/')}" --public-dir="${publicDirFwd}" --frames=0-${openFrames - 1} --codec=h264`,
    { cwd: ROOT, stdio: 'inherit' },
  );
  execSync(
    `npx remotion render DemoVideo "${BOOKEND_CLOSE_PATH.replace(/\\/g, '/')}" --public-dir="${publicDirFwd}" --frames=${openFrames}-${openFrames + closeFrames - 1} --codec=h264`,
    { cwd: ROOT, stdio: 'inherit' },
  );

  // Remotion renders these video-only (DemoVideoProps has no voiceScript for a
  // scenes:[] package) — inject a matching silent AAC track so the final concat
  // filter (which needs every input to have both a video AND audio stream) works.
  addSilentAudioTrack(BOOKEND_OPEN_PATH);
  addSilentAudioTrack(BOOKEND_CLOSE_PATH);
}

function addSilentAudioTrack(videoPath: string): void {
  const ffmpeg = findFfmpegBin();
  const tmpPath = `${videoPath}.tmp.mp4`;
  execSync(
    `"${ffmpeg}" -y -i "${videoPath}" -f lavfi -i "anullsrc=r=44100:cl=stereo" ` +
    `-c:v copy -c:a aac -shortest -map 0:v:0 -map 1:a:0 "${tmpPath}"`,
    { stdio: 'ignore' },
  );
  fs.renameSync(tmpPath, videoPath);
}

// ─── Final assembly ─────────────────────────────────────────────────────────────

function assembleFinalVideo(): void {
  console.log('  🎬  Assembling final video…');
  const ffmpeg = findFfmpegBin();
  // Concat FILTER (re-encode), not the demuxer's `-c copy` path — same reasoning
  // already proven necessary in automation/record-agent-exhaustive.ts: clips from
  // different encoder pipelines (Remotion render vs. the merged narrated footage)
  // have incompatible parameters for a naive stream copy.
  const cmd = [
    `"${ffmpeg}" -y`,
    `-i "${BOOKEND_OPEN_PATH.replace(/\\/g, '/')}"`,
    `-i "${NARRATED_PATH.replace(/\\/g, '/')}"`,
    `-i "${BOOKEND_CLOSE_PATH.replace(/\\/g, '/')}"`,
    `-filter_complex "[0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1[outv][outa]"`,
    `-map "[outv]" -map "[outa]"`,
    `-c:v libx264 -crf 18 -preset veryfast -c:a aac -b:a 192k`,
    `"${FINAL_PATH.replace(/\\/g, '/')}"`,
  ].join(' ');
  execSync(cmd, { stdio: 'inherit' });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  🎥  Manual Recording — ingest, narrate, assemble');
  console.log('══════════════════════════════════════════════════════════════\n');

  fs.mkdirSync(MR_DIR, { recursive: true });

  const rawPath = findRawUpload();
  const rawInfo = getVideoInfo(rawPath);
  console.log(`  Raw upload : ${rawPath}  (${rawInfo.duration.toFixed(1)}s, ${rawInfo.width}x${rawInfo.height})`);
  if (rawInfo.duration < 5) {
    console.error('  ✗  Upload does not look like a valid video (duration too short).');
    process.exit(1);
  }

  normalize(rawPath);
  const normInfo = getVideoInfo(NORMALIZED_PATH);

  console.log('  🔍  Detecting scenes…');
  const scenes = await detectScenes(NORMALIZED_PATH, SAMPLE_DIR, normInfo.duration, ROOT);
  fs.writeFileSync(SCENES_JSON_PATH, JSON.stringify(scenes, null, 2), 'utf-8');
  console.log(`     Detected ${scenes.length} scene(s)`);

  console.log('  🖼️   Extracting representative frames…');
  const frames = scenes.map(scene => ({ sceneIndex: scene.index, framePath: extractSceneFrame(scene) }));

  console.log('  🤖  Analyzing scenes with AI vision…');
  const azureClient = new AzureOpenAI({
    apiKey:     process.env['AZURE_OPENAI_API_KEY']    ?? '',
    endpoint:   process.env['AZURE_OPENAI_ENDPOINT']   ?? '',
    deployment: process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
    apiVersion: process.env['OPENAI_API_VERSION']      ?? '2024-12-01-preview',
  });
  const narrations = await analyzeAllScenes(azureClient, frames, APP_CONTEXT);

  const segments = scenes.map(scene => {
    const n = narrations.get(scene.index);
    return {
      id:          `mr-scene-${scene.index + 1}`,
      label:       n?.sceneTitle || `Scene ${scene.index + 1}`,
      startSec:    scene.startSec,
      durationSec: Math.max(2, scene.durationSec),
      text:        n?.narration || `Screen ${scene.index + 1}.`,
      enabled:     true as const,
    };
  });

  const voiceScript = {
    voice: 'nova', model: 'tts-hd', speed: 0.95, fps: FPS,
    voiceDir: 'manual-recording/voice-segments',
    totalDurationSec: normInfo.duration,
    segments,
  };
  fs.writeFileSync(VOICE_SCRIPT_PATH, JSON.stringify(voiceScript, null, 2), 'utf-8');
  console.log(`  ✓  voice-script.json written (${segments.length} segments)`);

  renderBookends();

  console.log('  🎙️   Generating narration + merging with footage…');
  execSync(
    `npx ts-node --project tsconfig.scripts.json automation/generate-voice.ts ` +
    `--script "${VOICE_SCRIPT_PATH.replace(/\\/g, '/')}" ` +
    `--video "${NORMALIZED_PATH.replace(/\\/g, '/')}" ` +
    `--output "${NARRATED_PATH.replace(/\\/g, '/')}" --no-sync`,
    { cwd: ROOT, stdio: 'inherit' },
  );

  assembleFinalVideo();

  // ── Non-blocking validation ───────────────────────────────────────────────────
  const clips: ValidationClipInput[] = scenes.map(scene => {
    const n = narrations.get(scene.index);
    return {
      id:             `mr-scene-${scene.index + 1}`,
      title:          n?.sceneTitle || `Scene ${scene.index + 1}`,
      narration:      n?.narration || '',
      screenshotPath: frames.find(f => f.sceneIndex === scene.index)?.framePath || '',
    };
  });
  const report: ValidationReport = await validateDemoScenes(clips);

  const extraFlags: ValidationFlag[] = [];
  for (const scene of scenes) {
    if (scene.boundaryConfidence === 'low') {
      extraFlags.push({ sceneId: `mr-scene-${scene.index + 1}`, code: 'GENERIC_NARRATION', message: 'low-confidence scene boundary (possibly merged sub-floor fragments) — verify manually' });
    }
    const n = narrations.get(scene.index);
    if (n?.confidence === 'failed') {
      extraFlags.push({ sceneId: `mr-scene-${scene.index + 1}`, code: 'GENERIC_NARRATION', message: 'AI vision analysis failed for this scene — narration is a generic placeholder' });
    }
  }
  const combinedReport: ValidationReport = {
    flags: [...report.flags, ...extraFlags],
    passed: report.flags.length + extraFlags.length === 0,
    scanned: report.scanned,
    skippedUrlCheck: report.skippedUrlCheck,
  };
  fs.writeFileSync(VALIDATION_PATH, JSON.stringify(combinedReport, null, 2), 'utf-8');
  printValidationReport(combinedReport);

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  ✅  Done!');
  console.log(`     Final video : ${FINAL_PATH}`);
  console.log(`     Report      : ${VALIDATION_PATH}`);
  console.log('══════════════════════════════════════════════════════════════\n');
}

main().catch(e => {
  console.error('\n💥 Fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
