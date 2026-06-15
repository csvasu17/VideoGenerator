import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {AnimatedBackground} from '../components/AnimatedBackground';
import {useTheme} from '../themes';
import {sceneFade} from '../utils/transitions';
import {glowPulse} from '../utils/animations';
import type {JourneyStep} from '../types';

const StepNode: React.FC<{step:JourneyStep;index:number;total:number;delay:number;isActive:boolean}> = ({step,delay,isActive}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const theme = useTheme();
  const p = spring({fps, frame:frame-delay, config:{damping:25,mass:1,stiffness:90}, durationInFrames:40});
  const pulse = glowPulse(frame, fps, 0.5);
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:14,flex:1,
      opacity:interpolate(p,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
      transform:'translateY('+interpolate(p,[0,1],[38,0])+'px) scale('+interpolate(p,[0,1],[0.82,1])+')',
    }}>
      <div style={{
        width:72,height:72,borderRadius:'50%',
        background:isActive?'linear-gradient(135deg,'+theme.colors.blue.primary+','+theme.colors.orange.primary+')':theme.colors.backgroundCard,
        border:'2px solid '+(isActive?theme.colors.blue.primary:theme.colors.border.normal),
        display:'flex',alignItems:'center',justifyContent:'center',
        boxShadow:isActive?'0 0 28px '+theme.colors.blue.glow+',0 0 56px '+theme.colors.blue.glow:'0 8px 20px rgba(0,0,0,0.3)',
        position:'relative',
      }}>
        <span style={{fontFamily:theme.fonts.heading,fontSize:20,fontWeight:800,color:theme.colors.text.primary}}>{step.step}</span>
        {isActive&&<div style={{position:'absolute',inset:-7,borderRadius:'50%',border:'1px solid rgba(0,102,255,'+(0.3+pulse*0.2)+')',}}/>}
      </div>
      <div style={{textAlign:'center'}}>
        <div style={{fontFamily:theme.fonts.heading,fontSize:17,fontWeight:700,color:isActive?theme.colors.text.primary:theme.colors.text.secondary,marginBottom:7}}>{step.title}</div>
        <div style={{fontFamily:theme.fonts.body,fontSize:13,fontWeight:400,color:theme.colors.text.tertiary,lineHeight:1.5,maxWidth:150,textAlign:'center'}}>{step.description}</div>
      </div>
    </div>
  );
};

interface CustomerJourneySceneProps {
  steps: JourneyStep[];
  heading?: string;
  subheading?: string;
}

export const CustomerJourneyScene: React.FC<CustomerJourneySceneProps> = ({steps, heading, subheading}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const theme = useTheme();
  const sceneOpacity = sceneFade(frame, durationInFrames, 40, 40);
  const headP = spring({fps, frame:frame-20, config:{damping:25,mass:1,stiffness:80}, durationInFrames:45});
  const stepDur = 120;
  const activeStep = Math.min(Math.floor(Math.max(frame - 80, 0) / stepDur), steps.length-1);

  return (
    <AbsoluteFill style={{opacity: sceneOpacity}}>
      <AnimatedBackground variant="default" />
      <AbsoluteFill style={{padding:'80px 100px', display:'flex', flexDirection:'column', gap:52, alignItems:'center'}}>
        {(heading || subheading) && (
          <div style={{
            opacity:interpolate(headP,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
            transform:'translateY('+interpolate(headP,[0,1],[28,0])+'px)',
            textAlign:'center', display:'flex', flexDirection:'column', gap:8,
          }}>
            {heading&&<div style={{fontFamily:theme.fonts.heading,fontSize:46,fontWeight:800,letterSpacing:'-0.03em',color:theme.colors.text.primary}}>{heading}</div>}
            {subheading&&<div style={{fontFamily:theme.fonts.body,fontSize:20,color:theme.colors.text.secondary}}>{subheading}</div>}
          </div>
        )}
        <div style={{display:'flex',alignItems:'flex-start',gap:0,width:'100%',position:'relative'}}>
          <div style={{position:'absolute',top:36,left:'10%',right:'10%',height:2,background:'linear-gradient(90deg,'+theme.colors.blue.primary+','+theme.colors.orange.primary+')',opacity:0.25,zIndex:0}}/>
          {steps.map((s,i)=>(
            <StepNode key={i} step={s} index={i} total={steps.length} delay={55+i*14} isActive={i===activeStep}/>
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
