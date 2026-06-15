import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {AnimatedBackground} from '../components/AnimatedBackground';
import {useTheme} from '../themes';
import {glowPulse, floatY, impactScale, slideFromLeft, slideFromRight} from '../utils/animations';
import {cinematicFade, scenePresenceStyle} from '../utils/transitions';

export interface SharedIntroProps {
  product: {
    name: string;
    tagline: string;
    subTagline?: string;
  };
}

export const SharedIntro: React.FC<SharedIntroProps> = ({product}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const theme = useTheme();

  const TRANS = 38;
  const sceneOp = cinematicFade(frame, durationInFrames, TRANS, TRANS);
  const presence = scenePresenceStyle(frame, durationInFrames, TRANS, TRANS, 'fade-up', 'zoom-out');

  // Letterbox bars slide in from edges
  const lbP = spring({fps, frame, config:{damping:28,mass:1,stiffness:160}, durationInFrames:30});
  const lbTopY    = interpolate(lbP, [0,1], [-64, 0]);
  const lbBottomY = interpolate(lbP, [0,1],  [64, 0]);

  // Brand name: fast impact scale
  const nameAnim = impactScale(frame, fps, 28);

  // Sweep line: eased left-to-right
  const sweepRaw  = Math.min(Math.max((frame - 48) / 62, 0), 1);
  const sweepEase = sweepRaw < 0.5 ? 2*sweepRaw*sweepRaw : 1 - Math.pow(-2*sweepRaw+2,2)/2;

  // Tagline lines: opposite directions for visual tension
  const taglineLines = product.tagline.includes('\n') ? product.tagline.split('\n') : [product.tagline];
  const line1 = slideFromLeft(frame, fps, 92);
  const line2 = slideFromRight(frame, fps, 118);

  // Sub-tagline: spring up
  const subP = spring({fps, frame: frame - 148, config:{damping:30,mass:1,stiffness:88}, durationInFrames:40});

  // CTA pill: impact scale
  const ctaAnim = impactScale(frame, fps, 182);

  // Ambient
  const float = floatY(frame, fps, 8, 0.2);
  const pulse = glowPulse(frame, fps, 0.45);

  // Exit: scale + blur the whole content block
  const exitStart = durationInFrames - 44;
  const exitP = Math.max(0, Math.min((frame - exitStart) / 44, 1));
  const exitEase = exitP*exitP;

  return (
    <AbsoluteFill style={{opacity: sceneOp, ...presence}}>
      <AnimatedBackground variant="intense" />

      {/* Scan lines — horizontal light streaks for depth */}
      {[0.28, 0.52, 0.74].map((yPct, i) => {
        const delay = i * 18;
        const streakP = Math.min(Math.max((frame - 15 - delay) / 45, 0), 1);
        const streakEase = streakP < 0.5 ? 2*streakP*streakP : 1 - Math.pow(-2*streakP+2,2)/2;
        return (
          <div key={i} style={{
            position:'absolute',
            top:`${yPct * 100}%`,
            left:'-10%',
            width:`${streakEase * 120}%`,
            height:1,
            background:`linear-gradient(90deg, transparent, rgba(0,102,255,0.20), transparent)`,
            opacity: Math.sin(streakP * Math.PI) * 1.0,
            pointerEvents:'none',
          }}/>
        );
      })}

      {/* Letterbox bars animate in from edges */}
      <div style={{
        position:'absolute', top:0, left:0, right:0, height:64,
        background:'rgba(0,0,0,0.72)',
        transform:`translateY(${lbTopY}px)`,
      }}/>
      <div style={{
        position:'absolute', bottom:0, left:0, right:0, height:64,
        background:'rgba(0,0,0,0.72)',
        transform:`translateY(${lbBottomY}px)`,
      }}/>

      {/* Main content — exit scale applied here */}
      <AbsoluteFill style={{
        display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:36,
        transform:`scale(${1 - exitEase * 0.05})`,
        filter: exitEase > 0.05 ? `blur(${exitEase * 4}px)` : 'none',
      }}>

        {/* Brand name — impact entrance with ambient float */}
        <div style={{
          transform:`translateY(${float}px) scale(${nameAnim.scale})`,
          opacity: nameAnim.opacity,
        }}>
          <div style={{
            fontFamily: theme.fonts.heading,
            fontSize: 58, fontWeight: 900, letterSpacing: '-0.04em',
            background:`linear-gradient(135deg, ${theme.colors.blue.light} 0%, ${theme.colors.orange.primary} 100%)`,
            WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent',
            textAlign:'center',
            textShadow: `0 0 40px ${theme.colors.blue.glow}88`,
          }}>
            {product.name}
          </div>
        </div>

        {/* Sweep line */}
        <div style={{
          width:`${interpolate(sweepEase, [0,1], [0, 560])}px`,
          height: 2,
          background:`linear-gradient(90deg, transparent, ${theme.colors.blue.primary}, ${theme.colors.orange.primary}, transparent)`,
          boxShadow:`0 0 14px ${theme.colors.blue.glow}`,
          overflow:'hidden',
        }}/>
        <div style={{
          width:`${interpolate(sweepEase,[0,1],[0,560])}px`,
          height:10,
          background:`linear-gradient(90deg, transparent, rgba(0,102,255,0.06), transparent)`,
          marginTop:-6,
        }}/>

        {/* Tagline — line 1 from left, line 2 from right */}
        <div style={{textAlign:'center', display:'flex', flexDirection:'column', gap:4}}>
          {taglineLines.map((line, i) => {
            const anim = i === 0 ? line1 : line2;
            return (
              <div key={i} style={{
                opacity: anim.opacity,
                transform:`translateX(${anim.translateX}px)`,
                fontFamily: theme.fonts.heading,
                fontSize: 72, fontWeight: 800,
                letterSpacing: '-0.04em', lineHeight: 1.05,
                ...(i === taglineLines.length - 1 && taglineLines.length > 1
                  ? {
                      background:`linear-gradient(135deg, ${theme.colors.blue.light} 0%, ${theme.colors.orange.primary} 100%)`,
                      WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent',
                    }
                  : {color: theme.colors.text.primary, textShadow:`0 0 80px ${theme.colors.blue.glow}`}),
              }}>
                {line}
              </div>
            );
          })}
        </div>

        {/* Sub-tagline */}
        {product.subTagline && (
          <div style={{
            opacity: interpolate(subP,[0,0.3,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
            transform:`translateY(${interpolate(subP,[0,1],[24,0])}px)`,
            fontFamily: theme.fonts.body, fontSize: 22, fontWeight: 400,
            color: theme.colors.text.secondary,
            letterSpacing: '0.14em', textTransform: 'uppercase', textAlign:'center',
          }}>
            {product.subTagline}
          </div>
        )}

        {/* CTA pill — impact scale */}
        <div style={{transform:`scale(${ctaAnim.scale})`, opacity: ctaAnim.opacity, marginTop:4}}>
          <div style={{
            display:'flex', alignItems:'center', gap:12,
            background:`linear-gradient(135deg, rgba(0,102,255,0.14) 0%, rgba(255,107,0,0.07) 100%)`,
            border:`1px solid ${theme.colors.border.blue}`,
            borderRadius: theme.radius.full, padding:'14px 36px',
            boxShadow:`0 0 32px ${theme.colors.blue.glow}`,
          }}>
            <div style={{fontFamily:theme.fonts.body, fontSize:16, fontWeight:600, color:theme.colors.text.accent, letterSpacing:'0.08em'}}>
              Enterprise Platform
            </div>
          </div>
        </div>
      </AbsoluteFill>

      {/* Corner accents fade in staggered */}
      {([
        {top:70, left:40}, {top:70, right:40},
        {bottom:70, left:40}, {bottom:70, right:40},
      ] as React.CSSProperties[]).map((pos, i) => {
        const cp = Math.min(Math.max((frame - 162 - i*8) / 28, 0), 1);
        return (
          <div key={i} style={{
            position:'absolute', ...pos, width:36, height:36,
            opacity: cp * (0.5 + pulse * 0.2),
            borderTop:    i < 2  ? `1.5px solid ${theme.colors.border.blue}` : 'none',
            borderBottom: i >= 2 ? `1.5px solid ${theme.colors.border.blue}` : 'none',
            borderLeft:   i%2===0 ? `1.5px solid ${theme.colors.border.blue}` : 'none',
            borderRight:  i%2===1 ? `1.5px solid ${theme.colors.border.blue}` : 'none',
          }}/>
        );
      })}
    </AbsoluteFill>
  );
};
