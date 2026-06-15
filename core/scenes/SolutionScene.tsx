import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {AnimatedBackground} from '../components/AnimatedBackground';
import {useTheme} from '../themes';
import {sceneFade} from '../utils/transitions';
import {glowPulse} from '../utils/animations';
import type {SolutionNode, SolutionEdge} from '../types';

const DEFAULT_NODES: SolutionNode[] = [
  {id:'iot',   label:'IoT Sensors',  icon:'📡', x:140,  y:200},
  {id:'cloud', label:'Cloud',        icon:'☁️',  x:480,  y:200},
  {id:'ai',    label:'AI Engine',    icon:'🧠', x:820,  y:200},
  {id:'dash',  label:'Dashboard',    icon:'🖥️', x:1160, y:200},
  {id:'field', label:'Field Ops',    icon:'🔧', x:300,  y:440},
  {id:'mgmt',  label:'Management',   icon:'👔', x:700,  y:440},
  {id:'api',   label:'Integrations', icon:'🔗', x:1060, y:440},
];
const DEFAULT_EDGES: SolutionEdge[] = [
  {from:'iot',to:'cloud'},{from:'cloud',to:'ai'},{from:'ai',to:'dash'},
  {from:'cloud',to:'field'},{from:'ai',to:'mgmt'},{from:'dash',to:'api'},
  {from:'field',to:'mgmt'},{from:'mgmt',to:'api'},
];
function getNode(nodes:SolutionNode[], id:string){return nodes.find(n=>n.id===id)!;}

interface SolutionSceneProps {
  nodes?: SolutionNode[];
  edges?: SolutionEdge[];
  heading?: string;
  subheading?: string;
}

export const SolutionScene: React.FC<SolutionSceneProps> = ({nodes=DEFAULT_NODES, edges=DEFAULT_EDGES, heading, subheading}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const theme = useTheme();
  const sceneOpacity = sceneFade(frame, durationInFrames, 40, 40);
  const pulse = glowPulse(frame, fps, 0.5);
  const headP = spring({fps, frame:frame-20, config:{damping:25,mass:1,stiffness:80}, durationInFrames:45});
  const diagramP = spring({fps, frame:frame-50, config:{damping:20,mass:1,stiffness:60}, durationInFrames:60});

  return (
    <AbsoluteFill style={{opacity: sceneOpacity}}>
      <AnimatedBackground variant="subtle" />
      <AbsoluteFill style={{padding:'70px 110px', display:'flex', flexDirection:'column', gap:36}}>
        {(heading || subheading) && (
          <div style={{
            opacity: interpolate(headP,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
            transform: 'translateY(' + interpolate(headP,[0,1],[28,0]) + 'px)',
            display:'flex', flexDirection:'column', gap:8,
          }}>
            {heading && <div style={{fontFamily:theme.fonts.heading,fontSize:48,fontWeight:800,letterSpacing:'-0.03em',color:theme.colors.text.primary,lineHeight:1.1}}>{heading}</div>}
            {subheading && <div style={{fontFamily:theme.fonts.body,fontSize:20,color:theme.colors.text.secondary}}>{subheading}</div>}
          </div>
        )}
        <div style={{flex:1,position:'relative',opacity:interpolate(diagramP,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),transform:'scale('+interpolate(diagramP,[0,1],[0.93,1])+')',}}>
          <svg width="100%" height="100%" viewBox="0 0 1400 520" style={{position:'absolute',top:0,left:0}}>
            {edges.map(({from,to},i)=>{
              const a=getNode(nodes,from), b=getNode(nodes,to);
              const ep=spring({fps,frame:frame-70-i*10,config:{damping:25,mass:1,stiffness:80},durationInFrames:40});
              const mx=(a.x+80+b.x+80)/2, my=(a.y+40+b.y+40)/2;
              return <g key={i}>
                <path d={'M'+( a.x+80)+','+(a.y+40)+' Q'+mx+','+my+' '+(b.x+80)+','+(b.y+40)} stroke={'rgba(0,102,255,'+(0.15+pulse*0.08)+')'} strokeWidth={1.5} fill="none" strokeDasharray="6 4" opacity={ep}/>
                <circle cx={b.x+80} cy={b.y+40} r={3} fill={theme.colors.blue.primary} opacity={ep*(0.6+pulse*0.3)}/>
              </g>;
            })}
          </svg>
          {nodes.map((n,i)=>{
            const np=spring({fps,frame:frame-70-i*10,config:{damping:25,mass:1,stiffness:100},durationInFrames:40});
            return <div key={n.id} style={{position:'absolute',left:n.x,top:n.y,width:160,height:80,opacity:interpolate(np,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),transform:'scale('+interpolate(np,[0,1],[0.7,1])+')',}}>
              <div style={{width:'100%',height:'100%',background:theme.colors.backgroundCard,border:'1px solid '+theme.colors.border.blue,borderRadius:theme.radius.md,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:5,boxShadow:'0 8px 24px rgba(0,0,0,0.4),0 0 20px '+theme.colors.blue.glow,}}>
                <span style={{fontSize:20}}>{n.icon}</span>
                <span style={{fontFamily:theme.fonts.body,fontSize:11,fontWeight:600,color:theme.colors.text.secondary,letterSpacing:'0.04em',textAlign:'center'}}>{n.label}</span>
              </div>
            </div>;
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
