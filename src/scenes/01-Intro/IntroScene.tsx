import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate, Sequence} from 'remotion';
import {AnimatedBackground} from '../../components/AnimatedBackground';
import {RheemLogo} from '../../components/Logo';
import {theme} from '../../config/theme';
import {glowPulse, floatY} from '../../utils/animations';
import {sceneFade} from '../../utils/transitions';

export const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  const sceneOpacity = sceneFade(frame, durationInFrames, 40, 40);

  // Tagline appear
  const taglineP = spring({fps, frame: frame - 90, config:{damping:25,mass:1,stiffness:70,overshootClamping:false}, durationInFrames:50});
  const subP = spring({fps, frame: frame - 130, config:{damping:30,mass:1,stiffness:80,overshootClamping:false}, durationInFrames:45});
  const ctaP = spring({fps, frame: frame - 200, config:{damping:25,mass:1,stiffness:60,overshootClamping:false}, durationInFrames:50});

  // Sweep line animation
  const sweepProgress = interpolate(frame, [20, 90], [0, 1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});

  const pulse = glowPulse(frame, fps, 0.5);
  const float = floatY(frame, fps, 10, 0.25);

  return (
    <AbsoluteFill style={{opacity: sceneOpacity}}>
      <AnimatedBackground variant="intense" />

      {/* Cinematic letter-box bars */}
      <div style={{position:'absolute', top:0, left:0, right:0, height:60, background:'rgba(0,0,0,0.7)'}}/>
      <div style={{position:'absolute', bottom:0, left:0, right:0, height:60, background:'rgba(0,0,0,0.7)'}}/>

      {/* Central content */}
      <AbsoluteFill style={{display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:40}}>

        {/* Logo with float */}
        <div style={{transform: `translateY(${float}px)`}}>
          <RheemLogo size={96} delay={20} showTagline={false} animated tagline="" />
        </div>

        {/* Divider sweep line */}
        <div style={{
          width: `${interpolate(sweepProgress,[0,1],[0,560])}px`,
          height:1,
          background: `linear-gradient(90deg, transparent, ${theme.colors.blue.primary}, ${theme.colors.orange.primary}, transparent)`,
          boxShadow: `0 0 12px ${theme.colors.blue.glow}`,
          overflow:'hidden',
        }}/>

        {/* Tagline */}
        <div style={{
          opacity: interpolate(taglineP,[0,0.3,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
          transform: `translateY(${interpolate(taglineP,[0,1],[30,0])}px)`,
          textAlign:'center',
        }}>
          <div style={{
            fontFamily: theme.fonts.heading,
            fontSize: 72, fontWeight:800,
            letterSpacing:'-0.04em', lineHeight:1.05,
            color: theme.colors.text.primary,
            textShadow: `0 0 80px ${theme.colors.blue.glow}`,
          }}>
            Intelligence at Scale.
          </div>
          <div style={{
            fontFamily: theme.fonts.heading,
            fontSize: 72, fontWeight:800,
            letterSpacing:'-0.04em', lineHeight:1.05,
            background: `linear-gradient(135deg, ${theme.colors.blue.light} 0%, ${theme.colors.orange.primary} 100%)`,
            WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent',
          }}>
            Decisions Made Simple.
          </div>
        </div>

        {/* Sub tagline */}
        <div style={{
          opacity: interpolate(subP,[0,0.3,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
          transform: `translateY(${interpolate(subP,[0,1],[20,0])}px)`,
          fontFamily: theme.fonts.body,
          fontSize:24, fontWeight:400,
          color: theme.colors.text.secondary,
          letterSpacing:'0.12em', textTransform:'uppercase',
          textAlign:'center',
        }}>
          Enterprise-Grade Operations Platform
        </div>

        {/* CTA pill */}
        <div style={{
          opacity: interpolate(ctaP,[0,0.3,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
          transform: `scale(${interpolate(ctaP,[0,1],[0.85,1])})`,
          marginTop:8,
        }}>
          <div style={{
            display:'flex', alignItems:'center', gap:12,
            background: `linear-gradient(135deg, rgba(0,102,255,0.15) 0%, rgba(255,107,0,0.08) 100%)`,
            border: `1px solid ${theme.colors.border.blue}`,
            borderRadius:theme.radius.full,
            padding:'14px 36px',
            boxShadow: `0 0 30px ${theme.colors.blue.glow}`,
          }}>
            <div style={{
              width:10, height:10, borderRadius:'50%',
              background: theme.colors.blue.primary,
              boxShadow: `0 0 8px ${theme.colors.blue.primary}`,
              opacity: 0.7 + pulse * 0.3,
            }}/>
            <div style={{
              fontFamily:theme.fonts.body, fontSize:18, fontWeight:500,
              color:theme.colors.text.accent, letterSpacing:'0.05em',
            }}>
              Enterprise Platform  ·  2025
            </div>
          </div>
        </div>
      </AbsoluteFill>

      {/* Decorative corner accents */}
      {[{top:70,left:40},{top:70,right:40},{bottom:70,left:40},{bottom:70,right:40}].map((pos,i) => (
        <div key={i} style={{
          position:'absolute', ...pos,
          width:40, height:40,
          borderTop: i < 2 ? `2px solid ${theme.colors.border.blue}` : 'none',
          borderBottom: i >= 2 ? `2px solid ${theme.colors.border.blue}` : 'none',
          borderLeft: i%2===0 ? `2px solid ${theme.colors.border.blue}` : 'none',
          borderRight: i%2===1 ? `2px solid ${theme.colors.border.blue}` : 'none',
          opacity: 0.6 + pulse * 0.2,
        }}/>
      ))}
    </AbsoluteFill>
  );
};
