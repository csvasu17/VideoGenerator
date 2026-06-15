/**
 * AttentionRingLayer — renders a soft animated ring/pulse around the primary
 * attention target when the camera is in the 'hold-primary' beat.
 *
 * Appearance:
 *   - Outer ring: border 1.5px with accent color at 45% opacity
 *   - Inner glow: box-shadow at 20% opacity
 *   - Pulse: ring scales 1.0→1.04→1.0 over a 2s cycle
 *   - Visible only during hold-primary beat; fades in/out over ~15 frames
 *
 * Positioned absolutely inside the product window.
 * z-index 2 — above screenshot, below callouts and vignette.
 *
 * Phase 7 — optional layer. When no motionPlan is present, renders nothing.
 */

import React from 'react';
import { useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';
import type { ExtendedCameraTimeline } from '../../motion/camera/types';
import type { AttentionMap }           from '../../motion/attention/types';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface AttentionRingLayerProps {
  cameraTimeline: ExtendedCameraTimeline;
  attentionMap:   AttentionMap;
  accentColor:    string;
}

// ─────────────────────────────────────────────────────────────────────────────
// AttentionRingLayer
// ─────────────────────────────────────────────────────────────────────────────

export const AttentionRingLayer: React.FC<AttentionRingLayerProps> = ({
  cameraTimeline,
  attentionMap,
  accentColor,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const primary = attentionMap.targets[0];
  if (!primary) return null;

  // Find the hold-primary beat
  const holdBeat = cameraTimeline.beats.find(b => b.phase === 'hold-primary');
  if (!holdBeat) return null;

  // Visibility: fade in over 15 frames after beat start, fade out over 10 before beat end
  const FADE_IN  = 15;
  const FADE_OUT = 10;

  const frameInBeat = frame - holdBeat.startFrame;
  if (frameInBeat < 0 || frame > holdBeat.endFrame + FADE_OUT) return null;

  let opacity = 0;
  if (frameInBeat < FADE_IN) {
    opacity = frameInBeat / FADE_IN;
  } else if (frame > holdBeat.endFrame - FADE_OUT) {
    opacity = Math.max(0, (holdBeat.endFrame - frame) / FADE_OUT);
  } else {
    opacity = 1;
  }

  // Pulse: scale oscillation over a 2s cycle using a sine approximation
  const PULSE_CYCLE = fps * 2;
  const pulsePhase  = (frame % PULSE_CYCLE) / PULSE_CYCLE;
  // sin approximation: 0→1→0 over the cycle
  const pulseScale  = 1.0 + 0.04 * Math.sin(pulsePhase * Math.PI * 2);

  // Convert normalized region to percentage for absolute positioning
  const r = primary.region;
  const left   = `${r.x * 100}%`;
  const top    = `${r.y * 100}%`;
  const width  = `${r.width * 100}%`;
  const height = `${r.height * 100}%`;

  return (
    <div
      style={{
        position:      'absolute',
        left,
        top,
        width,
        height,
        borderRadius:   8,
        border:         `1.5px solid ${accentColor}`,
        boxShadow:      `0 0 24px ${accentColor}33, inset 0 0 12px ${accentColor}14`,
        opacity:        opacity * 0.65,
        transform:      `scale(${pulseScale})`,
        transformOrigin:'center center',
        pointerEvents: 'none',
        zIndex:         2,
        willChange:    'opacity, transform',
      }}
    />
  );
};
