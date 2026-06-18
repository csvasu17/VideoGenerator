/**
 * register-broll-videos.ts
 *
 * Scans out/localhost/recordings/ for broll-0.mp4 … broll-4.mp4
 * and updates demo-package.json so each matching brollScene has a
 * videoPath pointing to the downloaded stock video.
 *
 * Run this after manually placing stock videos in the recordings folder.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json automation/register-broll-videos.ts
 */

import * as fs   from 'fs';
import * as path from 'path';

const ROOT           = path.resolve(__dirname, '..');
const RECORDINGS_DIR = path.join(ROOT, 'out', 'localhost', 'recordings');
const PKG_PATH       = path.join(ROOT, 'out', 'localhost', 'demo-package.json');

function fmt(bytes: number): string {
  return bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  📹  B-Roll Video Registrar');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (!fs.existsSync(PKG_PATH)) {
    console.error('  ❌  demo-package.json not found — run npm run record:enterprise first.\n');
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
  const brollScenes: { id: string; videoPath?: string; [k: string]: unknown }[] = pkg.brollScenes ?? [];

  let registered = 0;
  let missing    = 0;

  for (let i = 0; i < 5; i++) {
    const id       = `broll-${i}`;
    const filePath = path.join(RECORDINGS_DIR, `${id}.mp4`);
    const relPath  = `recordings/${id}.mp4`;

    if (fs.existsSync(filePath)) {
      const size  = fs.statSync(filePath).size;
      const scene = brollScenes.find(s => s.id === id);
      if (scene) {
        scene.videoPath = relPath;
        console.log(`  ✅  ${id}.mp4  (${fmt(size)}) — registered`);
        registered++;
      } else {
        console.log(`  ⚠️   ${id}.mp4 found but no matching scene in demo-package.json`);
      }
    } else {
      console.log(`  ⬜  ${id}.mp4 — not found (place it in out/localhost/recordings/)`);
      missing++;
    }
  }

  if (registered > 0) {
    fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2));
    console.log(`\n  📦  demo-package.json updated — ${registered} scene(s) now use real stock video`);
  }

  if (missing > 0) {
    console.log(`  ℹ️   ${missing} scene(s) still use the animated fallback`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

main();
