/**
 * AppFlowOutroScene — closing beat: pull back to the full map, show a
 * summary stats card (screen count / field count) plus the product's own
 * name/logo and tagline. Reuses TeaserOutroScene's fade/reveal idiom.
 */

import React, { useState } from 'react';
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { FONT_STACK } from '../../tokens';

export interface AppFlowOutroSceneProps {
  productName: string;
  tagline?:    string;
  screenCount: number;
  fieldCount:  number;
  logoPath?:   string;
}

export const AppFlowOutroScene: React.FC<AppFlowOutroSceneProps> = ({
  productName, tagline, screenCount, fieldCount, logoPath,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const [logoFailed, setLogoFailed] = useState(false);

  const fadeIn  = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 18, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });
  const opacity = Math.min(fadeIn, fadeOut);

  const titleSpring = spring({ frame, fps, from: 0, to: 1, config: { damping: 15, stiffness: 60 } });
  const titleScale  = interpolate(titleSpring, [0, 1], [0.85, 1]);

  const statsEnter = spring({ frame: Math.max(0, frame - 16), fps, from: 0, to: 1, config: { damping: 16 } });
  const statsY     = interpolate(statsEnter, [0, 1], [16, 0]);

  const showLogo = !!logoPath && !logoFailed;

  return (
    <AbsoluteFill style={{
      fontFamily: FONT_STACK, background: '#ffffff', opacity,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ opacity: titleSpring, transform: `scale(${titleScale})`, marginBottom: 20 }}>
        {showLogo ? (
          <Img
            src={staticFile(logoPath!)}
            style={{ height: 84, width: 'auto', objectFit: 'contain' }}
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <span style={{ fontSize: 52, fontWeight: 800, letterSpacing: '-1px', color: '#0d1b2e' }}>{productName}</span>
        )}
      </div>

      <div style={{ width: 44, height: 3, borderRadius: 2, background: 'linear-gradient(to right, #0a93d3, #059669)', marginBottom: 20, opacity: statsEnter }} />

      <div style={{ opacity: statsEnter, transform: `translateY(${statsY}px)`, display: 'flex', gap: 48 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, fontWeight: 800, color: '#0f172a' }}>{screenCount}</div>
          <div style={{ fontSize: 14, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Screens</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, fontWeight: 800, color: '#0f172a' }}>{fieldCount}</div>
          <div style={{ fontSize: 14, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Fields Mapped</div>
        </div>
      </div>

      {tagline && (
        <div style={{ opacity: statsEnter, marginTop: 24, maxWidth: 760, textAlign: 'center', padding: '0 48px' }}>
          <span style={{ color: '#334155', fontSize: 20, fontWeight: 600 }}>{tagline}</span>
        </div>
      )}
    </AbsoluteFill>
  );
};
