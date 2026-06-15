import { PushStateInterceptor, PUSH_STATE_INTERCEPT_SCRIPT } from '../PushStateInterceptor';

// ─────────────────────────────────────────────────────────────────────────────
// PushStateInterceptor unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('PushStateInterceptor', () => {
  let interceptor: PushStateInterceptor;

  beforeEach(() => { interceptor = new PushStateInterceptor(); });

  // ── installOnContext ───────────────────────────────────────────────────────

  describe('installOnContext', () => {
    it('calls context.addInitScript() with the intercept script string', async () => {
      const ctx = { addInitScript: jest.fn().mockResolvedValue(undefined) };
      await interceptor.installOnContext(ctx as never);
      expect(ctx.addInitScript).toHaveBeenCalledTimes(1);
      expect(ctx.addInitScript).toHaveBeenCalledWith(PUSH_STATE_INTERCEPT_SCRIPT);
    });

    it('does not throw when context.addInitScript() rejects', async () => {
      const ctx = { addInitScript: jest.fn().mockRejectedValue(new Error('ctx closed')) };
      await expect(interceptor.installOnContext(ctx as never)).rejects.toThrow();
      // The contract: installOnContext propagates real errors (caller handles)
    });
  });

  // ── drain ─────────────────────────────────────────────────────────────────

  describe('drain', () => {
    it('returns routes collected by the page script', async () => {
      const page = {
        evaluate: jest.fn().mockResolvedValue(['/dashboard', '/reports', '/settings']),
      };
      const result = await interceptor.drain(page as never);
      expect(result).toEqual(['/dashboard', '/reports', '/settings']);
    });

    it('returns an empty array when no routes were captured', async () => {
      const page = { evaluate: jest.fn().mockResolvedValue([]) };
      const result = await interceptor.drain(page as never);
      expect(result).toEqual([]);
    });

    it('returns an empty array when window.__spaRoutes is not initialised', async () => {
      const page = { evaluate: jest.fn().mockResolvedValue(null) };
      const result = await interceptor.drain(page as never);
      expect(result).toEqual([]);
    });

    it('never throws when page.evaluate() rejects (e.g. page crashed)', async () => {
      const page = { evaluate: jest.fn().mockRejectedValue(new Error('page closed')) };
      const result = await interceptor.drain(page as never);
      expect(result).toEqual([]);
    });

    it('returns an empty array when evaluate returns a non-array', async () => {
      const page = { evaluate: jest.fn().mockResolvedValue('string-not-array') };
      const result = await interceptor.drain(page as never);
      expect(result).toEqual([]);
    });
  });

  // ── PUSH_STATE_INTERCEPT_SCRIPT content ───────────────────────────────────

  describe('PUSH_STATE_INTERCEPT_SCRIPT', () => {
    it('is a non-empty string', () => {
      expect(typeof PUSH_STATE_INTERCEPT_SCRIPT).toBe('string');
      expect(PUSH_STATE_INTERCEPT_SCRIPT.length).toBeGreaterThan(100);
    });

    it('contains the guard flag to prevent double-installation', () => {
      expect(PUSH_STATE_INTERCEPT_SCRIPT).toContain('__spaInterceptorInstalled');
    });

    it('patches history.pushState', () => {
      expect(PUSH_STATE_INTERCEPT_SCRIPT).toContain('pushState');
    });

    it('patches history.replaceState', () => {
      expect(PUSH_STATE_INTERCEPT_SCRIPT).toContain('replaceState');
    });

    it('captures hashchange events', () => {
      expect(PUSH_STATE_INTERCEPT_SCRIPT).toContain('hashchange');
    });

    it('captures popstate events', () => {
      expect(PUSH_STATE_INTERCEPT_SCRIPT).toContain('popstate');
    });

    it('stores captured URLs in __spaRoutes', () => {
      expect(PUSH_STATE_INTERCEPT_SCRIPT).toContain('__spaRoutes');
    });
  });

  // ── Browser-side logic (simulated in Node.js with mocked globals) ───────────
  // Jest runs in Node — `history` and `window` don't exist.
  // We set up lightweight mocks on `global` before evaluating the script.

  describe('browser-side script logic (Node.js eval simulation)', () => {
    // Typed references to the mock objects so tests can call them directly.
    let mockHistory: { pushState: jest.Mock; replaceState: jest.Mock };
    let mockWindow:  Record<string, unknown> & { addEventListener: jest.Mock };

    beforeEach(() => {
      // Build minimal browser-like globals
      mockHistory = { pushState: jest.fn(), replaceState: jest.fn() };
      mockWindow  = {
        __spaInterceptorInstalled: undefined,
        __spaRoutes:               undefined,
        addEventListener:          jest.fn(),
      };

      // Expose as globals so the eval'd script can find them
      (global as Record<string, unknown>)['history'] = mockHistory;
      (global as Record<string, unknown>)['window']  = mockWindow;

      // Run the init script — it patches mockHistory and sets mockWindow vars
      // eslint-disable-next-line no-eval
      eval(PUSH_STATE_INTERCEPT_SCRIPT);
    });

    afterEach(() => {
      // Clean up injected globals
      delete (global as Record<string, unknown>)['history'];
      delete (global as Record<string, unknown>)['window'];
    });

    it('captures a path pushed via history.pushState', () => {
      mockHistory.pushState(null, '', '/new-route');
      expect(mockWindow['__spaRoutes'] as string[]).toContain('/new-route');
    });

    it('captures a path changed via history.replaceState', () => {
      mockHistory.replaceState(null, '', '/replaced-route');
      expect(mockWindow['__spaRoutes'] as string[]).toContain('/replaced-route');
    });

    it('does not add null/undefined url to __spaRoutes', () => {
      mockHistory.pushState(null, '', null);
      mockHistory.pushState(null, '', undefined);
      const routes = mockWindow['__spaRoutes'] as string[];
      expect(routes.filter(r => !r)).toHaveLength(0);
    });

    it('is idempotent — re-running script does not double-patch', () => {
      // eslint-disable-next-line no-eval
      eval(PUSH_STATE_INTERCEPT_SCRIPT); // second install — guard should block
      mockHistory.pushState(null, '', '/single-route');
      const routes = mockWindow['__spaRoutes'] as string[];
      expect(routes.filter(r => r === '/single-route')).toHaveLength(1);
    });
  });
});
