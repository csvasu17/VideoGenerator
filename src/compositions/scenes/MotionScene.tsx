/**
 * MotionScene — Phase 7 replacement for DemoScene.
 *
 * Layer order (bottom to top):
 *   1. AbsoluteFill background (DARK_BG)
 *   2. Ambient glow div
 *   3. Product window div
 *      3a. CameraLayer (unchanged)
 *          └── Img screenshot
 *      3b. AttentionRingLayer (Phase 7 — above screenshot)
 *      3c. CalloutLayer       (Phase 7 — above ring)
 *      3d. Vignette overlay   (above callouts, darkens edges)
 *      3e. Top edge highlight
 *      3f. Feature badge      (above vignette)
 *   4. Narration bar          (bottom 25%, glassmorphism)
 *
 * Backward-compatible: if motionPlan data is absent, renders identically to
 * Phase 6 DemoScene (ring and callout layers simply render nothing).
 */

import React from 'react';
import {
  AbsoluteFill,
  Img,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { CameraLayer }          from '../layers/CameraLayer';
import { CalloutLayer }         from '../layers/CalloutLayer';
import { AttentionRingLayer }   from '../layers/AttentionRingLayer';
import type { ExtendedCameraTimeline } from '../../motion/camera/types';
import type { MotionDirectedScene }    from '../../motion/types';
import {
  ACCENT_RED,
  ACCENT_TEAL,
  DARK_BG,
  FONT_STACK,
  TEXT_WHITE,
  TEXT_MUTED,
} from '../tokens';

// ─────────────────────────────────────────────────────────────────────────────
// Inline types (mirrors DemoVideo.tsx SceneData shape)
// ─────────────────────────────────────────────────────────────────────────────

interface SceneData {
  id:                 string;
  from:               number;
  durationInFrames:   number;
  title:              string;
  narration:          string;
  salesHook:          string;
  screenshotPath:     string;
  fullScreenshotPath: string;
  spotlightTarget?: {
    elementType:  string;
    boundingBox?: { x: number; y: number; width: number; height: number };
    label?:       string;
    priority:     number;
  };
  transition?: { type: string; durationInFrames: number; label?: string } | null;
  highlightTarget?: {
    elementType: string;
    region:      string;
    description: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface MotionSceneProps {
  data:            SceneData;
  cameraTimeline:  ExtendedCameraTimeline;
  motionScene?:    MotionDirectedScene;   // undefined → Phase 6 fallback
  globalAccent?:   string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (same as DemoVideo.tsx — keep in sync)
// ─────────────────────────────────────────────────────────────────────────────

function deriveDisplayTitle(desc: string | undefined, fallback: string): string {
  if (!desc) return fallback;
  const stopWords = new Set([
    'kpi', 'metric', 'metrics', 'data', 'analytics', 'chart', 'table',
    'card', 'button', 'form', 'feed', 'widget', 'detail', 'modal', 'action',
  ]);
  const words = desc.split(/\s+/);
  const stop  = words.findIndex(w => stopWords.has(w.toLowerCase()));
  const kept  = stop > 1 ? words.slice(0, stop) : words.slice(0, 3);
  return kept.join(' ') || fallback;
}

function elementTypeLabel(et: string | undefined): string | null {
  switch ((et ?? '').toLowerCase()) {
    case 'kpi_card':  return 'KPI';
    case 'kpi':       return 'KPI';
    case 'chart':     return 'Chart';
    case 'table':     return 'Table';
    case 'button':    return 'Action';
    case 'form':      return 'Form';
    case 'alert':     return 'Alert';
    case 'metric':    return 'Metric';
    case 'modal':     return 'Modal';
    default:          return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MotionScene
// ─────────────────────────────────────────────────────────────────────────────

// Product window pixel dimensions for CalloutLayer coordinate conversion.
// Matches DemoVideo.tsx layout: 1920-56-56 = 1808 wide, calc(75%-20px) at 1080 = ~790 high.
const PRODUCT_W = 1808;
const PRODUCT_H = 790;

export const MotionScene: React.FC<MotionSceneProps> = ({
  data,
  cameraTimeline,
  motionScene,
  globalAccent = ACCENT_TEAL,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enterProgress = spring({ frame, fps, from: 0, to: 1, config: { damping: 18, stiffness: 80 } });
  const textOpacity   = spring({ frame: frame - 30, fps, from: 0, to: 1, config: { damping: 12 } });
  const sceneProgress = Math.min(frame / Math.max(data.durationInFrames - 1, 1), 1);

  const displayTitle = deriveDisplayTitle(data.highlightTarget?.description, data.title);
  const typeLabel    = elementTypeLabel(data.highlightTarget?.elementType ?? data.spotlightTarget?.elementType);

  const firstSentence = (() => {
    const cut = data.narration?.indexOf('. ') ?? -1;
    return cut > 0 ? data.narration!.substring(0, cut + 1) : (data.narration ?? '');
  })();

  const vignetteCenter = data.spotlightTarget?.boundingBox
    ? `${Math.round((data.spotlightTarget.boundingBox.x + data.spotlightTarget.boundingBox.width  / 2) * 100)}% ` +
      `${Math.round((data.spotlightTarget.boundingBox.y + data.spotlightTarget.boundingBox.height / 2) * 100)}%`
    : '50% 30%';

  const imgPath = data.screenshotPath.replace(/\\/g, '/');

  return (
    <AbsoluteFill style={{ background: DARK_BG, fontFamily: FONT_STACK }}>

      {/* ── Ambient glow ──────────────────────────────────────────────────── */}
      <div style={{
        position:     'absolute',
        top: 8, left: 40, right: 40,
        height:       'calc(75% - 8px)',
        borderRadius:  12,
        background:   `radial-gradient(ellipse at 50% 40%, ${globalAccent}1a 0%, transparent 65%)`,
        filter:       'blur(28px)',
        opacity:       enterProgress,
      }} />

      {/* ── Product window ─────────────────────────────────────────────────── */}
      <div style={{
        position:    'absolute',
        top:          16,
        left:         56,
        right:        56,
        height:      'calc(75% - 20px)',
        overflow:    'hidden',
        borderRadius: 8,
        border:      '1px solid rgba(255,255,255,0.10)',
        boxShadow:   '0 20px 60px rgba(0,0,0,0.60), 0 4px 20px rgba(0,0,0,0.40)',
      }}>

        {/* 3a. CameraLayer + screenshot */}
        <CameraLayer timeline={cameraTimeline}>
          <Img
            src={staticFile(imgPath)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}
          />
        </CameraLayer>

        {/* 3b. AttentionRingLayer — Phase 7 */}
        {motionScene && (
          <AttentionRingLayer
            cameraTimeline={cameraTimeline}
            attentionMap={motionScene.attentionMap}
            accentColor={globalAccent}
          />
        )}

        {/* 3c. CalloutLayer — Phase 7 */}
        {motionScene && (
          <CalloutLayer
            track={motionScene.calloutTrack}
            windowWidth={PRODUCT_W}
            windowHeight={PRODUCT_H}
          />
        )}

        {/* 3d. Vignette / spotlight overlay */}
        <div style={{
          position:      'absolute',
          inset:          0,
          background:    `radial-gradient(ellipse at ${vignetteCenter}, transparent 22%, rgba(0,0,0,0.30) 62%)`,
          pointerEvents: 'none',
          zIndex:         5,
        }} />

        {/* 3e. Top edge highlight */}
        <div style={{
          position:      'absolute',
          top: 0, left: 0, right: 0,
          height:         1,
          background:    'linear-gradient(to right, transparent 0%, rgba(255,255,255,0.18) 20%, rgba(255,255,255,0.18) 80%, transparent 100%)',
          zIndex:         6,
          pointerEvents: 'none',
        }} />

        {/* 3f. Feature badge — upper-right */}
        <div style={{
          position:          'absolute',
          top: 18, right: 28,
          display:           'flex',
          alignItems:        'center',
          gap:                8,
          background:        'rgba(6,13,26,0.80)',
          backdropFilter:    'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          border:            `1px solid rgba(10,147,211,0.28)`,
          borderRadius:       7,
          padding:           '5px 14px 5px 10px',
          opacity:            textOpacity,
          zIndex:             7,
        }}>
          <div style={{
            width:        6,
            height:       6,
            borderRadius: '50%',
            background:   globalAccent,
            flexShrink:   0,
            boxShadow:   `0 0 8px ${globalAccent}aa`,
          }} />
          <span style={{
            color:         globalAccent,
            fontSize:       13,
            fontWeight:     600,
            letterSpacing: '0.8px',
            textTransform: 'uppercase',
          }}>
            {displayTitle}
          </span>
          {typeLabel && (
            <span style={{
              background:    `rgba(10,147,211,0.15)`,
              border:        `1px solid rgba(10,147,211,0.30)`,
              borderRadius:   4,
              padding:       '2px 7px',
              color:          globalAccent,
              fontSize:       11,
              fontWeight:     500,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              marginLeft:     2,
            }}>
              {typeLabel}
            </span>
          )}
        </div>

      </div>

      {/* ── Narration bar — glassmorphism ──────────────────────────────────── */}
      <div style={{
        position:          'absolute',
        bottom: 0, left: 0, right: 0,
        height:            '25%',
        background:        'rgba(6,13,26,0.88)',
        backdropFilter:    'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderTop:         '1px solid rgba(255,255,255,0.07)',
        display:           'flex',
        alignItems:        'center',
        padding:           '0 60px',
        opacity:            textOpacity,
        overflow:          'hidden',
      }}>

        {/* Scene progress indicator */}
        <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:'rgba(255,255,255,0.05)' }}>
          <div style={{ height:'100%', width:`${sceneProgress * 100}%`, background:`linear-gradient(to right, ${ACCENT_RED}, ${globalAccent})` }} />
        </div>

        {/* Red accent bar */}
        <div style={{
          width:        4,
          height:      '58%',
          background:   ACCENT_RED,
          borderRadius: 2,
          marginRight:  28,
          flexShrink:   0,
          boxShadow:   `0 0 12px ${ACCENT_RED}66`,
        }} />

        {/* Text */}
        <div style={{ display:'flex', flexDirection:'column', justifyContent:'center', gap:7, maxWidth:'88%' }}>
          <span style={{ color:TEXT_WHITE, fontSize:26, fontWeight:700, lineHeight:1.2, letterSpacing:'-0.2px' }}>
            {data.salesHook}
          </span>
          {firstSentence && (
            <span style={{ color:TEXT_MUTED, fontSize:17, fontWeight:400, lineHeight:1.45 }}>
              {firstSentence}
            </span>
          )}
        </div>

      </div>

    </AbsoluteFill>
  );
};
