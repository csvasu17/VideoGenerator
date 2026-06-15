/**
 * SVGCheckmark — animated SVG checkmark for Remotion.
 *
 * Animation sequence:
 *   1. Circle strokes in (clockwise, using strokeDashoffset)
 *   2. Checkmark path draws inside the circle
 *   3. On completion: scale impact punch + fill glow
 */
import React from 'react';
import {useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {Springs} from '../utils/animations';

// SVG viewBox is 32×32. Checkmark path geometry:
const CHECK_PATH            = 'M 7 16 L 13 22 L 25 10';
// Approximate arc + leg lengths (geometric estimate — no DOM access needed)
const CIRCLE_R              = 14;
const CIRCLE_CIRCUMFERENCE  = 2 * Math.PI * CIRCLE_R; // ≈ 87.96
const CHECK_PATH_LENGTH     = 21; // √(6²+6²) + √(12²+12²) ≈ 8.5 + 17.0 ≈ 21

interface Props {
  /** Rendered size in px (square) */
  size?: number;
  /** Stroke + fill color */
  color?: string;
  /** Frame delay before animation begins */
  delay?: number;
  /** Stroke thickness */
  strokeWidth?: number;
  /** Draw an outer circle (disable to show just the tick) */
  showCircle?: boolean;
}

export const SVGCheckmark: React.FC<Props> = ({
  size        = 36,
  color       = '#0066FF',
  delay       = 0,
  strokeWidth = 2.5,
  showCircle  = true,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const glow = `${color}55`; // ~33% alpha glow

  // 1. Circle stroke draw
  const circleP       = spring({fps, frame: frame - delay, config: Springs.cinematic, durationInFrames: 35});
  const circleOffset  = interpolate(circleP, [0,1], [CIRCLE_CIRCUMFERENCE, 0], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});

  // 2. Checkmark draw (kicks off when circle is ~55% done)
  const checkDelay    = delay + 18;
  const checkP        = spring({fps, frame: frame - checkDelay, config: Springs.snappy, durationInFrames: 28});
  const checkOffset   = interpolate(checkP, [0,1], [CHECK_PATH_LENGTH, 0], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});

  // 3. Completion impact: scale punch + fill reveal
  const fillDelay     = delay + 28;
  const fillP         = spring({fps, frame: frame - fillDelay, config: Springs.impact, durationInFrames: 20});
  const fillOpacity   = interpolate(fillP, [0,0.2,1], [0,1,1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
  const scaleVal      = interpolate(fillP, [0,0.6,0.85,1], [0.82,1.07,0.96,1.0], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});

  return (
    <div style={{
      width: size, height: size,
      transform: `scale(${scaleVal})`,
      transformOrigin: 'center center',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <svg width={size} height={size} viewBox="0 0 32 32" overflow="visible">
        {showCircle && (
          <>
            {/* Background fill — fades in on completion */}
            <circle
              cx={16} cy={16} r={CIRCLE_R}
              fill={color} fillOpacity={fillOpacity * 0.15}
              style={{filter: `drop-shadow(0 0 8px ${glow})`}}
            />
            {/* Animated circle stroke — draws clockwise from 12 o'clock */}
            <circle
              cx={16} cy={16} r={CIRCLE_R}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={CIRCLE_CIRCUMFERENCE}
              strokeDashoffset={circleOffset}
              transform="rotate(-90 16 16)"
              style={{filter: `drop-shadow(0 0 4px ${glow})`}}
            />
          </>
        )}

        {/* Checkmark stroke — draws left-to-right along the path */}
        <path
          d={CHECK_PATH}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={CHECK_PATH_LENGTH}
          strokeDashoffset={checkOffset}
          style={{filter: `drop-shadow(0 0 4px ${glow})`}}
        />
      </svg>
    </div>
  );
};
