// ─────────────────────────────────────────────────────────────────────────────
// SPAFrameworkDetector
//
// Runs a compact detection script inside the live browser page to identify
// which client-side routing framework is active. Checks multiple independent
// signals per framework so that the confidence level is meaningful.
//
// Detection priority:
//   Next.js (highest specificity) → Angular → Vue Router → React Router →
//   unknown
// ─────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';
import type { SPADetectionResult, SPAFramework } from './types';

// ── Browser-side detection script ────────────────────────────────────────────
// Must be self-contained — no closures over Node.js variables.
// Returns a JSON-serialisable SPADetectionResult.

const DETECTION_SCRIPT = /* js */ `(() => {
  const w   = window;
  const doc = document;

  // ── Next.js ────────────────────────────────────────────────────────────────
  // Primary signal: __NEXT_DATA__ injected by the server into every page.
  if (w.__NEXT_DATA__ && typeof w.__NEXT_DATA__ === 'object') {
    const ver = w.__NEXT_DATA__.version || undefined;
    return { framework: 'next.js', isHashBased: false, confidence: 'high', routerVersion: ver };
  }
  // Secondary: <script id="__NEXT_DATA__"> present but not yet parsed
  if (doc.getElementById('__NEXT_DATA__')) {
    return { framework: 'next.js', isHashBased: false, confidence: 'high' };
  }
  // Tertiary: any script src contains /_next/
  if (doc.querySelector('script[src*="/_next/"]')) {
    return { framework: 'next.js', isHashBased: false, confidence: 'medium' };
  }

  // ── Angular ───────────────────────────────────────────────────────────────
  // Angular exposes ng.getVersion() and getAllAngularRootElements() globally.
  const ngVersion = doc.querySelector('[ng-version]');
  const hasNg = ngVersion || (typeof w.getAllAngularRootElements === 'function') ||
                (w.ng && typeof w.ng.getVersion === 'function');
  if (hasNg) {
    const ver = ngVersion ? ngVersion.getAttribute('ng-version') || undefined : undefined;
    // Hash mode: URL has a hash that starts with # followed by /
    const isHash = w.location.hash.length > 1 && (
      w.location.hash.startsWith('#/') || w.location.hash.startsWith('#!/')
    );
    return { framework: 'angular-router', isHashBased: isHash, confidence: 'high', routerVersion: ver };
  }
  // Fallback: any element with [ng-version]
  if (doc.querySelector('[ng-version]')) {
    return { framework: 'angular-router', isHashBased: false, confidence: 'medium' };
  }

  // ── Vue Router ────────────────────────────────────────────────────────────
  // Vue 3 router attaches __vue_router__ to the app instance; also check __VUE__
  if (w.__vue_router__ || (w.__VUE__ && doc.querySelector('[data-v-app]'))) {
    const ver = w.__VUE__ && typeof w.__VUE__ === 'object' ? w.__VUE__.version || undefined : undefined;
    return { framework: 'vue-router', isHashBased: false, confidence: 'high', routerVersion: ver };
  }
  // Vue 2 / nuxt
  if (w.Vue || w.__VUE__) {
    return { framework: 'vue-router', isHashBased: false, confidence: 'medium' };
  }

  // ── React Router ─────────────────────────────────────────────────────────
  // React Router v6 sets __reactRouterContext; Remix sets __remixRouterContext
  if (w.__reactRouterContext || w.__reactRouterVersion || w.__remixRouterContext) {
    const ver = typeof w.__reactRouterVersion === 'string' ? w.__reactRouterVersion : undefined;
    return { framework: 'react-router', isHashBased: false, confidence: 'high', routerVersion: ver };
  }
  // React-based heuristic: data-reactroot or react DevTools hook
  if (doc.querySelector('[data-reactroot]') || w.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    return { framework: 'react-router', isHashBased: false, confidence: 'medium' };
  }

  return { framework: 'unknown', isHashBased: false, confidence: 'low' };
})()`;

// ─────────────────────────────────────────────────────────────────────────────
// SPAFrameworkDetector
// ─────────────────────────────────────────────────────────────────────────────

/** Raw shape returned by the browser-side script. */
interface RawDetection {
  framework:      string;
  isHashBased:    boolean;
  confidence:     string;
  routerVersion?: string;
}

const VALID_FRAMEWORKS = new Set<SPAFramework>([
  'next.js', 'react-router', 'vue-router', 'angular-router', 'unknown',
]);

export class SPAFrameworkDetector {
  /**
   * Identify the SPA routing framework used by the page currently loaded in
   * `page`. Call after the page has finished loading (at least
   * `domcontentloaded`) so that framework globals are available.
   *
   * Never throws — returns `{ framework: 'unknown', confidence: 'low' }` on
   * any error.
   */
  async detect(page: Page): Promise<SPADetectionResult> {
    try {
      const raw = await page.evaluate<RawDetection>(DETECTION_SCRIPT as string);

      const framework = VALID_FRAMEWORKS.has(raw.framework as SPAFramework)
        ? (raw.framework as SPAFramework)
        : 'unknown';

      const confidence =
        raw.confidence === 'high'   ? 'high'   :
        raw.confidence === 'medium' ? 'medium' : 'low';

      return {
        framework,
        isHashBased:    Boolean(raw.isHashBased),
        confidence,
        routerVersion:  raw.routerVersion,
      };
    } catch {
      return { framework: 'unknown', isHashBased: false, confidence: 'low' };
    }
  }
}
