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
// Filled circle pin colors and checkmark icon
// ─────────────────────────────────────────────────────────────────────────────

const ICON_COLORS: Record<BenefitIconKey, string> = {
  speed:       '#0a93d3',
  accuracy:    '#059669',
  oversight:   '#7c3aed',
  revenue:     '#d97706',
  integration: '#0a93d3',
  compliance:  '#dc2626',
  default:     '#0a93d3',
};

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

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
        display:    'flex',
        alignItems: 'center',
        gap:         24,
        opacity,
        transform:  `translateX(${slideX}px)`,
        padding:    '16px 0',
        borderBottom: '1px solid rgba(0,0,0,0.07)',
      }}
    >
      {/* Filled circle pin */}
      <div
        style={{
          width:          52,
          height:         52,
          borderRadius:  '50%',
          background:     iconColor,
          display:       'flex',
          alignItems:    'center',
          justifyContent:'center',
          flexShrink:     0,
          padding:        12,
          boxShadow:     `0 4px 14px ${iconColor}55`,
        }}
      >
        <CheckIcon />
      </div>

      {/* Single-line: Bold label — description */}
      <p style={{ margin: 0, fontSize: 22, lineHeight: 1.4, color: '#111827' }}>
        <span style={{ fontWeight: 800 }}>{bullet.label}:&nbsp;</span>
        <span style={{ fontWeight: 400, color: 'rgba(0,0,0,0.65)' }}>{bullet.description}</span>
      </p>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// EnterpriseBenefitSlide
// ─────────────────────────────────────────────────────────────────────────────

export interface EnterpriseBenefitSlideProps {
  title:              string;
  bullets:            EnterpriseBenefitBullet[];
  presenterSrc?:      string;
  presenterVideoSrc?: string;
  presenterWidthFraction?: number;
  voiceSyncOffsetFrames?: number;
}

const STAGGER_FRAMES = 10; // each bullet staggers 10 frames after the previous

export const EnterpriseBenefitSlide: React.FC<EnterpriseBenefitSlideProps> = ({
  title,
  bullets,
  presenterSrc,
  presenterVideoSrc,
  presenterWidthFraction = 0.15,
  voiceSyncOffsetFrames,
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

      {/* Presenter overlay — animated when video available */}
      {(presenterSrc || presenterVideoSrc) && (
        <PresenterOverlay
          src={presenterSrc ?? ''}
          videoSrc={presenterVideoSrc}
          widthFraction={presenterWidthFraction}
          position="bottom-left"
          voiceSyncOffsetFrames={voiceSyncOffsetFrames}
        />
      )}
    </AbsoluteFill>
  );
};
