/**
 * MotionScorer — pure scoring function, no LLM, no I/O.
 *
 * Computes motionScore for each AttentionTarget and assigns storyRole.
 *
 * Formula:
 *   motionScore =
 *       0.45 × featureImportance    (absorbs + extends old businessValue)
 *     + 0.25 × elementTypeWeight    (visual type intent)
 *     + 0.15 × visualWeight         (area + position bonus)
 *     + 0.10 × narrativeRole        (primary/secondary structural signal)
 *     + 0.05 × screenCoverage       (tiebreaker)
 *
 * StoryRole assignment (after scoring):
 *   [0] motionScore ≥ any      → 'hero'
 *   [1] motionScore > 0.35     → 'supporting'
 *   [2+] motionScore > 0.20    → 'contextual'
 *   below                      → 'background'
 */

import type { AttentionTarget, StoryRole } from './types';
import type { ElementType }               from '../camera/types';

// ─────────────────────────────────────────────────────────────────────────────
// elementTypeWeight lookup
// ─────────────────────────────────────────────────────────────────────────────

const ELEMENT_TYPE_WEIGHTS: Record<ElementType, number> = {
  modal:      0.95,   // highest visual intrusion — always story-carrying
  button:     0.90,   // CTA / action drives business value
  alert:      0.85,   // urgency reads immediately
  kpi_card:   0.85,   // metric is the message
  metric:     0.80,   // solo stat — sharp and readable
  chart:      0.72,   // requires time to read — good secondary hold
  table:      0.65,   // context-dense — approach carefully
  form:       0.65,   // interaction affordance — moderate weight
  map:        0.55,   // spatial orientation — context role
  list:       0.55,   // low visual weight
  navigation: 0.40,   // structural, not content
  default:    0.30,   // unknown — Ken-Burns fallback
};

// ─────────────────────────────────────────────────────────────────────────────
// MotionScorer
// ─────────────────────────────────────────────────────────────────────────────

export class MotionScorer {
  /**
   * Score and rank all targets in place. Mutates targets[].motionScore and targets[].storyRole.
   * Returns the same array, sorted descending by motionScore.
   */
  score(targets: AttentionTarget[]): AttentionTarget[] {
    for (const target of targets) {
      target.motionScore = this.computeMotionScore(target);
    }

    // Sort descending
    targets.sort((a, b) => b.motionScore - a.motionScore);

    // Assign storyRole based on rank
    for (let i = 0; i < targets.length; i++) {
      targets[i].storyRole = this.assignRole(i, targets[i].motionScore);
    }

    return targets;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private computeMotionScore(t: AttentionTarget): number {
    const elementTypeWeight = ELEMENT_TYPE_WEIGHTS[t.elementType] ?? ELEMENT_TYPE_WEIGHTS.default;
    const screenCoverage    = Math.min(t.region.width * t.region.height * 4.0, 1.0);

    const score =
      0.45 * t.featureImportance +
      0.25 * elementTypeWeight   +
      0.15 * t.visualWeight      +
      0.10 * t.narrativeRole     +
      0.05 * screenCoverage;

    return clamp(score, 0, 1);
  }

  private assignRole(index: number, score: number): StoryRole {
    if (index === 0)              return 'hero';
    if (index === 1 && score > 0.35) return 'supporting';
    if (score > 0.20)             return 'contextual';
    return 'background';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ─────────────────────────────────────────────────────────────────────────────
// Export lookup table for downstream consumers
// ─────────────────────────────────────────────────────────────────────────────

export { ELEMENT_TYPE_WEIGHTS };
