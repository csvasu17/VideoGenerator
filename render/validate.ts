#!/usr/bin/env node
/**
 * validate.ts — Verify all required clips are present before rendering.
 * Usage: npm run validate           (validates 'rheem' project)
 *        npm run validate -- <id>   (validates specific project)
 */

import * as path from 'path';
import * as fs   from 'fs';

const PROJECT_ID = process.argv[2] || 'rheem';
const ROOT       = path.resolve(__dirname, '..');
const PUBLIC     = path.join(ROOT, 'public');

async function main() {
  console.log('Validating project: ' + PROJECT_ID);

  let SEGMENT_DEFS: any[] = [];
  try {
    const mod = require('../projects/' + PROJECT_ID + '/config/segmentDefs');
    SEGMENT_DEFS = mod.SEGMENT_DEFS || [];
  } catch (e) {
    console.error('Cannot load segmentDefs for project ' + PROJECT_ID);
    process.exit(1);
  }

  const manifestPath = path.join(ROOT, 'projects', PROJECT_ID, 'clipManifest.json');
  let manifest: any = {clips:[], segments:[]};
  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  }

  let allOk = true;
  const pad = (s: string, n: number) => s.padEnd(n);

  console.log('');
  console.log(pad('SEGMENT', 20) + pad('CLIP FILE', 50) + 'STATUS');
  console.log('-'.repeat(80));

  for (const def of SEGMENT_DEFS) {
    const seg = (manifest.segments || []).find((s: any) => s.id === def.id);
    if (seg?.resolvedClip?.file) {
      const fullPath = path.join(PUBLIC, seg.resolvedClip.file);
      const exists = fs.existsSync(fullPath);
      if (!exists) allOk = false;
      console.log(pad('[' + def.id + ']', 20) + pad(seg.resolvedClip.file, 50) + (exists ? 'OK' : 'MISSING'));
    } else {
      console.log(pad('[' + def.id + ']', 20) + pad('(no clip — placeholder)', 50) + 'PLACEHOLDER');
    }
  }

  console.log('');
  if (allOk) {
    console.log('All clips ready. Run: npm run render');
  } else {
    console.log('Missing clips. Run: npm run record -- ' + PROJECT_ID);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
