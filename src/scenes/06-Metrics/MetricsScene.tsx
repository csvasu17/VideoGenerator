import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {AnimatedBackground} from '../../components/AnimatedBackground';
import {KPICounter} from '../../components/KPICounter';
import {theme} from '../../config/theme';
import {sceneFade} from '../../utils/transitions';
import {glowPulse} from '../../utils/animations';
import videoConfig from '../../config/videoConfig.json';

const MiniGraph: React.FC<{accent:'blue'|'orange';delay:number}> = ({accent,delay}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = spring({fps, frame:frame-delay, config:{damping:20,mass:1,stiffness:60}, durationInFrames:80});
  const color = accent==='blue' ? theme.colors.blue.primary : theme.colors.orange.primary;
  const points = [0.2,0.35,0.25,0.5,0.4,0.65,0.55,0.8,0.7,1.0];
  const w = 120, h = 40;
  const pts = points.map((v,i) => `${(i/(points.length-1))*w},${h - v*h*p}`).join(' ');

  return (
    <svg width={w} height={h} style={{opacity:0.6}}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round"/>
      <circle cx={(points.length-1)/(points.length-1)*w} cy={h - points[points.length-1]*h*p} r={3} fill={color}/>
    </svg>
  );
};

export const MetricsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const sceneOpacity = sceneFade(frame, durationInFrames, 40, 40);
  const pulse = glowPulse(frame, fps, 0.3);

  const headP = spring({fps, frame:frame-20, config:{damping:25,mass:1,stiffness:80}, durationInFrames:45});

  return (
    <AbsoluteFill style={{opacity: sceneOpacity}}>
      <AnimatedBackground variant="intense" />

      <AbsoluteFill style={{padding:'80px 100px', display:'flex', flexDirection:'column', gap:48}}>
        {/* Header */}
        <div style={{
          opacity: interpolate(headP,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
          transform: `translateY(${interpolate(headP,[0,1],[30,0])}px)`,
          textAlign:'center',
        }}>
          <div style={{
            display:'inline-flex', alignItems:'center', gap:10,
            background:theme.colors.blue.subtle, border:`1px solid ${theme.colors.border.blue}`,
            borderRadius:theme.radius.full, padding:'8px 20px', marginBottom:16,
          }}>
            <div style={{width:6,height:6,borderRadius:'50%',background:theme.colors.blue.primary,boxShadow:`0 0 6px ${theme.colors.blue.primary}`,opacity:0.7+pulse*0.3}}/>
            <span style={{fontFamily:theme.fonts.body,fontSize:14,fontWeight:600,color:theme.colors.text.accent,letterSpacing:'0.1em',textTransform:'uppercase'}}>
              Proven Results
            </span>
          </div>
          <div style={{fontFamily:theme.fonts.heading,fontSize:52,fontWeight:800,letterSpacing:'-0.03em',color:theme.colors.text.primary}}>
            Measurable Impact,{' '}
            <span style={{background:`linear-gradient(135deg,${theme.colors.blue.light},${theme.colors.orange.primary})`,WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>
              From Day One
            </span>
          </div>
        </div>

        {/* KPI Grid */}
        <div style={{display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:24, flex:1, alignContent:'center'}}>
          {videoConfig.metrics.map((m,i) => (
            <div key={i} style={{display:'flex',flexDirection:'column',gap:16,alignItems:'center'}}>
              <KPICounter
                value={m.value}
                suffix={m.suffix}
                label={m.label}
                description={m.description}
                accent={m.accent as 'blue'|'orange'}
                delay={60 + i*20}
                decimals={m.value % 1 !== 0 ? 1 : 0}
              />
              <MiniGraph accent={m.accent as 'blue'|'orange'} delay={100 + i*20} />
            </div>
          ))}
        </div>

        {/* Bottom attribution */}
        <div style={{
          opacity: interpolate(spring({fps,frame:frame-300,config:{damping:30,mass:1,stiffness:80},durationInFrames:40}),[0,0.3,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
          textAlign:'center',
          fontFamily:theme.fonts.body, fontSize:15, fontWeight:400,
          color:theme.colors.text.tertiary, letterSpacing:'0.05em',
        }}>
          * Based on average performance improvements across Rheem enterprise deployments, 2024
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
