// ─────────────────────────────────────────────────────────────────────────────
// DiscoveryAgent  (RF9 — SPA Router support)
//
// Augments the original BFS crawler with client-side routing awareness:
//
//  Detection layer (run once on the first page):
//   • SPAFrameworkDetector  — identifies Next.js / React Router / Vue Router
//                             / Angular Router from live window globals
//   • NextJsRouteExtractor  — fetches _buildManifest.js for the full route list
//
//  Per-page augmentation layer (run on every BFS page):
//   • PushStateInterceptor  — installed on the BrowserContext so history.push/
//                             replaceState, hashchange, and popstate are all
//                             captured; drain() reads the buffer after load
//   • SPALinkExtractor      — reads [routerLink], [data-href], [data-to], etc.
//
//  Hash-routing support (Angular hash mode):
//   • extractLinks() preserves #/ and #!/ fragments instead of stripping them
//   • normalizeUrlSPA() keeps route-hashes distinct from anchor-hashes
//
// The public interface (IDiscoveryAgent) is unchanged — all SPA logic is
// internal to this class.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'crypto';
import type { BrowserContext, Page, Response } from 'playwright';
import type { IDiscoveryAgent, DiscoveryOptions } from '../../core/ports/agents/IDiscoveryAgent';
import type {
  DiscoveredPage,
  InteractiveElement,
  InteractiveElementType,
} from '../../core/domain/entities/DiscoveredPage';
import { SPAFrameworkDetector }  from './spa/SPAFrameworkDetector';
import { PushStateInterceptor }  from './spa/PushStateInterceptor';
import { NextJsRouteExtractor }  from './spa/NextJsRouteExtractor';
import { SPALinkExtractor }      from './spa/SPALinkExtractor';
import type { SPADetectionResult } from './spa/types';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<DiscoveryOptions> = {
  maxDepth:             3,
  maxPages:             50,
  includeExternalLinks: false,
  excludePatterns: [
    /\/logout/i, /\/signout/i, /\/sign-out/i,
    /\/delete/i, /\/destroy/i, /\/remove/i,
    /\.pdf$/i,   /\.csv$/i,   /\.xlsx?$/i,
    /\.(png|jpg|jpeg|gif|svg|ico|woff2?)$/i,
    /^mailto:/i, /^tel:/i,    /^javascript:/i,
  ],
  waitUntil:           'networkidle',
  navigationTimeoutMs: 20_000,
  seedUrls:            [],
};

/** Unknown detection used as a no-op default before the probe page runs. */
const UNKNOWN_DETECTION: SPADetectionResult = {
  framework: 'unknown', isHashBased: false, confidence: 'low',
};

// ─────────────────────────────────────────────────────────────────────────────
// DiscoveryAgent
// ─────────────────────────────────────────────────────────────────────────────

export class DiscoveryAgent implements IDiscoveryAgent {
  private readonly spaDetector    = new SPAFrameworkDetector();
  private readonly interceptor    = new PushStateInterceptor();
  private readonly nextJsExtractor = new NextJsRouteExtractor();
  private readonly spaLinks       = new SPALinkExtractor();

  async discover(
    startUrl:  string,
    context:   BrowserContext,
    options:   DiscoveryOptions = {},
  ): Promise<DiscoveredPage[]> {
    const opts: Required<DiscoveryOptions> = { ...DEFAULT_OPTIONS, ...options };
    const origin = new URL(startUrl).origin;

    // ── RF9-1: Install pushState interceptor on the context ─────────────────
    // Must happen before ANY page is opened so every page gets the script.
    await this.interceptor.installOnContext(context);

    // ── RF9-2: Probe first page to detect framework + seed Next.js routes ───
    let detection: SPADetectionResult = UNKNOWN_DETECTION;
    const queue: QueueEntry[] = [{ url: normalizeUrl(startUrl, false), depth: 0, parentId: undefined }];
    const visited = new Set<string>();

    // ── Seed URLs: pre-populate BFS queue with explicitly known routes ───────
    // Useful for SPAs where navigation links are JS-driven and not discoverable
    // via link extraction alone (e.g. React Router sidebar items).
    if (opts.seedUrls && opts.seedUrls.length > 0) {
      for (const raw of opts.seedUrls) {
        try {
          // Resolve relative paths against the origin
          const full = raw.startsWith('http')
            ? raw
            : new URL(raw, `${origin}/`).toString();
          const normalized = normalizeUrl(full, false);
          if (!visited.has(normalized) && !isExcluded(normalized, opts.excludePatterns)) {
            queue.push({ url: normalized, depth: 1, parentId: undefined });
          }
        } catch { /* skip malformed seeds */ }
      }
    }

    const probePage = await context.newPage();
    try {
      await probePage.goto(startUrl, {
        waitUntil: 'domcontentloaded',
        timeout:   opts.navigationTimeoutMs,
      }).catch(() => {});

      detection = await this.spaDetector.detect(probePage);

      // For Next.js, seed the queue with every static route from the manifest.
      if (detection.framework === 'next.js') {
        const manifestRoutes = await this.nextJsExtractor.extractRoutes(probePage, origin);
        for (const record of manifestRoutes) {
          if (record.isDynamic) continue; // can't navigate without a real param value
          try {
            const fullUrl = normalizeUrl(new URL(record.path, `${origin}/`).toString(), false);
            if (!visited.has(fullUrl) && !isExcluded(fullUrl, opts.excludePatterns)) {
              queue.push({ url: fullUrl, depth: 1, parentId: undefined });
            }
          } catch { /* skip bad path */ }
        }
      }
    } finally {
      await probePage.close().catch(() => {});
    }

    // ── BFS ─────────────────────────────────────────────────────────────────
    const pages: DiscoveredPage[] = [];

    while (queue.length > 0 && pages.length < opts.maxPages) {
      const entry = queue.shift()!;

      if (visited.has(entry.url))           continue;
      if (entry.depth > opts.maxDepth)      continue;
      if (isExcluded(entry.url, opts.excludePatterns)) continue;

      visited.add(entry.url);

      const discovered = await this.visitPage(entry, context, origin, opts, pages.length, detection);

      if (discovered) {
        pages.push(discovered);

        if (entry.depth < opts.maxDepth) {
          for (const link of discovered.outboundLinks) {
            if (!visited.has(link) && pages.length < opts.maxPages) {
              queue.push({ url: link, depth: entry.depth + 1, parentId: discovered.id });
            }
          }
        }
      }
    }

    return pages;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private — page visitor (augmented with SPA layer)
  // ──────────────────────────────────────────────────────────────────────────

  private async visitPage(
    entry:     QueueEntry,
    context:   BrowserContext,
    origin:    string,
    opts:      Required<DiscoveryOptions>,
    visitOrder: number,
    detection: SPADetectionResult,
  ): Promise<DiscoveredPage | null> {
    const page = await context.newPage();
    let response: Response | null = null;

    try {
      response = await page.goto(entry.url, {
        waitUntil: opts.waitUntil,
        timeout:   opts.navigationTimeoutMs,
      }).catch(() => null);

      // For SPAs that use lazy-loaded routes (React.lazy / dynamic import), the
      // <Suspense> fallback (spinner) may still be showing when `waitUntil:load`
      // fires because the lazy chunk is not part of the initial module graph.
      // Wait up to 8 s for at least one <a href> to appear; if it never does
      // (e.g. login page with no nav links) we proceed with whatever is there.
      await page.waitForSelector('a[href]', { timeout: 8_000 }).catch(() => {});

      const finalUrl    = normalizeUrl(page.url(), detection.isHashBased);
      const httpStatus  = response?.status() ?? 0;
      if (httpStatus >= 400 && httpStatus !== 0) return null;

      const title = await page.title().catch(() => '');

      // ── RF9-3: Collect links from all three sources ──────────────────────
      const traditionalLinks = await this.extractLinks(page, origin, opts, detection);
      const spaAttrLinks     = await this.spaLinks.extract(page, origin, opts.excludePatterns);
      const pushedRoutes     = await this.interceptor.drain(page);
      const resolvedPushed   = pushedRoutes
        .map(r => resolveRoute(r, entry.url, origin, detection.isHashBased))
        .filter((u): u is string => u !== null);

      const outboundLinks = deduplicateUrls([
        ...traditionalLinks,
        ...spaAttrLinks,
        ...resolvedPushed,
      ]).filter(u => !isExcluded(u, opts.excludePatterns));


      const interactiveElements = await this.extractInteractiveElements(page);
      const hasForm = await page.$('form').then(el => el !== null).catch(() => false);

      return {
        id:                  randomUUID(),
        url:                 finalUrl,
        title:               title || new URL(finalUrl).pathname,
        depth:               entry.depth,
        visitOrder,
        parentPageId:        entry.parentId,
        outboundLinks,
        interactiveElements,
        hasForm,
        httpStatus:          httpStatus || 200,
        redirectedFrom:      finalUrl !== entry.url ? entry.url : undefined,
      };
    } catch {
      return null;
    } finally {
      await page.close().catch(() => {});
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private — link extraction (hash-routing aware)
  // ──────────────────────────────────────────────────────────────────────────

  private async extractLinks(
    page:      Page,
    origin:    string,
    opts:      Required<DiscoveryOptions>,
    detection: SPADetectionResult,
  ): Promise<string[]> {
    const hrefs: string[] = await page.$$eval('a[href]', anchors =>
      anchors.map(a => (a as HTMLAnchorElement).href).filter(Boolean),
    ).catch(() => []);

    const seen  = new Set<string>();
    const links: string[] = [];

    for (const href of hrefs) {
      try {
        const url = new URL(href);

        if (!opts.includeExternalLinks && url.origin !== origin) continue;

        // RF9: For hash-based Angular apps preserve #/ and #!/ route hashes.
        // For all other apps and for anchor-only hashes, strip the fragment.
        const isRouteHash = url.hash.startsWith('#/') || url.hash.startsWith('#!/');
        if (!detection.isHashBased || !isRouteHash) {
          url.hash = '';
        }

        const normalized = normalizeUrl(url.toString(), detection.isHashBased);
        if (seen.has(normalized)) continue;
        if (isExcluded(normalized, opts.excludePatterns)) continue;

        seen.add(normalized);
        links.push(normalized);
      } catch { /* invalid URL — skip */ }
    }

    return links;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private — interactive element extraction (unchanged)
  // ──────────────────────────────────────────────────────────────────────────

  private async extractInteractiveElements(page: Page): Promise<InteractiveElement[]> {
    const raw: RawElement[] = await page.$$eval(
      'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="menuitem"], [role="tab"]',
      (els: Element[]) =>
        els.slice(0, 100).map(el => {
          const tag  = el.tagName.toLowerCase();
          const type = (el as HTMLInputElement).type?.toLowerCase() ?? '';
          const role = el.getAttribute('role') ?? '';
          const text = (el.textContent ?? '').trim().slice(0, 80);
          const href = (el as HTMLAnchorElement).href ?? '';
          const aria = el.getAttribute('aria-label') ?? '';

          let elementType: string;
          if (tag === 'a')                                elementType = 'link';
          else if (tag === 'button' || role === 'button') elementType = 'button';
          else if (tag === 'input' && type === 'submit')  elementType = 'button';
          else if (tag === 'input' || tag === 'textarea') elementType = 'input';
          else if (tag === 'select')                      elementType = 'select';
          else if (role === 'menuitem')                   elementType = 'menu-item';
          else if (role === 'tab')                        elementType = 'tab';
          else                                            elementType = 'button';

          return { elementType, text, href, aria };
        }),
    ).catch(() => []);

    return raw.map((r, i) => ({
      type:      r.elementType as InteractiveElementType,
      selector:  `[data-discovery-index="${i}"]`,
      text:      r.text   || undefined,
      href:      r.href   || undefined,
      ariaLabel: r.aria   || undefined,
    }));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level helpers
// ─────────────────────────────────────────────────────────────────────────────

interface QueueEntry {
  url:      string;
  depth:    number;
  parentId: string | undefined;
}

interface RawElement {
  elementType: string;
  text:  string;
  href:  string;
  aria:  string;
}

/**
 * Normalise a URL for use as a BFS queue key.
 *
 * @param keepRouteHash When true (Angular hash mode), preserve #/ and #!/
 *                      fragments because they encode the current route.
 *                      All other hashes (anchor links) are stripped regardless.
 */
function normalizeUrl(raw: string, keepRouteHash: boolean): string {
  try {
    const u = new URL(raw);
    const isRouteHash = u.hash.startsWith('#/') || u.hash.startsWith('#!/');
    if (!keepRouteHash || !isRouteHash) {
      u.hash = '';
    }
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return u.toString();
  } catch {
    return raw;
  }
}

/**
 * Resolve a raw route string (from pushState / replaceState) to an absolute
 * normalised URL within `origin`, or null if it doesn't belong to the origin
 * or can't be parsed.
 */
function resolveRoute(
  raw:         string,
  currentUrl:  string,
  origin:      string,
  keepHash:    boolean,
): string | null {
  if (!raw) return null;
  try {
    let absolute: string;
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      absolute = raw;
    } else if (raw.startsWith('//')) {
      // Protocol-relative
      absolute = new URL(currentUrl).protocol + raw;
    } else if (raw.startsWith('/') || raw.startsWith('#')) {
      absolute = `${origin}${raw}`;
    } else {
      // Relative to current page
      absolute = new URL(raw, currentUrl).toString();
    }

    const u = new URL(absolute);
    if (u.origin !== origin) return null;

    return normalizeUrl(absolute, keepHash);
  } catch {
    return null;
  }
}

function deduplicateUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out:  string[] = [];
  for (const u of urls) {
    if (!seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out;
}

function isExcluded(url: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(url));
}
