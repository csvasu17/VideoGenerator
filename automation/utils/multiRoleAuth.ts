/**
 * multiRoleAuth.ts — shared 3-layer login (cached session → headless → interactive
 * fallback), extracted from automation/record-app-clips.ts's proven `acquireSession`
 * implementation (previously private/unexported there, and the most robust of the
 * three login helpers surveyed in this codebase — more so than session.ts's
 * single-cache `ensureSession`, which caches only one session in a module-level
 * variable and is unsuitable for looping many roles in one run).
 *
 * Parameterized (not reading module-level globals) so both record-app-clips.ts-style
 * scripts and the new exhaustive Agent Recording engine can share this exact,
 * already-battle-tested logic instead of forking a third copy.
 */

import { chromium } from 'playwright';
import type { Browser, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { performLogin, isQuickAccessScreenShowing } from './session';
import type { SessionState, RoleMatchConfidence } from './session';
import { toSlug } from '../config';
import { extractPrimaryRole } from './roleLabel';

export interface MultiRoleAuthConfig {
  appUrl:    string;
  loginUrl:  string;
  loginType: '1' | '2';
  username:  string;
  password:  string;
  viewport:  { width: number; height: number };
  tmpDir:    string;
  /** Used only to pick a representative route for cached-session verification per role. */
  routeMap?: Record<string, string>;
}

export interface AcquiredSession {
  session:              SessionState;
  liveCtx:              BrowserContext;
  roleMatchConfidence:  RoleMatchConfidence;
}

// ── Layer 2: headless login ──────────────────────────────────────────────────

async function tryHeadlessLogin(
  browser:          Browser,
  storageStatePath: string,
  recDir:           string,
  config:           MultiRoleAuthConfig,
  roleName?:        string,
): Promise<(SessionState & { liveCtx: BrowserContext; roleMatchConfidence: RoleMatchConfidence }) | null> {
  const ctx  = await browser.newContext({
    viewport:    config.viewport,
    recordVideo: { dir: recDir, size: config.viewport },
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();

  // Hide navigator.webdriver so React apps don't block automated input
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  let success = false;
  let roleMatchConfidence: RoleMatchConfidence = 'not-applicable';
  try {
    let formFound = false;
    for (const loginUrl of [config.loginUrl, config.appUrl]) {
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
      const pwdCount = await page.locator('input[type="password"]').count().catch(() => 0);
      if (pwdCount > 0) { formFound = true; break; }
    }
    if (!formFound) return null;

    if (config.loginType === '2') {
      const result = await performLogin(page, {
        loginType: 2, username: config.username, password: config.password,
        quickAccessIndex: 0, quickAccessRoleName: roleName,
      });
      roleMatchConfidence = result.roleMatchConfidence;
    } else {
      const emailSel = [
        'input[type="email"]', 'input[name="email"]', 'input[name="username"]',
        'input[placeholder*="email" i]', 'input[placeholder*="user" i]', 'input[type="text"]',
      ].join(', ');

      const emailInput = page.locator(emailSel).first();
      await emailInput.waitFor({ timeout: 5000 }).catch(() => {});
      await emailInput.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Delete');
      await page.keyboard.type(config.username, { delay: 50 });

      const pwdInput = page.locator('input[type="password"]').first();
      await pwdInput.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Delete');
      await page.keyboard.type(config.password, { delay: 50 });

      const submitSel = 'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign In"), button:has-text("Log In"), button:has-text("Log in")';
      const submitCount = await page.locator(submitSel).count().catch(() => 0);
      if (submitCount > 0) {
        await page.locator(submitSel).first().click();
      } else {
        await pwdInput.press('Enter');
      }

      await page.locator('input[type="password"]').first()
        .waitFor({ state: 'detached', timeout: 15000 })
        .catch(() => {});
    }

    // Extra settle time for tokens/storage — and for the old login DOM to fully unmount
    await page.waitForTimeout(3000);

    const stillHasForm = await page.locator('input[type="password"]').count().catch(() => 0);
    if (stillHasForm > 0) {
      console.warn('  ↳ Password form still visible after login attempt — credentials may be wrong.');
      console.warn(`    username=${config.username}  appUrl=${config.appUrl}`);
      return null;
    }

    const postLoginUrl = page.url();

    // Detect "login redirect loop": the app cleared the form but bounced us back to login.
    const backAtLoginRoot = postLoginUrl.replace(/\/$/, '') === config.loginUrl.replace(/\/$/, '');
    let isStillLoginPage = postLoginUrl.includes('/login') || postLoginUrl.includes('/signin');
    if (!isStillLoginPage && backAtLoginRoot) {
      isStillLoginPage = config.loginType === '2'
        ? await isQuickAccessScreenShowing(page, roleName)
        : true;
    }
    if (isStillLoginPage) {
      console.warn(`  ↳ Post-login URL is still the login page (${postLoginUrl}) — login failed silently.`);
      return null;
    }

    await ctx.storageState({ path: storageStatePath });
    await page.close(); // close login page; keep context alive for recording
    success = true;
    return { storageStatePath, postLoginUrl, origin: new URL(config.appUrl).origin, liveCtx: ctx, roleMatchConfidence };
  } finally {
    if (!success) await ctx.close();
  }
}

// ── Layer 3: visible browser — user logs in manually ──────────────────────────

async function tryInteractiveLogin(
  config:           MultiRoleAuthConfig,
  storageStatePath: string,
  roleName?:        string,
): Promise<SessionState | null> {
  console.log('\n  ┌──────────────────────────────────────────────────────────────────┐');
  console.log('  │  MANUAL LOGIN REQUIRED                                           │');
  console.log('  │  A browser window will open. Please log in to the app.          │');
  console.log(`  │  URL: ${config.loginUrl.padEnd(62)}│`);
  if (roleName) {
    console.log(`  │  Log in as role: ${roleName.padEnd(51)}│`);
  }
  console.log('  │  The pipeline continues automatically after you log in.         │');
  console.log('  │  You have 3 minutes.                                            │');
  console.log('  └──────────────────────────────────────────────────────────────────┘\n');

  const visibleBrowser = await chromium.launch({
    headless: false,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
  });
  try {
    const ctx  = await visibleBrowser.newContext({ viewport: null, ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    if (config.loginType === '2') {
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline && await isQuickAccessScreenShowing(page, roleName)) {
        await page.waitForTimeout(1000);
      }
    } else {
      await page.waitForSelector('input[type="password"]', { timeout: 20000 }).catch(() => {});
      await Promise.race([
        page.waitForSelector('input[type="password"]', { state: 'detached', timeout: 180000 }),
        page.waitForURL(
          (u: URL) => !u.href.includes('/login') && !u.href.includes('/signin'),
          { timeout: 180000 },
        ),
      ]);
    }

    const postLoginUrl = page.url();
    await ctx.storageState({ path: storageStatePath });
    console.log(`\n  ✓ Manual login successful — post-login: ${postLoginUrl}`);
    return { storageStatePath, postLoginUrl, origin: new URL(config.appUrl).origin };
  } catch (err) {
    console.error(`  ✗ Interactive login timed out or failed: ${(err as Error).message?.slice(0, 100)}`);
    return null;
  } finally {
    await visibleBrowser.close();
  }
}

// ── Layer 1 + orchestration ────────────────────────────────────────────────────

export async function acquireSession(
  browser: Browser,
  recDir:  string,
  config:  MultiRoleAuthConfig,
  opts?:   { roleName?: string },
): Promise<AcquiredSession | null> {
  fs.mkdirSync(config.tmpDir, { recursive: true });
  fs.mkdirSync(recDir, { recursive: true });
  const roleName = opts?.roleName;
  const storageStatePath = path.join(
    config.tmpDir,
    roleName ? `session-state-${toSlug(roleName)}.json` : 'session-state.json',
  );
  const origin = new URL(config.appUrl).origin;

  // ── Layer 1: reuse cached session if < 8 h old and still authenticated ──
  if (fs.existsSync(storageStatePath)) {
    const ageMs = Date.now() - fs.statSync(storageStatePath).mtimeMs;
    if (ageMs < 8 * 60 * 60 * 1000) {
      console.log(`  Cached session found (${Math.round(ageMs / 60000)}m old) — verifying…`);
      try {
        const roleRoute = roleName && config.routeMap
          ? Object.keys(config.routeMap).find(r => extractPrimaryRole(config.routeMap![r]) === roleName)
          : undefined;
        const firstRoute = roleRoute ?? (config.routeMap ? Object.keys(config.routeMap)[0] : undefined) ?? '/';
        const verCtx  = await browser.newContext({ storageState: storageStatePath, ignoreHTTPSErrors: true });
        const verPage = await verCtx.newPage();
        await verPage.goto(`${config.appUrl}${firstRoute}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await verPage.waitForTimeout(2000);
        const verUrl     = verPage.url();
        const verHasForm = await verPage.locator('input[type="password"]').count().catch(() => 0);
        await verCtx.close();
        const verIsLogin =
          verUrl.includes('/login') || verUrl.includes('/signin') ||
          verUrl.replace(/\/$/, '') === config.loginUrl.replace(/\/$/, '');
        if (!verIsLogin && verHasForm === 0) {
          console.log(`  ✓ Cached session valid — skipping login`);
          const liveCtx = await browser.newContext({
            storageState: storageStatePath,
            viewport:     config.viewport,
            recordVideo:  { dir: recDir, size: config.viewport },
            ignoreHTTPSErrors: true,
          });
          return {
            session: { storageStatePath, postLoginUrl: verUrl, origin },
            liveCtx,
            roleMatchConfidence: 'not-applicable',
          };
        }
        console.log('  ↳ Session expired — re-authenticating…');
      } catch {
        console.log('  ↳ Session verify failed — re-authenticating…');
      }
    }
  }

  // ── Layer 2: try headless login ──
  console.log(`  Attempting headless login${roleName ? ` as "${roleName}"` : ''}…`);
  const headlessResult = await tryHeadlessLogin(browser, storageStatePath, recDir, config, roleName);
  if (headlessResult) {
    const { liveCtx, roleMatchConfidence, ...sessionFields } = headlessResult;
    console.log(`  ✓ Headless login succeeded — post-login: ${sessionFields.postLoginUrl}`);
    return { session: sessionFields, liveCtx, roleMatchConfidence };
  }
  console.log('  ↳ Headless login failed — falling back to manual login…');

  // ── Layer 3: interactive (visible) browser ──
  const interactiveSession = await tryInteractiveLogin(config, storageStatePath, roleName);
  if (!interactiveSession) return null;
  const liveCtx = await browser.newContext({
    storageState: storageStatePath,
    viewport:     config.viewport,
    recordVideo:  { dir: recDir, size: config.viewport },
    ignoreHTTPSErrors: true,
  });
  return { session: interactiveSession, liveCtx, roleMatchConfidence: 'not-applicable' };
}
