/**
 * MotionContinuityEngine — post-processes camera timelines to ensure
 * spatial coherence across scene boundaries.
 *
 * Rules applied per transition type:
 *
 *   zoom-through:
 *     - Scene B's KF(0) is replaced with the transition's entryFocal at
 *       a zoom slightly above 1.0 (emerging from the zoom-through).
 *     - Scene B's context phase becomes a pull-out: zoom 1.3→1.0 over the
 *       first contextEnd frames — the camera "emerges" rather than opening cold.
 *
 *   shared-element:
 *     - Scene B starts at the shared element's region center + zoom 1.15.
 *     - Context phase shortened: scene B opens already framed on the shared element.
 *
 *   match-cut:
 *     - Scene B's first keyframe is set to match scene A's exit focus + zoom.
 *     - Normal context phase follows.
 *
 *   dolly-reveal:
 *     - Scene B's KF(0) starts at full zoom (1.0) centred, already locked on target.
 *       The approach phase begins immediately (no context delay).
 *
 *   slide-parallax / cut-and-land / default:
 *     - No camera timeline adjustment needed — transitions are purely compositional.
 *
 * Mutates the scenes array in-place. Returns the same array.
 *
 * No LLM, no I/O. Pure geometry.
 */

import type { MotionDirectedScene } from '../types';
import type { TransitionPlan }      from './types';
import type { CameraKeyframe }      from '../camera/types';

// ─────────────────────────────────────────────────────────────────────────────
// MotionContinuityEngine
// ─────────────────────────────────────────────────────────────────────────────

export class MotionContinuityEngine {
  /**
   * Apply continuity adjustments to scene camera timelines based on transitions.
   * Mutates in place; returns the same array for chaining.
   */
  applyContinuity(
    scenes:      MotionDirectedScene[],
    transitions: TransitionPlan[],
  ): MotionDirectedScene[] {
    for (let i = 0; i < transitions.length; i++) {
      const plan  = transitions[i];
      const sceneB = scenes[i + 1];
      if (!sceneB) continue;

      switch (plan.type) {
        case 'zoom-through':
          this.applyZoomThroughContinuity(sceneB, plan);
          break;
        case 'shared-element':
          this.applySharedElementContinuity(sceneB, plan);
          break;
        case 'match-cut':
          this.applyMatchCutContinuity(sceneB, plan);
          break;
        case 'dolly-reveal':
          this.applyDollyRevealContinuity(sceneB, plan);
          break;
        // slide-parallax, cut-and-land: no camera adjustment
      }
    }
    return scenes;
  }

  // ── Per-transition-type adjustments ────────────────────────────────────────

  /**
   * Zoom-through: scene B's camera should "emerge" from the zoom.
   * Inserts a high-zoom entry keyframe at frame 0 that pulls back to 1.0.
   */
  private applyZoomThroughContinuity(
    scene: MotionDirectedScene,
    plan:  TransitionPlan,
  ): void {
    if (!plan.entryFocal) return;
    const kfs = scene.cameraTimeline.keyframes;

    // Replace KF(0) with entry focal at zoom 1.4 (mid-zoom — emerging from through)
    const entryKf: CameraKeyframe = kf(
      0,
      1.4,
      plan.entryFocal.x,
      plan.entryFocal.y,
      'spring',
      { damping: 20, stiffness: 90 },
    );

    // Insert the entry keyframe at position 0, removing any existing frame-0 KF
    const withoutZero = kfs.filter(k => k.frame > 0);
    scene.cameraTimeline.keyframes = [entryKf, ...withoutZero].sort(byFrame);
  }

  /**
   * Shared-element: scene B opens already at the shared element's position.
   * Shifts the first keyframe to the shared element's region center.
   */
  private applySharedElementContinuity(
    scene: MotionDirectedScene,
    plan:  TransitionPlan,
  ): void {
    if (!plan.sharedElement) return;
    const region = plan.sharedElement.regionB;
    const cx = region.x + region.width  / 2;
    const cy = region.y + region.height / 2;

    const kfs = scene.cameraTimeline.keyframes;
    if (kfs.length === 0) return;

    // Modify the first two keyframes to start at the shared element position
    kfs[0] = { ...kfs[0], zoom: 1.15, focusX: cx, focusY: cy };
    if (kfs.length > 1) {
      kfs[1] = { ...kfs[1], zoom: 1.15, focusX: cx, focusY: cy };
    }
  }

  /**
   * Match-cut: scene B's camera starts at scene A's exit position.
   */
  private applyMatchCutContinuity(
    scene: MotionDirectedScene,
    plan:  TransitionPlan,
  ): void {
    if (!plan.entryFocal) return;
    const kfs = scene.cameraTimeline.keyframes;
    if (kfs.length === 0) return;

    kfs[0] = { ...kfs[0], focusX: plan.entryFocal.x, focusY: plan.entryFocal.y };
  }

  /**
   * Dolly-reveal: scene B skips the context phase — camera lands immediately
   * on the target and begins the approach without delay.
   */
  private applyDollyRevealContinuity(
    scene: MotionDirectedScene,
    plan:  TransitionPlan,
  ): void {
    if (!plan.landingTargetRegion) return;
    const region = plan.landingTargetRegion;
    const cx = region.x + region.width  / 2;
    const cy = region.y + region.height / 2;

    const kfs = scene.cameraTimeline.keyframes;
    if (kfs.length === 0) return;

    // Compress context phase: start already partially zoomed toward target
    kfs[0] = { ...kfs[0], zoom: 1.0, focusX: cx, focusY: cy };
    if (kfs.length > 1 && kfs[1].frame < 15) {
      kfs[1] = { ...kfs[1], zoom: 1.0, focusX: cx, focusY: cy };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function byFrame(a: CameraKeyframe, b: CameraKeyframe): number {
  return a.frame - b.frame;
}

function kf(
  frame:        number,
  zoom:         number,
  focusX:       number,
  focusY:       number,
  easing:       'spring' | 'linear',
  springConfig?: { damping: number; stiffness: number },
): CameraKeyframe {
  return { frame, zoom, focusX, focusY, easing, springConfig };
}
