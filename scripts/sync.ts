#!/usr/bin/env node
/**
 * sync.ts — Scan public/assets/ for video clips, match them to segment
 * definitions, update clipManifest.json and videoConfig.json with real durations.
 *
 * Run after recording OR after dropping manual assets into public/assets/.
 * Usage: npm run sync
 */

import * as path from 'path';
import * as fs   from 'fs';
import {getVideoInfo, durationToFrames} from './utils/ffprobe';
import {resolveClipsToSegments}         from './utils/mapper';
import {SEGMENT_DEFS}                   from '../src/config/segmentDefs';
import type {ClipInfo, ClipManifest, ResolvedSegment} from './types';

const ROOT             = path.resolve(__dirname, '..');
const PUBLIC_DIR       = path.join(ROOT, 'public');
const ASSETS_DIR       = path.join(PUBLIC_DIR, 'assets');
const MANIFEST_PATH    = path.join(ROOT, 'src', 'config', 'clipManifest.json');
const VIDEO_CFG_PATH   = path.join(ROOT, 'src', 'config', 'videoConfig.json');
const FPS              = 60;

// ─── Recursive video file scanner ─────────────────────────────────────────────
function findVideos(dir: string, base: string = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findVideos(full, base));
    } else if (/\.(mp4|webm|mov)$/i.test(entry.name)) {
      results.push(path.relative(base, full).replace(/\\/g, '/'));
    }
  }
  return results;
}

async function main() {
  console.log('\n🔄 Syncing Rheem video assets...\n');

  // ── Step 1: Scan all video files ──────────────────────────────────────────
  const videoFiles = findVideos(ASSETS_DIR);
  console.log(`📦 Found ${videoFiles.length} video file(s) in public/assets/\n`);

  const allClips: ClipInfo[] = [];

  for (const relFile of videoFiles) {
    const fullPath = path.join(ASSETS_DIR, relFile);
    const isManual = !relFile.includes('recordings/');
    const rawId    = path.basename(relFile, path.extname(relFile)).toLowerCase().replace(/[^a-z0-9]+/g, '-');

    process.stdout.write(`   ${isManual ? '📁' : '🤖'} ${relFile} ... `);
    try {
      const info = getVideoInfo(fullPath);
      console.log(`${info.duration.toFixed(1)}s`);
      allClips.push({
        id:               rawId,
        file:             `assets/${relFile}`,
        duration:         info.duration,
        durationInFrames: durationToFrames(info.duration, FPS),
        width:            info.width,
        height:           info.height,
        source:           isManual ? 'manual' : 'auto',
        capturedAt:       new Date().toISOString(),
      });
    } catch (e) {
      console.log(`⚠️  ${(e as Error).message}`);
    }
  }

  // ── Step 2: Also check explicit manualOverride paths ─────────────────────
  for (const def of SEGMENT_DEFS) {
    if (!def.manualOverride) continue;
    const fullPath = path.join(PUBLIC_DIR, def.manualOverride);
    if (!fs.existsSync(fullPath)) continue;
    // Avoid double-counting (already found in scan)
    if (allClips.some(c => c.file === def.manualOverride)) continue;

    process.stdout.write(`   📌 ${def.manualOverride} (manualOverride) ... `);
    try {
      const info = getVideoInfo(fullPath);
      console.log(`${info.duration.toFixed(1)}s`);
      allClips.push({
        id:               def.id,
        file:             def.manualOverride,
        duration:         info.duration,
        durationInFrames: durationToFrames(info.duration, FPS),
        width:            info.width,
        height:           info.height,
        source:           'manual',
        capturedAt:       new Date().toISOString(),
      });
    } catch (e) {
      console.log(`⚠️  ${(e as Error).message}`);
    }
  }

  // ── Step 3: Resolve segments ──────────────────────────────────────────────
  const productDemoSegments = SEGMENT_DEFS.filter(s => s.sceneId === 'productDemo');
  const segments = resolveClipsToSegments(productDemoSegments, allClips, FPS);

  console.log('\n📊 Resolved segments:');
  let totalFrames = 0;
  for (const s of segments) {
    const icon = s.resolvedClip
      ? (s.resolvedClip.source === 'manual' ? '📁' : '🤖')
      : '📋';
    const src = s.resolvedClip?.file ?? '(placeholder)';
    const secs = (s.durationInFrames / FPS).toFixed(1);
    console.log(`   ${icon} [${s.id}] ${s.label} — ${secs}s from ${src}`);
    totalFrames += s.durationInFrames;
  }
  console.log(`\n   Total productDemo: ${(totalFrames / FPS).toFixed(1)}s (${totalFrames} frames)\n`);

  // ── Step 4: Write clipManifest.json ──────────────────────────────────────
  const manifest: ClipManifest = {
    generatedAt: new Date().toISOString(),
    fps:         FPS,
    clips:       allClips,
    segments,
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log('📄 Updated: src/config/clipManifest.json');

  // ── Step 5: Update videoConfig.json ──────────────────────────────────────
  const videoConfig = JSON.parse(fs.readFileSync(VIDEO_CFG_PATH, 'utf8'));
  const oldDuration = videoConfig.scenes.productDemo.durationInFrames as number;
  const delta       = totalFrames - oldDuration;

  videoConfig.scenes.productDemo.durationInFrames = totalFrames;

  const ORDER = ['intro','problem','solution','productDemo','features','metrics','customerExperience','closing'];
  let past = false;
  for (const key of ORDER) {
    if (key === 'productDemo') { past = true; continue; }
    if (past) videoConfig.scenes[key].startFrame += delta;
  }
  videoConfig.video.durationInFrames += delta;

  fs.writeFileSync(VIDEO_CFG_PATH, JSON.stringify(videoConfig, null, 2));
  console.log('🎬 Updated: src/config/videoConfig.json');

  if (delta !== 0) {
    const sign = delta > 0 ? '+' : '';
    console.log(`   productDemo duration: ${oldDuration} → ${totalFrames} frames (${sign}${delta})`);
  }

  console.log('\n✅ Sync complete. Run "npm start" or "npm run render" to preview/render.\n');
}

main().catch(e => {
  console.error('\n💥 Fatal:', e.message ?? e);
  process.exit(1);
});
