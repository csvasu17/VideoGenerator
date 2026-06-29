/**
 * Temporary nav discovery script — finds sidebar URLs for Cognify One
 * Run: npx ts-node --project tsconfig.scripts.json automation/discover-nav.ts
 */
import { chromium } from 'playwright';
import * as dotenv  from 'dotenv';
import * as path    from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

const APP_URL  = process.env['APP_URL']  ?? '';
const USERNAME = process.env['APP_USERNAME'] ?? '';
const PASSWORD = process.env['APP_PASSWORD'] ?? '';

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  console.log('Navigating to', APP_URL);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 40_000 });
  await page.waitForTimeout(3000);

  // Login
  const userSel = 'input[type="text"]:first-of-type, input[type="email"], input[name="username"]';
  const passSel = 'input[type="password"]';
  const btnSel  = 'button[type="submit"], button:has-text("Login"), button:has-text("Sign in")';
  await page.waitForSelector(userSel, { timeout: 15_000 });
  await page.fill(userSel, USERNAME);
  await page.fill(passSel, PASSWORD);
  await page.click(btnSel);
  await page.waitForTimeout(4000);
  console.log('Post-login URL:', page.url());

  // --- Find all nav/sidebar elements ---
  const navEls: any[] = await page.evaluate(() => {
    const out: any[] = [];
    const q = (s: string) => Array.from(document.querySelectorAll(s));
    const candidates = [
      ...q('nav a, nav button, nav [role="button"]'),
      ...q('aside a, aside button, aside [role="button"]'),
      ...q('[role="navigation"] a, [role="navigation"] button'),
      ...q('[class*="sidebar" i] a, [class*="sidebar" i] button'),
      ...q('[class*="sidenav" i] a, [class*="sidenav" i] button'),
    ];
    const seen = new Set<Element>();
    for (const el of candidates) {
      if (seen.has(el)) continue;
      seen.add(el);
      const rect = (el as HTMLElement).getBoundingClientRect();
      out.push({
        tag:      el.tagName,
        text:     el.textContent?.trim().slice(0, 60) ?? '',
        href:     (el as HTMLAnchorElement).href ?? '',
        aria:     el.getAttribute('aria-label') ?? '',
        title:    el.getAttribute('title') ?? '',
        cls:      (el.className?.toString() ?? '').slice(0, 80),
        x: Math.round(rect.left), y: Math.round(rect.top),
        w: Math.round(rect.width), h: Math.round(rect.height),
      });
    }
    return out;
  });

  console.log('\n=== NAV/SIDEBAR ELEMENTS ===', navEls.length, 'found');
  navEls.forEach((el, i) => console.log(i, JSON.stringify(el)));

  // --- Top-left area buttons/links (the icon bar) ---
  const icons: any[] = await page.evaluate(() => {
    const out: any[] = [];
    document.querySelectorAll('button, a').forEach((el: any) => {
      const rect = el.getBoundingClientRect();
      if (rect.left < 100 && rect.top < 300 && rect.width > 0 && rect.height > 0) {
        out.push({
          tag: el.tagName, text: el.textContent?.trim().slice(0, 50) ?? '',
          href: el.href ?? '', aria: el.getAttribute('aria-label') ?? '',
          title: el.getAttribute('title') ?? '', cls: (el.className?.toString() ?? '').slice(0, 80),
          x: Math.round(rect.left), y: Math.round(rect.top),
          w: Math.round(rect.width), h: Math.round(rect.height),
        });
      }
    });
    return out;
  });

  console.log('\n=== TOP-LEFT BUTTONS/LINKS ===', icons.length, 'found');
  icons.forEach(el => console.log(JSON.stringify(el)));

  // --- Try clicking each top-left icon and log resulting URL ---
  console.log('\n=== CLICKING SIDEBAR ICONS ===');
  for (let i = 0; i < Math.min(icons.length, 8); i++) {
    const startUrl = page.url();
    try {
      // Re-query the element fresh each time (DOM may change)
      const el2: any[] = await page.evaluate(() => {
        const out: any[] = [];
        document.querySelectorAll('button, a').forEach((el: any, idx) => {
          const rect = el.getBoundingClientRect();
          if (rect.left < 100 && rect.top < 300 && rect.width > 0 && rect.height > 0) {
            out.push({ idx, tag: el.tagName, text: el.textContent?.trim().slice(0, 50) ?? '', href: el.href ?? '', aria: el.getAttribute('aria-label') ?? '', x: Math.round(rect.left), y: Math.round(rect.top) });
          }
        });
        return out;
      });
      if (i >= el2.length) break;
      const target = el2[i];
      console.log(`Clicking icon[${i}]: tag=${target.tag} text="${target.text}" aria="${target.aria}" href="${target.href}"`);
      await page.mouse.click(target.x + 5, target.y + 5);
      await page.waitForTimeout(2000);
      const newUrl = page.url();
      console.log(`  → URL: ${newUrl}${newUrl !== startUrl ? ' (CHANGED!)' : ''}`);

      // Log any new nav items that appeared after click
      const newNavText: string[] = await page.evaluate(() => {
        const out: string[] = [];
        document.querySelectorAll('nav *, aside *, [class*="sidebar" i] *').forEach((el: any) => {
          const t = el.textContent?.trim();
          if (t && t.length > 1 && t.length < 60 && el.children.length === 0) out.push(t);
        });
        return [...new Set(out)].slice(0, 20);
      });
      if (newNavText.length) console.log(`  Nav text now:`, newNavText);
    } catch (e: any) {
      console.log(`  icon[${i}] click failed:`, e.message?.slice(0, 60));
    }
  }

  await browser.close();
  console.log('\nDone.');
})().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
