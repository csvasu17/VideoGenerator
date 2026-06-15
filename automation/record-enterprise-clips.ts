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

const APP_URL  = process.env['APP_URL']      ?? '';
const USERNAME = process.env['APP_USERNAME'] ?? '';
const PASSWORD = process.env['APP_PASSWORD'] ?? '';

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
  console.log('  🎬  Enterprise Screen Recording — Real App Walkthrough Clips');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (!APP_URL) {
    console.error('  ✗  APP_URL is not set in .env'); process.exit(1);
  }

  console.log(`  App     : ${APP_URL}`);
  console.log(`  User    : ${USERNAME || '(none)'}`);
  console.log(`  Out     : ${RECORDINGS_DIR}\n`);

  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

  const rc: RecordingConfig = {
    appUrl:      APP_URL,
    viewport:    VIEWPORT,
    credentials: USERNAME ? { username: USERNAME, password: PASSWORD } : undefined,
  };

  const isHeadless = process.env['HEADLESS'] === '1' || process.env['CI'] === 'true';
  const browser: Browser = await chromium.launch({
    headless: isHeadless,
    slowMo:   isHeadless ? 30 : 50,
    args: [
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
    ],
  });

  const clips: RecordedClip[] = [];

  try {
    // ── Login ────────────────────────────────────────────────────────────────
    const session = await ensureSession(browser, rc);
    if (!session && USERNAME) {
      console.error('  ✗  Login failed — check APP_USERNAME / APP_PASSWORD in .env');
      await browser.close();
      process.exit(1);
    }

    const origin    = new URL(APP_URL).origin;
    const startUrl  = session?.postLoginUrl ?? APP_URL;

    // Open recording context — every page opened in this context is recorded
    const ctx: BrowserContext = session
      ? await createAuthContext(browser, session, {
          viewport:    VIEWPORT,
          recordVideo: { dir: RECORDINGS_DIR, size: VIEWPORT },
        })
      : await browser.newContext({
          viewport:          VIEWPORT,
          recordVideo:       { dir: RECORDINGS_DIR, size: VIEWPORT },
          ignoreHTTPSErrors: true,
        });

    try {
      // ── Phase 1: Discover all pages ────────────────────────────────────────
      console.log('  📋  Discovering app navigation...');
      const probe = await ctx.newPage();
      await probe.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await probe.waitForTimeout(2500);
      await suppressPopups(probe);

      const pageLinks = await discoverPageLinks(probe, origin);
      console.log(`  Found ${pageLinks.length} unique section(s)\n`);
      if (pageLinks.length > 0) {
        pageLinks.forEach(l => console.log(`    • ${l.label.padEnd(32)} ${l.url}`));
        console.log('');
      }

      // ── Phase 2: Record home / dashboard ───────────────────────────────────
      console.log('  📹  Recording: Dashboard / Home');
      await performFullInteraction(probe);
      const homeFramePath = path.join(RECORDINGS_DIR, 'home-frame.png');
      await probe.screenshot({ path: homeFramePath, type: 'png' });
      await probe.waitForTimeout(1500);
      const homeVidRaw = await probe.video()?.path();
      await probe.close();

      if (homeVidRaw && fs.existsSync(homeVidRaw)) {
        const dest = path.join(RECORDINGS_DIR, 'home.mp4');
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        fs.renameSync(homeVidRaw, dest);
        const info = getVideoInfo(dest);
        clips.push({ id: 'home', label: 'Dashboard', url: startUrl, videoPath: dest, framePath: homeFramePath, duration: info.duration });
        console.log(`     ✅  home.mp4  (${info.duration.toFixed(1)}s)\n`);
      }

      // ── Phase 3: Record each discovered section ─────────────────────────────
      for (const pg of pageLinks) {
        console.log(`  📹  Recording: ${pg.label}  →  ${pg.url}`);
        try {
          const page = await ctx.newPage();
          await page.goto(pg.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await page.waitForTimeout(2500);

          // Skip login redirects
          if (await page.$('input[type="password"]')) {
            console.log(`     ⚠️  Redirected to login — skipping`);
            const skipVid = await page.video()?.path();
            await page.close();
            if (skipVid) try { fs.unlinkSync(skipVid); } catch {}
            continue;
          }

          await performFullInteraction(page);

          // Screenshot for AI analysis (taken at clean end-state)
          const framePath = path.join(RECORDINGS_DIR, `${pg.id}-frame.png`);
          await page.screenshot({ path: framePath, type: 'png' });

          // Hold on final state so video ends on a clean frame
          await page.waitForTimeout(1500);

          const vidRaw = await page.video()?.path();
          await page.close();

          if (vidRaw && fs.existsSync(vidRaw)) {
            const dest = path.join(RECORDINGS_DIR, `${pg.id}.mp4`);
            if (fs.existsSync(dest)) fs.unlinkSync(dest);
            fs.renameSync(vidRaw, dest);
            const info = getVideoInfo(dest);
            clips.push({ id: pg.id, label: pg.label, url: pg.url, videoPath: dest, framePath, duration: info.duration });
            console.log(`     ✅  ${pg.id}.mp4  (${info.duration.toFixed(1)}s)\n`);
          } else {
            console.log(`     ⚠️  No video produced for ${pg.id}\n`);
          }
        } catch (e) {
          console.warn(`     ❌  ${pg.id}: ${(e as Error).message?.slice(0, 80)}\n`);
        }
      }

    } finally {
      try { await ctx.close(); } catch {}
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
        { id: 'broll-0', from: 0,              durationInFrames: BROLL_SEC * FPS, subtitle: 'Managing complex systems is overwhelming', category: 'generic' },
        { id: 'broll-1', from: BROLL_SEC * FPS, durationInFrames: BROLL_SEC * FPS, subtitle: 'Teams need real-time data to act fast',    category: 'generic' },
        { id: 'broll-2', from: 2 * BROLL_SEC * FPS, durationInFrames: BROLL_SEC * FPS, subtitle: 'Manual processes consume hours every day', category: 'generic' },
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
