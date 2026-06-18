import type { Browser, BrowserContext } from 'playwright';

export interface AuthInput {
  /** Root URL of the application. */
  url:      string;
  username: string;
  password: string;
  /** 1 = fill username+password (default); 2 = click a Quick Access option */
  loginType?:        1 | 2;
  /** Which Quick Access card to click (0-based). Only used when loginType=2. Default: 0 */
  quickAccessIndex?: number;
}

/**
 * Live Playwright session returned after successful authentication.
 * The caller is responsible for closing browser + context after use.
 */
export interface AuthSession {
  browser:       Browser;
  context:       BrowserContext;
  /** True when credentials were accepted and the app navigated past the login page. */
  authenticated: boolean;
  /** The URL the browser landed on after login. */
  landedUrl:     string;
  /** ISO timestamp of when the session was established. */
  authenticatedAt: string;
}

export interface IAuthAgent {
  /**
   * Launch a headless browser, navigate to `input.url`, fill credentials,
   * and return a live authenticated session.
   *
   * Never throws for credential failures — instead returns
   * `authenticated: false` with the browser still open so the caller can
   * decide to abort or retry. Throws only on infrastructure failures
   * (browser won't launch, network unreachable).
   */
  login(input: AuthInput): Promise<AuthSession>;
}
