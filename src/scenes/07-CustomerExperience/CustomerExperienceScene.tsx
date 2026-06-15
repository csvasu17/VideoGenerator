import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {AnimatedBackground} from '../../components/AnimatedBackground';
import {theme} from '../../config/theme';
import {sceneFade} from '../../utils/transitions';
import {glowPulse} from '../../utils/animations';
import videoConfig from '../../config/videoConfig.json';

const steps = videoConfig.customerJourney;

const StepNode: React.FC<{step:typeof steps[0];index:number;total:number;delay:number;isActive:boolean}> =
  ({step,index,total,delay,isActive}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = spring({fps, frame:frame-delay, config:{damping:25,mass:1,stiffness:90}, durationInFrames:40});
  const pulse = glowPulse(frame, fps, 0.5);

  return (
    <div style={{
      display:'flex', flexDirection:'column', alignItems:'center', gap:16,
      opacity: interpolate(p,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
      transform: `translateY(${interpolate(p,[0,1],[40,0])}px) scale(${interpolate(p,[0,1],[0.8,1])})`,
      flex:1,
    }}>
      {/* Step node */}
      <div style={{
        width:80, height:80, borderRadius:'50%',
        background: isActive
          ? `linear-gradient(135deg,${theme.colors.blue.primary},${theme.colors.orange.primary})`
          : theme.colors.backgroundCard,
        border: `2px solid ${isActive ? theme.colors.blue.primary : theme.colors.border.normal}`,
        display:'flex', alignItems:'center', justifyContent:'center',
        boxShadow: isActive ? `0 0 30px ${theme.colors.blue.glow}, 0 0 60px ${theme.colors.blue.glow}` : '0 8px 20px rgba(0,0,0,0.3)',
        position:'relative',
      }}>
        <span style={{fontFamily:theme.fonts.heading,fontSize:22,fontWeight:800,color:theme.colors.text.primary}}>
          {step.step}
        </span>
        {isActive && (
          <div style={{
            position:'absolute', inset:-8, borderRadius:'50%',
            border: `1px solid rgba(0,102,255,${0.3+pulse*0.2})`,
            boxShadow: `0 0 20px rgba(0,102,255,${0.15+pulse*0.1})`,
          }}/>
        )}
      </div>
      {/* Label */}
      <div style={{textAlign:'center'}}>
        <div style={{fontFamily:theme.fonts.heading,fontSize:18,fontWeight:700,color:isActive?theme.colors.text.primary:theme.colors.text.secondary,marginBottom:8}}>
          {step.title}
        </div>
        <div style={{fontFamily:theme.fonts.body,fontSize:14,fontWeight:400,color:theme.colors.text.tertiary,lineHeight:1.5,maxWidth:160,textAlign:'center'}}>
          {step.description}
        </div>
      </div>
    </div>
  );
};

export const CustomerExperienceScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const sceneOpacity = sceneFade(frame, durationInFrames, 40, 40);

  const headP = spring({fps, frame:frame-20, config:{damping:25,mass:1,stiffness:80}, durationInFrames:45});

  // Animate active step
  const stepDuration = 120;
  const activeStep = Math.min(Math.floor(Math.max(frame - 80, 0) / stepDuration), steps.length - 1);

  return (
    <AbsoluteFill style={{opacity: sceneOpacity}}>
      <AnimatedBackground variant="default" />

      <AbsoluteFill style={{padding:'80px 100px', display:'flex', flexDirection:'column', gap:60, alignItems:'center'}}>
        {/* Header */}
        <div style={{
          opacity: interpolate(headP,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
          transform: `translateY(${interpolate(headP,[0,1],[30,0])}px)`,
          textAlign:'center', display:'flex', flexDirection:'column', gap:12,
        }}>
          <div style={{
            display:'inline-flex', alignItems:'center', gap:10,
            background:theme.colors.orange.subtle, border:`1px solid ${theme.colors.border.orange}`,
            borderRadius:theme.radius.full, padding:'8px 20px', alignSelf:'center',
          }}>
            <div style={{width:6,height:6,borderRadius:'50%',background:theme.colors.orange.primary}}/>
            <span style={{fontFamily:theme.fonts.body,fontSize:14,fontWeight:600,color:theme.colors.orange.bright,letterSpacing:'0.1em',textTransform:'uppercase'}}>
              Customer Journey
            </span>
          </div>
          <div style={{fontFamily:theme.fonts.heading,fontSize:48,fontWeight:800,letterSpacing:'-0.03em',color:theme.colors.text.primary}}>
            From Install to{' '}
            <span style={{background:`linear-gradient(135deg,${theme.colors.orange.light},${theme.colors.blue.light})`,WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>
              Intelligent Operations
            </span>
          </div>
        </div>

        {/* Journey steps */}
        <div style={{display:'flex', alignItems:'flex-start', gap:0, width:'100%', position:'relative'}}>
          {/* Connection line */}
          <div style={{position:'absolute', top:40, left:'10%', right:'10%', height:2,
            background:`linear-gradient(90deg,${theme.colors.blue.primary},${theme.colors.orange.primary})`,
            opacity:0.3, zIndex:0,
          }}/>
          {steps.map((s, i) => (
            <StepNode
              key={i}
              step={s}
              index={i}
              total={steps.length}
              delay={60 + i * 15}
              isActive={i === activeStep}
            />
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
