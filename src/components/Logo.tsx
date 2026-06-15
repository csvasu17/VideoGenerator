import React from 'react';
import {useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {theme} from '../config/theme';

interface Props {
  size?: number;
  delay?: number;
  showTagline?: boolean;
  animated?: boolean;
  /** Optional product name shown as the wordmark. Defaults to generic icon-only. */
  label?: string;
  /** Optional tagline text. Only shown when showTagline=true. */
  tagline?: string;
}

/**
 * AppLogo — generic animated brand mark for the demo video.
 *
 * Renders a rounded icon-mark (gradient square with a stylised pulse shape)
 * and an optional text wordmark. All Rheem-specific copy has been removed;
 * pass `label` and `tagline` props to customise per-project.
 */
export function AppLogo({
  size = 80,
  delay = 0,
  showTagline = false,
  animated = true,
  label,
  tagline = 'Enterprise-Grade Platform',
}: Props): JSX.Element {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const revealProgress = animated
    ? spring({fps, frame: frame - delay, config:{damping:20,mass:1,stiffness:80,overshootClamping:false}, durationInFrames:50})
    : 1;

  const taglineProgress = animated
    ? spring({fps, frame: frame - delay - 20, config:{damping:30,mass:1,stiffness:100,overshootClamping:false}, durationInFrames:40})
    : 1;

  const opacity = interpolate(revealProgress,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  const scale   = interpolate(revealProgress,[0,1],[0.7,1]);

  return (
    <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:12}}>
      <div style={{
        opacity,
        transform: `scale(${scale})`,
        display:'flex', alignItems:'center', gap: label ? 16 : 0,
      }}>
        {/* Icon mark — generic pulse/node glyph */}
        <div style={{
          width: size, height: size,
          borderRadius: size * 0.18,
          background: `linear-gradient(135deg, ${theme.colors.blue.primary} 0%, ${theme.colors.blue.light} 100%)`,
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow: `0 0 ${size*0.4}px ${theme.colors.blue.glow}, 0 ${size*0.15}px ${size*0.3}px rgba(0,0,0,0.4)`,
          position:'relative', overflow:'hidden',
        }}>
          {/* Outer ring */}
          <div style={{
            width: size*0.60, height: size*0.60,
            borderRadius: '50%',
            border: `${size*0.045}px solid rgba(255,255,255,0.85)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {/* Inner dot */}
            <div style={{
              width: size*0.22, height: size*0.22,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.95)',
              boxShadow: `0 0 ${size*0.12}px rgba(255,255,255,0.7)`,
            }}/>
          </div>
        </div>

        {/* Wordmark — only rendered when label is provided */}
        {label && (
          <div style={{
            fontFamily: theme.fonts.heading,
            fontSize: size * 0.75,
            fontWeight: 800,
            letterSpacing: '-0.03em',
            color: theme.colors.text.primary,
            textShadow: `0 0 40px rgba(0,102,255,0.4)`,
          }}>
            {label}
          </div>
        )}
      </div>

      {showTagline && (
        <div style={{
          opacity: interpolate(taglineProgress,[0,0.3,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
          transform: `translateY(${interpolate(taglineProgress,[0,1],[12,0])}px)`,
          fontFamily: theme.fonts.body,
          fontSize: size * 0.18,
          fontWeight: 400,
          letterSpacing: '0.15em',
          color: theme.colors.text.secondary,
          textTransform: 'uppercase',
        }}>
          {tagline}
        </div>
      )}
    </div>
  );
}

/** @deprecated Use AppLogo — Rheem-neutral rename */
export const RheemLogo = AppLogo;
