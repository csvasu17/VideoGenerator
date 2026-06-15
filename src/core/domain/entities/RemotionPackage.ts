// ─────────────────────────────────────────────────────────────────────────────
// RemotionPackage — schema for demo-package.json.
// Consumed by the Remotion project's Root.tsx to render the demo video.
// All time values are expressed in FRAMES (fps=30) so Remotion can use them
// directly without conversion.
// ─────────────────────────────────────────────────────────────────────────────

import type { SerializedInteractionReplay } from './InteractionReplay';

export const REMOTION_FPS = 30;
export const OPENING_CARD_FRAMES  = 90;   // 3 s
export const CLOSING_CARD_FRAMES  = 150;  // 5 s

// ─────────────────────────────────────────────────────────────────────────────
// Sub-types
// ─────────────────────────────────────────────────────────────────────────────

export interface RemotionComposition {
  id:               string;   // e.g. "DemoVideo"
  fps:              number;   // always 30
  width:            number;   // e.g. 1920
  height:           number;   // e.g. 1080
  durationInFrames: number;   // total video length in frames
}

export interface RemotionHighlight {
  elementType: string;        // matches HighlightElementType
  region:      string;        // matches ScreenRegion
  description: string;        // human-readable spotlight label
}

/**
 * Normalized bounding box carried in demo-package.json.
 * All coords are fractions of the product-window area (0–1).
 * Mirrors BoundingBox from the camera motion types.
 */
export interface RemotionBoundingBox {
  x:      number;
  y:      number;
  width:  number;
  height: number;
}

/**
 * Camera spotlight data baked into each RemotionScene.
 * Consumed by DemoVideo.tsx → CameraChoreographer (Phase 3).
 *
 * elementType values mirror ElementType in src/motion/camera/types.ts:
 *   'kpi_card' | 'chart' | 'button' | 'table' | 'navigation' | 'form' | 'default'
 *
 * When elementType === 'default' (or the field is absent), the camera
 * falls back to the enhanced Ken-Burns profile.
 */
export interface RemotionSpotlightTarget {
  /** Camera motion profile key. */
  elementType:  string;
  /** Normalized position of the element within the product window. */
  boundingBox?: RemotionBoundingBox;
  /** Human-readable label for debugging / logging. */
  label?:       string;
  /**
   * 0–1.  Drives zoom intensity within the element-type's profile range.
   * Derived from PageIntelligence.overallImportanceScore / 100.
   */
  priority:     number;
}

export interface RemotionTransition {
  type:             string;   // matches TransitionType
  durationInFrames: number;   // e.g. 18 (600 ms @ 30 fps)
  /** Action label shown as an on-screen annotation. */
  label?:           string;
}

export interface RemotionScene {
  id:               string;
  /** Frame index where this scene starts (0-based). */
  from:             number;
  durationInFrames: number;

  pageId:           string;
  title:            string;
  narration:        string;
  salesHook:        string;
  description:      string;

  /**
   * Relative path from the output directory root.
   * e.g. "captures/page-001/viewport.png"
   * null when no screenshot was captured for this page.
   */
  screenshotPath:     string | null;
  fullScreenshotPath: string | null;

  highlightTarget: RemotionHighlight;
  /** Transition to the NEXT scene. null on the last scene. */
  transition:      RemotionTransition | null;
  nodeType:        string;
  /**
   * Phase 3: camera spotlight target baked in by RemotionExporter.
   * When present, CameraChoreographer uses it for element-focused zoom/pan.
   * When absent (undefined), the camera falls back to Ken-Burns.
   * Absent in packages produced before Phase 3 — backward-compatible.
   */
  spotlightTarget?: RemotionSpotlightTarget;
  /**
   * Phase 9: rendering mode for this scene.
   *   'screenshot'  — static screenshot with Ken-Burns camera (default)
   *   'interaction' — animated cursor replay with crossfade transition
   * Absent in packages produced before Phase 9 — defaults to 'screenshot'.
   */
  sceneType?: 'screenshot' | 'interaction';
  /**
   * Phase 9: serialised interaction replay data.
   * Present only when sceneType === 'interaction'.
   * Consumed by DemoVideo.tsx → InteractionScene.
   */
  interactionReplay?: SerializedInteractionReplay;
}

export interface RemotionOpeningCard {
  from:             number;   // always 0
  durationInFrames: number;   // OPENING_CARD_FRAMES
  title:            string;
  subtitle:         string;
  backgroundColor:  string;
}

export interface RemotionClosingCard {
  from:             number;
  durationInFrames: number;   // CLOSING_CARD_FRAMES
  callToAction:     string;
  productName:      string;
  backgroundColor:  string;
}

export interface RemotionMeta {
  productName:      string;
  targetAudience:   string;
  primaryBenefit:   string;
  totalDurationSec: number;
  totalScenes:      number;
  narrativeArc:     string;
  generatedAt:      string;   // ISO timestamp
  journeyId:        string;
  storyboardId:     string;
  /** Present when the package was produced by the enterprise template. */
  templateId?:      'modern_saas' | 'enterprise';
}

// ─────────────────────────────────────────────────────────────────────────────
// Enterprise template extensions
// Present in demo-package.json only when meta.templateId === 'enterprise'.
// All are optional so the existing DemoVideo composition ignores them safely.
// ─────────────────────────────────────────────────────────────────────────────

/** Icon key mapped to a visual symbol in EnterpriseBenefitSlide. */
export type BenefitIconKey =
  | 'speed'
  | 'accuracy'
  | 'oversight'
  | 'revenue'
  | 'integration'
  | 'compliance'
  | 'default';

/** A single animated bullet on the enterprise benefit slide. */
export interface EnterpriseBenefitBullet {
  icon:        BenefitIconKey;
  /** Bolded label text shown before the colon. */
  label:       string;
  /** Plain-text description shown after the label. */
  description: string;
}

/** Full-screen problem-statement scene rendered before the product demo. */
export interface EnterpriseBRollSceneData {
  id:               string;
  from:             number;
  durationInFrames: number;
  /** Short subtitle (≤ 12 words) shown as the primary text of the scene. */
  subtitle:         string;
  /** Industry category hint — drives future B-roll asset selection. */
  category?:        string;
}

/** White-background benefit slide with staggered animated bullets. */
export interface EnterpriseBenefitSlideData {
  from:             number;
  durationInFrames: number;
  /** Slide heading, e.g. "ProductName — Value Adds". */
  title:            string;
  /** Up to 5 bullets, revealed staggered. */
  bullets:          EnterpriseBenefitBullet[];
}

/** Full-screen presenter closing scene. */
export interface EnterprisePresenterCloseData {
  from:             number;
  durationInFrames: number;
  /** One-line closing tagline shown as subtitle. */
  tagline:          string;
  /** Relative path from the Remotion public dir to the presenter image/video. */
  presenterSrc:     string;
}

/** Global presenter overlay settings applied to all enterprise product scenes. */
export interface EnterprisePresenterConfig {
  /** Relative path from the Remotion public dir. */
  src:           string;
  /** Fraction of frame width (0–1). Typical: 0.15. */
  widthFraction: number;
  position:      'bottom-left' | 'bottom-right';
}

// ─────────────────────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────────────────────

export interface RemotionPackage {
  schemaVersion: '1.0';
  id:            string;
  meta:          RemotionMeta;
  composition:   RemotionComposition;
  openingCard:   RemotionOpeningCard;
  scenes:        RemotionScene[];
  closingCard:   RemotionClosingCard;

  // ── Enterprise template fields (present only when meta.templateId === 'enterprise') ──
  brollScenes?:    EnterpriseBRollSceneData[];
  benefitSlide?:   EnterpriseBenefitSlideData;
  presenterClose?: EnterprisePresenterCloseData;
  presenterConfig?: EnterprisePresenterConfig;
}
