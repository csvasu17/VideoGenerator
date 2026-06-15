import type {Browser, BrowserContext, Page} from 'playwright';
import type {RecordingConfig} from '../types';

export interface SessionState {
  cookies: any[];
  origin:  string;
}

let _cache: SessionState | null = null;

export async function ensureSession(
  browser: Browser,
  config: RecordingConfig,
): Promise<SessionState | null> {
  if (_cache) return _cache;
  if (!config.credentials) return null;

  console.log('🔐 Logging in...');
  const ctx = await browser.newContext({
    viewport: config.viewport || {width: 1920, height: 1080},
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();
  try {
    await page.goto(config.appUrl, {waitUntil: 'networkidle', timeout: 30000});
    await performLogin(page, config.credentials);
    _cache = {cookies: await ctx.cookies(), origin: new URL(config.appUrl).origin};
    console.log('✅ Session saved.');
  } finally {
    await ctx.close();
  }
  return _cache;
}

export async function performLogin(
  page: Page,
  creds: NonNullable<RecordingConfig['credentials']>,
): Promise<void> {
  const {
    username, password,
    usernameSelector = 'input[type="email"],input[name="username"],input[name="email"],#username,#email',
    passwordSelector = 'input[type="password"],#password',
    submitSelector   = 'button[type="submit"],input[type="submit"],button:has-text("Login"),button:has-text("Sign In")',
    successIndicator,
  } = creds;

  await page.waitForSelector(usernameSelector, {timeout: 12000});
  await page.fill(usernameSelector, username);
  await page.fill(passwordSelector, password);
  await page.waitForTimeout(200);
  await page.click(submitSelector);

  if (successIndicator) {
    await page.waitForSelector(successIndicator, {timeout: 15000});
  } else {
    await page.waitForLoadState('networkidle', {timeout: 15000});
  }
}

export async function applySession(ctx: BrowserContext, state: SessionState): Promise<void> {
  await ctx.addCookies(state.cookies);
}
