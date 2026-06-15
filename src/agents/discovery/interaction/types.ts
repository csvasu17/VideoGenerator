// ─────────────────────────────────────────────────────────────────────────────
// Minimum Viable Interaction Discovery — domain types
//
// Zero imports. Zero runtime code. Pure TypeScript types and one const.
// Every other file in this module imports from here.
// ─────────────────────────────────────────────────────────────────────────────

// ── Primitive enumerations ────────────────────────────────────────────────────

/**
 * The class of UI interaction pattern detected on a target element.
 *
 * TAB_TRIGGER         — element that switches a visible content panel (ARIA tab semantics)
 * ACCORDION_HEADER    — element that expands / collapses a stacked panel
 * EXPAND_TOGGLE       — element that reveals a previously hidden region
 * VISUAL_TAB_CANDIDATE — visually-detected tab-like element with no ARIA markup
 */
export type InteractionClass =
  | 'TAB_TRIGGER'
  | 'ACCORDION_HEADER'
  | 'EXPAND_TOGGLE'
  | 'VISUAL_TAB_CANDIDATE';

/**
 * How the target was detected.
 *
 * aria       — explicit ARIA role / attribute semantics (highest confidence)
 * structural — HTML structural cues (<details>/<summary>, aria-controls + hidden panel)
 * visual     — computed-style outlier analysis (lowest confidence, validated at explore time)
 */
export type DetectionMethod = 'aria' | 'structural' | 'visual';

/**
 * Widget types detected inside a DOM snapshot.
 * Used in FunctionalFingerprint.widgetCounts.
 */
export type WidgetType = 'TABLE' | 'CHART' | 'FORM' | 'LIST' | 'UNKNOWN';

// ── Geometric primitive ───────────────────────────────────────────────────────

/** Mirrors Playwright's BoundingBox interface exactly. */
export interface Rect {
  x:      number;
  y:      number;
  width:  number;
  height: number;
}

// ── Visual detection types ────────────────────────────────────────────────────

/**
 * Computed-style snapshot for one element in a candidate visual group.
 * Plain JSON-serialisable — extracted inside page.evaluate(), passed to Node.js.
 * Also exported so analyzeStyleSignatures() can be unit-tested independently.
 */
export interface ElementStyleSignature {
  /** The stable CSS selector for this element. */
  selector:           string;
  backgroundColor:    string;
  borderBottomColor:  string;
  borderBottomWidth:  string;
  /** Foreground / text colour. */
  color:              string;
  fontWeight:         string;
  boxShadow:          string;
  opacity:            string;
}

/**
 * A group of visually similar siblings where one member appears visually
 * "selected" compared to the others.  Produced by VisualGroupDetector.
 */
export interface VisualCandidateGroup {
  /** SHA256 of common parent selector — stable group identity. */
  groupId:                  string;
  layout:                   'horizontal' | 'vertical';
  /** CSS selector for the element that looks active / selected. */
  activeMemberSelector:     string;
  /** CSS selectors for all non-active siblings (the ones to explore). */
  inactiveMemberSelectors:  string[];
  /** 0–1.  How confidently one member is visually distinct from the rest. */
  differentiationScore:     number;
  memberCount:              number;
}

// ── Core detection types ──────────────────────────────────────────────────────

/**
 * A detected interactive element that is a candidate for in-page exploration.
 * One InteractionTarget per clickable element — not per group.
 */
export interface InteractionTarget {
  /** SHA256(cssSelector) — stable identity across re-detections. */
  id:                         string;
  cssSelector:                string;
  ariaRole:                   string | null;
  ariaExpanded:               boolean | null;
  ariaControls:               string | null;
  /** null if the element is off-screen at detection time. */
  boundingRect:               Rect | null;
  interactionClass:           InteractionClass;
  detectionMethod:            DetectionMethod;
  /** Hash of the common parent element — groups siblings in the same tablist/accordion. */
  groupId:                    string | null;
  /**
   * The CSS selector of the currently-active sibling in this group.
   * Set for TAB_TRIGGER and VISUAL_TAB_CANDIDATE — used by the reset strategy
   * to navigate back to the pre-click state.
   * null for ACCORDION_HEADER and EXPAND_TOGGLE (those use toggle-reset instead).
   */
  groupActiveMemberSelector:  string | null;
  /** Derived from aria-label, text content, or positional hint — never domain-specific. */
  humanReadableHint:          string;
  /** 0–1 priority score.  Higher = explored first. */
  estimatedPriority:          number;
}

// ── State capture types ───────────────────────────────────────────────────────

/** One step in the interaction path that produced a state. */
export interface InteractionStep {
  targetSelector:    string;
  interactionClass:  InteractionClass;
  detectionMethod:   DetectionMethod;
  humanReadableHint: string;
  /**
   * Phase 9: pixel-coordinate bounding rect of the trigger element, captured
   * before the click while the browser session is still live.
   * Optional — absent in states discovered before Phase 9 (backward-compatible).
   * InteractionSequenceBuilder normalises this to 0–1 viewport coordinates.
   */
  elementBoundingRect?: Rect | null;
}

/**
 * A lean structural summary of the DOM at one point in time.
 * Extracted by StateCapture via page.evaluate() — deliberately small:
 * no raw HTML, no full DOM tree, only the signals needed for fingerprinting.
 */
export interface DomSummary {
  /** Visible headings h1–h6 in document order. Max 80 entries. */
  headings:           { level: number; text: string }[];
  /**
   * Visible text tokens from leaf elements.  Max 2000 entries.
   * Used by FingerprintBuilder after digit-stripping and deduplication.
   */
  visibleTextTokens:  string[];
  elementCounts: {
    tables:   number;
    canvases: number;
    /** Non-decorative SVGs only (aria-hidden excluded). */
    svgs:     number;
    forms:    number;
    lists:    number;
    buttons:  number;
    inputs:   number;
  };
  /** Counts of elements carrying each aria-role value. */
  ariaRoleCounts: Record<string, number>;
}

/**
 * A stable, semantic hash of a page state's functional content.
 * Designed to be insensitive to dynamic values (IDs, timestamps, live counts)
 * while remaining sensitive to structural changes (new widgets, new sections).
 */
export interface FunctionalFingerprint {
  /** SHA256 of sorted, digit-stripped, deduplicated visible text tokens. */
  stableTextHash:       string;
  /** SHA256 of heading tag hierarchy — sensitive to order, not to numeric values. */
  headingStructureHash: string;
  /** Count of each detected widget type. */
  widgetCounts:         Record<WidgetType, number>;
  /** Total count of interactive elements (buttons + inputs + tab-roles + button-roles). */
  interactiveCount:     number;
  /** SHA256 of all four fields above concatenated — primary identity key. */
  compositeHash:        string;
}

/**
 * One captured page state — the unit of analysis for the entire MVID module.
 * The base state has depth=0 and an empty interactionPath.
 */
export interface PageInteractionState {
  /** UUID v4. */
  id:               string;
  pageUrl:          string;
  /** Empty for the base state.  One entry per click that produced this state. */
  interactionPath:  InteractionStep[];
  /** 0 = base state, 1 = one click from base, etc. */
  depth:            number;
  /** Absolute path where the screenshot PNG was written. */
  screenshotPath:   string;
  /** SHA256(screenshotBuffer) — fast identity key for StateComparator. */
  screenshotHash:   string;
  domSummary:       DomSummary;
  fingerprint:      FunctionalFingerprint;
  /** Date.now() timestamp at capture. */
  capturedAt:       number;
}

// ── Comparison types ──────────────────────────────────────────────────────────

/**
 * The measured difference between two PageInteractionState objects.
 * Produced by StateComparator.compare().
 */
export interface StateDelta {
  screenshotIdentical:  boolean;
  fingerprintIdentical: boolean;
  addedWidgetTypes:     WidgetType[];
  newHeadingCount:      number;
  newInteractiveCount:  number;
  textTokenAddedCount:  number;
  /** Weighted composite of all delta signals.  Range 0–1. */
  functionalScore:      number;
  /** true when functionalScore >= the configured threshold. */
  isMeaningful:         boolean;
  /** Human-readable explanation — for debugging and diagnostics only. */
  reason:               string;
}

// ── Reset strategy ────────────────────────────────────────────────────────────

/**
 * Internal reset instructions built by InPageDiscovery.buildResetContext()
 * before each click.  Not exported from index.ts.
 */
export interface ResetContext {
  strategy:        'toggle' | 'restore-sibling' | 'reload';
  /** Selector to re-click when strategy === 'toggle'. */
  toggleSelector:  string | null;
  /** Selector to click when strategy === 'restore-sibling'. */
  siblingSelector: string | null;
  /** URL at the moment before the click — used to detect navigation. */
  urlBeforeClick:  string;
}

// ── Exploration options and result ────────────────────────────────────────────

export interface ExplorationOptions {
  /** Hard cap on discovered states.  Default: 10. */
  maxStates?:            number;
  /** Maximum interaction nesting depth.  Default: 2. */
  maxDepth?:             number;
  /** Total click attempts regardless of result.  Default: 30. */
  maxAttempts?:          number;
  /** Wall-clock budget in milliseconds.  Default: 30 000. */
  maxTimeMs?:            number;
  /** Minimum functionalScore for isMeaningful.  Default: 0.20. */
  meaningfulThreshold?:  number;
  /** Run Pass 3 visual detection.  Default: true. */
  visualDetection?:      boolean;
  /** Maximum visual candidate groups scanned per page.  Default: 5. */
  maxVisualGroups?:      number;
  /** Required — absolute directory path where screenshots are written. */
  screenshotOutputDir:   string;
}

export const DEFAULT_EXPLORATION_OPTIONS = {
  maxStates:           10,
  maxDepth:            2,
  maxAttempts:         30,
  maxTimeMs:           30_000,
  meaningfulThreshold: 0.20,
  visualDetection:     true,
  maxVisualGroups:     5,
} as const;

export interface ExplorationResult {
  baseState:        PageInteractionState;
  discoveredStates: PageInteractionState[];
  totalAttempts:    number;
  totalMeaningful:  number;
  budgetStatus:     'completed' | 'time-exhausted' | 'state-exhausted' | 'attempt-exhausted';
}
