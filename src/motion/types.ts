/**
 * Top-level domain types for the Motion Direction Engine — Phase 7.
 *
 * Defines MotionDirectedScene, MotionPlan, MotionPackage, and GlobalMotionStyle.
 * These are the primary output types written to motion-package.json.
 */

import type { ExtendedCameraTimeline }  from './camera/types';
import type { AttentionMap, AttentionBeat } from './attention/types';
import type { CalloutTrack, CalloutVariant } from './callouts/types';
import type { TransitionPlan, MotionTransitionType } from './transitions/types';
import type { RemotionPackage }         from '../core/domain/entities/RemotionPackage';

// ─────────────────────────────────────────────────────────────────────────────
// GlobalMotionStyle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Video-level motion personality.
 * Controls the overall energy, pacing, and visual language of the entire video.
 *
 * 'intensity' scales hold durations, approach speeds, and transition lengths:
 *   subtle   — corporate / informational (slower, more deliberate)
 *   moderate — standard SaaS demo (default)
 *   dynamic  — product launch / high-energy (faster, more cuts)
 */
export interface GlobalMotionStyle {
  intensity:            'subtle' | 'moderate' | 'dynamic';
  calloutVariant:       CalloutVariant;
  calloutAccentColor:   string;   // hex
  preferredTransition:  MotionTransitionType;   // fallback when algorithm has no match
  /** Hard ceiling on camera zoom. Default 1.8 — below the 2.0 max contract. */
  maxZoom:              number;
  /** Minimum fraction of a scene spent in hold phase. Default 0.50. */
  holdPctMin:           number;
}

// ─────────────────────────────────────────────────────────────────────────────
// MotionDirectedScene
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete motion plan for one scene.
 *
 * Persisted in motionPlan.scenes[] inside motion-package.json.
 * sceneId matches demo-package.json scenes[i].id.
 */
export interface MotionDirectedScene {
  sceneId: string;

  /** Extended camera timeline with named beat ranges for callout timing. */
  cameraTimeline: ExtendedCameraTimeline;

  /** Scored attention targets for this scene (primary at index 0). */
  attentionMap: AttentionMap;

  /** Ordered sequence of camera focus phases for the scene. */
  attentionBeats: AttentionBeat[];

  /** All animated callout overlays for this scene. */
  calloutTrack: CalloutTrack;

  /**
   * Transition INTO this scene (from the previous scene).
   * null for the first scene.
   */
  enterTransition: TransitionPlan | null;

  /**
   * Transition OUT OF this scene (to the next scene).
   * null for the last scene.
   */
  exitTransition: TransitionPlan | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MotionPlan
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The complete motion direction plan for the entire video.
 * Added as `motionPlan` to the top-level MotionPackage.
 *
 * Invariant: motionPlan.scenes[i].sceneId === demo-package.scenes[i].id for all i.
 */
export interface MotionPlan {
  version:      string;   // semver, "1.0.0"
  generatedAt:  string;   // ISO timestamp
  globalStyle:  GlobalMotionStyle;
  /** Parallel array to demo-package scenes[]. One entry per scene. */
  scenes:       MotionDirectedScene[];
  /** N-1 transition plans for N scenes. transitions[i] is between scenes[i] and scenes[i+1]. */
  transitions:  TransitionPlan[];
}

// ─────────────────────────────────────────────────────────────────────────────
// MotionPackage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * motion-package.json — extends demo-package.json with the motionPlan field.
 *
 * All existing RemotionPackage fields are carried through unchanged.
 * The Remotion renderer reads motionPlan to drive premium motion behaviour.
 *
 * Backward-compatibility guarantee:
 *   DemoVideo.tsx falls back to Phase 6 behaviour when motionPlan is absent.
 *   MotionScene.tsx uses motionPlan when present.
 */
export interface MotionPackage extends RemotionPackage {
  motionPlan: MotionPlan;
}
