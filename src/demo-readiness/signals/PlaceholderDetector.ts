// ─────────────────────────────────────────────────────────────────────────────
// PlaceholderDetector
//
// Detects pages with scaffold / stub / placeholder content that carry no
// real demo value: lorem ipsum text, "coming soon" messages, generic
// repeated feature labels, or universally low feature priority scores.
//
// Pure function — no I/O, no LLM, no state.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReadinessSignal, ScoringContext } from '../../core/domain/entities/ReadinessResult';

// ── Pattern lists ─────────────────────────────────────────────────────────────

const FILLER_TEXT_PATTERNS: RegExp[] = [
  /\blorem\s+ipsum\b/i,
  /\bcoming\s+soon\b/i,
  /\bunder\s+construction\b/i,
  /\btbd\b/i,
  /\bt\.b\.d\b/i,
  /\btodo\b/i,
  /\bplaceholder\b/i,
  /\bsample\s+data\b/i,
  /\btest\s+data\b/i,
  /\bdemo\s+placeholder\b/i,
  /\bn\/a\b/i,
  /\bno\s+data\s+available\b/i,
  /\btemplate\b/i,
  /\bscaffold\b/i,
  /\bboilerplate\b/i,
];

function containsFillerText(text: string): string | null {
  const match = FILLER_TEXT_PATTERNS.find(re => re.test(text));
  return match ? text.slice(0, 80) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PlaceholderDetector
// ─────────────────────────────────────────────────────────────────────────────

export const PlaceholderDetector = {
  detect(ctx: ScoringContext): ReadinessSignal[] {
    const signals: ReadinessSignal[] = [];

    // ── 1. Filler text in feature names ──────────────────────────────────────
    const fillerFeature = ctx.features.find(f => containsFillerText(f.featureName) !== null);
    if (fillerFeature) {
      signals.push({
        type:       'placeholder_content',
        weight:     -0.40,
        confidence: 0.90,
        evidence:   `Feature name contains filler text: "${fillerFeature.featureName}"`,
        source:     'feature_label',
      });
    }

    // ── 2. Filler text in page purpose ───────────────────────────────────────
    const purposeMatch = containsFillerText(ctx.pagePurpose);
    if (purposeMatch) {
      signals.push({
        type:       'placeholder_content',
        weight:     -0.35,
        confidence: 0.85,
        evidence:   `pagePurpose contains filler text: "${purposeMatch}"`,
        source:     'feature_label',
      });
    }

    // ── 3. Filler text in headings ────────────────────────────────────────────
    for (const heading of ctx.headings) {
      const headingMatch = containsFillerText(heading);
      if (headingMatch) {
        signals.push({
          type:       'placeholder_content',
          weight:     -0.30,
          confidence: 0.85,
          evidence:   `Heading contains filler text: "${headingMatch}"`,
          source:     'dom',
        });
        break;
      }
    }

    // ── 4. Repetitive generic feature labels ──────────────────────────────────
    // If >60% of features share the same normalised label, the LLM saw nothing
    // distinctive — the page is probably a stub.
    if (ctx.features.length >= 3) {
      const labelCounts = new Map<string, number>();
      for (const f of ctx.features) {
        const key = f.featureName.toLowerCase().replace(/[^a-z0-9]/g, '');
        labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
      }
      const maxCount = Math.max(...labelCounts.values());
      if (maxCount / ctx.features.length > 0.60) {
        const dominant = [...labelCounts.entries()]
          .find(([, v]) => v === maxCount)!;
        signals.push({
          type:       'placeholder_content',
          weight:     -0.30,
          confidence: 0.70,
          evidence:   `${maxCount}/${ctx.features.length} features share label "${dominant[0]}" — generic/repeated content`,
          source:     'feature_label',
        });
      }
    }

    // ── 5. Universally low feature priority ───────────────────────────────────
    // All ranked features for this page scored below 25/100 after cross-page
    // ranking — nothing on this page stood out relative to the corpus.
    if (ctx.pageFeatureCount >= 2 && ctx.topFeatureComposite < 25) {
      signals.push({
        type:       'placeholder_content',
        weight:     -0.25,
        confidence: 0.60,
        evidence:   `Top feature composite score=${ctx.topFeatureComposite}/100 — all features rank low relative to corpus`,
        source:     'ranking',
      });
    }

    return signals;
  },
};
