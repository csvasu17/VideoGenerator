/**
 * NarrativeHook — Problem statement with orbiting fault indicators.
 *
 * Reference motion language: app icons orbiting around central problem text.
 * Adapted for Rheem: fault/alert indicators orbit around the "Nobody knew" moment,
 * representing unmonitored failures across an enterprise fleet.
 *
 * Motion:
 *  0-20f  : indicators fly in from edges (scatter → orbit)
 *  20-120f: orbit slowly while text reveals line by line
 *  exit   : everything scales forward + fades
 */
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring} from 'remotion';
import {slideFromLeft} from '../utils/animations';
import {cinematicFade} from '../utils/transitions';
import {useTheme}       from '../themes';

export interface NarrativeHookProps {
  line1?: string;
  line2?: string;
  line3?: string;
}

// ─── Fault indicator particles ────────────────────────────────────────────────
// Each orbits at a unique radius / speed / phase, spiraling in from off-screen.
interface Particle {
  label: string;       // icon label (SVG text or symbol)
  color: string;       // fill color
  r: number;           // orbit radius from center
  speed: number;       // radians per second
  phase: number;       // start angle
  startX: number;      // entry X (off-screen)
  startY: number;      // entry Y (off-screen)
  size: number;        // circle diameter
  delay: number;       // entry delay frames
}

const CX = 960;  // canvas center X
const CY = 400;  // orbit center Y (slightly above canvas center, near text)

const PARTICLES: Particle[] = [
  {label:'!',  color:'#FF3B30', r:340, speed:0.28, phase:0.0,  startX:-200,  startY: 100, size:56, delay: 0},
  {label:'⚡', color:'#FF9500', r:290, speed:0.22, phase:1.2,  startX:2120,  startY: 200, size:48, delay: 5},
  {label:'?',  color:'#FF6B00', r:380, speed:0.18, phase:2.5,  startX:2100,  startY: 700, size:52, delay: 3},
  {label:'↑',  color:'#FF3B30', r:260, speed:0.32, phase:4.1,  startX:-180,  startY: 600, size:44, delay: 7},
  {label:'●',  color:'#FF453A', r:420, speed:0.15, phase:3.4,  startX: 200,  startY:-100, size:40, delay:10},
  {label:'×',  color:'#FF6B00', r:310, speed:0.25, phase:5.2,  startX:1900,  startY:-80,  size:50, delay: 2},
  {label:'~',  color:'#FF9500', r:460, speed:0.12, phase:0.9,  startX:-100,  startY: 900, size:36, delay:12},
  {label:'!',  color:'#FF3B30', r:230, speed:0.38, phase:2.1,  startX:2000,  startY: 900, size:42, delay: 8},
];

const FaultParticle: React.FC<{p: Particle; frame: number; fps: number}> = ({p, frame, fps}) => {
  // Entry spring: fly from off-screen position to orbit position
  const entryP = spring({fps, frame: Math.max(0, frame - p.delay), config:{damping:22,mass:1,stiffness:70,overshootClamping:false}, durationInFrames:40});

  // Current orbit angle
  const angle = p.phase + (frame / fps) * p.speed;
  const orbitX = CX + Math.cos(angle) * p.r;
  const orbitY = CY + Math.sin(angle) * p.r;

  // Interpolate from entry position to orbit position
  const cx = interpolate(entryP, [0,1], [p.startX, orbitX]);
  const cy = interpolate(entryP, [0,1], [p.startY, orbitY]);
  const opacity = interpolate(entryP, [0, 0.15, 1], [0, 1, 1], {extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  const scale = interpolate(entryP, [0, 1], [0.3, 1], {extrapolateLeft:'clamp',extrapolateRight:'clamp'});

  return (
    <div style={{
      position:'absolute',
      left: cx - p.size/2,
      top:  cy - p.size/2,
      width: p.size, height: p.size,
      borderRadius:'50%',
      // Gap #2 fix: vivid solid fill (was barely visible 0x22 fill)
      background:`radial-gradient(circle, ${p.color}55 0%, ${p.color}22 55%, transparent 75%)`,
      border:`1.5px solid ${p.color}88`,
      display:'flex', alignItems:'center', justifyContent:'center',
      opacity,
      transform:`scale(${scale})`,
      boxShadow:`0 0 ${p.size * 0.55}px ${p.color}66, 0 0 ${p.size * 0.2}px ${p.color}44 inset`,
      pointerEvents:'none',
    }}>
      <div style={{
        fontFamily:'system-ui, sans-serif',
        fontSize: p.size * 0.44, fontWeight:800,
        color: '#FFFFFF', lineHeight:1, userSelect:'none',
        textShadow:`0 0 8px ${p.color}`,
      }}>
        {p.label}
      </div>
    </div>
  );
};

// Thin curved connector lines between particles (matches reference's swirl lines)
const ConnectorLines: React.FC<{frame: number; fps: number}> = ({frame, fps}) => {
  const pathP = spring({fps, frame: Math.max(0, frame - 8), config:{damping:30,mass:1.5,stiffness:50}, durationInFrames:60});
  const dashLen = interpolate(pathP, [0,1], [0, 600]);
  const opacity = interpolate(pathP, [0,0.1,1], [0,0.4,0.25], {extrapolateLeft:'clamp',extrapolateRight:'clamp'});

  return (
    <svg style={{position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none', opacity}}>
      {/* Spiral curves connecting particles */}
      <path
        d={`M 400 300 Q 700 180 ${CX} ${CY} Q 1300 500 1600 700`}
        fill="none" stroke="rgba(255,107,0,0.35)" strokeWidth="1.2"
        strokeDasharray={`${dashLen} 9999`}
      />
      <path
        d={`M 1700 250 Q 1400 350 ${CX} ${CY} Q 600 620 300 800`}
        fill="none" stroke="rgba(255,59,48,0.30)" strokeWidth="1.0"
        strokeDasharray={`${dashLen} 9999`}
      />
      <path
        d={`M 500 700 Q 800 540 ${CX} ${CY} Q 1250 320 1500 150`}
        fill="none" stroke="rgba(255,149,0,0.25)" strokeWidth="0.9"
        strokeDasharray={`${dashLen} 9999`}
      />
    </svg>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────
export const NarrativeHook: React.FC<NarrativeHookProps> = ({
  line1 = 'A rooftop unit failed. 2am.',
  line2 = 'Nobody knew for 11 hours.',
  line3 = 'Six sites. Zero visibility.',
}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const theme = useTheme();

  const sceneOp = cinematicFade(frame, durationInFrames, 10, 24);

  // Text animations — staggered slide from left
  const anim1 = slideFromLeft(frame, fps,  4, 200);
  const anim2 = slideFromLeft(frame, fps, 28, 220);
  const anim3 = slideFromLeft(frame, fps, 54, 240);

  // Orange accent bar before line3
  const barP = spring({fps, frame: frame - 46, config:{damping:22,mass:0.6,stiffness:260}, durationInFrames:14});
  const barW = interpolate(barP, [0,1], [0, 52], {extrapolateLeft:'clamp',extrapolateRight:'clamp'});

  // Exit: scale forward + fade
  const exitStart = durationInFrames - 24;
  const exitP = Math.max(0, Math.min((frame - exitStart) / 24, 1));
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

      {/* Connector swirl lines */}
      <ConnectorLines frame={frame} fps={fps} />

      {/* Orbiting fault particles */}
      {PARTICLES.map((p, i) => (
        <FaultParticle key={i} p={p} frame={frame} fps={fps} />
      ))}

      {/* Central radial glow behind text */}
      <div style={{
        position:'absolute',
        top:'50%', left:'50%',
        transform:'translate(-50%, -50%)',
        width:700, height:500, borderRadius:'50%',
        background:'radial-gradient(ellipse, rgba(255,59,48,0.07) 0%, transparent 68%)',
        filter:'blur(40px)', pointerEvents:'none',
      }}/>

      {/* Problem text — exits scaling forward */}
      <AbsoluteFill style={{
        display:'flex', flexDirection:'column', justifyContent:'center',
        padding:'0 148px', gap:0,
        transform:`scale(${1 + exitE * 0.06})`,
      }}>

        {/* Line 1 — muted setup */}
        <div style={{
          opacity: anim1.opacity,
          transform:`translateX(${anim1.translateX}px)`,
          fontFamily: theme.fonts.body,
          fontSize:28, fontWeight:400,
          letterSpacing:'0.06em',
          color: theme.colors.text.secondary,
          marginBottom:20,
        }}>
          {line1}
        </div>

        {/* Line 2 — large white gut-punch */}
        <div style={{
          opacity: anim2.opacity,
          transform:`translateX(${anim2.translateX}px)`,
          fontFamily: theme.fonts.heading,
          fontSize:80, fontWeight:800,
          letterSpacing:'-0.04em', lineHeight:1.0,
          color: theme.colors.text.primary,
          marginBottom:40,
        }}>
          {line2}
        </div>

        {/* Orange accent bar */}
        <div style={{
          width:`${barW}px`, height:3, borderRadius:1.5,
          background: theme.colors.orange.primary,
          boxShadow:`0 0 14px ${theme.colors.orange.glow}`,
          marginBottom:20,
        }}/>

        {/* Line 3 — verdict */}
        <div style={{
          opacity: anim3.opacity,
          transform:`translateX(${anim3.translateX}px)`,
          fontFamily: theme.fonts.body,
          fontSize:16, fontWeight:700,
          letterSpacing:'0.24em', textTransform:'uppercase' as const,
          color: theme.colors.orange.primary,
        }}>
          {line3}
        </div>

      </AbsoluteFill>

      {/* Flash: white overlay scales in at exit */}
      <div style={{
        position:'absolute', inset:0,
        background:'rgba(255,255,255,0.85)',
        opacity: exitP > 0.65 ? Math.min((exitP - 0.65) / 0.35, 1) * 0.25 : 0,
        pointerEvents:'none',
      }}/>

    </AbsoluteFill>
  );
};
