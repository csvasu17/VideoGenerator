import {useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import type {SpringConfig} from 'remotion';

interface StaggerOptions {
  count: number;
  staggerFrames?: number;
  startFrame?: number;
  config?: SpringConfig;
  durationInFrames?: number;
}

export function useStagger({
  count,
  staggerFrames = 8,
  startFrame = 0,
  config = {damping:25,mass:1,stiffness:80,overshootClamping:false},
  durationInFrames = 40,
}: StaggerOptions) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return Array.from({length: count}, (_, i) => {
    const delay = startFrame + i * staggerFrames;
    const p = spring({fps, frame: frame - delay, config, durationInFrames});
    return {
      progress: p,
      opacity: interpolate(p,[0,1],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}) as number,
      translateY: interpolate(p,[0,1],[40,0]) as number,
      scale: interpolate(p,[0,1],[0.9,1]) as number,
    };
  });
}
