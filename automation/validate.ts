#!/usr/bin/env node
/**
 * validate.ts — Check that all required clips exist before rendering.
 * Usage: npm run validate -- [project-id]
 * Exit 0 = all good, Exit 1 = missing required clips.
 */

import * as path from 'path';
import * as fs   from 'fs';

const PROJECT_ID = process.argv[2] || 'rheem';
const ROOT       = path.resolve(__dirname, '..');

function loadSegmentDefs(id: string) {
  const p = path.join(ROOT, 'projects', id, 'config', 'segmentDefs.js');
  const p2 = path.join(ROOT, 'projects', id, 'config', 'segmentDefs.ts');
  if (fs.existsSync(p))  return require(p).SEGMENT_DEFS || [];
  // ts-node context: require directly
  return require(path.join(ROOT, 'projects', id, 'config', 'segmentDefs')).SEGMENT_DEFS || [];
}

async function main() {
  console.log('Validating project: ' + PROJECT_ID + '\n');

  let defs: any[] = [];
  try { defs = loadSegmentDefs(PROJECT_ID); } catch (e) {
    console.error('Could not load segmentDefs:', (e as Error).message);
    process.exit(1);
  }

  const manifestPath = path.join(ROOT, 'projects', PROJECT_ID, 'clipManifest.json');
  let manifest: any = {clips:[], segments:[]};
  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  }

  let ok = true;
  for (const def of defs) {
    const segment = (manifest.segments || []).find((s: any) => s.id === def.id);
    if (segment?.resolvedClip) {
      const clipPath = path.join(ROOT, 'public', segment.resolvedClip.file);
      const exists = fs.existsSync(clipPath);
      console.log((exists ? 'OK  ' : 'MISS') + ' [' + def.id + '] ' + segment.resolvedClip.file);
      if (!exists) ok = false;
    } else {
      console.log('    [' + def.id + '] (placeholder — no clip)');
    }
  }

  console.log(ok ? '\nAll clips present.' : '\nMissing clips. Run npm run record -- ' + PROJECT_ID + ' first.');
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
