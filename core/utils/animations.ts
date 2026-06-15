import {interpolate, spring} from 'remotion';
import type {SpringConfig} from 'remotion';

export const Springs = {
  default:   {damping:20, mass:1,   stiffness:100, overshootClamping:false} as SpringConfig,
  snappy:    {damping:30, mass:0.8, stiffness:200, overshootClamping:true}  as SpringConfig,
  gentle:    {damping:40, mass:1.2, stiffness:60,  overshootClamping:false} as SpringConfig,
  cinematic: {damping:25, mass:1,   stiffness:80,  overshootClamping:false} as SpringConfig,
  bounce:    {damping:12, mass:0.9, stiffness:180, overshootClamping:false} as SpringConfig,
  impact:    {damping:14, mass:0.7, stiffness:280, overshootClamping:false} as SpringConfig,
  swell:     {damping:60, mass:2.2, stiffness:30,  overshootClamping:false} as SpringConfig,
};

export function makeSpring(frame: number, fps: number, config: SpringConfig = Springs.cinematic, delay = 0, durationInFrames = 40) {
  return spring({fps, frame: frame - delay, config, durationInFrames});
}

export function fadeIn(frame: number, fps: number, delay = 0, dur = 30) {
  return makeSpring(frame, fps, Springs.gentle, delay, dur);
}

export function slideUp(frame: number, fps: number, delay = 0, distance = 60) {
  const p = makeSpring(frame, fps, Springs.cinematic, delay);
  return {
    opacity: interpolate(p, [0,1], [0,1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'}),
    translateY: interpolate(p, [0,1], [distance, 0]),
  };
}

export function slideIn(frame: number, fps: number, delay = 0, distance = 80, axis: 'x'|'y' = 'x') {
  const p = makeSpring(frame, fps, Springs.cinematic, delay);
  return {
    opacity: interpolate(p, [0,0.2,1], [0,1,1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'}),
    translate: interpolate(p, [0,1], [-distance, 0]),
    axis,
  };
}

export function scaleIn(frame: number, fps: number, delay = 0, from = 0.85) {
  const p = makeSpring(frame, fps, Springs.default, delay);
  return {
    opacity: interpolate(p, [0,0.4,1], [0,0.9,1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'}),
    scale: interpolate(p, [0,1], [from, 1]),
  };
}

export function counter(frame: number, fps: number, target: number, delay = 0, dur = 90) {
  const p = makeSpring(frame, fps, {damping:20,stiffness:60,mass:1,overshootClamping:false}, delay, dur);
  return interpolate(p, [0,1], [0, target], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
}

export function glowPulse(frame: number, fps: number, speed = 1) {
  return Math.sin((frame / fps) * Math.PI * speed) * 0.5 + 0.5;
}

export function floatY(frame: number, fps: number, amplitude = 8, speed = 0.4) {
  return Math.sin((frame / fps) * Math.PI * 2 * speed) * amplitude;
}

export function rotateLoop(frame: number, fps: number, rpm = 0.1) {
  return ((frame / fps) * rpm * 360) % 360;
}

export function staggerDelay(index: number, stagger = 8) {
  return index * stagger;
}

/** Impact punch: fast spring overshoot that settles at 1.0 */
export function impactScale(frame: number, fps: number, delay = 0): {scale: number; opacity: number} {
  const p = spring({fps, frame: frame - delay, config: Springs.impact, durationInFrames: 28});
  return {
    scale:   interpolate(p, [0,0.55,0.82,1], [0.72,1.08,0.97,1.0], {extrapolateLeft:'clamp', extrapolateRight:'clamp'}),
    opacity: interpolate(p, [0,0.12,1],       [0,1,1],              {extrapolateLeft:'clamp', extrapolateRight:'clamp'}),
  };
}

/** Slide from left with organic spring deceleration */
export function slideFromLeft(frame: number, fps: number, delay = 0, distance = 140): {opacity: number; translateX: number} {
  const p = spring({fps, frame: frame - delay, config: Springs.cinematic, durationInFrames: 32});
  return {
    opacity:    interpolate(p, [0,0.18,1], [0,1,1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'}),
    translateX: interpolate(p, [0,1], [-distance, 0]),
  };
}

/** Slide from right */
export function slideFromRight(frame: number, fps: number, delay = 0, distance = 140): {opacity: number; translateX: number} {
  const p = spring({fps, frame: frame - delay, config: Springs.cinematic, durationInFrames: 32});
  return {
    opacity:    interpolate(p, [0,0.18,1], [0,1,1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'}),
    translateX: interpolate(p, [0,1], [distance, 0]),
  };
}

/** Lissajous-style continuous drift for background ambient orbs */
export function orbDrift(frame: number, fps: number, phaseX = 0, phaseY = 1.04, radiusX = 90, radiusY = 55): {x: number; y: number} {
  const t = frame / fps;
  return {
    x: Math.sin(t * 0.21 + phaseX) * radiusX + Math.sin(t * 0.11 + phaseX * 0.7) * radiusX * 0.28,
    y: Math.cos(t * 0.17 + phaseY) * radiusY + Math.cos(t * 0.08 + phaseY * 0.6) * radiusY * 0.35,
  };
}

/** Per-word stagger: opacity + vertical offset for word at wordIndex */
export function wordStagger(frame: number, fps: number, wordIndex: number, baseDelay = 0, staggerFrames = 6): {opacity: number; translateY: number} {
  const delay = baseDelay + wordIndex * staggerFrames;
  const p = spring({fps, frame: frame - delay, config: {damping:22,mass:0.8,stiffness:210,overshootClamping:false}, durationInFrames: 20});
  return {
    opacity:    interpolate(p, [0,0.25,1], [0,1,1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'}),
    translateY: interpolate(p, [0,1], [22, 0]),
  };
}

/** Slow horizontal camera drift for ambient parallax */
export function cameraDrift(frame: number, fps: number, amplitude = 5, speed = 0.07, phase = 0): number {
  return Math.sin((frame / fps) * Math.PI * 2 * speed + phase) * amplitude;
}

/** Sweep reveal: 0→1 progress for a left-to-right line sweep */
export function sweepReveal(frame: number, startFrame: number, endFrame: number): number {
  return Math.min(Math.max((frame - startFrame) / (endFrame - startFrame), 0), 1);
}
