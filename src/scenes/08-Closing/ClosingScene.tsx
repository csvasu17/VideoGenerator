import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {AnimatedBackground} from '../../components/AnimatedBackground';
import {RheemLogo} from '../../components/Logo';
import {theme} from '../../config/theme';
import {sceneFade} from '../../utils/transitions';
import {glowPulse, floatY} from '../../utils/animations';

export const ClosingScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const sceneOpacity = sceneFade(frame, durationInFrames, 40, 60);
  const pulse = glowPulse(frame, fps, 0.4);
  const float = floatY(frame, fps, 8, 0.2);

  const logoP  = spring({fps, frame:frame-20,  config:{damping:20,mass:1,stiffness:70},  durationInFrames:55});
  const headP  = spring({fps, frame:frame-80,  config:{damping:25,mass:1,stiffness:80},  durationInFrames:45});
  const subP   = spring({fps, frame:frame-120, config:{damping:30,mass:1,stiffness:80},  durationInFrames:40});
  const ctaP   = spring({fps, frame:frame-160, config:{damping:25,mass:1,stiffness:70},  durationInFrames:50});
  const lineP  = spring({fps, frame:frame-200, config:{damping:30,mass:1,stiffness:100}, durationInFrames:40});
  const contactP=spring({fps, frame:frame-230, config:{damping:30,mass:1,stiffness:80},  durationInFrames:40});

  return (
    <AbsoluteFill style={{opacity: sceneOpacity}}>
      <AnimatedBackground variant="intense" />

      {/* Letterbox bars */}
      <div style={{position:'absolute',top:0,left:0,right:0,height:60,background:'rgba(0,0,0,0.7)'}}/>
      <div style={{position:'absolute',bottom:0,left:0,right:0,height:60,background:'rgba(0,0,0,0.7)'}}/>

      <AbsoluteFill style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:36}}>

        {/* Logo */}
        <div style={{
          opacity: interpolate(logoP,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
          transform: `translateY(${interpolate(logoP,[0,1],[30,0]) + float}px) scale(${interpolate(logoP,[0,1],[0.8,1])})`,
        }}>
          <RheemLogo size={70} delay={0} animated={false} />
        </div>

        {/* Main CTA */}
        <div style={{
          opacity: interpolate(headP,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
          transform: `translateY(${interpolate(headP,[0,1],[40,0])}px)`,
          textAlign:'center', display:'flex', flexDirection:'column', gap:0,
        }}>
          <div style={{
            fontFamily:theme.fonts.heading, fontSize:68, fontWeight:800,
            letterSpacing:'-0.04em', lineHeight:1.05,
            color:theme.colors.text.primary,
            textShadow:`0 0 80px ${theme.colors.blue.glow}`,
          }}>
            Transform Operations
          </div>
          <div style={{
            fontFamily:theme.fonts.heading, fontSize:68, fontWeight:800,
            letterSpacing:'-0.04em', lineHeight:1.05,
            background:`linear-gradient(135deg,${theme.colors.blue.light} 0%,${theme.colors.orange.primary} 100%)`,
            WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent',
          }}>
            with the Platform
          </div>
        </div>

        {/* Sub message */}
        <div style={{
          opacity: interpolate(subP,[0,0.3,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
          transform: `translateY(${interpolate(subP,[0,1],[20,0])}px)`,
          fontFamily:theme.fonts.body, fontSize:22, fontWeight:400,
          color:theme.colors.text.secondary, letterSpacing:'0.05em',
          textAlign:'center', maxWidth:700, lineHeight:1.6,
        }}>
          Join the enterprises redefining operations with intelligent, connected infrastructure
        </div>

        {/* CTA Button */}
        <div style={{
          opacity: interpolate(ctaP,[0,0.3,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
          transform: `scale(${interpolate(ctaP,[0,1],[0.85,1])})`,
        }}>
          <div style={{
            display:'flex', alignItems:'center', gap:16,
            background:`linear-gradient(135deg, ${theme.colors.blue.primary} 0%, rgba(0,80,200,0.9) 100%)`,
            borderRadius:theme.radius.full,
            padding:'18px 48px',
            boxShadow:`0 0 40px ${theme.colors.blue.glow}, 0 20px 40px rgba(0,0,0,0.4)`,
            cursor:'pointer',
          }}>
            <span style={{fontFamily:theme.fonts.heading,fontSize:20,fontWeight:700,color:'#FFFFFF',letterSpacing:'-0.01em'}}>
              Schedule a Demo
            </span>
            <span style={{fontSize:20}}>→</span>
          </div>
        </div>

        {/* Divider */}
        <div style={{
          width: `${interpolate(lineP,[0,1],[0,400])}px`,
          height:1,
          background:`linear-gradient(90deg,transparent,${theme.colors.border.blue},transparent)`,
        }}/>

        {/* Contact info */}
        <div style={{
          opacity: interpolate(contactP,[0,0.3,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
          transform: `translateY(${interpolate(contactP,[0,1],[15,0])}px)`,
          display:'flex', gap:48, alignItems:'center',
        }}>
          {[
            {label:'Website', value:'Schedule a Demo'},
            {label:'Enterprise', value:'Contact Sales'},
            {label:'Support', value:'Learn More'},
          ].map((item,i) => (
            <div key={i} style={{textAlign:'center'}}>
              <div style={{fontFamily:theme.fonts.body,fontSize:12,fontWeight:600,color:theme.colors.text.tertiary,letterSpacing:'0.12em',textTransform:'uppercase',marginBottom:4}}>
                {item.label}
              </div>
              <div style={{fontFamily:theme.fonts.body,fontSize:16,fontWeight:500,color:theme.colors.text.secondary}}>
                {item.value}
              </div>
            </div>
          ))}
        </div>

        {/* Corner accents */}
        {[{top:70,left:40},{top:70,right:40},{bottom:70,left:40},{bottom:70,right:40}].map((pos,i) => (
          <div key={i} style={{
            position:'absolute', ...pos,
            width:40, height:40,
            borderTop: i < 2 ? `2px solid rgba(0,102,255,${0.4+pulse*0.2})` : 'none',
            borderBottom: i >= 2 ? `2px solid rgba(0,102,255,${0.4+pulse*0.2})` : 'none',
            borderLeft: i%2===0 ? `2px solid rgba(0,102,255,${0.4+pulse*0.2})` : 'none',
            borderRight: i%2===1 ? `2px solid rgba(0,102,255,${0.4+pulse*0.2})` : 'none',
          }}/>
        ))}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
