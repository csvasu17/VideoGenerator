import {interpolate} from 'remotion';
import type {CSSProperties} from 'react';

export type TransitionType = 'fade'|'slideUp'|'slideLeft'|'slideRight'|'scale'|'blur'|'none';

export function inTransition(frame: number, durationInFrames: number, type: TransitionType = 'fade'): CSSProperties {
  const p = Math.min(Math.max(frame / durationInFrames, 0), 1);
  switch (type) {
    case 'fade':       return {opacity: p};
    case 'slideUp':    return {opacity: Math.min(p*2,1), transform: `translateY(${interpolate(p,[0,1],[50,0])}px)`};
    case 'slideLeft':  return {opacity: Math.min(p*2,1), transform: `translateX(${interpolate(p,[0,1],[-70,0])}px)`};
    case 'slideRight': return {opacity: Math.min(p*2,1), transform: `translateX(${interpolate(p,[0,1],[70,0])}px)`};
    case 'scale':      return {opacity: Math.min(p*2,1), transform: `scale(${interpolate(p,[0,1],[0.88,1])})`};
    case 'blur':       return {opacity: p, filter: `blur(${interpolate(p,[0,1],[24,0])}px)`};
    default:           return {};
  }
}

export function outTransition(frame: number, totalFrames: number, outDuration: number, type: TransitionType = 'fade'): CSSProperties {
  const outStart = totalFrames - outDuration;
  if (frame < outStart) return {};
  const p = 1 - Math.min((frame - outStart) / outDuration, 1);
  switch (type) {
    case 'fade':    return {opacity: p};
    case 'slideUp': return {opacity: p, transform: `translateY(${interpolate(p,[0,1],[-40,0])}px)`};
    case 'blur':    return {opacity: p, filter: `blur(${interpolate(p,[1,0],[0,20])}px)`};
    default:        return {opacity: p};
  }
}

export function sceneFade(frame: number, durationInFrames: number, inDur = 30, outDur = 30): number {
  const fadeIn  = Math.min(frame / inDur, 1);
  const fadeOut = Math.min((durationInFrames - frame) / outDur, 1);
  return Math.min(fadeIn, fadeOut);
}

// ─── Cinematic cross-scene transition engine ──────────────────────────────────

const eo = (t: number) => 1 - Math.pow(1 - Math.min(t,1), 3);
const ei = (t: number) => Math.pow(Math.min(t,1), 3);
const eio4 = (t: number) => { const c = Math.min(t,1); return c < 0.5 ? 8*c*c*c*c : 1 - Math.pow(-2*c+2,4)/2; };

/**
 * Drop-in replacement for sceneFade with quartic easing — dramatically smoother.
 */
export function cinematicFade(frame: number, durationInFrames: number, inDur = 30, outDur = 30): number {
  const tIn  = Math.max(Math.min(frame / inDur, 1), 0);
  const tOut = Math.max(Math.min((durationInFrames - frame) / outDur, 1), 0);
  return Math.min(eio4(tIn), eio4(tOut));
}

/**
 * Scene ENTER transform — scale 0.92 → 1.0 as scene enters.
 * progress 0→1: scene settling into place.
 * 20 frames at 30fps = 40 frames at 60fps.
 */
export function sceneEnterTransform(progress: number, _type?: string): CSSProperties {
  const p = eio4(Math.max(0, Math.min(progress, 1)));
  const scale = 0.92 + p * 0.08;   // 0.92 → 1.0
  return {transform: `scale(${scale.toFixed(5)})`};
}

/**
 * Scene EXIT transform — scale 1.0 → 1.05 as scene pushes forward and fades out.
 * progress 0→1: scene is leaving.
 */
export function sceneExitTransform(progress: number, _type?: string): CSSProperties {
  const p = eio4(Math.max(0, Math.min(progress, 1)));
  const scale = 1.0 + p * 0.05;    // 1.0 → 1.05
  return {transform: `scale(${scale.toFixed(5)})`};
}

// ─── New fintech-style transitions ───────────────────────────────────────────

/**
 * Zoom-through transition — creates a "portal" feel between scenes.
 *
 * direction 'in'  → outgoing scene scales UP and blurs out (camera plunging in)
 * direction 'out' → incoming scene starts scaled up and settles to normal
 *
 * @param progress  0→1 transition progress
 * @param direction 'in' for the exiting scene, 'out' for the entering scene
 */
export function zoomThrough(progress: number, direction: 'in' | 'out' = 'in'): CSSProperties {
  const t = Math.min(Math.max(progress, 0), 1);
  if (direction === 'in') {
    // Exiting: scale up + blur + fade
    const p = eio4(t);
    return {
      transform: `scale(${1 + p * 0.14})`,
      filter: p > 0.05 ? `blur(${p * 10}px)` : 'none',
      opacity: 1 - p,
    };
  } else {
    // Entering: start scaled up, settle to 1 + fade in
    const p = 1 - eio4(t);
    return {
      transform: `scale(${1 + p * 0.14})`,
      filter: p > 0.05 ? `blur(${p * 10}px)` : 'none',
      opacity: 1 - p * 0.9,
    };
  }
}

/**
 * Wipe reveal — horizontal clip-path sweep, left-to-right or right-to-left.
 * Apply to the incoming scene to reveal it from one edge to the other.
 *
 * @param progress  0→1 reveal progress
 * @param direction 'ltr' (default) or 'rtl'
 */
export function wipeReveal(progress: number, direction: 'ltr' | 'rtl' = 'ltr'): CSSProperties {
  const p = eio4(Math.min(Math.max(progress, 0), 1));
  if (direction === 'ltr') {
    return {clipPath: `inset(0 ${((1 - p) * 100).toFixed(2)}% 0 0)`};
  } else {
    return {clipPath: `inset(0 0 0 ${((1 - p) * 100).toFixed(2)}%)`};
  }
}

/**
 * Combined scene presence style: enter + exit transforms in one call.
 * Use alongside cinematicFade for opacity.
 */
export function scenePresenceStyle(
  frame: number,
  total: number,
  transIn: number,
  transOut: number,
  enterType: Parameters<typeof sceneEnterTransform>[1] = 'fade-up',
  exitType:  Parameters<typeof sceneExitTransform>[1]  = 'push-left',
): CSSProperties {
  if (frame < transIn) return sceneEnterTransform(frame / transIn, enterType);
  if (frame > total - transOut) return sceneExitTransform((frame - (total - transOut)) / transOut, exitType);
  return {};
}
