/**
 * SceneTransition — wraps scene content with animated in/out transitions.
 *
 * Usage:
 *   <SceneTransition
 *     durationInFrames={scene.durationInFrames}
 *     inType={prevScene?.transition?.type}   inDuration={prevScene?.transition?.durationInFrames}
 *     outType={scene.transition?.type}       outDuration={scene.transition?.durationInFrames}
 *   >
 *     <DemoScene ... />
 *   </SceneTransition>
 *
 * Transition types (matching TransitionType in Storyboard.ts):
 *   fade        — pure opacity cross-fade (safest universal default)
 *   slide-left  — scene enters from right (+40%), exits to left (−40%)
 *   slide-right — scene enters from left (−40%), exits to right (+40%)
 *   zoom-in     — camera pushes in (scale 0.94→1 in, 1→1.08 out)
 *   zoom-out    — camera pulls back (scale 1.06→1 in, 1→0.94 out)
 *   cut         — instant, no animation (default)
 *
 * Design rules:
 *   • In-transition uses ease-out (snappy arrival).
 *   • Out-transition uses ease-in (graceful departure).
 *   • All non-cut types fade opacity alongside the transform — prevents
 *     jarring pop-ins on heavy UI content.
 *   • Only one phase (in OR out) is ever active at the same frame; the in
 *     phase takes priority until it completes.
 *   • transform-origin: center center so scale transitions feel natural on
 *     the full scene.
 */

import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface SceneTransitionProps {
  children:         React.ReactNode;
  /** Total scene duration — needed to compute when out-transition starts. */
  durationInFrames: number;
  /**
   * Transition type entering THIS scene.
   * Comes from the PREVIOUS scene's .transition.type in demo-package.json.
   */
  inType?:          string | null;
  /** Number of frames the entry animation spans. */
  inDuration?:      number;
  /**
   * Transition type leaving THIS scene.
   * Comes from THIS scene's .transition.type in demo-package.json.
   */
  outType?:         string | null;
  /** Number of frames the exit animation spans. */
  outDuration?:     number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Easing helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Ease-out quadratic — snappy arrival for entry transitions. */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 2);
}

/** Ease-in quadratic — graceful departure for exit transitions. */
function easeIn(t: number): number {
  return t * t;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transform builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CSS transform for the ENTRY phase (inProgress 0→1, eased-out).
 * Returns 'none' for 'fade' and 'cut' (pure opacity).
 */
function inTransform(type: string, p: number): string {
  switch (type) {
    case 'slide-left':  return `translateX(${interpolate(p, [0, 1], [42,  0])}%)`;
    case 'slide-right': return `translateX(${interpolate(p, [0, 1], [-42, 0])}%)`;
    case 'zoom-in':     return `scale(${interpolate(p, [0, 1], [0.94, 1])})`;
    case 'zoom-out':    return `scale(${interpolate(p, [0, 1], [1.06, 1])})`;
    default:            return 'none';
  }
}

/**
 * CSS transform for the EXIT phase (outProgress 0→1, eased-in).
 * Returns 'none' for 'fade' and 'cut'.
 */
function outTransform(type: string, p: number): string {
  switch (type) {
    case 'slide-left':  return `translateX(${interpolate(p, [0, 1], [0, -42])}%)`;
    case 'slide-right': return `translateX(${interpolate(p, [0, 1], [0,  42])}%)`;
    case 'zoom-in':     return `scale(${interpolate(p, [0, 1], [1, 1.08])})`;
    case 'zoom-out':    return `scale(${interpolate(p, [0, 1], [1, 0.94])})`;
    default:            return 'none';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SceneTransition
// ─────────────────────────────────────────────────────────────────────────────

export const SceneTransition: React.FC<SceneTransitionProps> = ({
  children,
  durationInFrames,
  inType    = 'cut',
  inDuration  = 0,
  outType   = 'cut',
  outDuration = 0,
}) => {
  const frame = useCurrentFrame();

  const effectiveInType  = inType  ?? 'cut';
  const effectiveOutType = outType ?? 'cut';

  // ── Entry phase ────────────────────────────────────────────────────────────
  // Active while frame < inDuration and the type is not 'cut'.
  const hasIn      = effectiveInType !== 'cut' && inDuration > 0;
  const inRaw      = hasIn ? Math.min(frame / inDuration, 1) : 1;
  const inProgress = easeOut(inRaw);                   // 0→1 ease-out
  const inActive   = hasIn && inRaw < 1;

  // ── Exit phase ─────────────────────────────────────────────────────────────
  // Starts at (durationInFrames - outDuration). In-phase takes priority.
  const hasOut     = effectiveOutType !== 'cut' && outDuration > 0;
  const outStart   = durationInFrames - outDuration;
  const outRaw     = hasOut ? Math.max(0, Math.min((frame - outStart) / outDuration, 1)) : 0;
  const outProgress = easeIn(outRaw);                  // 0→1 ease-in
  const outActive  = hasOut && !inActive && outRaw > 0;

  // ── Compute opacity ────────────────────────────────────────────────────────
  // All non-cut transitions fade alongside their transform for smooth blends.
  let opacity = 1;
  if (inActive) {
    opacity = inProgress;         // fade in: 0→1
  } else if (outActive) {
    opacity = 1 - outProgress;    // fade out: 1→0
  }

  // ── Compute CSS transform ──────────────────────────────────────────────────
  let transform = 'none';
  if (inActive) {
    transform = inTransform(effectiveInType, inProgress);
  } else if (outActive) {
    transform = outTransform(effectiveOutType, outProgress);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        position:        'absolute',
        inset:           0,
        opacity,
        transform,
        transformOrigin: 'center center',
        // hint browser GPU for the animated properties
        willChange:      opacity !== 1 || transform !== 'none' ? 'transform, opacity' : 'auto',
      }}
    >
      {children}
    </div>
  );
};
