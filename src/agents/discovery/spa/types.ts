// ─────────────────────────────────────────────────────────────────────────────
// SPA Router Support — shared types  (RF9)
// ─────────────────────────────────────────────────────────────────────────────

/** Client-side routing framework identified on the target application. */
export type SPAFramework =
  | 'next.js'
  | 'react-router'
  | 'vue-router'
  | 'angular-router'
  | 'unknown';

/**
 * Result of framework detection.
 *
 * `confidence` reflects how many independent signals were found:
 *   - high   — definitive runtime object / version attr / manifest found
 *   - medium — at least one secondary signal (script src, DOM attr)
 *   - low    — heuristic guess only
 */
export interface SPADetectionResult {
  framework: SPAFramework;
  /**
   * True when Angular is running in Hash-location strategy mode
   * (URLs look like https://app.com/#/dashboard).
   * Standard pushState mode is false.
   */
  isHashBased: boolean;
  /** Version string when detectable from window globals or meta tags. */
  routerVersion?: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * A single route record discovered through SPA-specific mechanisms
 * (manifests, pushState interception, router attributes).
 */
export interface SPARouteRecord {
  /**
   * Absolute URL or root-relative path, e.g.:
   *   "https://app.com/dashboard"  or  "/dashboard"
   * Never includes a trailing slash unless it is the root "/".
   */
  path: string;
  /**
   * True when the path contains :param, [param], or {param} tokens and
   * therefore cannot be navigated to directly without substituting a value.
   */
  isDynamic: boolean;
  /** Where this record came from. */
  source: 'manifest' | 'pushstate' | 'replacestate' | 'link-element' | 'hashchange';
}
