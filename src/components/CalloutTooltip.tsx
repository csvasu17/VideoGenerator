/**
 * CalloutTooltip — animated floating info card for Remotion.
 *
 * Used to draw attention to a specific metric or UI element.
 * Entry: snappy scale punch (0.75 → 1.07 → 1.0) + opacity fade.
 * Optional: pulsing ping ring that radiates outward every 90 frames.
 */
import React from 'react';
import {useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {theme} from '../config/theme';
import {Springs, glowPulse} from '../utils/animations';

type ArrowSide = 'top' | 'bottom' | 'left' | 'right' | 'none';

interface Props {
  /** Emoji or short icon string shown on the left */
  icon?: string;
  /** Small label text (uppercase, secondary color) */
  title: string;
  /** Large primary value — shown in heading font */
  value?: string;
  /** Optional sub-description line */
  description?: string;
  /** Frame delay before entry animation */
  delay?: number;
  accent?: 'blue' | 'orange';
  /** Show outward-radiating ping ring */
  showPing?: boolean;
  /** Triangle arrow pointer side */
  arrowSide?: ArrowSide;
}

export const CalloutTooltip: React.FC<Props> = ({
  icon,
  title,
  value,
  description,
  delay       = 0,
  accent      = 'blue',
  showPing    = true,
  arrowSide   = 'bottom',
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const accentColor = accent === 'blue' ? theme.colors.blue.primary  : theme.colors.orange.primary;
  const accentGlow  = accent === 'blue' ? theme.colors.blue.glow     : theme.colors.orange.glow;
  const accentSubtle= accent === 'blue' ? theme.colors.blue.subtle   : theme.colors.orange.subtle;

  // Entry animation — snappy scale punch
  const entryP  = spring({fps, frame: frame - delay, config: Springs.snappy, durationInFrames: 28});
  const scaleVal = interpolate(entryP, [0,0.6,0.85,1], [0.75,1.06,0.97,1.0], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
  const opacity  = interpolate(entryP, [0,0.25,1],     [0,1,1],              {extrapolateLeft:'clamp', extrapolateRight:'clamp'});

  // Ping ring — repeats every 90 frames after entry
  const pingAge     = Math.max(0, frame - delay - 15);
  const pingPhase   = (pingAge % 90) / 90;
  const pingScale   = interpolate(pingPhase, [0,1], [1.0, 2.4], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
  const pingOpacity = interpolate(pingPhase, [0,0.25,1], [0.7,0.3,0], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});

  // Subtle glow pulse on the card border
  const pulse = glowPulse(frame, fps, 0.5);

  // Arrow triangle styles
  const ARROW_SIZE = 8;
  let arrowStyle: React.CSSProperties = {};
  if (arrowSide !== 'none') {
    const base: React.CSSProperties = {
      position: 'absolute', width: 0, height: 0, pointerEvents: 'none',
    };
    switch (arrowSide) {
      case 'bottom':
        arrowStyle = {...base, bottom: -ARROW_SIZE, left: '50%', transform: 'translateX(-50%)',
          borderLeft: `${ARROW_SIZE}px solid transparent`,
          borderRight: `${ARROW_SIZE}px solid transparent`,
          borderTop: `${ARROW_SIZE}px solid ${theme.colors.border.normal}`};
        break;
      case 'top':
        arrowStyle = {...base, top: -ARROW_SIZE, left: '50%', transform: 'translateX(-50%)',
          borderLeft: `${ARROW_SIZE}px solid transparent`,
          borderRight: `${ARROW_SIZE}px solid transparent`,
          borderBottom: `${ARROW_SIZE}px solid ${theme.colors.border.normal}`};
        break;
      case 'left':
        arrowStyle = {...base, left: -ARROW_SIZE, top: '50%', transform: 'translateY(-50%)',
          borderTop: `${ARROW_SIZE}px solid transparent`,
          borderBottom: `${ARROW_SIZE}px solid transparent`,
          borderRight: `${ARROW_SIZE}px solid ${theme.colors.border.normal}`};
        break;
      case 'right':
        arrowStyle = {...base, right: -ARROW_SIZE, top: '50%', transform: 'translateY(-50%)',
          borderTop: `${ARROW_SIZE}px solid transparent`,
          borderBottom: `${ARROW_SIZE}px solid transparent`,
          borderLeft: `${ARROW_SIZE}px solid ${theme.colors.border.normal}`};
        break;
    }
  }

  return (
    <div style={{
      position: 'relative',
      opacity,
      transform: `scale(${scaleVal})`,
      transformOrigin: 'center center',
      display: 'inline-flex',
    }}>

      {/* Ping ring — radiates outward from card center */}
      {showPing && frame > delay + 15 && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: `translate(-50%, -50%) scale(${pingScale})`,
          width: 44, height: 44, borderRadius: '50%',
          border: `1.5px solid ${accentColor}`,
          opacity: pingOpacity,
          pointerEvents: 'none',
        }}/>
      )}

      {/* Card */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 18px',
        background: theme.colors.backgroundCard,
        border: `1px solid ${theme.colors.border.normal}`,
        borderRadius: theme.radius.md,
        boxShadow: `0 12px 40px rgba(0,0,0,0.55), 0 0 32px ${accentGlow}`,
        position: 'relative',
        minWidth: 160,
      }}>
        {/* Left accent bar */}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
          background: accentColor,
          borderRadius: '4px 0 0 4px',
          boxShadow: `0 0 10px ${accentGlow}`,
          opacity: 0.88 + pulse * 0.12,
        }}/>

        {/* Icon chip */}
        {icon && (
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: accentSubtle,
            border: `1px solid ${accentGlow}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, flexShrink: 0,
          }}>
            {icon}
          </div>
        )}

        {/* Text block */}
        <div style={{display: 'flex', flexDirection: 'column', gap: 2}}>
          <div style={{
            fontFamily: theme.fonts.body, fontSize: 10, fontWeight: 700,
            color: theme.colors.text.secondary, letterSpacing: '0.08em',
            textTransform: 'uppercase' as const,
          }}>
            {title}
          </div>
          {value && (
            <div style={{
              fontFamily: theme.fonts.heading, fontSize: 22, fontWeight: 800,
              color: theme.colors.text.primary, letterSpacing: '-0.02em', lineHeight: 1,
            }}>
              {value}
            </div>
          )}
          {description && (
            <div style={{
              fontFamily: theme.fonts.body, fontSize: 11, fontWeight: 400,
              color: theme.colors.text.secondary, lineHeight: 1.4,
            }}>
              {description}
            </div>
          )}
        </div>
      </div>

      {/* Arrow pointer */}
      {arrowSide !== 'none' && <div style={arrowStyle}/>}
    </div>
  );
};
