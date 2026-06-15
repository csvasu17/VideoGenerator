// ─────────────────────────────────────────────────────────────────────────────
// PushStateInterceptor  (RF9)
//
// Monkey-patches history.pushState, history.replaceState, the `popstate`
// event, and `hashchange` so every client-side navigation is captured into
// window.__spaRoutes[].
//
// Usage:
//   1. Call installOnContext(context) ONCE before opening any pages.
//      Playwright's addInitScript guarantees the patch runs before any
//      application code on every future page in that context.
//   2. After each page.goto() call drain() to collect captured routes,
//      then resolve them against the page's origin.
//
// Design notes:
//   • The script uses a guard flag (__spaInterceptorInstalled) so it is safe
//     to install multiple times (e.g. via context + page init scripts).
//   • drain() atomically reads and clears the buffer so concurrent visits
//     don't double-count routes.
//   • Relative paths (e.g. "/dashboard") are returned as-is; the caller is
//     responsible for resolving them against an origin.
// ─────────────────────────────────────────────────────────────────────────────

import type { BrowserContext, Page } from 'playwright';

// ── Init script (injected into every page via context.addInitScript) ─────────

export const PUSH_STATE_INTERCEPT_SCRIPT = /* js */ `(() => {
  if (window.__spaInterceptorInstalled) return;
  window.__spaInterceptorInstalled = true;
  window.__spaRoutes = [];

  function record(url) {
    if (url !== null && url !== undefined && String(url).length > 0) {
      window.__spaRoutes.push(String(url));
    }
  }

  // Patch history.pushState
  var _origPush = history.pushState.bind(history);
  history.pushState = function(state, title, url) {
    record(url);
    return _origPush(state, title, url);
  };

  // Patch history.replaceState
  var _origReplace = history.replaceState.bind(history);
  history.replaceState = function(state, title, url) {
    record(url);
    return _origReplace(state, title, url);
  };

  // Capture hash changes (Angular hash-mode, legacy routing)
  window.addEventListener('hashchange', function(e) {
    record(e.newURL);
  });

  // Capture browser back/forward navigation
  window.addEventListener('popstate', function() {
    record(window.location.href);
  });
})()`;

// ── Drain script (evaluates in page context to read + clear the buffer) ──────

const DRAIN_SCRIPT = /* js */ `(() => {
  var routes = Array.isArray(window.__spaRoutes) ? window.__spaRoutes.slice() : [];
  window.__spaRoutes = [];
  return routes;
})()`;

// ─────────────────────────────────────────────────────────────────────────────
// PushStateInterceptor
// ─────────────────────────────────────────────────────────────────────────────

export class PushStateInterceptor {
  /**
   * Install the intercept script on a BrowserContext so it is active on every
   * page opened from that context.
   *
   * Must be called before any pages are opened.
   */
  async installOnContext(context: BrowserContext): Promise<void> {
    await context.addInitScript(PUSH_STATE_INTERCEPT_SCRIPT);
  }

  /**
   * Read all routes captured since the last drain() call on `page`, then
   * clear the in-page buffer.
   *
   * Returns raw strings exactly as passed to pushState/replaceState —
   * typically root-relative paths ("/dashboard") or full URLs.
   *
   * Never throws — returns [] on any error.
   */
  async drain(page: Page): Promise<string[]> {
    try {
      const routes = await page.evaluate<string[]>(DRAIN_SCRIPT as string);
      return Array.isArray(routes) ? routes : [];
    } catch {
      return [];
    }
  }
}
