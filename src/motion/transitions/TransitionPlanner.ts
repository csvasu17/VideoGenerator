/**
 * TransitionPlanner — selects the MotionTransitionType between adjacent scenes.
 *
 * Selection algorithm (in priority order):
 *   1. shared-element  — both scenes have a 'navigation' target at a similar x position
 *   2. zoom-through    — exit zoom ≥ 1.4 AND next scene primary score ≥ 0.70
 *   3. match-cut       — both primary targets share the same elementType
 *   4. dolly-reveal    — scene A priority > 0.85 AND scene B primary is 'table'
 *   5. slide-parallax  — default (replaces old slide-left)
 *   6. cut-and-land    — injected when scene B is very short (< 5 s)
 *
 * Duration:
 *   shared-element:  20–25 frames
 *   zoom-through:    30–45 frames
 *   match-cut:       10–15 frames
 *   dolly-reveal:    40–50 frames
 *   slide-parallax:  25 frames
 *   cut-and-land:    0 frames (hard cut)
 *
 * No LLM, no I/O. Pure geometry.
 */

import type { MotionDirectedScene }                         from '../types';
import type { TransitionPlan, MotionTransitionType }        from './types';
import type { Vec2, NormalizedRegion }                       from '../attention/types';
import { CAMERA_PROFILES }                                   from '../camera/CameraProfiles';

// ─────────────────────────────────────────────────────────────────────────────
// TransitionPlanner
// ─────────────────────────────────────────────────────────────────────────────

export class TransitionPlanner {
  /**
   * Produce N-1 TransitionPlans for N scenes.
   */
  plan(scenes: MotionDirectedScene[]): TransitionPlan[] {
    const plans: TransitionPlan[] = [];
    for (let i = 0; i < scenes.length - 1; i++) {
      plans.push(this.planOne(scenes[i], scenes[i + 1]));
    }
    return plans;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private planOne(a: MotionDirectedScene, b: MotionDirectedScene): TransitionPlan {
    const primaryA = a.attentionMap.targets[0];
    const primaryB = b.attentionMap.targets[0];

    const navA = a.attentionMap.targets.find(t => t.elementType === 'navigation');
    const navB = b.attentionMap.targets.find(t => t.elementType === 'navigation');

    // ── 1. Shared-element (navigation sidebar) ────────────────────────────
    if (navA && navB && Math.abs(navA.region.x - navB.region.x) < 0.10) {
      return {
        fromSceneId:    a.sceneId,
        toSceneId:      b.sceneId,
        type:           'shared-element',
        durationFrames: 22,
        sharedElement: {
          region:      navA.region,
          regionB:     navB.region,
          elementType: 'navigation',
        },
      };
    }

    // Compute exit zoom from scene A's last camera keyframe
    const exitKf  = lastKeyframe(a.cameraTimeline.keyframes);
    const exitZoom = exitKf?.zoom ?? 1.0;

    // ── 2. Zoom-through ───────────────────────────────────────────────────
    if (primaryA && primaryB && exitZoom >= 1.4 && (primaryB.motionScore ?? 0) >= 0.70) {
      return {
        fromSceneId:    a.sceneId,
        toSceneId:      b.sceneId,
        type:           'zoom-through',
        durationFrames: 36,
        exitFocal:      regionCenter(primaryA.region),
        entryFocal:     regionCenter(primaryB.region),
      };
    }

    // ── 3. Match-cut ──────────────────────────────────────────────────────
    if (primaryA && primaryB && primaryA.elementType === primaryB.elementType) {
      return {
        fromSceneId:    a.sceneId,
        toSceneId:      b.sceneId,
        type:           'match-cut',
        durationFrames: 12,
        exitFocal:      regionCenter(primaryA.region),
        entryFocal:     regionCenter(primaryB.region),
      };
    }

    // ── 4. Dolly-reveal (high-value → table) ─────────────────────────────
    if (primaryA && primaryB &&
        (primaryA.businessValue ?? 0) > 0.85 &&
        primaryB.elementType === 'table') {
      return {
        fromSceneId:    a.sceneId,
        toSceneId:      b.sceneId,
        type:           'dolly-reveal',
        durationFrames: 45,
        entryFocal:     regionCenter(primaryB.region),
        landingTargetRegion: primaryB.region,
      };
    }

    // ── 5. Default: slide-parallax ────────────────────────────────────────
    return {
      fromSceneId:    a.sceneId,
      toSceneId:      b.sceneId,
      type:           'slide-parallax',
      durationFrames: 25,
      direction:      'left',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function lastKeyframe(kfs: { frame: number; zoom: number }[]): { zoom: number } | undefined {
  if (kfs.length === 0) return undefined;
  return kfs.reduce((prev, cur) => (cur.frame > prev.frame ? cur : prev));
}

function regionCenter(region: NormalizedRegion): Vec2 {
  return {
    x: clamp(region.x + region.width  / 2, 0.10, 0.90),
    y: clamp(region.y + region.height / 2, 0.10, 0.90),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
