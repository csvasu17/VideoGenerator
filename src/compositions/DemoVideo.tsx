/**
 * DemoVideo  — Dynamic Remotion composition driven by demo-package.json
 *
 * Props are passed from the render script (see automation/render-demo.ts).
 * Screenshots are resolved as staticFile() paths; the public-dir must point
 * to the output directory produced by e2e-test.ts (e.g. out/localhost/).
 *
 * Phase 2: CameraLayer + OpeningTitleScene (word-by-word reveal)
 * Phase 3: Vision-agent spotlight + vignette overlay
 * Phase 4: SceneTransition (fade/slide/zoom) + motion-director fixes
 * Phase 5: OpeningTitleScene premium redesign; ClosingCardScene extracted +
 *           redesigned (animated orbs, feature pills, CTA glow pulse);
 *           productName + scenesCount props wired through; closingHighlights
 *           derived from scene highlightTargets
 * Phase 6: Glassmorphism narration bar; scene-progress indicator;
 *           feature badge dot + element-type icon; shared design tokens
 */

import React from 'react';
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

// ── Phase 2 / 3: camera system ───────────────────────────────────────────────
import { CameraLayer }         from './layers/CameraLayer';
import { OpeningTitleScene }   from './scenes/OpeningTitleScene';
import { CameraChoreographer } from '../motion/camera/CameraChoreographer';
import type { CameraTimeline, ElementType } from '../motion/camera/types';
// ── Phase 4: scene transitions ───────────────────────────────────────────────
import { SceneTransition }     from './transitions/SceneTransition';
// ── Phase 5: premium closing card ────────────────────────────────────────────
import { ClosingCardScene }    from './scenes/ClosingCardScene';
// ── Phase 7: motion direction engine ─────────────────────────────────────────
import { MotionScene }         from './scenes/MotionScene';
import { MotionTransition }    from './transitions/MotionTransition';
import type { MotionPlan }     from '../motion/types';
// ── Phase 9: interaction replay ────────────────────────────────────────────────
import { InteractionScene }    from './scenes/InteractionScene';
import type { InteractionReplayData } from './scenes/InteractionScene';
// ── Phase 5 / 6: shared design tokens ────────────────────────────────────────
import {
  ACCENT_RED,
  DARK_BG,
  TEXT_WHITE,
  TEXT_MUTED,
  ACCENT_TEAL,
  FONT_STACK,
} from './tokens';

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirrors RemotionPackage from the pipeline)
// ─────────────────────────────────────────────────────────────────────────────

interface OpeningCard {
  from:             number;
  durationInFrames: number;
  title:            string;
  subtitle:         string;
  backgroundColor:  string;
}

interface ClosingCard {
  from:             number;
  durationInFrames: number;
  callToAction:     string;
  productName:      string;
  backgroundColor:  string;
}

/**
 * Phase 4: transition descriptor carried by demo-package.json scenes.
 * Mirrors RemotionTransition from RemotionPackage.
 */
interface SceneTransitionData {
  /** Matches TransitionType: 'cut'|'fade'|'slide-left'|'slide-right'|'zoom-in'|'zoom-out' */
  type:             string;
  durationInFrames: number;
  label?:           string;
}

/**
 * Phase 3: spotlight target baked into demo-package.json by RemotionExporter.
 */
interface SpotlightData {
  elementType: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  label?:       string;
  priority:     number;
}

interface SceneData {
  id:                 string;
  from:               number;
  durationInFrames:   number;
  title:              string;
  narration:          string;
  salesHook:          string;
  screenshotPath:     string;
  fullScreenshotPath: string;
  spotlightTarget?:   SpotlightData;
  transition?:        SceneTransitionData | null;
  highlightTarget?: {
    elementType: string;
    region:      string;
    description: string;
  };
  /**
   * Phase 9: rendering mode.
   *   'screenshot'  — Ken-Burns camera on a static screenshot (default).
   *   'interaction' — animated cursor replay with crossfade.
   * Absent scenes render as 'screenshot'.
   */
  sceneType?:          string;
  /**
   * Phase 9: replay data present only when sceneType === 'interaction'.
   */
  interactionReplay?:  InteractionReplayData;
}

export interface DemoVideoProps {
  openingCard:  OpeningCard;
  scenes:       SceneData[];
  closingCard:  ClosingCard;
  /**
   * Phase 7: optional motion plan from motion-package.json.
   * When present: scenes render via MotionScene + MotionTransition (premium motion).
   * When absent:  scenes render via DemoScene + SceneTransition (Phase 6 fallback).
   */
  motionPlan?:  MotionPlan;
  /**
   * Index signature required by Remotion's Composition<Schema, Props> constraint
   * (`Props extends Record<string, unknown>`). Named properties above retain their
   * specific types — this only allows arbitrary string keys to return `unknown`.
   */
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive a short feature display title from a highlight element description.
 *
 * Strategy: strip trailing UI-classifier words (KPI, metric, chart, card, …)
 * that describe element TYPE rather than feature NAME.
 *
 * Examples:
 *   "Consumption Analytics KPI metric card"  → "Consumption Analytics"
 *   "Impact and Recommended Actions action button" → "Impact and Recommended"
 *   "Quick Stats KPIs KPI metric card" → "Quick Stats KPIs"
 */
function deriveDisplayTitle(highlightDesc: string | undefined, fallback: string): string {
  if (!highlightDesc) return fallback;
  const stopWords = new Set([
    'kpi', 'metric', 'metrics', 'data', 'analytics', 'chart', 'table',
    'card', 'button', 'form', 'feed', 'widget', 'detail', 'modal', 'action',
  ]);
  const words = highlightDesc.split(/\s+/);
  const stop  = words.findIndex(w => stopWords.has(w.toLowerCase()));
  const kept  = stop > 1 ? words.slice(0, stop) : words.slice(0, 3);
  return kept.join(' ') || fallback;
}

/**
 * Map elementType to a short badge label.
 * Returns null when the type is generic / should not be shown.
 */
function elementTypeLabel(elementType: string | undefined): string | null {
  switch ((elementType ?? '').toLowerCase()) {
    case 'kpi_card':  return 'KPI';
    case 'kpi':       return 'KPI';
    case 'chart':     return 'Chart';
    case 'table':     return 'Table';
    case 'button':    return 'Action';
    case 'form':      return 'Form';
    default:          return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DemoScene
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DemoScene — renders one product screenshot with:
 *   • Dark background framing (Phase 1)
 *   • CameraLayer with spring-eased zoom/pan (Phase 2)
 *   • Vignette spotlight overlay (Phase 3)
 *   • SceneTransition wrapper (Phase 4)
 *   • Glassmorphism narration bar with scene-progress indicator (Phase 6)
 *   • Feature badge with element-type chip (Phase 6)
 *
 * Motion director invariants (maintained from Phase 4):
 *   • Product window opacity = 1 always (SceneTransition handles fade-in)
 *   • Text overlays delayed to frame 30 (camera settle)
 */
const DemoScene: React.FC<{ data: SceneData; cameraTimeline: CameraTimeline }> = ({
  data,
  cameraTimeline,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Decorative glow only — NOT used for product window opacity
  const enterProgress = spring({ frame, fps, from: 0, to: 1, config: { damping: 18, stiffness: 80 } });

  // Text overlays delayed so they arrive after camera spring has settled (~1 s)
  const textOpacity = spring({ frame: frame - 30, fps, from: 0, to: 1, config: { damping: 12 } });

  // Phase 6: linear scene progress (0→1 across the full scene duration)
  const sceneProgress = Math.min(frame / Math.max(data.durationInFrames - 1, 1), 1);

  // ── Derived display values ────────────────────────────────────────────────
  const displayTitle  = deriveDisplayTitle(data.highlightTarget?.description, data.title);
  const typeLabel     = elementTypeLabel(data.highlightTarget?.elementType ?? data.spotlightTarget?.elementType);

  // First sentence of narration only — prevents the bar from being a wall of text
  const firstSentence = (() => {
    const cut = data.narration?.indexOf('. ') ?? -1;
    return cut > 0 ? data.narration!.substring(0, cut + 1) : (data.narration ?? '');
  })();

  // ── Vignette centre (spotlight-aware) ────────────────────────────────────
  const vignetteCenter = data.spotlightTarget?.boundingBox
    ? `${Math.round((data.spotlightTarget.boundingBox.x + data.spotlightTarget.boundingBox.width  / 2) * 100)}% ` +
      `${Math.round((data.spotlightTarget.boundingBox.y + data.spotlightTarget.boundingBox.height / 2) * 100)}%`
    : '50% 30%';

  // Normalise Windows backslash paths
  const imgPath = data.screenshotPath.replace(/\\/g, '/');

  return (
    <AbsoluteFill style={{ background: DARK_BG, fontFamily: FONT_STACK }}>

      {/* ── Ambient glow ─────────────────────────────────────────────────── */}
      <div style={{
        position:     'absolute',
        top: 8, left: 40, right: 40,
        height:       'calc(75% - 8px)',
        borderRadius:  12,
        background:   `radial-gradient(ellipse at 50% 40%, ${ACCENT_TEAL}1a 0%, transparent 65%)`,
        filter:       'blur(28px)',
        opacity:       enterProgress,
      }} />

      {/* ── Product window ────────────────────────────────────────────────── */}
      {/*
       * opacity intentionally ABSENT (SceneTransition owns the fade-in).
       * Previously using opacity:enterProgress caused ~0.5 s dark frames at
       * every scene boundary — both SceneTransition.inProgress and enterProgress
       * started at zero simultaneously.
       */}
      <div style={{
        position:     'absolute',
        top:           16,
        left:          56,
        right:         56,
        height:       'calc(75% - 20px)',
        overflow:     'hidden',
        borderRadius:  8,
        border:       '1px solid rgba(255,255,255,0.10)',
        boxShadow:    '0 20px 60px rgba(0,0,0,0.60), 0 4px 20px rgba(0,0,0,0.40)',
      }}>

        {/* Phase 2: CameraLayer — spring-eased zoom + pan */}
        <CameraLayer timeline={cameraTimeline}>
          <Img
            src={staticFile(imgPath)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}
          />
        </CameraLayer>

        {/* Phase 3: Vignette / spotlight overlay */}
        <div style={{
          position:      'absolute',
          inset:          0,
          background:    `radial-gradient(ellipse at ${vignetteCenter}, transparent 22%, rgba(0,0,0,0.30) 62%)`,
          pointerEvents: 'none',
          zIndex:         1,
        }} />

        {/* Top edge highlight — renders above the animated image */}
        <div style={{
          position:      'absolute',
          top: 0, left: 0, right: 0,
          height:         1,
          background:    'linear-gradient(to right, transparent 0%, rgba(255,255,255,0.18) 20%, rgba(255,255,255,0.18) 80%, transparent 100%)',
          zIndex:         2,
          pointerEvents: 'none',
        }} />

        {/* ── Phase 6: Feature badge — upper-right of product window ─────── */}
        {/*
         * Phase 6 improvements over Phase 4:
         *   • Glassmorphism panel (blur backdrop)
         *   • Teal dot live-indicator on the left
         *   • Optional element-type chip (e.g. "KPI", "Action") on the right
         */}
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
          zIndex:             3,
        }}>
          {/* Live indicator dot */}
          <div style={{
            width:        6,
            height:       6,
            borderRadius: '50%',
            background:   ACCENT_TEAL,
            flexShrink:   0,
            boxShadow:   `0 0 8px ${ACCENT_TEAL}aa`,
          }} />
          <span style={{
            color:         ACCENT_TEAL,
            fontSize:       13,
            fontWeight:     600,
            letterSpacing: '0.8px',
            textTransform: 'uppercase',
          }}>
            {displayTitle}
          </span>
          {/* Element-type chip */}
          {typeLabel && (
            <span style={{
              background:    `rgba(10,147,211,0.15)`,
              border:        `1px solid rgba(10,147,211,0.30)`,
              borderRadius:   4,
              padding:       '2px 7px',
              color:          ACCENT_TEAL,
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

      {/* ── Phase 6: Narration bar — glassmorphism ──────────────────────── */}
      {/*
       * Phase 6 improvements over Phase 4:
       *   • rgba + backdropFilter replaces the opaque gradient — product screenshot
       *     shows through the blurred glass, reinforcing context
       *   • borderTop rule separates bar from product window cleanly
       *   • Scene-progress indicator: gradient bar at top of narration panel
       *     grows from 0→100% across the scene duration
       */}
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

        {/* Scene progress indicator — top edge of narration panel */}
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0,
          height: 2,
          background: 'rgba(255,255,255,0.05)',
        }}>
          <div style={{
            height:     '100%',
            width:      `${sceneProgress * 100}%`,
            background: `linear-gradient(to right, ${ACCENT_RED}, ${ACCENT_TEAL})`,
          }} />
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

        {/* Text content */}
        <div style={{
          display:        'flex',
          flexDirection:  'column',
          justifyContent: 'center',
          gap:             7,
          maxWidth:       '88%',
        }}>
          {/* Sales hook — bold headline, readable in under 2 s */}
          <span style={{
            color:         TEXT_WHITE,
            fontSize:       26,
            fontWeight:     700,
            lineHeight:     1.2,
            letterSpacing: '-0.2px',
          }}>
            {data.salesHook}
          </span>

          {/* First sentence of narration — muted support line */}
          {firstSentence && (
            <span style={{
              color:      TEXT_MUTED,
              fontSize:    17,
              fontWeight:  400,
              lineHeight:  1.45,
            }}>
              {firstSentence}
            </span>
          )}
        </div>
      </div>

    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main DemoVideo composition
// ─────────────────────────────────────────────────────────────────────────────

export const DemoVideo: React.FC<DemoVideoProps> = ({ openingCard, scenes, closingCard, motionPlan }) => {
  const { fps } = useVideoConfig();

  // ── Pre-compute all CameraTimelines ──────────────────────────────────────
  // Phase 7: when motionPlan is present, use ExtendedCameraTimelines from it.
  // Phase 6 fallback: use CameraChoreographer as before.
  const cameraTimelines: CameraTimeline[] = React.useMemo(() => {
    if (motionPlan) {
      // Use pre-computed extended timelines from the motion plan
      return motionPlan.scenes.map(ms => ms.cameraTimeline);
    }
    // Phase 6 fallback
    const choreographer = new CameraChoreographer();
    return scenes.map(scene =>
      choreographer.choreograph({
        sceneId:          scene.id,
        durationInFrames: scene.durationInFrames,
        fps,
        spotlightTarget: scene.spotlightTarget
          ? {
              elementType: scene.spotlightTarget.elementType as ElementType,
              boundingBox: scene.spotlightTarget.boundingBox,
              label:       scene.spotlightTarget.label,
              priority:    scene.spotlightTarget.priority,
            }
          : undefined,
      }),
    );
  }, [scenes, fps, motionPlan]);

  // ── Phase 5: closing-card feature highlights ──────────────────────────────
  // Derive up to 3 unique feature names from scene highlight descriptions.
  // These appear as pills on the closing card — a "what we just covered" summary.
  const closingHighlights: string[] = React.useMemo(() => {
    const seen   = new Set<string>();
    const result: string[] = [];
    for (const scene of scenes) {
      const label = deriveDisplayTitle(scene.highlightTarget?.description, scene.title);
      if (label && !seen.has(label)) {
        seen.add(label);
        result.push(label);
        if (result.length === 3) break;
      }
    }
    return result;
  }, [scenes]);

  return (
    <AbsoluteFill style={{ background: DARK_BG }}>

      {/*
       * Opening card — Phase 5: passes productName + scenesCount to the
       * redesigned OpeningTitleScene (animated orbs, brand wordmark, dots).
       * Phase 4: exits via first scene's entry transition.
       */}
      <Sequence from={openingCard.from} durationInFrames={openingCard.durationInFrames}>
        <SceneTransition
          durationInFrames={openingCard.durationInFrames}
          outType={scenes[0]?.transition?.type}
          outDuration={scenes[0]?.transition?.durationInFrames}
        >
          <OpeningTitleScene
            data={openingCard}
            productName={closingCard.productName}
            scenesCount={scenes.length}
          />
        </SceneTransition>
      </Sequence>

      {/*
       * Per-page screenshot scenes.
       *
       * Phase 7 (motionPlan present):
       *   MotionScene + MotionTransition — premium multi-beat camera, callouts,
       *   attention rings, and premium transitions.
       *
       * Phase 6 fallback (motionPlan absent):
       *   DemoScene + SceneTransition — identical to existing behavior.
       */}
      {scenes.map((scene, index) => {
        const prevTr       = index > 0 ? scenes[index - 1].transition : null;
        const outTr        = scene.transition;
        const motionScene  = motionPlan?.scenes[index];
        const enterPlan    = motionScene?.enterTransition ?? null;
        const exitPlan     = motionScene?.exitTransition  ?? null;

        return (
          <Sequence key={scene.id} from={scene.from} durationInFrames={scene.durationInFrames}>
            {scene.sceneType === 'interaction' && scene.interactionReplay ? (
              // ── Phase 9 path: interaction replay ────────────────────────────
              <InteractionScene
                replay={scene.interactionReplay}
                title={scene.title}
                salesHook={scene.salesHook}
                globalAccent={motionPlan?.globalStyle?.calloutAccentColor ?? '#FF3C2B'}
              />
            ) : motionPlan ? (
              // ── Phase 7 path ────────────────────────────────────────────────
              <MotionTransition
                durationInFrames={scene.durationInFrames}
                enterPlan={enterPlan}
                exitPlan={exitPlan}
              >
                <MotionScene
                  data={scene}
                  cameraTimeline={cameraTimelines[index] as any}
                  motionScene={motionScene}
                  globalAccent={motionPlan.globalStyle.calloutAccentColor}
                />
              </MotionTransition>
            ) : (
              // ── Phase 6 fallback path ───────────────────────────────────────
              <SceneTransition
                durationInFrames={scene.durationInFrames}
                inType={prevTr?.type}   inDuration={prevTr?.durationInFrames}
                outType={outTr?.type}   outDuration={outTr?.durationInFrames}
              >
                <DemoScene data={scene} cameraTimeline={cameraTimelines[index]} />
              </SceneTransition>
            )}
          </Sequence>
        );
      })}

      {/*
       * Closing card — Phase 5: replaced by the extracted ClosingCardScene
       * component with premium redesign (animated orbs, feature pills, glow CTA).
       * Phase 4: enters via last scene's exit transition.
       */}
      <Sequence from={closingCard.from} durationInFrames={closingCard.durationInFrames}>
        <SceneTransition
          durationInFrames={closingCard.durationInFrames}
          inType={scenes.at(-1)?.transition?.type}
          inDuration={scenes.at(-1)?.transition?.durationInFrames}
        >
          <ClosingCardScene
            data={closingCard}
            highlights={closingHighlights}
          />
        </SceneTransition>
      </Sequence>

    </AbsoluteFill>
  );
};
