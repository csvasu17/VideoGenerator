/**
 * record-priorauth-clips.ts — Generic recording pipeline
 *
 * Records screen-capture clips for any configured app and writes
 * out/<slug>/demo-package.json + out/<slug>/voice-script.json.
 *
 * All parameters are read from .env — NO hardcoded product values:
 *   APP_URL          — target application URL
 *   APP_PRODUCT_NAME — product name (output folder + metadata)
 *   LOGIN_TYPE       — 1 = username/password form, 2 = Quick Access card click
 *   APP_USERNAME     — username (type 1) or card name to click (type 2)
 *   APP_PASSWORD     — password (type 1 only)
 *   APP_ROUTE_MAP    — JSON: { "/path": "Page description", ... }
 *   APP_CONTEXT_TEXT — product description (powers AI narration and content)
 *   APP_GLOSSARY     — KEY=Value domain terms for narration
 *   APP_LANGUAGE     — narration language (default: en)
 */

import { chromium }       from 'playwright';
import type { BrowserContext, Page } from 'playwright';
import * as fs            from 'fs';
import * as path          from 'path';
import * as dotenv        from 'dotenv';
import { AzureOpenAI }   from 'openai';
import { getVideoInfo }  from './utils/ffprobe';
import { execSync }      from 'child_process';
import { OUT_DIR, SCREEN_FIT } from './config';
import { createAuthContext, performLogin } from './utils/session';
import type { SessionState } from './utils/session';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 4): Promise<T> {
  let delay = 2000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt === maxRetries) throw err;
      const is429 = err?.status === 429 || String(err?.message).includes('429');
      if (!is429) throw err;
      const retryAfter = Number(err?.headers?.['retry-after'] ?? 0) * 1000;
      const waitMs = retryAfter > 0 ? retryAfter : delay;
      console.warn(`    ⏳ Rate-limited — retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${maxRetries})…`);
      await new Promise(r => setTimeout(r, waitMs));
      delay *= 2;
    }
  }
  throw new Error('retryWithBackoff: unreachable');
}

// ─── Config — all values from .env ───────────────────────────────────────────

const APP_URL      = (process.env['APP_URL'] ?? 'http://localhost:3000').replace(/\/$/, '');
const LOGIN_TYPE   = process.env['LOGIN_TYPE'] ?? '1';
const APP_USERNAME = process.env['APP_USERNAME'] ?? '';
const APP_PASSWORD = process.env['APP_PASSWORD'] ?? '';
const PRODUCT_NAME = process.env['APP_PRODUCT_NAME'] || (() => {
  try { return new URL(APP_URL).hostname; } catch { return 'Product'; }
})();
// APP_LOGIN_PATH lets you override the login page path (default /login).
// Set APP_LOGIN_PATH=/ if the app redirects from root to its login screen.
const APP_LOGIN_PATH = (process.env['APP_LOGIN_PATH'] ?? '/login').replace(/^\//, '');
// Build LOGIN_URL without double-slash: strip trailing slash from APP_URL first.
const LOGIN_URL = APP_LOGIN_PATH
  ? `${APP_URL.replace(/\/$/, '')}/${APP_LOGIN_PATH}`
  : APP_URL.replace(/\/$/, '') + '/';
const REC_DIR      = path.join(OUT_DIR, 'recordings');
const TMP_REC_DIR  = path.join(OUT_DIR, '_tmp_rec');
const PKG_PATH     = path.join(OUT_DIR, 'demo-package.json');
const VOICE_PATH   = path.join(OUT_DIR, 'voice-script.json');

const FPS           = 30;
const VIEWPORT      = { width: 1920, height: 1080 };
const BROLL_FRAMES  = 240;   // 8 s per b-roll
const PRODUCT_SEC   = 14;    // default scene duration
const BENEFIT_SEC   = 18;
const PRESENTER_SEC = 16;
// With session-based auth the browser navigates DIRECTLY to the target page —
// no login form, so content is visible by second 2-3.  A small skip is still
// useful to hide the initial page-load flash / spinner.
const LOGIN_SKIP_SEC = 3;

fs.mkdirSync(REC_DIR, { recursive: true });

// ─── Azure OpenAI ─────────────────────────────────────────────────────────────

const azureClient = new AzureOpenAI({
  apiKey:     process.env['AZURE_OPENAI_API_KEY']    ?? '',
  endpoint:   process.env['AZURE_OPENAI_ENDPOINT']   ?? '',
  deployment: process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
  apiVersion: process.env['OPENAI_API_VERSION']      ?? '2024-12-01-preview',
});

const APP_CONTEXT       = process.env['APP_CONTEXT_TEXT'] ?? '';
const APP_GLOSSARY      = process.env['APP_GLOSSARY']     ?? '';
const APP_ROUTE_MAP_RAW = process.env['APP_ROUTE_MAP']    ?? '{}';
const APP_LANGUAGE      = process.env['APP_LANGUAGE']     ?? 'en';

const LANGUAGE_NAMES: Record<string, string> = {
  fr: 'French', de: 'German', es: 'Spanish', it: 'Italian',
  pt: 'Portuguese', ja: 'Japanese', zh: 'Chinese', ko: 'Korean',
};
const LANGUAGE_NAME = LANGUAGE_NAMES[APP_LANGUAGE.split('-')[0].toLowerCase()] ?? null;

let routeMap: Record<string, string> = {};
try { if (APP_ROUTE_MAP_RAW) routeMap = JSON.parse(APP_ROUTE_MAP_RAW); } catch {}

// ─── AI: frame analysis ───────────────────────────────────────────────────────

const GENERIC_NARRATIONS = new Set([
  'This feature accelerates your workflow.',
  'This feature improves operational efficiency across your team.',
  'Platform Feature',
]);

async function analyzeFrameTextOnly(
  pagePurpose: string,
): Promise<{ featureTitle: string; salesHook: string; narration: string }> {
  const langInstruction = LANGUAGE_NAME
    ? `\n\nIMPORTANT: Write ALL output text values in ${LANGUAGE_NAME}.`
    : '';

  const prompt = `You are a B2B SaaS demo video script writer.
${APP_CONTEXT ? `\nPRODUCT CONTEXT:\n${APP_CONTEXT}` : ''}
${pagePurpose ? `\nCURRENT PAGE: ${pagePurpose}` : ''}
${APP_GLOSSARY ? `\nDOMAIN GLOSSARY (use these exact terms):\n${APP_GLOSSARY}` : ''}

Based on the product context and the current page description above, output a JSON object (no markdown fences) with exactly:
{
  "featureTitle": "short 2-4 word feature name",
  "salesHook": "compelling 6-10 word hook focusing on business value",
  "narration": "one paragraph (2-3 sentences, ~25 words) explaining what this screen does and the business pain it eliminates"
}
Be specific to this product page. Use domain glossary terms accurately.${langInstruction}`;

  const response = await retryWithBackoff(() => azureClient.chat.completions.create({
    model:             process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
    max_completion_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  }));

  const raw = response.choices[0]?.message?.content ?? '{}';
  const p = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, ''));
  return {
    featureTitle: p.featureTitle ?? 'Platform Feature',
    salesHook:    p.salesHook    ?? 'Streamline your workflow instantly.',
    narration:    p.narration    ?? `${pagePurpose || PRODUCT_NAME} — streamline your operations.`,
  };
}

async function analyzeFrame(
  framePath:  string,
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
  if (APP_CONTEXT)  sections.push(`\nPRODUCT CONTEXT:\n${APP_CONTEXT}`);
  if (pagePurpose)  sections.push(`\nCURRENT PAGE: ${pagePurpose}`);
  if (APP_GLOSSARY) sections.push(`\nDOMAIN GLOSSARY (use these exact terms in narration):\n${APP_GLOSSARY}`);
  const langInstruction = LANGUAGE_NAME
    ? `\n\nIMPORTANT: Write ALL output text values in ${LANGUAGE_NAME}.`
    : '';

  sections.push(`
Given a product screenshot, output a JSON object (no markdown fences) with exactly:
{
  "featureTitle": "short 2-4 word feature name",
  "salesHook": "compelling 6-10 word hook focusing on business value",
  "narration": "one paragraph (2-3 sentences, ~25 words) explaining what this screen does and the pain it eliminates"
}
Be specific to what you see. Use domain glossary terms accurately.${langInstruction}`);

  let visionResult: { featureTitle: string; salesHook: string; narration: string } | null = null;
  try {
    const response = await retryWithBackoff(() => azureClient.chat.completions.create({
      model:      process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
      max_completion_tokens: 500,
      messages: [
        { role: 'system', content: sections.join('') },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}`, detail: 'low' } },
            { type: 'text', text: 'Analyse this product screenshot and return the JSON.' },
          ],
        },
      ],
    }));

    const raw = response.choices[0]?.message?.content ?? '{}';
    const p = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, ''));
    visionResult = {
      featureTitle: p.featureTitle ?? '',
      salesHook:    p.salesHook    ?? '',
      narration:    p.narration    ?? '',
    };
  } catch {
    // Vision not supported by this model deployment — fall through to text-only
  }

  // If vision succeeded and returned non-generic narration, use it
  if (visionResult && visionResult.narration && !GENERIC_NARRATIONS.has(visionResult.narration)) {
    return visionResult;
  }

  // Fall back to text-only narration using page context
  if (pagePurpose || APP_CONTEXT) {
    try {
      return await analyzeFrameTextOnly(pagePurpose);
    } catch { /* fall through */ }
  }

  return {
    featureTitle: visionResult?.featureTitle || 'Platform Feature',
    salesHook:    visionResult?.salesHook    || 'Streamline your workflow instantly.',
    narration:    visionResult?.narration    || `${pagePurpose || PRODUCT_NAME} — purpose-built to streamline your operations.`,
  };
}

// ─── AI: benefit slide content ────────────────────────────────────────────────

interface BenefitBullet { icon: string; label: string; description: string }
interface BenefitContent { title: string; bullets: BenefitBullet[] }

async function generateBenefitContent(): Promise<BenefitContent> {
  const DEFAULT: BenefitContent = {
    title: `${PRODUCT_NAME} — Key Benefits`,
    bullets: [
      { icon: 'speed',      label: 'Faster Workflows',    description: 'Automate repetitive tasks and cut processing time dramatically.' },
      { icon: 'accuracy',   label: 'AI-Powered Accuracy', description: 'Machine learning validates data in real time, eliminating costly errors.' },
      { icon: 'oversight',  label: 'Full Visibility',     description: 'Real-time dashboards keep every stakeholder informed at all times.' },
      { icon: 'compliance', label: 'Audit Ready',         description: 'Every action is logged for compliance reviews and accountability.' },
      { icon: 'revenue',    label: 'Scales With You',     description: 'Cloud-native architecture grows with your business without friction.' },
    ],
  };

  if (!APP_CONTEXT) return DEFAULT;

  try {
    const resp = await retryWithBackoff(() => azureClient.chat.completions.create({
      model:      process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
      max_completion_tokens: 800,
      messages: [{
        role: 'user',
        content: `Product context: "${APP_CONTEXT}"

Generate a benefit slide for a B2B SaaS demo video for "${PRODUCT_NAME}". Return JSON only (no markdown):
{
  "title": "${PRODUCT_NAME} — Key Benefits",
  "bullets": [
    { "icon": "speed|accuracy|oversight|compliance|revenue", "label": "2-4 word label", "description": "One sentence business value (~15 words)" }
  ]
}
Include exactly 5 bullets. Icons must be one of: speed, accuracy, oversight, compliance, revenue.`,
      }],
    }));
    const text   = resp.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '')) as BenefitContent;
    if (parsed?.title && Array.isArray(parsed?.bullets) && parsed.bullets.length >= 5) return parsed;
  } catch { /* fall through to default */ }

  return DEFAULT;
}

// ─── AI: b-roll problem statements ────────────────────────────────────────────

async function generateBrollSubtitles(): Promise<string[]> {
  const DEFAULT = [
    'Teams lose hours every day to manual processes and fragmented workflows.',
    'Data entry errors cascade into costly rework and compliance risks.',
    'Disconnected systems leave decision-makers without real-time visibility.',
    'Without automation, scaling operations requires unsustainable headcount growth.',
    'Manual processes create audit gaps and expose organizations to regulatory risk.',
  ];

  if (!APP_CONTEXT) return DEFAULT;

  try {
    const resp = await retryWithBackoff(() => azureClient.chat.completions.create({
      model:      process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
      max_completion_tokens: 400,
      messages: [{
        role: 'user',
        content: `Product context: "${APP_CONTEXT}"

Generate 5 punchy B2B problem statements (10-15 words each) describing pain points "${PRODUCT_NAME}" solves. Return a JSON array only (no markdown):
["Pain point 1", "Pain point 2", "Pain point 3", "Pain point 4", "Pain point 5"]`,
      }],
    }));
    const text   = resp.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '')) as string[];
    if (Array.isArray(parsed) && parsed.length >= 5) return parsed.slice(0, 5);
  } catch { /* fall through to default */ }

  return DEFAULT;
}

// ─── Suppress notification popups ─────────────────────────────────────────────

const SUPPRESS_CSS = `
  [class*="toast"]:not(button),[class*="snackbar"],[class*="notification"]:not(nav),
  [class*="alert"][class*="panel"],[class*="modal-overlay"]:not([class*="content"]) {
    display:none!important;
  }
`;

async function suppressPopups(page: Page): Promise<void> {
  await page.addStyleTag({ content: SUPPRESS_CSS }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(200);
}

// ─── Session-based login ───────────────────────────────────────────────────────
// Three-layer strategy:
//   1. Reuse cached .tmp/session-state.json if < 8 h old and still valid
//   2. Try headless login with keyboard.type() + anti-bot bypass
//   3. Open a VISIBLE browser — user logs in manually (2-min window)

const TMP_DIR = path.resolve(__dirname, '../.tmp');

// ── Layer 2: headless login ──
async function tryHeadlessLogin(
  browser:          any,
  storageStatePath: string,
  recDir:           string,
): Promise<(SessionState & { liveCtx: BrowserContext }) | null> {
  const ctx  = await browser.newContext({
    viewport:    VIEWPORT,
    recordVideo: { dir: recDir, size: VIEWPORT },
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();

  // Hide navigator.webdriver so React apps don't block automated input
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  let success = false;
  try {
    let formFound = false;
    for (const loginUrl of [LOGIN_URL, APP_URL]) {
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
      const pwdCount = await page.locator('input[type="password"]').count().catch(() => 0);
      if (pwdCount > 0) { formFound = true; break; }
    }
    if (!formFound) return null;

    if (LOGIN_TYPE === '2') {
      await performLogin(page, { loginType: 2, username: APP_USERNAME, password: APP_PASSWORD, quickAccessIndex: 0 });
    } else {
      const emailSel = [
        'input[type="email"]', 'input[name="email"]', 'input[name="username"]',
        'input[placeholder*="email" i]', 'input[placeholder*="user" i]', 'input[type="text"]',
      ].join(', ');

      const emailInput = page.locator(emailSel).first();
      await emailInput.waitFor({ timeout: 5000 }).catch(() => {});
      await emailInput.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Delete');
      await page.keyboard.type(APP_USERNAME, { delay: 50 });

      const pwdInput = page.locator('input[type="password"]').first();
      await pwdInput.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Delete');
      await page.keyboard.type(APP_PASSWORD, { delay: 50 });

      const submitSel = 'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign In"), button:has-text("Log In"), button:has-text("Log in")';
      const submitCount = await page.locator(submitSel).count().catch(() => 0);
      if (submitCount > 0) {
        await page.locator(submitSel).first().click();
      } else {
        await pwdInput.press('Enter');
      }

      // Wait for the password form to disappear — works even when the URL doesn't change after login
      await page.locator('input[type="password"]').first()
        .waitFor({ state: 'detached', timeout: 15000 })
        .catch(() => {});
      await page.waitForTimeout(3000); // extra wait for tokens/storage to settle
    }

    const stillHasForm = await page.locator('input[type="password"]').count().catch(() => 0);
    if (stillHasForm > 0) {
      console.warn('  ↳ Password form still visible after login attempt — credentials may be wrong.');
      console.warn(`    APP_USERNAME=${APP_USERNAME}  APP_URL=${APP_URL}`);
      return null;
    }

    const postLoginUrl = page.url();

    // Detect "login redirect loop": the app cleared the form but bounced us back to login.
    // Also catches APP_LOGIN_PATH=/ where the login lives at the root URL.
    const isStillLoginPage =
      postLoginUrl.includes('/login') || postLoginUrl.includes('/signin') ||
      postLoginUrl.replace(/\/$/, '') === LOGIN_URL.replace(/\/$/, '');
    if (isStillLoginPage) {
      console.warn(`  ↳ Post-login URL is still the login page (${postLoginUrl}) — login failed silently.`);
      return null;
    }

    await ctx.storageState({ path: storageStatePath });
    await page.close(); // close login page; keep context alive for clip recording
    success = true;
    return { storageStatePath, postLoginUrl, origin: new URL(APP_URL).origin, liveCtx: ctx };
  } finally {
    if (!success) await ctx.close();
  }
}

// ── Layer 3: visible browser — user logs in manually ──
async function tryInteractiveLogin(storageStatePath: string): Promise<SessionState | null> {
  console.log('\n  ┌──────────────────────────────────────────────────────────────────┐');
  console.log('  │  MANUAL LOGIN REQUIRED                                           │');
  console.log('  │  A browser window will open. Please log in to the app.          │');
  console.log(`  │  URL: ${LOGIN_URL.padEnd(62)}│`);
  console.log('  │  The pipeline continues automatically after you log in.         │');
  console.log('  │  You have 3 minutes.                                            │');
  console.log('  └──────────────────────────────────────────────────────────────────┘\n');

  const visibleBrowser = await chromium.launch({
    headless: false,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
  });
  try {
    const ctx  = await visibleBrowser.newContext({ viewport: null, ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait up to 3 minutes for the user to complete login
    await page.waitForURL(
      (u: URL) => !u.href.includes('/login') && !u.href.includes('/signin'),
      { timeout: 180000 },
    );

    const postLoginUrl = page.url();
    await ctx.storageState({ path: storageStatePath });
    console.log(`\n  ✓ Manual login successful — post-login: ${postLoginUrl}`);
    return { storageStatePath, postLoginUrl, origin: new URL(APP_URL).origin };
  } catch (err) {
    console.error(`  ✗ Interactive login timed out or failed: ${(err as Error).message?.slice(0, 100)}`);
    return null;
  } finally {
    await visibleBrowser.close();
  }
}

async function acquireSession(
  browser: any,
  recDir:  string,
): Promise<{ session: SessionState; liveCtx: BrowserContext } | null> {
  fs.mkdirSync(TMP_DIR,  { recursive: true });
  fs.mkdirSync(REC_DIR,  { recursive: true });
  fs.mkdirSync(recDir,   { recursive: true });
  const storageStatePath = path.join(TMP_DIR, 'session-state.json');
  const origin = new URL(APP_URL).origin;

  // ── Layer 1: reuse cached session if < 8 h old and still authenticated ──
  if (fs.existsSync(storageStatePath)) {
    const ageMs = Date.now() - fs.statSync(storageStatePath).mtimeMs;
    if (ageMs < 8 * 60 * 60 * 1000) {
      console.log(`  Cached session found (${Math.round(ageMs / 60000)}m old) — verifying…`);
      try {
        const firstRoute = Object.keys(routeMap)[0] ?? '/';
        const verCtx  = await browser.newContext({ storageState: storageStatePath, ignoreHTTPSErrors: true });
        const verPage = await verCtx.newPage();
        await verPage.goto(`${APP_URL}${firstRoute}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await verPage.waitForTimeout(2000);
        const verUrl     = verPage.url();
        const verHasForm = await verPage.locator('input[type="password"]').count().catch(() => 0);
        await verCtx.close();
        const verIsLogin =
          verUrl.includes('/login') || verUrl.includes('/signin') ||
          verUrl.replace(/\/$/, '') === LOGIN_URL.replace(/\/$/, '');
        if (!verIsLogin && verHasForm === 0) {
          console.log(`  ✓ Cached session valid — skipping login`);
          const liveCtx = await browser.newContext({
            storageState: storageStatePath,
            viewport:     VIEWPORT,
            recordVideo:  { dir: recDir, size: VIEWPORT },
            ignoreHTTPSErrors: true,
          });
          return { session: { storageStatePath, postLoginUrl: verUrl, origin }, liveCtx };
        }
        console.log('  ↳ Session expired — re-authenticating…');
      } catch {
        console.log('  ↳ Session verify failed — re-authenticating…');
      }
    }
  }

  // ── Layer 2: try headless login ──
  console.log('  Attempting headless login…');
  const headlessResult = await tryHeadlessLogin(browser, storageStatePath, recDir);
  if (headlessResult) {
    const { liveCtx, ...sessionFields } = headlessResult;
    const session: SessionState = sessionFields;
    console.log(`  ✓ Headless login succeeded — post-login: ${session.postLoginUrl}`);
    return { session, liveCtx };
  }
  console.log('  ↳ Headless login failed — falling back to manual login…');

  // ── Layer 3: interactive (visible) browser ──
  const interactiveSession = await tryInteractiveLogin(storageStatePath);
  if (!interactiveSession) return null;
  const liveCtx = await browser.newContext({
    storageState: storageStatePath,
    viewport:     VIEWPORT,
    recordVideo:  { dir: recDir, size: VIEWPORT },
    ignoreHTTPSErrors: true,
  });
  return { session: interactiveSession, liveCtx };
}

// ─── Clip action types ─────────────────────────────────────────────────────────

interface ClipAction {
  type:         'wait' | 'navigate' | 'click' | 'scroll' | 'evaluate';
  url?:         string;
  selector?:    string;
  text?:        string;
  value?:       string | number;
  waitAfterMs?: number;
}

interface ClipPlan {
  id:               string;
  label:            string;
  targetUrl:        string;
  durationSec:      number;
  loginAs?:         string;    // undefined = no login; string = login before navigating
  recordingStartSec?: number;
  skipInteraction?: boolean;
  actions?:         ClipAction[];
}

// ─── Dynamic recording plan from APP_ROUTE_MAP ────────────────────────────────

function buildRecordingPlan(): ClipPlan[] {
  const loginUser = APP_USERNAME || 'user';
  const routes    = Object.entries(routeMap);

  const defaultActions: ClipAction[] = [
    { type: 'wait',   waitAfterMs: 3000 },
    { type: 'scroll', value: 300, waitAfterMs: 2000 },
    { type: 'scroll', value: 0,   waitAfterMs: 2000 },
    { type: 'wait',   waitAfterMs: 2000 },
  ];

  const plan: ClipPlan[] = [
    // Login page — no auth, always first
    {
      id:          'login',
      label:       'Login Page',
      targetUrl:   LOGIN_URL,
      durationSec: 10,
      loginAs:     undefined,
      actions: [
        { type: 'wait', waitAfterMs: 3000 },
        { type: 'wait', waitAfterMs: 5000 },
      ],
    },
  ];

  if (routes.length === 0) {
    // No route map configured — record the home page only
    plan.push({
      id:               'home',
      label:            'Home',
      targetUrl:        APP_URL,
      durationSec:      PRODUCT_SEC,
      loginAs:          loginUser,
      recordingStartSec: LOGIN_SKIP_SEC,
      actions:          defaultActions,
    });
  } else {
    for (const [routePath, label] of routes) {
      const id = routePath === '/'
        ? 'home'
        : routePath.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
      plan.push({
        id,
        label:            String(label),
        targetUrl:        `${APP_URL}${routePath}`,
        durationSec:      PRODUCT_SEC,
        loginAs:          loginUser,
        recordingStartSec: LOGIN_SKIP_SEC,
        actions:          defaultActions,
      });
    }
  }

  return plan;
}

const RECORDING_PLAN = buildRecordingPlan();

// ─── Interaction helpers ───────────────────────────────────────────────────────

async function performAction(page: Page, action: ClipAction): Promise<void> {
  switch (action.type) {
    case 'wait':
      await page.waitForTimeout(action.waitAfterMs ?? 1000);
      break;
    case 'navigate':
      await page.goto(action.url!, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);
      break;
    case 'click':
      if (action.text) {
        await page.locator(`text=${action.text}`).first().click({ timeout: 5000 }).catch(() => {
          console.warn(`    click text="${action.text}" failed`);
        });
      } else if (action.selector) {
        await page.locator(action.selector).first().click({ timeout: 5000 }).catch(() => {});
      }
      if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);
      break;
    case 'scroll':
      await page.evaluate(
        (y: number) => window.scrollTo({ top: y, behavior: 'smooth' }),
        action.value as number ?? 500,
      ).catch(() => {});
      if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);
      break;
    case 'evaluate':
      await page.evaluate(action.value as string).catch(() => {});
      if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);
      break;
  }
}

async function performFullInteraction(page: Page): Promise<void> {
  await suppressPopups(page);
  try {
    const h = await page.evaluate(() => document.body.scrollHeight);
    const steps = Math.min(Math.ceil(h / 400), 6);
    for (let i = 1; i <= steps; i++) {
      await page.evaluate(
        (y: number) => window.scrollTo({ top: y, behavior: 'smooth' }),
        (i / steps) * h * 0.7,
      );
      await page.waitForTimeout(600);
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await page.waitForTimeout(500);
  } catch {}
  await suppressPopups(page);
}

// ─── FFmpeg helper ─────────────────────────────────────────────────────────────

function findFfmpeg(): string {
  try { execSync('ffmpeg -version', { stdio: 'ignore' }); return 'ffmpeg'; } catch {}
  for (const c of ['C:/ffmpeg/bin/ffmpeg.exe', 'D:/ffmpeg/bin/ffmpeg.exe']) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('FFmpeg not found in PATH');
}

function convertToMp4(webmPath: string, mp4Path: string): void {
  const ffmpeg = findFfmpeg();
  // -threads 4 caps libx264's per-thread malloc which fails on high core-count machines
  execSync(
    `"${ffmpeg}" -y -i "${webmPath}" -c:v libx264 -crf 23 -preset veryfast -threads 4 -pix_fmt yuv420p -movflags +faststart -an "${mp4Path}"`,
    { stdio: 'pipe' },
  );
}

// ─── Record one clip ───────────────────────────────────────────────────────────

interface RecordedClip {
  id:               string;
  label:            string;
  targetUrl:        string;
  loginAs?:         string;
  videoPath:        string;
  framePath:        string;
  durationSec:      number;
  recordingStartSec?: number;
}

async function recordClip(
  browser:  ReturnType<typeof chromium.launch> extends Promise<infer T> ? T : never,
  plan:     ClipPlan,
  session:  SessionState | null,
  liveCtx?: BrowserContext,
): Promise<RecordedClip> {
  fs.mkdirSync(TMP_REC_DIR, { recursive: true });

  console.log(`\n  ── Recording: ${plan.label} ──────────────────────────`);

  let ctx: BrowserContext;
  let ownCtx = true; // false when reusing the shared liveCtx — must not close it
  if (plan.loginAs && liveCtx) {
    ctx = liveCtx;
    ownCtx = false;
  } else if (plan.loginAs && session) {
    ctx = await createAuthContext(browser as any, session, {
      viewport: VIEWPORT,
      recordVideo: { dir: TMP_REC_DIR, size: VIEWPORT },
    });
  } else {
    ctx = await (browser as any).newContext({
      viewport: VIEWPORT,
      recordVideo: { dir: TMP_REC_DIR, size: VIEWPORT },
      ignoreHTTPSErrors: true,
    });
    await ctx.addInitScript(({ css }: { css: string }) => {
      const s = document.createElement('style');
      s.textContent = css;
      (document.head || document.documentElement).appendChild(s);
    }, { css: SUPPRESS_CSS });
  }

  const page = await ctx.newPage();

  if (plan.loginAs) {
    if (!session && !liveCtx) {
      if (ownCtx) await ctx.close(); else await page.close();
      throw new Error(`No session — login failed before recording started`);
    }
    // Navigate directly to the target page — liveCtx keeps auth in memory across clips
    await page.goto(plan.targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);  // let SPA hydrate

    // Always verify we didn't land on a login page — liveCtx auth is NOT guaranteed
    // if the headless login silently failed (form flickers off then reappears).
    const landedUrl = page.url();
    const loginRedirect =
      landedUrl.includes('/login') || landedUrl.includes('/signin') || landedUrl.includes('/auth') ||
      landedUrl.replace(/\/$/, '') === LOGIN_URL.replace(/\/$/, '');
    const hasLoginForm = !loginRedirect
      ? await page.locator('input[type="password"]').count().catch(() => 0)
      : 0;
    if (loginRedirect || hasLoginForm > 0) {
      // Don't close liveCtx (shared) — only close the page
      if (ownCtx) await ctx.close(); else await page.close();
      const reason = loginRedirect
        ? `redirected to login URL (${landedUrl})`
        : 'login form still visible';
      throw new Error(
        `Route ${plan.targetUrl} ${reason}.\n` +
        `  Check APP_USERNAME / APP_PASSWORD / APP_LOGIN_PATH in .env.\n` +
        `  Current credentials: ${APP_USERNAME} @ ${new URL(APP_URL).origin}`,
      );
    }
  } else {
    await page.goto(plan.targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
  }

  await suppressPopups(page);
  await page.waitForTimeout(500);

  if (plan.actions) {
    for (const action of plan.actions) {
      await performAction(page, action);
    }
  }

  if (!plan.skipInteraction) {
    await performFullInteraction(page);
  }

  const elapsed  = plan.actions?.reduce((s, a) => s + (a.waitAfterMs ?? 0), 0) ?? 0;
  const targetMs = (plan.durationSec + (plan.recordingStartSec ?? 0)) * 1000;
  const remaining = targetMs - elapsed - 3000;
  if (remaining > 0) await page.waitForTimeout(remaining);

  const framePath = path.join(REC_DIR, `${plan.id}-frame.png`);
  await page.screenshot({ path: framePath, fullPage: false });
  console.log(`    Screenshot saved: ${path.basename(framePath)}`);

  const videoObj = page.video();
  if (ownCtx) {
    await ctx.close(); // owned context: close finalises video
  } else {
    await page.close(); // shared liveCtx: close page only — finalises video without closing context
  }

  const webmPath = await videoObj?.path() ?? '';
  const mp4Path  = path.join(REC_DIR, `${plan.id}.mp4`);
  if (webmPath && fs.existsSync(webmPath)) {
    console.log(`    Converting to MP4…`);
    convertToMp4(webmPath, mp4Path);
    fs.unlinkSync(webmPath);
  } else {
    console.error(`    ✗ WebM not found at ${webmPath}`);
  }

  let actualDuration = plan.durationSec;
  try {
    const info = getVideoInfo(mp4Path);
    actualDuration = info.duration;
    console.log(`    Duration: ${actualDuration.toFixed(1)}s`);
  } catch {}

  return {
    id:               plan.id,
    label:            plan.label,
    targetUrl:        plan.targetUrl,
    loginAs:          plan.loginAs,
    videoPath:        `recordings/${plan.id}.mp4`,
    framePath,
    durationSec:      plan.durationSec,
    recordingStartSec: plan.recordingStartSec,
  };
}

// ─── Build demo-package.json ──────────────────────────────────────────────────

interface AnalyzedClip extends RecordedClip {
  featureTitle: string;
  salesHook:    string;
  narration:    string;
}

function buildDemoPackage(
  clips:          AnalyzedClip[],
  benefitContent: BenefitContent,
  brollSubtitles: string[],
): object {
  const BROLL_COUNT = Math.min(brollSubtitles.length, 5);
  const brollFrames = BROLL_COUNT * BROLL_FRAMES;

  let from = brollFrames;
  const scenes = clips.map((clip, idx) => {
    const dur = Math.round(clip.durationSec * FPS);
    const scene = {
      id:               `scene-${idx + 1}`,
      pageId:           clip.id,
      title:            clip.featureTitle,
      salesHook:        clip.salesHook,
      narration:        clip.narration,
      description:      clip.narration,
      screenshotPath:   `recordings/${clip.id}-frame.png`,
      ...(clip.id !== 'login' ? { recordingPath: clip.videoPath } : {}),
      ...(clip.recordingStartSec ? { recordingStartSec: clip.recordingStartSec } : {}),
      from,
      durationInFrames: dur,
      transition: idx < clips.length - 1 ? { type: 'slide-left', durationInFrames: 12 } : null,
      nodeType: '',
    };
    from += dur;
    return scene;
  });

  const benefitFrom   = from;
  const benefitFrames = Math.round(BENEFIT_SEC * FPS);
  from += benefitFrames;

  const presenterFrom   = from;
  const presenterFrames = Math.round(PRESENTER_SEC * FPS);
  const totalFrames     = presenterFrom + presenterFrames;

  const brollScenes = brollSubtitles.slice(0, BROLL_COUNT).map((sub, i) => ({
    id:               `broll-${i}`,
    from:             i * BROLL_FRAMES,
    durationInFrames: BROLL_FRAMES,
    subtitle:         sub,
    category:         'generic',
    videoPath:        `recordings/broll-${i}.mp4`,
  }));

  const targetAudience = APP_CONTEXT
    ? APP_CONTEXT.substring(0, 120).replace(/\.$/, '')
    : `${PRODUCT_NAME} users and decision-makers`;
  const primaryBenefit = APP_CONTEXT
    ? `streamline operations and accelerate workflows with ${PRODUCT_NAME}`
    : 'automate manual processes and improve operational efficiency';

  return {
    composition: {
      id: 'EnterpriseVideo',
      durationInFrames: totalFrames,
      fps:    FPS,
      width:  VIEWPORT.width,
      height: VIEWPORT.height,
    },
    scenes,
    brollScenes,
    benefitSlide: {
      from:             benefitFrom,
      durationInFrames: benefitFrames,
      title:            benefitContent.title,
      bullets:          benefitContent.bullets,
    },
    presenterClose: {
      from:             presenterFrom,
      durationInFrames: presenterFrames,
      tagline:          `${PRODUCT_NAME} — every workflow, simplified`,
      presenterSrc: '',
    },
    presenterConfig: {
      src: '', videoSrc: '', widthFraction: 0.15, position: 'bottom-left', enabled: false,
    },
    meta: {
      productName:    PRODUCT_NAME,
      targetAudience,
      primaryBenefit,
      templateId:     'enterprise',
    },
    screenFit: SCREEN_FIT,
  };
}

// ─── Build voice-script.json ──────────────────────────────────────────────────

function buildVoiceScript(
  clips:          AnalyzedClip[],
  pkg:            any,
  brollSubtitles: string[],
): object {
  const brollCount = pkg.brollScenes.length;
  const brollSec   = BROLL_FRAMES / FPS;

  const brollSegments = brollSubtitles.slice(0, brollCount).map((text, i) => ({
    id:          `broll-${i}`,
    label:       `B-roll ${i + 1}`,
    startSec:    i * brollSec + 1,
    durationSec: 6.5,
    enabled:     true,
    text,
  }));

  // Always use AI-generated narration — no hardcoded product-specific overrides
  const productSegments = clips.map((clip, idx) => {
    const scene    = pkg.scenes[idx];
    const startSec = scene.from / FPS;
    return {
      id:          `scene-${idx + 1}`,
      label:       `Scene ${idx + 1} — ${clip.label}`,
      startSec,
      durationSec: clip.durationSec - 2,
      enabled:     true,
      text:        clip.narration,
    };
  });

  const benefitStartSec = pkg.benefitSlide.from / FPS;
  const benefitSegment = {
    id:          'benefit-slide',
    label:       'Benefit Slide',
    startSec:    benefitStartSec,
    durationSec: BENEFIT_SEC - 2,
    enabled:     true,
    text:        `${PRODUCT_NAME} brings automation, accuracy, and visibility to every workflow. ` +
                 `AI-powered processing eliminates manual bottlenecks. ` +
                 `Role-based dashboards keep every team informed and in sync. ` +
                 `Full audit trails ensure every decision is traceable and defensible.`,
  };

  const closeStartSec = pkg.presenterClose.from / FPS;
  const closeSegment = {
    id:          'presenter-close',
    label:       'Presenter Close',
    startSec:    closeStartSec,
    durationSec: PRESENTER_SEC - 2,
    enabled:     true,
    text:        `This is ${PRODUCT_NAME}. Powerful, intuitive, and built for the way your team works. ` +
                 `Ready to see it live? Contact us to schedule your personalized demonstration.`,
  };

  return {
    voice: 'nova',
    model: 'tts-hd',
    speed: 0.95,
    fps:   FPS,
    totalDurationSec: Math.round((pkg.composition.durationInFrames / FPS) * 10) / 10,
    segments: [...brollSegments, ...productSegments, benefitSegment, closeSegment],
  };
}

// ─── i18n: batch-translate all generated content ──────────────────────────────

async function translateAllContent(
  pkg:    Record<string, any>,
  voice:  Record<string, any>,
  locale: string,
): Promise<{ pkg: Record<string, any>; voice: Record<string, any> }> {
  const lang         = locale.split('-')[0].toLowerCase();
  const languageName = LANGUAGE_NAMES[lang];
  if (!languageName) return { pkg, voice };

  console.log(`\n  [i18n] Translating all content → ${languageName}…`);

  const brollSegs  = (voice.segments as any[]).filter((s: any) => (s.id as string).startsWith('broll-'));
  const sceneSegs  = (voice.segments as any[]).filter((s: any) => !(s.id as string).startsWith('broll-') && s.id !== 'benefit-slide' && s.id !== 'presenter-close');
  const benefitSeg = (voice.segments as any[]).find((s: any) => s.id === 'benefit-slide');
  const closeSeg   = (voice.segments as any[]).find((s: any) => s.id === 'presenter-close');

  const payload = {
    brollSubtitles:   (pkg.brollScenes as any[]).map((s: any) => s.subtitle as string),
    brollVoice:       brollSegs.map((s: any) => s.text as string),
    benefitTitle:     pkg.benefitSlide.title as string,
    benefitBullets:   (pkg.benefitSlide.bullets as any[]).map((b: any) => ({ label: b.label as string, description: b.description as string })),
    presenterTagline: pkg.presenterClose.tagline as string,
    scenes:           (pkg.scenes as any[]).map((s: any) => ({ title: s.title as string, salesHook: s.salesHook as string, narration: s.narration as string })),
    sceneVoice:       sceneSegs.map((s: any) => s.text as string),
    benefitVoice:     benefitSeg?.text as string ?? '',
    closingVoice:     closeSeg?.text  as string ?? '',
  };

  const prompt = `You are a professional localization specialist for B2B SaaS marketing videos.

Translate the following JSON object into ${languageName}. Rules:
- Translate ONLY the string values — do NOT translate JSON keys.
- Keep product names, technical acronyms, and brand names untranslated.
- Preserve tone: brollSubtitles should be punchy 10-15 word problem statements; narrations should be natural spoken voice-over.
- Return ONLY valid JSON with the exact same structure. No markdown, no code fences.

JSON to translate:
${JSON.stringify(payload, null, 2)}`;

  let responseText = '';
  try {
    const resp = await retryWithBackoff(() => azureClient.chat.completions.create({
      model:      process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
      max_completion_tokens: 8192,
      messages:   [{ role: 'user', content: prompt }],
    }));
    responseText = resp.choices[0]?.message?.content ?? '';
  } catch {
    console.warn(`  [i18n] LLM call failed — keeping English`);
    return { pkg, voice };
  }

  const cleaned = responseText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const start   = cleaned.indexOf('{');
  const end     = cleaned.lastIndexOf('}');

  let translated: typeof payload;
  try {
    if (start === -1 || end === -1) throw new Error('no JSON object found');
    translated = JSON.parse(cleaned.slice(start, end + 1)) as typeof payload;
  } catch {
    console.warn(`  [i18n] JSON parse failed — keeping English`);
    return { pkg, voice };
  }

  const newPkg: Record<string, any> = JSON.parse(JSON.stringify(pkg));
  if (Array.isArray(translated.brollSubtitles)) {
    (newPkg.brollScenes as any[]).forEach((s: any, i: number) => {
      if (translated.brollSubtitles[i]) s.subtitle = translated.brollSubtitles[i];
    });
  }
  if (translated.benefitTitle)  newPkg.benefitSlide.title = translated.benefitTitle;
  if (Array.isArray(translated.benefitBullets)) {
    (newPkg.benefitSlide.bullets as any[]).forEach((b: any, i: number) => {
      const t = translated.benefitBullets[i];
      if (t?.label)       b.label       = t.label;
      if (t?.description) b.description = t.description;
    });
  }
  if (translated.presenterTagline) newPkg.presenterClose.tagline = translated.presenterTagline;
  if (Array.isArray(translated.scenes)) {
    (newPkg.scenes as any[]).forEach((s: any, i: number) => {
      const t = translated.scenes[i];
      if (t?.title)     s.title     = t.title;
      if (t?.salesHook) s.salesHook = t.salesHook;
      if (t?.narration) { s.narration = t.narration; s.description = t.narration; }
    });
  }

  const newVoice: Record<string, any> = JSON.parse(JSON.stringify(voice));
  const segs = newVoice.segments as any[];
  if (Array.isArray(translated.brollVoice)) {
    segs.filter((s: any) => (s.id as string).startsWith('broll-'))
        .forEach((s: any, i: number) => { if (translated.brollVoice[i]) s.text = translated.brollVoice[i]; });
  }
  if (Array.isArray(translated.sceneVoice)) {
    segs.filter((s: any) => !(s.id as string).startsWith('broll-') && s.id !== 'benefit-slide' && s.id !== 'presenter-close')
        .forEach((s: any, i: number) => { if (translated.sceneVoice[i]) s.text = translated.sceneVoice[i]; });
  }
  const bSeg = segs.find((s: any) => s.id === 'benefit-slide');
  if (bSeg && translated.benefitVoice) bSeg.text = translated.benefitVoice;
  const cSeg = segs.find((s: any) => s.id === 'presenter-close');
  if (cSeg && translated.closingVoice) cSeg.text = translated.closingVoice;

  console.log(`  [i18n] ✓ Translation complete → ${languageName}`);
  return { pkg: newPkg, voice: newVoice };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`  🎬  ${PRODUCT_NAME} — Recording Pipeline`);
  console.log(`      APP_URL    : ${APP_URL}`);
  console.log(`      LOGIN_TYPE : ${LOGIN_TYPE === '1' ? '1 (username/password)' : '2 (Quick Access card)'}`);
  console.log(`      Output     : ${OUT_DIR}`);
  console.log(`      Routes     : ${RECORDING_PLAN.length - 1} (from APP_ROUTE_MAP)`);
  console.log('════════════════════════════════════════════════════════════\n');

  // Pre-generate AI content in parallel before recording starts
  console.log('  Generating benefit and b-roll content from APP_CONTEXT_TEXT…');
  const [benefitContent, brollSubtitles] = await Promise.all([
    generateBenefitContent(),
    generateBrollSubtitles(),
  ]);
  console.log(`  ✓ Benefit title: ${benefitContent.title}`);
  console.log(`  ✓ B-roll problem statements: ${brollSubtitles.length}`);

  const browser  = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
  });

  // Acquire auth session ONCE — keeps an authenticated browser context alive so every
  // clip recording inherits the same auth state, even for in-memory-only auth.
  console.log('\n  Acquiring auth session…');
  const acquired = await acquireSession(browser as any, TMP_REC_DIR);
  if (!acquired) {
    console.error('  ✗ Could not log in — check APP_USERNAME / APP_PASSWORD / APP_LOGIN_PATH in .env');
    console.error(`    Save a debug screenshot: open ${APP_URL} in a browser and verify credentials manually.`);
    await browser.close();
    process.exit(1);
  }
  const { session, liveCtx } = acquired;

  const forceRerecord = process.env.FORCE_RERECORD === 'true';
  const recorded: RecordedClip[] = [];

  for (const plan of RECORDING_PLAN) {
    const mp4   = path.join(REC_DIR, `${plan.id}.mp4`);
    const frame = path.join(REC_DIR, `${plan.id}-frame.png`);
    if (!forceRerecord && fs.existsSync(mp4) && fs.existsSync(frame) && fs.statSync(mp4).size > 50_000) {
      console.log(`\n  ── ${plan.label}  [CACHED — skipping] ──────────────────`);
      let dur = plan.durationSec;
      try { dur = getVideoInfo(mp4).duration; } catch {}
      recorded.push({
        id: plan.id, label: plan.label, targetUrl: plan.targetUrl, loginAs: plan.loginAs,
        videoPath: `recordings/${plan.id}.mp4`, framePath: frame,
        durationSec: dur, recordingStartSec: plan.recordingStartSec,
      });
      continue;
    }

    try {
      const clip = await recordClip(browser as any, plan, session, liveCtx);
      recorded.push(clip);
    } catch (clipErr) {
      console.warn(`\n  ✗ Clip "${plan.id}" failed — skipping. (${(clipErr as Error).message?.slice(0, 120)})`);
      // Fall back to cached file under forceRerecord so existing content is preserved
      if (fs.existsSync(mp4) && fs.existsSync(frame) && fs.statSync(mp4).size > 50_000) {
        console.warn(`    ↩ Using existing cached file as fallback.`);
        let dur = plan.durationSec;
        try { dur = getVideoInfo(mp4).duration; } catch {}
        recorded.push({
          id: plan.id, label: plan.label, targetUrl: plan.targetUrl, loginAs: plan.loginAs,
          videoPath: `recordings/${plan.id}.mp4`, framePath: frame,
          durationSec: dur, recordingStartSec: plan.recordingStartSec,
        });
      }
    }
  }

  await liveCtx?.close();
  await browser.close();

  // AI analysis of captured frames
  console.log('\n  Analysing frames with AI vision…\n');
  const analyzed: AnalyzedClip[] = [];
  for (const clip of recorded) {
    console.log(`  Analysing [${clip.id}]…`);
    try {
      const analysis = await analyzeFrame(clip.framePath, clip.targetUrl);
      analyzed.push({ ...clip, ...analysis });
      console.log(`    → ${analysis.featureTitle}: ${analysis.salesHook}`);
    } catch (aiErr) {
      console.warn(`    ⚠ AI analysis failed for "${clip.id}" — using defaults. (${(aiErr as Error).message?.slice(0, 80)})`);
      analyzed.push({
        ...clip,
        featureTitle: clip.label,
        salesHook:    `Streamline your ${PRODUCT_NAME} workflow.`,
        narration:    `The ${clip.label} screen gives your team a clear view of the information they need to act fast.`,
      });
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  if (analyzed.length === 0) {
    console.error('\n  ✗ No clips were successfully recorded or cached — demo-package.json NOT updated to avoid losing existing content.');
    process.exit(1);
  }

  // Write outputs
  let pkg   = buildDemoPackage(analyzed, benefitContent, brollSubtitles) as Record<string, any>;
  let voice = buildVoiceScript(analyzed, pkg, brollSubtitles) as Record<string, any>;

  // i18n translation if APP_LANGUAGE != 'en'
  if (APP_LANGUAGE && APP_LANGUAGE !== 'en') {
    const translated = await translateAllContent(pkg, voice, APP_LANGUAGE);
    pkg   = translated.pkg;
    voice = translated.voice;
  }

  fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2), 'utf-8');
  console.log(`\n  ✓  demo-package.json → ${PKG_PATH}`);

  fs.writeFileSync(VOICE_PATH, JSON.stringify(voice, null, 2), 'utf-8');
  console.log(`  ✓  voice-script.json  → ${VOICE_PATH}`);

  // ── B-roll videos ─────────────────────────────────────────────────────────
  // On New Recording (FORCE_RERECORD=true), always clear existing broll files and
  // re-download from Pexels so the footage matches the current product.
  // Scan REC_DIR directly — do NOT rely on scene.videoPath from pkg (may be unset).
  if (forceRerecord && fs.existsSync(REC_DIR)) {
    const stale = fs.readdirSync(REC_DIR).filter(f => f.startsWith('broll-') && f.endsWith('.mp4'));
    for (const f of stale) {
      try { fs.unlinkSync(path.join(REC_DIR, f)); } catch {}
    }
    if (stale.length > 0) console.log(`\n  Cleared ${stale.length} existing broll file(s) — will download fresh stock footage.`);
  }

  const brollCount = ((pkg as any).brollScenes as Array<unknown>).length;
  const needsBrolls = forceRerecord || (() => {
    if (!fs.existsSync(REC_DIR)) return true;
    for (let i = 0; i < brollCount; i++) {
      const p = path.join(REC_DIR, `broll-${i}.mp4`);
      if (!fs.existsSync(p) || fs.statSync(p).size < 5_000_000) return true;
    }
    return false;
  })();

  if (needsBrolls) {
    console.log(`\n  B-roll: downloading stock videos from Pexels for ${PRODUCT_NAME}…`);
    if (process.env['PEXELS_API_KEY']) {
      try {
        execSync('npm run broll:download', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
      } catch {
        console.warn('  ⚠️  Pexels download failed — check PEXELS_API_KEY and network connectivity.');
        console.warn('  ⚠️  B-roll scenes will show subtitle slides only.');
      }
    } else {
      console.warn('  ⚠️  PEXELS_API_KEY not set — skipping b-roll download.');
    }
  }

  const total = (pkg as any).composition.durationInFrames;
  console.log(`\n  Total duration : ${total} frames = ${(total / FPS).toFixed(1)}s`);
  console.log(`  Scenes         : ${(pkg as any).scenes.length}`);
  console.log(`  B-roll scenes  : ${(pkg as any).brollScenes.length}`);

  console.log('\n  🎙️  Generating voice narration…');
  try {
    execSync('npm run voice:only', {
      cwd:   path.resolve(__dirname, '..'),
      stdio: 'inherit',
    });
    // Confirm MP3s were written, then stamp voice-script.json so the
    // composition knows it can safely render <Audio> elements.
    const vs        = JSON.parse(fs.readFileSync(VOICE_PATH, 'utf-8')) as Record<string, unknown>;
    const segDir    = path.join(OUT_DIR, (vs['voiceDir'] as string | undefined) ?? 'voice-segments');
    const mp3Count  = fs.existsSync(segDir)
      ? fs.readdirSync(segDir).filter(f => f.endsWith('.mp3')).length
      : 0;
    if (mp3Count > 0) {
      vs['voiceReady'] = true;
      fs.writeFileSync(VOICE_PATH, JSON.stringify(vs, null, 2), 'utf-8');
      console.log(`  ✓  Voice ready: ${mp3Count} segments generated`);
    } else {
      console.warn('  ⚠️  voice:only ran but no MP3s found — composition will render silently.');
    }
  } catch (err) {
    console.warn(`  ⚠️  Voice generation failed: ${(err as Error).message}`);
    console.warn('      Run  npm run voice:only  manually to retry.');
  }

  console.log(`\n  ✅  Done! Open ${PRODUCT_NAME} in Remotion Studio:\n      npm start\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
