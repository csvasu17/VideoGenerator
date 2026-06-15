/**
 * HighlightRingLayer — Phase 9
 *
 * Renders a pulsing highlight ring around the primary change region after the
 * crossfade completes.
 *
 * Sequence:
 *   1. At outcomeZoomFrame: ring appears (scale 0.5 → 1.0) with a spring bounce
 *   2. After calloutFrame: callout label appears below/above the ring
 *   3. Ring continuously pulses (opacity cycles 0.7 → 1.0) until scene end
 */

import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

interface NormBox { x: number; y: number; width: number; height: number; }

interface HighlightRingLayerProps {
  changeRegion:    NormBox | null;
  calloutText:     string;
  outcomeZoomFrame: number;
  calloutFrame:    number;
  viewportW?:      number;
  viewportH?:      number;
  /** Accent colour for the ring. Default: #FF3C2B */
  accentColor?:    string;
}

export const HighlightRingLayer: React.FC<HighlightRingLayerProps> = ({
  changeRegion,
  calloutText,
  outcomeZoomFrame,
  calloutFrame,
  viewportW = 1920,
  viewportH = 1080,
  accentColor = '#FF3C2B',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!changeRegion) return null;
  if (frame < outcomeZoomFrame) return null;

  // Pixel coordinates of the change region
  const rx = changeRegion.x      * viewportW;
  const ry = changeRegion.y      * viewportH;
  const rw = changeRegion.width  * viewportW;
  const rh = changeRegion.height * viewportH;

  // Padding around the region
  const pad = 18;

  // Spring-based appear animation
  const ageFrames = frame - outcomeZoomFrame;
  const ringScale = spring({
    frame: ageFrames,
    fps,
    from:  0.4,
    to:    1.0,
    config: { damping: 14, stiffness: 120 },
  });

  const ringOpacity = interpolate(
    ageFrames,
    [0, 8],
    [0, 0.9],
    { extrapolateRight: 'clamp' },
  );

  // Pulse: subtle opacity oscillation
  const pulse = 0.75 + 0.25 * Math.sin((ageFrames / fps) * Math.PI * 2);
  const finalOpacity = ringOpacity * pulse;

  // Callout label visibility
  const calloutOpacity = interpolate(
    frame,
    [calloutFrame, calloutFrame + 8],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const ringW = (rw + pad * 2);
  const ringH = (rh + pad * 2);
  const ringX = rx - pad - (ringW * (1 - ringScale)) / 2;
  const ringY = ry - pad - (ringH * (1 - ringScale)) / 2;

  // Callout position: prefer below, fall back to above if near bottom
  const calloutBelow = (ry + rh + pad + 60) < viewportH;
  const calloutY     = calloutBelow
    ? ry + rh + pad + 8
    : ry - pad - 56;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {/* Highlight ring */}
      <div style={{
        position:     'absolute',
        left:          ringX,
        top:           ringY,
        width:         ringW * ringScale,
        height:        ringH * ringScale,
        borderRadius:  10,
        border:       `3px solid ${accentColor}`,
        boxShadow:    `0 0 24px ${accentColor}88, inset 0 0 12px ${accentColor}22`,
        opacity:       finalOpacity,
        transform:    'translateZ(0)',
      }} />

      {/* Callout label */}
      {calloutText && calloutOpacity > 0 && (
        <div style={{
          position:     'absolute',
          left:          rx - pad,
          top:           calloutY,
          background:   `${accentColor}EE`,
          color:        '#fff',
          fontSize:      20,
          fontWeight:    700,
          padding:      '6px 14px',
          borderRadius:  8,
          maxWidth:      Math.min(rw + pad * 4, 480),
          whiteSpace:   'nowrap',
          overflow:     'hidden',
          textOverflow: 'ellipsis',
          opacity:       calloutOpacity,
          boxShadow:    '0 4px 16px rgba(0,0,0,0.5)',
          letterSpacing: '-0.2px',
        }}>
          {calloutText}
        </div>
      )}
    </div>
  );
};
