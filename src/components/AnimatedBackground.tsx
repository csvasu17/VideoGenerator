import React from 'react';
import {useCurrentFrame, useVideoConfig, interpolate} from 'remotion';
import {glowPulse} from '../utils/animations';
import {theme} from '../config/theme';

interface Props {
  variant?: 'default' | 'intense' | 'subtle';
}

export const AnimatedBackground: React.FC<Props> = ({variant = 'default'}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const pulse = glowPulse(frame, fps, 0.3);
  const pulse2 = glowPulse(frame, fps, 0.2);

  const blueOpacity = variant === 'intense' ? 0.18 : variant === 'subtle' ? 0.06 : 0.11;
  const orangeOpacity = variant === 'intense' ? 0.12 : variant === 'subtle' ? 0.04 : 0.07;

  return (
    <div style={{position:'absolute', inset:0, background: theme.colors.background, overflow:'hidden'}}>
      {/* Ambient blue orb - top left */}
      <div style={{
        position:'absolute', top:'-20%', left:'-10%',
        width:900, height:900, borderRadius:'50%',
        background: `radial-gradient(circle, rgba(0,102,255,${blueOpacity + pulse*0.05}) 0%, transparent 70%)`,
        filter: 'blur(60px)',
      }}/>
      {/* Ambient orange orb - bottom right */}
      <div style={{
        position:'absolute', bottom:'-20%', right:'-10%',
        width:800, height:800, borderRadius:'50%',
        background: `radial-gradient(circle, rgba(255,107,0,${orangeOpacity + pulse2*0.04}) 0%, transparent 70%)`,
        filter: 'blur(60px)',
      }}/>
      {/* Center blue orb */}
      <div style={{
        position:'absolute', top:'30%', left:'40%',
        width:600, height:600, borderRadius:'50%',
        background: `radial-gradient(circle, rgba(0,102,255,${blueOpacity * 0.4}) 0%, transparent 70%)`,
        filter: 'blur(80px)',
      }}/>
      {/* Grid overlay */}
      <div style={{
        position:'absolute', inset:0,
        backgroundImage: `linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)`,
        backgroundSize: '80px 80px',
        opacity: 0.6,
      }}/>
      {/* Vignette */}
      <div style={{
        position:'absolute', inset:0,
        background: 'radial-gradient(ellipse 80% 80% at 50% 50%, transparent 40%, rgba(0,0,0,0.6) 100%)',
      }}/>
    </div>
  );
};
