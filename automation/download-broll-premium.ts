/**
 * download-broll-premium.ts
 *
 * Reads pexelsQueries from each brollScene in demo-package.json, fetches
 * 15 candidates per query on Pexels, picks the best Full-HD (≥1920px) clip,
 * downloads to out/<slug>/recordings/broll-N.mp4, and patches
 * demo-package.json with the correct videoPath ("recordings/broll-N.mp4").
 *
 * Usage:
 *   npm run broll:premium
 */

import * as fs         from 'fs';
import * as path       from 'path';
import * as os         from 'os';
import * as dotenv     from 'dotenv';
import { execSync }    from 'child_process';
import { OUT_DIR }     from './config';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

const PEXELS_API_KEY = process.env['PEXELS_API_KEY'] ?? '';
const REC_DIR        = path.join(OUT_DIR, 'recordings');
const PKG_PATH       = path.join(OUT_DIR, 'demo-package.json');

// ─── Pexels types ─────────────────────────────────────────────────────────
interface VideoFile {
  id:      number;
  link:    string;
  width:   number;
  height:  number;
  quality: string;
  fps:     number;
}
interface PexelsVideo {
  id:          number;
  duration:    number;
  video_files: VideoFile[];
}
interface SearchResponse {
  videos:    PexelsVideo[];
  total_results: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function runPS(script: string, timeoutMs = 60_000): string {
  const tmp = path.join(os.tmpdir(), `broll-ps-${Date.now()}.ps1`);
  fs.writeFileSync(tmp, script, 'utf-8');
  try {
    return execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmp}"`, {
      encoding: 'utf-8',
      timeout: timeoutMs,
    });
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function pexelsSearch(query: string): PexelsVideo[] {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=15&orientation=landscape&size=large`;
  const script = [
    `$r = Invoke-WebRequest -Uri '${url}' -Headers @{Authorization='${PEXELS_API_KEY}'} -UseBasicParsing`,
    `Write-Output $r.Content`,
  ].join('\n');
  try {
    const raw: SearchResponse = JSON.parse(runPS(script, 30_000).trim());
    return raw.videos ?? [];
  } catch {
    return [];
  }
}

/** Pick best file: prefer 4K → 1080p → 720p. Avoid files narrower than 1280px. */
function pickBestFile(files: VideoFile[]): VideoFile | null {
  const sorted = [...files]
    .filter(f => f.width >= 1280 && f.height >= 720)
    .sort((a, b) => (b.width * b.height) - (a.width * a.height));
  // Prefer 1920px+ (true HD) but accept 1280px if nothing better
  return sorted[0] ?? null;
}

/** Score a candidate video: prefer ≥1920px, 10-30s clips, 30fps. */
function score(video: PexelsVideo, file: VideoFile): number {
  let s = 0;
  if (file.width >= 3840) s += 30;   // 4K
  else if (file.width >= 1920) s += 20; // Full HD
  else if (file.width >= 1280) s += 10; // HD
  if (video.duration >= 10 && video.duration <= 30) s += 15;
  else if (video.duration < 10) s += 5;
  if (file.fps >= 29) s += 5;
  return s;
}

function downloadFile(url: string, dest: string): void {
  const script = `Invoke-WebRequest -Uri '${url}' -OutFile '${dest}' -UseBasicParsing`;
  runPS(script, 180_000);
}

function fmt(bytes: number): string {
  return bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

// ─── Main ─────────────────────────────────────────────────────────────────
function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  📹  B-Roll Premium Downloader  (Pexels)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (!PEXELS_API_KEY) {
    console.error('  ❌  PEXELS_API_KEY not set in .env'); process.exit(1);
  }
  if (!fs.existsSync(PKG_PATH)) {
    console.error('  ❌  demo-package.json not found'); process.exit(1);
  }

  fs.mkdirSync(REC_DIR, { recursive: true });

  interface BrollScene {
    id:           string;
    subtitle?:    string;
    videoPath?:   string;
    pexelsQueries?: string[];
  }

  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8').replace(/^﻿/, ''));
  const brollScenes: BrollScene[] = pkg.brollScenes ?? [];

  if (!brollScenes.length) {
    console.error('  ❌  No brollScenes in demo-package.json'); process.exit(1);
  }

  let downloaded = 0;

  for (const scene of brollScenes) {
    const queries: string[] = scene.pexelsQueries ?? [];
    if (!queries.length) {
      console.log(`\n  ⚠️   ${scene.id}  — no pexelsQueries defined, skipping`);
      continue;
    }

    const theme = { id: scene.id, subtitle: scene.subtitle ?? '', queries };
    console.log(`\n  ▶  ${theme.id}  "${theme.subtitle}"`);

    let bestVideo: PexelsVideo | null = null;
    let bestFile:  VideoFile   | null = null;
    let bestScore  = -1;
    let usedQuery  = '';

    for (const query of theme.queries) {
      process.stdout.write(`     Query: "${query}" … `);
      const videos = pexelsSearch(query);
      if (!videos.length) { console.log('no results'); continue; }

      for (const v of videos) {
        const f = pickBestFile(v.video_files);
        if (!f) continue;
        const s = score(v, f);
        if (s > bestScore) { bestScore = s; bestVideo = v; bestFile = f; usedQuery = query; }
      }

      const found = videos.filter(v => (pickBestFile(v.video_files)?.width ?? 0) >= 1920).length;
      console.log(`${videos.length} results, ${found} Full-HD`);

      // Stop after first query that has a Full-HD result
      if (bestFile && bestFile.width >= 1920) break;
    }

    if (!bestVideo || !bestFile) {
      console.log(`     ⚠️   No suitable video found — keeping existing`);
      continue;
    }

    const dest    = path.join(REC_DIR, `${theme.id}.mp4`);
    const relPath = `recordings/${theme.id}.mp4`;

    console.log(`     ✅  Pexels #${bestVideo.id}  ${bestFile.width}×${bestFile.height}  ${bestVideo.duration}s  score=${bestScore}`);
    console.log(`         Query: "${usedQuery}"`);
    process.stdout.write(`         Downloading … `);

    try {
      downloadFile(bestFile.link, dest);
      const size = fs.statSync(dest).size;
      console.log(`done  (${fmt(size)})`);
      downloaded++;

      scene.videoPath = relPath;

    } catch (err) {
      console.log(`FAILED: ${(err as Error).message?.slice(0, 100)}`);
    }
  }

  // Always fix any remaining brollScenes that still point to assets/broll/
  // to use recordings/ path (the correct public-dir location).
  let pathsFixed = 0;
  for (const scene of brollScenes) {
    if (scene.videoPath?.startsWith('assets/broll/')) {
      const corrected = scene.videoPath.replace('assets/broll/', 'recordings/');
      const absPath   = path.join(REC_DIR, path.basename(corrected));
      if (fs.existsSync(absPath)) {
        console.log(`\n  🔧  Fixed path: ${scene.id}  assets/broll/ → recordings/`);
        scene.videoPath = corrected;
        pathsFixed++;
      }
    }
  }

  if (downloaded > 0 || pathsFixed > 0) {
    fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2), 'utf-8');
    console.log(`\n  ✅  ${downloaded} new video(s) downloaded`);
    if (pathsFixed) console.log(`  🔧  ${pathsFixed} videoPath(s) corrected`);
    console.log(`  📦  demo-package.json updated\n`);
  } else {
    console.log('\n  ⚠️   Nothing changed.\n');
  }

  console.log('  Next step: npm run render:demo && ffmpeg merge\n');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main();
