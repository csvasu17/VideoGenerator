#!/usr/bin/env node
/**
 * record.ts — Playwright recorder with two modes:
 *
 *   --mode workflows   (DEFAULT) — executes the project's WorkflowClip definitions.
 *                                  Precise, repeatable, demo-quality recordings.
 *
 *   --mode explore     — auto-discovers pages by reading DOM hrefs.
 *                        Use when you don't have workflow definitions yet.
 *
 * Usage:
 *   npm run record                  # workflow mode for rheem
 *   npm run record:explore          # explore mode for rheem
 *   npm run record -- --project myapp
 *
 * Env: APP_URL, APP_USERNAME, APP_PASSWORD (or pass --user / --pass flags)
 */

import {chromium}    from 'playwright';
import * as path     from 'path';
import * as fs       from 'fs';
import * as dotenv   from 'dotenv';
import {recordProjectWorkflows} from './workflow-recorder';
import {autoExplore}            from './utils/explorer';
import {getVideoInfo, durationToFrames} from './utils/ffprobe';
import type {RecordingConfig, ClipInfo, ClipManifest} from './types';

dotenv.config({path: path.resolve(__dirname, '../.env'), override: true});

// ─── CLI ──────────────────────────────────────────────────────────────────────
const cliArgs = process.argv.slice(2);
function getFlag(f: string): string | undefined {
  const i = cliArgs.indexOf(f); return i !== -1 ? cliArgs[i + 1] : undefined;
}

const PROJECT_ID = getFlag('--project') || 'rheem';
const MODE       = getFlag('--mode') || 'workflows';   // 'workflows' | 'explore'
const APP_URL    = cliArgs.find(a => a.startsWith('http')) ?? process.env.APP_URL ?? '';
const USERNAME   = getFlag('--user') ?? process.env.APP_USERNAME ?? '';
const PASSWORD   = getFlag('--pass') ?? process.env.APP_PASSWORD ?? '';

const ROOT           = path.resolve(__dirname, '..');
const RECORDINGS_DIR = path.join(ROOT, 'public', 'projects', PROJECT_ID, 'recordings');
const MANIFEST_PATH  = path.join(ROOT, 'projects', PROJECT_ID, 'clipManifest.json');
const FPS            = 60;

// ─── Load project workflows config ────────────────────────────────────────────
function loadWorkflows() {
  const workflowsPath = path.join(ROOT, 'projects', PROJECT_ID, 'config', 'workflows');
  try {
    const mod = require(workflowsPath);
    // Support default export or named export matching projectId
    return mod.default
      ?? mod[Object.keys(mod).find(k => k.toLowerCase().includes('workflow')) ?? '']
      ?? null;
  } catch {
    return null;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🎬 Rheem Recorder — project: ${PROJECT_ID}  mode: ${MODE}`);
  console.log(`   URL:  ${APP_URL || '(from .env)'}`);
  console.log(`   User: ${USERNAME || '(from .env)'}`);
  console.log(`   Pass: ${PASSWORD ? PASSWORD.slice(0,2) + '*'.repeat(Math.max(0, PASSWORD.length-2)) : '(from .env)'}`);
  console.log(`   Out:  public/projects/${PROJECT_ID}/recordings/\n`);

  fs.mkdirSync(RECORDINGS_DIR, {recursive: true});

  const isHeadless = process.env.HEADLESS === '1' || process.env.CI === 'true';
  const browser    = await chromium.launch({headless: isHeadless, slowMo: isHeadless ? 30 : 60});
  let clips: ClipInfo[] = [];

  try {
    if (MODE === 'workflows') {
      // ── Workflow mode: execute precise WorkflowClip definitions ─────────────
      const wfConfig = loadWorkflows();
      if (!wfConfig) {
        console.error(`❌ No workflows.ts found at projects/${PROJECT_ID}/config/workflows.ts`);
        console.error(`   Create one or use --mode explore for auto-discovery.`);
        process.exit(1);
      }
      // Inject runtime credentials from .env (config may have empty strings as defaults)
      if (USERNAME) wfConfig.credentials = {...(wfConfig.credentials ?? {}), username: USERNAME};
      if (PASSWORD) wfConfig.credentials = {...(wfConfig.credentials ?? {}), password: PASSWORD};
      if (APP_URL)  wfConfig.appUrl = APP_URL;

      clips = await recordProjectWorkflows(browser, wfConfig, RECORDINGS_DIR, FPS);

    } else {
      // ── Explore mode: auto-discover pages from DOM hrefs ─────────────────────
      if (!APP_URL) {
        console.error('\nExplore mode requires APP_URL. Set it in .env or pass as first argument.\n');
        process.exit(1);
      }
      const exploreConfig: RecordingConfig = {
        appUrl:      APP_URL,
        viewport:    {width: 1920, height: 1080},
        autoExplore: true,
        credentials: USERNAME ? {username: USERNAME, password: PASSWORD} : undefined,
      };
      clips = await autoExplore(browser, exploreConfig, RECORDINGS_DIR, FPS);
    }

  } finally {
    await browser.close();
  }

  console.log(`\n✅ Recorded ${clips.length} clip(s)`);

  // ── Update manifest ────────────────────────────────────────────────────────
  const existing: ClipManifest = fs.existsSync(MANIFEST_PATH)
    ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8').replace(/^﻿/, ''))  // strip UTF-8 BOM if present
    : {generatedAt: '', fps: FPS, clips: [], segments: []};

  const merged = [
    ...existing.clips.filter(c => c.source === 'manual'),
    ...clips,
  ];
  const byId = new Map(merged.map(c => [c.id, c]));

  const manifest: ClipManifest = {
    generatedAt: new Date().toISOString(),
    fps:         FPS,
    clips:       Array.from(byId.values()),
    segments:    existing.segments,
  };
  fs.mkdirSync(path.dirname(MANIFEST_PATH), {recursive: true});
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`📄 Updated manifest: projects/${PROJECT_ID}/clipManifest.json`);
  console.log(`\n➡️  Next: npm run sync\n`);
}

main().catch(e => { console.error('\n💥 Fatal:', e.message ?? e); process.exit(1); });
