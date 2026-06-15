// ─────────────────────────────────────────────────────────────────────────────
// ValidationResult — outcome of validating one context signal against evidence.
//
// Validation runs AFTER Discovery + Vision Analysis + Business Value Analysis
// are all complete, giving it access to:
//   • Feature descriptions (from VisionAnalysisAgent)
//   • Business value copy (from BusinessValueAgent)
//   • Page summaries and vision analysis text
//
// This enables semantic alignment — "Reduce energy costs" is a STRONG_MATCH for
// "Energy Consumption Dashboard" plus "Provides visibility into energy usage
// patterns and cost drivers" even without an exact phrase match.
// ─────────────────────────────────────────────────────────────────────────────

import type { ConfidenceField, FieldProvenance } from './ConfidenceField';

// ── Validation outcome ────────────────────────────────────────────────────────

export type ValidationResult =
  | 'STRONG_MATCH'    // strong semantic alignment across ≥2 evidence sources
  | 'WEAK_MATCH'      // partial semantic alignment found in at least 1 source
  | 'INFERRED_MATCH'  // plausible inference from surrounding evidence
  | 'UNCONFIRMED'     // no supporting evidence found (not a conflict)
  | 'CONFLICT';       // evidence directly contradicts this field

// ── Confidence multipliers after validation ───────────────────────────────────

/**
 * Multiplied against the field's original confidence to produce effectiveConfidence.
 * CONFLICT → 0.00 (field excluded from ALL downstream influence).
 */
export const VALIDATION_MULTIPLIERS: Record<ValidationResult, number> = {
  STRONG_MATCH:   1.10,   // slight boost; effectiveConfidence is still capped at 0.95
  WEAK_MATCH:     1.00,   // unchanged
  INFERRED_MATCH: 0.85,
  UNCONFIRMED:    0.60,
  CONFLICT:       0.00,
};

// ── Evidence source types ─────────────────────────────────────────────────────

/**
 * Which type of evidence produced a match (or conflict).
 *
 * Surface-level sources (PAGE_TITLE, NAV_LABEL, FEATURE_NAME) match quickly
 * but can miss intent. Semantic sources (FEATURE_DESCRIPTION, BUSINESS_VALUE,
 * VISION_SUMMARY) catch conceptual alignment even without exact phrasing.
 */
export type EvidenceSourceType =
  | 'PAGE_TITLE'           // text of a discovered page title
  | 'NAV_LABEL'            // text of a navigation element
  | 'FEATURE_NAME'         // extracted feature name
  | 'FEATURE_DESCRIPTION'  // feature description from vision / DOM analysis
  | 'BUSINESS_VALUE'       // business value copy from BusinessValueAgent
  | 'VISION_SUMMARY';      // page-level summary from VisionAnalysisAgent

/** Minimum semantic score to count as a match for each source type. */
export const MIN_SEMANTIC_SCORES: Record<EvidenceSourceType, number> = {
  PAGE_TITLE:          0.50,   // direct label match expected
  NAV_LABEL:           0.50,
  FEATURE_NAME:        0.45,
  FEATURE_DESCRIPTION: 0.40,   // semantic — conceptual alignment is sufficient
  BUSINESS_VALUE:      0.40,
  VISION_SUMMARY:      0.35,
};

// ── Evidence reference ────────────────────────────────────────────────────────

export interface EvidenceReference {
  readonly source:        EvidenceSourceType;
  /** The exact text that matched (or conflicted with) the context signal. */
  readonly text:          string;
  /** Owning feature ID, when applicable. */
  readonly featureId?:    string;
  /** Owning page ID, when applicable. */
  readonly pageId?:       string;
  /** 0.0–1.0 — conceptual similarity to the context signal being validated. */
  readonly semanticScore: number;
}

// ── Validated field ───────────────────────────────────────────────────────────

/**
 * A ConfidenceField with its post-validation effective confidence.
 * Produced by ContextSignalValidator (Phase 3).
 */
export interface ValidatedConfidenceField<T> extends ConfidenceField<T> {
  /** confidence × VALIDATION_MULTIPLIERS[validationResult], capped at 0.95. */
  readonly effectiveConfidence:  number;
  readonly validationResult:     ValidationResult;
  readonly matchedEvidence:      ReadonlyArray<EvidenceReference>;
  readonly conflictingEvidence:  ReadonlyArray<EvidenceReference>;
}

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Apply a validation result to a raw ConfidenceField, producing a
 * ValidatedConfidenceField.  Called by ContextSignalValidator (Phase 3).
 */
export function applyValidationToField<T>(
  field:      ConfidenceField<T>,
  result:     ValidationResult,
  matched:    ReadonlyArray<EvidenceReference>,
  conflicting: ReadonlyArray<EvidenceReference>,
): ValidatedConfidenceField<T> {
  const multiplier        = VALIDATION_MULTIPLIERS[result];
  const effectiveConfidence = Math.min(0.95, field.confidence * multiplier);

  return {
    value:                field.value,
    confidence:           field.confidence,
    provenance:           field.provenance as FieldProvenance,
    effectiveConfidence,
    validationResult:     result,
    matchedEvidence:      matched,
    conflictingEvidence:  conflicting,
  };
}
