/**
 * explorer.ts — Generic, workflow-driven SPA recorder.
 *
 * Design principles:
 *  - Zero hardcoded URLs. Works for any application.
 *  - One login → storageState → one shared context → no re-authentication.
 *  - Discover pages by reading the live DOM (el.href = absolute URL, works
 *    for React Router <Link> which renders <a href="/real-path">).
 *  - Before EVERY recording: suppress notification side panels, close
 *    popups/overlays, press Escape — ensures clean screen visibility.
 *  - Navigate like a real user: start on dashboard, visit each page in order.
 *  - Thorough interaction: scroll, click tabs, hover charts, expand sections.
 */

import type {Browser, BrowserContext, Page} from 'playwright';
import type {RecordingConfig, ClipInfo} from '../types';
import {ensureSession, createAuthContext} from './session';
import {getVideoInfo, durationToFrames} from './ffprobe';
import {mvInteract} from './interaction-recorder';
import * as path from 'path';
import * as fs   from 'fs';

interface NavLink {id: string; url: string; label: string; priority: number}

// ─── CSS injected on every recorded page ─────────────────────────────────────
// Hides notification side panels and alert drawers so they don't block content.
// Does NOT affect app navigation — purely visual suppression.
const SUPPRESS_CSS = `
  [class*="alert"][class*="panel"],    [class*="Alert"][class*="Panel"],
  [class*="notification"][class*="panel"], [class*="Notification"][class*="Panel"],
  [class*="notification-drawer"],      [class*="NotificationDrawer"],
  [class*="alerts-drawer"],            [class*="AlertsDrawer"],
  [class*="alert-sidebar"],            [class*="AlertSidebar"],
  [class*="side-alert"],               [class*="SideAlert"],
  [class*="toast-container"],          [class*="ToastContainer"],
  [class*="toast"]:not(button),        [class*="Toast"]:not(button),
  [class*="snackbar"],                 [class*="Snackbar"],
  [data-testid*="alert-panel"],        [data-testid*="notification-panel"],
  [aria-label="Alerts"],               [aria-label="Notifications"],
  .alerts-panel, .notification-panel  {
    display:           none         !important;
    visibility:        hidden       !important;
    opacity:           0            !important;
    pointer-events:    none         !important;
    transform:         translateX(200%) !important;
  }
`;

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function autoExplore(
  browser:   Browser,
  config:    RecordingConfig,
  outputDir: string,
  fps:       number,
): Promise<ClipInfo[]> {
  const origin   = new URL(config.appUrl).origin;
  const session  = await ensureSession(browser, config);
  const startUrl = session?.postLoginUrl || config.appUrl;
  const vp       = config.viewport || {width: 1920, height: 1080};

  console.log(`\n🔍 Generic app exploration`);
  console.log(`   Post-login URL : ${startUrl}`);
  console.log(`   Output dir     : ${outputDir}\n`);

  // ONE context — all pages share cookies + storage, no re-login ever
  const ctx: BrowserContext = session
    ? await createAuthContext(browser, session, {viewport: vp, recordVideo: {dir: outputDir, size: vp}})
    : await browser.newContext({viewport: vp, recordVideo: {dir: outputDir, size: vp}, ignoreHTTPSErrors: true});

  const results: ClipInfo[] = [];
  const recorded = new Set<string>();

  try {
    // ── Phase 1: Discover all pages from the dashboard DOM ────────────────────
    console.log('📋 Analysing app navigation...');
    const probe = await ctx.newPage();
    await navigateTo(probe, startUrl);

    if (await isOnLoginPage(probe)) {
      console.log('❌ Session restore failed — check credentials in .env');
      await ctx.close();
      return [];
    }
    console.log(`✅ Authenticated at: ${probe.url()}`);
    await suppressPopups(probe);

    const pages = await discoverPages(probe, origin, startUrl);

    // Record the home/dashboard (already open — don't waste the navigation)
    console.log('\n🎬 Recording: Dashboard / Home');
    await suppressPopups(probe);
    await fullInteraction(probe);
    const homeVid = await probe.video()?.path();
    await probe.close();
    const homeId  = slugify(new URL(startUrl).pathname.replace(/\//g, '-')) || 'home';
    const homeClip = await finalizeClip(homeVid, homeId || 'home', outputDir, fps);
    if (homeClip) { results.push(homeClip); recorded.add(homeId); console.log(`   ✅ ${homeId}.mp4`); }

    // ── Phase 2: Explicit workflows from recording.config.js ──────────────────
    if (config.workflows?.length) {
      console.log(`\n📝 Running ${config.workflows.length} explicit workflow(s)...`);
      for (const wf of config.workflows as any[]) {
        if (recorded.has(wf.id)) continue;
        const wfUrl = (wf.steps?.find((s: any) => s.action === 'goto') as any)?.url || startUrl;
        const clip  = await recordPageClip(ctx, wf.id, wfUrl, outputDir, fps, wf.steps);
        if (clip) { results.push(clip); recorded.add(wf.id); }
      }
    }

    // ── Phase 3: Auto-discovered pages ────────────────────────────────────────
    console.log(`\n🎬 Recording ${pages.length} auto-discovered page(s)...`);
    for (const pg of pages) {
      if (recorded.has(pg.id) || results.some(r => r.id === pg.id)) continue;
      const clip = await recordPageClip(ctx, pg.id, pg.url, outputDir, fps);
      if (clip) { results.push(clip); recorded.add(pg.id); }
    }

  } finally {
    try { await ctx.close(); } catch {}
  }

  console.log(`\n✅ Total clips: ${results.length}`);
  return results;
}

// ─── Record one page as a single clip ────────────────────────────────────────

async function recordPageClip(
  ctx:       BrowserContext,
  id:        string,
  url:       string,
  outputDir: string,
  fps:       number,
  steps?:    any[],
): Promise<ClipInfo | null> {
  console.log(`\n   🎬 [${id}] ${url}`);
  try {
    const page = await ctx.newPage();
    await navigateTo(page, url);

    if (await isOnLoginPage(page)) {
      console.log(`      ⚠️  Redirected to login — skipping`);
      await page.close();
      return null;
    }

    // Suppress ALL popups before any interaction
    await suppressPopups(page);

    // Execute explicit workflow steps (except the initial goto, already done)
    if (steps?.length) {
      for (const step of steps.filter((s: any) => s.action !== 'goto')) {
        await executeStep(page, step).catch(() => {});
      }
      await suppressPopups(page);  // suppress again after steps
    }

    await fullInteraction(page);
    await page.waitForTimeout(1000);

    const vid = await page.video()?.path();
    await page.close();

    const clip = await finalizeClip(vid, id, outputDir, fps);
    if (clip) console.log(`      ✅ ${id}.mp4 (${clip.duration.toFixed(1)}s)`);
    return clip;
  } catch (e) {
    console.error(`      ❌ ${id}: ${(e as Error).message}`);
    return null;
  }
}

// ─── Popup & overlay suppression ─────────────────────────────────────────────

async function suppressPopups(page: Page): Promise<void> {
  // 1. Inject CSS to hide notification side panels permanently for this page
  await page.addStyleTag({content: SUPPRESS_CSS}).catch(() => {});

  // 2. Escape key dismisses most modal dialogs and open dropdowns
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);

  // 3. Click any visible close / dismiss buttons
  const closers = [
    'button[aria-label*="close" i]:visible',
    'button[aria-label*="dismiss" i]:visible',
    'button[title*="close" i]:visible',
    '[class*="close-btn"]:visible',
    '[class*="closeBtn"]:visible',
    '[class*="CloseBtn"]:visible',
    '[class*="dismiss"]:visible',
    '[class*="notification"] button[class*="close"]:visible',
    '[class*="alert"] button[class*="close"]:visible',
    '[class*="toast"] button:visible',
    '[class*="panel"] button[aria-label*="close" i]:visible',
    '[class*="drawer"] button[aria-label*="close" i]:visible',
  ];
  for (const sel of closers) {
    try {
      const els = await page.$$(sel);
      for (const el of els.slice(0, 3)) {
        await el.click({timeout: 400, force: true}).catch(() => {});
        await page.waitForTimeout(150);
      }
    } catch {}
  }

  // 4. Click main content area to collapse any open dropdown/panel
  try { await page.mouse.click(200, 200); await page.waitForTimeout(200); } catch {}

  // 5. Second Escape pass
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(200);
}

// ─── Page discovery ───────────────────────────────────────────────────────────

async function discoverPages(
  page:    Page,
  origin:  string,
  baseUrl: string,
): Promise<NavLink[]> {
  // Navigate to /dashboard — we know it works and has the full nav
  const dashUrl = new URL('/dashboard', origin).href;
  if (!page.url().includes('/dashboard')) {
    await navigateTo(page, dashUrl).catch(async () => {
      await navigateTo(page, baseUrl).catch(() => {});
    });
    if (await isOnLoginPage(page)) {
      await navigateTo(page, baseUrl).catch(() => {});
    }
    await suppressPopups(page);
  }

  console.log(`   Reading links from: ${page.url()}`);

  const found = new Map<string, NavLink>();

  // Primary: read every <a href> from the live DOM
  await readAllHrefs(page, origin, found);
  console.log(`   DOM href scan: ${found.size} unique link(s)`);

  // Secondary: click nav buttons (JS-only navigation without href)
  if (found.size < 3) {
    await clickNavButtons(page, origin, page.url(), found);
    console.log(`   After button clicks: ${found.size} link(s)`);
  }

  // Clean: remove current page + auth/utility pages
  const cur = page.url();
  found.delete(cur);
  found.delete(baseUrl);
  for (const [url] of found) {
    const u = url.toLowerCase();
    if (u.includes('login') || u.includes('logout') || u.includes('signup') ||
        u.includes('register') || u.includes('#') || u === origin || u === origin + '/') {
      found.delete(url);
    }
  }

  const links = Array.from(found.values()).sort((a, b) => a.priority - b.priority);
  if (links.length > 0) {
    console.log(`\n   📋 ${links.length} page(s) to record:`);
    links.forEach(l => console.log(`      • ${l.label.padEnd(28)} ${l.url}`));
  } else {
    console.log(`   ⚠️  No additional pages discovered — only explicit workflows will run`);
  }
  return links;
}

async function readAllHrefs(
  page:   Page,
  origin: string,
  result: Map<string, NavLink>,
): Promise<void> {
  type LinkData = {href: string; text: string; inNav: boolean};
  const raw: LinkData[] = await page.$$eval('a', (els) =>
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

  console.log(`   Total <a> elements: ${raw.length}`);
  for (const {href, text, inNav} of raw) {
    if (!href || !href.startsWith(origin)) continue;
    if (!text || text.length < 2 || text.length > 80) continue;
    const u = href.toLowerCase();
    if (u.includes('login') || u.includes('logout') || u.includes('signup') ||
        u.includes('#') || u === origin || u === origin + '/') continue;
    if (result.has(href)) continue;
    const id = slugify(text);
    if (id) result.set(href, {id, url: href, label: text, priority: inNav ? 1 : 2});
  }
}

async function clickNavButtons(
  page:    Page,
  origin:  string,
  baseUrl: string,
  result:  Map<string, NavLink>,
): Promise<void> {
  const btnTexts: string[] = await page.$$eval(
    ['nav button:not([disabled])', 'aside button:not([disabled])',
     '[class*="sidebar"] button:not([disabled])', '[role="menuitem"]'].join(','),
    (els) => [...new Set(
      (els as HTMLElement[]).map(el => (el.textContent || '').trim().replace(/\s+/g, ' ')).filter(t => t.length >= 2 && t.length <= 60),
    )],
  ).catch(() => []);

  for (const text of btnTexts.slice(0, 20)) {
    try {
      if (page.url() !== baseUrl) { await navigateTo(page, baseUrl); await suppressPopups(page); }
      const re  = new RegExp('^' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
      const btn = page.getByRole('button', {name: re}).first();
      if (!await btn.count()) continue;
      const beforeUrl = page.url();
      await btn.click({timeout: 2000});
      await page.waitForTimeout(1500);
      const afterUrl = page.url();
      if (afterUrl !== beforeUrl && afterUrl.startsWith(origin) && !result.has(afterUrl)) {
        const u = afterUrl.toLowerCase();
        if (!u.includes('login') && !u.includes('logout'))
          result.set(afterUrl, {id: slugify(text), url: afterUrl, label: text, priority: 1});
        console.log(`      ↗ Button: ${text} → ${afterUrl}`);
      }
    } catch {}
  }
  if (page.url() !== baseUrl) await navigateTo(page, baseUrl).catch(() => {});
}

// ─── Full page interaction ────────────────────────────────────────────────────

async function fullInteraction(page: Page): Promise<void> {
  await suppressPopups(page);
  await slowScroll(page);

  // ── MVID-powered interaction ────────────────────────────────────────────────
  // InteractionDetector (3-pass: ARIA → structural → visual) discovers all tabs,
  // accordions, and visual controls — including custom React/Angular/Tailwind
  // components that don't use ARIA markup.
  const mvClicked = await mvInteract(page, {
    maxTargets:       8,
    pauseBeforeMs:    700,
    pauseAfterMs:     1_400,
    visualDetection:  true,
    maxVisualGroups:  3,
    verbose:          true,
  }).catch(() => 0);

  if (mvClicked === 0) {
    // MVID found no targets — fall back to generic CSS-selector approach
    await clickAllTabs(page);
    await expandSections(page);
  }

  await suppressPopups(page);   // suppress any panels opened by tab clicks
  await hoverCharts(page);
  try {
    await page.evaluate(() => window.scrollTo({top: 0, behavior: 'smooth'}));
    await page.waitForTimeout(600);
  } catch {}
  await suppressPopups(page);   // final clean state before recording ends
}

async function slowScroll(page: Page): Promise<void> {
  try {
    const h = await page.evaluate(() => document.body.scrollHeight);
    const steps = Math.min(Math.ceil(h / 300), 10);
    for (let i = 1; i <= steps; i++) {
      await page.evaluate(
        (y: number) => window.scrollTo({top: y, behavior: 'smooth'}),
        (i / steps) * h * 0.88,
      );
      await page.waitForTimeout(650);
    }
  } catch {}
}

async function clickAllTabs(page: Page): Promise<void> {
  for (const sel of [
    '[role="tab"]:not([aria-selected="true"])',
    '[class*="Tab"]:not([class*="active"])',
  ]) {
    try {
      const tabs = await page.$$(sel);
      for (const t of tabs.slice(0, 8)) {
        try { await t.scrollIntoViewIfNeeded(); await t.click(); await page.waitForTimeout(1200); } catch {}
      }
      if (tabs.length) return;
    } catch {}
  }
}

async function hoverCharts(page: Page): Promise<void> {
  for (const sel of [
    '[class*="chart"]', '[class*="Chart"]', '[class*="Card"]',
    '[class*="metric"]', '[class*="kpi"]', '[data-tooltip]', 'circle', 'rect[width]',
  ]) {
    try {
      const els = await page.$$(sel);
      for (const el of els.slice(0, 5)) { try { await el.hover(); await page.waitForTimeout(500); } catch {} }
      if (els.length) return;
    } catch {}
  }
}

async function expandSections(page: Page): Promise<void> {
  for (const sel of ['[aria-expanded="false"]', '[class*="accordion"] button', 'details:not([open]) summary']) {
    try {
      for (const el of (await page.$$(sel)).slice(0, 4)) {
        try { await el.scrollIntoViewIfNeeded(); await el.click(); await page.waitForTimeout(600); } catch {}
      }
    } catch {}
  }
}

// ─── Step executor for explicit workflows ────────────────────────────────────

async function executeStep(page: Page, step: any): Promise<void> {
  switch (step.action) {
    case 'wait':            await page.waitForTimeout(step.ms ?? 1000); break;
    case 'scroll':          await page.evaluate((y: number) => window.scrollTo({top: y, behavior: 'smooth'}), step.y ?? 400); await page.waitForTimeout(500); break;
    case 'click':
      if (step.optional)  { try { await page.click(step.selector, {timeout: 2000}); } catch {} }
      else                { await page.click(step.selector, {timeout: 6000}); }
      break;
    case 'fill':            await page.fill(step.selector, step.value ?? ''); break;
    case 'key':             await page.keyboard.press(step.key ?? 'Escape'); break;
    case 'hover':           await page.hover(step.selector, {timeout: 2000}); break;
    case 'waitForSelector': await page.waitForSelector(step.selector, {timeout: step.timeout ?? 8000}); break;
  }
}

// ─── Navigation helper ────────────────────────────────────────────────────────

async function navigateTo(page: Page, url: string): Promise<void> {
  await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 60000});
  await page.waitForTimeout(2500);
}

// ─── Utility ──────────────────────────────────────────────────────────────────

async function isOnLoginPage(page: Page): Promise<boolean> {
  try { return !!(await page.$('input[type="password"]')); } catch { return false; }
}

async function finalizeClip(
  videoPath: string | undefined,
  id:        string,
  outputDir: string,
  fps:       number,
): Promise<ClipInfo | null> {
  if (!videoPath || !fs.existsSync(videoPath)) return null;
  const dest = path.join(outputDir, `${id}.mp4`);
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  fs.renameSync(videoPath, dest);
  const info = getVideoInfo(dest);
  return {
    id,
    file:             `projects/rheem/recordings/${id}.mp4`,
    duration:         info.duration,
    durationInFrames: durationToFrames(info.duration, fps),
    width:            info.width,
    height:           info.height,
    source:           'auto',
    capturedAt:       '',
  };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || '';
}
