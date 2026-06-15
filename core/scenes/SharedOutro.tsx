import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {AnimatedBackground} from '../components/AnimatedBackground';
import {useTheme} from '../themes';
import {cinematicFade, scenePresenceStyle} from '../utils/transitions';
import {glowPulse, floatY, impactScale, slideFromLeft, slideFromRight} from '../utils/animations';

export interface SharedOutroProps {
  product: {name: string; ctaText: string; ctaSubtext?: string};
  contacts?: Array<{label: string; value: string}>;
}

export const SharedOutro: React.FC<SharedOutroProps> = ({product, contacts}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const theme = useTheme();

  const TRANS = 38;
  const sceneOp = cinematicFade(frame, durationInFrames, TRANS, 55);
  const presence = scenePresenceStyle(frame, durationInFrames, TRANS, 55, 'zoom-in', 'fade-out');

  const pulse = glowPulse(frame, fps, 0.4);
  const float = floatY(frame, fps, 8, 0.2);

  // Letterbox
  const lbP = spring({fps, frame, config:{damping:28,mass:1,stiffness:140}, durationInFrames:30});
  const lbTopY    = interpolate(lbP, [0,1], [-64, 0]);
  const lbBottomY = interpolate(lbP, [0,1],  [64, 0]);

  // Logo
  const logoAnim = impactScale(frame, fps, 24);

  // CTA headline: split lines with opposite slide directions
  const ctaLine1 = slideFromLeft(frame, fps, 72, 110);
  const ctaLine2 = slideFromRight(frame, fps, 90, 110);

  // Sub + CTA button
  const subP = spring({fps, frame: frame-118, config:{damping:28,mass:1,stiffness:90}, durationInFrames:38});
  const ctaBtnAnim = impactScale(frame, fps, 155);

  // Divider sweep
  const sweepRaw  = Math.min(Math.max((frame - 185) / 50, 0), 1);
  const sweepEase = sweepRaw < 0.5 ? 2*sweepRaw*sweepRaw : 1 - Math.pow(-2*sweepRaw+2,2)/2;

  // Contacts
  const contactP = spring({fps, frame: frame-215, config:{damping:30,mass:1,stiffness:80}, durationInFrames:40});

  // CTA lines split
  const ctaTextLines = product.ctaText.includes('\n')
    ? product.ctaText.split('\n')
    : [product.ctaText, 'with ' + product.name];

  return (
    <AbsoluteFill style={{opacity: sceneOp, ...presence}}>
      <AnimatedBackground variant="intense" />

      {/* Gap #6: Ring circle ornaments (matching reference's faint concentric rings) */}
      {[580, 820].map((r, i) => {
        const ringP = Math.min(Math.max((frame - 20 - i * 14) / 40, 0), 1);
        return (
          <div key={i} style={{
            position:'absolute', left:'50%', top:'50%',
            transform:'translate(-50%, -50%)',
            width:r*2, height:r*2, borderRadius:'50%',
            border:`1px solid rgba(255,255,255,${0.06 - i * 0.02})`,
            opacity: ringP,
            pointerEvents:'none',
          }}/>
        );
      })}

      <div style={{position:'absolute',top:0,left:0,right:0,height:64,background:'rgba(0,0,0,0.72)',transform:`translateY(${lbTopY}px)`}}/>
      <div style={{position:'absolute',bottom:0,left:0,right:0,height:64,background:'rgba(0,0,0,0.72)',transform:`translateY(${lbBottomY}px)`}}/>

      <AbsoluteFill style={{display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:30}}>

        {/* Logo float */}
        <div style={{
          transform:`translateY(${float + interpolate(logoAnim.scale,[0.72,1],[30,0])}px) scale(${logoAnim.scale})`,
          opacity: logoAnim.opacity,
          fontFamily: theme.fonts.heading, fontSize:32, fontWeight:900,
          letterSpacing:'-0.03em', color:theme.colors.text.primary,
          textShadow:`0 0 60px ${theme.colors.blue.glow}`,
        }}>
          {product.name}
        </div>

        {/* CTA headline — lines from opposite directions */}
        <div style={{textAlign:'center', display:'flex', flexDirection:'column', gap:2}}>
          <div style={{
            opacity: ctaLine1.opacity, transform:`translateX(${ctaLine1.translateX}px)`,
            fontFamily:theme.fonts.heading, fontSize:72, fontWeight:800,
            letterSpacing:'-0.04em', lineHeight:1.05,
            color:theme.colors.text.primary, textShadow:`0 0 80px ${theme.colors.blue.glow}`,
          }}>
            {ctaTextLines[0]}
          </div>
          <div style={{
            opacity: ctaLine2.opacity, transform:`translateX(${ctaLine2.translateX}px)`,
            fontFamily:theme.fonts.heading, fontSize:72, fontWeight:800,
            letterSpacing:'-0.04em', lineHeight:1.05,
            background:`linear-gradient(135deg,${theme.colors.blue.light} 0%,${theme.colors.orange.primary} 100%)`,
            WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent',
          }}>
            {ctaTextLines[1]}
          </div>
        </div>

        {/* Sub-text */}
        {product.ctaSubtext && (
          <div style={{
            opacity: interpolate(subP,[0,0.3,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
            transform:`translateY(${interpolate(subP,[0,1],[22,0])}px)`,
            fontFamily:theme.fonts.body, fontSize:22, fontWeight:400,
            color:theme.colors.text.secondary, letterSpacing:'0.05em',
            textAlign:'center', maxWidth:700, lineHeight:1.6,
          }}>
            {product.ctaSubtext}
          </div>
        )}

        {/* Horizontal accent sweep before CTA button */}
        {(() => {
        const swP = Math.min(Math.max((frame-140)/40,0),1);
        const swE = swP<0.5 ? 2*swP*swP : 1-Math.pow(-2*swP+2,2)/2;
        return (
          <div style={{
            width:`${swE*500}px`, height:1,
            background:`linear-gradient(90deg, transparent, ${theme.colors.blue.primary}, ${theme.colors.orange.primary}, transparent)`,
            opacity:Math.sin(swP*Math.PI)*0.55,
            pointerEvents:'none',
          }}/>
        );
      })()}

        {/* CTA button — impact scale */}
        <div style={{transform:`scale(${ctaBtnAnim.scale})`, opacity: ctaBtnAnim.opacity, position:'relative'}}>
          <div style={{
            display:'flex', alignItems:'center', gap:16,
            background:`linear-gradient(135deg, ${theme.colors.blue.primary} 0%, rgba(0,80,200,0.9) 100%)`,
            borderRadius:theme.radius.full, padding:'18px 52px',
            boxShadow:`0 0 ${38 + pulse*18}px ${theme.colors.blue.glow}, 0 ${18 + pulse*5}px 40px rgba(0,0,0,0.4)`,
          }}>
            <span style={{fontFamily:theme.fonts.heading,fontSize:22,fontWeight:700,color:'#FFFFFF',letterSpacing:'-0.01em'}}>
              Schedule a Demo
            </span>
            <span style={{fontSize:22}}>→</span>
          </div>

          {/* Gap #6: Cursor hand hovering over CTA button (appears after button settles) */}
          {(() => {
            const cursorDelay = 180; // 3s after scene starts
            const cP = Math.min(Math.max((frame - cursorDelay) / 30, 0), 1);
            const clickP = Math.min(Math.max((frame - cursorDelay - 50) / 8, 0), 1);
            const clickSc = 1 - clickP * 0.28;
            if (cP < 0.01) return null;
            return (
              <div style={{
                position:'absolute', right:-28, bottom:-32,
                opacity: cP,
                transform:`scale(${clickSc})`,
                pointerEvents:'none',
                fontSize:36, lineHeight:1,
                filter:'drop-shadow(0 2px 6px rgba(0,0,0,0.5))',
              }}>
                👆
              </div>
            );
          })()}
        </div>

        {/* Radial burst behind CTA */}
        <div style={{
          position:'absolute',
          width: `${interpolate(Math.min(Math.max((frame-155)/60,0),1), [0,1], [0,600])}px`,
          height:`${interpolate(Math.min(Math.max((frame-155)/60,0),1), [0,1], [0,600])}px`,
          borderRadius:'50%',
          border:`1px solid ${theme.colors.border.blue}`,
          opacity: Math.max(0, 0.3 - Math.min(Math.max((frame-155)/60,0),1) * 0.3),
          pointerEvents:'none',
        }}/>

        {/* Sweep divider */}
        <div style={{
          width:`${interpolate(sweepEase,[0,1],[0,400])}px`,
          height:1,
          background:`linear-gradient(90deg,transparent,${theme.colors.border.blue},transparent)`,
        }}/>

        {/* Contacts */}
        {contacts && contacts.length > 0 && (
          <div style={{
            opacity: interpolate(contactP,[0,0.3,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
            transform:`translateY(${interpolate(contactP,[0,1],[16,0])}px)`,
            display:'flex', flexDirection:'column', alignItems:'center', gap:10,
          }}>
            {/* Primary URL — large, prominent */}
            <div style={{
              fontFamily:theme.fonts.heading,
              fontSize:42, fontWeight:700,
              letterSpacing:'-0.02em',
              color:'rgba(255,255,255,0.92)',
            }}>
              {contacts[0].value}
            </div>
            {/* Secondary contacts — small */}
            {contacts.length > 1 && (
              <div style={{display:'flex', gap:36, alignItems:'center'}}>
                {contacts.slice(1).map((item,i) => (
                  <div key={i} style={{textAlign:'center'}}>
                    <div style={{fontFamily:theme.fonts.body,fontSize:11,fontWeight:600,color:theme.colors.text.tertiary,letterSpacing:'0.16em',textTransform:'uppercase',marginBottom:3}}>
                      {item.label}
                    </div>
                    <div style={{fontFamily:theme.fonts.body,fontSize:14,fontWeight:500,color:theme.colors.text.secondary}}>
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Corner accents */}
        {([{top:70,left:40},{top:70,right:40},{bottom:70,left:40},{bottom:70,right:40}] as React.CSSProperties[]).map((pos,i) => (
          <div key={i} style={{
            position:'absolute', ...pos, width:36, height:36,
            opacity: Math.min(Math.max((frame-160)/28,0),1) * (0.5+pulse*0.2),
            borderTop:    i<2  ? `1.5px solid rgba(0,102,255,${0.4+pulse*0.2})` : 'none',
            borderBottom: i>=2 ? `1.5px solid rgba(0,102,255,${0.4+pulse*0.2})` : 'none',
            borderLeft:   i%2===0 ? `1.5px solid rgba(0,102,255,${0.4+pulse*0.2})` : 'none',
            borderRight:  i%2===1 ? `1.5px solid rgba(0,102,255,${0.4+pulse*0.2})` : 'none',
          }}/>
        ))}

      </AbsoluteFill>
    </AbsoluteFill>
  );
};
