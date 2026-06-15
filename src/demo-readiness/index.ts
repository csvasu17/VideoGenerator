// ─────────────────────────────────────────────────────────────────────────────
// demo-readiness — barrel export
//
// Public surface of the Demo Readiness Scoring module.
// Import the stage for pipeline wiring; import types for reports/tests.
// ─────────────────────────────────────────────────────────────────────────────

// Domain types
export type {
  SignalType,
  SignalSource,
  ReadinessSignal,
  DemoValueTier,
  ReadinessVerdict,
  ReadinessCategory,
  ReadinessResult,
  ScoringContext,
} from '../core/domain/entities/ReadinessResult';

// Scoring engine
export { ReadinessScorer }         from './ReadinessScorer';
export { ScoringContextBuilder }   from './ScoringContextBuilder';
export { DuplicateDetector }       from './DuplicateDetector';
export { deriveVerdict, deriveCategory } from './DuplicateDetector';

// Individual detectors (exported for testing and composition)
export { AuthScreenDetector }      from './signals/AuthScreenDetector';
export { EmptyStateDetector }      from './signals/EmptyStateDetector';
export { SettingsDetector }        from './signals/SettingsDetector';
export { PlaceholderDetector }     from './signals/PlaceholderDetector';
export { ValueScreenClassifier }   from './signals/ValueScreenClassifier';
