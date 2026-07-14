/**
 * TeaserOutroScene — closing scene revealing the target app's own identity.
 *
 * Adapted from EnterprisePresenterClose's spring-driven logo-reveal animation,
 * but generic: renders the client app's product name as a styled wordmark (or
 * an optional client logo image, if supplied) plus a short tagline, instead of
 * a hardcoded ACL Digital asset. The small "Powered by ACL Digital" watermark
 * lives separately in TeaserVideo.tsx (persistent corner mark, same mechanism
 * EnterpriseVideo already uses), so this scene stays fully white-label per app.
 */

import React, { useState } from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { FONT_STACK } from '../../tokens';

export interface TeaserOutroSceneProps {
  productName: string;
  tagline:     string;
  logoPath?:   string;
}

export const TeaserOutroScene: React.FC<TeaserOutroSceneProps> = ({
  productName,
  tagline,
  logoPath,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const [logoFailed, setLogoFailed] = useState(false);

  const fadeIn  = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 18, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });
  const opacity = Math.min(fadeIn, fadeOut);

  // Draw-in entry: scale + fade, matching the reference's logo-reveal beat
  const logoSpring = spring({ frame, fps, from: 0, to: 1, config: { damping: 15, stiffness: 60 } });
  const logoScale  = interpolate(logoSpring, [0, 1], [0.7, 1]);

  const tagEnter = spring({ frame: Math.max(0, frame - 22), fps, from: 0, to: 1, config: { damping: 16 } });
  const tagY     = interpolate(tagEnter, [0, 1], [16, 0]);

  const showImageLogo = !!logoPath && !logoFailed;

  return (
    <AbsoluteFill
      style={{
        fontFamily: FONT_STACK,
        background: '#ffffff',
        overflow:   'hidden',
        opacity,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {/* Subtle radial tint behind the mark */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -55%)',
        width: 620, height: 620,
        background: 'radial-gradient(ellipse, rgba(10,147,211,0.08) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div style={{ opacity: logoSpring, transform: `scale(${logoScale})`, marginBottom: 30 }}>
        {showImageLogo ? (
          <Img
            src={staticFile(logoPath!)}
            style={{ height: 88, width: 'auto', objectFit: 'contain' }}
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <span style={{ fontSize: 56, fontWeight: 800, letterSpacing: '-1px', color: '#0d1b2e' }}>
            {productName}
          </span>
        )}
      </div>

      <div style={{
        width: 44, height: 3, borderRadius: 2,
        background: 'linear-gradient(to right, #0a93d3, #059669)',
        marginBottom: 22, opacity: tagEnter,
      }} />

      <div style={{ opacity: tagEnter, transform: `translateY(${tagY}px)`, textAlign: 'center', maxWidth: 760, padding: '0 48px' }}>
        <p style={{ color: '#334155', fontSize: 26, fontWeight: 600, lineHeight: 1.3, letterSpacing: '-0.2px', margin: 0 }}>
          {tagline}
        </p>
      </div>
    </AbsoluteFill>
  );
};
