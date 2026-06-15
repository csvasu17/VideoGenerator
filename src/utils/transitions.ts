import {interpolate} from 'remotion';
import type {CSSProperties} from 'react';

export type TransitionType = 'fade'|'slideUp'|'slideLeft'|'slideRight'|'scale'|'blur'|'none';

export function inTransition(
  frame: number,
  durationInFrames: number,
  type: TransitionType = 'fade',
): CSSProperties {
  const p = Math.min(Math.max(frame / durationInFrames, 0), 1);
  switch (type) {
    case 'fade':
      return {opacity: p};
    case 'slideUp':
      return {opacity: Math.min(p*2,1), transform: `translateY(${interpolate(p,[0,1],[50,0])}px)`};
    case 'slideLeft':
      return {opacity: Math.min(p*2,1), transform: `translateX(${interpolate(p,[0,1],[-70,0])}px)`};
    case 'slideRight':
      return {opacity: Math.min(p*2,1), transform: `translateX(${interpolate(p,[0,1],[70,0])}px)`};
    case 'scale':
      return {opacity: Math.min(p*2,1), transform: `scale(${interpolate(p,[0,1],[0.88,1])})`};
    case 'blur':
      return {opacity: p, filter: `blur(${interpolate(p,[0,1],[24,0])}px)`};
    default:
      return {};
  }
}

export function outTransition(
  frame: number,
  totalFrames: number,
  outDuration: number,
  type: TransitionType = 'fade',
): CSSProperties {
  const outStart = totalFrames - outDuration;
  if (frame < outStart) return {};
  const p = 1 - Math.min((frame - outStart) / outDuration, 1);
  switch (type) {
    case 'fade':
      return {opacity: p};
    case 'slideUp':
      return {opacity: p, transform: `translateY(${interpolate(p,[0,1],[-40,0])}px)`};
    case 'blur':
      return {opacity: p, filter: `blur(${interpolate(p,[1,0],[0,20])}px)`};
    default:
      return {opacity: p};
  }
}

export function sceneFade(
  frame: number,
  durationInFrames: number,
  inDur = 30,
  outDur = 30,
): number {
  const fadeIn = Math.min(frame / inDur, 1);
  const fadeOut = Math.min((durationInFrames - frame) / outDur, 1);
  return Math.min(fadeIn, fadeOut);
}
