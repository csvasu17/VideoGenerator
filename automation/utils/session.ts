import type {Browser, BrowserContext, Page} from 'playwright';
import type {RecordingConfig} from '../types';
import * as path from 'path';
import * as fs   from 'fs';

export interface SessionState {
  storageStatePath: string;   // Playwright storageState file (cookies+localStorage+sessionStorage)
  postLoginUrl:     string;   // URL after successful login (skip login page entirely)
  origin:           string;
}

const TMP_DIR = path.resolve(__dirname, '../../.tmp');
let _cache: SessionState | null = null;

export function clearSession(): void { _cache = null; }

export async function ensureSession(
  browser: Browser,
  config:  RecordingConfig,
): Promise<SessionState | null> {
  if (_cache) return _cache;
  if (!config.credentials) return null;

  fs.mkdirSync(TMP_DIR, {recursive: true});
  const storageStatePath = path.join(TMP_DIR, 'session-state.json');

  console.log('🔐 Logging in...');
  const ctx = await browser.newContext({
    viewport:         config.viewport || {width: 1920, height: 1080},
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();

  try {
    await page.goto(config.appUrl, {waitUntil: 'domcontentloaded', timeout: 60000});
    await page.waitForTimeout(1500);
    await performLogin(page, config.credentials);
    await page.waitForTimeout(3500);

    const postLoginUrl = page.url();

    // storageState captures cookies + localStorage + sessionStorage in one call
    await ctx.storageState({path: storageStatePath});

    _cache = {storageStatePath, postLoginUrl, origin: new URL(config.appUrl).origin};
    console.log(`✅ Session saved. Post-login: ${postLoginUrl}`);
    console.log(`   StorageState → ${storageStatePath}`);
  } finally {
    await ctx.close();
  }
  return _cache;
}

export async function performLogin(
  page:  Page,
  creds: NonNullable<RecordingConfig['credentials']>,
): Promise<void> {
  if (creds.loginType === 2) {
    await performQuickAccessLogin(page, creds.quickAccessIndex ?? 0);
    return;
  }

  const {
    username, password,
    usernameSelector = 'input[type="email"],input[name="username"],input[name="email"],#username,#email',
    passwordSelector = 'input[type="password"],#password',
    submitSelector   = 'button[type="submit"],input[type="submit"],button:has-text("Login"),button:has-text("Sign In"),button:has-text("Log in")',
  } = creds;

  await page.waitForSelector(usernameSelector, {timeout: 15000});
  await page.fill(usernameSelector, username);
  await page.waitForTimeout(300);
  await page.fill(passwordSelector, password);
  await page.waitForTimeout(400);
  await page.click(submitSelector);

  // Wait for login: password field disappears OR URL moves away from login
  await Promise.race([
    page.waitForSelector('input[type="password"]', {state: 'detached', timeout: 20000}),
    page.waitForURL((url) => !url.href.includes('login') && !url.href.includes('signin'), {timeout: 20000}),
  ]).catch(() => page.waitForTimeout(3000));
}

const LOGIN_PATH_HINTS = ['/login', '/signin', '/auth', '/account/login', '/user/login'];

async function performQuickAccessLogin(page: Page, index: number): Promise<void> {
  // Try the current page first; if not found, walk common login sub-paths
  let clicked = await clickQuickAccessOption(page, index);

  if (!clicked) {
    const origin = (() => { try { return new URL(page.url()).origin; } catch { return ''; } })();
    for (const loginPath of LOGIN_PATH_HINTS) {
      try {
        await page.goto(`${origin}${loginPath}`, {waitUntil: 'domcontentloaded', timeout: 15000});
        await page.waitForTimeout(1000);
        clicked = await clickQuickAccessOption(page, index);
        if (clicked) break;
      } catch {
        // try next path
      }
    }
  }

  if (!clicked) {
    throw new Error(
      `LOGIN_TYPE=2: could not find Quick Access options on the login screen. ` +
      `Ensure the app shows Quick Access cards and increase quickAccessIndex if needed.`,
    );
  }

  // Quick Access cards pre-fill credentials but do not auto-submit.
  // Wait for the fields to be populated then click the submit button.
  await page.waitForTimeout(600);
  const submitSelector = 'button[type="submit"], input[type="submit"], .signin-btn, button:has-text("Login"), button:has-text("Sign In"), button:has-text("Log in")';
  await page.locator(submitSelector).first().click().catch(() => {});

  // Wait for navigation away from the login screen
  await Promise.race([
    page.waitForSelector('input[type="password"]', {state: 'detached', timeout: 20000}),
    page.waitForURL((url) => !url.href.includes('login') && !url.href.includes('signin'), {timeout: 20000}),
  ]).catch(() => page.waitForTimeout(3000));
}

async function clickQuickAccessOption(page: Page, index: number): Promise<boolean> {
  // Strategy 1: known class / data-testid patterns (most-specific first)
  const knownSelectors = [
    '.quick-access-card',               // exact class match
    '[class="quick-access-card"]',
    '[data-testid*="quick-access"]',
    '[data-testid*="quickaccess"]',
    '[class*="QuickAccess"][class*="Card"]',
    '[class*="quick-access-card"]',
    '[class*="quickAccessItem"]',
    '[class*="QuickAccessItem"]',
    '[class*="demo-user"]',
    '[class*="DemoUser"]',
  ];
  for (const sel of knownSelectors) {
    const items = page.locator(sel);
    const count = await items.count().catch(() => 0);
    if (count > index) {
      await items.nth(index).click();
      return true;
    }
  }

  // Strategy 2: find any container that holds "QUICK ACCESS" text, then click
  //             the nth interactive element (button / [role="button"] / div) inside it.
  try {
    const section = page
      .locator('div, section, aside, form')
      .filter({hasText: /quick.access/i})
      .last();

    const isVisible = await section.isVisible({timeout: 2000}).catch(() => false);
    if (isVisible) {
      // Try buttons first, then generic clickable divs with user names
      const buttons = section.locator('button, [role="button"]').filter({hasNotText: /quick.access/i});
      const btnCount = await buttons.count().catch(() => 0);
      if (btnCount > index) {
        await buttons.nth(index).click();
        return true;
      }

      // Fallback: divs that look like user cards (contain a name div or initials div)
      const cards = section.locator('div').filter({has: page.locator('[class*="user-initials"], [class*="initials"], [class*="avatar"]')});
      const cardCount = await cards.count().catch(() => 0);
      if (cardCount > index) {
        await cards.nth(index).click();
        return true;
      }
    }
  } catch {
    // fall through to next strategy
  }

  // Strategy 3: any element visible below the "Quick Access" divider label
  try {
    const label = page.locator('text=/quick.access/i').first();
    const labelVisible = await label.isVisible({timeout: 1000}).catch(() => false);
    if (labelVisible) {
      const labelBox = await label.boundingBox().catch(() => null);
      if (labelBox) {
        const candidates = page.locator('div[class*="card"], div[class*="Card"], button');
        const total = await candidates.count().catch(() => 0);
        let found = 0;
        for (let i = 0; i < total; i++) {
          const el = candidates.nth(i);
          const box = await el.boundingBox().catch(() => null);
          if (box && box.y > labelBox.y + labelBox.height) {
            if (found === index) {
              await el.click();
              return true;
            }
            found++;
          }
        }
      }
    }
  } catch {
    // fall through
  }

  return false;
}

/**
 * Create a context pre-loaded with the full saved auth state.
 * Navigate directly to any authenticated URL — no login page needed.
 */
// Injected before any page script runs — prevents notification panels
// from appearing at all, regardless of app state.
const INIT_SUPPRESS_CSS = `
  [class*="alert"][class*="panel"],[class*="Alert"][class*="Panel"],
  [class*="notification"][class*="panel"],[class*="Notification"][class*="Panel"],
  [class*="notification-drawer"],[class*="alerts-drawer"],[class*="alert-sidebar"],
  [class*="toast"]:not(button),[class*="snackbar"] {
    display:none!important; visibility:hidden!important;
    opacity:0!important; pointer-events:none!important;
  }
`;

export async function createAuthContext(
  browser:  Browser,
  session:  SessionState,
  options:  Record<string, any> = {},
): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    ...options,
    storageState:      session.storageStatePath,
    ignoreHTTPSErrors: true,
  });
  // Inject CSS suppressor before any page scripts run on every new page
  await ctx.addInitScript(({css}: {css: string}) => {
    const s = document.createElement('style');
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }, {css: INIT_SUPPRESS_CSS});
  return ctx;
}
