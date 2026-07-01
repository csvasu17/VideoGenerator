/**
 * record-flow.ts — Continuous-flow recorder
 *
 * Instead of isolated 12-second clips per page, records ONE long video per role
 * that navigates naturally through all features in sequence.
 *
 * Each scene in demo-package.json gets a `recordingStartSec` timestamp so
 * Remotion's OffthreadVideo `startFrom` seeks exactly to the right moment —
 * giving a live-walkthrough feel rather than a cut-to-cut slideshow.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json automation/record-flow.ts
 *
 * Output:
 *   out/localhost/recordings/flow-admin.mp4        — IT Admin continuous flow
 *   out/localhost/recordings/flow-l1.mp4           — Support L1 continuous flow
 *   out/localhost/recordings/flow-support.mp4      — Support L2 continuous flow
 *   out/localhost/recordings/flow-customer.mp4     — Customer continuous flow
 *   out/localhost/recordings/<id>-frame.png        — screenshot per step (for AI)
 *   out/localhost/demo-package.json                — scenes updated with recordingStartSec
 */

import { chromium }                           from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import * as fs                                from 'fs';
import * as path                              from 'path';
import * as dotenv                            from 'dotenv';
import { AzureOpenAI }                        from 'openai';
import { getVideoInfo }                       from './utils/ffprobe';
import { OUT_DIR }                            from './config';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

// ─── Config ──────────────────────────────────────────────────────────────────

const APP_URL      = process.env['APP_URL']      ?? '';
const APP_USERNAME = process.env['APP_USERNAME'] ?? '';
const APP_PASSWORD = process.env['APP_PASSWORD'] ?? '';
const LOGIN_TYPE   = process.env['LOGIN_TYPE'] === '2' ? 2 : 1;
const FPS          = 30;
const VIEWPORT     = { width: 1920, height: 1080 };

const RECORDINGS_DIR = path.join(OUT_DIR, 'recordings');
const PKG_PATH       = path.join(OUT_DIR, 'demo-package.json');
const TMP_DIR        = path.resolve(__dirname, '../.tmp/flow-sessions');

// ─── Azure OpenAI ────────────────────────────────────────────────────────────

const azureClient = new AzureOpenAI({
  apiKey:     process.env['AZURE_OPENAI_API_KEY']    ?? '',
  endpoint:   process.env['AZURE_OPENAI_ENDPOINT']   ?? '',
  deployment: process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
  apiVersion: process.env['OPENAI_API_VERSION']      ?? '2024-12-01-preview',
});

const APP_CONTEXT   = process.env['APP_CONTEXT_TEXT'] ?? '';
const APP_GLOSSARY  = process.env['APP_GLOSSARY']     ?? '';
const APP_ROUTE_MAP = process.env['APP_ROUTE_MAP']    ?? '';
let routeMap: Record<string, string> = {};
try { if (APP_ROUTE_MAP) routeMap = JSON.parse(APP_ROUTE_MAP); } catch {}

// ─── Notification suppression ────────────────────────────────────────────────

const SUPPRESS_CSS = `
  [class*="alert"][class*="panel"],[class*="Alert"][class*="Panel"],
  [class*="notification-drawer"],[class*="NotificationDrawer"],
  [class*="toast-container"],[class*="ToastContainer"],
  [class*="toast"]:not(button),[class*="snackbar"],
  .alerts-panel,.notification-panel {
    display:none!important; visibility:hidden!important; opacity:0!important;
  }
`;

// ─── Types ───────────────────────────────────────────────────────────────────

interface StepAction {
  type:         'click' | 'wait' | 'hover' | 'fill' | 'key';
  selector?:    string;
  /** For 'click': match by visible text. For 'fill': the value to type. For 'key': key name (e.g. 'ArrowDown'). */
  text?:        string;
  key?:         string;
  waitAfterMs?: number;
}

interface FlowStep {
  id:       string;
  /** Sidebar nav item text to click to reach this page. null = already here. */
  navItem:  string | null;
  /** Optional: navigate directly to this URL path (relative to APP_URL) instead
   *  of clicking a sidebar nav item. Takes precedence over navItem. */
  urlPath?: string;
  label:    string;
  /** Seconds to show this page (AFTER any actions complete). */
  holdSec:  number;
  /** Optional interactions that run before the timestamp is recorded.
   *  Use for actions that NAVIGATE to a sub-view (e.g. click into a ticket row). */
  actions?: StepAction[];
}

interface RoleFlow {
  cardIndex: number;
  role:      string;
  flowId:    string;
  steps:     FlowStep[];
}

// ─── Flow definitions ─────────────────────────────────────────────────────────
// Each role is one continuous recording. Steps are shown in sequence with
// natural sidebar navigation clicks between them.

// Create Ticket actions for Support roles (L1 & L2) — 5-step wizard.
const ROLE_FLOWS: RoleFlow[] = [
  // ── Rheem TotalView — Admin (single LOGIN_TYPE=1 user) ───────────────────────
  // Uses urlPath for direct navigation because the sidebar is collapsed (icon-only).
  {
    cardIndex: 0,
    role:      'Admin',
    flowId:    'flow-admin',
    steps: [
      { id: 'dashboard',  navItem: null,          urlPath: '/dashboard',   label: 'Fleet Dashboard',        holdSec: 12 },
      { id: 'sites',      navItem: 'Sites',        urlPath: '/sites',       label: 'Multi-Site Map',         holdSec: 12 },
      { id: 'devices',    navItem: 'Devices',      urlPath: '/devices',     label: 'Device Management',      holdSec: 12 },
      { id: 'alarms',     navItem: 'Alarms',       urlPath: '/alarms',      label: 'Alarm Management',       holdSec: 12 },
      { id: 'ai-predict', navItem: 'Predictions',  urlPath: '/ai',          label: 'AI Fault Predictions',   holdSec: 12 },
      { id: 'insights',   navItem: 'Insights',     urlPath: '/insights',    label: 'Energy Insights',        holdSec: 12 },
      { id: 'simulator',  navItem: 'Simulator',    urlPath: '/simulator',   label: 'Scenario Simulator',     holdSec: 12 },
      { id: 'settings',   navItem: 'Settings',     urlPath: '/settings',    label: 'Settings & Users',       holdSec: 10 },
    ],
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function suppressPopups(page: Page): Promise<void> {
  await page.addStyleTag({ content: SUPPRESS_CSS }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
  for (const sel of [
    'button[aria-label*="close" i]:visible',
    'button[aria-label*="dismiss" i]:visible',
    '[class*="closeBtn"]:visible',
  ]) {
    try {
      const els = await page.$$(sel);
      for (const el of els.slice(0, 3)) {
        await el.click({ timeout: 400, force: true }).catch(() => {});
        await page.waitForTimeout(150);
      }
    } catch {}
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(200);
}

async function clickNav(page: Page, navItem: string): Promise<boolean> {
  const navSpan = page.locator('nav span, aside span, [class*="sidebar"] span')
    .filter({ hasText: new RegExp(`^${navItem}$`, 'i') });
  const count = await navSpan.count().catch(() => 0);
  if (count === 0) {
    console.log(`     ⚠️  Nav "${navItem}" not found`);
    return false;
  }
  await navSpan.first().scrollIntoViewIfNeeded().catch(() => {});
  await navSpan.first().click();
  await page.waitForTimeout(2000);
  await suppressPopups(page);
  return true;
}

async function runActions(page: Page, actions: StepAction[]): Promise<void> {
  for (const action of actions) {
    try {
      if (action.type === 'wait') {
        await page.waitForTimeout(action.waitAfterMs ?? 1000);

      } else if (action.type === 'click') {
        let clicked = false;
        if (action.text) {
          const el = page.locator(`text=${action.text}`).first();
          if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
            // Use force:true for custom UI components where the clickable parent
            // wraps a non-interactive text node (e.g. autocomplete result cards).
            await el.click({ timeout: 1500, force: true }).catch(async () => {
              await el.click({ timeout: 1500 }).catch(() => {});
            });
            clicked = true;
          }
        }
        if (!clicked && action.selector) {
          for (const sel of action.selector.split(',').map(s => s.trim())) {
            try {
              const el = page.locator(sel).first();
              if (await el.isVisible({ timeout: 1200 }).catch(() => false)) {
                await el.scrollIntoViewIfNeeded().catch(() => {});
                await el.click({ timeout: 2000 });
                clicked = true;
                break;
              }
            } catch {}
          }
        }
        if (!clicked) console.log(`        ⚠️  click: no element found`);
        if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);

      } else if (action.type === 'hover') {
        if (action.selector) await page.locator(action.selector).first().hover({ timeout: 1500 }).catch(() => {});
        if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);

      } else if (action.type === 'key') {
        if (action.key) await page.keyboard.press(action.key).catch(() => {});
        if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);

      } else if (action.type === 'fill') {
        if (action.selector && action.text) {
          let filled = false;
          for (const sel of action.selector.split(',').map(s => s.trim())) {
            try {
              const el = page.locator(sel).first();
              if (await el.isVisible({ timeout: 1200 }).catch(() => false)) {
                await el.click({ timeout: 1500 });
                await el.fill(action.text, { timeout: 2000 });
                filled = true;
                break;
              }
            } catch {}
          }
          if (!filled) console.log(`        ⚠️  fill: no field found for "${action.selector?.slice(0, 40)}"`);
        }
        if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);
      }
    } catch (e) {
      console.log(`        ⚠️  action:${action.type}: ${(e as Error).message?.slice(0, 50)}`);
    }
  }
}

/** Gentle scroll to reveal content without disturbing the page state. */
async function showPageContent(page: Page, holdSec: number): Promise<void> {
  const halfMs = Math.round(holdSec * 500);

  try {
    const bodyH = await page.evaluate(() => document.body.scrollHeight);
    const target = Math.min(bodyH * 0.55, 450);
    await page.evaluate(
      (y: number) => window.scrollTo({ top: y, behavior: 'smooth' }),
      target,
    );
    await page.waitForTimeout(halfMs);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await page.waitForTimeout(Math.max(halfMs - 300, 300));
  } catch {
    await page.waitForTimeout(holdSec * 1000);
  }

  await suppressPopups(page);
}

async function analyzeFrame(
  framePath:  string,
  userRole?:  string,
  targetUrl?: string,
): Promise<{ featureTitle: string; salesHook: string; narration: string }> {
  const b64 = fs.readFileSync(framePath).toString('base64');

  let pagePurpose = '';
  if (targetUrl && Object.keys(routeMap).length > 0) {
    try {
      const urlPath = new URL(targetUrl).pathname;
      const key = Object.keys(routeMap).find(k => urlPath.startsWith(k.replace(/\[.*?\]/g, '')));
      if (key) pagePurpose = routeMap[key];
    } catch {}
  }

  const sections: string[] = ['You are a B2B SaaS demo video script writer.'];
  if (APP_CONTEXT)  sections.push(`\n\nPRODUCT CONTEXT:\n${APP_CONTEXT}`);
  if (userRole)     sections.push(`\n\nACTIVE USER ROLE: The logged-in user is "${userRole}". Frame all narration from this persona's goals and pain points.`);
  if (pagePurpose)  sections.push(`\n\nCURRENT PAGE: ${pagePurpose}`);
  if (APP_GLOSSARY) sections.push(`\n\nDOMAIN GLOSSARY (use these exact terms in narration):\n${APP_GLOSSARY}`);
  sections.push(`\n\nGiven a product screenshot, output JSON (no fences):
{"featureTitle":"short 2-4 word name","salesHook":"compelling 6-10 word hook for the active user role","narration":"1-paragraph ~25 words — address the active user role by name if known, explain what this screen does, and state the specific pain it eliminates"}`);

  const response = await azureClient.chat.completions.create({
    model:      process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
    max_tokens: 500,
    messages: [
      { role: 'system', content: sections.join('') },
      {
        role:    'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}`, detail: 'low' } },
          { type: 'text',      text: 'Analyse and return the JSON.' },
        ],
      },
    ],
  });
  try {
    const raw = response.choices[0]?.message?.content ?? '{}';
    const p   = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, ''));
    return {
      featureTitle: p.featureTitle ?? 'Platform Feature',
      salesHook:    p.salesHook    ?? 'Streamline your operations instantly.',
      narration:    p.narration    ?? 'This feature improves operational efficiency.',
    };
  } catch {
    return { featureTitle: 'Platform Feature', salesHook: 'Streamline operations.', narration: 'Key platform functionality.' };
  }
}

// ─── Per-role login ───────────────────────────────────────────────────────────

async function loginRole(
  browser:   Browser,
  cardIndex: number,
): Promise<{ storageStatePath: string; postLoginUrl: string }> {
  const storageStatePath = path.join(TMP_DIR, `session-role-${cardIndex}.json`);
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const ctx  = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  // Navigate to the root — most SPAs redirect unauthenticated users to the
  // login form at the root rather than a dedicated /login sub-path.
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(1500);

  if (LOGIN_TYPE === 2) {
    // Quick-access card login (e.g. TicketFlow role selection screen)
    await page.locator('.quick-access-card').nth(cardIndex).click();
    await page.waitForTimeout(700);
    await page.locator('button[type="submit"], .signin-btn').first().click();
  } else {
    // Standard username + password form login
    const userSel = 'input[type="email"], input[name="username"], input[name="email"], #username, #email';
    const passSel = 'input[type="password"], #password';
    const btnSel  = 'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign in"), button:has-text("Log in")';
    await page.waitForSelector(userSel, { timeout: 10_000 });
    await page.fill(userSel, APP_USERNAME);
    await page.waitForTimeout(300);
    await page.fill(passSel, APP_PASSWORD);
    await page.waitForTimeout(400);
    await page.click(btnSel);
  }

  // Wait for login to complete: URL changes away from the login page, or 12s max.
  // The condition checks for a URL path change rather than just keyword absence,
  // because some SPAs host the login form at the root path (/).
  const loginPageUrl = page.url();
  await Promise.race([
    page.waitForURL(url => url.href !== loginPageUrl, { timeout: 20_000 }),
    page.waitForTimeout(12_000),
  ]).catch(() => {});
  await page.waitForTimeout(2000);
  const postLoginUrl = page.url();
  await ctx.storageState({ path: storageStatePath });
  await ctx.close();

  return { storageStatePath, postLoginUrl };
}

// ─── Core: record one continuous flow ────────────────────────────────────────

interface StepResult {
  id:           string;
  label:        string;
  flowVideoPath:string;
  startSec:     number;
  framePath:    string;
  role?:        string;
  targetUrl?:   string;
}

async function recordRoleFlow(
  browser: Browser,
  flow:    RoleFlow,
  session: { storageStatePath: string; postLoginUrl: string },
): Promise<StepResult[]> {
  const results: StepResult[] = [];

  console.log(`\n  🎬  ${flow.role}  (${flow.steps.length} steps → ${flow.flowId}.mp4)`);

  const ctx: BrowserContext = await browser.newContext({
    storageState:      session.storageStatePath,
    viewport:          VIEWPORT,
    ignoreHTTPSErrors: true,
    recordVideo:       { dir: RECORDINGS_DIR, size: VIEWPORT },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  });

  await ctx.addInitScript(({ css }: { css: string }) => {
    const s = document.createElement('style');
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }, { css: SUPPRESS_CSS });

  const page   = await ctx.newPage();
  const t0     = Date.now();

  // Land on post-login page (usually the dashboard)
  await page.goto(session.postLoginUrl, { waitUntil: 'domcontentloaded', timeout: 40_000 });
  await page.waitForTimeout(1800);
  await suppressPopups(page);

  for (let i = 0; i < flow.steps.length; i++) {
    const step = flow.steps[i];

    // ── 1. Navigate to this page ──────────────────────────────────────────────
    if (step.urlPath) {
      // Direct URL navigation (preferred when sidebar is icon-only / collapsed)
      const target = APP_URL.replace(/\/$/, '') + step.urlPath;
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(2000);
      await suppressPopups(page);
    } else if (step.navItem) {
      await clickNav(page, step.navItem);
    }

    // ── 2. Execute actions (these navigate to a sub-view BEFORE timestamping) ──
    if (step.actions?.length) {
      await runActions(page, step.actions);
    }

    // ── 3. Timestamp — Remotion will seek here ────────────────────────────────
    const startSec = (Date.now() - t0) / 1000;
    console.log(`     [${i + 1}/${flow.steps.length}]  ${step.label.padEnd(30)} @ ${startSec.toFixed(1)}s`);

    // ── 4. Screenshot for AI analysis ─────────────────────────────────────────
    const framePath = path.join(RECORDINGS_DIR, `${step.id}-frame.png`);
    await page.screenshot({ path: framePath, type: 'png' }).catch(() => {});

    // ── 5. Show this page with gentle scroll for holdSec ─────────────────────
    await showPageContent(page, step.holdSec);

    results.push({ id: step.id, label: step.label, flowVideoPath: '', startSec, framePath, role: flow.role, targetUrl: step.urlPath ? APP_URL.replace(/\/$/, '') + step.urlPath : undefined });
  }

  // Save video
  const vidRaw       = await page.video()?.path();
  const flowVideoPath = path.join(RECORDINGS_DIR, `${flow.flowId}.mp4`);

  await page.close();
  await ctx.close();

  if (vidRaw && fs.existsSync(vidRaw)) {
    if (fs.existsSync(flowVideoPath)) fs.unlinkSync(flowVideoPath);
    fs.renameSync(vidRaw, flowVideoPath);
    const info = getVideoInfo(flowVideoPath);
    console.log(`     💾  Saved ${flow.flowId}.mp4  (${info.duration.toFixed(1)}s)\n`);
  } else {
    console.warn(`     ⚠️  No video produced for ${flow.flowId}\n`);
  }

  for (const r of results) r.flowVideoPath = `recordings/${flow.flowId}.mp4`;
  return results;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  🎬  Continuous Flow Recorder — One video per role');
  console.log('══════════════════════════════════════════════════════════════\n');

  if (!APP_URL) { console.error('  ✗  APP_URL not set in .env'); process.exit(1); }

  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

  const isHeadless = process.env['HEADLESS'] === '1' || process.env['CI'] === 'true';
  const browser    = await chromium.launch({
    headless: isHeadless,
    slowMo:   isHeadless ? 30 : 50,
    args:     ['--disable-web-security', '--disable-features=VizDisplayCompositor'],
  });

  const allResults: StepResult[] = [];

  try {
    // ── Step 1: Login once per unique role ──────────────────────────────────
    console.log('  🔐  Logging in for each role...\n');
    const roleCache = new Map<number, { storageStatePath: string; postLoginUrl: string }>();
    const uniqueCards = [...new Set(ROLE_FLOWS.map(f => f.cardIndex))];

    for (const cardIndex of uniqueCards) {
      const roleName = ROLE_FLOWS.find(f => f.cardIndex === cardIndex)?.role ?? String(cardIndex);
      process.stdout.write(`     Card ${cardIndex} (${roleName}) ... `);
      try {
        const session = await loginRole(browser, cardIndex);
        roleCache.set(cardIndex, session);
        console.log(`✅  ${session.postLoginUrl}`);
      } catch (e) {
        console.log(`❌  ${(e as Error).message?.slice(0, 70)}`);
      }
    }

    // ── Step 2: Record each role's continuous flow ──────────────────────────
    for (const flow of ROLE_FLOWS) {
      const session = roleCache.get(flow.cardIndex);
      if (!session) {
        console.warn(`  ⚠️  Skipping ${flow.role} — no session`);
        continue;
      }
      try {
        const results = await recordRoleFlow(browser, flow, session);
        allResults.push(...results);
      } catch (e) {
        console.error(`  ❌  ${flow.role} flow failed: ${(e as Error).message?.slice(0, 80)}`);
      }
    }

  } finally {
    await browser.close().catch(() => {});
  }

  if (allResults.length === 0) {
    console.error('  ✗  No steps recorded.\n'); process.exit(1);
  }

  // ── Step 3: AI analysis of each step's screenshot ──────────────────────────
  console.log('  🔍  Analysing screenshots with GPT-4.1...\n');

  interface AnalyzedStep extends StepResult {
    featureTitle: string;
    salesHook:    string;
    narration:    string;
  }

  const analyzed: AnalyzedStep[] = [];
  for (let i = 0; i < allResults.length; i++) {
    const r = allResults[i];
    process.stdout.write(`  [${i + 1}/${allResults.length}] ${r.id} ... `);
    try {
      if (fs.existsSync(r.framePath)) {
        const ai = await analyzeFrame(r.framePath, r.role, r.targetUrl);
        console.log(`"${ai.featureTitle}"`);
        analyzed.push({ ...r, ...ai });
      } else {
        console.log(`⚠️  no frame`);
        analyzed.push({ ...r, featureTitle: r.label, salesHook: `Explore ${r.label}`, narration: `${r.label} provides key functionality.` });
      }
    } catch {
      console.log(`⚠️  AI error`);
      analyzed.push({ ...r, featureTitle: r.label, salesHook: `Explore ${r.label}`, narration: `${r.label} provides key functionality.` });
    }
  }

  // ── Step 4: Build demo-package.json ────────────────────────────────────────
  console.log('\n  📦  Updating demo-package.json...');

  const existingPkg = fs.existsSync(PKG_PATH)
    ? JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8').replace(/^﻿/, ''))
    : {};

  // Preserve broll, benefit, presenterClose, and meta from existing package
  const brollScenes   = existingPkg.brollScenes   ?? [];
  const benefitSlide  = existingPkg.benefitSlide   ?? {};
  const presenterClose = existingPkg.presenterClose ?? {};
  const presenterConfig = existingPkg.presenterConfig ?? { src: 'assets/presenter/presenter-default.png', widthFraction: 0.15, position: 'bottom-left' };

  const brollTotal = brollScenes.reduce((s: number, b: any) => s + (b.durationInFrames ?? 0), 0);
  let cursor = brollTotal;

  const SCENE_SEC = 14;  // how many seconds each scene plays in the final video

  const scenes = analyzed.map((step, idx) => {
    const dur  = SCENE_SEC * FPS;
    const from = cursor;
    cursor += dur;
    return {
      id:                 `scene-${idx + 1}`,
      pageId:             step.id,
      title:              step.featureTitle,
      salesHook:          step.salesHook,
      narration:          step.narration,
      description:        step.narration,
      screenshotPath:     `recordings/${step.id}-frame.png`,
      recordingPath:      step.flowVideoPath,        // points to role's flow video
      recordingStartSec:  Math.round(step.startSec * 10) / 10,  // timestamp to seek
      from,
      durationInFrames:   dur,
      transition:         idx < analyzed.length - 1 ? { type: 'slide-left', durationInFrames: 12 } : null,
      nodeType:           '',
    };
  });

  const benefitFrom   = cursor;
  const closeFrom     = benefitFrom + (existingPkg.benefitSlide?.durationInFrames ?? 18 * FPS);
  const totalFrames   = closeFrom  + (existingPkg.presenterClose?.durationInFrames ?? 16 * FPS);

  const pkg = {
    ...existingPkg,
    composition: {
      ...(existingPkg.composition ?? {}),
      id: 'EnterpriseVideo', durationInFrames: totalFrames, fps: FPS, width: 1920, height: 1080,
    },
    scenes,
    brollScenes,
    benefitSlide:   { ...benefitSlide,   from: benefitFrom },
    presenterClose: { ...presenterClose, from: closeFrom   },
    presenterConfig,
    meta: { ...(existingPkg.meta ?? {}), templateId: 'enterprise' },
  };

  fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2), 'utf-8');

  const totalSec = Math.round(totalFrames / FPS);
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  ✅  Done!\n');
  console.log(`     Flow videos : flow-admin.mp4, flow-support.mp4, flow-customer.mp4`);
  console.log(`     Scenes      : ${scenes.length}`);
  console.log(`     Duration    : ${totalSec}s  (${Math.floor(totalSec / 60)}m ${totalSec % 60}s)`);
  console.log(`     Package     : ${PKG_PATH}`);
  console.log('\n  Next step: npx ts-node automation/generate-voice.ts');
  console.log('══════════════════════════════════════════════════════════════\n');
}

main().catch(e => {
  console.error('\n💥 Fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
