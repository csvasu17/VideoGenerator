/**
 * explore-priorauth.ts  —  Screenshots every accessible page of the Prior Auth
 * app so we can plan the recording clips.
 *
 * Usage:  npx ts-node --project tsconfig.scripts.json automation/explore-priorauth.ts
 *
 * Output: out/priorauth/explore/  (PNG screenshots + a manifest.json)
 */

import * as fs   from 'fs';
import * as path from 'path';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

const APP_URL  = (process.env['APP_URL'] || 'http://10.1.9.23:3013').replace(/\/$/, '');
const OUT_DIR  = path.resolve(__dirname, '../out/priorauth/explore');
fs.mkdirSync(OUT_DIR, { recursive: true });

const manifest: Array<{ id: string; url: string; file: string; role?: string }> = [];

async function shot(page: Page, id: string, role?: string) {
  const file = path.join(OUT_DIR, `${id}.png`);
  await page.screenshot({ path: file, fullPage: false });
  manifest.push({ id, url: page.url(), file: path.relative(process.cwd(), file), role });
  console.log(`  [${id}]  ${page.url()}`);
}

async function loginAs(context: BrowserContext, cardIndex: number, role: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${APP_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);

  // Screenshot login page on first role
  if (cardIndex === 0) await shot(page, 'login-page');

  // Click Quick Access card at cardIndex
  const cards = page.locator('[class*="quick"],[class*="Quick"],[class*="role"],[class*="Role"],[class*="card"],[class*="Card"],[class*="access"],[class*="Access"]');
  const count = await cards.count();
  console.log(`  Login page: found ${count} quick-access candidates`);

  if (count > cardIndex) {
    await cards.nth(cardIndex).click();
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle');
  } else {
    console.log(`  Warning: card index ${cardIndex} not found, trying button/link clicks`);
    const btn = page.locator('button,a').nth(cardIndex);
    await btn.click();
    await page.waitForTimeout(3000);
  }

  console.log(`  Logged in as ${role} → ${page.url()}`);
  await shot(page, `${role}-home`, role);
  return page;
}

async function exploreNav(page: Page, role: string) {
  // Find sidebar / top-nav links and visit each one
  const navLinks = page.locator('nav a, aside a, [class*="sidebar"] a, [class*="menu"] a, [class*="nav"] a');
  const hrefs: string[] = [];

  const count = await navLinks.count();
  for (let i = 0; i < count; i++) {
    const href = await navLinks.nth(i).getAttribute('href');
    const text = (await navLinks.nth(i).innerText()).trim().slice(0, 40);
    if (href && !hrefs.includes(href) && !href.startsWith('#') && !href.startsWith('http')) {
      hrefs.push(href);
      console.log(`    nav[${i}]: "${text}" → ${href}`);
    }
  }

  for (const href of hrefs.slice(0, 12)) {
    try {
      const full = href.startsWith('/') ? `${APP_URL}${href}` : `${APP_URL}/${href}`;
      await page.goto(full, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(1500);
      const id = `${role}-${href.replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}`;
      await shot(page, id, role);
    } catch (e) {
      console.log(`    Failed to navigate to ${href}: ${(e as Error).message.slice(0, 80)}`);
    }
  }
}

async function main() {
  console.log(`\nExploring Prior Auth app at ${APP_URL}\n`);

  const browser: Browser = await chromium.launch({ headless: true });

  // ── Role 0 (first Quick Access card) ──────────────────────────────────────
  try {
    const ctx0 = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page0 = await loginAs(ctx0, 0, 'role-0');
    await exploreNav(page0, 'role-0');
    await ctx0.close();
  } catch (e) {
    console.error('Role 0 failed:', (e as Error).message);
  }

  // ── Role 1 ────────────────────────────────────────────────────────────────
  try {
    const ctx1 = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page1 = await loginAs(ctx1, 1, 'role-1');
    await exploreNav(page1, 'role-1');
    await ctx1.close();
  } catch (e) {
    console.error('Role 1 failed:', (e as Error).message);
  }

  // ── Role 2 ────────────────────────────────────────────────────────────────
  try {
    const ctx2 = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page2 = await loginAs(ctx2, 2, 'role-2');
    await exploreNav(page2, 'role-2');
    await ctx2.close();
  } catch (e) {
    console.error('Role 2 failed:', (e as Error).message);
  }

  // ── Role 3 ────────────────────────────────────────────────────────────────
  try {
    const ctx3 = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page3 = await loginAs(ctx3, 3, 'role-3');
    await exploreNav(page3, 'role-3');
    await ctx3.close();
  } catch (e) {
    console.error('Role 3 failed:', (e as Error).message);
  }

  await browser.close();

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nDone — ${manifest.length} screenshots saved to out/priorauth/explore/`);
  console.log('Manifest: out/priorauth/explore/manifest.json\n');
  manifest.forEach(m => console.log(`  ${m.id.padEnd(50)} ${m.url}`));
}

main().catch(e => { console.error(e); process.exit(1); });
