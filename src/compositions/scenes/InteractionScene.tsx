/**
 * InteractionScene — Phase 9
 *
 * Renders one storyboard scene in 'interaction' mode:
 *   1. Base screenshot visible with Ken-Burns / spotlight camera (hook phase)
 *   2. Animated cursor moves from edge → trigger element (action phase)
 *   3. Click ripple fires at clickFrame
 *   4. Screenshot crossfade base → after-state (transition phase)
 *   5. Camera springs to primary change region (outcome phase)
 *   6. Highlight ring + callout label appear (callout phase)
 *
 * Renders inside an AbsoluteFill at the scene's Sequence duration.
 * Expects serialised replay data from demo-package.json (InteractionReplayData).
 */

import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import { CursorLayer }            from '../layers/CursorLayer';
import { StateTransitionLayer }   from '../layers/StateTransitionLayer';
import { HighlightRingLayer }     from '../layers/HighlightRingLayer';

// ── Types (plain-object mirror of domain types for JSON-driven rendering) ──────

interface NormBox { x: number; y: number; width: number; height: number; }

interface ReplayPhases {
  hookEndFrame:         number;
  cursorMoveStartFrame: number;
  cursorArriveFrame:    number;
  clickFrame:           number;
  transitionStartFrame: number;
  transitionEndFrame:   number;
  outcomeZoomFrame:     number;
  calloutFrame:         number;
}

interface CameraDirective {
  phase:      string;
  strategy:   string;
  zoom:       number;
  zoomTarget: NormBox | null;
  atFrame:    number;
}

export interface InteractionReplayData {
  startScreenshotPath:  string;
  endScreenshotPath:    string;
  trigger: {
    eventType:          string;
    elementBBox:        NormBox | null;
    humanReadableHint:  string;
  };
  visualDelta: {
    primaryChangeRegion: NormBox | null;
    changeIntensity:     number;
  };
  phases:           ReplayPhases;
  cameraDirectives: CameraDirective[];
  calloutText:      string;
  calloutBBox:      NormBox | null;
  replayPriority:   number;
  businessPurpose:  string;
}

export interface InteractionSceneProps {
  replay:           InteractionReplayData;
  /** Scene title — shown in narration bar */
  title:            string;
  /** Scene sales hook — shown in narration bar */
  salesHook:        string;
  /** Global accent colour from motion plan. Default: '#FF3C2B' */
  globalAccent?:    string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const VIEWPORT_W = 1920;
const VIEWPORT_H = 1080;

// Product window dimensions (matches DemoScene framing)
const PRODUCT_W = 1720;
const PRODUCT_H =  930;
const PRODUCT_X = (VIEWPORT_W - PRODUCT_W) / 2;
const PRODUCT_Y = (VIEWPORT_H - PRODUCT_H) / 2;

// ── Component ──────────────────────────────────────────────────────────────────

export const InteractionScene: React.FC<InteractionSceneProps> = ({
  replay,
  title,
  salesHook,
  globalAccent = '#FF3C2B',
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const phases   = replay.phases;
  const { trigger, visualDelta } = replay;

  // ── Camera: interpolate zoom from camera directives ──────────────────────────
  const cameraZoom = computeCameraZoom(frame, replay.cameraDirectives, durationInFrames);

  // Camera focus point: lerp toward the change region during outcome phase
  const focusTarget = visualDelta.primaryChangeRegion ?? trigger.elementBBox;
  const focusX      = focusTarget ? focusTarget.x + focusTarget.width  / 2 : 0.5;
  const focusY      = focusTarget ? focusTarget.y + focusTarget.height / 2 : 0.5;

  const focusProgress = interpolate(
    frame,
    [phases.outcomeZoomFrame, phases.outcomeZoomFrame + 20],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const currentFocusX = interpolate(focusProgress, [0, 1], [0.5, focusX]);
  const currentFocusY = interpolate(focusProgress, [0, 1], [0.5, focusY]);

  // CSS transform: zoom centred on focus point
  const translateX = (0.5 - currentFocusX) * PRODUCT_W * (cameraZoom - 1);
  const translateY = (0.5 - currentFocusY) * PRODUCT_H * (cameraZoom - 1);

  // ── Narration bar opacity (appears after settle, after text delay) ────────────
  const narrationOpacity = interpolate(
    frame,
    [30, 45],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  // Scene progress (0 → 1 over the whole scene duration)
  const sceneProgress = frame / durationInFrames;

  return (
    <AbsoluteFill style={{
      background: '#0E0E1A',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
    }}>
      {/* ── Product window ──────────────────────────────────────────────────── */}
      <div style={{
        position:     'absolute',
        left:          PRODUCT_X,
        top:           PRODUCT_Y,
        width:         PRODUCT_W,
        height:        PRODUCT_H,
        overflow:     'hidden',
        borderRadius:  8,
        boxShadow:    '0 40px 120px rgba(0,0,0,0.7)',
      }}>
        {/* Screenshot crossfade layer (applies camera transform) */}
        <div style={{
          position:  'absolute',
          inset:      0,
          transform: `scale(${cameraZoom}) translate(${translateX}px, ${translateY}px)`,
          transformOrigin: 'center center',
        }}>
          <StateTransitionLayer
            startScreenshotPath={replay.startScreenshotPath}
            endScreenshotPath={replay.endScreenshotPath}
            transitionStartFrame={phases.transitionStartFrame}
            transitionEndFrame={phases.transitionEndFrame}
            viewportW={PRODUCT_W}
            viewportH={PRODUCT_H}
          />
        </div>

        {/* Cursor layer (in product window coordinates, no camera transform) */}
        <CursorLayer
          triggerBBox={scaleBBox(trigger.elementBBox, PRODUCT_W, PRODUCT_H)}
          phases={phases}
          viewportW={PRODUCT_W}
          viewportH={PRODUCT_H}
        />

        {/* Highlight ring + callout (in product window coordinates) */}
        <HighlightRingLayer
          changeRegion={scaleBBox(visualDelta.primaryChangeRegion, PRODUCT_W, PRODUCT_H)}
          calloutText={replay.calloutText}
          outcomeZoomFrame={phases.outcomeZoomFrame}
          calloutFrame={phases.calloutFrame}
          viewportW={PRODUCT_W}
          viewportH={PRODUCT_H}
          accentColor={globalAccent}
        />
      </div>

      {/* ── Scene progress bar ──────────────────────────────────────────────── */}
      <div style={{
        position:   'absolute',
        bottom:      90,
        left:        PRODUCT_X,
        width:       PRODUCT_W,
        height:      3,
        background: 'rgba(255,255,255,0.12)',
        borderRadius: 2,
        overflow:   'hidden',
        opacity:     narrationOpacity,
      }}>
        <div style={{
          width:      `${sceneProgress * 100}%`,
          height:     '100%',
          background: `linear-gradient(to right, ${globalAccent}, #00B4CC)`,
        }} />
      </div>

      {/* ── Narration bar ───────────────────────────────────────────────────── */}
      <div style={{
        position:       'absolute',
        bottom:          20,
        left:            PRODUCT_X,
        width:           PRODUCT_W,
        minHeight:       64,
        background:     'rgba(10, 10, 20, 0.80)',
        backdropFilter: 'blur(20px)',
        borderRadius:    12,
        display:        'flex',
        alignItems:     'center',
        padding:        '14px 24px',
        gap:             16,
        opacity:         narrationOpacity,
        boxShadow:      '0 8px 40px rgba(0,0,0,0.5)',
        border:         '1px solid rgba(255,255,255,0.08)',
      }}>
        {/* Accent bar */}
        <div style={{
          width:        4,
          height:      '60%',
          minHeight:   32,
          background:   globalAccent,
          borderRadius: 2,
          flexShrink:   0,
          boxShadow:   `0 0 12px ${globalAccent}66`,
        }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxWidth: '90%' }}>
          {/* Interaction mode badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              background:   `${globalAccent}33`,
              color:         globalAccent,
              border:       `1px solid ${globalAccent}66`,
              borderRadius:  6,
              fontSize:      13,
              fontWeight:    700,
              padding:      '2px 10px',
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
            }}>
              Live Interaction
            </span>
            <span style={{
              color:     'rgba(255,255,255,0.55)',
              fontSize:   15,
              fontWeight: 400,
            }}>
              {replay.businessPurpose}
            </span>
          </div>

          {/* Sales hook */}
          <span style={{
            color:         '#fff',
            fontSize:       24,
            fontWeight:     700,
            lineHeight:     1.2,
            letterSpacing: '-0.2px',
          }}>
            {salesHook}
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Compute zoom for the current frame by interpolating between consecutive
 * camera directive keyframes.
 */
function computeCameraZoom(
  frame:      number,
  directives: CameraDirective[],
  totalFrames: number,
): number {
  if (!directives || directives.length === 0) return 1.0;

  // Sort by atFrame
  const sorted = [...directives].sort((a, b) => a.atFrame - b.atFrame);

  // Find surrounding keyframes
  let before = sorted[0];
  let after  = sorted[sorted.length - 1];

  for (let i = 0; i < sorted.length - 1; i++) {
    if (frame >= sorted[i].atFrame && frame <= sorted[i + 1].atFrame) {
      before = sorted[i];
      after  = sorted[i + 1];
      break;
    }
  }

  if (frame <= before.atFrame) return before.zoom;
  if (frame >= after.atFrame)  return after.zoom;

  const t = (frame - before.atFrame) / (after.atFrame - before.atFrame);
  return before.zoom + (after.zoom - before.zoom) * easeInOut(t);
}

/**
 * Scale a normalised NormBox from 0–1 to pixel coordinates within the product window.
 * Returns null when bbox is null.
 */
function scaleBBox(
  bbox:  NormBox | null,
  w:     number,
  h:     number,
): { x: number; y: number; width: number; height: number } | null {
  if (!bbox) return null;
  return {
    x:      bbox.x      * w,
    y:      bbox.y      * h,
    width:  bbox.width  * w,
    height: bbox.height * h,
  };
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}
