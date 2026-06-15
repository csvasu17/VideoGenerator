// ─────────────────────────────────────────────────────────────────────────────
// StateComparator — pure delta computation
//
// Given two PageInteractionState objects, produces a StateDelta that answers:
// "Did this interaction reveal meaningfully different functionality?"
//
// No Playwright.  No I/O.  Fully unit-testable without a browser.
//
// Three-step algorithm:
//   Step 1 — Identity check  (O(1) string compare — fast-reject)
//   Step 2 — Structural delta (widget types, headings, interactive count)
//   Step 3 — Text token delta (new unique text tokens)
//   Step 4 — Composite score + meaningful threshold
// ─────────────────────────────────────────────────────────────────────────────

import type { PageInteractionState, StateDelta, WidgetType } from './types';

// ── Scoring weights ───────────────────────────────────────────────────────────

const WIDGET_WEIGHT      = 0.40;
const HEADING_WEIGHT     = 0.25;
const INTERACTIVE_WEIGHT = 0.20;
const TEXT_WEIGHT        = 0.15;

/** functionalScore >= DEFAULT_THRESHOLD → isMeaningful */
const DEFAULT_THRESHOLD  = 0.20;

const ALL_WIDGET_TYPES: WidgetType[] = ['TABLE', 'CHART', 'FORM', 'LIST', 'UNKNOWN'];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compare two captured page states and return a StateDelta.
 *
 * @param base       The reference state (typically the base / uninteracted state).
 * @param candidate  The state after an interaction.
 * @param threshold  Minimum functionalScore for isMeaningful.  Default: 0.20.
 */
export function compare(
  base:       PageInteractionState,
  candidate:  PageInteractionState,
  threshold = DEFAULT_THRESHOLD,
): StateDelta {

  // ── Step 1: Fast identity checks ────────────────────────────────────────────

  if (base.screenshotHash === candidate.screenshotHash) {
    return buildDelta({
      screenshotIdentical:  true,
      fingerprintIdentical: true,
      addedWidgetTypes:     [],
      newHeadingCount:      0,
      newInteractiveCount:  0,
      textTokenAddedCount:  0,
      functionalScore:      0,
      isMeaningful:         false,
      reason:               'Screenshot hash identical — page did not change.',
    });
  }

  if (base.fingerprint.compositeHash === candidate.fingerprint.compositeHash) {
    return buildDelta({
      screenshotIdentical:  false,
      fingerprintIdentical: true,
      addedWidgetTypes:     [],
      newHeadingCount:      0,
      newInteractiveCount:  0,
      textTokenAddedCount:  0,
      functionalScore:      0,
      isMeaningful:         false,
      reason:               'Functional fingerprint identical — only cosmetic change detected.',
    });
  }

  // ── Step 2: Widget delta ─────────────────────────────────────────────────────

  const addedWidgetTypes: WidgetType[] = ALL_WIDGET_TYPES.filter(
    w => (candidate.fingerprint.widgetCounts[w] ?? 0) > (base.fingerprint.widgetCounts[w] ?? 0),
  );
  const widgetScore = Math.min(1.0, addedWidgetTypes.length / 2);
  // 1 new widget type → 0.50  (one table or chart appeared)
  // 2+ new widget types → 1.0

  // ── Step 3a: Heading delta ───────────────────────────────────────────────────

  const newHeadingCount = Math.max(
    0,
    candidate.domSummary.headings.length - base.domSummary.headings.length,
  );
  const headingScore = Math.min(1.0, newHeadingCount / 3);
  // 3 new headings → 1.0

  // ── Step 3b: Interactive element delta ───────────────────────────────────────

  const newInteractiveCount = Math.max(
    0,
    candidate.fingerprint.interactiveCount - base.fingerprint.interactiveCount,
  );
  const interactiveScore = Math.min(1.0, newInteractiveCount / 5);
  // 5 new interactive elements → 1.0

  // ── Step 3c: Text token delta ─────────────────────────────────────────────────

  const baseTokenSet      = new Set(base.domSummary.visibleTextTokens);
  const candidateTokenSet = new Set(candidate.domSummary.visibleTextTokens);
  const textTokenAddedCount = [...candidateTokenSet].filter(t => !baseTokenSet.has(t)).length;
  const textScore = Math.min(1.0, textTokenAddedCount / 50);
  // 50 new unique tokens → 1.0
  // Note: text alone can contribute at most 0.15 to functionalScore (below 0.20 threshold)

  // ── Step 4: Composite score + meaningful ─────────────────────────────────────

  const functionalScore =
    WIDGET_WEIGHT      * widgetScore      +
    HEADING_WEIGHT     * headingScore     +
    INTERACTIVE_WEIGHT * interactiveScore +
    TEXT_WEIGHT        * textScore;

  const isMeaningful = functionalScore >= threshold;

  const reason = buildReason(
    addedWidgetTypes,
    newHeadingCount,
    newInteractiveCount,
    textTokenAddedCount,
    functionalScore,
    isMeaningful,
  );

  return buildDelta({
    screenshotIdentical:  false,
    fingerprintIdentical: false,
    addedWidgetTypes,
    newHeadingCount,
    newInteractiveCount,
    textTokenAddedCount,
    functionalScore,
    isMeaningful,
    reason,
  });
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildDelta(fields: StateDelta): StateDelta {
  return fields;
}

function buildReason(
  addedWidgetTypes:    WidgetType[],
  newHeadingCount:     number,
  newInteractiveCount: number,
  textTokenAdded:      number,
  functionalScore:     number,
  isMeaningful:        boolean,
): string {
  const parts: string[] = [];

  if (addedWidgetTypes.length > 0) {
    parts.push(`added ${addedWidgetTypes.length} widget type(s): [${addedWidgetTypes.join(', ')}]`);
  }
  if (newHeadingCount > 0) {
    parts.push(`${newHeadingCount} new heading(s)`);
  }
  if (newInteractiveCount > 0) {
    parts.push(`${newInteractiveCount} new interactive element(s)`);
  }
  if (textTokenAdded > 0) {
    parts.push(`${textTokenAdded} new text token(s)`);
  }

  const summary = parts.length > 0 ? parts.join(', ') : 'no structural changes detected';
  const verdict = isMeaningful ? 'MEANINGFUL' : 'not meaningful';
  return `${verdict} — ${summary} (score: ${functionalScore.toFixed(3)})`;
}
