// ─────────────────────────────────────────────────────────────────────────────
// NextJsRouteExtractor  (RF9)
//
// Fetches the Next.js build manifest to obtain the full list of statically
// known routes without crawling.
//
// Next.js injects `window.__NEXT_DATA__.buildId` into every server-rendered
// page. The build manifest at:
//
//   /_next/static/{buildId}/_buildManifest.js
//
// contains a `sortedPages` array listing every page path in the build, e.g.:
//
//   self.__BUILD_MANIFEST={"sortedPages":["/_app","/_error","/","/dashboard",
//                           "/reports/[id]"]};
//
// Strategy:
//   1. Read buildId from window.__NEXT_DATA__.
//   2. Fetch _buildManifest.js from the same origin (same-origin fetch allowed).
//   3. Extract sortedPages with a bracket-matching parser (no eval).
//   4. Filter out internal pages (_app, _error, _document, _not-found).
//   5. Mark parameterised paths ([id], :id, {id}) as dynamic — skip them
//      (they are unreachable without substituting a real value, but will be
//      discovered naturally via link-following if any page links to them).
// ─────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';
import type { SPARouteRecord } from './types';

// Pages that are Next.js internals, not real application routes.
const INTERNAL_PAGES = new Set([
  '/_app', '/_document', '/_error', '/_not-found',
  '/404', '/500',
]);

// Script to read buildId from the page context.
const GET_BUILD_ID_SCRIPT = /* js */ `(() => {
  try { return (window.__NEXT_DATA__ && window.__NEXT_DATA__.buildId) || null; } catch { return null; }
})()`;

// Script to fetch the build manifest text using the page's own fetch API
// (avoids CORS — same origin as the app).
const FETCH_MANIFEST_SCRIPT = /* js */ `(async function(buildId, origin) {
  try {
    var url = origin + '/_next/static/' + buildId + '/_buildManifest.js';
    var resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) return null;
    return resp.text();
  } catch { return null; }
})`;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the `sortedPages` array from the _buildManifest.js source text
 * using bracket-depth tracking — no eval required.
 */
export function parseSortedPages(js: string): string[] {
  const MARKER = '"sortedPages":';
  const markerIdx = js.indexOf(MARKER);
  if (markerIdx === -1) return [];

  const arrayStart = js.indexOf('[', markerIdx + MARKER.length);
  if (arrayStart === -1) return [];

  let depth = 0;
  let i = arrayStart;
  while (i < js.length) {
    if (js[i] === '[')      depth++;
    else if (js[i] === ']') { depth--; if (depth === 0) break; }
    i++;
  }

  const arrayStr = js.slice(arrayStart, i + 1);
  try {
    const parsed = JSON.parse(arrayStr);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

/** True if the path contains Next.js / Express / React Router param tokens. */
export function isDynamicPath(path: string): boolean {
  return /\[.+?\]|:\w+|\{.+?\}/.test(path);
}

// ─────────────────────────────────────────────────────────────────────────────
// NextJsRouteExtractor
// ─────────────────────────────────────────────────────────────────────────────

export class NextJsRouteExtractor {
  /**
   * Return all static routes exposed by the Next.js build manifest.
   *
   * @param page   A Playwright page that has already loaded the Next.js app.
   * @param origin The scheme+host of the app, e.g. "https://app.example.com".
   *
   * Dynamic routes (`/products/[id]`) are included in the return value with
   * `isDynamic: true` so callers can skip or handle them separately.
   *
   * Returns [] (never throws) when the app is not Next.js, the manifest is
   * unavailable, or any fetch/parse step fails.
   */
  async extractRoutes(page: Page, origin: string): Promise<SPARouteRecord[]> {
    try {
      // Step 1 — get buildId
      const buildId = await page.evaluate<string | null>(GET_BUILD_ID_SCRIPT as string);
      if (!buildId) return [];

      // Step 2 — fetch manifest text via page's fetch API (same origin)
      const manifestText = await page.evaluate<string | null>(
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        new Function(`return (${FETCH_MANIFEST_SCRIPT})(${JSON.stringify(buildId)}, ${JSON.stringify(origin)})`) as () => Promise<string | null>,
      );
      if (!manifestText) return [];

      // Step 3 — parse
      const paths = parseSortedPages(manifestText);

      // Step 4 — filter and classify
      const records: SPARouteRecord[] = [];
      for (const path of paths) {
        if (INTERNAL_PAGES.has(path)) continue;
        records.push({
          path,
          isDynamic: isDynamicPath(path),
          source:    'manifest',
        });
      }

      return records;
    } catch {
      return [];
    }
  }
}
