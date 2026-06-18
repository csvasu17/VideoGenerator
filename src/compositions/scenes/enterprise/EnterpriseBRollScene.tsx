/**
 * EnterpriseBRollScene — cinematic problem-statement opening scene.
 *
 * Dark gradient background, large centered subtitle (the problem being solved),
 * optional industry category chip at top-left.
 */

import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { FONT_STACK } from '../../tokens';

export interface EnterpriseBRollSceneProps {
  subtitle:  string;
  category?: string;
  index:     number;
  total:     number;
}

export const EnterpriseBRollScene: React.FC<EnterpriseBRollSceneProps> = ({
  subtitle,
  category,
  index,
  total,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Fade in over 18 frames, hold, fade out over last 18
  const fadeIn  = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 18, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });
  const opacity = Math.min(fadeIn, fadeOut);

  // Subtitle slides up from 24px below
  const slideY = interpolate(
    spring({ frame, fps, config: { damping: 18, stiffness: 60 } }),
    [0, 1],
    [24, 0],
  );

  // Thin progress bar at the bottom (shows which B-roll scene we're on)
  const segmentWidth = `${(100 / total).toFixed(1)}%`;

  return (
    <AbsoluteFill
      style={{
        fontFamily: FONT_STACK,
        background: 'linear-gradient(135deg, #070f1e 0%, #0a1728 55%, #0d1e35 100%)',
        overflow: 'hidden',
      }}
    >
      {/* Subtle radial glow behind the text — no CSS filter (expensive in headless Chrome) */}
      <div
        style={{
          position:     'absolute',
          top:          '40%',
          left:         '50%',
          transform:    'translate(-50%, -50%)',
          width:         900,
          height:        500,
          background:   'radial-gradient(ellipse, rgba(10,147,211,0.18) 0%, rgba(10,147,211,0.04) 50%, transparent 70%)',
          pointerEvents:'none',
        }}
      />

      {/* Bottom gradient for subtitle readability */}
      <div
        style={{
          position:   'absolute',
          bottom:      0,
          left:        0,
          right:       0,
          height:      200,
          background: 'linear-gradient(to bottom, transparent, rgba(0,0,0,0.70))',
          pointerEvents: 'none',
        }}
      />

      {/* Subtitle — bottom center, reference style */}
      <div
        style={{
          position:  'absolute',
          bottom:     72,
          left:       80,
          right:      80,
          transform: `translateY(${slideY}px)`,
          opacity,
          textAlign: 'center',
        }}
      >
        <p
          style={{
            color:        '#ffffff',
            fontSize:      52,
            fontWeight:    600,
            lineHeight:    1.25,
            letterSpacing: '-0.5px',
            margin:         0,
            textShadow:   '0 2px 12px rgba(0,0,0,0.6)',
          }}
        >
          {subtitle}
        </p>
      </div>
    </AbsoluteFill>
  );
};
