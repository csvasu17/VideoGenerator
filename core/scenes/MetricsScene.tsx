import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {AnimatedBackground} from '../components/AnimatedBackground';
import {KPICounter} from '../components/KPICounter';
import {useTheme} from '../themes';
import {sceneFade} from '../utils/transitions';
import {glowPulse} from '../utils/animations';
import type {MetricCard} from '../types';

const MiniGraph: React.FC<{accent:'blue'|'orange'; delay:number}> = ({accent, delay}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const theme = useTheme();
  const p = spring({fps, frame:frame-delay, config:{damping:20,mass:1,stiffness:60}, durationInFrames:80});
  const color = accent==='blue' ? theme.colors.blue.primary : theme.colors.orange.primary;
  const points = [0.2,0.35,0.25,0.5,0.4,0.65,0.55,0.8,0.7,1.0];
  const w=120, h=36;
  const pts = points.map((v,i) => ((i/(points.length-1))*w) + ',' + (h - v*h*p)).join(' ');
  return (
    <svg width={w} height={h} style={{opacity:0.5}}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round"/>
      <circle cx={w} cy={h - points[points.length-1]*h*p} r={3} fill={color}/>
    </svg>
  );
};

interface MetricsSceneProps {
  metrics: MetricCard[];
  heading?: string;
  subheading?: string;
  attribution?: string;
}

export const MetricsScene: React.FC<MetricsSceneProps> = ({metrics, heading, subheading, attribution}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const theme = useTheme();
  const sceneOpacity = sceneFade(frame, durationInFrames, 40, 40);
  const pulse = glowPulse(frame, fps, 0.3);
  const headP = spring({fps, frame:frame-20, config:{damping:25,mass:1,stiffness:80}, durationInFrames:45});

  return (
    <AbsoluteFill style={{opacity: sceneOpacity}}>
      <AnimatedBackground variant="intense" />
      <AbsoluteFill style={{padding:'70px 100px', display:'flex', flexDirection:'column', gap:40}}>
        {(heading || subheading) && (
          <div style={{
            opacity: interpolate(headP,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
            transform: 'translateY(' + interpolate(headP,[0,1],[28,0]) + 'px)',
            textAlign:'center', display:'flex', flexDirection:'column', gap:8,
          }}>
            {heading && (
              <div style={{fontFamily:theme.fonts.heading,fontSize:48,fontWeight:800,letterSpacing:'-0.03em',color:theme.colors.text.primary}}>
                {heading}
              </div>
            )}
            {subheading && (
              <div style={{fontFamily:theme.fonts.body,fontSize:20,color:theme.colors.text.secondary}}>
                {subheading}
              </div>
            )}
          </div>
        )}
        <div style={{display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:22, flex:1, alignContent:'center'}}>
          {metrics.map((m, i) => (
            <div key={i} style={{display:'flex',flexDirection:'column',gap:14,alignItems:'center'}}>
              <KPICounter
                value={m.value} suffix={m.suffix} label={m.label}
                description={m.description} accent={m.accent}
                delay={50+i*18}
                decimals={m.decimals ?? (m.value % 1 !== 0 ? 1 : 0)}
              />
              <MiniGraph accent={m.accent} delay={90+i*18} />
            </div>
          ))}
        </div>
        {attribution && (
          <div style={{
            opacity: interpolate(spring({fps,frame:frame-280,config:{damping:30,mass:1,stiffness:80},durationInFrames:40}),[0,0.3,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
            textAlign:'center', fontFamily:theme.fonts.body,
            fontSize:13, color:theme.colors.text.tertiary, letterSpacing:'0.04em',
          }}>
            {attribution}
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
