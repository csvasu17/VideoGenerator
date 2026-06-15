import React from 'react';
import {useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {theme} from '../config/theme';
import {glowPulse} from '../utils/animations';

interface Props {
  value: number;
  suffix?: string;
  label: string;
  description?: string;
  accent?: 'blue' | 'orange';
  delay?: number;
  decimals?: number;
}

export const KPICounter: React.FC<Props> = ({value, suffix='', label, description, accent='blue', delay=0, decimals=0}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const appear = spring({fps, frame: frame-delay, config:{damping:25,mass:1,stiffness:80,overshootClamping:false}, durationInFrames:45});
  const countProgress = spring({fps, frame: frame-delay-10, config:{damping:20,stiffness:55,mass:1,overshootClamping:false}, durationInFrames:90});
  const currentVal = interpolate(countProgress,[0,1],[0,value],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  const pulse = glowPulse(frame, fps, 0.4);

  const accentColor = accent === 'blue' ? theme.colors.blue.primary : theme.colors.orange.primary;
  const accentGlow  = accent === 'blue' ? theme.colors.blue.glow   : theme.colors.orange.glow;
  const accentSubtle= accent === 'blue' ? theme.colors.blue.subtle  : theme.colors.orange.subtle;

  const displayVal = decimals > 0 ? currentVal.toFixed(decimals) : Math.floor(currentVal).toString();

  return (
    <div style={{
      opacity: interpolate(appear,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
      transform: `translateY(${interpolate(appear,[0,1],[40,0])}px) scale(${interpolate(appear,[0,1],[0.9,1])})`,
      background: theme.colors.backgroundCard,
      border: `1px solid ${theme.colors.border.normal}`,
      borderRadius: theme.radius.lg,
      padding: '40px 36px',
      display:'flex', flexDirection:'column', gap:12,
      position:'relative', overflow:'hidden',
      boxShadow: `0 20px 60px rgba(0,0,0,0.35), 0 0 80px ${accentGlow}`,
      textAlign:'center', alignItems:'center',
    }}>
      <div style={{
        position:'absolute', inset:0,
        background: `radial-gradient(circle at 50% 30%, ${accentSubtle} 0%, transparent 70%)`,
        opacity: 0.8 + pulse * 0.2,
      }}/>
      <div style={{
        position:'absolute', top:0, left:0, right:0, height:3,
        background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)`,
      }}/>
      <div style={{
        fontFamily: theme.fonts.heading,
        fontSize: 80, fontWeight:800,
        letterSpacing:'-0.04em', lineHeight:1,
        color: theme.colors.text.primary,
        textShadow: `0 0 40px ${accentGlow}`,
        position:'relative',
      }}>
        {displayVal}
        <span style={{fontSize:48, fontWeight:700, color: accentColor}}>{suffix}</span>
      </div>
      <div style={{fontFamily:theme.fonts.heading, fontSize:20, fontWeight:600, color:theme.colors.text.primary, position:'relative'}}>
        {label}
      </div>
      {description && (
        <div style={{fontFamily:theme.fonts.body, fontSize:15, fontWeight:400, color:theme.colors.text.secondary, lineHeight:1.5, position:'relative', maxWidth:240}}>
          {description}
        </div>
      )}
    </div>
  );
};
