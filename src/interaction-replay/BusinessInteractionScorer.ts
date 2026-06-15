// ─────────────────────────────────────────────────────────────────────────────
// BusinessInteractionScorer
//
// Assigns a 0–1 businessScore to each InteractionSequence.
// Pure computation — no LLM calls, no filesystem access, fully deterministic.
//
// Score formula (weights sum to 1.0, then multiplied by classPenaltyMultiplier):
//   raw = 0.35 * structuralWeight   (raw MVID delta strength)
//       + 0.45 * signalWeight        (highest PERMITTED signal weight)
//       + 0.20 * widgetWeight        (newly-appeared widget bonus)
//
//   businessScore = clamp(raw * classPenaltyMultiplier, 0, 1)
//
// Phase 9b quality changes:
//   - Reads permittedSignals (class-filtered), not raw businessSignals
//   - Applies classPenaltyMultiplier from InteractionSequenceBuilder
//   - Signal weight increased 0.40→0.45; structural weight reduced 0.40→0.35
// ─────────────────────────────────────────────────────────────────────────────

import type { BusinessSignalType, InteractionSequence } from '../core/domain/entities/InteractionReplay';

// Per-signal business value weights (tuned for Rheem IoT use case)
const SIGNAL_WEIGHTS: Record<BusinessSignalType, number> = {
  ai_prediction:        1.00,
  risk_score_change:    0.95,
  risk_score_changed:   0.95,
  simulation_result:    0.90,
  simulation_completed: 0.90,
  simulation_started:   0.80,
  alarm_generated:      0.90,
  fault_injected:       0.85,
  kpi_revealed:         0.80,
  kpi_changed:          0.80,
  cost_metric_revealed: 0.75,
  outcome_metric:       0.70,
  workflow_completed:   0.60,
};

// Widget-type appearance bonuses (additive, capped at 1.0)
const WIDGET_BONUSES: Record<string, number> = {
  chart: 0.30,
  table: 0.20,
  form:  0.10,
  list:  0.05,
};

// ── Scorer ─────────────────────────────────────────────────────────────────────

export class BusinessInteractionScorer {

  /**
   * Score all sequences in-place and return the same array for chaining.
   * The scores are fully deterministic given the same inputs.
   */
  score(sequences: InteractionSequence[]): InteractionSequence[] {
    for (const seq of sequences) {
      seq.businessScore = this.computeScore(seq);
    }
    return sequences;
  }

  // ── Internal ───────────────────────────────────────────────────────────────────

  private computeScore(seq: InteractionSequence): number {
    const structuralWeight = clamp(seq.structuralDeltaScore, 0, 1);

    // Use permittedSignals — class-filtered by InteractionSequenceBuilder.
    // Falls back to businessSignals for backward-compat with old sequences that
    // pre-date the permittedSignals field (undefined/null = not set, not empty).
    // An explicitly empty array [] means "all signals blocked" and is respected.
    const signals = seq.permittedSignals != null
      ? seq.permittedSignals
      : seq.businessSignals;

    const signalWeight = signals.length === 0
      ? 0
      : Math.max(...signals.map(s => SIGNAL_WEIGHTS[s] ?? 0.50));

    const widgetWeight = clamp(
      seq.visualDelta.newWidgetTypes.reduce(
        (acc, w) => acc + (WIDGET_BONUSES[w.toLowerCase()] ?? 0),
        0,
      ),
      0, 1,
    );

    const raw = clamp(
      0.35 * structuralWeight + 0.45 * signalWeight + 0.20 * widgetWeight,
      0, 1,
    );

    // Apply interaction class penalty/bonus.
    // classPenaltyMultiplier is 0.50 for accordion/toggle, 1.10 for scenario_execute.
    const multiplier = seq.classPenaltyMultiplier ?? 1.00;
    return clamp(raw * multiplier, 0, 1);
  }
}

// ── Utility ────────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
