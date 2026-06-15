import type { BrowserContext } from 'playwright';
import type { DiscoveredPage } from '../../domain/entities/DiscoveredPage';

export interface DiscoveryOptions {
  /** Maximum link-follow depth from the start URL. Default: 3. */
  maxDepth?:    number;
  /** Hard cap on total pages discovered. Default: 50. */
  maxPages?:    number;
  /** Follow links to different origins. Default: false. */
  includeExternalLinks?: boolean;
  /** URL patterns to skip (e.g. /logout, /delete). */
  excludePatterns?: RegExp[];
  /** Playwright wait condition after each navigation. Default: 'networkidle'. */
  waitUntil?: 'domcontentloaded' | 'load' | 'networkidle';
  /** Navigation timeout per page in ms. Default: 20 000. */
  navigationTimeoutMs?: number;
  /**
   * Additional URLs to add to the BFS queue at depth 1 (after the start URL).
   * Use this to seed the crawler with known SPA routes that may not be
   * discoverable via link extraction (e.g. React Router paths that are only
   * reachable via JavaScript navigation).
   *
   * Relative paths (e.g. '/dashboard') are resolved against the origin of
   * startUrl. Absolute URLs from the same origin are used as-is.
   */
  seedUrls?: string[];
}

export interface IDiscoveryAgent {
  /**
   * BFS crawl starting from `startUrl` using the provided (authenticated)
   * BrowserContext.
   *
   * Always resolves — individual page failures are skipped and logged in the
   * returned array as entries with `httpStatus` ≠ 200.
   */
  discover(
    startUrl: string,
    context:  BrowserContext,
    options?: DiscoveryOptions,
  ): Promise<DiscoveredPage[]>;
}
