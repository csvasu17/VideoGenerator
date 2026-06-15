/**
 * EnterprisePresenterClose — cinematic branded closing scene.
 *
 * Matches the dark style of the B-roll opening: same deep navy gradient, same
 * teal accent colour.  When a real presenter photo is supplied it appears large
 * and centred; otherwise the scene falls back to a full-screen branded card
 * (product name, tagline, CTA) that looks equally polished.
 *
 * The "default" placeholder path ('assets/presenter/presenter-default.png') is
 * intentionally treated the same as "no photo" so the branded fallback always
 * renders rather than showing a transparent PNG.
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

const DEFAULT_PLACEHOLDER = 'assets/presenter/presenter-default.png';

// ─────────────────────────────────────────────────────────────────────────────
// Branded outro (no presenter photo)
// ─────────────────────────────────────────────────────────────────────────────

const BrandedOutro: React.FC<{ tagline: string }> = ({ tagline }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const fadeIn  = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 20, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });
  const opacity = Math.min(fadeIn, fadeOut);

  // Logo mark enters first
  const logoEnter = spring({ frame, fps, from: 0, to: 1, config: { damping: 18, stiffness: 70 } });
  const logoY = interpolate(logoEnter, [0, 1], [30, 0]);

  // Tagline appears 16 frames later
  const tagEnter = spring({ frame: Math.max(0, frame - 16), fps, from: 0, to: 1, config: { damping: 16 } });
  const tagY = interpolate(tagEnter, [0, 1], [16, 0]);

  // CTA line appears 28 frames later
  const ctaEnter = spring({ frame: Math.max(0, frame - 28), fps, from: 0, to: 1, config: { damping: 16 } });

  // Animated orbiting dots (decorative background)
  const rot = (frame / durationInFrames) * 360;

  return (
    <AbsoluteFill
      style={{
        fontFamily:     FONT_STACK,
        background:    'linear-gradient(135deg, #070f1e 0%, #0a1728 55%, #0d1e35 100%)',
        overflow:      'hidden',
        opacity,
      }}
    >
      {/* Animated radial glow — centred, slowly pulsing */}
      <div
        style={{
          position:   'absolute',
          top:        '50%', left: '50%',
          transform:  'translate(-50%, -50%)',
          width:       800, height: 800,
          background: 'radial-gradient(ellipse, rgba(10,147,211,0.20) 0%, rgba(10,147,211,0.05) 45%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      {/* Orbiting accent ring */}
      <div
        style={{
          position:     'absolute',
          top:          '50%', left: '50%',
          width:         560, height: 560,
          borderRadius: '50%',
          border:       '1px solid rgba(10,147,211,0.14)',
          transform:    `translate(-50%, -50%) rotate(${rot}deg)`,
          pointerEvents:'none',
        }}
      >
        <div style={{
          position: 'absolute', top: -4, left: '50%',
          width: 8, height: 8, borderRadius: '50%',
          background: '#0a93d3', transform: 'translateX(-50%)',
        }} />
      </div>

      {/* Second smaller ring */}
      <div
        style={{
          position:     'absolute',
          top:          '50%', left: '50%',
          width:         380, height: 380,
          borderRadius: '50%',
          border:       '1px solid rgba(5,150,105,0.10)',
          transform:    `translate(-50%, -50%) rotate(${-rot * 0.6}deg)`,
          pointerEvents:'none',
        }}
      >
        <div style={{
          position: 'absolute', bottom: -4, left: '50%',
          width: 6, height: 6, borderRadius: '50%',
          background: '#059669', transform: 'translateX(-50%)',
        }} />
      </div>

      {/* Top-edge teal accent */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 4,
        background: 'linear-gradient(to right, #0a93d3, #059669)',
      }} />

      {/* Centre content column */}
      <div
        style={{
          position:      'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          display:       'flex',
          flexDirection: 'column',
          alignItems:    'center',
          justifyContent:'center',
          gap:            0,
        }}
      >
        {/* Logo mark */}
        <div
          style={{
            opacity: logoEnter,
            transform: `translateY(${logoY}px)`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
          }}
        >
          <div style={{
            width:         72, height: 72,
            borderRadius:  16,
            background:   'linear-gradient(135deg, #0a93d3, #059669)',
            display:       'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow:    '0 8px 32px rgba(10,147,211,0.45)',
          }}>
            <svg width="38" height="38" viewBox="0 0 24 24" fill="white" stroke="none">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              color: '#ffffff', fontSize: 22, fontWeight: 700, letterSpacing: '-0.2px',
            }}>
              ACL Digital
            </span>
            <div style={{
              width: 1, height: 22, background: 'rgba(255,255,255,0.20)',
            }} />
            <span style={{
              color: 'rgba(255,255,255,0.60)', fontSize: 18, fontWeight: 400,
            }}>
              Platform
            </span>
          </div>
        </div>

        {/* Divider */}
        <div style={{
          width: 48, height: 2, borderRadius: 1,
          background: 'linear-gradient(to right, #0a93d3, #059669)',
          margin: '28px 0 24px',
          opacity: tagEnter,
        }} />

        {/* Tagline */}
        <div
          style={{
            opacity: tagEnter, transform: `translateY(${tagY}px)`,
            textAlign: 'center', maxWidth: 700, padding: '0 48px',
          }}
        >
          <p style={{
            color:         '#ffffff',
            fontSize:       44,
            fontWeight:     700,
            lineHeight:     1.22,
            letterSpacing: '-0.8px',
            margin:         0,
          }}>
            {tagline}
          </p>
        </div>

        {/* CTA */}
        <div
          style={{
            opacity: ctaEnter,
            marginTop: 40,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
          }}
        >
          <div style={{
            padding: '14px 40px',
            background: 'linear-gradient(to right, #0a93d3, #059669)',
            borderRadius: 8,
            color: '#ffffff', fontSize: 17, fontWeight: 700,
            letterSpacing: '-0.1px',
          }}>
            Schedule your live demonstration
          </div>
          <span style={{
            color: 'rgba(255,255,255,0.42)', fontSize: 14,
          }}>
            Contact us at acl-digital.com
          </span>
        </div>
      </div>

      {/* Bottom progress segments (matches B-roll footer) */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: 4,
        background: 'rgba(255,255,255,0.06)',
      }}>
        <div style={{
          height: '100%',
          width: `${Math.min(100, (frame / durationInFrames) * 100)}%`,
          background: 'rgba(10,147,211,0.60)',
          transition: 'width 0s',
        }} />
      </div>
    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Presenter photo layout (real photo supplied)
// ─────────────────────────────────────────────────────────────────────────────

const PhotoClose: React.FC<{ tagline: string; presenterSrc: string }> = ({ tagline, presenterSrc }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const [imgHidden, setImgHidden] = useState(false);

  const presenterOpacity = spring({ frame, fps, from: 0, to: 1, config: { damping: 16, stiffness: 60 } });
  const tagOpacity = spring({ frame: frame - 20, fps, from: 0, to: 1, config: { damping: 14 } });
  const tagSlide   = interpolate(
    spring({ frame: frame - 20, fps, config: { damping: 14, stiffness: 60 } }),
    [0, 1], [14, 0],
  );
  const fadeOut = interpolate(
    frame, [durationInFrames - 18, durationInFrames], [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const logoOpacity = spring({ frame, fps, from: 0, to: 1, config: { damping: 20, stiffness: 100 } });

  if (imgHidden) return <BrandedOutro tagline={tagline} />;

  return (
    <AbsoluteFill
      style={{
        background:    '#ffffff',
        fontFamily:     FONT_STACK,
        display:       'flex',
        flexDirection: 'column',
        alignItems:    'center',
        justifyContent:'center',
        overflow:      'hidden',
        opacity:        fadeOut,
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4,
        background: 'linear-gradient(to right, #0a93d3, #059669)' }} />

      <div style={{ position: 'absolute', top: 28, left: 48, display: 'flex', alignItems: 'center', gap: 10, opacity: logoOpacity }}>
        <div style={{ width: 32, height: 32, borderRadius: 6, background: '#0a93d3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="white" stroke="none">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
        </div>
        <span style={{ color: '#0f172a', fontSize: 16, fontWeight: 700, letterSpacing: '-0.2px' }}>Enterprise Demo</span>
      </div>

      <div style={{ width: '38%', maxWidth: 520, aspectRatio: '2 / 3', opacity: presenterOpacity, position: 'relative' }}>
        <Img
          src={staticFile(presenterSrc)}
          style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'bottom' }}
          onError={() => setImgHidden(true)}
        />
      </div>

      <div style={{
        marginTop: 32, textAlign: 'center',
        opacity: tagOpacity, transform: `translateY(${tagSlide}px)`,
        maxWidth: 640, paddingBottom: 40,
      }}>
        <p style={{ color: '#0f172a', fontSize: 34, fontWeight: 700, lineHeight: 1.25, letterSpacing: '-0.5px', margin: 0 }}>
          {tagline}
        </p>
        <div style={{ margin: '16px auto 0', width: 80, height: 3, background: '#0a93d3', borderRadius: 2 }} />
      </div>
    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Public component — auto-selects layout
// ─────────────────────────────────────────────────────────────────────────────

export const EnterprisePresenterClose: React.FC<EnterprisePresenterCloseProps> = ({
  tagline,
  presenterSrc,
}) => {
  const isPlaceholder = !presenterSrc || presenterSrc === DEFAULT_PLACEHOLDER;
  if (isPlaceholder) return <BrandedOutro tagline={tagline} />;
  return <PhotoClose tagline={tagline} presenterSrc={presenterSrc} />;
};
