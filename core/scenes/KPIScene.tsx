import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {AnimatedBackground} from '../components/AnimatedBackground';
import {useTheme} from '../themes';
import {cinematicFade, scenePresenceStyle} from '../utils/transitions';
import {impactScale, slideFromLeft} from '../utils/animations';

const FALLBACK_METRICS: Array<{value:string;label:string;sub:string;accent:'blue'|'orange'}> = [
  {value:'60%',   label:'Faster Resolution',  sub:'Avg service ticket resolution time',    accent:'blue'},
  {value:'40%',   label:'Less Manual Work',   sub:'Reduction in repetitive tasks',         accent:'orange'},
  {value:'99.9%', label:'System Uptime',      sub:'Equipment availability w/ predictive',  accent:'blue'},
  {value:'3.2×',  label:'ROI — Year One',     sub:'Return on investment, first 12 months', accent:'orange'},
];

// ─── Animated counter helper ──────────────────────────────────────────────────
// Parses "60%", "99.9%", "3.2×" → animates numeric part from 0 to target.
function animatedMetric(raw: string, frame: number, fps: number, delay: number): string {
  // Match optional leading non-numeric prefix, then number, then suffix
  const m = raw.match(/^([^0-9]*)([0-9]+\.?[0-9]*)(.*)$/);
  if (!m) return raw;
  const prefix  = m[1];
  const numStr  = m[2];
  const suffix  = m[3];
  const target  = parseFloat(numStr);
  const decimals = numStr.includes('.') ? numStr.split('.')[1].length : 0;

  const p = spring({
    fps,
    frame: Math.max(0, frame - delay),
    config: {damping: 22, stiffness: 42, mass: 2.0, overshootClamping: false},
    durationInFrames: 180,
  });
  const current = interpolate(p, [0, 1], [0, target], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  return prefix + current.toFixed(decimals) + suffix;
}

interface MetricCardProps {
  value:string; label:string; sub:string; accent:'blue'|'orange';
  delay:number; frame:number; fps:number; theme:ReturnType<typeof useTheme>;
}

const MetricCard: React.FC<MetricCardProps> = ({value,label,sub,accent,delay,frame,fps,theme}) => {
  const anim = impactScale(frame, fps, delay);
  const accentColor = accent==='orange' ? theme.colors.orange.primary : theme.colors.blue.primary;
  const accentGlow  = accent==='orange' ? theme.colors.orange.glow   : theme.colors.blue.glow;
  const borderColor = accent==='orange' ? theme.colors.border.orange : theme.colors.border.blue;

  // The counter delay matches the card entrance delay — counts up as card appears
  const animated = animatedMetric(value, frame, fps, delay + 4);

  return (
    <div style={{
      transform:`scale(${anim.scale})`, opacity:anim.opacity,
      background:theme.colors.backgroundCard,
      border:`1px solid ${borderColor}`,
      borderRadius:theme.radius.lg,
      padding:'32px 36px',
      display:'flex', flexDirection:'column', gap:10,
      boxShadow:`0 8px 40px rgba(0,0,0,0.5), 0 0 28px ${accentGlow}22`,
      position:'relative', overflow:'hidden',
    }}>
      <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:accentColor,opacity:0.88}}/>
      {/* Animated metric value */}
      <div style={{
        fontFamily:theme.fonts.heading, fontSize:68, fontWeight:900,
        letterSpacing:'-0.04em', lineHeight:1,
        background:`linear-gradient(135deg, #FFFFFF 15%, ${accentColor} 100%)`,
        WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent',
      }}>{animated}</div>
      <div style={{fontFamily:theme.fonts.heading,fontSize:17,fontWeight:700,letterSpacing:'-0.01em',color:theme.colors.text.primary}}>{label}</div>
      <div style={{fontFamily:theme.fonts.body,fontSize:15,fontWeight:400,letterSpacing:'0.02em',lineHeight:1.5,color:theme.colors.text.tertiary}}>{sub}</div>
    </div>
  );
};

export interface KPISceneProps {
  metrics?: Array<{value:string; label:string; sub:string; accent:'blue'|'orange'}>;
}

export const KPIScene: React.FC<KPISceneProps> = ({metrics}) => {
  const METRICS = metrics && metrics.length > 0 ? metrics : FALLBACK_METRICS;
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const theme = useTheme();
  const TRANS = 22;
  const sceneOp  = cinematicFade(frame, durationInFrames, TRANS, TRANS);
  const presence = scenePresenceStyle(frame, durationInFrames, TRANS, TRANS, 'from-bottom', 'push-up');
  const eyebrowAnim = slideFromLeft(frame, fps, 12, 80);
  const line1P = spring({fps, frame:frame-28, config:{damping:22,mass:1,stiffness:140,overshootClamping:false}, durationInFrames:28});
  const line2P = spring({fps, frame:frame-50, config:{damping:22,mass:1,stiffness:140,overshootClamping:false}, durationInFrames:28});
  const footerOp = Math.min(Math.max((frame-240)/30,0),1);
  return (
    <AbsoluteFill style={{opacity:sceneOp, ...presence}}>
      <AnimatedBackground variant="intense" />
      <div style={{position:'absolute',top:0,left:0,right:0,height:22,background:'rgba(0,0,0,0.72)'}}/>
      <div style={{position:'absolute',bottom:0,left:0,right:0,height:22,background:'rgba(0,0,0,0.72)'}}/>
      <AbsoluteFill style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:36,padding:'50px 100px'}}>
        <div style={{textAlign:'center',display:'flex',flexDirection:'column',gap:6}}>
          <div style={{opacity:eyebrowAnim.opacity,transform:`translateX(${eyebrowAnim.translateX}px)`,fontFamily:theme.fonts.body,fontSize:12,fontWeight:700,letterSpacing:'0.22em',textTransform:'uppercase',color:theme.colors.blue.primary}}>Proven Results</div>
          <div style={{opacity:interpolate(line1P,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),transform:`translateY(${interpolate(line1P,[0,1],[20,0])}px)`,fontFamily:theme.fonts.heading,fontSize:50,fontWeight:800,letterSpacing:'-0.03em',lineHeight:1.05,color:theme.colors.text.primary}}>Measurable impact.</div>
          <div style={{opacity:interpolate(line2P,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),transform:`translateY(${interpolate(line2P,[0,1],[20,0])}px)`,fontFamily:theme.fonts.heading,fontSize:50,fontWeight:800,letterSpacing:'-0.03em',lineHeight:1.05,background:`linear-gradient(135deg, ${theme.colors.blue.light} 0%, ${theme.colors.orange.primary} 100%)`,WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>From day one.</div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:18,width:'100%'}}>
          {METRICS.map((m,i) => (
            <MetricCard key={i} value={m.value} label={m.label} sub={m.sub} accent={m.accent} delay={96+i*32} frame={frame} fps={fps} theme={theme}/>
          ))}
        </div>
        <div style={{opacity:footerOp,fontFamily:theme.fonts.body,fontSize:13,fontWeight:400,color:theme.colors.text.tertiary,letterSpacing:'0.06em',textAlign:'center'}}>
          Based on average performance improvements across Rheem enterprise deployments · 2025
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
