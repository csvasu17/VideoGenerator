/**
 * Motion profiles — deterministic lookup tables that drive CameraChoreographer.
 *
 * CAMERA_PROFILES:   per-ElementType motion parameters
 * CANONICAL_REGIONS: fallback focal points when no BoundingBox is provided
 */

import type { ElementType } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// MotionProfile
// ─────────────────────────────────────────────────────────────────────────────

export interface MotionProfile {
  /** Minimum zoom level (at priority = 0). */
  zoomMin:        number;
  /** Maximum zoom level (at priority = 1). */
  zoomMax:        number;
  /** Frames spent moving from full context to the focal point. */
  approachFrames: number;
  /**
   * Fraction of the total scene duration spent at the target zoom.
   * Remaining frames are split between context (start) and return (end).
   */
  holdPct:        number;
  /**
   * Slow drift applied to focusX across the hold phase (signed fraction of
   * the product window width).  Positive = drift right, negative = drift left.
   */
  driftX:         number;
  /**
   * Slow drift applied to focusY across the hold phase.
   * Positive = drift down, negative = drift up.
   */
  driftY:         number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile table
// ─────────────────────────────────────────────────────────────────────────────

export const CAMERA_PROFILES: Record<ElementType, MotionProfile> = {
  // ── Phase 2–6 profiles (unchanged) ────────────────────────────────────────
  kpi_card:   { zoomMin: 1.4,  zoomMax: 1.6,  approachFrames: 25, holdPct: 0.70, driftX:  0.00, driftY:  0.00 },
  chart:      { zoomMin: 1.3,  zoomMax: 1.5,  approachFrames: 30, holdPct: 0.65, driftX:  0.02, driftY:  0.00 },
  button:     { zoomMin: 1.5,  zoomMax: 1.7,  approachFrames: 20, holdPct: 0.60, driftX:  0.00, driftY:  0.00 },
  table:      { zoomMin: 1.2,  zoomMax: 1.4,  approachFrames: 30, holdPct: 0.70, driftX:  0.00, driftY:  0.03 },
  navigation: { zoomMin: 1.2,  zoomMax: 1.3,  approachFrames: 25, holdPct: 0.75, driftX:  0.02, driftY:  0.00 },
  form:       { zoomMin: 1.3,  zoomMax: 1.5,  approachFrames: 25, holdPct: 0.65, driftX:  0.00, driftY:  0.00 },
  // 'default' → enhanced Ken-Burns; approach/hold/return phases not used
  default:    { zoomMin: 1.00, zoomMax: 1.10, approachFrames:  0, holdPct: 1.00, driftX:  0.00, driftY:  0.00 },

  // ── Phase 7 additions ─────────────────────────────────────────────────────
  // alert: urgency aesthetic — fast approach, tight zoom, no drift
  alert:      { zoomMin: 1.45, zoomMax: 1.65, approachFrames: 20, holdPct: 0.60, driftX:  0.00, driftY:  0.00 },
  // metric: slightly more zoom than kpi_card for solo stat readability
  metric:     { zoomMin: 1.50, zoomMax: 1.70, approachFrames: 22, holdPct: 0.65, driftX:  0.00, driftY:  0.00 },
  // modal: fills much of the screen — moderate zoom to keep context visible
  modal:      { zoomMin: 1.30, zoomMax: 1.55, approachFrames: 28, holdPct: 0.70, driftX:  0.00, driftY:  0.00 },
  // map: slow orbital arc — positive driftX simulates a pan across geography
  map:        { zoomMin: 1.10, zoomMax: 1.30, approachFrames: 40, holdPct: 0.70, driftX:  0.03, driftY:  0.01 },
  // list: gentle downward drift simulates a "scroll preview"
  list:       { zoomMin: 1.15, zoomMax: 1.30, approachFrames: 25, holdPct: 0.70, driftX:  0.00, driftY:  0.02 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Canonical screen regions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default focal point used when no BoundingBox is provided.
 * Based on common SaaS UI layout conventions.
 */
export const CANONICAL_REGIONS: Record<ElementType, { focusX: number; focusY: number }> = {
  // ── Phase 2–6 regions (unchanged) ─────────────────────────────────────────
  kpi_card:   { focusX: 0.25, focusY: 0.20 },  // top-left quadrant
  chart:      { focusX: 0.50, focusY: 0.45 },  // centre
  button:     { focusX: 0.50, focusY: 0.80 },  // lower centre
  table:      { focusX: 0.50, focusY: 0.40 },  // centre, near top
  navigation: { focusX: 0.15, focusY: 0.50 },  // left sidebar
  form:       { focusX: 0.50, focusY: 0.35 },  // upper centre
  default:    { focusX: 0.50, focusY: 0.50 },  // dead centre

  // ── Phase 7 additions ─────────────────────────────────────────────────────
  alert:      { focusX: 0.50, focusY: 0.25 },  // alerts typically appear near top
  metric:     { focusX: 0.75, focusY: 0.20 },  // standalone metrics often top-right
  modal:      { focusX: 0.50, focusY: 0.45 },  // modal centred in viewport
  map:        { focusX: 0.50, focusY: 0.55 },  // map slightly below centre
  list:       { focusX: 0.50, focusY: 0.35 },  // list near top, centre
};
