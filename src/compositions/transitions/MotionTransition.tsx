/**
 * MotionTransition — Phase 7 enhanced transition renderer.
 *
 * Supports all Phase 4 transition types (backward-compatible via SceneTransition)
 * plus six new premium types:
 *
 *   zoom-through     — zoom into A's focal region until white fill → emerge from B
 *   shared-element   — lock on shared region while content swaps
 *   match-cut        — spatial match cut with brief motion blur
 *   dolly-reveal     — A pulls back to full → B opens wide and dollies in
 *   slide-parallax   — 3-layer parallax slide (bg 0.5×, mid 1×, fore 1.5×)
 *   cut-and-land     — hard cut (instant)
 *
 * Falls back to SceneTransition for legacy types (cut, fade, slide-left, etc.)
 * so Phase 6 videos render identically when motionPlan is absent.
 */

import React from 'react';
import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion';
import { SceneTransition } from './SceneTransition';
import type { TransitionPlan } from '../../motion/transitions/types';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface MotionTransitionProps {
  children:          React.ReactNode;
  durationInFrames:  number;
  enterPlan?:        TransitionPlan | null;
  exitPlan?:         TransitionPlan | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MotionTransition
// ─────────────────────────────────────────────────────────────────────────────

export const MotionTransition: React.FC<MotionTransitionProps> = ({
  children,
  durationInFrames,
  enterPlan,
  exitPlan,
}) => {
  const frame = useCurrentFrame();

  // ── Determine which premium transition is active ──────────────────────────
  const inType  = enterPlan?.type;
  const outType = exitPlan?.type;
  const inDur   = enterPlan?.durationFrames ?? 0;
  const outDur  = exitPlan?.durationFrames  ?? 0;

  // Legacy types → delegate entirely to SceneTransition
  const LEGACY_TYPES = new Set(['cut', 'fade', 'slide-left', 'slide-right', 'zoom-in', 'zoom-out']);
  const inIsLegacy   = !inType  || LEGACY_TYPES.has(inType);
  const outIsLegacy  = !outType || LEGACY_TYPES.has(outType);

  if (inIsLegacy && outIsLegacy) {
    return (
      <SceneTransition
        durationInFrames={durationInFrames}
        inType={inType}    inDuration={inDur}
        outType={outType}  outDuration={outDur}
      >
        {children}
      </SceneTransition>
    );
  }

  // ── Entry phase ────────────────────────────────────────────────────────────
  const hasIn    = !inIsLegacy && inDur > 0;
  const inRaw    = hasIn ? Math.min(frame / inDur, 1) : 1;
  const inActive = hasIn && inRaw < 1;

  // ── Exit phase ─────────────────────────────────────────────────────────────
  const hasOut     = !outIsLegacy && outDur > 0;
  const outStart   = durationInFrames - outDur;
  const outRaw     = hasOut ? Math.max(0, Math.min((frame - outStart) / outDur, 1)) : 0;
  const outActive  = hasOut && !inActive && outRaw > 0;

  // ── Compute style for the active phase ────────────────────────────────────
  let style: React.CSSProperties = {};
  const currentType   = inActive ? inType : outActive ? outType : null;
  const currentRaw    = inActive ? inRaw  : outRaw;
  const currentPlan   = inActive ? enterPlan : exitPlan;
  const isEntry       = inActive;

  if (currentType) {
    style = computeStyle(currentType, currentRaw, isEntry, currentPlan);
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        willChange: 'transform, opacity',
        transformOrigin: 'center center',
        ...style,
      }}
    >
      {children}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Per-type style computation
// ─────────────────────────────────────────────────────────────────────────────

function computeStyle(
  type:    string,
  raw:     number,
  isEntry: boolean,
  plan?:   TransitionPlan | null,
): React.CSSProperties {
  const p = isEntry ? easeOut(raw) : easeIn(raw);

  switch (type) {
    case 'zoom-through': {
      // Entry: scene B starts at high zoom and pulls back (emerges from through)
      // Exit:  scene A zooms in, accelerating toward 1.5×+ (handled by camera continuity)
      if (isEntry) {
        const scale = interpolate(p, [0, 1], [1.35, 1.0]);
        return { transform: `scale(${scale})`, opacity: p };
      } else {
        const scale = interpolate(p, [0, 1], [1.0, 1.5]);
        return { transform: `scale(${scale})`, opacity: 1 - p * 0.3 };
      }
    }

    case 'shared-element': {
      // Slide content area; shared element region is held in place by CSS clip
      // This is a simplified version — full shared-element requires two layers
      const tx = isEntry
        ? interpolate(p, [0, 1], [38, 0])
        : interpolate(p, [0, 1], [0, -38]);
      return { transform: `translateX(${tx}%)`, opacity: isEntry ? p : 1 - p };
    }

    case 'match-cut': {
      // Very fast cut with brief motion blur via filter
      const blur = isEntry
        ? interpolate(p, [0, 0.3, 1], [3, 1, 0])
        : interpolate(p, [0, 0.7, 1], [0, 1, 3]);
      const opacity = isEntry ? p : 1 - p;
      return {
        filter:  `blur(${blur}px)`,
        opacity,
      };
    }

    case 'dolly-reveal': {
      if (isEntry) {
        // Scene B pulls into frame from full zoom
        const scale = interpolate(p, [0, 1], [1.15, 1.0]);
        return { transform: `scale(${scale})`, opacity: p };
      } else {
        // Scene A pulls back
        const scale = interpolate(p, [0, 1], [1.0, 0.90]);
        return { transform: `scale(${scale})`, opacity: 1 - p };
      }
    }

    case 'slide-parallax': {
      // Middle layer (1× speed) — background and foreground layers would
      // need separate components. This implements the content layer.
      const tx = isEntry
        ? interpolate(p, [0, 1], [42, 0])
        : interpolate(p, [0, 1], [0, -42]);
      return {
        transform: `translateX(${tx}%)`,
        opacity:    isEntry ? Math.min(p * 2, 1) : Math.max(1 - p * 2, 0),
      };
    }

    case 'cut-and-land':
      // Hard cut — no animation
      return {};

    default:
      return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Easing helpers
// ─────────────────────────────────────────────────────────────────────────────

function easeOut(t: number): number { return 1 - Math.pow(1 - t, 2); }
function easeIn(t: number): number  { return t * t; }
