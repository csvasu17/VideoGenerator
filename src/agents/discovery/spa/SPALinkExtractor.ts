// ─────────────────────────────────────────────────────────────────────────────
// SPALinkExtractor  (RF9)
//
// Extracts navigation targets from SPA-framework-specific DOM attributes that
// the existing <a href> link extractor misses.
//
// Covered patterns:
//
//  Angular  — <a routerLink="/path">   → routerlink attr (lowercase in DOM)
//             <button routerLink="/x"> → routerlink on non-anchor
//  Vue      — <router-link to="/p">   → renders as <a href> (already caught)
//             data-to="/path"         → sometimes used on custom components
//  React    — <Link to="/p">          → renders as <a href> (already caught)
//  Generic  — data-href="/path"       → custom SPA navigation buttons
//             data-navlink="/path"    → another custom convention
//
// The extractor deliberately avoids clicking elements — it only reads
// attributes from the current DOM snapshot. Dynamic routes discovered by
// user interaction are captured separately by PushStateInterceptor.
// ─────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';

/** Raw shape evaluated inside the browser. */
interface RawSPALink {
  value: string;
  tag:   string;
}

// Browser-side extraction script — must be self-contained.
const EXTRACT_SCRIPT = /* js */ `(() => {
  var results = [];
  var seen    = new Set();

  function add(value, tag) {
    if (!value || typeof value !== 'string') return;
    value = value.trim();
    if (!value || value === '#' || value === '/') return;
    var key = value + '|' + tag;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ value: value, tag: tag });
  }

  // ── Angular routerLink (lowercase in DOM) ──────────────────────────────
  document.querySelectorAll('[routerlink]').forEach(function(el) {
    var v = el.getAttribute('routerlink') || '';
    // Skip Angular array syntax like "['/path', 'sub']"
    if (!v.startsWith('[')) add(v, 'routerlink');
  });

  // ── data-href — generic SPA button navigation ─────────────────────────
  document.querySelectorAll('[data-href]').forEach(function(el) {
    add(el.getAttribute('data-href') || '', 'data-href');
  });

  // ── data-to — sometimes used by Vue / custom components ──────────────
  document.querySelectorAll('[data-to]').forEach(function(el) {
    add(el.getAttribute('data-to') || '', 'data-to');
  });

  // ── data-navlink ───────────────────────────────────────────────────────
  document.querySelectorAll('[data-navlink]').forEach(function(el) {
    add(el.getAttribute('data-navlink') || '', 'data-navlink');
  });

  // ── <router-link> custom element (Vue, un-hydrated) ──────────────────
  document.querySelectorAll('router-link[to]').forEach(function(el) {
    add(el.getAttribute('to') || '', 'router-link');
  });

  return results;
})()`;

// ─────────────────────────────────────────────────────────────────────────────
// SPALinkExtractor
// ─────────────────────────────────────────────────────────────────────────────

export class SPALinkExtractor {
  /**
   * Scan the current DOM snapshot for SPA-specific navigation attributes and
   * return the resolved, deduplicated absolute URLs.
   *
   * @param page           The Playwright page to scan.
   * @param origin         Scheme + host, e.g. "https://app.example.com".
   * @param excludePatterns Patterns that should be filtered out (same set as
   *                        the main BFS loop uses).
   *
   * Never throws — returns [] on any failure.
   */
  async extract(
    page:            Page,
    origin:          string,
    excludePatterns: RegExp[] = [],
  ): Promise<string[]> {
    try {
      const raw: RawSPALink[] = await page.evaluate<RawSPALink[]>(
        EXTRACT_SCRIPT as string,
      );

      if (!Array.isArray(raw)) return [];

      const seen    = new Set<string>();
      const results: string[] = [];

      for (const { value } of raw) {
        const resolved = resolveToAbsolute(value, origin);
        if (!resolved) continue;

        // Must be same origin
        try {
          const u = new URL(resolved);
          if (u.origin !== origin) continue;
        } catch {
          continue;
        }

        if (seen.has(resolved)) continue;
        if (excludePatterns.some(p => p.test(resolved))) continue;

        seen.add(resolved);
        results.push(resolved);
      }

      return results;
    } catch {
      return [];
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve a raw attribute value to an absolute URL string, or null. */
function resolveToAbsolute(value: string, origin: string): string | null {
  if (!value) return null;
  // Skip degenerate values the browser-side script may not have filtered yet
  if (value === '/' || value === '#') return null;
  try {
    // Already absolute
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return normaliseHref(value);
    }
    // Root-relative
    if (value.startsWith('/')) {
      return normaliseHref(`${origin}${value}`);
    }
    // Hash-only or javascript: — skip
    if (value.startsWith('#') || value.startsWith('javascript:')) return null;
    // Relative — resolve against origin root
    return normaliseHref(new URL(value, `${origin}/`).toString());
  } catch {
    return null;
  }
}

function normaliseHref(raw: string): string | null {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return u.toString();
  } catch {
    return null;
  }
}
