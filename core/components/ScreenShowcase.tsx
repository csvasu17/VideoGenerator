/**
 * ScreenShowcase — Full-screen recording player with cinematic zoom.
 *
 * Zoom math: to center point (cx, cy) using scale(s) with transform-origin:center,
 * the correct translate is (W/2 - cx, H/2 - cy) — independent of scale.
 * This ensures the zoom target always snaps to the viewport center.
 */

import React from 'react';
// OffthreadVideo is required for rendering — unlike <Video>, it decodes frames
// via FFmpeg off the browser thread, preventing the 28s delayRender() timeout
// that occurs when large MP4 files are rendered with the standard <Video> tag.
import {useCurrentFrame, useVideoConfig, spring, interpolate, OffthreadVideo, staticFile} from 'remotion';
import {useTheme} from '../themes';
import {Springs} from '../utils/animations';

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
  fullScreen?: boolean;
}

const VIDEO_EXTS = /\.(mp4|webm|mov|avi|mkv)$/i;

export const ScreenShowcase: React.FC<Props> = ({
  src,
  startFrom     = 0,
  fallbackColor = '#080810',
  zoomRegions   = [],
  clickHighlights = [],
  caption,
  delay         = 0,
  fullScreen    = false,
}) => {
  const theme   = useTheme();
  const isVideo = Boolean(src && VIDEO_EXTS.test(src));
  const frame   = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();

  // ── Cinematic zoom regions ────────────────────────────────────────────────
  const activeZoom = zoomRegions.find(z => frame >= z.startFrame && frame <= z.endFrame);

  let zoomTransform = 'scale(1)';
  if (activeZoom) {
    // Spring in + spring out for cinematic feel
    const zoomIn  = spring({
      fps, frame: frame - activeZoom.startFrame,
      config: Springs.cinematic, durationInFrames: 40,
    });
    const zoomOut = spring({
      fps, frame: activeZoom.endFrame - frame,
      config: Springs.cinematic, durationInFrames: 35,
    });
    const t = Math.min(zoomIn, zoomOut);

    // Compute scale: zoom to fill 80% of the screen with the target region
    const scaleToFit = Math.min(
      width  / activeZoom.width,
      height / activeZoom.height,
    ) * 0.82;
    const zoomScale = interpolate(t, [0, 1], [1, scaleToFit], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });

    // Center of the zoom region
    const cx = activeZoom.x + activeZoom.width  / 2;
    const cy = activeZoom.y + activeZoom.height / 2;

    // Correct translate: (W/2 - cx, H/2 - cy), independent of scale
    const tx = interpolate(t, [0, 1], [0, width  / 2 - cx], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
    const ty = interpolate(t, [0, 1], [0, height / 2 - cy], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

    zoomTransform = `scale(${zoomScale}) translate(${tx}px, ${ty}px)`;
  }

  // ── Click highlight ripples ───────────────────────────────────────────────
  const recentClicks = clickHighlights.filter(c => frame >= c.frame && frame < c.frame + 70);

  // ── Card vs full-screen wrapper ───────────────────────────────────────────
  const wrapperStyle: React.CSSProperties = fullScreen
    ? {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden'}
    : {
        borderRadius: theme.radius.xl,
        overflow: 'hidden',
        border: `1px solid ${theme.colors.border.normal}`,
        boxShadow: `0 40px 100px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)`,
        position: 'relative',
        width: '100%', height: '100%',
      };

  return (
    <div style={wrapperStyle}>

      {/* Zoomable recording content */}
      <div style={{
        width: '100%', height: '100%',
        transform: zoomTransform,
        transformOrigin: 'center center',
        background: fallbackColor,
        willChange: 'transform',
      }}>
        {isVideo && src && (
          <OffthreadVideo
            src={staticFile(src.replace(/^\//, ''))}
            startFrom={startFrom}
            style={{width: '100%', height: '100%', objectFit: 'cover'}}
          />
        )}
        {!isVideo && src && (
          <img
            src={src}
            style={{width: '100%', height: '100%', objectFit: 'cover'}}
            alt="screen"
          />
        )}
        {!src && (
          <div style={{
            width: '100%', height: '100%',
            background: 'linear-gradient(160deg, #08081A 0%, #0C0C20 50%, #06060F 100%)',
            display: 'flex', flexDirection:'column', alignItems: 'center', justifyContent: 'center', gap:16,
          }}>
            <div style={{
              width:48, height:48, borderRadius:'50%',
              border:'2px solid rgba(0,102,255,0.4)',
              display:'flex', alignItems:'center', justifyContent:'center',
            }}>
              <div style={{width:16, height:16, borderRadius:'50%', background:'rgba(0,102,255,0.5)'}}/>
            </div>
            <div style={{
              fontFamily: 'system-ui, sans-serif', fontSize: 13, fontWeight: 500,
              color: 'rgba(255,255,255,0.2)',
              letterSpacing: '0.14em', textTransform: 'uppercase',
            }}>
              Loading
            </div>
          </div>
        )}
      </div>

      {/* Chrome mask — covers browser toolbar artifacts at bottom */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: 4,
        background: '#000',
        pointerEvents: 'none',
        zIndex: 10,
      }}/>

      {/* Click highlight ripples */}
      {recentClicks.map((c, i) => {
        const age = frame - c.frame;
        const t   = age / 70;
        return (
          <div key={i} style={{
            position: 'absolute',
            left: c.x - 28, top: c.y - 28,
            width: 56, height: 56,
            borderRadius: '50%',
            border: `2px solid ${theme.colors.orange.primary}`,
            opacity: interpolate(t, [0, 0.25, 1], [0, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
            transform: `scale(${interpolate(t, [0, 1], [0.4, 2.2])})`,
            boxShadow: `0 0 16px ${theme.colors.orange.glow}`,
            pointerEvents: 'none',
          }}/>
        );
      })}

      {/* Caption bar */}
      {caption && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'linear-gradient(transparent, rgba(0,0,0,0.88))',
          padding: '48px 36px 24px',
          fontFamily: theme.fonts.body, fontSize: 20, fontWeight: 500,
          color: theme.colors.text.primary,
        }}>
          {caption}
        </div>
      )}
    </div>
  );
};
