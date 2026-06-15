/**
 * BarChart — animated vertical bar chart for Remotion.
 *
 * Bars grow from 0 → value using cinematic spring physics.
 * Each bar staggers in, with value labels popping in above them.
 * Styled to match the Rheem dark-mode brand system.
 */
import React from 'react';
import {useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {theme} from '../config/theme';
import {Springs, staggerDelay, glowPulse} from '../utils/animations';

export interface BarDef {
  /** X-axis label shown below the bar */
  label: string;
  /** Numeric value to animate toward */
  value: number;
  /** Optional override color — defaults to accent color */
  color?: string;
}

interface Props {
  bars: BarDef[];
  /** Optional chart title shown above bars */
  title?: string;
  /** Maximum pixel height for a 100% bar */
  maxBarHeight?: number;
  /** Frame delay before the chart starts animating */
  delay?: number;
  /** Brand accent — affects colors and glow */
  accent?: 'blue' | 'orange';
  /** Show numeric value label above each bar */
  showValues?: boolean;
  /** Unit string appended to value labels (e.g. '%', 'K') */
  unit?: string;
}

export const BarChart: React.FC<Props> = ({
  bars,
  title,
  maxBarHeight = 220,
  delay = 0,
  accent = 'blue',
  showValues = true,
  unit = '',
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const accentColor = accent === 'blue' ? theme.colors.blue.primary   : theme.colors.orange.primary;
  const accentGlow  = accent === 'blue' ? theme.colors.blue.glow      : theme.colors.orange.glow;
  const accentSubtle= accent === 'blue' ? theme.colors.blue.subtle    : theme.colors.orange.subtle;

  const maxVal  = Math.max(...bars.map(b => b.value), 1);
  const titleP  = spring({fps, frame: frame - delay, config: Springs.gentle, durationInFrames: 30});
  const gridP   = spring({fps, frame: frame - delay - 5, config: Springs.gentle, durationInFrames: 25});
  const pulse   = glowPulse(frame, fps, 0.45);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 24,
      padding: '32px 36px',
      background: theme.colors.backgroundCard,
      border: `1px solid ${theme.colors.border.normal}`,
      borderRadius: theme.radius.lg,
      position: 'relative', overflow: 'hidden',
      boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
    }}>

      {/* Top accent line */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)`,
        opacity: 0.8 + pulse * 0.2,
      }}/>

      {/* Ambient radial glow at base */}
      <div style={{
        position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '80%', height: '50%',
        background: `radial-gradient(ellipse, ${accentSubtle} 0%, transparent 70%)`,
        filter: 'blur(50px)', pointerEvents: 'none',
      }}/>

      {/* Chart title */}
      {title && (
        <div style={{
          fontFamily: theme.fonts.heading, fontSize: 18, fontWeight: 600,
          color: theme.colors.text.secondary, letterSpacing: '0.06em',
          textTransform: 'uppercase' as const,
          opacity: interpolate(titleP, [0,0.3,1], [0,1,1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'}),
          position: 'relative',
        }}>
          {title}
        </div>
      )}

      {/* Chart area */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around',
        gap: 12, height: maxBarHeight + 52, position: 'relative', paddingBottom: 40,
      }}>

        {/* Horizontal grid lines */}
        {[0, 0.25, 0.5, 0.75, 1.0].map((tick, ti) => (
          <div key={ti} style={{
            position: 'absolute', left: 0, right: 0,
            bottom: 40 + tick * maxBarHeight, height: 1,
            background: `rgba(255,255,255,${ti === 0 ? 0.14 : 0.04})`,
            opacity: interpolate(gridP, [0,0.4,1], [0,1,1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'}),
          }}/>
        ))}

        {/* Bars */}
        {bars.map((bar, idx) => {
          const barDelay   = delay + 12 + staggerDelay(idx, 12);
          const barP       = spring({fps, frame: frame - barDelay, config: Springs.cinematic, durationInFrames: 55});
          const height     = interpolate(barP, [0,1], [0, (bar.value / maxVal) * maxBarHeight], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});

          const lblDelay   = barDelay + 10;
          const lblP       = spring({fps, frame: frame - lblDelay, config: Springs.snappy, durationInFrames: 22});
          const lblOpacity = interpolate(lblP, [0,0.3,1], [0,1,1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
          const barColor   = bar.color ?? accentColor;

          return (
            <div key={idx} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              flex: 1, position: 'relative', height: maxBarHeight, justifyContent: 'flex-end',
            }}>
              {/* Value label — floats just above the top of the bar */}
              {showValues && (
                <div style={{
                  position: 'absolute', bottom: height + 10,
                  fontFamily: theme.fonts.heading, fontSize: 15, fontWeight: 700,
                  color: theme.colors.text.primary,
                  opacity: lblOpacity,
                  transform: `translateY(${interpolate(lblP, [0,1], [8,0])}px)`,
                  whiteSpace: 'nowrap' as const, textAlign: 'center' as const, width: '100%',
                }}>
                  {bar.value}{unit}
                </div>
              )}

              {/* The bar */}
              <div style={{
                width: '65%', maxWidth: 68, height,
                background: `linear-gradient(180deg, ${barColor} 0%, ${barColor}99 100%)`,
                borderRadius: '6px 6px 2px 2px',
                boxShadow: `0 0 22px ${accentGlow}, 0 0 6px ${accentGlow}`,
                position: 'relative', overflow: 'hidden', flexShrink: 0,
              }}>
                {/* Highlight shine on top-left */}
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: '35%',
                  background: 'linear-gradient(180deg, rgba(255,255,255,0.20) 0%, transparent 100%)',
                }}/>
              </div>

              {/* X-axis label */}
              <div style={{
                position: 'absolute', bottom: -34, width: '100%',
                fontFamily: theme.fonts.body, fontSize: 12, fontWeight: 500,
                color: theme.colors.text.secondary, textAlign: 'center' as const,
                opacity: lblOpacity,
              }}>
                {bar.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
