/**
 * StoryMoment — 2.5s cinematic outcome declaration.
 * Placed BEFORE each product reveal: state the outcome, then show the evidence.
 * Motion: bar SLAM -> eyebrow slide -> headline IMPACT -> sub fade -> white flash exit.
 */
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring} from 'remotion';
import {impactScale, slideFromLeft, glowPulse} from '../utils/animations';
import {cinematicFade} from '../utils/transitions';
import {useTheme} from '../themes';

export interface StoryMomentProps {
  eyebrow: string;
  headline: string;
  sub?: string;
  accent?: 'blue' | 'orange';
}

export const StoryMoment: React.FC<StoryMomentProps> = ({
  eyebrow, headline, sub, accent = 'blue',
}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const theme = useTheme();

  const accentColor = accent === 'orange' ? theme.colors.orange.primary : theme.colors.blue.primary;
  const accentGlow  = accent === 'orange' ? theme.colors.orange.glow   : theme.colors.blue.glow;

  const sceneOp = cinematicFade(frame, durationInFrames, 10, 16);

  const barP = spring({fps, frame: frame - 2, config:{damping:20,mass:0.55,stiffness:300}, durationInFrames:16});
  const barW = interpolate(barP, [0,1], [0,56], {extrapolateLeft:'clamp',extrapolateRight:'clamp'});

  const eyebrowAnim = slideFromLeft(frame, fps, 8, 120);
  const headAnim    = impactScale(frame, fps, 22);
  const subP        = spring({fps, frame: frame - 58, config:{damping:28,mass:1,stiffness:90}, durationInFrames:30});
  const pulse       = glowPulse(frame, fps, 0.55);

  const exitStart = durationInFrames - 20;
  const exitP = Math.max(0, Math.min((frame - exitStart) / 20, 1));
  const exitE = exitP * exitP;

  return (
    <AbsoluteFill style={{opacity: sceneOp, overflow: 'hidden'}}>

      {/* ── SMOOTH GRADIENT WASH background ── */}
      <div style={{position:'absolute', inset:0, background:'#060510'}}/>
      <div style={{
        position:'absolute', top:'-40%', left:'-30%',
        width:1500, height:1500, borderRadius:'50%',
        background:'radial-gradient(circle, rgba(80,100,255,0.50) 0%, rgba(50,60,200,0.28) 40%, transparent 68%)',
        filter:'blur(110px)', pointerEvents:'none',
      }}/>
      <div style={{
        position:'absolute', bottom:'-40%', right:'-30%',
        width:1500, height:1500, borderRadius:'50%',
        background:'radial-gradient(circle, rgba(200,60,255,0.46) 0%, rgba(160,20,200,0.25) 40%, transparent 68%)',
        filter:'blur(110px)', pointerEvents:'none',
      }}/>
      <div style={{
        position:'absolute', top:'10%', left:'50%', transform:'translateX(-50%)',
        width:1800, height:600, borderRadius:'50%',
        background:'radial-gradient(ellipse, rgba(130,80,255,0.15) 0%, transparent 65%)',
        filter:'blur(80px)', pointerEvents:'none',
      }}/>

      <div style={{
        position:'absolute', inset:0,
        background: 'radial-gradient(ellipse 50% 45% at 50% 50%, ' + accentColor + '12 0%, transparent 65%)',
        opacity: 0.4 + pulse * 0.3,
        pointerEvents:'none',
      }}/>

      <AbsoluteFill style={{
        display:'flex', flexDirection:'column', justifyContent:'center',
        padding:'0 148px', gap:0,
        transform: 'scale(' + (1 + exitE * 0.06) + ')',
      }}>

        <div style={{
          width: barW + 'px', height:4, borderRadius:2,
          background: accentColor,
          boxShadow: '0 0 16px ' + accentGlow,
          marginBottom:28, opacity: 0.95 + pulse * 0.05,
        }}/>

        <div style={{
          opacity: eyebrowAnim.opacity,
          transform: 'translateX(' + eyebrowAnim.translateX + 'px)',
          fontFamily: theme.fonts.body,
          fontSize:18, fontWeight:700,
          letterSpacing:'0.20em', textTransform:'uppercase' as const,
          color: accentColor,
          marginBottom:20,
        }}>
          {eyebrow}
        </div>

        <div style={{
          opacity: headAnim.opacity,
          transform: 'scale(' + headAnim.scale + ')',
          transformOrigin:'left center',
          fontFamily: theme.fonts.heading,
          fontSize:108, fontWeight:900,
          letterSpacing:'-0.05em', lineHeight:0.94,
          color: theme.colors.text.primary,
          marginBottom:32,
        }}>
          {headline}
        </div>

        {sub && (
          <div style={{
            opacity: interpolate(subP,[0,0.3,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
            transform: 'translateY(' + interpolate(subP,[0,1],[18,0]) + 'px)',
            fontFamily: theme.fonts.body,
            fontSize:28, fontWeight:400,
            color: theme.colors.text.secondary,
            letterSpacing:'0.03em',
            maxWidth:760, lineHeight:1.5,
          }}>
            {sub}
          </div>
        )}

      </AbsoluteFill>

      <div style={{
        position:'absolute', inset:0,
        background:'rgba(255,255,255,0.9)',
        opacity: exitP > 0.6 ? Math.min((exitP - 0.6) / 0.4, 1) * 0.35 : 0,
        pointerEvents:'none',
      }}/>

    </AbsoluteFill>
  );
};
