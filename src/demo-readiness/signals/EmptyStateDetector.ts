// ─────────────────────────────────────────────────────────────────────────────
// EmptyStateDetector
//
// Detects pages that have no meaningful content to demonstrate:
//   — zero features AND zero KPI widgets
//   — "no data / no results / no devices selected" language in purpose or headings
//   — extremely low overall importance score
//
// Hard-reject threshold is triggered by the ReadinessScorer when BOTH the
// zero-feature AND zero-KPI signals fire simultaneously (see ReadinessScorer).
// Pure function — no I/O, no LLM, no state.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReadinessSignal, ScoringContext } from '../../core/domain/entities/ReadinessResult';

// ── Empty-state text patterns ─────────────────────────────────────────────────

const EMPTY_TEXT_PATTERNS: RegExp[] = [
  /\bno\s+data\b/i,
  /\bno\s+results?\b/i,
  /\bno\s+items?\b/i,
  /\bno\s+devices?\b/i,
  /\bno\s+records?\b/i,
  /\bno\s+entries\b/i,
  /\bnothing\s+to\s+show\b/i,
  /\bno\s+device\s+selected\b/i,
  /\bno\s+devices?\s+match\b/i,
  /\bnot\s+found\b/i,
  /\b0\s+items?\b/i,
  /\b0\s+results?\b/i,
  /\bno\s+activity\b/i,
  /\bno\s+alerts?\b/i,
  /\bno\s+alarms?\b/i,
  /\bno\s+notifications?\b/i,
  /\bempty\s+list\b/i,
  /\bno\s+content\b/i,
];

function matchesEmptyText(text: string): string | null {
  const match = EMPTY_TEXT_PATTERNS.find(re => re.test(text));
  return match ? text.slice(0, 80) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// EmptyStateDetector
// ─────────────────────────────────────────────────────────────────────────────

export const EmptyStateDetector = {
  detect(ctx: ScoringContext): ReadinessSignal[] {
    const signals: ReadinessSignal[] = [];

    // ── 1. Zero features from vision analysis ────────────────────────────────
    if (ctx.features.length === 0) {
      signals.push({
        type:       'empty_state',
        weight:     -0.65,
        confidence: 0.80,
        evidence:   'zero features detected by vision analysis',
        source:     'element_type',
      });
    }

    // ── 2. Zero KPI widgets ─────────────────────────────────────────────────
    // Emitted as a separate signal so ReadinessScorer can trigger hard-reject
    // when both zero-feature and zero-KPI fire together.
    if (ctx.kpiWidgets.length === 0 && ctx.features.length === 0) {
      signals.push({
        type:       'empty_state',
        weight:     -0.35,
        confidence: 0.75,
        evidence:   'zero KPI widgets — page carries no measurable data',
        source:     'element_type',
      });
    }

    // ── 3. Empty-state language in pagePurpose ───────────────────────────────
    const purposeMatch = matchesEmptyText(ctx.pagePurpose);
    if (purposeMatch) {
      signals.push({
        type:       'empty_state',
        weight:     -0.50,
        confidence: 0.85,
        evidence:   `pagePurpose contains empty-state language: "${purposeMatch}"`,
        source:     'feature_label',
      });
    }

    // ── 4. Empty-state language in headings ──────────────────────────────────
    for (const heading of ctx.headings) {
      const headingMatch = matchesEmptyText(heading);
      if (headingMatch) {
        signals.push({
          type:       'empty_state',
          weight:     -0.40,
          confidence: 0.80,
          evidence:   `Heading contains empty-state language: "${headingMatch}"`,
          source:     'dom',
        });
        break; // One heading signal is sufficient
      }
    }

    // ── 5. Empty-state language in feature names ─────────────────────────────
    for (const f of ctx.features) {
      const featureMatch = matchesEmptyText(f.featureName);
      if (featureMatch) {
        signals.push({
          type:       'empty_state',
          weight:     -0.35,
          confidence: 0.75,
          evidence:   `Feature name contains empty-state language: "${f.featureName}"`,
          source:     'feature_label',
        });
        break;
      }
    }

    // ── 6. Very low overall importance ───────────────────────────────────────
    // Only emitted when other signals have also fired (reinforces the pattern).
    if (signals.length > 0 && ctx.overallImportanceScore < 15) {
      signals.push({
        type:       'empty_state',
        weight:     -0.30,
        confidence: 0.60,
        evidence:   `overallImportanceScore=${ctx.overallImportanceScore} — far below meaningful threshold`,
        source:     'element_type',
      });
    }

    return signals;
  },
};
