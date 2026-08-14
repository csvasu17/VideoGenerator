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

/**
 * Some apps' AuthContext fires two CONCURRENT token-refresh requests on every
 * protected-route mount (confirmed directly against a real app: two simultaneous
 * POST .../auth/refresh calls, most likely a React 18 StrictMode double-effect in
 * dev mode). The server correctly rotates the refresh token and lets only one of
 * the two succeed — but the app's error handling for the OTHER (rejected, 409)
 * call can unconditionally log the user out, racing against and sometimes
 * overriding the successful call's own "we're authenticated" effect. This is why
 * a route can intermittently (often, in practice) bounce back to the login/picker
 * screen moments after a completely valid, successful login or navigation — not a
 * credentials problem, and not fixable by waiting longer or retrying the same way.
 *
 * Deduping at the network level closes this off entirely: hold any duplicate
 * refresh request that arrives while one is already in flight, and fulfill it with
 * that SAME response instead of letting it hit the server with an already-rotated
 * token and come back conflicted. The app then only ever observes one clean,
 * successful response — confirmed via direct testing to eliminate the bogus
 * logout across every route it was tried on.
 */
export async function installAuthRefreshDedupe(ctx: BrowserContext): Promise<void> {
  let inFlight: Promise<{ status: number; headers: Record<string, string>; body: Buffer }> | null = null;
  await ctx.route('**/auth/refresh', async (route) => {
    if (inFlight) {
      const result = await inFlight;
      await route.fulfill({ status: result.status, headers: result.headers, body: result.body });
      return;
    }
    let resolveFn!: (v: { status: number; headers: Record<string, string>; body: Buffer }) => void;
    inFlight = new Promise(r => { resolveFn = r; });
    try {
      const response = await route.fetch();
      const status  = response.status();
      const headers = response.headers();
      const body    = await response.body();
      resolveFn({ status, headers, body });
      await route.fulfill({ response });
    } catch (err) {
      resolveFn({ status: 500, headers: {}, body: Buffer.from('{}') });
      throw err;
    } finally {
      inFlight = null;
    }
  });
}

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

/** Whether a per-role Quick Access login genuinely matched that role's own card,
 *  or silently fell back to a default card index — surfaced so callers that loop
 *  over many roles (e.g. exhaustive Agent Recording) can report per-role footage
 *  provenance instead of only seeing this signal in a console.warn. */
export type RoleMatchConfidence = 'matched' | 'fallback-default-card' | 'not-applicable';

export interface LoginResult {
  roleMatchConfidence: RoleMatchConfidence;
}

export async function performLogin(
  page:  Page,
  creds: NonNullable<RecordingConfig['credentials']>,
): Promise<LoginResult> {
  if (creds.loginType === 2) {
    const { matchedRole } = await performQuickAccessLogin(page, creds.quickAccessIndex ?? 0, creds.quickAccessRoleName);
    return { roleMatchConfidence: creds.quickAccessRoleName ? (matchedRole ? 'matched' : 'fallback-default-card') : 'not-applicable' };
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

  return { roleMatchConfidence: 'not-applicable' };
}

const LOGIN_PATH_HINTS = ['/login', '/signin', '/auth', '/account/login', '/user/login'];

async function performQuickAccessLogin(page: Page, index: number, roleName?: string): Promise<{ matchedRole: boolean }> {
  // Try the current page first; if not found, walk common login sub-paths
  let { clicked, matchedRole } = await clickQuickAccessOption(page, index, roleName);

  if (!clicked) {
    const origin = (() => { try { return new URL(page.url()).origin; } catch { return ''; } })();
    for (const loginPath of LOGIN_PATH_HINTS) {
      try {
        await page.goto(`${origin}${loginPath}`, {waitUntil: 'domcontentloaded', timeout: 15000});
        await page.waitForTimeout(1000);
        ({ clicked, matchedRole } = await clickQuickAccessOption(page, index, roleName));
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

  // Wait for the picker to actually go away — NOT "URL no longer contains
  // login/signin" or "password field detached". Both of those resolve instantly
  // (vacuously true) for apps that render the picker IN PLACE with no URL change
  // and no password field ever present, which made this return "success" within
  // milliseconds of the click, before any real login had happened. Poll the same
  // content-based signal used to detect the picker in the first place — it's the
  // only thing here that's actually tied to the login having completed.
  const deadline = Date.now() + 20000;
  for (;;) {
    const stillShowingPicker = await isQuickAccessScreenShowing(page, roleName).catch(() => false);
    const stillHasPassword   = await page.locator('input[type="password"]').count().catch(() => 0) > 0;
    if ((!stillShowingPicker && !stillHasPassword) || Date.now() >= deadline) break;
    await page.waitForTimeout(500);
  }

  return { matchedRole };
}

// Matches the section label apps use above pre-filled login shortcuts —
// wording varies ("Quick Access", "Demo credentials", "Demo accounts",
// "Choose a role to start", "One-click demo sign-in", ...).
const QUICK_ACCESS_LABEL_RE = /quick.access|demo.credential|demo.account|demo.user|sample.account|sample.user|test.account|choose.*role|select.*role|one.click|role.*sign.?in/i;

const QUICK_ACCESS_KNOWN_SELECTORS = [
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Try to click the Quick Access card whose visible text matches roleName. */
async function clickQuickAccessOptionByRole(page: Page, roleName: string): Promise<boolean> {
  const roleRe = new RegExp(escapeRegExp(roleName), 'i');

  // Strategy 1: any visible button (or role="button") whose text matches roleName
  // directly. No dependency on app-specific class names or a "quick access"/"demo"
  // label existing at all — just needs the role name to be the clickable label.
  // Handles frameworks (e.g. Streamlit) that render role-picker buttons with
  // generated class names the other strategies below won't recognize.
  try {
    const directButtons = page.locator('button, [role="button"]').filter({hasText: roleRe});
    const directCount = await directButtons.count().catch(() => 0);
    if (directCount > 0) {
      await directButtons.first().click();
      return true;
    }
  } catch {
    // fall through to next strategy
  }

  // Strategy 2: known class / data-testid patterns
  for (const sel of QUICK_ACCESS_KNOWN_SELECTORS) {
    const matched = page.locator(sel).filter({hasText: roleRe});
    const count = await matched.count().catch(() => 0);
    if (count > 0) {
      await matched.first().click();
      return true;
    }
  }

  // Strategy 3: container holding "Quick Access"/"Demo credentials"-style text
  try {
    const section = page
      .locator('div, section, aside, form')
      .filter({hasText: QUICK_ACCESS_LABEL_RE})
      .last();

    const isVisible = await section.isVisible({timeout: 2000}).catch(() => false);
    if (isVisible) {
      const buttons = section.locator('button, [role="button"]')
        .filter({hasNotText: QUICK_ACCESS_LABEL_RE})
        .filter({hasText: roleRe});
      const btnCount = await buttons.count().catch(() => 0);
      if (btnCount > 0) {
        await buttons.first().click();
        return true;
      }

      const cards = section.locator('div')
        .filter({has: page.locator('[class*="user-initials"], [class*="initials"], [class*="avatar"]')})
        .filter({hasText: roleRe});
      const cardCount = await cards.count().catch(() => 0);
      if (cardCount > 0) {
        await cards.first().click();
        return true;
      }
    }
  } catch {
    // fall through to next strategy
  }

  // Strategy 4: any element visible below the "Quick Access" divider label
  try {
    const label = page.locator(`text=${QUICK_ACCESS_LABEL_RE}`).first();
    const labelVisible = await label.isVisible({timeout: 1000}).catch(() => false);
    if (labelVisible) {
      const labelBox = await label.boundingBox().catch(() => null);
      if (labelBox) {
        const candidates = page.locator('div[class*="card"], div[class*="Card"], button, div[class*="cursor-pointer"]');
        const total = await candidates.count().catch(() => 0);
        for (let i = 0; i < total; i++) {
          const el = candidates.nth(i);
          const box = await el.boundingBox().catch(() => null);
          if (!box || box.y <= labelBox.y + labelBox.height) continue;
          const text = await el.innerText().catch(() => '');
          if (roleRe.test(text)) {
            await el.click();
            return true;
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
 * Is the Quick Access role-picker screen still showing? Used to verify a quick-access
 * login actually happened, since neither "did a password field disappear" nor "did the
 * URL leave /login" work for apps that have no password field and/or render the
 * authenticated dashboard at the same URL as the picker (e.g. single-page apps).
 */
export async function isQuickAccessScreenShowing(page: Page, roleName?: string): Promise<boolean> {
  // A role-name button or the "Quick Access"/"Demo Credentials" label text can each
  // independently appear on a FULLY AUTHENTICATED page for reasons that have nothing
  // to do with login — confirmed directly against a real app: a "current role" badge
  // button in the dashboard header (e.g. "Facility Admin"), and a totally unrelated
  // "Quick Access" shortcuts widget on the dashboard that happens to share the exact
  // label text of the login page's demo-credentials panel. Checking either signal
  // anywhere on the page (the old behavior) made this return true forever, even on a
  // genuinely, successfully authenticated page — which made every retry/relogin loop
  // built on top of this never terminate. Scope the role-button search to inside the
  // matched label section specifically, so an unrelated same-named badge or widget
  // elsewhere on the page can't trigger a false positive.
  // Require a button/[role="button"] descendant too, not just the label text — a
  // label-only wrapper (e.g. just the "Demo Credentials" heading, with the actual
  // account buttons living in a SIBLING container rather than a descendant) would
  // otherwise scope the role-button search to a container that structurally can't
  // ever contain it, making the check always false instead of always true.
  const section = page.locator('div, section, aside, form')
    .filter({hasText: QUICK_ACCESS_LABEL_RE})
    .filter({has: page.locator('button, [role="button"]')})
    .last();
  const sectionVisible = await section.isVisible({timeout: 1000}).catch(() => false);

  if (roleName) {
    const roleRe = new RegExp(escapeRegExp(roleName), 'i');
    const scope = sectionVisible ? section : page;
    return scope.locator('button, [role="button"]').filter({hasText: roleRe}).first()
      .isVisible().catch(() => false);
  }
  return sectionVisible;
}

async function clickQuickAccessOption(
  page: Page, index: number, roleName?: string,
): Promise<{ clicked: boolean; matchedRole: boolean }> {
  if (roleName) {
    const matchedByRole = await clickQuickAccessOptionByRole(page, roleName);
    if (matchedByRole) return { clicked: true, matchedRole: true };
    console.warn(`  ⚠ No Quick Access card matched role "${roleName}" — using default card index ${index}.`);
  }
  const clicked = await clickQuickAccessOptionByIndex(page, index);
  return { clicked, matchedRole: false };
}

/** Index-based fallback strategies — unchanged logic, extracted so clickQuickAccessOption
 *  can wrap it with role-match tracking without touching any of these strategies. */
async function clickQuickAccessOptionByIndex(page: Page, index: number): Promise<boolean> {
  // Strategy 1: known class / data-testid patterns (most-specific first)
  for (const sel of QUICK_ACCESS_KNOWN_SELECTORS) {
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
      .filter({hasText: QUICK_ACCESS_LABEL_RE})
      .last();

    const isVisible = await section.isVisible({timeout: 2000}).catch(() => false);
    if (isVisible) {
      // Try buttons first, then generic clickable divs with user names
      const buttons = section.locator('button, [role="button"]').filter({hasNotText: QUICK_ACCESS_LABEL_RE});
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
    const label = page.locator(`text=${QUICK_ACCESS_LABEL_RE}`).first();
    const labelVisible = await label.isVisible({timeout: 1000}).catch(() => false);
    if (labelVisible) {
      const labelBox = await label.boundingBox().catch(() => null);
      if (labelBox) {
        const candidates = page.locator('div[class*="card"], div[class*="Card"], button, div[class*="cursor-pointer"]');
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
