#!/usr/bin/env node
/**
 * render-demo.ts  —  Renders demo-package.json → demo-video.mp4 via Remotion CLI.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json automation/render-demo.ts [options]
 *
 * Options:
 *   --input <path>   Path to demo-package.json  (default: out/localhost/demo-package.json)
 *   --crf   <n>      H.264 CRF quality (0=lossless, 51=worst, default: 23)
 *   --scale <n>      Downscale factor e.g. 0.5 for half-res preview  (default: 1)
 *   --concurrency <n> Chrome tabs per chunk (default: 1)
 *   --chunk-size <n> Frames per chunk for enterprise rendering (default: 250)
 *
 * Enterprise template: renders in chunks to avoid Chrome OOM on long videos,
 * then concatenates with FFmpeg. Each chunk restarts Chrome fresh.
 */

import * as path     from 'path';
import * as fs       from 'fs';
import { execSync }  from 'child_process';
import { ROOT, OUT_DIR, SHOW_AVATAR } from './config';

// ─────────────────────────────────────────────────────────────────────────────
// CLI arg parsing
// ─────────────────────────────────────────────────────────────────────────────

function getArg(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const INPUT_PATH  = getArg('--input',      path.join(OUT_DIR, 'demo-package.json'));
const CRF         = getArg('--crf',        '23');
const SCALE       = getArg('--scale',      '1');
const CONCURRENCY = getArg('--concurrency', '1');
const CHUNK_SIZE  = parseInt(getArg('--chunk-size', '250'), 10);

// Locate FFmpeg (check PATH first, then common install locations)
function findFfmpeg(): string {
  try { execSync('ffmpeg -version', { stdio: 'ignore' }); return 'ffmpeg'; } catch { /* not in PATH */ }
  const candidates = [
    'C:/ffmpeg/bin/ffmpeg.exe',
    'D:/ffmpeg/bin/ffmpeg.exe',
  ];
  // Also search D:\software\ glob
  try {
    const result = execSync(
      'powershell -NoProfile -Command "(Get-Command ffmpeg -ErrorAction SilentlyContinue).Source"',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    if (result) return result;
  } catch { /* ignore */ }
  for (const c of candidates) { if (fs.existsSync(c)) return c; }
  throw new Error('FFmpeg not found. Install it or add it to PATH.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildRenderCmd(
  compositionId: string,
  outputFwd:     string,
  publicDirFwd:  string,
  framesArg?:    string,   // e.g. "0-249"
): string {
  const parts = [
    `npx remotion render ${compositionId}`,
    `"${outputFwd}"`,
    '--codec=h264',
    `--crf=${CRF}`,
    `--public-dir="${publicDirFwd}"`,
    `--concurrency=${CONCURRENCY}`,
  ];
  if (parseFloat(SCALE) !== 1) parts.push(`--scale=${SCALE}`);
  if (framesArg) parts.push(`--frames=${framesArg}`);
  return parts.join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function main(): void {
  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`\n  ✗  demo-package.json not found at: ${INPUT_PATH}`);
    console.error('     Run the e2e pipeline first:');
    console.error('       npx ts-node --project tsconfig.scripts.json automation/e2e-test.ts\n');
    process.exit(1);
  }

  const originalPkgContent = fs.readFileSync(INPUT_PATH, 'utf-8');
  const pkg = JSON.parse(originalPkgContent);
  const outputDir = path.resolve(path.dirname(INPUT_PATH));

  // Sync global brand assets (logo, etc.) into this product's public-dir
  const globalAssets  = path.join(ROOT, 'public', 'assets');
  const productAssets = path.join(outputDir, 'assets');
  if (fs.existsSync(globalAssets)) {
    fs.mkdirSync(productAssets, { recursive: true });
    for (const file of fs.readdirSync(globalAssets)) {
      fs.copyFileSync(path.join(globalAssets, file), path.join(productAssets, file));
    }
  }

  // When SHOW_AVATAR=false, clear presenterConfig so Remotion skips the overlay
  if (!SHOW_AVATAR && pkg.presenterConfig) {
    const patched = JSON.parse(originalPkgContent);
    patched.presenterConfig = { src: '', widthFraction: 0, position: 'bottom-left' };
    fs.writeFileSync(INPUT_PATH, JSON.stringify(patched, null, 2), 'utf-8');
    console.log('  ℹ  SHOW_AVATAR=false — presenter overlay hidden for this render');
  }

  const isEnterprise  = pkg?.meta?.templateId === 'enterprise';
  const compositionId = isEnterprise ? 'EnterpriseVideo' : 'DemoVideo';
  const outputVideo   = path.join(outputDir, 'demo-video.mp4');

  const { fps = 30, width = 1920, height = 1080, durationInFrames = 0 } = pkg.composition ?? {};

  const SEP = '═'.repeat(63);
  console.log(`\n${SEP}`);
  console.log(`  🎬  Remotion Render  →  ${compositionId}`);
  console.log(`      Template    : ${isEnterprise ? 'enterprise' : 'modern_saas'}`);
  console.log(`      Source      : ${INPUT_PATH}`);
  console.log(`      Output      : ${outputVideo}`);
  console.log(`      Config      : ${width}×${height} @ ${fps}fps  CRF=${CRF}  scale=${SCALE}`);
  console.log(`      Total frames: ${durationInFrames}  (${(durationInFrames / fps).toFixed(1)}s)`);
  console.log(`      Scenes      : ${pkg.scenes?.length ?? 0} product scenes`);
  if (isEnterprise) {
    console.log(`      B-roll      : ${pkg.brollScenes?.length ?? 0} problem scenes`);
    console.log(`      Chunk size  : ${CHUNK_SIZE} frames  (${(CHUNK_SIZE / fps).toFixed(1)}s per chunk)`);
  }
  console.log(SEP);

  const publicDirFwd  = outputDir.replace(/\\/g, '/');
  const outputVideoFwd = outputVideo.replace(/\\/g, '/');

  if (!isEnterprise) {
    // ── Modern SaaS: single render ───────────────────────────────────────────
    const cmd = buildRenderCmd(compositionId, outputVideoFwd, publicDirFwd);
    console.log(`\n  $ ${cmd}\n`);
    try {
      execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
    } catch {
      process.exit(1);
    }
  } else {
    // ── Enterprise: chunked render + FFmpeg concat ───────────────────────────
    const totalFrames = durationInFrames;
    const numChunks   = Math.ceil(totalFrames / CHUNK_SIZE);

    console.log(`\n  Rendering ${numChunks} chunks of ≤${CHUNK_SIZE} frames each...\n`);

    let ffmpeg: string;
    try { ffmpeg = findFfmpeg(); } catch (e) {
      console.error(`\n  ✗  ${(e as Error).message}`);
      process.exit(1);
    }
    console.log(`  FFmpeg: ${ffmpeg}\n`);

    const segmentPaths: string[] = [];

    for (let i = 0; i < numChunks; i++) {
      const from = i * CHUNK_SIZE;
      const to   = Math.min((i + 1) * CHUNK_SIZE - 1, totalFrames - 1);
      const segFile   = path.join(outputDir, `_segment-${String(i).padStart(3, '0')}.mp4`);
      const segFileFwd = segFile.replace(/\\/g, '/');
      segmentPaths.push(segFile);

      // Skip already-rendered segments (allows resuming after interruption)
      if (fs.existsSync(segFile) && fs.statSync(segFile).size > 10_000) {
        console.log(`\n  ── Chunk ${i + 1}/${numChunks}  frames ${from}–${to}  [SKIPPED — already rendered]`);
        continue;
      }

      console.log(`\n  ── Chunk ${i + 1}/${numChunks}  frames ${from}–${to} ──────────────────────────`);

      const cmd = buildRenderCmd(compositionId, segFileFwd, publicDirFwd, `${from}-${to}`);
      console.log(`  $ ${cmd}\n`);

      try {
        execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
      } catch {
        console.error(`\n  ✗  Chunk ${i + 1} failed`);
        console.error('     Run again to resume from this chunk (completed segments are skipped).');
        process.exit(1);
      }
    }

    // ── Concatenate segments ────────────────────────────────────────────────
    console.log(`\n${SEP}`);
    console.log('  Concatenating segments with FFmpeg...');

    const concatListPath = path.join(outputDir, '_concat.txt');
    const concatContent  = segmentPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(concatListPath, concatContent, 'utf-8');

    // Remove existing output so FFmpeg doesn't prompt
    if (fs.existsSync(outputVideo)) fs.unlinkSync(outputVideo);

    const ffmpegCmd = [
      `"${ffmpeg}"`,
      '-f concat -safe 0',
      `-i "${concatListPath.replace(/\\/g, '/')}"`,
      '-c copy',
      '-movflags +faststart',
      `"${outputVideoFwd}"`,
    ].join(' ');
    console.log(`\n  $ ${ffmpegCmd}\n`);

    try {
      execSync(ffmpegCmd, { cwd: ROOT, stdio: 'inherit' });
    } catch {
      console.error('\n  ✗  FFmpeg concatenation failed');
      process.exit(1);
    }

    // ── Cleanup temp files ──────────────────────────────────────────────────
    segmentPaths.forEach(p => { try { fs.unlinkSync(p); } catch { /* ignore */ } });
    try { fs.unlinkSync(concatListPath); } catch { /* ignore */ }
  }

  // Restore original demo-package.json if it was patched for SHOW_AVATAR=false
  if (!SHOW_AVATAR && pkg.presenterConfig) {
    fs.writeFileSync(INPUT_PATH, originalPkgContent, 'utf-8');
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  const stat    = fs.statSync(outputVideo);
  const sizeMb  = (stat.size / 1_048_576).toFixed(1);

  console.log(`\n${SEP}`);
  console.log(`  ✓  Render complete!`);
  console.log(`     File : ${outputVideo}`);
  console.log(`     Size : ${sizeMb} MB`);
  console.log(`${SEP}\n`);
}

main();
