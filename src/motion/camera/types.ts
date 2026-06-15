/**
 * Camera motion domain types for the Motion Design Engine — Phase 2.
 *
 * All bounding boxes and focal points are normalized to [0, 1] relative to
 * the product window dimensions.  The CameraChoreographer consumes these types
 * to produce a deterministic CameraTimeline; the CameraLayer renders it.
 */

import type { CameraIntent } from '../../core/domain/entities/SalesStory';

// ─────────────────────────────────────────────────────────────────────────────
// ElementType
// ─────────────────────────────────────────────────────────────────────────────

/**
 * UI element classification that drives the motion profile lookup.
 * 'default' falls back to an enhanced Ken-Burns when no element is identified.
 *
 * Phase 7 additions: alert | metric | modal | map | list
 */
export type ElementType =
  | 'kpi_card'
  | 'chart'
  | 'button'
  | 'table'
  | 'navigation'
  | 'form'
  | 'default'
  // Phase 7 — additional UI element types for richer motion profiles
  | 'alert'       // notification/alarm feed, status badge — fast tight zoom
  | 'metric'      // standalone stat (looser than kpi_card) — tight zoom
  | 'modal'       // overlay dialog — moderate zoom to preserve context
  | 'map'         // geographic or floor-plan visualisation — slow orbital drift
  | 'list';       // unstructured list — gentle downward drift

// ─────────────────────────────────────────────────────────────────────────────
// BoundingBox
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalized bounding box within the product window.
 * All values are fractions of the product window width / height, in [0, 1].
 */
export interface BoundingBox {
  x:      number;  // left edge fraction
  y:      number;  // top edge fraction
  width:  number;  // width fraction
  height: number;  // height fraction
}

// ─────────────────────────────────────────────────────────────────────────────
// SpotlightTarget
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The UI element the camera should focus on in this scene.
 *
 * boundingBox is optional in Phase 2 — when absent the choreographer uses
 * the canonical region for the elementType.  Full bbox wiring from the
 * vision analysis agent is a Phase 3 concern.
 */
export interface SpotlightTarget {
  elementType:  ElementType;
  boundingBox?: BoundingBox;
  label?:       string;   // human-readable, for debug / logging
  /** 0–1.  Drives zoom intensity within the profile range. */
  priority:     number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CameraKeyframe
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single point on the camera timeline.
 *
 * focusX / focusY define the point in [0, 1] product-window space that should
 * be pulled toward the centre of the visible window at the given zoom level.
 * At zoom=1.0, focus values are ignored (full view).
 *
 * springConfig allows per-keyframe spring tuning:
 *   – Approach:  damping=20, stiffness=90  (responsive)
 *   – Return:    damping=22, stiffness=60  (slow, cinematic)
 */
export interface CameraKeyframe {
  frame:         number;             // frame within the scene, 0-based
  zoom:          number;             // 1.0 = full view, 2.0 = 2× magnification
  focusX:        number;             // focal point X in [0, 1]
  focusY:        number;             // focal point Y in [0, 1]
  easing:        'spring' | 'linear';
  springConfig?: { damping: number; stiffness: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// CameraTimeline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The complete camera specification for one scene.
 * Keyframes are sorted ascending by frame number.
 */
export interface CameraTimeline {
  sceneId:          string;
  durationInFrames: number;
  keyframes:        CameraKeyframe[];
  spotlightTarget?: SpotlightTarget;  // echoed from input, for debug / logging
}

// ─────────────────────────────────────────────────────────────────────────────
// CameraChoreographyInput
// ─────────────────────────────────────────────────────────────────────────────

export interface CameraChoreographyInput {
  sceneId:          string;
  durationInFrames: number;
  fps:              number;
  spotlightTarget?: SpotlightTarget;
  /**
   * Phase 8: per-scene camera direction from the Sales Story Director.
   * When present and strategy === 'proof_focus', overrides the focal point
   * with the proof element's bounding box and applies the endZoom / proofPop.
   * When absent, existing behaviour is unchanged (backward-compatible).
   */
  cameraIntent?:    CameraIntent;
}

// Re-export CameraIntent so callers can import from one place
export type { CameraIntent };

// ─────────────────────────────────────────────────────────────────────────────
// Phase 7: AttentionPhase + CameraBeatRange + ExtendedCameraTimeline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Named phases of a multi-beat camera sequence.
 * Used by CameraBeatRange (camera) and AttentionBeat (attention) to stay in sync.
 */
export type AttentionPhase =
  | 'context'            // full-view opening — establish layout
  | 'approach'           // camera moving toward primary target
  | 'hold-primary'       // camera settled on primary target
  | 'pan-to-secondary'   // camera moving to optional secondary target
  | 'hold-secondary'     // camera settled on secondary target
  | 'return';            // soft pull-back before scene ends / transition begins

/**
 * Named segment on a CameraTimeline mapping a frame range to an AttentionPhase.
 * Consumed by CalloutLayer to time callout enter/exit animations.
 */
export interface CameraBeatRange {
  beatId:     string;        // matches AttentionBeat.id
  phase:      AttentionPhase;
  startFrame: number;        // scene-relative, inclusive
  endFrame:   number;        // scene-relative, inclusive
}

/**
 * Phase 7 extension of CameraTimeline.
 * Adds named beat ranges so CalloutLayer and AttentionRingLayer know
 * when the camera arrives at and departs from each target.
 *
 * Backward-compatible: CameraLayer consumes only keyframes[] — beats are ignored
 * by the existing renderer.
 */
export interface ExtendedCameraTimeline extends CameraTimeline {
  beats: CameraBeatRange[];
}
