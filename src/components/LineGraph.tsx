/**
 * LineGraph — SVG line chart with animated left-to-right draw for Remotion.
 *
 * The line is revealed via strokeDashoffset animation (mathematically computed
 * path length — no DOM refs needed, works in headless render).
 * Data-point dots pop in with an impact spring as the line reaches them.
 * An optional area fill is clipped left-to-right in sync with the line.
 */
import React from 'react';
import {useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {theme} from '../config/theme';
import {Springs, staggerDelay, glowPulse} from '../utils/animations';

export interface DataPoint {
  label: string;
  value: number;
}

interface Props {
  dataPoints: DataPoint[];
  title?: string;
  /** SVG canvas width in px (default 500) */
  width?: number;
  /** SVG canvas height in px (default 200) */
  height?: number;
  delay?: number;
  accent?: 'blue' | 'orange';
  showDots?: boolean;
  showArea?: boolean;
  unit?: string;
}

/** Compute Euclidean path length for a polyline */
function computePathLength(pts: {x: number; y: number}[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

export const LineGraph: React.FC<Props> = ({
  dataPoints,
  title,
  width  = 500,
  height = 200,
  delay  = 0,
  accent = 'blue',
  showDots = true,
  showArea = true,
  unit = '',
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const accentColor = accent === 'blue' ? theme.colors.blue.primary : theme.colors.orange.primary;
  const accentGlow  = accent === 'blue' ? theme.colors.blue.glow   : theme.colors.orange.glow;
  const pulse       = glowPulse(frame, fps, 0.4);

  // Padding inside SVG canvas
  const PAD_L = 16; const PAD_R = 16; const PAD_T = 28; const PAD_B = 28;
  const chartW = width  - PAD_L - PAD_R;
  const chartH = height - PAD_T - PAD_B;

  const maxVal = Math.max(...dataPoints.map(d => d.value), 1);
  const minVal = Math.min(...dataPoints.map(d => d.value), 0);
  const range  = maxVal - minVal || 1;
  const count  = dataPoints.length;

  // Map data → SVG coordinates
  const svgPts = dataPoints.map((d, i) => ({
    x: PAD_L + (count > 1 ? (i / (count - 1)) * chartW : chartW / 2),
    y: PAD_T + (1 - (d.value - minVal) / range) * chartH,
  }));

  const polylinePoints = svgPts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const totalLen = computePathLength(svgPts);

  // Spring configs
  const titleP = spring({fps, frame: frame - delay, config: Springs.gentle, durationInFrames: 30});
  const gridP  = spring({fps, frame: frame - delay, config: Springs.gentle, durationInFrames: 25});

  // Line draw — use swell spring for slow, dramatic reveal
  const drawDur    = 90;
  const drawDelay  = delay + 15;
  const drawP      = spring({fps, frame: frame - drawDelay, config: Springs.swell, durationInFrames: drawDur});
  const drawnOffset = interpolate(drawP, [0,1], [totalLen, 0], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
  const areaClipW   = interpolate(drawP, [0,1], [0, chartW],   {extrapolateLeft:'clamp', extrapolateRight:'clamp'});

  // Unique gradient IDs based on accent to avoid SVG id conflicts
  const gradId = `lg-area-${accent}`;
  const clipId = `lg-clip-${accent}`;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 16,
      padding: '28px 32px',
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

      {/* Title */}
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

      {/* SVG chart */}
      <svg
        width={width} height={height}
        style={{overflow: 'visible', position: 'relative', display: 'block'}}
      >
        <defs>
          {/* Area gradient — vertical fade from accent to transparent */}
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={accentColor} stopOpacity={0.28}/>
            <stop offset="100%" stopColor={accentColor} stopOpacity={0}/>
          </linearGradient>
          {/* Left-to-right clip rect that matches line draw progress */}
          <clipPath id={clipId}>
            <rect x={PAD_L} y={0} width={areaClipW} height={height}/>
          </clipPath>
        </defs>

        {/* Horizontal grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((tick, ti) => (
          <line key={ti}
            x1={PAD_L} y1={PAD_T + tick * chartH}
            x2={PAD_L + chartW} y2={PAD_T + tick * chartH}
            stroke={`rgba(255,255,255,${ti === 4 ? 0.12 : 0.04})`}
            strokeWidth={1}
            opacity={interpolate(gridP, [0,0.4,1], [0,1,1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'})}
          />
        ))}

        {/* X-axis labels */}
        {dataPoints.map((d, i) => {
          const lblP = spring({fps, frame: frame - delay - staggerDelay(i, 6), config: Springs.gentle, durationInFrames: 25});
          return (
            <text key={i}
              x={svgPts[i].x} y={PAD_T + chartH + 18}
              textAnchor="middle" fontSize={11} fontWeight="500"
              fill={theme.colors.text.tertiary} fontFamily={theme.fonts.body}
              opacity={interpolate(lblP, [0,0.4,1], [0,1,1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'})}
            >
              {d.label}
            </text>
          );
        })}

        {/* Area fill — clipped to match line draw progress */}
        {showArea && (
          <polygon
            points={[
              ...svgPts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`),
              `${svgPts[count - 1].x.toFixed(2)},${(PAD_T + chartH).toFixed(2)}`,
              `${svgPts[0].x.toFixed(2)},${(PAD_T + chartH).toFixed(2)}`,
            ].join(' ')}
            fill={`url(#${gradId})`}
            clipPath={`url(#${clipId})`}
          />
        )}

        {/* Animated line — revealed via strokeDashoffset */}
        <polyline
          points={polylinePoints}
          fill="none"
          stroke={accentColor}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={totalLen}
          strokeDashoffset={drawnOffset}
          style={{filter: `drop-shadow(0 0 6px ${accentGlow})`}}
        />

        {/* Data point dots — pop in as line reaches each point */}
        {showDots && svgPts.map((pt, idx) => {
          // Estimate frame when line arrives at this dot
          const dotProgress = count > 1 ? idx / (count - 1) : 1;
          const dotFrame    = drawDelay + dotProgress * drawDur * 0.9;
          const dotP        = spring({fps, frame: frame - dotFrame, config: Springs.impact, durationInFrames: 18});
          const dotScale    = interpolate(dotP, [0,0.6,0.85,1], [0,1.3,0.9,1.0], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
          const dotOpacity  = interpolate(dotP, [0,0.15,1], [0,1,1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
          const valP        = spring({fps, frame: frame - dotFrame - 4, config: Springs.gentle, durationInFrames: 20});

          return (
            <g key={idx}>
              {/* Value label above dot */}
              <text
                x={pt.x} y={pt.y - 14}
                textAnchor="middle" fontSize={12} fontWeight="700"
                fill={theme.colors.text.primary} fontFamily={theme.fonts.heading}
                opacity={interpolate(valP, [0,0.4,1], [0,1,1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'})}
              >
                {dataPoints[idx].value}{unit}
              </text>
              {/* Outer ring */}
              <circle cx={pt.x} cy={pt.y} r={8 * dotScale}
                fill="none" stroke={accentColor} strokeWidth={1.5}
                opacity={dotOpacity * 0.35}
              />
              {/* Inner filled dot */}
              <circle cx={pt.x} cy={pt.y} r={5 * dotScale}
                fill={accentColor} opacity={dotOpacity}
                style={{filter: `drop-shadow(0 0 8px ${accentGlow})`}}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
};
