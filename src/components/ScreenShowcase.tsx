import React from 'react';
import {useCurrentFrame, useVideoConfig, spring, interpolate, Video, staticFile} from 'remotion';
import {theme} from '../config/theme';

interface ZoomRegion {
  startFrame: number;
  endFrame: number;
  x: number; y: number;
  width: number; height: number;
  label?: string;
}

interface ClickHighlight {
  frame: number;
  x: number; y: number;
  label?: string;
}

interface Props {
  src?: string;
  startFrom?: number;
  fallbackColor?: string;
  zoomRegions?: ZoomRegion[];
  clickHighlights?: ClickHighlight[];
  caption?: string;
  delay?: number;
}

const VIDEO_EXTS = /\.(mp4|webm|mov|avi|mkv)$/i;

export const ScreenShowcase: React.FC<Props> = ({
  src, startFrom=0, fallbackColor='#0D0D1A', zoomRegions=[], clickHighlights=[], caption, delay=0
}) => {
  const isVideo = Boolean(src && VIDEO_EXTS.test(src));
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();

  const appear = spring({fps, frame: frame-delay, config:{damping:25,mass:1,stiffness:80,overshootClamping:false}, durationInFrames:45});

  const activeZoom = zoomRegions.find(z => frame >= z.startFrame && frame <= z.endFrame);
  let scaleX = 1, scaleY = 1, translateX = 0, translateY = 0;
  if (activeZoom) {
    const zoomP = Math.min((frame - activeZoom.startFrame) / 30, 1);
    const zoomOut = activeZoom.endFrame - frame < 30 ? 1 - (30 - (activeZoom.endFrame - frame)) / 30 : 1;
    const t = Math.min(zoomP, zoomOut);
    const eased = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2;
    const zoomScale = interpolate(eased,[0,1],[1, Math.min(width/activeZoom.width, height/activeZoom.height) * 0.8]);
    scaleX = zoomScale; scaleY = zoomScale;
    const centerX = activeZoom.x + activeZoom.width/2;
    const centerY = activeZoom.y + activeZoom.height/2;
    translateX = interpolate(eased,[0,1],[0, (width/2 - centerX) * (zoomScale-1)/(zoomScale)]);
    translateY = interpolate(eased,[0,1],[0, (height/2 - centerY) * (zoomScale-1)/(zoomScale)]);
  }

  const recentClicks = clickHighlights.filter(c => frame >= c.frame && frame < c.frame + 60);

  return (
    <div style={{
      opacity: interpolate(appear,[0,0.2,1],[0,1,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
      transform: `scale(${interpolate(appear,[0,1],[0.92,1])})`,
      borderRadius: theme.radius.xl,
      overflow:'hidden',
      border: `1px solid ${theme.colors.border.normal}`,
      boxShadow: `0 40px 100px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)`,
      position:'relative',
      width:'100%', height:'100%',
    }}>
      {/* Screen content */}
      <div style={{
        width:'100%', height:'100%',
        transform: `scale(${scaleX}) translate(${translateX}px,${translateY}px)`,
        transformOrigin:'center center',
        transition:'transform 0.1s',
        background: fallbackColor,
      }}>
        {isVideo && src && (
          <Video
            src={staticFile(src.replace(/^\//, ''))}
            startFrom={startFrom}
            style={{width:'100%', height:'100%', objectFit:'cover'}}
          />
        )}
        {!isVideo && src && (
          <img src={src} style={{width:'100%', height:'100%', objectFit:'cover'}} alt="screen"/>
        )}
        {!src && (
          <div style={{
            width:'100%', height:'100%',
            background: `linear-gradient(135deg, ${theme.colors.backgroundSecondary} 0%, ${theme.colors.background} 100%)`,
            display:'flex', alignItems:'center', justifyContent:'center',
          }}>
            <div style={{
              fontFamily:theme.fonts.heading, fontSize:28, fontWeight:600,
              color: theme.colors.text.tertiary, letterSpacing:'0.1em', textTransform:'uppercase',
            }}>
              [ Screen Recording ]
            </div>
          </div>
        )}
      </div>
      {/* Click highlights */}
      {recentClicks.map((c, i) => {
        const elapsed = frame - c.frame;
        const p = elapsed / 60;
        return (
          <div key={i} style={{
            position:'absolute',
            left: c.x - 30, top: c.y - 30,
            width:60, height:60, borderRadius:'50%',
            border: `3px solid ${theme.colors.orange.primary}`,
            opacity: interpolate(p,[0,0.3,1],[0,1,0]),
            transform: `scale(${interpolate(p,[0,1],[0.5,2])})`,
            boxShadow: `0 0 20px ${theme.colors.orange.glow}`,
            pointerEvents:'none',
          }}/>
        );
      })}
      {/* Caption bar */}
      {caption && (
        <div style={{
          position:'absolute', bottom:0, left:0, right:0,
          background:'linear-gradient(transparent, rgba(0,0,0,0.85))',
          padding:'40px 32px 24px',
          fontFamily:theme.fonts.body, fontSize:22, fontWeight:500,
          color: theme.colors.text.primary,
        }}>
          {caption}
        </div>
      )}
    </div>
  );
};
