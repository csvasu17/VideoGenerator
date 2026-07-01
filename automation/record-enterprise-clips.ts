/**
 * record-enterprise-clips.ts
 *
 * Records actual screen-recording video clips of every navigable section in
 * the app (APP_URL from .env) and rebuilds demo-package.json so each scene
 * references a real recording instead of a static screenshot.
 *
 * Playwright navigates to each page, performs realistic interactions (scroll,
 * click tabs, hover charts) while Playwright's built-in video recorder captures
 * the whole session as a WebM/MP4 clip.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json automation/record-enterprise-clips.ts
 *
 * Output:
 *   out/localhost/recordings/<slug>.mp4          — video clip per section
 *   out/localhost/recordings/<slug>-frame.png    — screenshot frame for AI analysis
 *   out/localhost/demo-package.json              — rebuilt with recordingPath per scene
 */

import { chromium }                              from 'playwright';
import type { Browser, BrowserContext, Page }    from 'playwright';
import * as fs                                   from 'fs';
import * as path                                 from 'path';
import * as dotenv                               from 'dotenv';
import { AzureOpenAI }                           from 'openai';
import { ensureSession, createAuthContext }      from './utils/session';
import { OUT_DIR, SCREEN_FIT }                   from './config';
import { getVideoInfo }                          from './utils/ffprobe';
import type { RecordingConfig }                  from './types';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

// ─── Config ───────────────────────────────────────────────────────────────────

const APP_URL           = process.env['APP_URL']                ?? '';
const USERNAME          = process.env['APP_USERNAME']           ?? '';
const PASSWORD          = process.env['APP_PASSWORD']           ?? '';
const USERNAME_2        = process.env['APP_USERNAME_2']         ?? USERNAME;
const PASSWORD_2        = process.env['APP_PASSWORD_2']         ?? PASSWORD;
const LOGIN_TYPE        = (process.env['LOGIN_TYPE'] === '2' ? 2 : 1) as 1 | 2;
const QUICK_ACCESS_IDX  = Number(process.env['APP_QUICK_ACCESS_INDEX'] ?? '0');
const SHOW_AVATAR       = (process.env['SHOW_AVATAR'] ?? 'true').toLowerCase() !== 'false';

// cardIndex → credentials mapping for form-based (LOGIN_TYPE=1) apps with multiple roles
const ROLE_CREDENTIALS: Record<number, { username: string; password: string }> = {
  0: { username: USERNAME,   password: PASSWORD   },  // primary   (admin)
  1: { username: USERNAME_2, password: PASSWORD_2 },  // secondary (end user)
};

const RECORDINGS_DIR = path.join(OUT_DIR, 'recordings');
const PKG_PATH       = path.join(OUT_DIR, 'demo-package.json');

const BROLL_SEC    = 6;
const PRODUCT_SEC  = 12;
const BENEFIT_SEC  = 18;
const PRESENTER_SEC = 16;
const FPS          = 30;
const VIEWPORT     = { width: 1920, height: 1080 };

// ─── Azure OpenAI ─────────────────────────────────────────────────────────────

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

// ─── Notification suppression CSS ─────────────────────────────────────────────

const SUPPRESS_CSS = `
  [class*="alert"][class*="panel"],[class*="Alert"][class*="Panel"],
  [class*="notification"][class*="panel"],[class*="Notification"][class*="Panel"],
  [class*="notification-drawer"],[class*="NotificationDrawer"],
  [class*="alerts-drawer"],[class*="AlertsDrawer"],
  [class*="alert-sidebar"],[class*="AlertSidebar"],
  [class*="side-alert"],[class*="SideAlert"],
  [class*="toast-container"],[class*="ToastContainer"],
  [class*="toast"]:not(button),[class*="snackbar"],
  [data-testid*="alert-panel"],[aria-label="Alerts"],[aria-label="Notifications"],
  .alerts-panel,.notification-panel {
    display:none!important; visibility:hidden!important;
    opacity:0!important; pointer-events:none!important;
  }
`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || '';
}

interface PageLink { id: string; url: string; label: string; }

async function suppressPopups(page: Page): Promise<void> {
  await page.addStyleTag({ content: SUPPRESS_CSS }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
  for (const sel of [
    'button[aria-label*="close" i]:visible',
    'button[aria-label*="dismiss" i]:visible',
    '[class*="closeBtn"]:visible',
    '[class*="dismiss"]:visible',
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

async function discoverPageLinks(page: Page, origin: string): Promise<PageLink[]> {
  const found = new Map<string, PageLink>();

  const raw: { href: string; text: string; inNav: boolean }[] = await page.$$eval('a', (els) =>
    (els as HTMLAnchorElement[]).map(el => {
      let node: Element | null = el;
      let inNav = false;
      for (let i = 0; i < 8 && node; i++) {
        const tag = node.tagName?.toLowerCase() || '';
        const cls = (node.className?.toString() || '').toLowerCase();
        if (tag === 'nav' || tag === 'aside' || cls.includes('sidebar') ||
            cls.includes('sidenav') || cls.includes('navigation') ||
            cls.includes('menu') || cls.includes('navbar')) { inNav = true; break; }
        node = node.parentElement;
      }
      return {
        href: el.href,
        text: (el.textContent || el.getAttribute('aria-label') || el.title || '').trim().replace(/\s+/g, ' '),
        inNav,
      };
    }),
  ).catch(() => []);

  // Prioritise nav links; collect up to 15 unique pages
  const nav: PageLink[]   = [];
  const other: PageLink[] = [];

  for (const { href, text, inNav } of raw) {
    if (!href?.startsWith(origin)) continue;
    if (!text || text.length < 2 || text.length > 60) continue;
    const u = href.toLowerCase();
    if (u.includes('login') || u.includes('logout') || u.includes('signup') ||
        u.includes('#') || u === origin || u === origin + '/') continue;
    if (found.has(href)) continue;
    const id = slugify(text);
    if (!id) continue;
    found.set(href, { id, url: href, label: text });
    if (inNav) nav.push({ id, url: href, label: text });
    else       other.push({ id, url: href, label: text });
  }

  return [...nav, ...other].slice(0, 15);
}

async function performFullInteraction(page: Page): Promise<void> {
  await suppressPopups(page);

  // 1. Slow scroll to bottom then back
  try {
    const h = await page.evaluate(() => document.body.scrollHeight);
    const steps = Math.min(Math.ceil(h / 300), 8);
    for (let i = 1; i <= steps; i++) {
      await page.evaluate(
        (y: number) => window.scrollTo({ top: y, behavior: 'smooth' }),
        (i / steps) * h * 0.85,
      );
      await page.waitForTimeout(700);
    }
  } catch {}

  // 2. Click through tab groups
  for (const sel of [
    '[role="tab"]:not([aria-selected="true"])',
    '[class*="Tab"]:not([class*="active"]):not([class*="tab-panel"])',
  ]) {
    try {
      const tabs = await page.$$(sel);
      for (const t of tabs.slice(0, 6)) {
        try {
          await t.scrollIntoViewIfNeeded();
          await t.click();
          await page.waitForTimeout(1200);
        } catch {}
      }
      if (tabs.length > 0) break;
    } catch {}
  }

  // 3. Hover over charts/cards to reveal tooltips
  for (const sel of [
    '[class*="chart"]', '[class*="Chart"]',
    '[class*="Card"]:not([class*="nav"])',
    '[data-tooltip]', 'circle[r]', 'rect[width]',
  ]) {
    try {
      const els = await page.$$(sel);
      for (const el of els.slice(0, 4)) {
        try { await el.hover(); await page.waitForTimeout(400); } catch {}
      }
      if (els.length > 0) break;
    } catch {}
  }

  // 4. Expand any collapsed accordions
  for (const sel of [
    '[aria-expanded="false"]',
    'details:not([open]) summary',
  ]) {
    try {
      const els = await page.$$(sel);
      for (const el of els.slice(0, 3)) {
        try { await el.scrollIntoViewIfNeeded(); await el.click(); await page.waitForTimeout(600); } catch {}
      }
    } catch {}
  }

  await suppressPopups(page);

  // 5. Scroll back to top
  try {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await page.waitForTimeout(600);
  } catch {}

  await suppressPopups(page);
}

// ─── AI analysis ──────────────────────────────────────────────────────────────

async function analyzeFrame(
  framePath:  string,
  userRole?:  string,
  targetUrl?: string,
): Promise<{
  featureTitle: string;
  salesHook:    string;
  narration:    string;
}> {
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
  if (APP_CONTEXT)   sections.push(`\n\nPRODUCT CONTEXT:\n${APP_CONTEXT}`);
  if (userRole)      sections.push(`\n\nACTIVE USER ROLE: The logged-in user is "${userRole}". Frame all narration from this persona's goals and pain points.`);
  if (pagePurpose)   sections.push(`\n\nCURRENT PAGE: ${pagePurpose}`);
  if (APP_GLOSSARY)  sections.push(`\n\nDOMAIN GLOSSARY (use these exact terms in narration):\n${APP_GLOSSARY}`);
  sections.push(`\n\nGiven a product screenshot, output a JSON object (no markdown fences) with exactly:
{
  "featureTitle": "short 2-4 word feature name",
  "salesHook": "compelling 6-10 word hook focusing on business value for the active user role",
  "narration": "one paragraph (2-3 sentences, ~25 words) — address the active user role by name if known, explain what this screen lets them do, and state the specific pain it eliminates"
}
Be specific to what you see. Use domain glossary terms accurately.`);

  const response = await azureClient.chat.completions.create({
    model:      process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
    max_tokens: 500,
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
  });

  const raw = response.choices[0]?.message?.content ?? '{}';
  try {
    const p = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, ''));
    return {
      featureTitle: p.featureTitle ?? 'Platform Feature',
      salesHook:    p.salesHook    ?? 'Streamline your operations instantly.',
      narration:    p.narration    ?? 'This feature improves operational efficiency across your team.',
    };
  } catch {
    return {
      featureTitle: 'Platform Feature',
      salesHook:    'Streamline your operations instantly.',
      narration:    'This feature improves operational efficiency across your team.',
    };
  }
}

// ─── Recording plan ───────────────────────────────────────────────────────────
// cardIndex: 0=George(Customer), 1=Alice(SupportL1), 2=Bob(SupportL2), 3=ITAdmin
// navItem: sidebar span text to click — null means record from the dashboard.
// actions: optional click/wait steps to perform AFTER the page loads, capturing
//          a specific workflow (e.g. open a ticket detail, fill a form step, etc.)

interface ClipAction {
  type:         'click' | 'wait' | 'hover' | 'type' | 'press' | 'navigate' | 'evaluate' | 'waitFor' | 'mouseMove';
  selector?:    string;
  text?:        string;
  value?:       string;
  waitAfterMs?: number;
  /** If true, attempts a force-click bypassing Playwright visibility check (for CSS-hidden elements) */
  force?:       boolean;
}

interface ClipPlan {
  cardIndex:          number;
  role:               string;
  id:                 string;
  navItem:            string | null;
  navBaseUrl?:        string;
  label:              string;
  /** Desired scene duration in the output video (seconds). Defaults to PRODUCT_SEC. */
  durationSec?:       number;
  /** Seek offset into the recording before playing in Remotion (seconds). Skips loading/wait time. */
  recordingStartSec?: number;
  /** Record without storageState — navigates directly to APP_URL so login page is visible. */
  showLoginPage?:     boolean;
  /** Skip performFullInteraction after custom actions (use when actions cover all exploration) */
  skipInteraction?:   boolean;
  actions?:           ClipAction[];
}

const ADMIN_BASE = `${APP_URL}/admin`;
const CHAT_INPUT = 'textarea, input[placeholder*="Ask" i], input[placeholder*="question" i], input[placeholder*="query" i], [contenteditable="true"]';

const RECORDING_PLAN: ClipPlan[] = [

  // ── 0. Login Page — shows credentials being entered before logging in ──────
  {
    cardIndex: 1, role: 'End User', id: 'login-page', navItem: null, label: 'Login Page',
    durationSec: 10,
    showLoginPage: true,
    skipInteraction: true,
    actions: [
      { type: 'wait',  waitAfterMs: 2000 },
      { type: 'click', selector: 'input[type="email"], input[name="username"], input[placeholder*="user" i], input[type="text"]', waitAfterMs: 500 },
      { type: 'type',  selector: 'input[type="email"], input[name="username"], input[placeholder*="user" i], input[type="text"]', value: 'user', waitAfterMs: 500 },
      { type: 'click', selector: 'input[type="password"]', waitAfterMs: 300 },
      { type: 'type',  selector: 'input[type="password"]', value: 'user123', waitAfterMs: 500 },
      { type: 'wait',  waitAfterMs: 3000 },
    ],
  },

  // ── 1. AI Chat: type query → wait for response → Save Widget → modal ──────
  {
    cardIndex: 1, role: 'End User', id: 'chat-interface', navItem: null, label: 'AI Chat Interface',
    durationSec: 45,
    recordingStartSec: 47,   // seek to 2s before AI response appears at t≈49s (skips ~40s wait)
    actions: [
      { type: 'wait',  waitAfterMs: 2000 },
      { type: 'click', selector: CHAT_INPUT, waitAfterMs: 800 },
      { type: 'type',  selector: CHAT_INPUT, value: 'Show the top 5 most recently registered patient details', waitAfterMs: 600 },
      { type: 'press', value: 'Enter', waitAfterMs: 40000 },   // wait 40s — generous for slow AI
      { type: 'wait',  waitAfterMs: 3000 },                    // let table fully render
      // Scroll to bottom so the response card is at a consistent screen position
      { type: 'evaluate', value: 'document.querySelector("[class*=chat],[class*=Chat],[class*=message],[class*=Message],main,#root")?.scrollTo(0,99999) || window.scrollTo(0,document.body.scrollHeight)', waitAfterMs: 1000 },
      // Wide vertical sweep — covers wherever response card landed after scroll
      { type: 'mouseMove', value: '960,700', waitAfterMs: 200 },
      { type: 'mouseMove', value: '1100,650', waitAfterMs: 200 },
      { type: 'mouseMove', value: '1050,600', waitAfterMs: 200 },
      { type: 'mouseMove', value: '960,550', waitAfterMs: 200 },
      { type: 'mouseMove', value: '1100,500', waitAfterMs: 200 },
      { type: 'mouseMove', value: '1050,450', waitAfterMs: 300 },
      { type: 'mouseMove', value: '960,400', waitAfterMs: 300 },
      { type: 'waitFor', selector: 'button.widget-save-icon', value: '8000', waitAfterMs: 400 },
      { type: 'click', selector: 'button.widget-save-icon', force: true, waitAfterMs: 2500 },
      { type: 'wait',  waitAfterMs: 1000 },
      { type: 'click', text: 'Save Widget', waitAfterMs: 3000 },
    ],
  },

  // ── 2. BI Dashboard — all charts ──────────────────────────────────────────
  {
    cardIndex: 1, role: 'End User', id: 'bi-dashboard', navItem: null, label: 'BI Dashboard',
    durationSec: 15,
    actions: [
      { type: 'navigate', value: `${APP_URL}/dashboard`, waitAfterMs: 4000 },
      { type: 'wait', waitAfterMs: 2000 },
    ],
  },

  // ── 3. Admin Panel — ONE continuous recording through ALL sections ─────────
  //   Starts at /admin (Dashboard), then clicks each sidebar item in sequence.
  //   No re-loading dashboard between sections — smooth navigation throughout.
  {
    cardIndex: 0, role: 'Admin', id: 'admin-panel', navItem: null, navBaseUrl: ADMIN_BASE, label: 'Admin Panel',
    durationSec: 55,
    skipInteraction: true,   // custom actions cover all exploration; skip performFullInteraction
    actions: [
      { type: 'wait',  waitAfterMs: 4000 },                                      // Dashboard loads
      { type: 'click', text: 'Schema Explorer',  waitAfterMs: 5000 },            // → Schema Explorer
      { type: 'click', text: 'Column Mapper',    waitAfterMs: 5000 },            // → Column Mapper
      { type: 'click', text: 'Column Lookups',   waitAfterMs: 5000 },            // → Column Lookups
      { type: 'click', text: 'Few-Shot Learning',waitAfterMs: 5000 },            // → Few-Shot Learning
      { type: 'click', text: 'Query Review',     waitAfterMs: 5000 },            // → Query Review
      { type: 'click', text: 'Schema Chat',      waitAfterMs: 5000 },            // → Schema Chat
      { type: 'click', text: 'Role Management',  waitAfterMs: 5000 },            // → Role Management
      { type: 'click', text: 'Token Usage',      waitAfterMs: 5000 },            // → Token Usage
      { type: 'click', text: 'Settings',         waitAfterMs: 4000 },            // → Settings
    ],
  },
];

// ─── URL discovery (no recording) ────────────────────────────────────────────
// Navigates through every nav item WITHOUT recording to capture the real URL for
// each clip. The recording pass then jumps directly to that URL — eliminating the
// "dashboard loads first" problem.

async function discoverTargetUrls(
  browser:   Browser,
  roleCache: Map<number, { storageStatePath: string; postLoginUrl: string }>,
): Promise<Map<string, string>> {
  const urlMap = new Map<string, string>();

  // Collect unique (cardIndex, navItem) pairs
  const toDiscover = RECORDING_PLAN.filter(e => e.navItem !== null);
  const uniquePairs = new Map<string, { cardIndex: number; navItem: string; ids: string[] }>();
  for (const e of RECORDING_PLAN) {
    const key = `${e.cardIndex}::${e.navItem ?? '__dash__'}`;
    if (!uniquePairs.has(key)) {
      uniquePairs.set(key, { cardIndex: e.cardIndex, navItem: e.navItem ?? '', ids: [] });
    }
    uniquePairs.get(key)!.ids.push(e.id);
  }

  for (const [, { cardIndex, navItem, ids }] of uniquePairs) {
    const session = roleCache.get(cardIndex);
    if (!session) continue;

    if (!navItem) {
      // Dashboard entries — use postLoginUrl directly
      for (const id of ids) urlMap.set(id, session.postLoginUrl);
      continue;
    }

    const ctx = await browser.newContext({
      storageState:      session.storageStatePath,
      viewport:          VIEWPORT,
      ignoreHTTPSErrors: true,
    });
    try {
      const page = await ctx.newPage();
      await page.goto(session.postLoginUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(1200);

      const navSpan = page.locator('nav span').filter({ hasText: new RegExp(`^${navItem}$`) });
      const count   = await navSpan.count().catch(() => 0);
      if (count > 0) {
        await navSpan.first().click();
        await page.waitForTimeout(2000);
        const discovered = page.url();
        for (const id of ids) urlMap.set(id, discovered);
        console.log(`     🔍  [${navItem}] → ${discovered}`);
      } else {
        // nav not found — fall back to dashboard URL
        for (const id of ids) urlMap.set(id, session.postLoginUrl);
        console.log(`     ⚠️  [${navItem}] not found — using dashboard URL`);
      }
      await page.close();
    } catch (e) {
      console.warn(`     ⚠️  discover [${navItem}]: ${(e as Error).message?.slice(0, 60)}`);
      for (const id of ids) urlMap.set(id, session.postLoginUrl);
    } finally {
      await ctx.close().catch(() => {});
    }
  }

  return urlMap;
}

// ─── Custom action executor ───────────────────────────────────────────────────

async function executeActions(page: Page, actions: ClipAction[]): Promise<void> {
  for (const action of actions) {
    try {
      if (action.type === 'wait') {
        await page.waitForTimeout(action.waitAfterMs ?? 1000);

      } else if (action.type === 'click') {
        let clicked = false;
        // Try by text first (most reliable for table rows / buttons)
        if (action.text) {
          const el = page.locator(`text=${action.text}`).first();
          if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
            await el.scrollIntoViewIfNeeded().catch(() => {});
            await el.click({ timeout: 2000 });
            clicked = true;
          }
        }
        // Fall back to CSS selector
        if (!clicked && action.selector) {
          for (const sel of action.selector.split(',').map(s => s.trim())) {
            try {
              const el = page.locator(sel).first();
              if (await el.isVisible({ timeout: 1200 }).catch(() => false)) {
                await el.scrollIntoViewIfNeeded().catch(() => {});
                await el.click({ timeout: 2000 });
                clicked = true;
                break;
              } else if (action.force) {
                // Force-click even when hidden (e.g. opacity:0 hover-reveal buttons)
                const count = await el.count().catch(() => 0);
                if (count > 0) {
                  await el.scrollIntoViewIfNeeded().catch(() => {});
                  await el.click({ force: true, timeout: 3000 }).catch(() => {});
                  clicked = true;
                  break;
                }
              }
            } catch {}
          }
        }
        if (!clicked) console.log(`        ⚠️  action:click — no element found`);
        if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);

      } else if (action.type === 'hover') {
        if (action.selector) {
          const el = page.locator(action.selector).first();
          // force: true lets Playwright move the mouse even to non-visible elements
          await el.hover({ timeout: 3000, force: true }).catch(() => {});
        }
        if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);

      } else if (action.type === 'type') {
        if (action.selector && action.value !== undefined) {
          for (const sel of action.selector.split(',').map(s => s.trim())) {
            try {
              const el = page.locator(sel).first();
              if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
                await el.scrollIntoViewIfNeeded().catch(() => {});
                await el.click({ timeout: 1500 }).catch(() => {});
                await el.type(action.value, { delay: 60 });
                break;
              }
            } catch {}
          }
        }
        if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);

      } else if (action.type === 'press') {
        if (action.value) {
          await page.keyboard.press(action.value);
        }
        if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);

      } else if (action.type === 'navigate') {
        if (action.value) {
          await page.goto(action.value, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
        }
        if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);

      } else if (action.type === 'mouseMove') {
        // Move physical cursor to x,y — triggers real browser mouse events (React onMouseEnter etc.)
        if (action.value) {
          const parts = action.value.split(',').map(s => parseInt(s.trim(), 10));
          const x = parts[0] ?? 0;
          const y = parts[1] ?? 0;
          await page.mouse.move(x, y);
        }
        if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);

      } else if (action.type === 'evaluate') {
        // Run arbitrary JS in the browser context (e.g. dispatch synthetic mouse events)
        if (action.value) {
          await page.evaluate(action.value).catch(() => {});
        }
        if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);

      } else if (action.type === 'waitFor') {
        // Wait for a selector to appear in the DOM before continuing
        if (action.selector) {
          const timeoutMs = action.value ? parseInt(action.value, 10) : 15000;
          await page.waitForSelector(action.selector, { timeout: timeoutMs }).catch(() => {});
        }
        if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);
      }
    } catch (e) {
      console.log(`        ⚠️  action:${action.type} failed — ${(e as Error).message?.slice(0, 50)}`);
    }
  }
}

// ─── Per-role login helper ─────────────────────────────────────────────────────

const TMP_DIR_MULTI = path.resolve(__dirname, '../.tmp/multi-role');

async function loginRole(
  browser:   Browser,
  cardIndex: number,
): Promise<{ storageStatePath: string; postLoginUrl: string }> {
  const storageStatePath = path.join(TMP_DIR_MULTI, `session-role-${cardIndex}.json`);
  fs.mkdirSync(TMP_DIR_MULTI, { recursive: true });

  const ctx  = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 40_000 });
  await page.waitForTimeout(3000);

  if (LOGIN_TYPE === 2) {
    await page.locator('.quick-access-card').nth(QUICK_ACCESS_IDX).click();
    await page.waitForTimeout(700);
    await page.locator('button[type="submit"], .signin-btn').first().click();
  } else {
    const userSel = 'input[type="email"], input[name="username"], input[name="email"], input[placeholder*="user" i], input[placeholder*="email" i], #username, #email, input[type="text"]:first-of-type';
    const passSel = 'input[type="password"], #password';
    const btnSel  = 'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign in"), button:has-text("Log in")';
    const creds = ROLE_CREDENTIALS[cardIndex] ?? { username: USERNAME, password: PASSWORD };
    await page.waitForSelector(userSel, { timeout: 20_000 });
    await page.fill(userSel, creds.username);
    await page.waitForTimeout(300);
    await page.fill(passSel, creds.password);
    await page.waitForTimeout(400);
    await page.click(btnSel);
  }

  const loginPageUrl = page.url();
  await Promise.race([
    page.waitForURL(url => url.href !== loginPageUrl, { timeout: 20_000 }),
    page.waitForTimeout(12000),
  ]).catch(() => {});

  await page.waitForTimeout(2000);
  const postLoginUrl = page.url();

  await ctx.storageState({ path: storageStatePath });
  await ctx.close();

  return { storageStatePath, postLoginUrl };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface RecordedClip {
  id:                 string;
  label:              string;
  url:                string;
  role?:              string;
  videoPath:          string;
  framePath:          string;
  duration:           number;
  durationSec?:       number;
  recordingStartSec?: number;
}

async function main(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  🎬  Enterprise Recording — Multi-Role Deep Analysis');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (!APP_URL) {
    console.error('  ✗  APP_URL is not set in .env'); process.exit(1);
  }

  console.log(`  App     : ${APP_URL}`);
  console.log(`  Login   : ${LOGIN_TYPE === 2 ? `Quick Access (card ${QUICK_ACCESS_IDX})` : 'Form login'} — ${[...new Set(RECORDING_PLAN.map(e => e.cardIndex))].length} role(s)`);
  console.log(`  Clips   : ${RECORDING_PLAN.length} screens`);
  console.log(`  Out     : ${RECORDINGS_DIR}\n`);

  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

  const isHeadless = process.env['HEADLESS'] === '1' || process.env['CI'] === 'true';
  const browser: Browser = await chromium.launch({
    headless: isHeadless,
    slowMo:   isHeadless ? 30 : 50,
    args: ['--disable-web-security', '--disable-features=VizDisplayCompositor'],
  });

  const clips: RecordedClip[] = [];

  // ── Step 1: Login once per unique role ────────────────────────────────────
  const roleCache = new Map<number, { storageStatePath: string; postLoginUrl: string }>();
  const uniqueCards = [...new Set(RECORDING_PLAN.map(e => e.cardIndex))];

  try {
    console.log('  🔐  Logging in for each role...\n');
    for (const cardIndex of uniqueCards) {
      const roleName = RECORDING_PLAN.find(e => e.cardIndex === cardIndex)?.role ?? String(cardIndex);
      process.stdout.write(`     Card ${cardIndex} (${roleName}) ... `);
      try {
        const session = await loginRole(browser, cardIndex);
        roleCache.set(cardIndex, session);
        console.log(`✅  ${session.postLoginUrl}`);
      } catch (e) {
        console.log(`❌  ${(e as Error).message?.slice(0, 70)}`);
      }
    }
    console.log('');

    // ── Step 2: Discover target URLs (no-recording pass) ─────────────────────
    console.log('  🔍  Discovering page URLs (no recording)...\n');
    const navUrlMap = await discoverTargetUrls(browser, roleCache);
    console.log('');

    // ── Step 3: Record every plan entry ──────────────────────────────────────
    console.log('  📹  Recording clips...\n');

    for (let i = 0; i < RECORDING_PLAN.length; i++) {
      const entry   = RECORDING_PLAN[i];
      const session = roleCache.get(entry.cardIndex);
      if (!session) {
        console.warn(`     ⚠️  [${i + 1}/${RECORDING_PLAN.length}] Skipping ${entry.id} — no session for role ${entry.role}`);
        continue;
      }

      // Use navBaseUrl (if defined) or the discovered URL so recording starts at the right page
      const targetUrl = entry.navBaseUrl ?? navUrlMap.get(entry.id) ?? session.postLoginUrl;

      console.log(`  [${i + 1}/${RECORDING_PLAN.length}] 📹  ${entry.role.padEnd(12)} › ${entry.label}`);
      console.log(`        URL: ${targetUrl}`);

      const ctx: BrowserContext = await browser.newContext({
        // showLoginPage entries start with a fresh session so the login form is visible
        ...(entry.showLoginPage ? {} : { storageState: session.storageStatePath }),
        viewport:          VIEWPORT,
        ignoreHTTPSErrors: true,
        recordVideo:       { dir: RECORDINGS_DIR, size: VIEWPORT },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      });

      // Inject notification suppressor on every page
      await ctx.addInitScript(({ css }: { css: string }) => {
        const s = document.createElement('style');
        s.textContent = css;
        (document.head || document.documentElement).appendChild(s);
      }, { css: SUPPRESS_CSS });

      try {
        const page = await ctx.newPage();

        // Navigate to the target page — login page entries go to APP_URL (no session)
        const navUrl = entry.showLoginPage ? APP_URL : targetUrl;
        await page.goto(navUrl, { waitUntil: 'domcontentloaded', timeout: 40_000 });
        await page.waitForTimeout(1800);
        await suppressPopups(page);

        // Skip if session expired and we landed back on login (skip only for non-login clips)
        if (!entry.showLoginPage) {
          const onLoginPage = await page.locator('input[type="password"]').isVisible({ timeout: 800 }).catch(() => false);
          if (onLoginPage) {
            console.log(`        ⚠️  Session expired — skipping`);
            const skipVid = await page.video()?.path();
            await page.close();
            await ctx.close();
            if (skipVid) try { fs.unlinkSync(skipVid); } catch {}
            continue;
          }
        }

        // Execute custom workflow actions if defined (e.g. click into a ticket)
        if (entry.actions && entry.actions.length > 0) {
          console.log(`        ▶  executing ${entry.actions.length} custom action(s)`);
          await executeActions(page, entry.actions);
        }

        // Full interaction — scroll, click tabs, hover charts (skipped if skipInteraction: true)
        if (!entry.skipInteraction) {
          await performFullInteraction(page);
        }

        // Screenshot for AI analysis
        const framePath = path.join(RECORDINGS_DIR, `${entry.id}-frame.png`);
        await page.screenshot({ path: framePath, type: 'png' });
        await page.waitForTimeout(1500);

        const vidRaw = await page.video()?.path();
        await page.close();
        await ctx.close();

        if (vidRaw && fs.existsSync(vidRaw)) {
          const dest = path.join(RECORDINGS_DIR, `${entry.id}.mp4`);
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
          fs.renameSync(vidRaw, dest);
          const info = getVideoInfo(dest);
          clips.push({ id: entry.id, label: entry.label, url: session.postLoginUrl, role: entry.role, videoPath: dest, framePath, duration: info.duration, durationSec: entry.durationSec, recordingStartSec: entry.recordingStartSec });
          console.log(`        ✅  ${entry.id}.mp4  (${info.duration.toFixed(1)}s)\n`);
        } else {
          console.log(`        ⚠️  No video produced\n`);
          await ctx.close().catch(() => {});
        }

      } catch (e) {
        console.warn(`        ❌  ${(e as Error).message?.slice(0, 80)}\n`);
        await ctx.close().catch(() => {});
      }
    }

  } finally {
    try { await browser.close(); } catch {}
  }

  console.log(`  ✅  ${clips.length} clip(s) recorded\n`);

  if (clips.length === 0) {
    console.error('  ✗  No clips recorded. Check APP_URL and credentials.\n');
    process.exit(1);
  }

  // ── AI Analysis ───────────────────────────────────────────────────────────────
  console.log('  🔍  Analysing clip frames with GPT-4.1 vision...\n');

  const SKIP_KW = /login|logout|sign.?in|register|settings|profile|account|password|reset|forgot/i;

  interface AnalyzedClip extends RecordedClip {
    featureTitle: string;
    salesHook:    string;
    narration:    string;
  }

  const analyzed: AnalyzedClip[] = [];

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];

    // Admin panel: hardcode analysis — GPT vision sees the last screenshot (Settings page)
    // which generates wrong titles. The admin clip covers all 10 sections so use fixed text.
    if (clip.id === 'admin-panel') {
      console.log(`  [${i + 1}/${clips.length}] 📖  admin-panel — hardcoded analysis`);
      analyzed.push({
        ...clip,
        featureTitle: 'Admin Panel',
        salesHook:    'Complete platform control — from schema to security',
        narration:    'The Admin Panel gives administrators complete control over Cognify One. Configure schemas, train the AI with custom examples, review generated SQL, manage role-based access, and monitor token usage — all from one unified interface.',
      });
      continue;
    }

    // Login page: use app overview narration instead of AI vision
    if (clip.id === 'login-page') {
      const productName  = (process.env['APP_PRODUCT_NAME'] ?? 'The Platform').replace(/_/g, ' ');
      const contextText  = process.env['APP_CONTEXT_TEXT'] ?? '';
      const overviewText = contextText
        ? contextText.split(/\.\s+/).slice(0, 2).join('. ') + '.'
        : `${productName} lets business users query any database in plain English and get instant AI-powered insights — no SQL knowledge required.`;
      console.log(`  [${i + 1}/${clips.length}] 📖  login-page — app overview narration`);
      analyzed.push({
        ...clip,
        featureTitle: productName,
        salesHook:    'AI-powered BI for every business user — no SQL needed',
        narration:    overviewText,
      });
      continue;
    }

    if (SKIP_KW.test(clip.url) || SKIP_KW.test(clip.label)) {
      console.log(`  [${i + 1}/${clips.length}] ⏭  Skipping ${clip.id} (auth/settings page)`);
      continue;
    }

    process.stdout.write(`  [${i + 1}/${clips.length}] 🔍  ${clip.id} — ${clip.label} ... `);

    try {
      if (!fs.existsSync(clip.framePath)) {
        console.log(`⚠️  no frame`);
        analyzed.push({ ...clip, featureTitle: clip.label, salesHook: `Explore ${clip.label}`, narration: `${clip.label} provides key functionality for your team.` });
        continue;
      }
      const ai = await analyzeFrame(clip.framePath, clip.role, clip.url);
      console.log(`"${ai.featureTitle}"`);
      analyzed.push({ ...clip, ...ai });
    } catch (e) {
      console.log(`⚠️  AI error`);
      analyzed.push({ ...clip, featureTitle: clip.label, salesHook: `Explore ${clip.label}`, narration: `${clip.label} provides key functionality for your team.` });
    }
  }

  console.log('');

  // ── Build demo-package.json ────────────────────────────────────────────────
  console.log('  📦  Building demo-package.json...');

  const existingPkg = fs.existsSync(PKG_PATH)
    ? JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'))
    : {};

  const brollScenes: any[] = existingPkg.brollScenes?.length
    ? existingPkg.brollScenes
    : [
        { id: 'broll-0', from: 0,                   durationInFrames: BROLL_SEC * FPS, subtitle: 'Support teams are drowning in tickets',              category: 'generic' },
        { id: 'broll-1', from: 1 * BROLL_SEC * FPS,  durationInFrames: BROLL_SEC * FPS, subtitle: 'Every minute of delay costs customer trust',         category: 'generic' },
        { id: 'broll-2', from: 2 * BROLL_SEC * FPS, durationInFrames: BROLL_SEC * FPS, subtitle: 'Manual triage is slow, inconsistent, and error-prone', category: 'generic' },
        { id: 'broll-3', from: 3 * BROLL_SEC * FPS, durationInFrames: BROLL_SEC * FPS, subtitle: 'Escalations fall through the cracks',                 category: 'generic' },
        { id: 'broll-4', from: 4 * BROLL_SEC * FPS, durationInFrames: BROLL_SEC * FPS, subtitle: 'Jira, email, chat — too many disconnected tools',     category: 'generic' },
      ];

  const brollTotal = brollScenes.reduce((s: number, b: any) => s + (b.durationInFrames ?? 0), 0);
  let cursor = brollTotal;

  const scenes = analyzed.map((clip, idx) => {
    const dur  = ((clip as any).durationSec ?? PRODUCT_SEC) * FPS;
    const from = cursor;
    cursor += dur;
    // Paths relative to Remotion's public-dir (out/localhost/)
    const relVideo = `recordings/${path.basename(clip.videoPath)}`;
    const relFrame = `recordings/${path.basename(clip.framePath)}`;
    return {
      id:               `scene-${idx + 1}`,
      pageId:           clip.id,
      title:            clip.featureTitle,
      salesHook:        clip.salesHook,
      narration:        clip.narration,
      description:      clip.narration,
      screenshotPath:   relFrame,    // frame PNG (fallback / for AI)
      recordingPath:    relVideo,    // ← real screen recording clip
      from,
      durationInFrames: dur,
      ...(clip.recordingStartSec ? { recordingStartSec: clip.recordingStartSec } : {}),
      transition:       idx < analyzed.length - 1 ? { type: 'slide-left', durationInFrames: 12 } : null,
      nodeType:         '',
    };
  });

  const benefitSlideFrom   = cursor;
  const presenterCloseFrom = benefitSlideFrom + BENEFIT_SEC * FPS;
  const totalFrames        = presenterCloseFrom + PRESENTER_SEC * FPS;

  // When SHOW_AVATAR=false: set src='' so the template condition (presenterSrc || presenterVideoSrc)
  // evaluates to falsy and the PresenterOverlay never renders.
  const presenterConfig = SHOW_AVATAR
    ? {
        ...(existingPkg.presenterConfig ?? {
          src:          'assets/presenter/presenter-default.png',
          widthFraction: 0.15,
          position:     'bottom-left',
        }),
        enabled: true,
      }
    : {
        src:          '',
        widthFraction: 0.15,
        position:     'bottom-left',
        enabled:      false,
      };
  const benefitSlide  = {
    ...(existingPkg.benefitSlide ?? {}),
    from: benefitSlideFrom, durationInFrames: BENEFIT_SEC * FPS,
    title: `${process.env['APP_PRODUCT_NAME'] ?? 'The Platform'} — Value Adds`,
  };
  const presenterClose = {
    ...(existingPkg.presenterClose ?? {}),
    from: presenterCloseFrom, durationInFrames: PRESENTER_SEC * FPS,
    presenterSrc: 'assets/presenter/presenter-default.png',
    tagline: existingPkg.presenterClose?.tagline ?? 'Turning data into decisions — at scale.',
  };

  const pkg = {
    ...existingPkg,
    composition: {
      ...(existingPkg.composition ?? {}),
      id:               'EnterpriseVideo',
      durationInFrames: totalFrames,
      fps:              FPS,
      width:            1920,
      height:           1080,
    },
    scenes,
    brollScenes,
    benefitSlide,
    presenterClose,
    presenterConfig,
    meta: { ...(existingPkg.meta ?? {}), templateId: 'enterprise' },
    screenFit: SCREEN_FIT,
  };

  fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2), 'utf-8');

  const totalSec = Math.round(totalFrames / FPS);
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  ✅  Done!\n');
  console.log(`     Recordings : ${clips.length} clips saved to out/localhost/recordings/`);
  console.log(`     Scenes     : ${scenes.length}`);
  console.log(`     Duration   : ${totalSec}s  (${Math.floor(totalSec / 60)}m ${totalSec % 60}s)`);
  console.log(`     Package    : ${PKG_PATH}`);
  console.log('\n  Next steps:');
  console.log('    1. npx ts-node --project tsconfig.scripts.json automation/render-demo.ts');
  console.log('    2. npx ts-node --project tsconfig.scripts.json automation/generate-voice.ts');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(e => {
  console.error('\n💥 Fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
