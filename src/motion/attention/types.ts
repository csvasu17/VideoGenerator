/**
 * Attention model domain types — Phase 7 Motion Direction Engine.
 *
 * Defines the data structures that represent what the camera should pay
 * attention to, in what order, and for how long within a scene.
 *
 * No business logic here — pure type definitions.
 */

import type { ElementType, AttentionPhase } from '../camera/types';
import type { PrioritizedFeature }           from '../../core/domain/entities/PrioritizedFeature';
import type { BusinessValueOutput }          from '../../core/domain/entities/BusinessValueOutput';

// ─────────────────────────────────────────────────────────────────────────────
// Core spatial types
// ─────────────────────────────────────────────────────────────────────────────

/** Normalized 2D point; both axes in [0, 1] relative to the product window. */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Normalized region within the product window.
 * All values in [0, 1] — mirrors BoundingBox from camera types but named
 * for use in the attention/callout layer.
 */
export interface NormalizedRegion {
  x:      number;   // left edge
  y:      number;   // top edge
  width:  number;
  height: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// featureImportance dimensions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Business category of the feature.
 * Sourced from BusinessValueStage. Falls back to elementType proxy when absent.
 *
 * Weight table (used by MotionScorer):
 *   revenue_impact:          1.00
 *   safety_compliance:       0.90
 *   cost_reduction:          0.80
 *   operational_efficiency:  0.60
 *   informational:           0.40
 *   structural:              0.20
 */
export type BusinessValueTier =
  | 'revenue_impact'          // features that directly affect revenue or ROI
  | 'safety_compliance'       // features protecting assets, people, or meeting regulations
  | 'cost_reduction'          // features that measurably reduce operating cost
  | 'operational_efficiency'  // features that make workflows faster
  | 'informational'           // features that display data without direct action
  | 'structural';             // navigation, settings, account management

/** Weight for each BusinessValueTier used by MotionScorer. */
export const BUSINESS_TIER_WEIGHTS: Record<BusinessValueTier, number> = {
  revenue_impact:          1.00,
  safety_compliance:       0.90,
  cost_reduction:          0.80,
  operational_efficiency:  0.60,
  informational:           0.40,
  structural:              0.20,
};

/**
 * Where in the narration text the feature's name appears.
 * Determines the narrativeEmphasisScore component of featureImportance.
 */
export type NarrativePosition =
  | 'hook'    // salesHook — the first impression; deserves primary camera focus
  | 'lead'    // first sentence of narration body
  | 'body'    // middle of narration
  | 'close'   // closing sentence
  | 'absent'; // feature not mentioned in narration at all

/** Score for each NarrativePosition. */
export const NARRATIVE_POSITION_SCORES: Record<NarrativePosition, number> = {
  hook:    1.00,
  lead:    0.80,
  body:    0.55,
  close:   0.35,
  absent:  0.15,
};

/**
 * The camera story role assigned to a target after scoring.
 * Determines how the AttentionSequencer and CalloutComposer treat the target.
 */
export type StoryRole =
  | 'hero'        // rank-1 target by featureImportance — always gets a camera beat
  | 'supporting'  // rank-2 target — gets a secondary camera beat if scene is long enough
  | 'contextual'  // present in frame but camera does not land on it
  | 'background'; // not worth any camera attention

// ─────────────────────────────────────────────────────────────────────────────
// AttentionTarget
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One identifiable UI element that deserves camera attention.
 *
 * Produced by VisualAttentionAnalyzer.
 * Scored by MotionScorer (populates motionScore + storyRole).
 * Consumed by AttentionSequencer, CalloutComposer, MultiPointCameraPlanner.
 */
export interface AttentionTarget {
  /** Stable identifier within a scene, e.g. "primary", "secondary-0". */
  id:            string;
  elementType:   ElementType;
  /** Normalized region within the product window [0, 1]. */
  region:        NormalizedRegion;

  // ── Base scores (0–1) ───────────────────────────────────────────────────
  /**
   * Retained for backward compat.
   * Phase 7: used as the fallback value for featureImportance when no
   * pipeline signals are available. Not a direct term in motionScore formula.
   */
  businessValue: number;
  /** Proxy from element area + position — how visually prominent this element is. */
  visualWeight:  number;
  /** 1.0 primary / 0.55 secondary / 0.20 contextual. */
  narrativeRole: number;

  // ── featureImportance composite (new) ────────────────────────────────────
  /**
   * 0–1 composite score encoding narrative importance.
   *
   * Formula:
   *   0.40 × featureRankScore
   * + 0.28 × businessValueTierScore
   * + 0.20 × narrativeEmphasisScore
   * + 0.12 × contextConfidenceScore
   *
   * When pipeline signals are absent, falls back to businessValue.
   */
  featureImportance: number;

  /** Optional source signals that fed into featureImportance. */
  featureRank?:        number;          // 1-based rank in PrioritizedFeature list
  featureTotalRanked?: number;          // denominator for rank normalization (e.g. 10)
  businessValueTier?:  BusinessValueTier;
  contextConfidence?:  number;          // 0–1  from ContextValidation
  narrativeEmphasis?:  number;          // 0–1  parsed from narration text
  narrativePosition?:  NarrativePosition;

  // ── Motion score (final) ─────────────────────────────────────────────────
  /**
   * Final composite score determining the camera order within a scene.
   *
   * Formula:
   *   0.45 × featureImportance
   * + 0.25 × elementTypeWeight
   * + 0.15 × visualWeight
   * + 0.10 × narrativeRole
   * + 0.05 × screenCoverage
   */
  motionScore: number;

  /** Derived from motionScore rank among all targets in this scene. */
  storyRole: StoryRole;

  // ── Content (used by CalloutComposer) ────────────────────────────────────
  label:    string;   // short display label, 1–4 words
  benefit?: string;   // optional benefit statement, ≤ 6 words
  metric?:  string;   // optional metric overlay, e.g. "↓ 34%"
}

// ─────────────────────────────────────────────────────────────────────────────
// AttentionMap
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All scored attention targets for one scene, sorted descending by motionScore.
 * [0] = primary (hero), [1] = supporting (secondary beat), [2+] = contextual or background.
 */
export interface AttentionMap {
  sceneId: string;
  targets: AttentionTarget[];
}

// ─────────────────────────────────────────────────────────────────────────────
// AttentionBeat
// ─────────────────────────────────────────────────────────────────────────────

/** Motion type for the camera during an attention beat. */
export type BeatMotionType =
  | 'dolly-in'   // zoom toward element — main approach
  | 'pan'        // lateral movement between elements
  | 'orbit'      // slow arc around large elements
  | 'drift'      // imperceptibly slow continuous movement (hold phases)
  | 'pull-back'  // zoom out (return phase)
  | 'static';    // no movement

/**
 * A timed window within a scene where the camera focuses on one target.
 * The full scene's AttentionBeat[] is the "focus sequence."
 */
export interface AttentionBeat {
  id:         string;          // e.g. "context", "approach", "hold-primary"
  phase:      AttentionPhase;
  startFrame: number;          // scene-relative, inclusive
  endFrame:   number;          // scene-relative, inclusive
  targetId:   string;          // matches AttentionTarget.id in the scene's AttentionMap
  motionType: BeatMotionType;
}

// ─────────────────────────────────────────────────────────────────────────────
// FeatureImportanceResolver types
// ─────────────────────────────────────────────────────────────────────────────

/** Records which source provided each component of featureImportance. */
export interface FeatureImportanceSignals {
  rankSource:      'pipeline' | 'fallback_priority' | 'default';
  tierSource:      'pipeline' | 'elementType_proxy' | 'default';
  confidenceSource:'pipeline' | 'default';
  emphasisSource:  'narration_parse' | 'default';
}

/** Full result returned by FeatureImportanceResolver.resolve(). */
export interface FeatureImportanceResult {
  featureImportance:   number;     // 0–1 composite
  featureRank?:        number;
  featureTotalRanked?: number;
  businessValueTier?:  BusinessValueTier;
  contextConfidence?:  number;
  narrativeEmphasis?:  number;
  narrativePosition?:  NarrativePosition;
  signals:             FeatureImportanceSignals;
}

// ─────────────────────────────────────────────────────────────────────────────
// AttentionContext — optional pipeline data for VisualAttentionAnalyzer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Optional pipeline context passed to VisualAttentionAnalyzer.analyze().
 * Every field is optional; absent fields trigger fallback behaviour.
 */
export interface AttentionContext {
  /** The ranked feature list from FeatureRankingStage. */
  rankedFeatures?: PrioritizedFeature[];
  /**
   * Per-feature business value copy from BusinessValueStage.
   * Used to extract business tier and outcome metadata.
   */
  businessOutputs?: BusinessValueOutput[];
}
