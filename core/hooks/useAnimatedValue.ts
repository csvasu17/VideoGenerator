import {useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import type {SpringConfig} from 'remotion';

export function useSpring(
  config: SpringConfig = {damping:25, mass:1, stiffness:80, overshootClamping:false},
  delay = 0,
  durationInFrames = 40,
) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({fps, frame: frame - delay, config, durationInFrames});
}

export function useFadeIn(delay = 0, dur = 30) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({fps, frame: frame - delay, config: {damping:40,mass:1.2,stiffness:60,overshootClamping:false}, durationInFrames: dur});
}

export function useSlideUp(delay = 0, distance = 60) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = spring({fps, frame: frame - delay, config: {damping:25,mass:1,stiffness:80,overshootClamping:false}, durationInFrames:40});
  return {
    opacity: interpolate(p,[0,1],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}) as number,
    translateY: interpolate(p,[0,1],[distance,0]) as number,
  };
}

export function useCounter(target: number, delay = 0, dur = 90) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = spring({fps, frame: frame - delay, config:{damping:20,stiffness:60,mass:1,overshootClamping:false}, durationInFrames:dur});
  return interpolate(p,[0,1],[0,target],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
}
