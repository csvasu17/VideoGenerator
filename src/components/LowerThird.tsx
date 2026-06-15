import React from 'react';
import {useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {theme} from '../config/theme';

interface Props {
  title: string;
  subtitle?: string;
  delay?: number;
  accent?: 'blue' | 'orange';
}

export const LowerThird: React.FC<Props> = ({title, subtitle, delay = 0, accent = 'blue'}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const p = spring({fps, frame: frame - delay, config:{damping:25,mass:1,stiffness:100,overshootClamping:false}, durationInFrames:40});
  const accentColor = accent === 'blue' ? theme.colors.blue.primary : theme.colors.orange.primary;
  const glowColor = accent === 'blue' ? theme.colors.blue.glow : theme.colors.orange.glow;

  return (
    <div style={{
      position:'absolute', bottom:120, left:80,
      opacity: interpolate(p,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
      transform: `translateX(${interpolate(p,[0,1],[-60,0])}px)`,
    }}>
      <div style={{display:'flex', alignItems:'stretch', gap:0}}>
        {/* Accent bar */}
        <div style={{
          width:5, borderRadius:3,
          background: `linear-gradient(180deg, ${accentColor} 0%, transparent 100%)`,
          boxShadow: `0 0 12px ${glowColor}`,
          marginRight: 20,
          transform: `scaleY(${p})`,
          transformOrigin:'top center',
        }}/>
        <div style={{display:'flex', flexDirection:'column', gap:6}}>
          <div style={{
            fontFamily: theme.fonts.heading,
            fontSize: 32, fontWeight:700,
            color: theme.colors.text.primary,
            letterSpacing:'-0.02em',
          }}>
            {title}
          </div>
          {subtitle && (
            <div style={{
              fontFamily: theme.fonts.body,
              fontSize: 20, fontWeight:400,
              color: theme.colors.text.secondary,
              letterSpacing:'0.02em',
            }}>
              {subtitle}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
