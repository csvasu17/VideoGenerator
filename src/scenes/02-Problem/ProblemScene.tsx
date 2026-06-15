import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate, Sequence} from 'remotion';
import {AnimatedBackground} from '../../components/AnimatedBackground';
import {LowerThird} from '../../components/LowerThird';
import {theme} from '../../config/theme';
import {sceneFade} from '../../utils/transitions';
import videoConfig from '../../config/videoConfig.json';

const problems = videoConfig.problems;

const ProblemCard: React.FC<{icon:string;title:string;description:string;delay:number;index:number}> =
  ({icon,title,description,delay,index}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = spring({fps, frame:frame-delay, config:{damping:25,mass:1,stiffness:80,overshootClamping:false}, durationInFrames:45});

  return (
    <div style={{
      opacity: interpolate(p,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
      transform: `translateX(${interpolate(p,[0,1],[-60,0])}px)`,
      display:'flex', alignItems:'flex-start', gap:20,
      background: theme.colors.backgroundCard,
      border: `1px solid ${theme.colors.border.normal}`,
      borderLeft: `3px solid rgba(255,80,80,0.6)`,
      borderRadius: theme.radius.md,
      padding:'24px 28px',
      boxShadow:'0 8px 30px rgba(0,0,0,0.3)',
      position:'relative', overflow:'hidden',
    }}>
      <div style={{
        position:'absolute', top:0, left:0, right:0, bottom:0,
        background:'linear-gradient(90deg, rgba(255,60,60,0.04) 0%, transparent 40%)',
        pointerEvents:'none',
      }}/>
      <div style={{fontSize:32, flexShrink:0, marginTop:2}}>{icon}</div>
      <div style={{display:'flex', flexDirection:'column', gap:6}}>
        <div style={{fontFamily:theme.fonts.heading, fontSize:20, fontWeight:700, color:theme.colors.text.primary}}>
          {title}
        </div>
        <div style={{fontFamily:theme.fonts.body, fontSize:15, fontWeight:400, color:theme.colors.text.secondary, lineHeight:1.6}}>
          {description}
        </div>
      </div>
      {/* Status dot */}
      <div style={{
        position:'absolute', top:16, right:16,
        width:8, height:8, borderRadius:'50%',
        background:'rgba(255,80,80,0.8)',
        boxShadow:'0 0 8px rgba(255,80,80,0.6)',
      }}/>
    </div>
  );
};

export const ProblemScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const sceneOpacity = sceneFade(frame, durationInFrames, 40, 40);

  // Headline
  const headP = spring({fps:60, frame:frame-20, config:{damping:25,mass:1,stiffness:80}, durationInFrames:45});

  return (
    <AbsoluteFill style={{opacity: sceneOpacity}}>
      <AnimatedBackground variant="default" />

      <AbsoluteFill style={{padding:'100px 120px', display:'flex', flexDirection:'column', gap:48}}>
        {/* Section label */}
        <div style={{
          opacity: interpolate(headP,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
          transform: `translateY(${interpolate(headP,[0,1],[30,0])}px)`,
        }}>
          <div style={{
            display:'inline-flex', alignItems:'center', gap:10,
            background:'rgba(255,80,80,0.08)', border:'1px solid rgba(255,80,80,0.25)',
            borderRadius:theme.radius.full, padding:'8px 20px', marginBottom:16,
          }}>
            <div style={{width:6,height:6,borderRadius:'50%',background:'rgba(255,80,80,0.8)'}}/>
            <span style={{fontFamily:theme.fonts.body, fontSize:14, fontWeight:600, color:'rgba(255,120,120,0.9)', letterSpacing:'0.1em', textTransform:'uppercase'}}>
              The Challenge
            </span>
          </div>
          <div style={{fontFamily:theme.fonts.heading, fontSize:52, fontWeight:800, letterSpacing:'-0.03em', color:theme.colors.text.primary, lineHeight:1.1}}>
            Modern Facilities Face<br/>
            <span style={{color:'rgba(255,120,120,0.9)'}}>Critical Operational Gaps</span>
          </div>
        </div>

        {/* Problem cards grid */}
        <div style={{
          display:'grid', gridTemplateColumns:'1fr 1fr',
          gap:16, flex:1, alignContent:'start',
        }}>
          {problems.map((p, i) => (
            <ProblemCard key={i} {...p} delay={60 + i*15} index={i} />
          ))}
        </div>
      </AbsoluteFill>

      <LowerThird title="The Challenge" subtitle="Understanding operational pain points" delay={30} accent="blue" />
    </AbsoluteFill>
  );
};
