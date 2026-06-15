import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {AnimatedBackground} from '../components/AnimatedBackground';
import {useTheme} from '../themes';
import {sceneFade} from '../utils/transitions';
import type {ProblemCard} from '../types';

interface ProblemCardItemProps {
  icon: string; title: string; description: string; delay: number;
}
const ProblemCardItem: React.FC<ProblemCardItemProps> = ({icon, title, description, delay}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const theme = useTheme();
  const p = spring({fps, frame: frame - delay, config:{damping:25,mass:1,stiffness:80,overshootClamping:false}, durationInFrames:45});
  return (
    <div style={{
      opacity: interpolate(p,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
      transform: 'translateX(' + interpolate(p,[0,1],[-50,0]) + 'px)',
      display:'flex', alignItems:'flex-start', gap:18,
      background: theme.colors.backgroundCard,
      border: '1px solid ' + theme.colors.border.normal,
      borderLeft: '3px solid rgba(255,80,80,0.5)',
      borderRadius: theme.radius.md,
      padding:'22px 26px',
      boxShadow:'0 8px 30px rgba(0,0,0,0.3)',
      position:'relative', overflow:'hidden',
    }}>
      <div style={{position:'absolute',top:0,left:0,right:0,bottom:0,background:'linear-gradient(90deg,rgba(255,60,60,0.03) 0%,transparent 40%)',pointerEvents:'none'}}/>
      <div style={{fontSize:28, flexShrink:0, marginTop:2}}>{icon}</div>
      <div style={{display:'flex', flexDirection:'column', gap:5}}>
        <div style={{fontFamily:theme.fonts.heading,fontSize:18,fontWeight:700,color:theme.colors.text.primary}}>{title}</div>
        <div style={{fontFamily:theme.fonts.body,fontSize:14,fontWeight:400,color:theme.colors.text.secondary,lineHeight:1.6}}>{description}</div>
      </div>
    </div>
  );
};

interface ProblemSceneProps {
  problems: ProblemCard[];
  heading?: string;
  subheading?: string;
}

export const ProblemScene: React.FC<ProblemSceneProps> = ({
  problems,
  heading,
  subheading,
}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const theme = useTheme();
  const sceneOpacity = sceneFade(frame, durationInFrames, 40, 40);
  const headP = spring({fps, frame:frame-20, config:{damping:25,mass:1,stiffness:80}, durationInFrames:45});

  return (
    <AbsoluteFill style={{opacity: sceneOpacity}}>
      <AnimatedBackground variant="default" />
      <AbsoluteFill style={{padding:'90px 110px', display:'flex', flexDirection:'column', gap:44}}>
        {(heading || subheading) && (
          <div style={{
            opacity: interpolate(headP,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
            transform: 'translateY(' + interpolate(headP,[0,1],[28,0]) + 'px)',
            display:'flex', flexDirection:'column', gap:10,
          }}>
            {heading && (
              <div style={{fontFamily:theme.fonts.heading,fontSize:48,fontWeight:800,letterSpacing:'-0.03em',color:theme.colors.text.primary,lineHeight:1.1}}>
                {heading}
              </div>
            )}
            {subheading && (
              <div style={{fontFamily:theme.fonts.body,fontSize:20,fontWeight:400,color:theme.colors.text.secondary}}>
                {subheading}
              </div>
            )}
          </div>
        )}
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, flex:1, alignContent:'start'}}>
          {problems.map((prob, i) => (
            <ProblemCardItem key={i} icon={prob.icon} title={prob.title} description={prob.description} delay={50 + i*12} />
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
