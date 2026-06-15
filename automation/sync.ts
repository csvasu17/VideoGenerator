#!/usr/bin/env node
/**
 * sync.ts — Scan recordings, filter garbage, order by application workflow,
 * deduplicate overlapping concepts, update clipManifest + videoConfig.
 *
 * Usage: npm run sync [-- projectId]
 */

import * as path from 'path';
import * as fs   from 'fs';
import {getVideoInfo, durationToFrames} from './utils/ffprobe';
import type {ClipInfo, ClipManifest, ResolvedSegment, SegmentDef} from './types';

const PROJECT_ID     = process.argv[2] || 'rheem';
const ROOT           = path.resolve(__dirname, '..');
const PUBLIC_DIR     = path.join(ROOT, 'public');
const REC_DIR        = path.join(PUBLIC_DIR, 'projects', PROJECT_ID, 'recordings');
const LEGACY_DIR     = path.join(PUBLIC_DIR, 'assets');
const MANIFEST_PATH  = path.join(ROOT, 'projects', PROJECT_ID, 'clipManifest.json');
const VIDEO_CFG_PATH = path.join(ROOT, 'src', 'config', 'videoConfig.json');
const FPS            = 60;
const MIN_FRAMES     = 120;   // clips shorter than 2s are garbage — skip them

// ─── Application workflow order ───────────────────────────────────────────────
// Determines the VIDEO sequence: login → dashboard → nav pages → admin → settings
const WORKFLOW_ORDER: Record<string, number> = {
  login:              0,
  signin:             0,
  home:               1,
  dashboard:          1,
  'rheem-totalview':  2,
  totalview:          2,
  overview:           2,
  sites:              3,
  site:               3,
  'site-detail':      4,
  'site-info':        4,
  alarms:             5,
  alerts:             5,
  devices:            6,
  device:             6,
  equipment:          6,
  'device-detail':    7,
  'device-info':      7,
  insights:           8,
  analytics:          9,
  reports:            10,
  report:             10,
  'ai-predict':       11,
  'ai-predictions':   11,
  ai:                 11,
  simulator:          12,
  simulate:           12,
  workflows:          13,
  workflow:           13,
  users:              14,
  user:               14,
  admin:              14,
  settings:           15,
  setting:            13,
  profile:            14,
  help:               15,
};

function workflowOrder(id: string): number {
  const lower = id.toLowerCase();
  if (lower in WORKFLOW_ORDER) return WORKFLOW_ORDER[lower];
  for (const [key, order] of Object.entries(WORKFLOW_ORDER)) {
    if (lower.includes(key)) return order;
  }
  return 50;   // unknown pages appear after known ones
}

// ─── Concept groups — keep the clip with the most frames ─────────────────────
// e.g. if both "home" and "dashboard" exist, keep the longer one
const CONCEPT_GROUPS: string[][] = [
  ['home',      'dashboard'],
  ['analytics', 'insights'],
  ['dispatch',  'alarms'],
];

// ─── Load segment defs (for labels, subtitles, zoom regions) ─────────────────
let SEGMENT_DEFS: SegmentDef[] = [];
try {
  SEGMENT_DEFS = require('../projects/' + PROJECT_ID + '/config/segmentDefs').SEGMENT_DEFS || [];
} catch { /* no defs file — auto-generate labels from id */ }

// ─── File scanner ─────────────────────────────────────────────────────────────
function findVideos(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, {withFileTypes: true})
    .filter(e => !e.isDirectory() && /\.(mp4|webm|mov)$/i.test(e.name))
    .map(e => e.name);
}

function isGarbage(filename: string): boolean {
  // Playwright auto-generated temp names: page@<hex>.(webm|mp4)
  return /^page@[a-f0-9]{10,}\.(webm|mp4)$/.test(filename);
}

function idToLabel(id: string): string {
  return id.split(/[-_]/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔄 Syncing project: ${PROJECT_ID}\n`);
  fs.mkdirSync(path.dirname(MANIFEST_PATH), {recursive: true});

  // ── Step 1: Scan + filter clips ───────────────────────────────────────────
  const rawClips: ClipInfo[] = [];

  const scanSources: Array<{files: string[]; dir: string; prefix: string; isManual: boolean}> = [
    {files: findVideos(REC_DIR),    dir: REC_DIR,    prefix: `projects/${PROJECT_ID}/recordings`, isManual: false},
    {files: findVideos(LEGACY_DIR), dir: LEGACY_DIR, prefix: 'assets',                            isManual: true},
  ];

  for (const src of scanSources) {
    for (const file of src.files) {
      if (isGarbage(file)) { console.log(`   ⛔ Garbage — skipping: ${file}`); continue; }
      const fullPath = path.join(src.dir, file);
      const rawId    = path.basename(file, path.extname(file)).toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (rawClips.some(c => c.id === rawId)) continue;   // recordings/ wins over legacy

      process.stdout.write(`   ${src.isManual ? '📁' : '📹'} ${file} ... `);
      try {
        const info   = getVideoInfo(fullPath);
        const frames = durationToFrames(info.duration, FPS);
        if (frames < MIN_FRAMES) { console.log(`⛔ Only ${frames}f — skipping`); continue; }
        console.log(`${info.duration.toFixed(1)}s (${frames}f)`);
        rawClips.push({
          id:               rawId,
          file:             `${src.prefix}/${file}`,
          duration:         info.duration,
          durationInFrames: frames,
          width:            info.width,
          height:           info.height,
          source:           src.isManual ? 'manual' : 'auto',
          capturedAt:       new Date().toISOString(),
        });
      } catch (e) { console.log(`⚠️  ${(e as Error).message}`); }
    }
  }

  // ── Step 2: Deduplicate overlapping concepts ──────────────────────────────
  let allClips = [...rawClips];
  for (const group of CONCEPT_GROUPS) {
    const members = group.map(id => allClips.find(c => c.id === id)).filter(Boolean) as ClipInfo[];
    if (members.length < 2) continue;
    const best     = members.reduce((a, b) => a.durationInFrames >= b.durationInFrames ? a : b);
    const toRemove = members.filter(c => c !== best);
    toRemove.forEach(c => {
      allClips = allClips.filter(x => x !== c);
      console.log(`   🗑  Dropped duplicate: ${c.id}  (kept: ${best.id} — ${best.durationInFrames}f)`);
    });
  }

  // ── Step 3: Sort by application workflow order ────────────────────────────
  allClips.sort((a, b) => workflowOrder(a.id) - workflowOrder(b.id));

  // ── Step 4: Build segments ────────────────────────────────────────────────
  console.log(`\n📊 Final video sequence (${allClips.length} clips):\n`);
  let cursor = 0;
  const segments: ResolvedSegment[] = allClips.map((clip, i) => {
    const def = SEGMENT_DEFS.find(d =>
      d.id === clip.id ||
      (d.keywords || []).some(k => clip.id.includes(k)),
    );
    const label    = def?.label    || idToLabel(clip.id);
    const subtitle = def?.subtitle || 'Application workflow';
    const accent   = def?.accent   || (i % 2 === 0 ? 'blue' : 'orange') as 'blue' | 'orange';
    const secs     = (clip.durationInFrames / FPS).toFixed(1);
    console.log(`   ${String(i + 1).padStart(2)}. [${clip.id.padEnd(20)}] ${secs.padStart(6)}s  ${label}`);

    const seg: ResolvedSegment = {
      id:               clip.id,
      sceneId:          'productDemo',
      label,
      subtitle,
      accent,
      keywords:         def?.keywords,
      manualOverride:   def?.manualOverride,
      zoomRegions:      def?.zoomRegions,
      clickHighlights:  def?.clickHighlights,
      resolvedClip:     clip,
      startFrame:       cursor,
      durationInFrames: clip.durationInFrames,
    };
    cursor += clip.durationInFrames;
    return seg;
  });

  const totalFrames = cursor;
  console.log(`\n   Total demo duration: ${(totalFrames / FPS).toFixed(1)}s (${totalFrames} frames)`);

  // ── Step 5: Write clipManifest.json ──────────────────────────────────────
  const manifest: ClipManifest = {
    generatedAt: new Date().toISOString(),
    fps:         FPS,
    clips:       allClips,
    segments,
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`\n📄 Updated: projects/${PROJECT_ID}/clipManifest.json`);

  // ── Step 6: Update videoConfig.json ──────────────────────────────────────
  const videoConfig = JSON.parse(fs.readFileSync(VIDEO_CFG_PATH, 'utf8'));
  const oldDur      = videoConfig.scenes.productDemo.durationInFrames as number;
  const delta       = totalFrames - oldDur;
  videoConfig.scenes.productDemo.durationInFrames = totalFrames;
  const ORDER = ['intro','problem','solution','productDemo','features','metrics','customerExperience','closing'];
  let past = false;
  for (const key of ORDER) {
    if (key === 'productDemo') { past = true; continue; }
    if (past) videoConfig.scenes[key].startFrame += delta;
  }
  videoConfig.video.durationInFrames += delta;
  fs.writeFileSync(VIDEO_CFG_PATH, JSON.stringify(videoConfig, null, 2));
  console.log(`🎬 Updated: src/config/videoConfig.json  (productDemo ${oldDur}→${totalFrames})`);
  console.log(`\n✅ Sync complete. Run npm run render.\n`);
}

main().catch(e => { console.error('\n💥', e.message ?? e); process.exit(1); });
