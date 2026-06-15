import { SPALinkExtractor } from '../SPALinkExtractor';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const ORIGIN = 'https://app.example.com';

type RawLink = { value: string; tag: string };

function makePage(rawLinks: RawLink[]) {
  return { evaluate: jest.fn().mockResolvedValue(rawLinks) };
}

// ─────────────────────────────────────────────────────────────────────────────
// SPALinkExtractor
// ─────────────────────────────────────────────────────────────────────────────

describe('SPALinkExtractor', () => {
  let extractor: SPALinkExtractor;

  beforeEach(() => { extractor = new SPALinkExtractor(); });

  // ── Angular routerLink ─────────────────────────────────────────────────────

  describe('Angular [routerLink]', () => {
    it('resolves root-relative routerLink paths to absolute URLs', async () => {
      const page = makePage([{ value: '/dashboard', tag: 'routerlink' }]);
      const links = await extractor.extract(page as never, ORIGIN);
      expect(links).toContain(`${ORIGIN}/dashboard`);
    });

    it('resolves multiple routerLink values', async () => {
      const page = makePage([
        { value: '/dashboard', tag: 'routerlink' },
        { value: '/settings',  tag: 'routerlink' },
        { value: '/reports',   tag: 'routerlink' },
      ]);
      const links = await extractor.extract(page as never, ORIGIN);
      expect(links).toHaveLength(3);
    });

    it('strips trailing slashes from resolved URLs', async () => {
      const page = makePage([{ value: '/dashboard/', tag: 'routerlink' }]);
      const links = await extractor.extract(page as never, ORIGIN);
      expect(links[0]).not.toMatch(/\/$/);
    });
  });

  // ── data-href ──────────────────────────────────────────────────────────────

  describe('data-href attribute', () => {
    it('resolves data-href to an absolute URL', async () => {
      const page = makePage([{ value: '/analytics', tag: 'data-href' }]);
      const links = await extractor.extract(page as never, ORIGIN);
      expect(links).toContain(`${ORIGIN}/analytics`);
    });

    it('handles full absolute data-href on the same origin', async () => {
      const page = makePage([{ value: `${ORIGIN}/reports`, tag: 'data-href' }]);
      const links = await extractor.extract(page as never, ORIGIN);
      expect(links).toContain(`${ORIGIN}/reports`);
    });
  });

  // ── data-to ────────────────────────────────────────────────────────────────

  describe('data-to attribute', () => {
    it('resolves data-to to an absolute URL', async () => {
      const page = makePage([{ value: '/users', tag: 'data-to' }]);
      const links = await extractor.extract(page as never, ORIGIN);
      expect(links).toContain(`${ORIGIN}/users`);
    });
  });

  // ── Deduplication ──────────────────────────────────────────────────────────

  describe('deduplication', () => {
    it('deduplicates identical paths from different attribute sources', async () => {
      const page = makePage([
        { value: '/dashboard', tag: 'routerlink' },
        { value: '/dashboard', tag: 'data-href' },
      ]);
      const links = await extractor.extract(page as never, ORIGIN);
      expect(links.filter(l => l.includes('/dashboard'))).toHaveLength(1);
    });
  });

  // ── Filtering ─────────────────────────────────────────────────────────────

  describe('filtering', () => {
    it('excludes external URLs (different origin)', async () => {
      const page = makePage([{ value: 'https://external.com/path', tag: 'routerlink' }]);
      const links = await extractor.extract(page as never, ORIGIN);
      expect(links).toHaveLength(0);
    });

    it('excludes fragment-only values', async () => {
      const page = makePage([{ value: '#section', tag: 'routerlink' }]);
      const links = await extractor.extract(page as never, ORIGIN);
      expect(links).toHaveLength(0);
    });

    it('applies excludePatterns', async () => {
      const page = makePage([
        { value: '/logout', tag: 'routerlink' },
        { value: '/dashboard', tag: 'routerlink' },
      ]);
      const links = await extractor.extract(page as never, ORIGIN, [/\/logout/i]);
      expect(links).not.toContain(`${ORIGIN}/logout`);
      expect(links).toContain(`${ORIGIN}/dashboard`);
    });

    it('skips blank/empty values', async () => {
      const page = makePage([
        { value: '',  tag: 'routerlink' },
        { value: '/', tag: 'routerlink' },
      ]);
      const links = await extractor.extract(page as never, ORIGIN);
      expect(links).toHaveLength(0);
    });

    it('skips javascript: values', async () => {
      const page = makePage([{ value: 'javascript:void(0)', tag: 'data-href' }]);
      const links = await extractor.extract(page as never, ORIGIN);
      expect(links).toHaveLength(0);
    });
  });

  // ── Error resilience ───────────────────────────────────────────────────────

  describe('error resilience', () => {
    it('returns [] when page.evaluate() throws', async () => {
      const page = { evaluate: jest.fn().mockRejectedValue(new Error('page closed')) };
      const links = await extractor.extract(page as never, ORIGIN);
      expect(links).toEqual([]);
    });

    it('returns [] when page.evaluate() returns null', async () => {
      const page = { evaluate: jest.fn().mockResolvedValue(null) };
      const links = await extractor.extract(page as never, ORIGIN);
      expect(links).toEqual([]);
    });

    it('returns [] when page.evaluate() returns a non-array', async () => {
      const page = { evaluate: jest.fn().mockResolvedValue({ oops: true }) };
      const links = await extractor.extract(page as never, ORIGIN);
      expect(links).toEqual([]);
    });
  });
});
