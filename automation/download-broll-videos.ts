/**
 * download-broll-videos.ts
 *
 * Downloads 5 royalty-free stock videos from Pexels (one per B-roll scene)
 * and updates demo-package.json so each brollScene has a videoPath.
 *
 * Uses PowerShell Invoke-WebRequest for all HTTP calls so it works on
 * corporate networks that use SSL inspection (uses the Windows cert store).
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json automation/download-broll-videos.ts
 *
 * Requires:
 *   PEXELS_API_KEY in .env  (free at https://www.pexels.com/api/)
 */

import * as fs            from 'fs';
import * as path          from 'path';
import * as os            from 'os';
import * as dotenv        from 'dotenv';
import { execSync }       from 'child_process';
import { OUT_DIR }        from './config';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

// ─── Config ───────────────────────────────────────────────────────────────────

const PEXELS_API_KEY  = process.env['PEXELS_API_KEY'] ?? '';
const RECORDINGS_DIR  = path.join(OUT_DIR, 'recordings');
const PKG_PATH        = path.join(OUT_DIR, 'demo-package.json');

const BROLL_QUERIES: { id: string; query: string }[] = [
  { id: 'broll-0', query: 'customer support agent office working'      },
  { id: 'broll-1', query: 'stressed worker deadline office'             },
  { id: 'broll-2', query: 'team collaboration meeting office'           },
  { id: 'broll-3', query: 'technology artificial intelligence computer' },
  { id: 'broll-4', query: 'business analytics dashboard office'         },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface PexelsVideoFile {
  link:    string;
  width:   number;
  height:  number;
  quality: string;
}

interface PexelsVideo {
  id:          number;
  video_files: PexelsVideoFile[];
}

interface PexelsSearchResponse {
  videos: PexelsVideo[];
}

/** Run a PowerShell script written to a temp file — avoids all inline quoting issues. */
function runPS(script: string, timeoutMs = 60000): string {
  const tmp = path.join(os.tmpdir(), `broll-${Date.now()}.ps1`);
  fs.writeFileSync(tmp, script, 'utf-8');
  try {
    return execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmp}"`,
      { encoding: 'utf-8', timeout: timeoutMs },
    );
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

/** Call Pexels API via PowerShell (uses Windows cert store — safe on corporate networks). */
function pexelsSearch(query: string): PexelsVideo | null {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape&size=medium`;
  const script = [
    `$r = Invoke-WebRequest -Uri '${url}' -Headers @{Authorization='${PEXELS_API_KEY}'} -UseBasicParsing`,
    `Write-Output $r.Content`,
  ].join('\n');
  const raw  = runPS(script, 30000);
  const data: PexelsSearchResponse = JSON.parse(raw.trim());
  return data.videos?.[0] ?? null;
}

/** Pick highest-quality landscape file. */
function pickBestFile(files: PexelsVideoFile[]): PexelsVideoFile | null {
  const hd = files.find(f => f.quality === 'hd' && f.width >= 1280);
  if (hd) return hd;
  const sd = files.find(f => f.width >= 854);
  return sd ?? files[0] ?? null;
}

/** Download a file via PowerShell Invoke-WebRequest. */
function downloadFile(url: string, destPath: string): void {
  const script = `Invoke-WebRequest -Uri '${url}' -OutFile '${destPath}' -UseBasicParsing`;
  runPS(script, 120000);
}

function fmt(bytes: number): string {
  return bytes > 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(0)} KB`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  📹  B-Roll Stock Video Downloader (Pexels)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (!PEXELS_API_KEY) {
    console.error('  ❌  PEXELS_API_KEY is not set in .env');
    console.error('      Get a free key at https://www.pexels.com/api/\n');
    process.exit(1);
  }

  if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  }

  if (!fs.existsSync(PKG_PATH)) {
    console.error(`  ❌  demo-package.json not found — run npm run record:enterprise first.\n`);
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
  const brollScenes: { id: string; videoPath?: string; [k: string]: unknown }[] = pkg.brollScenes ?? [];

  let downloaded = 0;

  for (const { id, query } of BROLL_QUERIES) {
    const destFile = path.join(RECORDINGS_DIR, `${id}.mp4`);
    const relPath  = `recordings/${id}.mp4`;

    process.stdout.write(`  [${id}]  Searching "${query}" … `);

    try {
      const video = pexelsSearch(query);
      if (!video) { console.log('no results — skipped'); continue; }

      const file = pickBestFile(video.video_files);
      if (!file)  { console.log('no suitable file — skipped'); continue; }

      process.stdout.write(`found #${video.id} (${file.width}×${file.height}) — downloading … `);
      downloadFile(file.link, destFile);

      const size = fs.statSync(destFile).size;
      console.log(`done  (${fmt(size)})`);
      downloaded++;

      const scene = brollScenes.find(s => s.id === id);
      if (scene) scene.videoPath = relPath;

    } catch (err) {
      console.log(`error — ${(err as Error).message?.slice(0, 120)}`);
    }
  }

  if (downloaded > 0) {
    fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2));
    console.log(`\n  ✅  ${downloaded} video(s) downloaded`);
    console.log(`  📦  demo-package.json updated with videoPath fields\n`);
  } else {
    console.log('\n  ⚠️   No videos downloaded.\n');
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main();
