import { NextJsRouteExtractor, parseSortedPages, isDynamicPath } from '../NextJsRouteExtractor';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_MANIFEST = `
self.__BUILD_MANIFEST={"__rewrites":{"beforeFiles":[],"afterFiles":[],"fallback":[]},"sortedPages":["/_app","/_error","/_not-found","/","about","/dashboard","/reports","/users/[id]","/settings/profile"]};
self.__BUILD_MANIFEST_CB&&self.__BUILD_MANIFEST_CB()
`;

function makePage(buildId: string | null, manifestText: string | null) {
  const evaluate = jest.fn()
    .mockResolvedValueOnce(buildId)       // GET_BUILD_ID
    .mockResolvedValueOnce(manifestText); // FETCH_MANIFEST
  return { evaluate };
}

// ─────────────────────────────────────────────────────────────────────────────
// parseSortedPages (pure function)
// ─────────────────────────────────────────────────────────────────────────────

describe('parseSortedPages', () => {
  it('extracts sortedPages from a standard manifest', () => {
    const pages = parseSortedPages(SAMPLE_MANIFEST);
    expect(pages).toContain('/');
    expect(pages).toContain('/dashboard');
    expect(pages).toContain('/reports');
    expect(pages).toContain('/users/[id]');
  });

  it('includes internal Next.js pages (filtered by extractor, not parser)', () => {
    const pages = parseSortedPages(SAMPLE_MANIFEST);
    expect(pages).toContain('/_app');
    expect(pages).toContain('/_error');
  });

  it('returns an empty array when sortedPages is absent', () => {
    expect(parseSortedPages('self.__BUILD_MANIFEST={"__rewrites":{}}')).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseSortedPages('')).toEqual([]);
  });

  it('handles nested brackets in the manifest without breaking', () => {
    const js = 'self.__BUILD_MANIFEST={"sortedPages":["/[[...slug]]","/normal"]}';
    const pages = parseSortedPages(js);
    expect(pages).toContain('/normal');
  });

  it('returns an empty array when JSON is malformed', () => {
    expect(parseSortedPages('"sortedPages": [broken')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isDynamicPath (pure function)
// ─────────────────────────────────────────────────────────────────────────────

describe('isDynamicPath', () => {
  it('detects [param] — Next.js style', () => expect(isDynamicPath('/users/[id]')).toBe(true));
  it('detects [[...slug]] — catch-all', () => expect(isDynamicPath('/blog/[[...slug]]')).toBe(true));
  it('detects :param — Express style', () => expect(isDynamicPath('/users/:id')).toBe(true));
  it('detects {param} — Angular style', () => expect(isDynamicPath('/users/{id}')).toBe(true));
  it('returns false for a static path', () => expect(isDynamicPath('/dashboard')).toBe(false));
  it('returns false for the root', () => expect(isDynamicPath('/')).toBe(false));
  it('returns false for a path with hyphens', () => expect(isDynamicPath('/user-settings')).toBe(false));
});

// ─────────────────────────────────────────────────────────────────────────────
// NextJsRouteExtractor
// ─────────────────────────────────────────────────────────────────────────────

describe('NextJsRouteExtractor', () => {
  let extractor: NextJsRouteExtractor;
  const ORIGIN = 'https://app.example.com';

  beforeEach(() => { extractor = new NextJsRouteExtractor(); });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('returns static routes from a valid manifest', async () => {
    const page = makePage('abc123', SAMPLE_MANIFEST);
    const routes = await extractor.extractRoutes(page as never, ORIGIN);

    const paths = routes.map(r => r.path);
    expect(paths).toContain('/');
    expect(paths).toContain('/dashboard');
    expect(paths).toContain('/reports');
    expect(paths).toContain('/settings/profile');
  });

  it('marks dynamic routes as isDynamic: true', async () => {
    const page = makePage('abc123', SAMPLE_MANIFEST);
    const routes = await extractor.extractRoutes(page as never, ORIGIN);
    const dynamic = routes.filter(r => r.isDynamic);
    expect(dynamic.map(r => r.path)).toContain('/users/[id]');
  });

  it('marks static routes as isDynamic: false', async () => {
    const page = makePage('abc123', SAMPLE_MANIFEST);
    const routes = await extractor.extractRoutes(page as never, ORIGIN);
    const dashboard = routes.find(r => r.path === '/dashboard');
    expect(dashboard?.isDynamic).toBe(false);
  });

  it('excludes internal Next.js pages', async () => {
    const page = makePage('abc123', SAMPLE_MANIFEST);
    const routes = await extractor.extractRoutes(page as never, ORIGIN);
    const paths = routes.map(r => r.path);
    expect(paths).not.toContain('/_app');
    expect(paths).not.toContain('/_error');
    expect(paths).not.toContain('/_not-found');
  });

  it('sets source to "manifest" for all routes', async () => {
    const page = makePage('abc123', SAMPLE_MANIFEST);
    const routes = await extractor.extractRoutes(page as never, ORIGIN);
    expect(routes.every(r => r.source === 'manifest')).toBe(true);
  });

  // ── Fallback / error cases ─────────────────────────────────────────────────

  it('returns [] when buildId is null (not Next.js)', async () => {
    const page = makePage(null, null);
    const routes = await extractor.extractRoutes(page as never, ORIGIN);
    expect(routes).toEqual([]);
  });

  it('returns [] when the manifest fetch returns null', async () => {
    const page = makePage('abc123', null);
    const routes = await extractor.extractRoutes(page as never, ORIGIN);
    expect(routes).toEqual([]);
  });

  it('returns [] when page.evaluate() throws', async () => {
    const page = { evaluate: jest.fn().mockRejectedValue(new Error('crash')) };
    const routes = await extractor.extractRoutes(page as never, ORIGIN);
    expect(routes).toEqual([]);
  });

  it('returns [] for an empty manifest (no sortedPages)', async () => {
    const page = makePage('abc123', 'self.__BUILD_MANIFEST={"__rewrites":{}}');
    const routes = await extractor.extractRoutes(page as never, ORIGIN);
    expect(routes).toEqual([]);
  });
});
