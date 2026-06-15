// ─────────────────────────────────────────────────────────────────────────────
// Interaction Discovery — public barrel
//
// External callers import from this path only.
// Internal implementation details (InteractionDetector, VisualGroupDetector,
// StateCapture, ResetContext) are NOT re-exported.
// ─────────────────────────────────────────────────────────────────────────────

// Primary entry point
export { InPageDiscovery } from './InPageDiscovery';

// All public types
export type {
  ExplorationResult,
  ExplorationOptions,
  PageInteractionState,
  InteractionStep,
  StateDelta,
  FunctionalFingerprint,
  DomSummary,
  InteractionTarget,
  VisualCandidateGroup,
  ElementStyleSignature,
  InteractionClass,
  DetectionMethod,
  WidgetType,
  Rect,
} from './types';

export { DEFAULT_EXPLORATION_OPTIONS } from './types';

// Standalone utilities (useful for callers that want fingerprinting or
// comparison without running a full exploration)
export { buildFingerprint }        from './FingerprintBuilder';
export { compare as compareStates } from './StateComparator';
export { analyzeStyleSignatures }  from './VisualGroupDetector';

// DOM adapter — converts MVID DomSummary → PageCapture DOMSnapshot
// so VisionAnalysisAgent can process discovered interaction states.
export { adaptDomSummaryToDOMSnapshot } from './DomSummaryAdapter';
