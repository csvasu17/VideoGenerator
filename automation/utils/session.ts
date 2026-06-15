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
