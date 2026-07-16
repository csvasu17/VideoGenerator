/**
 * record-agent-exhaustive.ts — Agent Recording: an AI-driven Playwright agent that
 * exhaustively clicks every safe button and fills every safe form field across every
 * screen, for EVERY configured role automatically, recording one continuous video per
 * role and assembling them into a single narrated walkthrough.
 *
 * Safety is mandatory, not optional (see automation/utils/interactionSafety.ts's header
 * comment for why): every element is classified before being touched, and anything
 * matching a destructive-action pattern (delete/logout/pay/submit/etc.) — or any form
 * submit button — is skipped by default and logged to agent-safety-report.json, never
 * clicked. Escape hatches: AGENT_SAFETY_DENYLIST_EXTRA / AGENT_SAFETY_ALLOWLIST_EXTRA
 * (JSON string arrays in .env) let an operator tune per-app after reviewing a first run.
 *
 * Role discovery is automatic — every distinct role token mentioned across
 * APP_ROUTE_MAP is looped, not just each route's first-listed (primary) role. Not
 * every mentioned role necessarily has a real Quick Access card (falls back to the
 * default account) — this is surfaced per-role in agent-safety-report.json and on the
 * role-transition title card itself, never silently mislabeled.
 *
 * Visual assembly is intentionally NOT run through Remotion for the bulk footage —
 * this is already real, continuous, chronologically-ordered screen capture, so there's
 * no discrete "scene" to cut or camera-pan over the way synthetic templates need.
 * Remotion is used only for a few seconds of role-transition title cards; the walkthrough
 * itself is ffmpeg-concatenated (-c copy, never re-encoded) between them.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json automation/record-agent-exhaustive.ts [--narrate]
 *
 * Output:
 *   out/<slug>/agent-recording/flow-agent-<role>.mp4   — one continuous video per role
 *   out/<slug>/agent-recording/agent-walkthrough.mp4   — all roles concatenated with title cards
 *   out/<slug>/agent-recording/agent-walkthrough-with-voice.mp4  — with --narrate
 *   out/<slug>/agent-safety-report.json
 */

import { chromium } from 'playwright';
import type { BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { execSync } from 'child_process';
import { OUT_DIR, ROOT, toSlug } from './config';
import { acquireSession } from './utils/multiRoleAuth';
import type { MultiRoleAuthConfig } from './utils/multiRoleAuth';
import { discoverAllRoles } from './utils/roleLabel';
import { runAgentPageLoop } from './utils/agentInteractionLoop';
import type { AgentPageResult } from './utils/agentInteractionLoop';
import { buildAgentRunReport, printAgentSafetyReport } from './utils/agentSafetyReport';
import type { RoleFootageNote } from './utils/agentSafetyReport';
import { DiscoveryAgent } from '../src/agents/discovery/DiscoveryAgent';
import type { DiscoveredPage } from '../src/core/domain/entities/DiscoveredPage';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

// ─── Config ───────────────────────────────────────────────────────────────────

const APP_URL      = (process.env['APP_URL'] ?? 'http://localhost:3000').replace(/\/$/, '');
const LOGIN_TYPE    = (process.env['LOGIN_TYPE'] === '2' ? '2' : '1') as '1' | '2';
const APP_USERNAME  = process.env['APP_USERNAME'] ?? '';
const APP_PASSWORD  = process.env['APP_PASSWORD'] ?? '';
const APP_LOGIN_PATH = (process.env['APP_LOGIN_PATH'] ?? '/login').replace(/^\//, '');
const LOGIN_URL = APP_LOGIN_PATH
  ? `${APP_URL}/${APP_LOGIN_PATH}`
  : `${APP_URL}/`;
const PRODUCT_NAME = process.env['APP_PRODUCT_NAME'] || (() => {
  try { return new URL(APP_URL).hostname; } catch { return 'Product'; }
})();

const MAX_PAGES_PER_ROLE  = Number(process.env['AGENT_MAX_PAGES_PER_ROLE'] ?? '25');
const MAX_ELEMENTS_PER_PAGE = Number(process.env['AGENT_MAX_ELEMENTS_PER_PAGE'] ?? '150');
const NARRATE = process.argv.includes('--narrate');

const VIEWPORT = { width: 1920, height: 1080 };
const FPS = 30;

const APP_ROUTE_MAP_RAW = process.env['APP_ROUTE_MAP'] ?? '{}';
let routeMap: Record<string, string> = {};
try { if (APP_ROUTE_MAP_RAW) routeMap = JSON.parse(APP_ROUTE_MAP_RAW); } catch { /* proceed with no route map */ }

const AGENT_DIR       = path.join(OUT_DIR, 'agent-recording');
const SCREENSHOT_DIR  = path.join(AGENT_DIR, 'screenshots');
const REPORT_PATH     = path.join(OUT_DIR, 'agent-safety-report.json');
const WALKTHROUGH_PATH = path.join(AGENT_DIR, 'agent-walkthrough.mp4');

fs.mkdirSync(AGENT_DIR, { recursive: true });
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const authConfig: MultiRoleAuthConfig = {
  appUrl: APP_URL, loginUrl: LOGIN_URL, loginType: LOGIN_TYPE,
  username: APP_USERNAME, password: APP_PASSWORD, viewport: VIEWPORT,
  tmpDir: path.resolve(__dirname, '../.tmp'), routeMap,
};

// ─── ffmpeg binary (Remotion's bundled copy, same discovery pattern as generate-voice.ts) ──

function findFfmpegBin(): string {
  const candidates = [
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-win32-x64-msvc', 'ffmpeg.exe'),
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-darwin-arm64',   'ffmpeg'),
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-darwin-x64',     'ffmpeg'),
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-linux-x64-gnu',  'ffmpeg'),
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-linux-arm64-gnu', 'ffmpeg'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('Could not find Remotion bundled ffmpeg. Run `npm install` then try again.');
}

// ─── Per-role recording ─────────────────────────────────────────────────────────

interface RoleRecordingResult {
  role:            string;
  videoPath:       string | null;
  pageResults:     AgentPageResult[];
  footageNote:     RoleFootageNote;
}

async function recordRole(
  browser: import('playwright').Browser,
  role:    string,
): Promise<RoleRecordingResult> {
  const recDir = path.join(AGENT_DIR, `_tmp_${toSlug(role)}`);
  fs.mkdirSync(recDir, { recursive: true });

  console.log(`\n  🎭  Role: ${role}`);
  const acquired = await acquireSession(browser as any, recDir, authConfig, { roleName: role });

  if (!acquired) {
    console.error(`  ✗  Could not establish a session for role "${role}" — skipping.`);
    return {
      role, videoPath: null, pageResults: [],
      footageNote: { role, quickAccessMatch: 'login-failed', detail: 'could not log in for this role at all' },
    };
  }

  const { session, liveCtx, roleMatchConfidence } = acquired;
  const footageNote: RoleFootageNote = {
    role,
    quickAccessMatch: roleMatchConfidence,
    detail: roleMatchConfidence === 'matched'
      ? 'Quick Access card matched this role'
      : roleMatchConfidence === 'fallback-default-card'
        ? 'no Quick Access card matched — recorded under the default demo account'
        : 'not applicable to this login type',
  };

  const t0 = Date.now();
  const page: Page = await liveCtx.newPage();
  await page.goto(session.postLoginUrl, { waitUntil: 'domcontentloaded', timeout: 40_000 }).catch(() => {});
  await page.waitForTimeout(1500);

  console.log(`     Crawling pages for "${role}" (maxPages=${MAX_PAGES_PER_ROLE})…`);
  const discovered: DiscoveredPage[] = await new DiscoveryAgent().discover(APP_URL, liveCtx as BrowserContext, {
    maxDepth: 3,
    maxPages: MAX_PAGES_PER_ROLE,
    seedUrls: Object.keys(routeMap),
  });
  console.log(`     Discovered ${discovered.length} page(s) for "${role}"`);

  // Multiple originally-distinct routes can land on the SAME real screen — typically
  // a route gated to a role this account doesn't have, silently redirected (client-side)
  // back to a default page. DiscoveredPage.url already reflects the POST-redirect
  // landing URL, so a simple final-URL dedup catches every case regardless of which
  // route(s) fed into it (confirmed live against this exact app: without it, a role
  // with no matching Quick Access card re-visits and re-interacts with its fallback
  // landing page once per redirected route, wasting time and producing repetitive footage).
  const seenFinalUrls = new Set<string>();
  const pageResults: AgentPageResult[] = [];
  for (const dp of discovered) {
    const normalizedUrl = dp.url.replace(/\/$/, '');
    if (seenFinalUrls.has(normalizedUrl)) {
      const via = dp.redirectedFrom ? ` (redirected from ${dp.redirectedFrom})` : '';
      console.log(`     ↳ skipping duplicate screen at ${dp.url}${via} — same page already visited`);
      continue;
    }
    seenFinalUrls.add(normalizedUrl);

    console.log(`     → ${dp.url}`);
    const result = await runAgentPageLoop(page, dp.id, dp.url, role, t0, {
      screenshotDir: SCREENSHOT_DIR, maxElements: MAX_ELEMENTS_PER_PAGE,
    });
    pageResults.push(result);
    console.log(`       ${result.elementsFound} elements | ${result.clicked} clicked | ${result.filled} filled | ${result.skipped.length} skipped`);
  }

  const vidRaw = await page.video()?.path();
  await page.close();
  await liveCtx.close();

  let videoPath: string | null = null;
  if (vidRaw && fs.existsSync(vidRaw)) {
    videoPath = path.join(AGENT_DIR, `flow-agent-${toSlug(role)}.mp4`);
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    fs.renameSync(vidRaw, videoPath);
    console.log(`     💾  Saved flow-agent-${toSlug(role)}.mp4`);
  } else {
    console.warn(`     ⚠️  No video produced for role "${role}"`);
  }
  fs.rmSync(recDir, { recursive: true, force: true });

  return { role, videoPath, pageResults, footageNote };
}

// ─── Role-transition title cards + final assembly ──────────────────────────────

async function renderRoleTransitionCard(role: string, roleIndex: number, totalRoles: number, note: string | undefined, outPath: string): Promise<void> {
  const propsPath = path.join(AGENT_DIR, `_transition-props-${toSlug(role)}.json`);
  fs.writeFileSync(propsPath, JSON.stringify({ roleName: role, roleIndex, totalRoles, note }), 'utf-8');
  const cmd = [
    'npx remotion render RoleTransitionCard',
    `"${outPath.replace(/\\/g, '/')}"`,
    `--props="${propsPath.replace(/\\/g, '/')}"`,
    '--codec=h264',
  ].join(' ');
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
  fs.unlinkSync(propsPath);
}

async function assembleWalkthrough(results: RoleRecordingResult[]): Promise<void> {
  const ffmpeg = findFfmpegBin();
  const inputs: string[] = [];

  let roleIndex = 0;
  for (const r of results) {
    if (!r.videoPath) continue;
    const cardPath = path.join(AGENT_DIR, `_card-${toSlug(r.role)}.mp4`);
    const note = r.footageNote.quickAccessMatch === 'fallback-default-card' ? r.footageNote.detail : undefined;
    await renderRoleTransitionCard(r.role, roleIndex, results.length, note, cardPath);
    inputs.push(cardPath, r.videoPath);
    roleIndex++;
  }

  if (inputs.length === 0) {
    console.error('  ✗  No role footage to assemble.');
    return;
  }

  // Re-encode via the concat FILTER, not the concat DEMUXER's `-c copy` path.
  // Confirmed by direct testing: the Remotion-rendered title cards and Playwright's
  // own video recordings use different encoder parameters (keyframe interval,
  // timestamp base — visible as "Non-monotonic DTS" warnings from ffmpeg), which a
  // naive stream-copy concat silently corrupts into black/frozen output for large
  // stretches, even though each source file plays back correctly on its own. The
  // filter graph decodes and re-encodes everything into one consistent stream instead.
  const filterInputs = inputs.map((_, i) => `[${i}:v]`).join('');
  const filterGraph   = `${filterInputs}concat=n=${inputs.length}:v=1:a=0[outv]`;
  const filterFile    = path.join(AGENT_DIR, 'concat-filter.txt');
  fs.writeFileSync(filterFile, filterGraph, 'utf-8');

  const inputArgs = inputs.map(p => `-i "${p.replace(/\\/g, '/')}"`).join(' ');
  const cmd = [
    `"${ffmpeg}" -y`,
    inputArgs,
    `-filter_complex_script "${filterFile.replace(/\\/g, '/')}"`,
    '-map "[outv]"',
    '-c:v libx264 -crf 18 -preset veryfast',
    `"${WALKTHROUGH_PATH.replace(/\\/g, '/')}"`,
  ].join(' ');
  execSync(cmd, { stdio: 'inherit' });
  fs.unlinkSync(filterFile);
  console.log(`  ✅  Assembled agent-walkthrough.mp4`);
}

// ─── Optional narration (deterministic templating from real interaction data) ──

function buildNarrationSegments(results: RoleRecordingResult[]): { id: string; label: string; startSec: number; durationSec: number; text: string; enabled: true }[] {
  const segments: { id: string; label: string; startSec: number; durationSec: number; text: string; enabled: true }[] = [];
  let cursor = 0;
  const CARD_SEC = 3;

  for (const r of results) {
    cursor += CARD_SEC; // skip past the role-transition card itself
    for (const p of r.pageResults) {
      const pieces: string[] = [];
      if (p.filled > 0) pieces.push(`filled in ${p.filled} field${p.filled === 1 ? '' : 's'}`);
      if (p.clicked > 0) pieces.push(`explored ${p.clicked} control${p.clicked === 1 ? '' : 's'}`);
      const activity = pieces.length > 0 ? pieces.join(' and ') : 'reviewed the screen';
      const text = `On ${p.pageId.replace(/[-_]/g, ' ')}, the agent ${activity}.`;
      const durationSec = Math.max(2, p.endSec - p.startSec);
      segments.push({ id: `agent-${toSlug(r.role)}-${p.pageId}`, label: `${r.role} — ${p.pageId}`, startSec: cursor, durationSec, text, enabled: true });
      cursor += durationSec;
    }
  }
  return segments;
}

async function runNarration(results: RoleRecordingResult[]): Promise<void> {
  const voiceScript = {
    voice: 'nova', model: 'tts-hd', speed: 0.95, fps: FPS,
    // SEG_DIR in generate-voice.ts resolves as OUT_DIR + voiceDir, so this must be
    // relative to the global OUT_DIR, not to AGENT_DIR.
    voiceDir: 'agent-recording/voice-segments',
    totalDurationSec: 0,
    segments: buildNarrationSegments(results),
  };
  voiceScript.totalDurationSec = voiceScript.segments.reduce((s, seg) => Math.max(s, seg.startSec + seg.durationSec), 0);

  const scriptPath = path.join(AGENT_DIR, 'voice-script.json');
  fs.writeFileSync(scriptPath, JSON.stringify(voiceScript, null, 2), 'utf-8');

  const outputPath = path.join(AGENT_DIR, 'agent-walkthrough-with-voice.mp4');
  const cmd = [
    'npx ts-node --project tsconfig.scripts.json automation/generate-voice.ts',
    `--script "${scriptPath}"`,
    `--video "${WALKTHROUGH_PATH}"`,
    `--output "${outputPath}"`,
    '--no-sync',
  ].join(' ');
  console.log(`\n  🎙️   Generating narration…`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  🤖  Agent Recording — exhaustive, safe, all-roles walkthrough');
  console.log('══════════════════════════════════════════════════════════════\n');

  if (!APP_URL) { console.error('  ✗  APP_URL not set in .env'); process.exit(1); }

  const roles = discoverAllRoles(routeMap);
  if (roles.length === 0) {
    console.error('  ✗  No roles discovered from APP_ROUTE_MAP — nothing to record.');
    process.exit(1);
  }
  console.log(`  Roles discovered: ${roles.join(', ')}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
  });

  const results: RoleRecordingResult[] = [];
  try {
    for (const role of roles) {
      const result = await recordRole(browser, role);
      results.push(result);
    }
  } finally {
    await browser.close();
  }

  const report = buildAgentRunReport({
    appUrl: APP_URL,
    rolesRun: roles,
    roleFootageNotes: results.map(r => r.footageNote),
    pageResults: results.flatMap(r => r.pageResults),
  });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');
  printAgentSafetyReport(report);

  await assembleWalkthrough(results);

  if (NARRATE) {
    await runNarration(results);
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  ✅  Done!');
  console.log(`     Walkthrough : ${WALKTHROUGH_PATH}`);
  console.log(`     Report      : ${REPORT_PATH}`);
  if (NARRATE) console.log(`     Narrated    : ${path.join(AGENT_DIR, 'agent-walkthrough-with-voice.mp4')}`);
  console.log('══════════════════════════════════════════════════════════════\n');
}

main().catch(e => {
  console.error('\n💥 Fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
