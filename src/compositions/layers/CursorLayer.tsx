/**
 * CursorLayer — Phase 9
 *
 * Renders an animated mouse cursor sprite that:
 *   1. Fades in at cursorMoveStartFrame (appears at viewport edge closest to trigger)
 *   2. Moves linearly to the trigger element centre (cursorMoveStartFrame → cursorArriveFrame)
 *   3. Shows a click ripple at clickFrame (expanding ring, fades out over 15 frames)
 *   4. Fades out at transitionStartFrame
 *
 * All coordinates are viewport-normalised (0–1), rendered into 1920×1080.
 */

import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

interface NormBox { x: number; y: number; width: number; height: number; }

interface Phases {
  cursorMoveStartFrame: number;
  cursorArriveFrame:    number;
  clickFrame:           number;
  transitionStartFrame: number;
}

interface CursorLayerProps {
  /** Normalised bbox of the trigger element. null → cursor not shown. */
  triggerBBox:   NormBox | null;
  phases:        Phases;
  /** Viewport pixel dimensions. */
  viewportW?:    number;
  viewportH?:    number;
}

const CURSOR_SIZE  = 32;  // px
const RIPPLE_SIZE  = 64;  // max ripple ring px
const RIPPLE_LIFE  = 18;  // frames

// Cursor SVG path (standard arrow pointer)
const CURSOR_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <path d="M6 2 L6 26 L12 20 L16 28 L20 26 L16 18 L24 18 Z"
        fill="white" stroke="#333" stroke-width="1.5" stroke-linejoin="round"/>
</svg>
`.trim();

const CURSOR_DATA_URI = `data:image/svg+xml;base64,${btoa(CURSOR_SVG)}`;

export const CursorLayer: React.FC<CursorLayerProps> = ({
  triggerBBox,
  phases,
  viewportW = 1920,
  viewportH = 1080,
}) => {
  const frame = useCurrentFrame();

  if (!triggerBBox) return null;

  // Cursor centre in pixels
  const targetX = (triggerBBox.x + triggerBBox.width  / 2) * viewportW;
  const targetY = (triggerBBox.y + triggerBBox.height / 2) * viewportH;

  // Entry position: 150px left of the trigger (or edge of viewport)
  const startX = Math.max(80, targetX - 200);
  const startY = Math.max(80, targetY - 80);

  // ── Cursor position ──────────────────────────────────────────────────────────
  const moveProgress = interpolate(
    frame,
    [phases.cursorMoveStartFrame, phases.cursorArriveFrame],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const cursorX = startX + (targetX - startX) * easeInOut(moveProgress) - CURSOR_SIZE / 2;
  const cursorY = startY + (targetY - startY) * easeInOut(moveProgress) - CURSOR_SIZE / 4;

  // ── Cursor opacity ────────────────────────────────────────────────────────────
  const cursorOpacity = interpolate(
    frame,
    [
      phases.cursorMoveStartFrame - 4,
      phases.cursorMoveStartFrame,
      phases.transitionStartFrame,
      phases.transitionStartFrame + 6,
    ],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  // ── Ripple ────────────────────────────────────────────────────────────────────
  const rippleAge    = frame - phases.clickFrame;
  const showRipple   = rippleAge >= 0 && rippleAge < RIPPLE_LIFE;
  const rippleScale  = showRipple
    ? interpolate(rippleAge, [0, RIPPLE_LIFE], [0.2, 1.5], { extrapolateRight: 'clamp' })
    : 0;
  const rippleOpacity = showRipple
    ? interpolate(rippleAge, [0, RIPPLE_LIFE * 0.4, RIPPLE_LIFE], [0.9, 0.7, 0], { extrapolateRight: 'clamp' })
    : 0;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {/* Cursor image */}
      <img
        src={CURSOR_DATA_URI}
        style={{
          position:  'absolute',
          left:       cursorX,
          top:        cursorY,
          width:      CURSOR_SIZE,
          height:     CURSOR_SIZE,
          opacity:    cursorOpacity,
          filter:    'drop-shadow(0 2px 4px rgba(0,0,0,0.7))',
          userSelect: 'none',
        }}
      />

      {/* Click ripple ring */}
      {showRipple && (
        <div style={{
          position:     'absolute',
          left:          targetX - (RIPPLE_SIZE * rippleScale) / 2,
          top:           targetY - (RIPPLE_SIZE * rippleScale) / 2,
          width:         RIPPLE_SIZE * rippleScale,
          height:        RIPPLE_SIZE * rippleScale,
          borderRadius: '50%',
          border:       '3px solid rgba(255, 80, 60, 0.9)',
          opacity:       rippleOpacity,
          boxShadow:    '0 0 12px rgba(255, 80, 60, 0.5)',
        }} />
      )}
    </div>
  );
};

// ── Ease helper ────────────────────────────────────────────────────────────────

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}
