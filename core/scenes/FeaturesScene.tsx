import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {AnimatedBackground} from '../components/AnimatedBackground';
import {FeatureCard} from '../components/FeatureCard';
import {useTheme} from '../themes';
import {sceneFade} from '../utils/transitions';
import type {FeatureCard as FeatureCardType} from '../types';

interface FeaturesSceneProps {
  features: FeatureCardType[];
  heading?: string;
  subheading?: string;
}

export const FeaturesScene: React.FC<FeaturesSceneProps> = ({features, heading, subheading}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const theme = useTheme();
  const sceneOpacity = sceneFade(frame, durationInFrames, 40, 40);
  const headP = spring({fps, frame:frame-20, config:{damping:25,mass:1,stiffness:80}, durationInFrames:45});

  return (
    <AbsoluteFill style={{opacity: sceneOpacity}}>
      <AnimatedBackground variant="default" />
      <AbsoluteFill style={{padding:'80px 100px', display:'flex', flexDirection:'column', gap:36}}>
        {(heading || subheading) && (
          <div style={{
            opacity: interpolate(headP,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
            transform: 'translateY(' + interpolate(headP,[0,1],[28,0]) + 'px)',
            display:'flex', flexDirection:'column', gap:8,
          }}>
            {heading && (
              <div style={{fontFamily:theme.fonts.heading,fontSize:46,fontWeight:800,letterSpacing:'-0.03em',color:theme.colors.text.primary,lineHeight:1.1}}>
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
        <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:22, flex:1, alignContent:'start'}}>
          {features.map((f, i) => (
            <FeatureCard key={i} icon={f.icon} title={f.title} description={f.description} accent={f.accent} delay={50 + i*10} index={i} />
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
