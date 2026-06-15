/**
 * CameraChoreographer — deterministic, frame-accurate camera timeline generator.
 *
 * No LLM, no I/O, no async.  Pure geometry + motion profile lookup.
 *
 * Takes a scene description (duration, fps) and an optional SpotlightTarget,
 * and returns a CameraTimeline (sorted keyframes) that CameraLayer renders.
 *
 * Motion phases for a spotlight scene:
 *   A. Context   (0 → contextEnd)   zoom=1.0, centred  — establish full layout
 *   B. Approach  (contextEnd → approachEnd)  zoom 1.0→target, pan to focal point
 *   C. Hold      (approachEnd → holdEnd)     zoom locked, optional slow drift
 *   D. Return    (holdEnd → last frame)       soft pull-back toward neutral
 *
 * Without a SpotlightTarget → enhanced Ken-Burns (zoom 1.0→1.10, centred).
 *
 * Phase 8 addition: optional `cameraIntent` from SalesStoryDirectorStage.
 *   - strategy 'proof_focus': overrides focal point + endZoom from SceneGoal bbox
 *   - strategy 'page_overview': forces Ken-Burns regardless of spotlightTarget
 *   - proofPopAtSec: inserts a brief tight zoom at that second, then eases back
 */

import type {
  CameraChoreographyInput,
  CameraKeyframe,
  CameraTimeline,
  SpotlightTarget,
} from './types';
import type { CameraIntent } from '../../core/domain/entities/SalesStory';
import { CAMERA_PROFILES, CANONICAL_REGIONS } from './CameraProfiles';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MAX_ZOOM    = 2.0;   // hard ceiling — never exceed the 2× screenshot budget
const MIN_ZOOM    = 1.0;   // never zoom out beyond full view
const FOCUS_MIN   = 0.10;  // prevent camera from pulling into empty border
const FOCUS_MAX   = 0.90;

// Spring configs: approach is responsive, return is slow and cinematic
const SPRING_APPROACH = { damping: 20, stiffness: 90 };
const SPRING_RETURN   = { damping: 22, stiffness: 60 };

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

// ─────────────────────────────────────────────────────────────────────────────
// CameraChoreographer
// ─────────────────────────────────────────────────────────────────────────────

export class CameraChoreographer {
  /**
   * Produce a CameraTimeline for the given scene.
   *
   * Phase 2: spotlightTarget is typically undefined (no bbox wiring yet).
   * The choreographer falls back to an enhanced Ken-Burns profile.
   * Phase 3: spotlightTarget will carry elementType + boundingBox from the
   * vision analysis stage, enabling precise element-focused camera work.
   * Phase 8: cameraIntent overrides focal point and zoom when strategy is
   * 'proof_focus'; triggers a proof-pop keyframe at proofPopAtSec.
   */
  choreograph(input: CameraChoreographyInput): CameraTimeline {
    const { sceneId, durationInFrames, fps, spotlightTarget, cameraIntent } = input;

    // ── Phase 8: 'page_overview' → always Ken-Burns ───────────────────────
    if (cameraIntent?.strategy === 'page_overview') {
      return this.kenBurnsTimeline(sceneId, durationInFrames, spotlightTarget);
    }

    // ── No spotlight or explicit default → Ken-Burns / intent zoom ────────
    if (!spotlightTarget || spotlightTarget.elementType === 'default') {
      if (cameraIntent?.endZoom || cameraIntent?.zoomTarget) {
        return this.intentKenBurns(sceneId, durationInFrames, cameraIntent, spotlightTarget);
      }
      return this.kenBurnsTimeline(sceneId, durationInFrames, spotlightTarget);
    }

    const profile   = { ...CAMERA_PROFILES[spotlightTarget.elementType] };
    const canonical = CANONICAL_REGIONS[spotlightTarget.elementType];

    // ── Derive focal point ────────────────────────────────────────────────
    let focusX: number;
    let focusY: number;

    if (spotlightTarget.boundingBox) {
      const bb = spotlightTarget.boundingBox;
      focusX = clamp(bb.x + bb.width  / 2, FOCUS_MIN, FOCUS_MAX);
      focusY = clamp(bb.y + bb.height / 2, FOCUS_MIN, FOCUS_MAX);

      // Large elements fill most of the window — aggressive zoom wastes it
      const area = bb.width * bb.height;
      if (area > 0.50) profile.zoomMax = Math.min(profile.zoomMax, 1.2);

      // ── Edge-safe zoom cap ──────────────────────────────────────────────
      // When the focal point is far from screen centre, deep zoom causes the
      // camera to clip the image boundary (the opposite edge disappears from
      // view) AND creates jarring left/right sweeps across scenes.
      //
      // For a focal point at offset d from 0.5, the visible window at zoom Z
      // clips when:  |focusX - 0.5| + 0.5/Z > 0.5  →  Z > 0.5 / |focusX-0.5|
      //
      // Cap zoom to 88% of that boundary (cushion) so content always shows.
      const maxEdgeDist = Math.max(Math.abs(focusX - 0.5), Math.abs(focusY - 0.5));
      if (maxEdgeDist > 0.05) {
        const edgeSafeCap = Math.max(1.05, (0.5 / maxEdgeDist) * 0.88);
        profile.zoomMax = Math.min(profile.zoomMax, edgeSafeCap);
        profile.zoomMin = Math.min(profile.zoomMin, edgeSafeCap);
      }

      // Panel-height cap: elements taller than 55% of the screen are
      // full-height panels, not widgets. Zooming >1.20× into a panel
      // chops off the opposite side of the dashboard.
      if (bb.height > 0.55) {
        profile.zoomMax = Math.min(profile.zoomMax, 1.20);
        profile.zoomMin = Math.min(profile.zoomMin, 1.20);
      }
    } else {
      focusX = canonical.focusX;
      focusY = canonical.focusY;
    }

    // ── Phase 8: override focal point from cameraIntent.zoomTarget ────────
    if (cameraIntent?.strategy === 'proof_focus' && cameraIntent.zoomTarget) {
      const bb = cameraIntent.zoomTarget;
      focusX = clamp(bb.x + bb.width  / 2, FOCUS_MIN, FOCUS_MAX);
      focusY = clamp(bb.y + bb.height / 2, FOCUS_MIN, FOCUS_MAX);
    }

    // ── Target zoom from priority (or cameraIntent override) ─────────────
    const priority = clamp(spotlightTarget.priority, 0, 1);
    let targetZoom: number;

    if (cameraIntent?.endZoom) {
      // Phase 8: use the story-priority-scaled endZoom directly
      targetZoom = clamp(cameraIntent.endZoom, MIN_ZOOM, MAX_ZOOM);
    } else {
      targetZoom = clamp(
        lerp(profile.zoomMin, profile.zoomMax, priority),
        MIN_ZOOM, MAX_ZOOM,
      );
    }

    // ── Clamp focus to safe visible range ─────────────────────────────────
    // At zoom Z the visible window spans 1/Z of the image.
    // Safe range: focusX ∈ [0.5/Z, 1 - 0.5/Z]  (no edge clip on either side).
    // Apply a 1% inset so we never sit right on the boundary.
    {
      const halfView = 0.5 / targetZoom;
      const safeMin  = halfView + 0.01;
      const safeMax  = 1.0 - halfView - 0.01;
      // Guard: safeMin < safeMax is always true for Z > 1.02
      if (safeMin < safeMax) {
        focusX = clamp(focusX, safeMin, safeMax);
        focusY = clamp(focusY, safeMin, safeMax);
      }
    }

    // ── Phase sizing ──────────────────────────────────────────────────────
    // Context: ~400 ms of full-view before the camera moves
    const contextEnd  = Math.max(10, Math.round(fps * 0.4));
    const approachEnd = contextEnd + profile.approachFrames;
    const holdEnd     = Math.max(approachEnd + 10, Math.round(durationInFrames * profile.holdPct));

    // Safety: very short scenes get a simplified timeline
    if (durationInFrames < 60) {
      return {
        sceneId, durationInFrames, spotlightTarget,
        keyframes: [
          kf(0,                    1.05, 0.5,    0.5,    'spring', SPRING_APPROACH),
          kf(durationInFrames - 1, 1.05, focusX, focusY, 'spring', SPRING_APPROACH),
        ],
      };
    }

    const keyframes: CameraKeyframe[] = [];

    // ── Phase A: Context ──────────────────────────────────────────────────
    keyframes.push(kf(0,           1.0, 0.5, 0.5, 'spring', SPRING_APPROACH));
    keyframes.push(kf(contextEnd,  1.0, 0.5, 0.5, 'spring', SPRING_APPROACH));

    // ── Phase B: Approach ─────────────────────────────────────────────────
    keyframes.push(kf(approachEnd, targetZoom, focusX, focusY, 'spring', SPRING_APPROACH));

    // ── Phase C: Hold (with optional slow drift) ──────────────────────────
    if (holdEnd > approachEnd) {
      const holdMid = Math.round((approachEnd + holdEnd) / 2);

      keyframes.push(kf(
        holdMid, targetZoom,
        clamp(focusX + profile.driftX * 0.5, FOCUS_MIN, FOCUS_MAX),
        clamp(focusY + profile.driftY * 0.5, FOCUS_MIN, FOCUS_MAX),
        'linear',
      ));

      keyframes.push(kf(
        holdEnd, targetZoom,
        clamp(focusX + profile.driftX, FOCUS_MIN, FOCUS_MAX),
        clamp(focusY + profile.driftY, FOCUS_MIN, FOCUS_MAX),
        'linear',
      ));
    }

    // ── Phase 8: ProofPop ─────────────────────────────────────────────────
    // Brief tight zoom-in to the proof element at the specified second, then
    // ease back to the hold zoom level.  The "product reveal" beat from
    // Linear/Stripe-style demos — creates an intentional visual "aha moment".
    if (cameraIntent?.proofPopAtSec != null) {
      const popFrame     = Math.round(cameraIntent.proofPopAtSec * fps);
      const snapBackFrame = Math.min(
        popFrame + Math.round(fps * 0.5),   // ~500ms snap-back
        durationInFrames - 2,
      );

      if (popFrame > approachEnd && popFrame < holdEnd) {
        const popZoom = Math.min(targetZoom * 1.15, MAX_ZOOM);
        keyframes.push(kf(popFrame,      popZoom,    focusX, focusY, 'spring', SPRING_APPROACH));
        keyframes.push(kf(snapBackFrame, targetZoom, focusX, focusY, 'spring', SPRING_RETURN));
      }
    }

    // ── Phase D: Return ───────────────────────────────────────────────────
    // Soft pull-back to ~85% of peak zoom; re-centre partially.
    const returnZoom   = clamp(targetZoom * 0.85, MIN_ZOOM, MAX_ZOOM);
    const returnFocusX = clamp((focusX + 0.5) / 2, FOCUS_MIN, FOCUS_MAX);
    const returnFocusY = clamp((focusY + 0.5) / 2, FOCUS_MIN, FOCUS_MAX);

    keyframes.push(kf(
      durationInFrames - 1, returnZoom, returnFocusX, returnFocusY,
      'spring', SPRING_RETURN,
    ));

    return { sceneId, durationInFrames, keyframes, spotlightTarget };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Enhanced Ken-Burns: gentle zoom 1.0→1.10 across the full scene, centred.
   * Used when no spotlight target is provided (Phase 2 default).
   */
  private kenBurnsTimeline(
    sceneId:          string,
    durationInFrames: number,
    spotlightTarget?: SpotlightTarget,
  ): CameraTimeline {
    return {
      sceneId, durationInFrames, spotlightTarget,
      keyframes: [
        kf(0,                    1.00, 0.5, 0.5, 'spring', SPRING_APPROACH),
        kf(durationInFrames - 1, 1.10, 0.5, 0.5, 'linear'),
      ],
    };
  }

  /**
   * Phase 8: Ken-Burns with cameraIntent endZoom and optional zoomTarget focus.
   * Used when we have a CameraIntent but no SpotlightTarget (e.g. proof_focus
   * with a validated bbox but no elementType match from vision analysis).
   */
  private intentKenBurns(
    sceneId:          string,
    durationInFrames: number,
    intent:           CameraIntent,
    spotlightTarget?: SpotlightTarget,
  ): CameraTimeline {
    const endZoom = clamp(intent.endZoom || 1.10, MIN_ZOOM, MAX_ZOOM);
    let focusX = 0.5;
    let focusY = 0.5;

    if (intent.zoomTarget) {
      const bb = intent.zoomTarget;
      focusX = clamp(bb.x + bb.width  / 2, FOCUS_MIN, FOCUS_MAX);
      focusY = clamp(bb.y + bb.height / 2, FOCUS_MIN, FOCUS_MAX);
    }

    return {
      sceneId, durationInFrames, spotlightTarget,
      keyframes: [
        kf(0,                    1.00,    0.5,    0.5,    'spring', SPRING_APPROACH),
        kf(durationInFrames - 1, endZoom, focusX, focusY, 'linear'),
      ],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Builder helper
// ─────────────────────────────────────────────────────────────────────────────

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
