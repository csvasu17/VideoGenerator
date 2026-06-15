/**
 * CalloutLayer — renders animated glassmorphism callout panels inside
 * the product window, timed to attention beats.
 *
 * Features:
 *   - Maximum 2 callouts visible simultaneously (enforced at render time)
 *   - Each callout has: glassmorphism panel + optional headline/subline/metric
 *   - SVG connector drawn from panel to the UI element anchor point
 *   - Enter/exit animations per callout spec
 *   - All layers are absolute-positioned, pointer-events none
 *   - z-index 4 — above ring (2), above vignette (1), below feature badge (3→5)
 *
 * Phase 7 — optional layer. When callouts array is empty, renders nothing.
 */

import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';
import type { CalloutTrack, AnimatedCallout } from '../../motion/callouts/types';
import { ACCENT_TEAL, FONT_STACK, TEXT_WHITE, TEXT_MUTED } from '../tokens';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface CalloutLayerProps {
  track:          CalloutTrack;
  /** Product window pixel dimensions — needed to convert normalized coords to SVG coords. */
  windowWidth:    number;
  windowHeight:   number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CalloutLayer
// ─────────────────────────────────────────────────────────────────────────────

export const CalloutLayer: React.FC<CalloutLayerProps> = ({
  track,
  windowWidth,
  windowHeight,
}) => {
  const frame = useCurrentFrame();

  // Only show callouts that are active at this frame (max 2)
  const active = track.callouts
    .filter(c => frame >= c.startFrame && frame <= c.endFrame)
    .slice(0, 2);

  if (active.length === 0) return null;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4 }}>
      {/* SVG layer for connectors — full overlay */}
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}
        viewBox={`0 0 ${windowWidth} ${windowHeight}`}
        preserveAspectRatio="none"
      >
        {active.map(c => (
          <CalloutConnectorSVG
            key={c.id}
            callout={c}
            frame={frame}
            windowWidth={windowWidth}
            windowHeight={windowHeight}
          />
        ))}
      </svg>

      {/* Panel divs */}
      {active.map(c => (
        <CalloutPanel
          key={c.id}
          callout={c}
          frame={frame}
        />
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CalloutPanel
// ─────────────────────────────────────────────────────────────────────────────

const CalloutPanel: React.FC<{ callout: AnimatedCallout; frame: number }> = ({
  callout,
  frame,
}) => {
  const { startFrame, holdStart, holdEnd, endFrame, panelPosition, panelSize, content, style, enter, exit } = callout;

  // Compute opacity + transform based on animation phase
  let opacity    = 1;
  let transform  = 'none';

  if (frame < holdStart) {
    // Enter phase
    const t = (frame - startFrame) / Math.max(holdStart - startFrame, 1);
    opacity   = clamp(t, 0, 1);
    transform = enterTransform(enter, t);
  } else if (frame > holdEnd) {
    // Exit phase
    const t = (frame - holdEnd) / Math.max(endFrame - holdEnd, 1);
    opacity   = clamp(1 - t, 0, 1);
    transform = exitTransform(exit, t);
  }

  if (opacity <= 0.01) return null;

  const left   = `${(panelPosition.x - panelSize.width  / 2) * 100}%`;
  const top    = `${(panelPosition.y - panelSize.height / 2) * 100}%`;
  const width  = `${panelSize.width  * 100}%`;
  const height = `${panelSize.height * 100}%`;

  const isGlassLight = style.variant !== 'glass-dark';
  const bg = isGlassLight
    ? `rgba(255,255,255,${style.panelOpacity})`
    : `rgba(6,13,26,${style.panelOpacity})`;
  const borderColor  = `rgba(${isGlassLight ? '255,255,255' : '255,255,255'},${style.borderOpacity})`;
  const accentLine   = style.accentColor || ACCENT_TEAL;

  return (
    <div
      style={{
        position:       'absolute',
        left,
        top,
        width,
        height,
        background:      bg,
        backdropFilter: `blur(${style.backdropBlur}px)`,
        WebkitBackdropFilter: `blur(${style.backdropBlur}px)`,
        border:         `1px solid ${borderColor}`,
        borderRadius:    style.cornerRadius,
        borderLeft:     `2px solid ${accentLine}`,
        boxShadow:      `0 8px 32px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.10)`,
        padding:        '10px 14px',
        display:        'flex',
        flexDirection:  'column',
        justifyContent: 'center',
        gap:             4,
        opacity,
        transform,
        transformOrigin: 'center center',
        willChange:     'opacity, transform',
        overflow:       'hidden',
        fontFamily:      FONT_STACK,
      }}
    >
      {/* Headline */}
      <span style={{
        color:         TEXT_WHITE,
        fontSize:       11,
        fontWeight:     700,
        letterSpacing: '0.5px',
        textTransform: 'uppercase',
        lineHeight:    1.2,
        whiteSpace:    'nowrap',
        overflow:      'hidden',
        textOverflow:  'ellipsis',
      }}>
        {content.headline}
      </span>

      {/* Sub-line */}
      {content.subline && (
        <span style={{
          color:      TEXT_MUTED,
          fontSize:    9,
          fontWeight:  400,
          lineHeight:  1.3,
          whiteSpace: 'nowrap',
          overflow:   'hidden',
          textOverflow:'ellipsis',
        }}>
          {content.subline}
        </span>
      )}

      {/* Metric */}
      {content.metric && (
        <span style={{
          color:         accentLine,
          fontSize:       10,
          fontWeight:     600,
          letterSpacing: '0.3px',
          marginTop:      2,
        }}>
          {content.metric}
        </span>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CalloutConnectorSVG
// ─────────────────────────────────────────────────────────────────────────────

const CalloutConnectorSVG: React.FC<{
  callout:      AnimatedCallout;
  frame:        number;
  windowWidth:  number;
  windowHeight: number;
}> = ({ callout, frame, windowWidth, windowHeight }) => {
  const { connector, startFrame, holdStart, holdEnd, endFrame, panelPosition, anchor } = callout;

  if (connector.type === 'none') return null;

  // Panel connection point: nearest edge toward anchor
  const panelCentreX = panelPosition.x * windowWidth;
  const panelCentreY = panelPosition.y * windowHeight;
  const anchorX      = anchor.x * windowWidth;
  const anchorY      = anchor.y * windowHeight;

  // Panel edge point closest to anchor
  const halfW = (callout.panelSize.width * windowWidth)  / 2;
  const halfH = (callout.panelSize.height * windowHeight) / 2;
  const dx    = anchorX - panelCentreX;
  const dy    = anchorY - panelCentreY;
  const panelEdgeX = panelCentreX + clamp(dx, -halfW, halfW);
  const panelEdgeY = panelCentreY + clamp(dy, -halfH, halfH);

  // Connector draw animation
  let dashOffset = 0;
  const totalLen = Math.sqrt(
    Math.pow(anchorX - panelEdgeX, 2) + Math.pow(anchorY - panelEdgeY, 2),
  );

  if (frame < holdStart) {
    const t = clamp((frame - startFrame) / Math.max(connector.drawDuration, 1), 0, 1);
    dashOffset = totalLen * (1 - t);
  } else if (frame > holdEnd) {
    const t = clamp((frame - holdEnd) / Math.max(endFrame - holdEnd, 1), 0, 1);
    dashOffset = totalLen * t;
  }

  const opacity = frame >= startFrame && frame <= endFrame ? 0.60 : 0;

  return (
    <line
      x1={panelEdgeX}
      y1={panelEdgeY}
      x2={anchorX}
      y2={anchorY}
      stroke={connector.strokeColor || ACCENT_TEAL}
      strokeWidth={connector.strokeWidth}
      strokeDasharray={totalLen}
      strokeDashoffset={dashOffset}
      opacity={opacity}
      strokeLinecap="round"
    />
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Animation helpers
// ─────────────────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function enterTransform(enter: string, t: number): string {
  const p = easeOut(t);
  switch (enter) {
    case 'fade-slide-up':
      return `translateY(${interpolate(p, [0, 1], [8, 0])}px)`;
    case 'scale-pop':
      return `scale(${interpolate(p, [0, 1], [0.85, 1])})`;
    default:
      return 'none';
  }
}

function exitTransform(exit: string, t: number): string {
  const p = easeIn(t);
  switch (exit) {
    case 'fade-down':
      return `translateY(${interpolate(p, [0, 1], [0, 8])}px)`;
    case 'scale-shrink':
      return `scale(${interpolate(p, [0, 1], [1, 0.90])})`;
    default:
      return 'none';
  }
}

function easeOut(t: number): number { return 1 - Math.pow(1 - t, 2); }
function easeIn(t: number): number  { return t * t; }
