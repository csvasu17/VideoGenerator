/**
 * EnterpriseBRollVideoScene — B-roll using real stock video footage.
 *
 * Plays a full-screen stock video MP4 with a dark gradient at bottom
 * and a centered subtitle, matching the reference video style.
 */

import React from 'react';
import {
  AbsoluteFill,
  OffthreadVideo,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { FONT_STACK } from '../../tokens';

export interface EnterpriseBRollVideoSceneProps {
  videoPath: string;
  subtitle:  string;
  index:     number;
  total:     number;
}

export const EnterpriseBRollVideoScene: React.FC<EnterpriseBRollVideoSceneProps> = ({
  videoPath,
  subtitle,
  index,
  total,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const fadeIn  = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 18, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });
  const opacity = Math.min(fadeIn, fadeOut);

  const subEnter = spring({ frame: Math.max(0, frame - 10), fps, from: 0, to: 1, config: { damping: 18, stiffness: 60 } });
  const subY     = interpolate(subEnter, [0, 1], [20, 0]);

  return (
    <AbsoluteFill style={{ fontFamily: FONT_STACK, overflow: 'hidden', opacity }}>

      {/* Full-screen stock video */}
      <OffthreadVideo
        src={staticFile(videoPath)}
        volume={0}
        style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
      />

      {/* Dark overlay so subtitle is always readable */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.10) 50%, rgba(0,0,0,0.72) 100%)',
        pointerEvents: 'none',
      }} />

      {/* Subtitle — centered, bottom area, reference style */}
      <div style={{
        position:  'absolute',
        bottom:     72,
        left:       80,
        right:      80,
        opacity:    subEnter,
        transform: `translateY(${subY}px)`,
        textAlign: 'center',
        pointerEvents: 'none',
      }}>
        <p style={{
          color:         '#ffffff',
          fontSize:       52,
          fontWeight:     700,
          lineHeight:     1.25,
          letterSpacing: '-0.5px',
          margin:         0,
          textShadow:    '0 2px 16px rgba(0,0,0,0.8)',
        }}>
          {subtitle}
        </p>
      </div>

      {/* Scene progress dots */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: 4,
        display: 'flex', gap: 2,
      }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} style={{
            flex: 1, height: '100%',
            background: i <= index ? 'rgba(10,147,211,0.85)' : 'rgba(255,255,255,0.15)',
          }} />
        ))}
      </div>

    </AbsoluteFill>
  );
};
