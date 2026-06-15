import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {sceneFade} from '../utils/transitions';

interface Props {
  children: React.ReactNode;
  durationInFrames: number;
  inDuration?: number;
  outDuration?: number;
}

export const TransitionWrapper: React.FC<Props> = ({children, durationInFrames, inDuration=30, outDuration=30}) => {
  const frame = useCurrentFrame();
  const opacity = sceneFade(frame, durationInFrames, inDuration, outDuration);
  return (
    <div style={{width:'100%', height:'100%', opacity, position:'relative'}}>
      {children}
    </div>
  );
};
