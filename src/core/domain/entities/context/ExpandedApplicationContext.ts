// ─────────────────────────────────────────────────────────────────────────────
// ExpandedApplicationContext — output of ContextExpansionAgent (Phase 2).
//
// Produced by expanding 1–5 sentences of natural language user input using
// LLM world knowledge.  Every field carries its own confidence score and
// provenance tag (STATED / INFERRED / EXPANDED).
//
// ValidatedApplicationContext is produced in Phase 3 when ContextSignalValidator
// runs against Discovery + Vision + BusinessValue evidence.
// ─────────────────────────────────────────────────────────────────────────────

import type { ConfidenceField }          from './ConfidenceField';
import type { ValidatedConfidenceField }  from './ValidationResult';

// ── Expansion quality ─────────────────────────────────────────────────────────

/**
 * Overall quality classification based on weighted mean confidence.
 * Drives how aggressively context influences downstream scoring.
 */
export type ExpansionQuality = 'RICH' | 'ADEQUATE' | 'THIN' | 'UNRELIABLE';

export function classifyExpansionQuality(overallConfidence: number): ExpansionQuality {
  if (overallConfidence >= 0.80) return 'RICH';
  if (overallConfidence >= 0.60) return 'ADEQUATE';
  if (overallConfidence >= 0.40) return 'THIN';
  return 'UNRELIABLE';
}

// ── Expanded context ──────────────────────────────────────────────────────────

/**
 * Structured business context produced by ContextExpansionAgent.
 *
 * Design rules:
 *   - demoPriorities describes WHAT TO DEMONSTRATE, never page names or routes.
 *     e.g. "demonstrating cost visibility" not "show the Energy Dashboard page".
 *   - businessGoals and businessOutcomes are capped at 5 items each.
 *   - demoPriorities is capped at 3 items.
 */
export interface ExpandedApplicationContext {
  /** Industry and functional area.  e.g. "Energy Management for Commercial Buildings". */
  readonly domain:            ConfidenceField<string>;
  /** Primary user persona.  e.g. "Facility Managers". */
  readonly targetAudience:    ConfidenceField<string>;
  /** Stated or inferred business objectives.  Max 5 items. */
  readonly businessGoals:     ReadonlyArray<ConfidenceField<string>>;
  /** Observable or measurable outcomes the customer wants.  Max 5 items. */
  readonly businessOutcomes:  ReadonlyArray<ConfidenceField<string>>;
  /**
   * Demo emphasis areas — describes VALUE to demonstrate, never feature names.
   * Max 3 items.  e.g. "show energy cost reduction over time".
   */
  readonly demoPriorities:    ReadonlyArray<ConfidenceField<string>>;
  /** Weighted mean across all fields.  Drives getEffectiveWeight(). */
  readonly overallConfidence: number;
  readonly expansionQuality:  ExpansionQuality;
  /** Verbatim user input — preserved for audit. */
  readonly rawInput:          string;
}

// ── Validated context ─────────────────────────────────────────────────────────

/**
 * Produced by ContextSignalValidator (Phase 3).
 * Each field's ConfidenceField<T> is replaced by ValidatedConfidenceField<T>.
 * overallConfidence is recalculated from effectiveConfidence values.
 */
export interface ValidatedApplicationContext {
  readonly domain:            ValidatedConfidenceField<string>;
  readonly targetAudience:    ValidatedConfidenceField<string>;
  readonly businessGoals:     ReadonlyArray<ValidatedConfidenceField<string>>;
  readonly businessOutcomes:  ReadonlyArray<ValidatedConfidenceField<string>>;
  readonly demoPriorities:    ReadonlyArray<ValidatedConfidenceField<string>>;
  /** Recalculated weighted mean using effectiveConfidence values. */
  readonly overallConfidence: number;
  /**
   * Hard ceiling on context influence: MAX_CONTEXT_WEIGHT × overallConfidence.
   * Never exceeds 0.15, so context is always additive, never dominant.
   */
  readonly effectiveWeight:   number;
  readonly validationSummary: ValidationSummary;
}

// ── Validation summary ────────────────────────────────────────────────────────

export interface ValidationSummary {
  readonly strongMatchCount:   number;
  readonly weakMatchCount:     number;
  readonly inferredMatchCount: number;
  readonly unconfirmedCount:   number;
  readonly conflictCount:      number;
  /** Human-readable one-liner for log output and UI tooltips. */
  readonly humanReadable:      string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute weighted mean confidence across all expanded fields.
 * businessGoals are weighted 1.5× because they are the primary influence on
 * feature ranking and narration arc.
 */
export function computeOverallConfidence(
  domain:           ConfidenceField<string>,
  targetAudience:   ConfidenceField<string>,
  businessGoals:    ReadonlyArray<ConfidenceField<string>>,
  businessOutcomes: ReadonlyArray<ConfidenceField<string>>,
  demoPriorities:   ReadonlyArray<ConfidenceField<string>>,
): number {
  type Weighted = { confidence: number; weight: number };

  const fields: Weighted[] = [
    { confidence: domain.confidence,         weight: 1.0 },
    { confidence: targetAudience.confidence, weight: 1.0 },
    ...businessGoals.map(f   => ({ confidence: f.confidence, weight: 1.5 })),
    ...businessOutcomes.map(f => ({ confidence: f.confidence, weight: 1.0 })),
    ...demoPriorities.map(f  => ({ confidence: f.confidence, weight: 0.8 })),
  ];

  if (fields.length === 0) return 0;

  const totalWeight = fields.reduce((s, f) => s + f.weight, 0);
  const weightedSum = fields.reduce((s, f) => s + f.confidence * f.weight, 0);

  // Round to 2 decimal places so logs stay readable.
  return Math.round((weightedSum / totalWeight) * 100) / 100;
}
