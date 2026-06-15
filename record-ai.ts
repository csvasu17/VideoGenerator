#!/usr/bin/env node
/**
 * record-ai.ts — Records ONLY the ai-predict clip using the same infrastructure as record.ts
 *
 * Usage:  npx ts-node --project tsconfig.json record-ai.ts
 */

import {chromium}    from 'playwright';
import * as path     from 'path';
import * as fs       from 'fs';
import * as dotenv   from 'dotenv';
import {recordProjectWorkflows} from './automation/workflow-recorder';

dotenv.config({path: path.resolve(__dirname, '.env'), override: true});

const ROOT           = path.resolve(__dirname);
const PROJECT_ID     = 'rheem';
const RECORDINGS_DIR = path.join(ROOT, 'public', 'projects', PROJECT_ID, 'recordings');
const MANIFEST_PATH  = path.join(ROOT, 'projects', PROJECT_ID, 'clipManifest.json');
const FPS            = 60;

async function main() {
  const APP_URL  = process.env.APP_URL ?? '';
  const USERNAME = process.env.APP_USERNAME ?? '';
  const PASSWORD = process.env.APP_PASSWORD ?? '';

  console.log(`\n🎬 Re-recording ai-predict clip only`);
  console.log(`   URL:  ${APP_URL}`);
  console.log(`   Out:  public/projects/${PROJECT_ID}/recordings/\n`);

  fs.mkdirSync(RECORDINGS_DIR, {recursive: true});

  // Load full workflows config and filter to just ai-predict
  const workflowsPath = path.join(ROOT, 'projects', PROJECT_ID, 'config', 'workflows');
  const mod      = require(workflowsPath);
  const wfConfig = mod.default ?? mod[Object.keys(mod).find(k => k.toLowerCase().includes('workflow')) ?? ''] ?? null;

  if (!wfConfig) {
    console.error('❌ Could not load workflows config');
    process.exit(1);
  }

  // Override credentials/url from env
  if (USERNAME) wfConfig.credentials = {...(wfConfig.credentials ?? {}), username: USERNAME};
  if (PASSWORD) wfConfig.credentials = {...(wfConfig.credentials ?? {}), password: PASSWORD};
  if (APP_URL)  wfConfig.appUrl = APP_URL;

  // Filter to ONLY the ai-predict clip
  const original = wfConfig.clips;
  const aiClip   = original.find((c: {id: string}) => c.id === 'ai-predict');
  if (!aiClip) {
    console.error('❌ ai-predict clip not found in workflows config');
    process.exit(1);
  }
  wfConfig.clips = [aiClip];

  const isHeadless = process.env.HEADLESS === '1' || process.env.CI === 'true';
  const browser    = await chromium.launch({headless: isHeadless, slowMo: isHeadless ? 30 : 60});

  let clips;
  try {
    clips = await recordProjectWorkflows(browser, wfConfig, RECORDINGS_DIR, FPS);
  } finally {
    await browser.close();
  }

  console.log(`\n✅ Recorded ${clips.length} clip(s)`);

  // Update manifest — merge with existing, overwriting just ai-predict
  const existing = fs.existsSync(MANIFEST_PATH)
    ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
    : {generatedAt: '', fps: FPS, clips: [], segments: []};

  const byId = new Map(existing.clips.map((c: {id: string}) => [c.id, c]));
  for (const c of clips) byId.set(c.id, c);

  const manifest = {
    ...existing,
    generatedAt: new Date().toISOString(),
    clips: Array.from(byId.values()),
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`📄 Updated manifest: projects/${PROJECT_ID}/clipManifest.json`);
  console.log(`\n➡️  Next: npm run sync\n`);
}

main().catch(e => { console.error('\n💥 Fatal:', e.message ?? e); process.exit(1); });
