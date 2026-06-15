import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate} from 'remotion';
import {AnimatedBackground} from '../../components/AnimatedBackground';
import {ScreenShowcase}     from '../../components/ScreenShowcase';
import {theme}              from '../../config/theme';
import {sceneFade}          from '../../utils/transitions';
import {SEGMENT_DEFS}       from '../../config/segmentDefs';
import clipManifestRaw      from '../../config/clipManifest.json';
import type {ClipManifest, ResolvedSegment} from '../../../scripts/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DemoSegment {
  id:              string;
  startFrame:      number;   // scene-local
  endFrame:        number;
  title:           string;
  subtitle:        string;
  src?:            string;
  startFrom:       number;
  accent:          'blue' | 'orange';
  zoomRegions:     Array<{startFrame:number;endFrame:number;x:number;y:number;width:number;height:number;label?:string}>;
  clickHighlights: Array<{frame:number;x:number;y:number;label?:string}>;
}

// ─── Hardcoded fallback (used when clipManifest.json has no segments) ─────────

const FALLBACK_SEGMENTS: DemoSegment[] = [
  {
    id: 'login', startFrame: 0, endFrame: 840,
    title: 'Secure Login', subtitle: 'Enterprise SSO and role-based access control',
    src: 'assets/Login.mp4', startFrom: 0, accent: 'blue',
    zoomRegions: [
      {startFrame:  80, endFrame: 220, x: 560, y: 370, width: 800, height: 130, label: 'Username'},
      {startFrame: 260, endFrame: 420, x: 560, y: 500, width: 800, height: 130, label: 'Password'},
      {startFrame: 500, endFrame: 680, x: 660, y: 620, width: 600, height: 100, label: 'Sign In'},
    ],
    clickHighlights: [
      {frame: 120, x: 960, y: 435},
      {frame: 300, x: 960, y: 565},
      {frame: 540, x: 960, y: 670},
    ],
  },
  {
    id: 'dashboard', startFrame: 840, endFrame: 1260,
    title: 'Equipment Dashboard', subtitle: 'Real-time fleet visibility',
    src: undefined, startFrom: 0, accent: 'blue',
    zoomRegions: [
      {startFrame:  960, endFrame: 1140, x: 200, y: 150, width: 600, height: 300},
      {startFrame: 1180, endFrame: 1250, x: 900, y: 200, width: 400, height: 250},
    ],
    clickHighlights: [{frame: 980, x: 350, y: 280}, {frame: 1190, x: 960, y: 220}],
  },
  {
    id: 'analytics', startFrame: 1260, endFrame: 1680,
    title: 'Predictive Analytics', subtitle: 'AI-driven maintenance forecasting',
    src: undefined, startFrom: 0, accent: 'orange',
    zoomRegions: [{startFrame: 1360, endFrame: 1560, x: 150, y: 100, width: 700, height: 400}],
    clickHighlights: [{frame: 1380, x: 400, y: 300}],
  },
  {
    id: 'dispatch', startFrame: 1680, endFrame: 2100,
    title: 'Work Order Dispatch', subtitle: 'Automated field service management',
    src: undefined, startFrom: 0, accent: 'blue',
    zoomRegions: [{startFrame: 1800, endFrame: 1980, x: 300, y: 200, width: 500, height: 300}],
    clickHighlights: [{frame: 1820, x: 450, y: 280}, {frame: 1900, x: 600, y: 320}],
  },
];

// ─── Build segment list from manifest or fallback ────────────────────────────

function buildSegments(): DemoSegment[] {
  const manifest = clipManifestRaw as ClipManifest;
  const resolved  = (manifest.segments ?? []).filter(s => s.sceneId === 'productDemo');
  if (resolved.length === 0) return FALLBACK_SEGMENTS;

  return resolved.map((s: ResolvedSegment) => {
    const def   = SEGMENT_DEFS.find(d => d.id === s.id);
    const clip  = s.resolvedClip;
    const offset = s.startFrame;

    // Translate segment-local frame numbers → scene-local
    const zoomRegions = (def?.zoomRegions ?? []).map(z => ({
      ...z,
      startFrame: z.startFrame + offset,
      endFrame:   z.endFrame   + offset,
    }));
    const clickHighlights = (def?.clickHighlights ?? []).map(c => ({
      ...c,
      frame: c.frame + offset,
    }));

    return {
      id:              s.id,
      startFrame:      offset,
      endFrame:        offset + s.durationInFrames,
      title:           s.label,
      subtitle:        s.subtitle,
      src:             clip?.file,
      startFrom:       0,
      accent:          (s.accent ?? 'blue') as 'blue' | 'orange',
      zoomRegions,
      clickHighlights,
    };
  });
}

const demoSegments = buildSegments();

// ─── Component ────────────────────────────────────────────────────────────────

export const ProductDemoScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const sceneOpacity = sceneFade(frame, durationInFrames, 40, 40);

  const activeSegment =
    demoSegments.find(s => frame >= s.startFrame && frame < s.endFrame) ?? demoSegments[0];

  const titleP = spring({
    fps: 60,
    frame: frame - activeSegment.startFrame - 10,
    config: {damping: 25, mass: 1, stiffness: 100},
    durationInFrames: 35,
  });

  return (
    <AbsoluteFill style={{opacity: sceneOpacity}}>
      <AnimatedBackground variant="subtle" />

      {/* Header strip */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 90,
        display: 'flex', alignItems: 'center', padding: '0 80px', gap: 16,
        background: 'linear-gradient(180deg, rgba(0,0,0,0.6) 0%, transparent 100%)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: theme.colors.blue.subtle,
          border: `1px solid ${theme.colors.border.blue}`,
          borderRadius: theme.radius.full, padding: '8px 20px',
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: theme.colors.blue.primary,
            boxShadow: `0 0 6px ${theme.colors.blue.primary}`,
          }}/>
          <span style={{
            fontFamily: theme.fonts.body, fontSize: 14, fontWeight: 600,
            color: theme.colors.text.accent, letterSpacing: '0.1em', textTransform: 'uppercase',
          }}>
            Platform Demo
          </span>
        </div>
        <div style={{
          opacity: interpolate(titleP, [0,0.3,1], [0,1,1], {extrapolateLeft:'clamp',extrapolateRight:'clamp'}),
          transform: `translateY(${interpolate(titleP, [0,1], [10,0])}px)`,
        }}>
          <span style={{
            fontFamily: theme.fonts.heading, fontSize: 22, fontWeight: 700,
            color: theme.colors.text.primary, marginRight: 12,
          }}>
            {activeSegment.title}
          </span>
          <span style={{
            fontFamily: theme.fonts.body, fontSize: 17, fontWeight: 400,
            color: theme.colors.text.secondary,
          }}>
            — {activeSegment.subtitle}
          </span>
        </div>
      </div>

      {/* Screen area */}
      <div style={{position: 'absolute', top: 110, left: 80, right: 80, bottom: 80}}>
        <ScreenShowcase
          src={activeSegment.src}
          startFrom={activeSegment.startFrom}
          zoomRegions={activeSegment.zoomRegions}
          clickHighlights={activeSegment.clickHighlights}
          delay={20}
        />
      </div>

      {/* Progress dots */}
      <div style={{
        position: 'absolute', bottom: 30, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: 10, alignItems: 'center',
      }}>
        {demoSegments.map((s, i) => {
          const isActive = activeSegment === s;
          return (
            <div key={i} style={{
              height: 3, borderRadius: 2,
              width:      isActive ? 48 : 24,
              background: isActive ? theme.colors.blue.primary : theme.colors.border.normal,
              boxShadow:  isActive ? `0 0 8px ${theme.colors.blue.glow}` : 'none',
            }}/>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
