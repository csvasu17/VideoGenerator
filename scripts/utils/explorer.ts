import type {Browser, Page} from 'playwright';
import type {RecordingConfig, ClipInfo} from '../types';
import {ensureSession, applySession} from './session';
import {getVideoInfo, durationToFrames} from './ffprobe';
import * as path from 'path';
import * as fs   from 'fs';

interface NavLink {id: string; url: string; label: string}

const NAV_SELECTORS = [
  'nav a[href]',
  '[role="navigation"] a[href]',
  '[role="menubar"] a[href]',
  '.sidebar a[href]',
  '.nav a[href]',
  'header a[href]',
  '[data-menu] a[href]',
];

export async function autoExplore(
  browser:   Browser,
  config:    RecordingConfig,
  outputDir: string,
  fps:       number,
): Promise<ClipInfo[]> {
  const origin = new URL(config.appUrl).origin;
  console.log(`\n🕵️  Auto-exploring: ${config.appUrl}`);

  const session = await ensureSession(browser, config);

  // Probe: discover navigation links without recording
  const probeCtx = await browser.newContext({
    viewport: config.viewport || {width: 1920, height: 1080},
    ignoreHTTPSErrors: true,
  });
  const probePage = await probeCtx.newPage();
  let links: NavLink[] = [];
  try {
    if (session) await applySession(probeCtx, session);
    await probePage.goto(config.appUrl, {waitUntil: 'networkidle', timeout: 20000});
    links = await discoverLinks(probePage, origin, config.maxNavDepth || 2);
    console.log(`   Found ${links.length} pages to record.`);
  } finally {
    await probeCtx.close();
  }

  const results: ClipInfo[] = [];
  for (const link of links.slice(0, 12)) {
    // Skip if a manual asset already covers this id
    const manualPath = path.join(outputDir, '..', `${link.id}.mp4`);
    if (fs.existsSync(manualPath)) {
      console.log(`   ⏭  Skipping ${link.id} — manual asset exists`);
      continue;
    }

    const clipPath = await recordNavPage(browser, config, session, link, outputDir);
    if (!clipPath) continue;

    const info = getVideoInfo(clipPath);
    results.push({
      id: link.id,
      file: `assets/recordings/${link.id}.mp4`,
      duration: info.duration,
      durationInFrames: durationToFrames(info.duration, fps),
      width: info.width,
      height: info.height,
      source: 'auto',
      capturedAt: new Date().toISOString(),
    });
  }
  return results;
}

async function recordNavPage(
  browser:   Browser,
  config:    RecordingConfig,
  session:   any,
  link:      NavLink,
  outputDir: string,
): Promise<string | null> {
  console.log(`   🎬 ${link.label} → ${link.url}`);
  const vp = config.viewport || {width: 1920, height: 1080};

  const ctx = await browser.newContext({
    viewport: vp,
    recordVideo: {dir: outputDir, size: vp},
    ignoreHTTPSErrors: true,
  });

  try {
    if (session) await applySession(ctx, session);
    const page = await ctx.newPage();
    await page.goto(link.url, {waitUntil: 'networkidle', timeout: 20000});
    await page.waitForTimeout(1200);
    await slowScroll(page);
    await clickTabs(page);
    await page.waitForTimeout(1500);

    const vpath = await page.video()?.path();
    await ctx.close();

    if (!vpath || !fs.existsSync(vpath)) return null;
    const dest = path.join(outputDir, `${link.id}.mp4`);
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    fs.renameSync(vpath, dest);
    console.log(`      ✅ recordings/${link.id}.mp4`);
    return dest;
  } catch (e) {
    console.error(`      ❌ ${(e as Error).message}`);
    try { await ctx.close(); } catch {}
    return null;
  }
}

async function discoverLinks(page: Page, origin: string, _maxDepth: number): Promise<NavLink[]> {
  const seen = new Set<string>();
  const results: NavLink[] = [];

  for (const sel of NAV_SELECTORS) {
    try {
      const els = await page.$$(sel);
      for (const el of els) {
        const href  = await el.getAttribute('href');
        const label = ((await el.textContent()) || '').trim();
        if (!href || !label || href.startsWith('#') || href.startsWith('mailto:')) continue;
        let full: string;
        try { full = new URL(href, origin).href; } catch { continue; }
        if (!full.startsWith(origin)) continue;
        if (seen.has(full)) continue;
        seen.add(full);
        const id = slugify(label);
        if (id) results.push({id, url: full, label});
      }
    } catch {}
  }

  // Deduplicate by id
  const byId = new Map<string, NavLink>();
  for (const l of results) if (!byId.has(l.id)) byId.set(l.id, l);
  return Array.from(byId.values());
}

async function slowScroll(page: Page): Promise<void> {
  try {
    const h = await page.evaluate(() => document.body.scrollHeight);
    for (let i = 1; i <= 4; i++) {
      await page.evaluate(
        (y: number) => window.scrollTo({top: y, behavior: 'smooth'}),
        (i / 4) * h * 0.85,
      );
      await page.waitForTimeout(700);
    }
    await page.evaluate(() => window.scrollTo({top: 0, behavior: 'smooth'}));
    await page.waitForTimeout(400);
  } catch {}
}

async function clickTabs(page: Page): Promise<void> {
  for (const sel of ['[role="tab"]', '.tab-list button', '.tabs li a', '[data-tab]']) {
    try {
      const tabs = await page.$$(sel);
      for (const t of tabs.slice(0, 4)) {
        try { await t.click(); await page.waitForTimeout(600); } catch {}
      }
      if (tabs.length > 0) return;
    } catch {}
  }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || '';
}
