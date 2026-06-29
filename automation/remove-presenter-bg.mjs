#!/usr/bin/env node
/**
 * remove-presenter-bg.mjs
 *
 * Strips the white background from presenter-talking.mp4 and produces
 * presenter-talking-alpha.webm (VP9 + alpha channel) that Remotion can
 * use as a transparent talking-head overlay.
 *
 * Steps:
 *   1. Extract frames from talking video (crop to 640×310 = same as PNG)
 *   2. Remove white/near-white pixels with jimp (soft-edge anti-aliasing)
 *   3. Re-encode as WebM VP9 yuva420p with transparency
 */

import { execSync, spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { Jimp } from 'jimp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, '..');
const FFMPEG     = path.join(ROOT, 'node_modules', '@remotion', 'compositor-win32-x64-msvc', 'ffmpeg.exe');
const ASSETS_DIR = path.join(ROOT, 'out', 'rheem', 'assets', 'presenter');
const FRAMES_DIR = path.join(ASSETS_DIR, '_frames_raw');
const ALPHA_DIR  = path.join(ASSETS_DIR, '_frames_alpha');
const INPUT_MP4  = path.join(ASSETS_DIR, 'presenter-talking.mp4');
const OUTPUT      = path.join(ASSETS_DIR, 'presenter-talking-alpha.webm');
const OUTPUT_LONG = path.join(ASSETS_DIR, 'presenter-talking-alpha-long.webm');
// How many times to loop the 20 s clip so the WebM covers the full 130 s product section.
const LOOP_COPIES = 7;

// ── White-background removal thresholds ─────────────────────────────────────
// We use a border flood-fill rather than a per-pixel threshold so that the
// white background (which is connected to the image edges) is removed while
// internal white regions (teeth, whites of eyes) are preserved.
const BG_THRESH   = 220;   // pixel qualifies as "white background" candidate
const SOFT_THRESH = 190;   // pixels between SOFT and BG get partial transparency

// ── 1. Prepare frame directories ────────────────────────────────────────────
[FRAMES_DIR, ALPHA_DIR].forEach(d => {
  if (fs.existsSync(d)) fs.rmSync(d, { recursive: true });
  fs.mkdirSync(d, { recursive: true });
});

// ── 2. Extract frames (crop to 640×310 — same as presenter-transparent.png) ─
console.log('Extracting frames…');
const extractResult = spawnSync(FFMPEG, [
  '-i', INPUT_MP4,
  '-vf', 'crop=640:310:0:0',
  '-start_number', '1',
  path.join(FRAMES_DIR, 'frame_%04d.png'),
  '-y',
], { stdio: ['ignore', 'pipe', 'pipe'] });

if (extractResult.status !== 0) {
  console.error(extractResult.stderr.toString());
  process.exit(1);
}

const frames = fs.readdirSync(FRAMES_DIR)
  .filter(f => f.endsWith('.png'))
  .sort();
console.log(`Extracted ${frames.length} frames.`);

// ── 3. White-background removal ──────────────────────────────────────────────
console.log('Removing white background…');
let done = 0;

for (const filename of frames) {
  const src  = path.join(FRAMES_DIR, filename);
  const dest = path.join(ALPHA_DIR,  filename);

  const img = await Jimp.read(src);
  const { width, height, data } = img.bitmap;

  // ── Border flood-fill to identify background pixels ──────────────────────
  // Background is defined as white/near-white pixels that are REACHABLE from
  // any image edge via 4-connected neighbours. This preserves internal white
  // regions (teeth, eyes) that are not connected to the border.

  const isBg = new Uint8Array(width * height); // 1 = background
  const queue = [];

  const isWhite = (x, y) => {
    const idx = (y * width + x) * 4;
    return data[idx] > BG_THRESH && data[idx + 1] > BG_THRESH && data[idx + 2] > BG_THRESH;
  };

  const enqueue = (x, y) => {
    const i = y * width + x;
    if (!isBg[i] && isWhite(x, y)) { isBg[i] = 1; queue.push(i); }
  };

  // Seed from all four borders
  for (let x = 0; x < width; x++)  { enqueue(x, 0); enqueue(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { enqueue(0, y); enqueue(width - 1, y); }

  // BFS
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    const x = i % width, y = (i / width) | 0;
    if (x > 0)         enqueue(x - 1, y);
    if (x < width - 1) enqueue(x + 1, y);
    if (y > 0)         enqueue(x, y - 1);
    if (y < height - 1)enqueue(x, y + 1);
  }

  // ── Apply transparency only to flood-filled background pixels ─────────────
  for (let i = 0; i < width * height; i++) {
    if (!isBg[i]) continue;
    const idx = i * 4;
    const minCh = Math.min(data[idx], data[idx + 1], data[idx + 2]);

    if (minCh >= BG_THRESH) {
      data[idx + 3] = 0;                         // fully transparent
    } else if (minCh >= SOFT_THRESH) {
      // Soft anti-aliased edge
      const t = (minCh - SOFT_THRESH) / (BG_THRESH - SOFT_THRESH);
      data[idx + 3] = Math.round(data[idx + 3] * (1 - t));
    }
    // else: pixel is on the absolute border of BG region, leave mostly opaque
  }

  await img.write(dest);
  done++;
  if (done % 50 === 0) process.stdout.write(`  ${done}/${frames.length}\r`);
}
console.log(`  ${done}/${frames.length} frames processed.`);

// ── 4. Clean up raw frames ───────────────────────────────────────────────────
fs.rmSync(FRAMES_DIR, { recursive: true });

// ── 5. Re-encode as transparent WebM (VP9 + yuva420p) ───────────────────────
// 5a. Short 20 s version (single loop)
console.log('Encoding 20 s WebM…');
if (fs.existsSync(OUTPUT)) fs.unlinkSync(OUTPUT);

const encodeShort = spawnSync(FFMPEG, [
  '-framerate', '25',
  '-start_number', '1',
  '-i', path.join(ALPHA_DIR, 'frame_%04d.png'),
  '-c:v', 'libvpx-vp9',
  '-pix_fmt', 'yuva420p',
  '-auto-alt-ref', '0',
  '-crf', '20',
  '-b:v', '0',
  OUTPUT,
  '-y',
], { stdio: ['ignore', 'pipe', 'pipe'] });

if (encodeShort.status !== 0) {
  console.error(encodeShort.stderr.toString());
  process.exit(1);
}
console.log(`  → ${(fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(1)} MB`);

// 5b. Long version (LOOP_COPIES × same frames, no restart in the composition).
// -stream_loop on an image2 sequence repeats the PNG files LOOP_COPIES extra times.
// The jimp-written PNGs are RGBA so the VP9 encoder receives real alpha data.
console.log(`Encoding ${LOOP_COPIES * 20} s WebM (${LOOP_COPIES}× stream_loop)…`);
if (fs.existsSync(OUTPUT_LONG)) fs.unlinkSync(OUTPUT_LONG);

const encodeLong = spawnSync(FFMPEG, [
  '-stream_loop', String(LOOP_COPIES - 1),   // 0 = play once, N-1 = play N times total
  '-framerate', '25',
  '-start_number', '1',
  '-i', path.join(ALPHA_DIR, 'frame_%04d.png'),
  '-c:v', 'libvpx-vp9',
  '-pix_fmt', 'yuva420p',
  '-auto-alt-ref', '0',
  '-crf', '20',
  '-b:v', '0',
  OUTPUT_LONG,
  '-y',
], { stdio: ['ignore', 'pipe', 'pipe'] });

if (encodeLong.status !== 0) {
  console.error(encodeLong.stderr.toString());
  process.exit(1);
}
console.log(`  → ${(fs.statSync(OUTPUT_LONG).size / 1024 / 1024).toFixed(1)} MB`);

// Clean up alpha frames after encoding
fs.rmSync(ALPHA_DIR, { recursive: true });

console.log(`\nDone!\n  short: ${OUTPUT}\n  long:  ${OUTPUT_LONG}`);
