import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {AnimatedBackground} from '../../components/AnimatedBackground';
import {FeatureCard} from '../../components/FeatureCard';
import {theme} from '../../config/theme';
import {sceneFade} from '../../utils/transitions';
import videoConfig from '../../config/videoConfig.json';

export const FeaturesScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const sceneOpacity = sceneFade(frame, durationInFrames, 40, 40);

  const headP = spring({fps, frame:frame-20, config:{damping:25,mass:1,stiffness:80}, durationInFrames:45});

  return (
    <AbsoluteFill style={{opacity: sceneOpacity}}>
      <AnimatedBackground variant="default" />

      <AbsoluteFill style={{padding:'80px 100px', display:'flex', flexDirection:'column', gap:40}}>
        {/* Header */}
        <div style={{
          opacity: interpolate(headP,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
          transform: `translateY(${interpolate(headP,[0,1],[30,0])}px)`,
          display:'flex', flexDirection:'column', gap:12,
        }}>
          <div style={{
            display:'inline-flex', alignItems:'center', gap:10,
            background:theme.colors.blue.subtle, border:`1px solid ${theme.colors.border.blue}`,
            borderRadius:theme.radius.full, padding:'8px 20px', alignSelf:'flex-start',
          }}>
            <div style={{width:6,height:6,borderRadius:'50%',background:theme.colors.blue.primary}}/>
            <span style={{fontFamily:theme.fonts.body,fontSize:14,fontWeight:600,color:theme.colors.text.accent,letterSpacing:'0.1em',textTransform:'uppercase'}}>
              Platform Capabilities
            </span>
          </div>
          <div style={{fontFamily:theme.fonts.heading,fontSize:48,fontWeight:800,letterSpacing:'-0.03em',color:theme.colors.text.primary}}>
            Everything You Need to{' '}
            <span style={{background:`linear-gradient(135deg,${theme.colors.blue.light},${theme.colors.orange.primary})`,WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>
              Operate at Scale
            </span>
          </div>
        </div>

        {/* Features grid */}
        <div style={{
          display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:24, flex:1, alignContent:'start',
        }}>
          {videoConfig.features.map((f, i) => (
            <FeatureCard
              key={i}
              icon={f.icon}
              title={f.title}
              description={f.description}
              accent={f.accent as 'blue'|'orange'}
              delay={60 + i * 12}
              index={i}
            />
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
