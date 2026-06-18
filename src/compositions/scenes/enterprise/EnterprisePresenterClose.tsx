/**
 * EnterprisePresenterClose — ACL Digital branded closing scene.
 *
 * Shows the ACL Digital logo with a 3D spin entry animation on a dark
 * gradient background, followed by the product tagline and CTA.
 * Always renders BrandedOutro (real logo + 3D animation) regardless of presenterSrc.
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

export interface EnterprisePresenterCloseProps {
  tagline:      string;
  presenterSrc: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ACL Digital 3D logo outro
// ─────────────────────────────────────────────────────────────────────────────

const BrandedOutro: React.FC<{ tagline: string }> = ({ tagline }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const [logoHidden, setLogoHidden] = useState(false);

  const fadeIn  = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 20, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });
  const opacity = Math.min(fadeIn, fadeOut);

  // 3D spin entry: rotateY from -90 → 0 over first 40 frames, then idle oscillation
  const spinSpring = spring({ frame, fps, from: 0, to: 1, config: { damping: 14, stiffness: 55 } });
  const spinEntry  = interpolate(spinSpring, [0, 1], [-90, 0]);

  // Slow idle bob after entry
  const idleBob   = Math.sin((frame / fps) * Math.PI * 0.6) * 6;
  const idleRotY  = Math.sin((frame / fps) * Math.PI * 0.3) * 4;
  const logoScale = interpolate(spinSpring, [0, 1], [0.6, 1]);

  // Tagline enters at frame 30
  const tagEnter = spring({ frame: Math.max(0, frame - 30), fps, from: 0, to: 1, config: { damping: 16 } });
  const tagY     = interpolate(tagEnter, [0, 1], [18, 0]);

  // CTA enters at frame 50
  const ctaEnter = spring({ frame: Math.max(0, frame - 50), fps, from: 0, to: 1, config: { damping: 16 } });

  // Slow rotating accent ring
  const rot = (frame / durationInFrames) * 360;

  return (
    <AbsoluteFill
      style={{
        fontFamily: FONT_STACK,
        background: 'linear-gradient(135deg, #070f1e 0%, #0a1728 55%, #0d1e35 100%)',
        overflow:   'hidden',
        opacity,
      }}
    >
      {/* Radial glow behind logo */}
      <div
        style={{
          position:  'absolute',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -60%)',
          width:      700, height: 700,
          background:'radial-gradient(ellipse, rgba(10,147,211,0.22) 0%, rgba(10,147,211,0.06) 45%, transparent 70%)',
          pointerEvents:'none',
        }}
      />

      {/* Orbiting accent ring */}
      <div
        style={{
          position:     'absolute',
          top: '50%', left: '50%',
          width:         520, height: 520,
          borderRadius: '50%',
          border:       '1px solid rgba(10,147,211,0.18)',
          transform:    `translate(-50%, -60%) rotate(${rot}deg)`,
          pointerEvents:'none',
        }}
      >
        <div style={{
          position: 'absolute', top: -5, left: '50%',
          width: 10, height: 10, borderRadius: '50%',
          background: '#0a93d3', transform: 'translateX(-50%)',
        }} />
      </div>

      {/* Top accent line */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 4,
        background: 'linear-gradient(to right, #0a93d3, #059669)',
      }} />

      {/* Centre layout */}
      <div
        style={{
          position:      'absolute',
          inset:          0,
          display:       'flex',
          flexDirection: 'column',
          alignItems:    'center',
          justifyContent:'center',
          gap:            0,
        }}
      >
        {/* ACL Digital logo — 3D spin entry + idle oscillation */}
        <div
          style={{
            opacity:   spinSpring,
            transform: `perspective(900px) rotateY(${spinEntry + idleRotY}deg) translateY(${idleBob}px) scale(${logoScale})`,
            marginBottom: 32,
          }}
        >
          {!logoHidden ? (
            <Img
              src={staticFile('assets/acl-logo.png')}
              style={{ width: 260, height: 'auto', objectFit: 'contain' }}
              onError={() => setLogoHidden(true)}
            />
          ) : (
            /* Fallback text logo if PNG missing */
            <div style={{
              padding: '14px 36px',
              background: 'linear-gradient(135deg, #0a93d3, #059669)',
              borderRadius: 12,
              boxShadow: '0 8px 32px rgba(10,147,211,0.45)',
            }}>
              <span style={{ color: '#fff', fontSize: 34, fontWeight: 800, letterSpacing: '-0.5px' }}>
                ACL Digital
              </span>
            </div>
          )}
        </div>

        {/* Divider */}
        <div style={{
          width: 48, height: 2, borderRadius: 1,
          background: 'linear-gradient(to right, #0a93d3, #059669)',
          marginBottom: 28,
          opacity: tagEnter,
        }} />

        {/* Tagline */}
        <div
          style={{
            opacity:   tagEnter,
            transform: `translateY(${tagY}px)`,
            textAlign: 'center',
            maxWidth:   760,
            padding:   '0 48px',
          }}
        >
          <p style={{
            color:         '#ffffff',
            fontSize:       46,
            fontWeight:     700,
            lineHeight:     1.2,
            letterSpacing: '-0.8px',
            margin:         0,
          }}>
            {tagline}
          </p>
        </div>

        {/* CTA */}
        <div
          style={{
            opacity:   ctaEnter,
            marginTop: 44,
            display:  'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
          }}
        >
          <div style={{
            padding:      '14px 44px',
            background:   'linear-gradient(to right, #0a93d3, #059669)',
            borderRadius:  8,
            color:        '#ffffff', fontSize: 18, fontWeight: 700,
            letterSpacing:'-0.1px',
            boxShadow:    '0 4px 20px rgba(10,147,211,0.35)',
          }}>
            Schedule your live demonstration
          </div>
          <span style={{ color: 'rgba(255,255,255,0.42)', fontSize: 14 }}>
            Contact us at acl-digital.com
          </span>
        </div>
      </div>

      {/* Bottom progress bar */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: 4,
        background: 'rgba(255,255,255,0.06)',
      }}>
        <div style={{
          height: '100%',
          width: `${Math.min(100, (frame / durationInFrames) * 100)}%`,
          background: 'rgba(10,147,211,0.60)',
        }} />
      </div>
    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Public component
// ─────────────────────────────────────────────────────────────────────────────

export const EnterprisePresenterClose: React.FC<EnterprisePresenterCloseProps> = ({
  tagline,
}) => {
  return <BrandedOutro tagline={tagline} />;
};
