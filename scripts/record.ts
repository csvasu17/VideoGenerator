#!/usr/bin/env node
/**
 * record.ts — Automated Playwright screen recorder for Rheem demo video.
 *
 * Usage:
 *   npm run record -- <APP_URL> [--user <u>] [--pass <p>] [--config <file>]
 *   npm run record -- https://app.example.com --user admin@co.com --pass secret
 *
 * Env vars (alternative to CLI flags):
 *   APP_URL, APP_USERNAME, APP_PASSWORD
 *
 * After recording, run: npm run sync
 */

import {chromium} from 'playwright';
import * as path  from 'path';
import * as fs    from 'fs';
import * as dotenv from 'dotenv';
import {autoExplore}    from './utils/explorer';
import {recordWorkflow} from './utils/browser';
import {getVideoInfo, durationToFrames} from './utils/ffprobe';
import type {RecordingConfig, ClipInfo, ClipManifest} from './types';

dotenv.config();

// ─── CLI ──────────────────────────────────────────────────────────────────────
const cliArgs = process.argv.slice(2);
function getFlag(flag: string): string | undefined {
  const i = cliArgs.indexOf(flag);
  return i !== -1 ? cliArgs[i + 1] : undefined;
}

const APP_URL   = cliArgs.find(a => a.startsWith('http')) ?? process.env.APP_URL ?? '';
const USERNAME  = getFlag('--user') ?? process.env.APP_USERNAME ?? '';
const PASSWORD  = getFlag('--pass') ?? process.env.APP_PASSWORD ?? '';
const CFG_FILE  = getFlag('--config');

if (!APP_URL) {
  console.error('\nUsage: npm run record -- <APP_URL> [--user <u>] [--pass <p>]\n');
  process.exit(1);
}

// ─── Paths ────────────────────────────────────────────────────────────────────
const ROOT           = path.resolve(__dirname, '..');
const RECORDINGS_DIR = path.join(ROOT, 'public', 'assets', 'recordings');
const MANIFEST_PATH  = path.join(ROOT, 'src', 'config', 'clipManifest.json');
const FPS            = 60;

// ─── Load optional recording.config.js ───────────────────────────────────────
let userConfig: Partial<RecordingConfig> = {};
const cfgCandidates = [
  CFG_FILE,
  path.join(ROOT, 'recording.config.js'),
].filter(Boolean) as string[];

for (const p of cfgCandidates) {
  if (fs.existsSync(p)) {
    userConfig = require(p);
    console.log(`📋 Loaded config: ${path.basename(p)}`);
    break;
  }
}

const config: RecordingConfig = {
  appUrl:      APP_URL,
  viewport:    {width: 1920, height: 1080},
  autoExplore: true,
  maxNavDepth: 2,
  ...userConfig,
  ...(USERNAME ? {
    credentials: {
      username: USERNAME,
      password: PASSWORD,
      ...(userConfig.credentials ?? {}),
    },
  } : {}),
};

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🎬 Rheem Playwright Recorder`);
  console.log(`   URL:    ${APP_URL}`);
  console.log(`   Output: public/assets/recordings/\n`);

  fs.mkdirSync(RECORDINGS_DIR, {recursive: true});

  const browser = await chromium.launch({headless: false, slowMo: 80});
  const clips: ClipInfo[] = [];

  try {
    // ── Step 1: Configured workflows ────────────────────────────────────────
    if (config.workflows?.length) {
      console.log(`\n📝 Running ${config.workflows.length} configured workflow(s)...\n`);
      for (const wf of config.workflows) {
        const clipFile = await recordWorkflow(browser, config, wf, RECORDINGS_DIR);
        if (!clipFile) continue;
        const info = getVideoInfo(clipFile);
        clips.push({
          id:               wf.id,
          file:             `assets/recordings/${path.basename(clipFile)}`,
          duration:         info.duration,
          durationInFrames: durationToFrames(info.duration, FPS),
          width:            info.width,
          height:           info.height,
          source:           'auto',
          capturedAt:       new Date().toISOString(),
        });
      }
    }

    // ── Step 2: Auto-exploration ─────────────────────────────────────────────
    if (config.autoExplore !== false) {
      const explored = await autoExplore(browser, config, RECORDINGS_DIR, FPS);
      for (const c of explored) {
        if (!clips.some(x => x.id === c.id)) clips.push(c);
      }
    }

  } finally {
    await browser.close();
  }

  console.log(`\n✅ Recorded ${clips.length} clip(s)\n`);

  // Persist clips list into manifest (segments resolved by sync.ts)
  const existing: ClipManifest = fs.existsSync(MANIFEST_PATH)
    ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
    : {generatedAt: '', fps: FPS, clips: [], segments: []};

  // Merge: keep existing manual clips, overwrite auto clips by id
  const merged = [
    ...existing.clips.filter(c => c.source === 'manual'),
    ...clips,
  ];
  // Dedupe by id (last wins)
  const byId = new Map(merged.map(c => [c.id, c]));

  const manifest: ClipManifest = {
    generatedAt: new Date().toISOString(),
    fps:         FPS,
    clips:       Array.from(byId.values()),
    segments:    existing.segments,  // sync.ts will update this
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log('📄 Updated: src/config/clipManifest.json');
  console.log('\n➡️  Next step: npm run sync\n');
}

main().catch(e => {
  console.error('\n💥 Fatal:', e.message ?? e);
  process.exit(1);
});
