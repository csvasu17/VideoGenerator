/**
 * CameraLayer — Remotion component that renders a CameraTimeline as a
 * CSS transform on its children.
 *
 * Usage:
 *   <CameraLayer timeline={cameraTimeline}>
 *     <Img src={...} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
 *   </CameraLayer>
 *
 * The component fills its parent absolutely, clips overflow, and applies
 * scale + translate transforms driven by the timeline keyframes.
 *
 * CSS transform formula (proven correct):
 *   transform: scale(Z) translate((0.5-focusX)*100%, (0.5-focusY)*100%)
 *   transform-origin: center center
 *
 * At any zoom Z, this pulls the focal point (focusX, focusY) to the centre
 * of the visible window.  At Z=1 with focus=(0.5, 0.5) the full image shows
 * with no translate, as expected.
 */

import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CameraKeyframe, CameraTimeline } from '../../motion/camera/types';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface CameraLayerProps {
  timeline: CameraTimeline;
  children: React.ReactNode;
}

// ─────────────────────────────────────────────────────────────────────────────
// CameraLayer
// ─────────────────────────────────────────────────────────────────────────────

export const CameraLayer: React.FC<CameraLayerProps> = ({ timeline, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { keyframes } = timeline;

  // ── Passthrough for empty timelines ──────────────────────────────────────
  if (keyframes.length === 0) {
    return <div style={{ position: 'absolute', inset: 0 }}>{children}</div>;
  }

  // ── Find bracketing keyframes ─────────────────────────────────────────────
  let before: CameraKeyframe = keyframes[0];
  let after:  CameraKeyframe = keyframes[keyframes.length - 1];

  for (let i = 0; i < keyframes.length - 1; i++) {
    if (frame >= keyframes[i].frame && frame <= keyframes[i + 1].frame) {
      before = keyframes[i];
      after  = keyframes[i + 1];
      break;
    }
  }

  // ── Compute interpolation progress ───────────────────────────────────────
  const segmentFrames = after.frame - before.frame;
  const elapsed       = frame - before.frame;

  let t: number;

  if (segmentFrames <= 0) {
    // Same frame or last keyframe: use the 'after' values directly
    t = 1;
  } else if (before.easing === 'spring' && segmentFrames >= 3) {
    // Spring easing — use Remotion's spring for smooth, physically-based motion
    const cfg = before.springConfig ?? { damping: 20, stiffness: 90 };
    t = spring({
      frame:            elapsed,
      fps,
      from:             0,
      to:               1,
      config:           cfg,
      durationInFrames: segmentFrames,
    });
  } else {
    // Linear easing (hold drift) — plain ratio, clamped
    t = Math.max(0, Math.min(1, segmentFrames > 0 ? elapsed / segmentFrames : 1));
  }

  // ── Interpolate camera values ─────────────────────────────────────────────
  const zoom   = interpolate(t, [0, 1], [before.zoom,   after.zoom  ]);
  const focusX = interpolate(t, [0, 1], [before.focusX, after.focusX]);
  const focusY = interpolate(t, [0, 1], [before.focusY, after.focusY]);

  // ── CSS transform ─────────────────────────────────────────────────────────
  // translate((0.5-focusX)*100%, (0.5-focusY)*100%) is applied in the
  // pre-scale coordinate system (scale() is listed first in the transform
  // string but applied second in the CSS matrix — right-to-left).
  // Net effect: focal point is centred in the visible window at any zoom.
  const translateX = (0.5 - focusX) * 100;
  const translateY = (0.5 - focusY) * 100;

  return (
    <div
      style={{
        position: 'absolute',
        inset:    0,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width:           '100%',
          height:          '100%',
          transform:       `scale(${zoom}) translate(${translateX}%, ${translateY}%)`,
          transformOrigin: 'center center',
          willChange:      'transform',
        }}
      >
        {children}
      </div>
    </div>
  );
};
