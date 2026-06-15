// ─────────────────────────────────────────────────────────────────────────────
// ConfidenceField — typed value with LLM confidence score and provenance.
//
// Every field extracted by ContextExpansionAgent carries its own confidence
// and provenance so downstream stages can weight influence accordingly.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How the value was derived.
 *   STATED   — user explicitly mentioned this in their input text.
 *   INFERRED — logically derived from what the user stated.
 *   EXPANDED — added by the LLM from world knowledge of this domain.
 *              Hard-capped at 0.75 — the application has not been seen yet.
 */
export type FieldProvenance = 'STATED' | 'INFERRED' | 'EXPANDED';

/**
 * Allowed confidence range per provenance.
 * Raw LLM scores are clamped into these ranges by the factory helpers below.
 */
export const CONFIDENCE_CAPS: Record<FieldProvenance, { min: number; max: number }> = {
  STATED:   { min: 0.85, max: 0.95 },
  INFERRED: { min: 0.60, max: 0.80 },
  EXPANDED: { min: 0.40, max: 0.75 },
};

// ── Core type ─────────────────────────────────────────────────────────────────

/** A typed value with a 0.0–1.0 confidence score and its derivation origin. */
export interface ConfidenceField<T> {
  readonly value:      T;
  /**
   * 0.0–1.0.  Always within the allowed range for this provenance after
   * construction via the factory helpers.
   */
  readonly confidence: number;
  readonly provenance: FieldProvenance;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function statedField<T>(value: T, rawConfidence: number): ConfidenceField<T> {
  const { min, max } = CONFIDENCE_CAPS.STATED;
  return { value, confidence: clamp(rawConfidence, min, max), provenance: 'STATED' };
}

export function inferredField<T>(value: T, rawConfidence: number): ConfidenceField<T> {
  const { min, max } = CONFIDENCE_CAPS.INFERRED;
  return { value, confidence: clamp(rawConfidence, min, max), provenance: 'INFERRED' };
}

export function expandedField<T>(value: T, rawConfidence: number): ConfidenceField<T> {
  const { min, max } = CONFIDENCE_CAPS.EXPANDED;
  return { value, confidence: clamp(rawConfidence, min, max), provenance: 'EXPANDED' };
}

/**
 * Construct a ConfidenceField from raw LLM output, applying provenance caps.
 * Use this when deserialising LLM JSON where provenance is dynamic.
 */
export function buildConfidenceField<T>(
  value:      T,
  confidence: number,
  provenance: FieldProvenance,
): ConfidenceField<T> {
  switch (provenance) {
    case 'STATED':   return statedField(value, confidence);
    case 'INFERRED': return inferredField(value, confidence);
    case 'EXPANDED': return expandedField(value, confidence);
    default:         return expandedField(value, confidence); // safe fallback
  }
}
