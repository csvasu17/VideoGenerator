import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { IAuthAgent, AuthInput, AuthSession } from '../../core/ports/agents/IAuthAgent';
import * as fs   from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Selector strategies (tried in order; first match wins)
// ─────────────────────────────────────────────────────────────────────────────

const USERNAME_SELECTORS = [
  'input[type="email"]',
  'input[name="email"]',
  'input[name="username"]',
  'input[name="login"]',
  'input[name="user"]',
  'input[id="email"]',
  'input[id="username"]',
  'input[id="login"]',
  'input[autocomplete="username"]',
  'input[autocomplete="email"]',
  'input[placeholder*="email" i]',
  'input[placeholder*="username" i]',
];

const PASSWORD_SELECTORS = [
  'input[type="password"]',
  'input[name="password"]',
  'input[id="password"]',
  'input[autocomplete="current-password"]',
];

const SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button[data-testid*="login" i]',
  'button[data-testid*="signin" i]',
  '[role="button"][data-testid*="login" i]',
];

const SUBMIT_TEXT_PATTERNS = [
  /^log\s?in$/i,
  /^sign\s?in$/i,
  /^continue$/i,
  /^submit$/i,
  /^next$/i,
];

/** Common login path suffixes to try when no form is found on the root URL. */
const LOGIN_PATH_HINTS = ['/login', '/signin', '/auth', '/account/login', '/user/login'];

/** CSS patterns that typically indicate a login error message. */
const ERROR_SELECTORS = [
  '[class*="error" i]',
  '[class*="alert" i]',
  '[role="alert"]',
  '[aria-live="assertive"]',
  '[data-testid*="error" i]',
];

export interface AuthAgentConfig {
  headless:            boolean;
  navigationTimeoutMs: number;
  waitForNetworkIdle:  boolean;
  /**
   * Playwright device pixel ratio for the browser context.
   * Set to 2 for Retina-quality screenshots that stay crisp at camera zoom ≤2×.
   * Defaults to undefined (Playwright default = 1).
   */
  deviceScaleFactor?:  number;
}

const DEFAULT_CONFIG: AuthAgentConfig = {
  headless:            true,
  navigationTimeoutMs: 30_000,
  waitForNetworkIdle:  true,
};

/** Path where the recorder saves its session state (relative to project root). */
const RECORDER_SESSION_PATH = path.resolve(__dirname, '../../../.tmp/session-state.json');

// ─────────────────────────────────────────────────────────────────────────────
// AuthAgent
// ─────────────────────────────────────────────────────────────────────────────

export class AuthAgent implements IAuthAgent {
  constructor(private readonly config: Partial<AuthAgentConfig> = {}) {}

  async login(input: AuthInput): Promise<AuthSession> {
    const cfg: AuthAgentConfig = { ...DEFAULT_CONFIG, ...this.config };

    const browser = await chromium.launch({ headless: cfg.headless });

    const contextOptions = {
      viewport: { width: 1920, height: 1080 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      ignoreHTTPSErrors: true,
      ...(cfg.deviceScaleFactor !== undefined
        ? { deviceScaleFactor: cfg.deviceScaleFactor }
        : {}),
    };

    // ── Fast path: try the recorder's saved session state first ─────────────
    // If `npm run record` ran recently, .tmp/session-state.json is fresh.
    // We navigate to the app URL and check we are NOT on a login page.
    // This avoids the 30-second waitForURL timeout on SPAs that never change URL.
    if (fs.existsSync(RECORDER_SESSION_PATH)) {
      const context = await browser.newContext({
        ...contextOptions,
        storageState: RECORDER_SESSION_PATH,
      });
      try {
        const page = await context.newPage();
        await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: cfg.navigationTimeoutMs });
        await page.waitForTimeout(1500);
        const landedUrl = page.url();
        const hasPassword = await page.locator('input[type="password"]').first().isVisible({ timeout: 1000 }).catch(() => false);
        await page.close();

        if (!hasPassword) {
          // Session is still valid — authenticated without fresh login
          return {
            browser,
            context,
            authenticated: true,
            landedUrl,
            authenticatedAt: new Date().toISOString(),
          };
        }
        // Session expired — close this context and fall through to full login
        await context.close().catch(() => {});
      } catch {
        await context.close().catch(() => {});
      }
    }

    // ── Slow path: full fresh login ──────────────────────────────────────────
    const context = await browser.newContext(contextOptions);
    try {
      const page = await context.newPage();
      const authenticated = await this.attemptLogin(page, input, cfg);
      const landedUrl = page.url();
      await page.close();

      return {
        browser,
        context,
        authenticated,
        landedUrl,
        authenticatedAt: new Date().toISOString(),
      };
    } catch (err) {
      // Infrastructure failure — clean up and re-throw
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      throw err;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private implementation
  // ──────────────────────────────────────────────────────────────────────────

  private async attemptLogin(
    page:   Page,
    input:  AuthInput,
    cfg:    AuthAgentConfig,
  ): Promise<boolean> {
    const waitUntil = cfg.waitForNetworkIdle ? 'networkidle' : 'domcontentloaded';

    // ── 1. Navigate to the root URL ──────────────────────────────────────
    await page.goto(input.url, { waitUntil, timeout: cfg.navigationTimeoutMs });

    // ── 2. Find login form (may already be on root or need a sub-path) ───
    if (!(await this.hasLoginForm(page))) {
      const found = await this.navigateToLoginPage(page, input.url, cfg);
      if (!found) return false; // couldn't find a login form
    }

    // ── 3. Fill credentials ───────────────────────────────────────────────
    const userFilled = await this.fillField(page, USERNAME_SELECTORS, input.username);
    const passFilled = await this.fillField(page, PASSWORD_SELECTORS, input.password);
    if (!userFilled || !passFilled) return false;

    // ── 4. Submit ─────────────────────────────────────────────────────────
    // Capture the current URL so we can wait for it to change after submit.
    // This is more reliable than matching login path hints, which are already
    // satisfied for SPAs whose login form lives at the root ("/") path.
    const urlBeforeSubmit = page.url();

    const navDone = page
      .waitForURL(
        url => url.href !== urlBeforeSubmit,
        { timeout: cfg.navigationTimeoutMs },
      )
      .catch(() => { /* timeout OK — verifyAuthenticated will check the URL */ });

    const submitted = await this.submitForm(page);
    if (!submitted) return false;

    // ── 5. Wait for authentication signal ────────────────────────────────
    // SPAs often never change the URL — wait for the password field to be
    // DETACHED from the DOM (the most reliable post-login signal), racing
    // against a URL change.  Mirror the recorder's approach exactly.
    await Promise.race([
      page.waitForSelector('input[type="password"]', { state: 'detached', timeout: cfg.navigationTimeoutMs }),
      navDone,
    ]).catch(() => page.waitForTimeout(2000));

    // Belt-and-suspenders: let any lingering XHRs settle.
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});

    // ── 6. Verify ─────────────────────────────────────────────────────────
    return this.verifyAuthenticated(page, urlBeforeSubmit);
  }

  private async hasLoginForm(page: Page): Promise<boolean> {
    const passEl = await page.$(PASSWORD_SELECTORS[0]);
    return passEl !== null;
  }

  private async navigateToLoginPage(
    page: Page,
    baseUrl: string,
    cfg: AuthAgentConfig,
  ): Promise<boolean> {
    const origin = new URL(baseUrl).origin;
    for (const path of LOGIN_PATH_HINTS) {
      try {
        await page.goto(`${origin}${path}`, {
          waitUntil: 'domcontentloaded',
          timeout: cfg.navigationTimeoutMs,
        });
        if (await this.hasLoginForm(page)) return true;
      } catch {
        // skip — try next path
      }
    }
    return false;
  }

  /**
   * Try selectors in order; fill the first visible, enabled match.
   * Returns true if a field was filled.
   */
  private async fillField(page: Page, selectors: string[], value: string): Promise<boolean> {
    for (const sel of selectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
          await el.fill(value);
          return true;
        }
      } catch {
        // try next selector
      }
    }
    return false;
  }

  /** Click the submit button using selector + text pattern matching. */
  private async submitForm(page: Page): Promise<boolean> {
    // Try explicit submit selectors first
    for (const sel of SUBMIT_SELECTORS) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
          await el.click();
          return true;
        }
      } catch {
        // try next
      }
    }

    // Fall back: find any button whose text matches a submit pattern
    const buttons = page.locator('button');
    const count = await buttons.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      try {
        const btn = buttons.nth(i);
        const text = (await btn.textContent() ?? '').trim();
        if (SUBMIT_TEXT_PATTERNS.some(p => p.test(text))) {
          await btn.click();
          return true;
        }
      } catch {
        // try next
      }
    }

    // Last resort: submit the first form programmatically
    const submitted = await page.evaluate(() => {
      const form = document.querySelector('form');
      if (!form) return false;
      form.submit();
      return true;
    });
    return submitted;
  }

  /**
   * Returns true when authentication succeeded.
   *
   * Priority order:
   *
   *   1. URL change: if the current URL differs from the pre-submit URL AND is
   *      not a known login path, we navigated away → authenticated.
   *      (Most reliable signal for SPAs that navigate after login.)
   *
   *   2. Still on login path: URL contains a recognised login path hint → fail.
   *
   *   3. URL unchanged + login form still visible: API call may still be in
   *      flight or login failed → fail.
   *
   *   4. URL unchanged + login form gone: SPA rendered a new component at the
   *      same root URL (no router navigation) → authenticated.
   */
  private async verifyAuthenticated(
    page:            Page,
    urlBeforeSubmit: string,
  ): Promise<boolean> {
    const currentUrl = page.url();

    // ── 1. URL changed → check it is not a login path ────────────────────────
    if (currentUrl !== urlBeforeSubmit) {
      return !LOGIN_PATH_HINTS.some(p => currentUrl.includes(p));
    }

    // ── 2. Still on a recognised login path ──────────────────────────────────
    if (LOGIN_PATH_HINTS.some(p => currentUrl.includes(p))) {
      return false;
    }

    // ── 3. URL unchanged — check if the login form is still in the DOM ───────
    // Use count() instead of isVisible() — the form may be hidden but not removed.
    // A count of 0 means fully detached → authenticated.
    const passCount = await page.locator(PASSWORD_SELECTORS[0]).count().catch(() => 0);
    return passCount === 0;
  }
}
