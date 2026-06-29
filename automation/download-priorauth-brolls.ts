/**
 * download-priorauth-brolls.ts
 *
 * Downloads 5 diverse, healthcare-specific stock videos from Pexels
 * for the Prior Auth product broll scenes and updates demo-package.json.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json automation/download-priorauth-brolls.ts
 */

import * as fs      from 'fs';
import * as path    from 'path';
import * as os      from 'os';
import * as dotenv  from 'dotenv';
import { execSync } from 'child_process';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

const PEXELS_KEY   = process.env['PEXELS_API_KEY'] ?? '';
const PKG_PATH     = path.resolve(__dirname, '../out/priorauth/demo-package.json');
const REC_DIR      = path.resolve(__dirname, '../out/priorauth/recordings');

// 5 distinct healthcare PA queries — each will return a different video
const QUERIES: { id: string; query: string; label: string }[] = [
  { id: 'broll-0', query: 'medical paperwork hospital administration',      label: 'Medical admin paperwork' },
  { id: 'broll-1', query: 'doctor reviewing patient records clinical',      label: 'Doctor reviewing records' },
  { id: 'broll-2', query: 'insurance health coverage forms',                label: 'Insurance/payer forms' },
  { id: 'broll-3', query: 'healthcare technology computer hospital nurse',  label: 'Clinical tech / EHR' },
  { id: 'broll-4', query: 'medical team meeting hospital approval',         label: 'Clinical team collaboration' },
];

interface PexelsFile { link: string; width: number; height: number; quality: string; }
interface PexelsVideo { id: number; video_files: PexelsFile[]; }
interface PexelsResp  { videos: PexelsVideo[]; }

function runPS(script: string, timeoutMs = 90_000): string {
  const tmp = path.join(os.tmpdir(), `pa-broll-${Date.now()}.ps1`);
  fs.writeFileSync(tmp, script, 'utf-8');
  try {
    return execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmp}"`, {
      encoding: 'utf-8', timeout: timeoutMs,
    });
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function pexelsSearch(query: string, page = 1): PexelsVideo[] {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=8&page=${page}&orientation=landscape&size=medium`;
  const raw = runPS([
    `$r = Invoke-WebRequest -Uri '${url}' -Headers @{Authorization='${PEXELS_KEY}'} -UseBasicParsing`,
    `Write-Output $r.Content`,
  ].join('\n'), 30_000);
  const data: PexelsResp = JSON.parse(raw.trim());
  return data.videos ?? [];
}

function pickFile(files: PexelsFile[]): PexelsFile | null {
  return files.find(f => f.quality === 'hd' && f.width >= 1280)
    ?? files.find(f => f.width >= 854)
    ?? files[0]
    ?? null;
}

function downloadFile(url: string, dest: string): void {
  // Download to a .tmp file first so a locked destination doesn't block us
  const tmp = dest + '.tmp';
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  runPS(`Invoke-WebRequest -Uri '${url}' -OutFile '${tmp.replace(/\\/g, '\\\\')}' -UseBasicParsing`, 180_000);
  if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 10_000) {
    throw new Error('Download produced no file or file too small — check Pexels key');
  }
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  fs.renameSync(tmp, dest);
}

function fmt(n: number) { return n > 1e6 ? `${(n/1e6).toFixed(1)} MB` : `${(n/1024).toFixed(0)} KB`; }

// Track used video IDs to avoid duplicate footage
const usedIds = new Set<number>();

async function main() {
  console.log('\n' + '═'.repeat(63));
  console.log('  📹  Prior Auth Broll Downloader (Pexels)');
  console.log('═'.repeat(63) + '\n');

  if (!PEXELS_KEY) { console.error('  ✗  PEXELS_API_KEY not set in .env'); process.exit(1); }
  if (!fs.existsSync(PKG_PATH)) { console.error(`  ✗  Not found: ${PKG_PATH}`); process.exit(1); }

  fs.mkdirSync(REC_DIR, { recursive: true });

  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
  const brolls: any[] = pkg.brollScenes ?? [];

  let downloaded = 0;

  for (const { id, query, label } of QUERIES) {
    const dest    = path.join(REC_DIR, `${id}.mp4`);
    const relPath = `recordings/${id}.mp4`;

    console.log(`  ── ${id}  "${label}"`);
    process.stdout.write(`     Searching Pexels… `);

    try {
      // Search and skip videos we already used (to guarantee all 5 are different)
      let picked: PexelsVideo | null = null;
      for (let page = 1; page <= 3 && !picked; page++) {
        const results = pexelsSearch(query, page);
        picked = results.find(v => !usedIds.has(v.id)) ?? null;
      }
      if (!picked) { console.log('no unique result — skipped'); continue; }

      const file = pickFile(picked.video_files);
      if (!file)  { console.log('no suitable file — skipped'); continue; }

      usedIds.add(picked.id);
      process.stdout.write(`video #${picked.id} (${file.width}×${file.height}) → downloading… `);

      downloadFile(file.link, dest);

      const size = fs.statSync(dest).size;
      console.log(`done (${fmt(size)})`);

      const scene = brolls.find(b => b.id === id);
      if (scene) {
        scene.videoPath = relPath;
        delete scene.animationType;
      }
      downloaded++;
    } catch (err: any) {
      console.log(`error — ${err.message?.slice(0, 100) ?? err}`);
    }
  }

  if (downloaded > 0) {
    fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2));
    console.log(`\n  ✓  ${downloaded}/5 videos downloaded`);
    console.log('  ✓  demo-package.json updated with videoPath\n');
  } else {
    console.log('\n  ⚠  No videos downloaded.\n');
  }

  console.log('═'.repeat(63));
  console.log('  Reload Remotion Studio to preview, then:');
  console.log('  npm run render:demo -- --input out/priorauth/demo-package.json');
  console.log('═'.repeat(63) + '\n');
}

main().catch(e => { console.error(e); process.exit(1); });
