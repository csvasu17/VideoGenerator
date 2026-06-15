/**
 * Motion Direction Engine — Phase 7 barrel export.
 *
 * Exports all public types and classes from the motion subsystem.
 * Consumers should import from this barrel, not from individual files.
 */

// ── Phase 2–6 exports (unchanged) ───────────────────────────────────────────
export { CameraChoreographer }   from './camera/CameraChoreographer';
export { CAMERA_PROFILES, CANONICAL_REGIONS } from './camera/CameraProfiles';
export type { MotionProfile }    from './camera/CameraProfiles';
export type {
  CameraTimeline,
  CameraKeyframe,
  SpotlightTarget,
  BoundingBox,
  ElementType,
  CameraChoreographyInput,
  // Phase 7 additions to camera types
  AttentionPhase,
  CameraBeatRange,
  ExtendedCameraTimeline,
} from './camera/types';

// ── Phase 7: Attention model ─────────────────────────────────────────────────
export type {
  Vec2,
  NormalizedRegion,
  BusinessValueTier,
  NarrativePosition,
  StoryRole,
  AttentionTarget,
  AttentionMap,
  BeatMotionType,
  AttentionBeat,
  FeatureImportanceResult,
  FeatureImportanceSignals,
  AttentionContext,
} from './attention/types';
export { BUSINESS_TIER_WEIGHTS, NARRATIVE_POSITION_SCORES } from './attention/types';
export { VisualAttentionAnalyzer }    from './attention/VisualAttentionAnalyzer';
export { AttentionSequencer }         from './attention/AttentionSequencer';
export { MotionScorer, ELEMENT_TYPE_WEIGHTS } from './attention/MotionScorer';
export { FeatureImportanceResolver }  from './attention/FeatureImportanceResolver';
export { NarrationEmphasisParser }    from './attention/NarrationEmphasisParser';
export type { NarrationInput, EmphasisResult } from './attention/NarrationEmphasisParser';
export type { ResolverInput }         from './attention/FeatureImportanceResolver';

// ── Phase 7: Camera planning ─────────────────────────────────────────────────
export { MultiPointCameraPlanner }    from './camera/MultiPointCameraPlanner';

// ── Phase 7: Callout model ───────────────────────────────────────────────────
export type {
  CalloutContent,
  CalloutStyle,
  CalloutVariant,
  CalloutConnector,
  AnimatedCallout,
  CalloutTrack,
  CalloutEnterAnimation,
  CalloutExitAnimation,
} from './callouts/types';
export { CalloutComposer }            from './callouts/CalloutComposer';

// ── Phase 7: Transition model ────────────────────────────────────────────────
export type {
  MotionTransitionType,
  SharedElementSpec,
  TransitionPlan,
} from './transitions/types';
export { TransitionPlanner }          from './transitions/TransitionPlanner';
export { MotionContinuityEngine }     from './transitions/MotionContinuityEngine';

// ── Phase 7: Top-level types ─────────────────────────────────────────────────
export type {
  GlobalMotionStyle,
  MotionDirectedScene,
  MotionPlan,
  MotionPackage,
} from './types';

// ── Phase 7: Orchestrators ───────────────────────────────────────────────────
export { SceneMotionPlanner }         from './SceneMotionPlanner';
export { MotionDirectionEngine }      from './MotionDirectionEngine';
export type { MotionDirectionInput }  from './MotionDirectionEngine';
