/**
 * MicroClaim — 2s punchy impact moment.
 * Motion: instant background flash → lines SNAP in with spring overshoot →
 * hold → zoom-forward exit (scale up + flash out).
 * Apple keynote reference: the text IS the camera.
 */
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {useTheme} from '../themes';
import {impactScale, glowPulse} from '../utils/animations';

export interface MicroClaimProps {
  line1:   string;
  line2?:  string;
  stat?:   string;
  accent?: 'blue' | 'orange';
}

export const MicroClaim: React.FC<MicroClaimProps> = ({line1, line2, stat, accent='blue'}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const theme = useTheme();

  const accentColor = accent==='orange' ? theme.colors.orange.primary : theme.colors.blue.primary;
  const accentOpp   = accent==='orange' ? theme.colors.blue.primary   : theme.colors.orange.primary;

  // Background: near-instant flash in
  const bgFlash = Math.min(frame / 5, 1);

  // Lines: impact scale entrance
  const l1 = impactScale(frame, fps, 7);
  const l2 = impactScale(frame, fps, 20);

  // Stat: gentle spring up
  const statP = spring({fps, frame: frame-38, config:{damping:30,mass:1,stiffness:100}, durationInFrames:25});

  // Exit: zoom forward (scale up) + flash out
  const exitStart = durationInFrames - 22;
  const exitP  = Math.max(0, Math.min((frame - exitStart) / 22, 1));
  const exitE  = exitP*exitP;

  // Ambient glow pulse
  const glow = glowPulse(frame, fps, 0.6);

  return (
    <AbsoluteFill style={{
      overflow: 'hidden',
      opacity: (1 - exitE) * bgFlash,
    }}>
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

      {/* Ambient center glow */}
      <div style={{
        position:'absolute', inset:0,
        background:`radial-gradient(ellipse 55% 50% at 50% 50%, ${accentColor}18 0%, transparent 68%)`,
        opacity: 0.5 + glow * 0.5,
      }}/>

      {/* Content — zoom-forward on exit */}
      <AbsoluteFill style={{
        display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12,
        padding:'0 180px',
        transform:`scale(${1 + exitE * 0.09})`,
      }}>

        <div style={{
          transform:`scale(${l1.scale})`,
          opacity: l1.opacity,
          fontFamily: theme.fonts.heading,
          fontSize:96, fontWeight:800,
          letterSpacing:'-0.05em', lineHeight:1.0,
          color: theme.colors.text.primary,
          textAlign:'center',
        }}>
          {line1}
        </div>

        {line2 && (
          <div style={{
            transform:`scale(${l2.scale})`,
            opacity: l2.opacity,
            fontFamily: theme.fonts.heading,
            fontSize:96, fontWeight:800,
            letterSpacing:'-0.05em', lineHeight:1.0,
            background:`linear-gradient(135deg, ${accentColor} 0%, ${accentOpp} 100%)`,
            WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent',
            textAlign:'center',
          }}>
            {line2}
          </div>
        )}

        {stat && (
          <>
            <div style={{width:48, height:2, borderRadius:1, background:accentColor, opacity:0.6, marginTop:8, marginBottom:8}}/>
            <div style={{
              opacity: interpolate(statP,[0,0.3,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
              transform:`translateY(${interpolate(statP,[0,1],[14,0])}px)`,
              fontFamily:theme.fonts.body, fontWeight:400,
              color:theme.colors.text.secondary,
              textAlign:'center', marginTop:10,
              letterSpacing:'0.1em', textTransform:'uppercase', fontSize:21,
            }}>
              {stat}
            </div>
          </>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
