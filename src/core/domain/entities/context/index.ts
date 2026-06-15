// ─────────────────────────────────────────────────────────────────────────────
// Application Context — barrel export
// ─────────────────────────────────────────────────────────────────────────────

export type { ConfidenceField, FieldProvenance } from './ConfidenceField';
export {
  CONFIDENCE_CAPS,
  statedField,
  inferredField,
  expandedField,
  buildConfidenceField,
} from './ConfidenceField';

export type {
  ValidationResult,
  EvidenceSourceType,
  EvidenceReference,
  ValidatedConfidenceField,
} from './ValidationResult';
export {
  VALIDATION_MULTIPLIERS,
  MIN_SEMANTIC_SCORES,
  applyValidationToField,
} from './ValidationResult';

export type {
  ExpansionQuality,
  ExpandedApplicationContext,
  ValidatedApplicationContext,
  ValidationSummary,
} from './ExpandedApplicationContext';
export {
  classifyExpansionQuality,
  computeOverallConfidence,
} from './ExpandedApplicationContext';

export type { NarrationHints } from './NarrationHints';

export { ContextEnvelope, CONTEXT_THRESHOLDS } from './ContextEnvelope';
