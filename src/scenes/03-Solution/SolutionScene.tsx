
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {AnimatedBackground} from '../../components/AnimatedBackground';
import {RheemLogo} from '../../components/Logo';
import {theme} from '../../config/theme';
import {sceneFade} from '../../utils/transitions';
import {glowPulse} from '../../utils/animations';

const nodes = [
  {id:'iot',   label:'IoT Sensors',      icon:'📡', x:140,  y:200},
  {id:'cloud', label:'Cloud Platform',   icon:'☁️',  x:480,  y:200},
  {id:'ai',    label:'AI Engine',        icon:'🧠', x:820,  y:200},
  {id:'dash',  label:'Dashboard',        icon:'🖥️', x:1160, y:200},
  {id:'field', label:'Field Ops',        icon:'🔧', x:300,  y:440},
  {id:'mgmt',  label:'Management',       icon:'👔', x:700,  y:440},
  {id:'api',   label:'Integrations',     icon:'🔗', x:1060, y:440},
];

const edges: [string,string][] = [
  ['iot','cloud'],['cloud','ai'],['ai','dash'],
  ['cloud','field'],['ai','mgmt'],['dash','api'],
  ['field','mgmt'],['mgmt','api'],
];

function getNode(id: string) { return nodes.find(n => n.id === id)!; }

export const SolutionScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const sceneOpacity = sceneFade(frame, durationInFrames, 40, 40);
  const pulse = glowPulse(frame, fps, 0.5);

  const headP = spring({fps, frame:frame-20, config:{damping:25,mass:1,stiffness:80}, durationInFrames:45});
  const diagramP = spring({fps, frame:frame-60, config:{damping:20,mass:1,stiffness:60}, durationInFrames:60});

  return (
    <AbsoluteFill style={{opacity: sceneOpacity}}>
      <AnimatedBackground variant="subtle" />

      <AbsoluteFill style={{padding:'80px 120px', display:'flex', flexDirection:'column', gap:40}}>
        {/* Header */}
        <div style={{
          opacity: interpolate(headP,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
          transform: `translateY(${interpolate(headP,[0,1],[30,0])}px)`,
        }}>
          <div style={{
            display:'inline-flex', alignItems:'center', gap:10,
            background:theme.colors.blue.subtle, border:`1px solid ${theme.colors.border.blue}`,
            borderRadius:theme.radius.full, padding:'8px 20px', marginBottom:16,
          }}>
            <div style={{width:6,height:6,borderRadius:'50%',background:theme.colors.blue.primary,boxShadow:`0 0 6px ${theme.colors.blue.primary}`}}/>
            <span style={{fontFamily:theme.fonts.body,fontSize:14,fontWeight:600,color:theme.colors.text.accent,letterSpacing:'0.1em',textTransform:'uppercase'}}>
              The Platform
            </span>
          </div>
          <div style={{fontFamily:theme.fonts.heading,fontSize:52,fontWeight:800,letterSpacing:'-0.03em',color:theme.colors.text.primary,lineHeight:1.1}}>
            One Intelligent Platform<br/>
            <span style={{background:`linear-gradient(135deg, ${theme.colors.blue.light}, ${theme.colors.orange.primary})`,WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>
              End-to-End Operations
            </span>
          </div>
        </div>

        {/* Architecture Diagram */}
        <div style={{
          flex:1, position:'relative',
          opacity: interpolate(diagramP,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
          transform: `scale(${interpolate(diagramP,[0,1],[0.92,1])})`,
        }}>
          <svg width="100%" height="100%" viewBox="0 0 1400 520" style={{position:'absolute',top:0,left:0}}>
            {edges.map(([from,to],i) => {
              const a = getNode(from), b = getNode(to);
              const edgeP = spring({fps:60, frame: frame - 80 - i*12, config:{damping:25,mass:1,stiffness:80}, durationInFrames:40});
              const mx = (a.x+80 + b.x+80)/2, my = (a.y+40 + b.y+40)/2;
              return (
                <g key={i}>
                  <path
                    d={`M${a.x+80},${a.y+40} Q${mx},${my} ${b.x+80},${b.y+40}`}
                    stroke={`rgba(0,102,255,${0.15 + pulse*0.1})`}
                    strokeWidth={1.5} fill="none"
                    strokeDasharray="6 4"
                    opacity={edgeP}
                  />
                  <circle cx={b.x+80} cy={b.y+40} r={4}
                    fill={theme.colors.blue.primary}
                    opacity={edgeP * (0.6 + pulse*0.3)}
                  />
                </g>
              );
            })}
          </svg>

          {nodes.map((n, i) => {
            const nodeP = spring({fps:60, frame: frame-80-i*10, config:{damping:25,mass:1,stiffness:100}, durationInFrames:40});
            return (
              <div key={n.id} style={{
                position:'absolute',
                left: n.x, top: n.y,
                width:160, height:80,
                opacity: interpolate(nodeP,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
                transform: `scale(${interpolate(nodeP,[0,1],[0.7,1])})`,
              }}>
                <div style={{
                  width:'100%', height:'100%',
                  background: theme.colors.backgroundCard,
                  border: `1px solid ${theme.colors.border.blue}`,
                  borderRadius: theme.radius.md,
                  display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:6,
                  boxShadow: `0 8px 24px rgba(0,0,0,0.4), 0 0 20px ${theme.colors.blue.glow}`,
                }}>
                  <span style={{fontSize:22}}>{n.icon}</span>
                  <span style={{fontFamily:theme.fonts.body,fontSize:12,fontWeight:600,color:theme.colors.text.secondary,letterSpacing:'0.05em',textAlign:'center'}}>
                    {n.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
