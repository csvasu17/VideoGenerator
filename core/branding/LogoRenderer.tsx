import React from 'react';
import {useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {useTheme} from '../themes';
import type {ProductInfo} from '../types';

interface Props {
  product: ProductInfo;
  size?: number;
  delay?: number;
  showTagline?: boolean;
  animated?: boolean;
}

export const LogoRenderer: React.FC<Props> = ({product, size=80, delay=0, showTagline=false, animated=true}) => {
  const frame = useCurrentFrame();
  const {fps}  = useVideoConfig();
  const theme  = useTheme();

  const revealP = animated
    ? spring({fps, frame: frame-delay, config:{damping:20,mass:1,stiffness:80,overshootClamping:false}, durationInFrames:50})
    : 1;
  const tagP = animated
    ? spring({fps, frame: frame-delay-20, config:{damping:30,mass:1,stiffness:100,overshootClamping:false}, durationInFrames:40})
    : 1;

  const opacity = interpolate(revealP,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  const scale   = interpolate(revealP,[0,1],[0.7,1]);

  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:12}}>
      <div style={{opacity, transform: 'scale(' + scale + ')', display:'flex', alignItems:'center', gap:16}}>
        <div style={{
          width:size, height:size, borderRadius:size*0.18,
          background: 'linear-gradient(135deg,' + theme.colors.blue.primary + ' 0%,' + theme.colors.blue.light + ' 100%)',
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow: '0 0 ' + size*0.4 + 'px ' + theme.colors.blue.glow + ',0 ' + size*0.15 + 'px ' + size*0.3 + 'px rgba(0,0,0,0.4)',
          overflow:'hidden', position:'relative',
        }}>
          <div style={{
            width:size*0.55, height:size*0.55,
            borderRadius: size*0.5 + 'px ' + size*0.1 + 'px ' + size*0.3 + 'px ' + size*0.1 + 'px',
            background:'linear-gradient(180deg,rgba(255,255,255,0.9) 0%,rgba(255,200,100,0.8) 100%)',
            transform:'rotate(-10deg)',
          }}/>
        </div>
        <div style={{
          fontFamily:theme.fonts.heading, fontSize:size*0.75, fontWeight:800,
          letterSpacing:'-0.03em', color:theme.colors.text.primary,
          textShadow:'0 0 40px ' + theme.colors.blue.glow,
        }}>
          {product.name.toUpperCase()}
        </div>
      </div>
      {showTagline && (
        <div style={{
          opacity: interpolate(tagP,[0,0.3,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
          transform: 'translateY(' + interpolate(tagP,[0,1],[12,0]) + 'px)',
          fontFamily:theme.fonts.body, fontSize:size*0.18, fontWeight:400,
          letterSpacing:'0.15em', color:theme.colors.text.secondary, textTransform:'uppercase',
        }}>
          {product.tagline}
        </div>
      )}
    </div>
  );
};
