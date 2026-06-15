/**
 * ChapterCard — Cinematic chapter divider.
 * Motion design: accent bar SLAMS in → eyebrow slides from left → headline
 * lines stagger from left → subline fades up → whole card exits push-left.
 */
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {AnimatedBackground} from '../components/AnimatedBackground';
import {useTheme} from '../themes';
import {cinematicFade, scenePresenceStyle} from '../utils/transitions';
import {glowPulse, slideFromLeft} from '../utils/animations';

export interface ChapterCardProps {
  headline:           string;
  subline?:           string;
  accent?:            'blue' | 'orange';
  counter?:           string;
  eyebrow?:           string;
  hero?:              boolean;
  backgroundVariant?: 'default' | 'intense';
}

export const ChapterCard: React.FC<ChapterCardProps> = ({
  headline, subline, accent = 'blue', counter, eyebrow,
  hero = false, backgroundVariant = 'default',
}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const theme = useTheme();

  const TRANS = 40;  // 20 frames at 30fps
  const sceneOp = cinematicFade(frame, durationInFrames, TRANS, TRANS);
  const presence = scenePresenceStyle(frame, durationInFrames, TRANS, TRANS, 'fade-up', 'fade-down');

  const accentColor = accent==='orange' ? theme.colors.orange.primary : theme.colors.blue.primary;
  const accentGlow  = accent==='orange' ? theme.colors.orange.glow   : theme.colors.blue.glow;
  const pulse       = glowPulse(frame, fps, 0.55);

  // Accent bar: SLAM in — very fast spring
  const barP = spring({fps, frame: frame - 2, config:{damping:20,mass:0.55,stiffness:300}, durationInFrames:16});
  const barW = interpolate(barP, [0,1], [0, hero ? 120 : 72]);
  const barWSecondary = hero ? interpolate(barP, [0,1], [0, 40]) : 0;

  // Eyebrow: fast left slide
  const eyebrowAnim = slideFromLeft(frame, fps, 10, 90);

  // Headline lines: staggered left slides
  const headLines = headline.split('\n');
  const line1 = slideFromLeft(frame, fps, 20, 100);
  const line2 = slideFromLeft(frame, fps, 35, 100);

  // Subline: spring up
  const subP = spring({fps, frame: frame-54, config:{damping:28,mass:1,stiffness:100}, durationInFrames:30});

  // Counter: fade in last
  const counterP = spring({fps, frame: frame-70, config:{damping:32,mass:1,stiffness:80}, durationInFrames:28});

  return (
    <AbsoluteFill style={{opacity: sceneOp, ...presence, background:'#060510'}}>
      <AnimatedBackground variant={backgroundVariant} />

      {/* Soft radial glow behind the card area — centered, accent-colored */}
      <div style={{
        position:'absolute', top:'50%', left:'50%',
        transform:'translate(-50%, -50%)',
        width:900, height:600, borderRadius:'50%',
        background:`radial-gradient(ellipse, ${accentGlow.replace('0.35','0.18')} 0%, transparent 70%)`,
        filter:'blur(60px)', pointerEvents:'none',
      }}/>

      <div style={{position:'absolute',top:0,left:0,right:0,height:22,background:'rgba(0,0,0,0.72)'}}/>
      <div style={{position:'absolute',bottom:0,left:0,right:0,height:22,background:'rgba(0,0,0,0.72)'}}/>

      <AbsoluteFill style={{
        display:'flex', flexDirection:'column', justifyContent:'center',
        padding:'0 148px', gap:0,
      }}>

        {/* Secondary hero accent bar — thin orange line, hero chapters only */}
        {hero && (
          <div style={{
            width:`${barWSecondary}px`, height:2, borderRadius:1,
            background:theme.colors.orange.primary,
            boxShadow:`0 0 8px ${theme.colors.orange.glow}`,
            marginBottom:6, opacity:0.8,
          }}/>
        )}
        {/* Accent bar — slams in */}
        <div style={{
          width:`${barW}px`, height:4, borderRadius:2,
          background: accentColor,
          boxShadow:`0 0 16px ${accentGlow}, 0 0 32px ${accentGlow}44`,
          marginBottom:28, opacity: 0.95 + pulse*0.05,
        }}/>

        {/* Eyebrow */}
        {eyebrow && (
          <div style={{
            opacity: eyebrowAnim.opacity,
            transform:`translateX(${eyebrowAnim.translateX}px)`,
            fontFamily:theme.fonts.body, fontSize:14, fontWeight:700,
            letterSpacing:'0.22em', textTransform:'uppercase',
            color: accentColor, marginBottom:18,
          }}>
            {eyebrow}
          </div>
        )}

        {/* Headline */}
        <div style={{marginBottom: subline ? 24 : 0}}>
          {headLines.map((line, i) => {
            const anim = i===0 ? line1 : line2;
            return (
              <div key={i} style={{
                opacity: anim.opacity,
                transform:`translateX(${anim.translateX}px)`,
                fontFamily:theme.fonts.heading,
                fontSize: hero ? 72 : 64, fontWeight:800,
                letterSpacing:'-0.04em', lineHeight:1.02,
                ...(i===headLines.length-1 && headLines.length>1
                  ? {
                      background:`linear-gradient(135deg, ${accentColor} 0%, ${accent==='blue' ? theme.colors.orange.primary : theme.colors.blue.primary} 100%)`,
                      WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent',
                    }
                  : {color: theme.colors.text.primary}),
              }}>
                {line}
              </div>
            );
          })}
        </div>

        {/* Subline */}
        {subline && (
          <div style={{
            opacity: interpolate(subP,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
            transform:`translateY(${interpolate(subP,[0,1],[20,0])}px)`,
            fontFamily:theme.fonts.body, fontSize:22, fontWeight:400,
            color:theme.colors.text.secondary, letterSpacing:'0.02em',
          }}>
            {subline}
          </div>
        )}
      </AbsoluteFill>

      {/* Right accent bars — balances left-heavy layout */}
      <div style={{
        position:'absolute', right:80, top:'50%',
        transform:'translateY(-50%)',
        display:'flex', flexDirection:'column', gap:10, alignItems:'flex-end',
        opacity:interpolate(counterP,[0,0.3,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
      }}>
        {([32,20,12,6] as number[]).map((w,i) => (
          <div key={i} style={{
            width:w, height:3, borderRadius:1.5,
            background: i===0 ? accentColor : 'rgba(255,255,255,0.08)',
            boxShadow: i===0 ? `0 0 8px ${accentGlow}` : 'none',
            opacity: i===0 ? (0.85+pulse*0.15) : 1,
          }}/>
        ))}
      </div>

      {/* Counter */}
      {counter && (
        <div style={{
          position:'absolute', bottom:40, right:148,
          opacity: interpolate(counterP,[0,0.3,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
          fontFamily:theme.fonts.mono, fontSize:12, fontWeight:600,
          letterSpacing:'0.18em',
          color: hero ? theme.colors.blue.light : theme.colors.text.tertiary,
          background: hero ? 'rgba(0,102,255,0.12)' : 'rgba(255,255,255,0.05)',
          border: hero ? `1px solid ${theme.colors.border.blue}` : 'none',
          borderRadius:4, padding:'3px 10px',
        }}>
          {counter}
        </div>
      )}

      {counter && (() => {
        const parts = counter.split('/').map(s => s.trim());
        const current = parseInt(parts[0]) || 1;
        const total   = parseInt(parts[1]) || 4;
        const pct = (current / total) * 100;
        const barP = interpolate(counterP, [0,1], [0, pct], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
        return (
          <div style={{position:'absolute', bottom:0, left:0, right:0, height:3, background:'rgba(255,255,255,0.09)'}}>
            <div style={{height:'100%', width:`${barP}%`, background:accentColor, opacity:0.9, transition:'none', boxShadow:`0 0 6px ${accentColor}99`}}/>
          </div>
        );
      })()}
    </AbsoluteFill>
  );
};
