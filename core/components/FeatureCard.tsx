import React from 'react';
import {useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {useTheme} from '../themes';
import {floatY} from '../utils/animations';

interface Props {
  icon: string;
  title: string;
  description: string;
  accent?: 'blue' | 'orange';
  delay?: number;
  index?: number;
}

export const FeatureCard: React.FC<Props> = ({icon, title, description, accent='blue', delay=0, index=0}) => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const p = spring({fps, frame: frame - delay, config:{damping:25,mass:1,stiffness:80,overshootClamping:false}, durationInFrames:45});
  const float = floatY(frame, fps, 6, 0.3 + index * 0.07);

  const accentColor = accent === 'blue' ? theme.colors.blue.primary : theme.colors.orange.primary;
  const accentGlow  = accent === 'blue' ? theme.colors.blue.glow   : theme.colors.orange.glow;
  const accentSubtle= accent === 'blue' ? theme.colors.blue.subtle  : theme.colors.orange.subtle;

  return (
    <div style={{
      opacity: interpolate(p,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
      transform: `translateY(${interpolate(p,[0,1],[50,0]) + float}px) scale(${interpolate(p,[0,1],[0.9,1])})`,
      background: theme.colors.backgroundCard,
      border: `1px solid ${theme.colors.border.normal}`,
      borderRadius: theme.radius.lg,
      padding: '36px 32px',
      display:'flex', flexDirection:'column', gap:16,
      position:'relative', overflow:'hidden',
      boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
      cursor:'default',
    }}>
      {/* Top accent line */}
      <div style={{
        position:'absolute', top:0, left:0, right:0, height:2,
        background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)`,
        opacity: 0.8,
      }}/>
      {/* Glow bg */}
      <div style={{
        position:'absolute', top:'-30%', left:'-10%',
        width:'60%', height:'60%',
        background: `radial-gradient(circle, ${accentSubtle} 0%, transparent 70%)`,
        filter:'blur(30px)',
        pointerEvents:'none',
      }}/>
      {/* Icon */}
      <div style={{
        width:56, height:56, borderRadius:14,
        background: accentSubtle,
        border: `1px solid ${accentGlow}`,
        display:'flex', alignItems:'center', justifyContent:'center',
        fontSize:28,
        boxShadow: `0 0 20px ${accentGlow}`,
      }}>
        {icon}
      </div>
      <div style={{fontFamily:theme.fonts.heading, fontSize:22, fontWeight:700, color:theme.colors.text.primary, letterSpacing:'-0.01em'}}>
        {title}
      </div>
      <div style={{fontFamily:theme.fonts.body, fontSize:16, fontWeight:400, color:theme.colors.text.secondary, lineHeight:1.6}}>
        {description}
      </div>
    </div>
  );
};
