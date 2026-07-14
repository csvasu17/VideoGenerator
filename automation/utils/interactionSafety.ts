/**
 * interactionSafety.ts — destructive-action classifier for exhaustive Agent Recording.
 *
 * Pure decision logic, no DOM/Playwright access (matches this codebase's convention
 * of keeping classification/geometry pure and I/O-free, e.g. CameraChoreographer).
 *
 * Why this file exists: no destructive-action detection exists anywhere else in this
 * codebase — every recording script relies entirely on a human hand-picking safe
 * selectors/text (APP_ROUTE_MAP, DEMO_PAIN_POINTS, WorkflowClip). Exhaustively clicking
 * "every button" on a live app without this classifier would repeat this project's own
 * documented incidents (a consent modal blocking captures, a `has-text()` substring
 * match on "Acknowledge" that actually hit a filter tab labeled "ACKNOWLEDGED", a click
 * that mutated real persistent server-side state) at a much larger scale.
 *
 * Word-boundary matching only, NEVER substring/has-text() page-wide search — this is
 * the structural fix for the Acknowledge/ACKNOWLEDGED trap: `\backnowledge\b` does not
 * match "acknowledged" (no boundary between the 'e' and the 'd').
 */

export type SafetyCategory = 'safe-reveal' | 'safe-fill' | 'safe-navigate' | 'risky-skip';

export interface ElementSafetySignal {
  tag:             string;   // 'a' | 'button' | 'input' | 'select' | 'textarea' | 'div' | ...
  role?:           string;   // ARIA role, e.g. 'button' | 'tab' | 'menuitem'
  text?:           string;   // trimmed visible text of THIS element only (never page-wide)
  ariaLabel?:      string;
  title?:          string;
  inputType?:      string;   // input[type], or the effective type for <button> (default 'submit')
  href?:           string;
  sameOrigin?:     boolean;  // only meaningful when tag === 'a'
  insideForm:      boolean;
  formFieldCount:  number;   // fillable-field count of the enclosing <form> (0 if none/not applicable)
}

export interface SafetyClassification {
  category:       SafetyCategory;
  reason:         string;          // human-readable — goes straight into the skip report
  matchedPattern?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Denylist / allowlist vocabularies
// ─────────────────────────────────────────────────────────────────────────────

/** Single-word or short destructive/irreversible phrases — word-boundary matched. */
const DESTRUCTIVE_PATTERNS = [
  // Destructive / irreversible data operations
  'delete', 'remove', 'archive', 'deactivate', 'disable', 'revoke', 'purge', 'destroy',
  'terminate', 'unsubscribe', 'discard', 'clear all', 'reset all', 'delete all',
  // Session-ending
  'logout', 'log out', 'sign out', 'log off',
  // Financial / commit
  'pay', 'purchase', 'checkout', 'charge', 'refund', 'buy now', 'place order',
  // Finalizing verbs
  'submit', 'send', 'confirm', 'approve', 'reject', 'deny', 'publish', 'authorize', 'finalize',
  // Irreversibility phrasing
  'permanently', 'irreversible', 'cannot be undone',
  // Multi-word "cancel X" — bare "cancel" is intentionally NOT denylisted (see below)
  'cancel subscription', 'cancel order', 'cancel booking',
];

/**
 * Deliberately NOT denylisted on their own: cancel, close, dismiss, back.
 * These are near-universal modal-dismissal actions the agent needs in order to get
 * unstuck after a safe-reveal click opens something — over-blocking them would strand
 * the agent behind its own opened dialogs. Only specific destructive "cancel X"
 * phrasings above are denylisted as exact multi-word phrases.
 */

/** Button-like elements NOT inside a real <form> — safe common SPA action verbs. */
const SAFE_ACTION_ALLOWLIST = [
  'apply', 'filter', 'search', 'sort', 'view', 'refresh',
  'load more', 'show more', 'expand', 'next', 'previous', 'page',
];

/** Mirrors DiscoveryAgent's own excludePatterns — kept as a deliberate separate
 *  constant (not imported) since DiscoveryAgent's regexes are private to its module;
 *  duplicated here on purpose so the two lists can be tuned independently if needed. */
const RISKY_HREF_PATTERNS: RegExp[] = [
  /\/logout/i, /\/signout/i, /\/sign-out/i,
  /\/delete/i, /\/destroy/i, /\/remove/i,
  /^mailto:/i, /^tel:/i, /^javascript:/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// Matching helpers
// ─────────────────────────────────────────────────────────────────────────────

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Word-boundary match — never a naive substring/has-text() check. */
function matchesAny(text: string, patterns: string[]): string | undefined {
  const lower = text.toLowerCase();
  for (const pattern of patterns) {
    const re = new RegExp(`\\b${escapeRegExp(pattern.toLowerCase())}\\b`);
    if (re.test(lower)) return pattern;
  }
  return undefined;
}

function extraPatterns(envValue: string | undefined): string[] {
  if (!envValue) return [];
  try {
    const parsed = JSON.parse(envValue);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// classifyElement
// ─────────────────────────────────────────────────────────────────────────────

export function classifyElement(
  signal: ElementSafetySignal,
  opts?: { denylistExtra?: string[]; allowlistExtra?: string[] },
): SafetyClassification {
  const denylist  = [...DESTRUCTIVE_PATTERNS, ...(opts?.denylistExtra ?? [])];
  const allowlist = [...SAFE_ACTION_ALLOWLIST, ...(opts?.allowlistExtra ?? [])];

  const combinedText = [signal.text, signal.ariaLabel, signal.title].filter(Boolean).join(' ');

  // 1. Denylist hit on the element's OWN text/aria-label/title.
  const denyHit = matchesAny(combinedText, denylist);
  if (denyHit) {
    return { category: 'risky-skip', reason: `matched destructive-action pattern "${denyHit}"`, matchedPattern: denyHit };
  }

  const isButtonLike =
    signal.tag === 'button' ||
    signal.role === 'button' ||
    (signal.tag === 'input' && (signal.inputType === 'submit' || signal.inputType === 'button'));

  // 2. Hard default: a form-submit button inside a real <form> with fillable fields
  //    is ALWAYS risky-skip, regardless of wording — backend-mutation risk concentrates
  //    at submission, and text alone can't reliably distinguish "safe filter apply" from
  //    "real mutation." <button> with no explicit type defaults to type=submit per HTML spec.
  const isFormSubmit =
    signal.insideForm && signal.formFieldCount > 0 &&
    ((signal.tag === 'input' && signal.inputType === 'submit') ||
     (signal.tag === 'button' && (signal.inputType === 'submit' || signal.inputType === undefined)));
  if (isFormSubmit) {
    return { category: 'risky-skip', reason: 'form submit button — default skip (backend mutation risk concentrates at submission)' };
  }

  // 3. Button-like elements NOT inside a form: allow only recognized safe action verbs.
  if (isButtonLike && !signal.insideForm) {
    const allowHit = matchesAny(combinedText, allowlist);
    if (allowHit) {
      return { category: 'safe-reveal', reason: `matched safe-action allowlist "${allowHit}"`, matchedPattern: allowHit };
    }
    if (!combinedText.trim()) {
      // Icon-only button with no text/aria-label/title at all — cannot be classified
      // safely from signal alone; conservative default is to skip.
      return { category: 'risky-skip', reason: 'icon-only button with no resolvable label' };
    }
    return { category: 'risky-skip', reason: 'ambiguous action — no allowlist match' };
  }

  // 4. Fillable form fields.
  if (signal.tag === 'input' || signal.tag === 'select' || signal.tag === 'textarea') {
    return { category: 'safe-fill', reason: 'fillable form field' };
  }

  // 5. Links.
  if (signal.tag === 'a' && signal.href) {
    if (RISKY_HREF_PATTERNS.some(re => re.test(signal.href!))) {
      return { category: 'risky-skip', reason: 'href matches a risky pattern (logout/delete/mailto/tel/javascript)' };
    }
    if (signal.sameOrigin === false) {
      return { category: 'risky-skip', reason: 'cross-origin link' };
    }
    return { category: 'safe-navigate', reason: 'same-origin link' };
  }

  // 6. Reveal widgets (tabs/accordions) — typically pre-tagged by the MVID merge in
  //    interactionEnumerator.ts, but classified here too in case one reaches this path directly.
  if (signal.role === 'tab' || signal.role === 'menuitem') {
    return { category: 'safe-reveal', reason: `reveal widget (role="${signal.role}")` };
  }

  // 7. Any other clickable element with no denylist hit.
  if (isButtonLike) {
    return { category: 'safe-reveal', reason: 'button-like element, no destructive pattern matched' };
  }

  return { category: 'risky-skip', reason: 'unrecognized element kind — conservative default' };
}

/** Reads AGENT_SAFETY_DENYLIST_EXTRA / AGENT_SAFETY_ALLOWLIST_EXTRA (JSON string arrays). */
export function loadSafetyOverridesFromEnv(): { denylistExtra: string[]; allowlistExtra: string[] } {
  return {
    denylistExtra:  extraPatterns(process.env['AGENT_SAFETY_DENYLIST_EXTRA']),
    allowlistExtra: extraPatterns(process.env['AGENT_SAFETY_ALLOWLIST_EXTRA']),
  };
}
