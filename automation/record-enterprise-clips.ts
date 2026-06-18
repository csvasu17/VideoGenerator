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
import { getVideoInfo }                          from './utils/ffprobe';
import type { RecordingConfig }                  from './types';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

// ─── Config ───────────────────────────────────────────────────────────────────

const APP_URL           = process.env['APP_URL']                ?? '';
const USERNAME          = process.env['APP_USERNAME']           ?? '';
const PASSWORD          = process.env['APP_PASSWORD']           ?? '';
const LOGIN_TYPE        = (process.env['LOGIN_TYPE'] === '2' ? 2 : 1) as 1 | 2;
const QUICK_ACCESS_IDX  = Number(process.env['APP_QUICK_ACCESS_INDEX'] ?? '0');

const ROOT           = path.resolve(__dirname, '..');
const OUT_DIR        = path.join(ROOT, 'out', 'localhost');
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

async function analyzeFrame(framePath: string): Promise<{
  featureTitle: string;
  salesHook:    string;
  narration:    string;
}> {
  const b64 = fs.readFileSync(framePath).toString('base64');

  const response = await azureClient.chat.completions.create({
    model:      process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
    max_tokens: 400,
    messages: [
      {
        role: 'system',
        content: `You are a B2B SaaS demo video script writer. Given a product screenshot,
output a JSON object (no markdown fences) with exactly these fields:
{
  "featureTitle": "short 2-4 word feature name",
  "salesHook": "compelling 6-10 word hook focusing on business value visible in the screenshot",
  "narration": "one paragraph (2-3 sentences, ~25 words) explaining what this feature does and why it matters"
}
Be specific to what you see. No generic statements.`,
      },
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
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, ''));
    return {
      featureTitle: parsed.featureTitle ?? 'Platform Feature',
      salesHook:    parsed.salesHook    ?? 'Streamline your operations instantly.',
      narration:    parsed.narration    ?? 'This feature improves operational efficiency across your team.',
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
// Each entry maps to one screen recording clip.
// cardIndex: 0=George(Customer), 1=Alice(SupportL1), 2=Bob(SupportL2), 3=ITAdmin
// navItem: sidebar span text to click after login — null means stay on dashboard.

interface ClipPlan {
  cardIndex: number;
  role:      string;
  id:        string;
  navItem:   string | null;
  label:     string;
}

const RECORDING_PLAN: ClipPlan[] = [
  // ── IT Admin ──────────────────────────────────────────────────────────────
  { cardIndex: 3, role: 'IT Admin',   id: 'admin-dashboard',     navItem: null,              label: 'Admin Dashboard'     },
  { cardIndex: 3, role: 'IT Admin',   id: 'admin-customers',     navItem: 'Customers',       label: 'Customer Management' },
  { cardIndex: 3, role: 'IT Admin',   id: 'admin-users',         navItem: 'User Management', label: 'User Management'     },
  { cardIndex: 3, role: 'IT Admin',   id: 'admin-sla',           navItem: 'SLA Config',      label: 'SLA Configuration'   },
  { cardIndex: 3, role: 'IT Admin',   id: 'admin-analytics',     navItem: 'Analytics',       label: 'Analytics'           },
  // ── Support L2 (Bob — broadest support access) ────────────────────────────
  { cardIndex: 2, role: 'Support L2', id: 'support-dashboard',   navItem: null,              label: 'Support Dashboard'   },
  { cardIndex: 2, role: 'Support L2', id: 'support-all-tickets', navItem: 'All Tickets',     label: 'All Tickets'         },
  { cardIndex: 2, role: 'Support L2', id: 'support-my-ticket',   navItem: 'My Ticket',       label: 'My Assigned Tickets' },
  { cardIndex: 2, role: 'Support L2', id: 'support-jira',        navItem: 'Jira Hub',        label: 'Jira Integration'    },
  { cardIndex: 2, role: 'Support L2', id: 'support-create',      navItem: 'Create Ticket',   label: 'Create Ticket'       },
  // ── Customer (George) ─────────────────────────────────────────────────────
  { cardIndex: 0, role: 'Customer',   id: 'customer-dashboard',  navItem: null,              label: 'Customer Dashboard'  },
  { cardIndex: 0, role: 'Customer',   id: 'customer-tickets',    navItem: 'My Tickets',      label: 'My Tickets'          },
  { cardIndex: 0, role: 'Customer',   id: 'customer-products',   navItem: 'My Products',     label: 'My Products'         },
  { cardIndex: 0, role: 'Customer',   id: 'customer-create',     navItem: 'Create Ticket',   label: 'Create Ticket'       },
];

// ─── Per-role login helper ─────────────────────────────────────────────────────

const TMP_DIR_MULTI = path.resolve(__dirname, '../.tmp/multi-role');

async function loginRole(
  browser:   Browser,
  cardIndex: number,
): Promise<{ storageStatePath: string; postLoginUrl: string }> {
  const storageStatePath = path.join(TMP_DIR_MULTI, `session-role-${cardIndex}.json`);
  fs.mkdirSync(TMP_DIR_MULTI, { recursive: true });

  const loginUrl = APP_URL.replace(/\/$/, '') + '/login';
  const ctx  = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(1500);

  await page.locator('.quick-access-card').nth(cardIndex).click();
  await page.waitForTimeout(700);
  await page.locator('button[type="submit"], .signin-btn').first().click();

  await Promise.race([
    page.waitForURL(url => !url.href.includes('login'), { timeout: 20_000 }),
    page.waitForTimeout(6000),
  ]).catch(() => {});

  await page.waitForTimeout(2000);
  const postLoginUrl = page.url();

  await ctx.storageState({ path: storageStatePath });
  await ctx.close();

  return { storageStatePath, postLoginUrl };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface RecordedClip {
  id:        string;
  label:     string;
  url:       string;
  videoPath: string;
  framePath: string;
  duration:  number;
}

async function main(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  🎬  Enterprise Recording — Multi-Role Deep Analysis');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (!APP_URL) {
    console.error('  ✗  APP_URL is not set in .env'); process.exit(1);
  }

  console.log(`  App     : ${APP_URL}`);
  console.log(`  Login   : Quick Access — 4 roles`);
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

    // ── Step 2: Record every plan entry ──────────────────────────────────────
    console.log('  📹  Recording clips...\n');

    for (let i = 0; i < RECORDING_PLAN.length; i++) {
      const entry   = RECORDING_PLAN[i];
      const session = roleCache.get(entry.cardIndex);
      if (!session) {
        console.warn(`     ⚠️  [${i + 1}/${RECORDING_PLAN.length}] Skipping ${entry.id} — no session for role ${entry.role}`);
        continue;
      }

      console.log(`  [${i + 1}/${RECORDING_PLAN.length}] 📹  ${entry.role.padEnd(12)} › ${entry.label}`);

      const ctx: BrowserContext = await browser.newContext({
        storageState:      session.storageStatePath,
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

        // Navigate to the role's post-login dashboard
        await page.goto(session.postLoginUrl, { waitUntil: 'domcontentloaded', timeout: 40_000 });
        await page.waitForTimeout(2500);
        await suppressPopups(page);

        // If a specific nav item was requested, click it
        if (entry.navItem) {
          const navSpan = page.locator('nav span').filter({ hasText: new RegExp(`^${entry.navItem}$`) });
          const found   = await navSpan.count().catch(() => 0);
          if (found > 0) {
            await navSpan.first().click();
            await page.waitForTimeout(2500);
            await suppressPopups(page);
          } else {
            console.log(`        ⚠️  Nav item "${entry.navItem}" not found — recording dashboard`);
          }
        }

        // Skip if session expired and redirected to login
        const onLoginPage = await page.locator('input[type="password"]').isVisible({ timeout: 800 }).catch(() => false);
        if (onLoginPage) {
          console.log(`        ⚠️  Session expired — skipping`);
          const skipVid = await page.video()?.path();
          await page.close();
          await ctx.close();
          if (skipVid) try { fs.unlinkSync(skipVid); } catch {}
          continue;
        }

        // Full interaction — scroll, click tabs, hover charts
        await performFullInteraction(page);

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
          clips.push({ id: entry.id, label: entry.label, url: session.postLoginUrl, videoPath: dest, framePath, duration: info.duration });
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
      const ai = await analyzeFrame(clip.framePath);
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
    const dur  = PRODUCT_SEC * FPS;
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
      transition:       idx < analyzed.length - 1 ? { type: 'slide-left', durationInFrames: 12 } : null,
      nodeType:         '',
    };
  });

  const benefitSlideFrom   = cursor;
  const presenterCloseFrom = benefitSlideFrom + BENEFIT_SEC * FPS;
  const totalFrames        = presenterCloseFrom + PRESENTER_SEC * FPS;

  const presenterConfig = existingPkg.presenterConfig ?? {
    src: 'assets/presenter/presenter-default.png', widthFraction: 0.15, position: 'bottom-left',
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
