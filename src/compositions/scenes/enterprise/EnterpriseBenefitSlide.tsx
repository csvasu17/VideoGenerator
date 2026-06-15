/**
 * EnterpriseBenefitSlide — animated value-add bullet slide (enterprise template).
 *
 * White background, bold title, 5 staggered bullet rows (icon + bold label + description).
 * PresenterOverlay at bottom-left. Each bullet staggers in 8 frames after the previous.
 */

import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { PresenterOverlay } from '../../layers/PresenterOverlay';
import { FONT_STACK } from '../../tokens';
import type { BenefitIconKey, EnterpriseBenefitBullet } from '../../../core/domain/entities/RemotionPackage';

// ─────────────────────────────────────────────────────────────────────────────
// Icon map — simple SVG paths, enterprise-safe
// ─────────────────────────────────────────────────────────────────────────────

const ICON_SVG: Record<BenefitIconKey, React.ReactNode> = {
  speed: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
    </svg>
  ),
  accuracy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  oversight: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  revenue: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
    </svg>
  ),
  integration: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="7" height="7"/><rect x="15" y="3" width="7" height="7"/>
      <rect x="15" y="14" width="7" height="7"/><rect x="2" y="14" width="7" height="7"/>
      <path d="M9 6.5h6M9 17.5h6M12 10v4"/>
    </svg>
  ),
  compliance: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
  default: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
};

const ICON_COLORS: Record<BenefitIconKey, string> = {
  speed:       '#0a93d3',
  accuracy:    '#059669',
  oversight:   '#7c3aed',
  revenue:     '#d97706',
  integration: '#0a93d3',
  compliance:  '#dc2626',
  default:     '#0a93d3',
};

// ─────────────────────────────────────────────────────────────────────────────
// BulletRow
// ─────────────────────────────────────────────────────────────────────────────

const BulletRow: React.FC<{
  bullet:       EnterpriseBenefitBullet;
  staggerFrame: number;
}> = ({ bullet, staggerFrame }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const relFrame = Math.max(0, frame - staggerFrame);
  const opacity  = spring({ frame: relFrame, fps, from: 0, to: 1, config: { damping: 18, stiffness: 80 } });
  const slideX   = interpolate(
    spring({ frame: relFrame, fps, config: { damping: 18, stiffness: 80 } }),
    [0, 1], [-20, 0],
  );

  const icon      = bullet.icon ?? 'default';
  const iconColor = ICON_COLORS[icon] ?? ICON_COLORS.default;

  return (
    <div
      style={{
        display:     'flex',
        alignItems:  'flex-start',
        gap:          20,
        opacity,
        transform:   `translateX(${slideX}px)`,
        padding:     '12px 0',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
      }}
    >
      {/* Icon */}
      <div
        style={{
          width:         44,
          height:        44,
          borderRadius:   8,
          background:    `${iconColor}18`,
          border:        `1px solid ${iconColor}40`,
          display:       'flex',
          alignItems:    'center',
          justifyContent:'center',
          flexShrink:     0,
          color:          iconColor,
          padding:        10,
        }}
      >
        {ICON_SVG[icon] ?? ICON_SVG.default}
      </div>

      {/* Text */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span
          style={{
            color:         '#111827',
            fontSize:       20,
            fontWeight:     700,
            lineHeight:     1.2,
          }}
        >
          {bullet.label}
        </span>
        <span
          style={{
            color:      'rgba(0,0,0,0.55)',
            fontSize:    16,
            fontWeight:  400,
            lineHeight:  1.45,
          }}
        >
          {bullet.description}
        </span>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// EnterpriseBenefitSlide
// ─────────────────────────────────────────────────────────────────────────────

export interface EnterpriseBenefitSlideProps {
  title:         string;
  bullets:       EnterpriseBenefitBullet[];
  presenterSrc?: string;
  presenterWidthFraction?: number;
}

const STAGGER_FRAMES = 10; // each bullet staggers 10 frames after the previous

export const EnterpriseBenefitSlide: React.FC<EnterpriseBenefitSlideProps> = ({
  title,
  bullets,
  presenterSrc,
  presenterWidthFraction = 0.15,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = spring({ frame, fps, from: 0, to: 1, config: { damping: 16 } });
  const titleSlide   = interpolate(
    spring({ frame, fps, config: { damping: 16, stiffness: 70 } }),
    [0, 1], [16, 0],
  );

  // Bullets start appearing at frame 12 (after title enters)
  const bulletStartFrame = 12;

  const presenterPadding = presenterSrc
    ? `calc(${presenterWidthFraction * 100}% + 24px)`
    : '0px';

  return (
    <AbsoluteFill
      style={{
        background:  '#ffffff',
        fontFamily:   FONT_STACK,
        paddingLeft:  80,
        paddingRight: 80,
        paddingTop:   60,
        paddingBottom: 20,
      }}
    >
      {/* Teal top-edge accent line */}
      <div
        style={{
          position:   'absolute',
          top: 0, left: 0, right: 0,
          height:      4,
          background: 'linear-gradient(to right, #0a93d3, #059669)',
        }}
      />

      {/* Title */}
      <div
        style={{
          opacity:    titleOpacity,
          transform: `translateY(${titleSlide}px)`,
          marginBottom: 36,
        }}
      >
        <h2
          style={{
            color:         '#0f172a',
            fontSize:       42,
            fontWeight:     800,
            lineHeight:     1.15,
            letterSpacing: '-0.8px',
            margin:         0,
          }}
        >
          {title}
        </h2>
      </div>

      {/* Bullet list */}
      <div
        style={{
          display:       'flex',
          flexDirection: 'column',
          paddingBottom:  presenterPadding,
        }}
      >
        {bullets.map((bullet, i) => (
          <BulletRow
            key={i}
            bullet={bullet}
            staggerFrame={bulletStartFrame + i * STAGGER_FRAMES}
          />
        ))}
      </div>

      {/* Presenter overlay */}
      {presenterSrc && (
        <PresenterOverlay
          src={presenterSrc}
          widthFraction={presenterWidthFraction}
          position="bottom-left"
        />
      )}
    </AbsoluteFill>
  );
};
