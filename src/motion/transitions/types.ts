/**
 * Transition domain types — Phase 7 Motion Direction Engine.
 *
 * Defines the premium transition types that replace or augment the Phase 4
 * SceneTransition system.
 *
 * No business logic here — pure type definitions.
 */

import type { Vec2, NormalizedRegion } from '../attention/types';
import type { ElementType }            from '../camera/types';

// ─────────────────────────────────────────────────────────────────────────────
// MotionTransitionType
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Premium transition types for Phase 7.
 *
 * Selection algorithm (TransitionPlanner):
 *   1. shared-element  — when both scenes have a navigation target at the same x
 *   2. zoom-through    — when exit zoom ≥ 1.4 AND next scene primary score ≥ 0.70
 *   3. match-cut       — when both primary targets share the same elementType
 *   4. dolly-reveal    — when scene A priority > 0.85 AND scene B primary is 'table'
 *   5. slide-parallax  — default (replaces old slide-left with 3-layer parallax)
 *   6. cut-and-land    — hard cut + fast landing movement in scene B
 */
export type MotionTransitionType =
  | 'zoom-through'     // zoom into A's focal region until fill → emerge from B
  | 'shared-element'   // hold on common region (sidebar/header) while content swaps
  | 'match-cut'        // spatial match cut with brief motion blur
  | 'dolly-reveal'     // A pulls back to full → B opens wide and dollies in
  | 'slide-parallax'   // 3-layer parallax slide (background 0.5×, mid 1×, fore 1.5×)
  | 'cut-and-land';    // hard cut + fast landing move at the start of B

// ─────────────────────────────────────────────────────────────────────────────
// SharedElementSpec
// ─────────────────────────────────────────────────────────────────────────────

/**
 * When two adjacent scenes share a structural element (sidebar, header bar),
 * the camera holds on it while the rest of the content changes.
 *
 * Both region fields are in the coordinate space of their respective screenshots.
 */
export interface SharedElementSpec {
  /** Coordinates in scene A's screenshot (product-window normalized). */
  region:      NormalizedRegion;
  /** Same element in scene B's screenshot (product-window normalized). */
  regionB:     NormalizedRegion;
  elementType: ElementType;
}

// ─────────────────────────────────────────────────────────────────────────────
// TransitionPlan
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete transition specification between two adjacent scenes.
 *
 * Produced by TransitionPlanner for every scene boundary.
 * Consumed by:
 *   - MotionContinuityEngine (adjusts camera endpoints for smooth entry/exit)
 *   - MotionTransition.tsx (Remotion component that renders the transition)
 */
export interface TransitionPlan {
  fromSceneId:    string;
  toSceneId:      string;
  type:           MotionTransitionType;
  durationFrames: number;

  // ── zoom-through / match-cut: focal points ────────────────────────────────
  /** Scene A camera focal point at exit (product-window normalized). */
  exitFocal?:     Vec2;
  /** Scene B camera focal point at entry (product-window normalized). */
  entryFocal?:    Vec2;

  // ── shared-element ────────────────────────────────────────────────────────
  sharedElement?: SharedElementSpec;

  // ── slide-parallax ────────────────────────────────────────────────────────
  direction?: 'left' | 'right' | 'up';

  // ── cut-and-land ──────────────────────────────────────────────────────────
  /** The primary attention target in scene B (for the fast landing motion). */
  landingTargetRegion?: NormalizedRegion;
}
