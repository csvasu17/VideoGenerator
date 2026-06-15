// ─────────────────────────────────────────────────────────────────────────────
// AuthScreenDetector
//
// Detects login, sign-in, MFA, OAuth, and other authentication screens.
// Pure function — no I/O, no LLM, no state.
//
// Evidence hierarchy (highest confidence first):
//   1. URL path segment matches auth pattern list         (confidence 0.95)
//   2. URL path contains 'early-access' / 'register'     (confidence 0.85)
//   3. Page title matches auth title pattern              (confidence 0.85)
//   4. Graph nodeType === 'entry' + form-heavy composition (confidence 0.80)
//   5. Form composition only (email+password, ≤3 features) (confidence 0.75)
// ─────────────────────────────────────────────────────────────────────────────

import type { ReadinessSignal, ScoringContext } from '../../core/domain/entities/ReadinessResult';

// ── Pattern lists ─────────────────────────────────────────────────────────────

/** URL path segments that conclusively identify an auth route. */
const AUTH_URL_SEGMENTS = new Set([
  'login', 'signin', 'sign-in', 'logout', 'sign-out',
  'auth', 'authenticate', 'authentication',
  'forgot-password', 'forgot', 'reset-password', 'reset',
  'verify', 'verify-email', 'confirm', 'activate',
  'otp', 'mfa', '2fa', 'two-factor',
  'sso', 'oauth', 'callback', 'saml',
]);

/** URL path segments / query keys that suggest auth-related but less conclusive. */
const AUTH_URL_SOFT = new Set([
  'early-access', 'early_access', 'register', 'signup', 'sign-up',
  'onboard', 'create-account', 'new-account',
]);

/** Page title regexes — any match fires the title signal. */
const AUTH_TITLE_PATTERNS: RegExp[] = [
  /\blogin\b/i,
  /\bsign[\s-]?in\b/i,
  /\bsign[\s-]?up\b/i,
  /\blog[\s-]?in\b/i,
  /\bauthentication\b/i,
  /\bforgot[\s-]?password\b/i,
  /\breset[\s-]?password\b/i,
  /\btwo[\s-]?factor\b/i,
  /\bverify[\s-]?email\b/i,
  /\bearly[\s-]?access\b/i,
  /\bcreate[\s-]?account\b/i,
  /\bregister\b/i,
];

/** Feature name patterns that indicate an auth form. */
const AUTH_FEATURE_PATTERNS: RegExp[] = [
  /\bpassword\b/i,
  /\bforgot[\s-]?password\b/i,
  /\bsign[\s-]?in\b/i,
  /\bremember[\s-]?me\b/i,
  /\bsso\b/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractPathSegments(url: string): string[] {
  try {
    const { pathname, searchParams } = new URL(url);
    const segments = pathname.split('/').map(s => s.toLowerCase()).filter(Boolean);
    // Also check the first query-param key in case of ?page=login patterns
    const firstKey = [...searchParams.keys()][0];
    if (firstKey) segments.push(firstKey.toLowerCase());
    return segments;
  } catch {
    // Relative URL or malformed — split on '/' anyway
    return url.split(/[/?]/).map(s => s.toLowerCase()).filter(Boolean);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AuthScreenDetector
// ─────────────────────────────────────────────────────────────────────────────

export const AuthScreenDetector = {
  /**
   * Analyse a ScoringContext and return any auth-screen signals found.
   * Returns an empty array if no auth evidence is present.
   */
  detect(ctx: ScoringContext): ReadinessSignal[] {
    const signals: ReadinessSignal[] = [];

    // ── 1. URL path segments ─────────────────────────────────────────────────
    const segments = extractPathSegments(ctx.url);
    const hardMatch = segments.find(s => AUTH_URL_SEGMENTS.has(s));
    if (hardMatch) {
      signals.push({
        type:       'auth_screen',
        weight:     -0.90,
        confidence: 0.95,
        evidence:   `URL segment '/${hardMatch}' matches auth pattern`,
        source:     'url',
      });
    }

    // Soft URL match (early-access, register, etc.)
    if (!hardMatch) {
      const softMatch = segments.find(s => AUTH_URL_SOFT.has(s));
      if (softMatch) {
        signals.push({
          type:       'auth_screen',
          weight:     -0.70,
          confidence: 0.80,
          evidence:   `URL segment '/${softMatch}' suggests registration/access gate`,
          source:     'url',
        });
      }
    }

    // ── 2. Page title ────────────────────────────────────────────────────────
    const titleMatch = AUTH_TITLE_PATTERNS.find(re => re.test(ctx.title));
    if (titleMatch) {
      signals.push({
        type:       'auth_screen',
        weight:     -0.85,
        confidence: 0.85,
        evidence:   `Title "${ctx.title}" matches auth title pattern`,
        source:     'title',
      });
    }

    // ── 3. Graph nodeType === 'entry' + form composition ─────────────────────
    // 'entry' is how the graph builder classifies start/landing pages.
    // A form-heavy entry page with multiple inputs is very likely a login form.
    if (ctx.nodeType === 'entry' && ctx.formCount >= 1 && ctx.inputCount >= 2) {
      signals.push({
        type:       'auth_screen',
        weight:     -0.80,
        confidence: 0.80,
        evidence:   `nodeType='entry' with ${ctx.formCount} form(s) and ${ctx.inputCount} input(s) — likely login gate`,
        source:     'graph',
      });
    }

    // ── 4. Form composition only ─────────────────────────────────────────────
    // Standalone heuristic when no URL/title signals fired:
    // If the page has very few features (≤3), at least one form, and 2+ inputs,
    // AND one feature name matches an auth keyword — confident login form.
    if (signals.length === 0 && ctx.formCount >= 1 && ctx.inputCount >= 2) {
      const authFeature = ctx.features.find(f =>
        AUTH_FEATURE_PATTERNS.some(re => re.test(f.featureName)),
      );
      if (authFeature || ctx.features.length <= 2) {
        signals.push({
          type:       'auth_screen',
          weight:     -0.70,
          confidence: 0.75,
          evidence:   `Form composition: ${ctx.formCount} form, ${ctx.inputCount} inputs${authFeature ? `, feature '${authFeature.featureName}'` : ', minimal page content'}`,
          source:     'dom',
        });
      }
    }

    return signals;
  },
};
