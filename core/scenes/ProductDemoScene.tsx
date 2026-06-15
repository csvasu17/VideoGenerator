/**
 * ProductDemoScene — Floating Island Carousel v4
 *
 * All 7 reference gap improvements applied:
 *  1. SCREEN_H 720→800 — taller window shows more product content
 *  2. Ghost shows real browser chrome (no dark cover) — like reference
 *  3. Label as lower-third INSIDE the screen — integrated, not floating below
 *  4. Floating data chips in left/right margins — ambient life around screen
 *  5. Tap cursor on nav dots before each transition — simulates user interaction
 *  6. Vivid side blobs fill margins — no dark voids
 *  7. Simultaneous slide (both screens visible mid-transition)
 */

import React from 'react';
import {
  AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig,
  spring, interpolate, OffthreadVideo, staticFile,
} from 'remotion';
import {useTheme}      from '../themes';
import {cinematicFade} from '../utils/transitions';

// ─── Layout ──────────────────────────────────────────────────────────────────
const SCREEN_W  = 1280;
const SCREEN_H  = 800;                        // Gap #1: taller (was 720)
const CHROME_H  = 36;
const FRAME_H   = SCREEN_H + CHROME_H;       // 836
const SCREEN_X  = (1920 - SCREEN_W) / 2;     // 320
const SCREEN_Y  = 68;

const SLIDE_DIST   = 1310;
const SLIDE_DUR    = 55;
const COVER_DUR    = 20;
const SLIDE_SPRING = {damping: 20, mass: 1.4, stiffness: 46, overshootClamping: false};
const LABEL_SPRING = {damping: 20, mass: 0.8, stiffness: 180, overshootClamping: true};

// ─── Gap #4: Floating data chips in left/right margins ───────────────────────
interface Chip { x: number; y: number; text: string; color: string; delay: number; speed: number; amp: number; }
const DATA_CHIPS: Chip[] = [
  {x:  36, y: 230, text: '27 Devices',   color: '#0066FF', delay:  8, speed: 0.18, amp: 12},
  {x:  28, y: 440, text: '6 Sites',       color: '#FF6B00', delay: 18, speed: 0.14, amp: 10},
  {x:  44, y: 660, text: 'Fleet Live',    color: '#0066FF', delay: 12, speed: 0.22, amp: 8},
  {x:1650, y: 280, text: 'RTU Online',    color: '#00C96A', delay:  5, speed: 0.16, amp: 10},
  {x:1642, y: 490, text: 'AI Active',     color: '#0066FF', delay: 15, speed: 0.20, amp: 12},
  {x:1656, y: 700, text: 'No Faults',     color: '#00C96A', delay: 22, speed: 0.12, amp: 8},
];

// ─── Types ───────────────────────────────────────────────────────────────────
interface ZoomRegion     { startFrame:number; endFrame:number; x:number; y:number; width:number; height:number; }
interface ClickHighlight { frame:number; x:number; y:number; label?:string; }

export interface DemoSegment {
  id:string; startFrame:number; endFrame:number;
  title?:string; subtitle?:string;
  src?:string; startFrom?:number; accent?:'blue'|'orange';
  zoomRegions?:ZoomRegion[]; clickHighlights?:ClickHighlight[];
}
export interface ProductDemoSceneProps {
  segments: DemoSegment[];
  firstSegIndex?: number;
}

// ─── Active index ─────────────────────────────────────────────────────────────
function activeIdx(segs: DemoSegment[], frame: number): number {
  let idx = 0;
  for (let i = 0; i < segs.length; i++) { if (frame >= segs[i].startFrame) idx = i; }
  return idx;
}

// ─── Slide state ──────────────────────────────────────────────────────────────
function slideState(
  segIdx:number, aIdx:number,
  segs:DemoSegment[], frame:number, fps:number,
): {x:number; opacity:number; blur:number} {

  if (segIdx === aIdx) {
    const p = spring({fps, frame: Math.max(0, frame - segs[segIdx].startFrame), config: SLIDE_SPRING, durationInFrames: SLIDE_DUR});
    return {x: interpolate(p,[0,1],[SLIDE_DIST,0]), opacity:1, blur:0};
  }
  if (segIdx === aIdx - 1) {
    const p = spring({fps, frame: Math.max(0, frame - segs[aIdx].startFrame), config: SLIDE_SPRING, durationInFrames: SLIDE_DUR});
    return {
      x:       interpolate(p,[0,1],[0,-SLIDE_DIST]),
      opacity: interpolate(p,[0,0.80,1],[1,1,0], {extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
      blur:    interpolate(p,[0,1],[0,2.5]),
    };
  }
  if (segIdx < aIdx - 1) return {x:-SLIDE_DIST, opacity:0, blur:0};
  if (segIdx === aIdx + 1) return {x:SLIDE_DIST, opacity:0.32, blur:0};  // Gap #2: ghost visible
  return {x:SLIDE_DIST, opacity:0, blur:0};
}

// ─── ScreenSlide ──────────────────────────────────────────────────────────────
const ScreenSlide: React.FC<{
  seg: DemoSegment; frame: number; fps: number;
  theme: ReturnType<typeof useTheme>;
  isGhost: boolean;  // Gap #2: ghost gets no cover so it shows browser chrome
}> = ({seg, frame, fps, theme, isGhost}) => {
  const lf     = frame - seg.startFrame;
  const segDur = seg.endFrame - seg.startFrame;

  const isOrange    = seg.accent === 'orange';
  const accentColor = isOrange ? theme.colors.orange.primary : theme.colors.blue.primary;
  const accentGlow  = isOrange ? theme.colors.orange.glow    : theme.colors.blue.glow;
  const accentSubtle = isOrange ? theme.colors.orange.subtle : theme.colors.blue.subtle;
  const isVideo = Boolean(seg.src && /\.(mp4|webm|mov|avi|mkv)$/i.test(seg.src));

  // Gap #2: ghosts show no cover — their browser chrome peeks as a real preview
  const coverOp = isGhost ? 0 : (lf < 0 ? 1 : lf < COVER_DUR ? Math.max(0, 1 - lf / COVER_DUR) : 0);

  const ripples = (seg.clickHighlights ?? []).filter(c => lf >= c.frame && lf < c.frame + 70);

  // Subtle ambient zoom per clip
  const zoomP = spring({fps, frame: Math.max(0, lf), config:{damping:80,mass:2.5,stiffness:14,overshootClamping:true}, durationInFrames:segDur});
  const zoom  = interpolate(zoomP,[0,1],[1.0,1.035],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});

  return (
    <div style={{
      width:SCREEN_W, flexShrink:0, borderRadius:14, overflow:'hidden',
      border:'1px solid rgba(255,255,255,0.11)',
      boxShadow:[
        '0 36px 110px rgba(0,0,0,0.82)',
        '0 0 0 1px rgba(255,255,255,0.05)',
        `0 0 55px ${accentGlow}44`,
        `0 0 110px ${accentGlow}22`,
      ].join(', '),
    }}>

      {/* Browser chrome */}
      <div style={{
        height:CHROME_H, background:'rgba(8,8,20,0.98)',
        borderBottom:'1px solid rgba(255,255,255,0.065)',
        display:'flex', alignItems:'center', padding:'0 14px', gap:8,
      }}>
        {['#FF5F57','#FEBC2E','#28C840'].map((c,i) => (
          <div key={i} style={{width:11,height:11,borderRadius:'50%',background:c,opacity:0.88}}/>
        ))}
        <div style={{
          flex:1, marginLeft:12, height:20, borderRadius:4,
          background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.06)',
          display:'flex', alignItems:'center', paddingLeft:10,
          fontFamily:'"SF Mono",monospace', fontSize:10,
          color:'rgba(255,255,255,0.24)', letterSpacing:'0.02em',
        }}>app.rheem-totalview.com</div>
        <div style={{
          fontFamily:theme.fonts.body, fontSize:9, fontWeight:700,
          color:accentColor, letterSpacing:'0.1em', textTransform:'uppercase' as const,
          background:accentSubtle, padding:'2px 8px', borderRadius:4,
          border:`1px solid ${accentGlow}`, marginLeft:8,
        }}>LIVE</div>
      </div>

      {/* Recording area */}
      <div style={{height:SCREEN_H, position:'relative', overflow:'hidden', background:'#08080E'}}>
        <Sequence from={seg.startFrame} durationInFrames={segDur}>
          <div style={{width:'100%',height:'100%',transform:`scale(${zoom})`,transformOrigin:'center center',willChange:'transform'}}>
            {isVideo && seg.src && (
              <OffthreadVideo
                src={staticFile(seg.src.replace(/^\//, ''))}
                startFrom={seg.startFrom ?? 0}
                style={{width:'100%',height:'100%',objectFit:'cover'}}
              />
            )}
          </div>
        </Sequence>
        {coverOp > 0.01 && (
          <div style={{position:'absolute',inset:0,background:'#08080E',opacity:coverOp,zIndex:4,pointerEvents:'none'}}/>
        )}
        <div style={{position:'absolute',inset:0,pointerEvents:'none',zIndex:2,background:'radial-gradient(ellipse 88% 84% at 50% 48%, transparent 50%, rgba(0,0,0,0.28) 100%)'}}/>
        {ripples.map((c,i) => {
          const t = (lf - c.frame) / 70;
          return (
            <div key={i} style={{
              position:'absolute', left:c.x-28, top:c.y-28, width:56, height:56,
              borderRadius:'50%', border:`2.5px solid ${accentColor}`,
              opacity:interpolate(t,[0,0.2,1],[0,1,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
              transform:`scale(${interpolate(t,[0,1],[0.4,2.4])})`,
              boxShadow:`0 0 20px ${accentGlow}`, pointerEvents:'none', zIndex:5,
            }}/>
          );
        })}
      </div>
    </div>
  );
};

// ─── Main scene ───────────────────────────────────────────────────────────────
export const ProductDemoScene: React.FC<ProductDemoSceneProps> = ({segments}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const theme = useTheme();

  if (!segments?.length) return null;

  const sceneOp = cinematicFade(frame, durationInFrames, 30, 30);
  const aIdx    = activeIdx(segments, frame);
  const active  = segments[aIdx];

  const isOrange    = active.accent === 'orange';
  const accentColor = isOrange ? theme.colors.orange.primary : theme.colors.blue.primary;
  const accentGlow  = isOrange ? theme.colors.orange.glow   : theme.colors.blue.glow;

  // Gap #3: label as lower-third — sweeps in at mid-slide point
  const labelDelay  = active.startFrame + Math.round(SLIDE_DUR * 0.55);
  const labelReveal = spring({fps, frame: Math.max(0, frame - labelDelay), config:LABEL_SPRING, durationInFrames:22});
  const labelClip   = interpolate(labelReveal,[0,1],[100,0]);
  const labelOp     = interpolate(labelReveal,[0,0.3,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});

  const totalDur = segments[segments.length-1].endFrame;
  const progress = totalDur > 0 ? Math.min(frame/totalDur,1) : 0;

  return (
    <AbsoluteFill style={{opacity:sceneOp, overflow:'hidden'}}>

      {/* ── SMOOTH GRADIENT WASH — matches reference exactly ──
           Reference = watercolor wash: blue-lavender (left) → pink-purple (right)
           Huge ultra-blurry orbs overlap and blend into a continuous gradient flow.
      ── */}
      <div style={{position:'absolute', inset:0, background:'#060510'}}/>

      {/* BLUE-LAVENDER WASH — covers entire left half smoothly */}
      <div style={{
        position:'absolute', top:'-40%', left:'-30%',
        width:1500, height:1500, borderRadius:'50%',
        background:'radial-gradient(circle, rgba(80,100,255,0.55) 0%, rgba(50,60,200,0.30) 40%, transparent 68%)',
        filter:'blur(110px)', pointerEvents:'none',
      }}/>

      {/* PINK-PURPLE WASH — covers entire right half smoothly */}
      <div style={{
        position:'absolute', bottom:'-40%', right:'-30%',
        width:1500, height:1500, borderRadius:'50%',
        background:'radial-gradient(circle, rgba(200,60,255,0.52) 0%, rgba(160,20,200,0.28) 40%, transparent 68%)',
        filter:'blur(110px)', pointerEvents:'none',
      }}/>

      {/* CENTER BLEND — ties both washes into a seamless gradient */}
      <div style={{
        position:'absolute', top:'10%', left:'50%', transform:'translateX(-50%)',
        width:1800, height:600, borderRadius:'50%',
        background:'radial-gradient(ellipse, rgba(130,80,255,0.18) 0%, transparent 65%)',
        filter:'blur(80px)', pointerEvents:'none',
      }}/>

      {/* Fine grid */}
      <div style={{position:'absolute',inset:0,backgroundImage:['linear-gradient(rgba(255,255,255,0.016) 1px, transparent 1px)','linear-gradient(90deg, rgba(255,255,255,0.016) 1px, transparent 1px)'].join(', '),backgroundSize:'80px 80px'}}/>

      {/* Letterbox */}
      <div style={{position:'absolute',top:0,left:0,right:0,height:20,background:'rgba(0,0,0,0.50)',zIndex:20}}/>
      <div style={{position:'absolute',bottom:0,left:0,right:0,height:20,background:'rgba(0,0,0,0.50)',zIndex:20}}/>

      {/* ── Gap #4: Floating data chips in side margins ── */}
      {DATA_CHIPS.map((chip, i) => {
        const floatY  = Math.sin((frame / fps) * chip.speed * Math.PI * 2 + i) * chip.amp;
        const appear  = spring({fps, frame: Math.max(0, frame - chip.delay), config:{damping:28,mass:1,stiffness:90,overshootClamping:false}, durationInFrames:30});
        return (
          <div key={i} style={{
            position:'absolute', left:chip.x, top:chip.y + floatY,
            opacity: Math.min(appear, 1) * 0.72,
            transform:`scale(${appear})`,
            pointerEvents:'none', zIndex:8,
            display:'flex', alignItems:'center', gap:8,
            background:`${chip.color}14`,
            border:`1px solid ${chip.color}30`,
            borderRadius:20, padding:'7px 14px',
          }}>
            <div style={{width:7,height:7,borderRadius:'50%',background:chip.color,boxShadow:`0 0 6px ${chip.color}`}}/>
            <span style={{fontFamily:theme.fonts.body,fontSize:13,fontWeight:600,color:'rgba(255,255,255,0.82)',letterSpacing:'0.02em',whiteSpace:'nowrap' as const}}>
              {chip.text}
            </span>
          </div>
        );
      })}

      {/* ── Floating screen carousel ── */}
      {segments.map((seg, i) => {
        const {x, opacity, blur} = slideState(i, aIdx, segments, frame, fps);
        if (opacity < 0.005) return null;
        return (
          <div key={seg.id} style={{
            position:'absolute', top:SCREEN_Y, left:SCREEN_X,
            transform:`translateX(${x.toFixed(2)}px)`,
            opacity, filter:blur > 0.1 ? `blur(${blur.toFixed(1)}px)` : 'none',
            willChange:'transform',
          }}>
            <ScreenSlide seg={seg} frame={frame} fps={fps} theme={theme} isGhost={i === aIdx+1}/>
          </div>
        );
      })}

      {/* ── Feature label — BELOW the screen frame (nothing hidden) ── */}
      {active.title && (
        <div style={{
          position:'absolute',
          top: SCREEN_Y + FRAME_H + 14,   // 14px gap below the screen frame
          left: SCREEN_X,
          width: SCREEN_W,
          clipPath:`inset(0 ${labelClip.toFixed(2)}% 0 0)`,
          opacity: labelOp,
          pointerEvents:'none', zIndex:15,
        }}>
          <div style={{padding:'0 24px', display:'flex', flexDirection:'column', gap:6}}>
            <div style={{display:'flex', alignItems:'center', gap:14}}>
              <div style={{width:5,height:38,borderRadius:3,flexShrink:0,background:accentColor,boxShadow:`0 0 14px ${accentGlow}`}}/>
              <div style={{
                fontFamily:theme.fonts.heading, fontSize:36, fontWeight:800,
                letterSpacing:'-0.03em', lineHeight:1,
                background:`linear-gradient(118deg, #FFFFFF 10%, ${accentColor} 100%)`,
                WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent',
              }}>{active.title}</div>
            </div>
            {active.subtitle && (
              <div style={{
                fontFamily:theme.fonts.body, fontSize:16, fontWeight:400, lineHeight:1.5,
                color:'rgba(255,255,255,0.52)', paddingLeft:19, maxWidth:900,
              }}>{active.subtitle}</div>
            )}
          </div>
        </div>
      )}

      {/* ── Nav dots + Gap #5: tap cursor before transition ── */}
      {segments.length > 1 && (() => {
        const nextSeg = segments[aIdx + 1];
        const framesToNext = nextSeg ? nextSeg.startFrame - frame : 999;
        const showCursor = framesToNext >= 0 && framesToNext < 65;
        const cursorP  = showCursor ? spring({fps, frame: Math.max(0, 65 - framesToNext), config:{damping:20,mass:1,stiffness:150}, durationInFrames:25}) : 0;
        const clickSc  = framesToNext < 12 ? 1 - spring({fps, frame:Math.max(0,12-framesToNext), config:{damping:14,mass:0.7,stiffness:280}, durationInFrames:10}) * 0.35 : 1;

        return (
          <div style={{
            position:'absolute',
            top: SCREEN_Y + FRAME_H + 80,   // below label
            left: '50%', transform:'translateX(-50%)',
            display:'flex', gap:8, alignItems:'center', zIndex:10,
          }}>
            {segments.map((_, i) => {
              const isActive = i === aIdx;
              return (
                <div key={i} style={{
                  width: isActive ? 28 : 8, height:8, borderRadius:4,
                  background: isActive ? accentColor : 'rgba(255,255,255,0.20)',
                  boxShadow: isActive ? `0 0 10px ${accentGlow}` : 'none',
                  position:'relative',
                }}>
                  {/* Tap cursor ripple on the NEXT dot */}
                  {showCursor && i === aIdx + 1 && (
                    <div style={{
                      position:'absolute', left:'50%', top:'50%',
                      transform:`translate(-50%,-50%) scale(${clickSc})`,
                      width:22, height:22, borderRadius:'50%',
                      border:`2px solid rgba(255,255,255,${cursorP * 0.7})`,
                      boxShadow:`0 0 8px rgba(255,255,255,${cursorP * 0.4})`,
                      opacity: cursorP,
                      pointerEvents:'none',
                    }}/>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Progress bar */}
      <div style={{position:'absolute',bottom:0,left:0,right:0,height:2,zIndex:25}}>
        <div style={{height:'100%',width:`${progress*100}%`,background:`linear-gradient(90deg,${theme.colors.blue.primary},${theme.colors.orange.primary})`,opacity:0.85}}/>
      </div>

    </AbsoluteFill>
  );
};
