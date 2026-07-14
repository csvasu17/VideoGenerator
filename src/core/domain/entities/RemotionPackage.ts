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
  /** Present when the package was produced by a non-default template. */
  templateId?:      'modern_saas' | 'enterprise' | 'teaser' | 'app_flow';
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
  /**
   * When present, uses EnterpriseAnimatedBRoll instead of the static text slide.
   * Values: 'iot-network' | 'data-stream' | 'alert-cascade' | 'ai-prediction' | 'global-fleet'
   */
  animationType?:   string;
  /**
   * Path to a real stock video file (relative to Remotion public dir).
   * When present, takes priority over animationType — renders EnterpriseBRollVideoScene.
   * Example: 'recordings/broll-0.mp4'
   */
  videoPath?:       string;
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
  /** Optional talking video — if provided, mouth animates instead of static image. */
  videoSrc?:     string;
  /** Fraction of frame width (0–1). Typical: 0.15. */
  widthFraction: number;
  position:      'bottom-left' | 'bottom-right';
  /**
   * Where the presenter's mouth is within the displayed presenter box.
   * All values are fractions (0–1) relative to the displayed box dimensions.
   * Defaults: xFraction 0.50 (center), yFraction 0.42, widthFraction 0.20.
   * Measure by opening the presenter PNG in any image editor and noting the
   * mouth center pixel, then divide by the image dimensions.
   */
  mouthRegion?: {
    xFraction:     number;
    yFraction:     number;
    widthFraction: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Voice script — loaded from voice-script.json, editable in Remotion Studio
// ─────────────────────────────────────────────────────────────────────────────

export interface VoiceSegment {
  id:          string;
  label?:      string;
  startSec:    number;
  durationSec: number;
  /** Set to false to silence this segment in Studio preview */
  enabled?:    boolean;
  /** Narration text — shown in the Input Props editor for reference */
  text:        string;
}

export interface VoiceScript {
  voice:            string;
  /** Subdirectory under the public root where MP3 files live.
   *  Defaults to "voice-segments".  Change in Studio Input Props
   *  to switch between pre-generated voice variants without re-rendering:
   *    "voice-segments-nova"    — female, bright
   *    "voice-segments-shimmer" — female, gentle
   *    "voice-segments-onyx"    — male,  authoritative
   */
  voiceDir?:        string;
  model:            string;
  speed:            number;
  fps:              number;
  /** BCP-47 locale code of the narration language (e.g. 'en', 'fr', 'de'). */
  locale?:          string;
  totalDurationSec: number;
  segments:         VoiceSegment[];
  /** Set to true by the pipeline after MP3 files are confirmed on disk. */
  voiceReady?:      boolean;
  /** Unix ms timestamp injected by calculateMetadata so Audio src URLs are cache-busted on reload. */
  loadedAt?:        number;
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
  /**
   * Controls how product screenshots/recordings fill the scene frame.
   * 'fit'  — inset with padding and rounded corners on a dark background
   * 'full' — edge-to-edge full bleed (default, backward-compatible)
   */
  screenFit?: 'fit' | 'full';

  // ── Teaser template fields (present only when meta.templateId === 'teaser') ──
  teaserBroll?:    TeaserBrollCardData[];
  teaserFeatures?: TeaserFeatureSceneData[];
  teaserOutro?:    TeaserOutroData;
  teaserMusic?:    TeaserMusicConfig;

  // ── App Flow Map template fields (present only when meta.templateId === 'app_flow') ──
  appFlowNodes?:      AppFlowNode[];
  appFlowIntro?:      AppFlowIntroData;
  appFlowTourStops?:  AppFlowTourStopData[];
  appFlowDetailDives?: AppFlowDetailDiveData[];
  appFlowOutro?:      AppFlowOutroData;
  /** Reuses the teaser template's music config verbatim — same shape, same <Audio> mechanism. */
  appFlowMusic?:      TeaserMusicConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// Teaser template extensions
// Present in demo-package.json only when meta.templateId === 'teaser'.
// All are optional so the existing DemoVideo/EnterpriseVideo compositions
// ignore them safely. Unlike the enterprise template, teaser has no spoken
// narration and no voice-script.json — pacing is driven by background music.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 'hook'    — bold single-line headline, bottom-left, underline accent (cold open).
 * 'benefit' — left-aligned vertical accent bar + headline + up to 3 uppercase
 *             value words (mid-teaser benefit statement).
 * 'plain'   — no text overlay, pure breathing beat between other scenes.
 */
export type TeaserBrollMode = 'hook' | 'benefit' | 'plain';

/** Full-bleed B-roll card used for the cold open and the mid-benefit statement. */
export interface TeaserBrollCardData {
  id:                string;
  from:              number;
  durationInFrames:  number;
  /** Path to a real stock video file (relative to Remotion public dir), e.g. 'recordings/broll-0.mp4'. */
  videoPath?:        string;
  mode:              TeaserBrollMode;
  /** Bold single-line headline — used when mode === 'hook'. */
  headline?:         string;
  /** Statement headline — used when mode === 'benefit'. */
  benefitHeadline?:  string;
  /** Up to 3 short uppercase value words shown under benefitHeadline — used when mode === 'benefit'. */
  benefitWords?:     string[];
}

/** One short real-product screen-recording clip in the teaser's feature montage. */
export interface TeaserFeatureSceneData {
  id:                 string;
  from:               number;
  durationInFrames:   number;
  screenshotPath:     string;
  /** Real screen recording clip (mp4) — preferred over the static screenshot fallback. */
  recordingPath?:     string;
  recordingStartSec?: number;
  /** Short 3-5 word caption chip, e.g. "AI Chat Assistant". Omit for a caption-free beat (e.g. the login/brand-reveal clip). */
  caption?:           string;
}

/** Closing scene — reveals the target app's own name/logo and a short tagline. */
export interface TeaserOutroData {
  from:              number;
  durationInFrames:  number;
  productName:       string;
  tagline:           string;
  /** Optional path (relative to Remotion public dir) to a client logo image; falls back to a styled wordmark when absent. */
  logoPath?:         string;
}

/** Background-music track played natively via a single composition-level <Audio>. */
export interface TeaserMusicConfig {
  /** Path relative to the Remotion public dir, e.g. "music/background.mp3". */
  path:       string;
  volume:     number;
  fadeOutSec: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// App Flow Map template extensions
// Present in demo-package.json only when meta.templateId === 'app_flow'.
// All are optional so DemoVideo/EnterpriseVideo/TeaserVideo ignore them safely.
//
// This template maps the target app's screen tree (every screen, sub-screen)
// plus each screen's individual data fields, as an animated diagram — not a
// screen-recording montage. No edges[] array: every node already carries a
// parentId + a baked (x,y,width,height) position, so the diagram canvas draws
// parent→child connector lines itself from those two facts.
// ─────────────────────────────────────────────────────────────────────────────

export type AppFlowNodeType =
  | 'entry'
  | 'dashboard'
  | 'list'
  | 'detail'
  | 'form'
  | 'modal'
  | 'settings'
  | 'report'
  | 'generic';

/** Which DOM heuristic resolved a field's human-readable label, in confidence order. */
export type AppFlowFieldLabelSource =
  | 'label-for'
  | 'label-wrap'
  | 'aria-labelledby'
  | 'aria-label'
  | 'placeholder'
  | 'adjacent-text'
  | 'none';

export interface AppFlowFieldOption {
  value: string;
  label: string;
}

/** One individual data field discovered on a form (input / select / textarea). */
export interface AppFlowField {
  name?:             string;
  label:             string;
  labelSource:       AppFlowFieldLabelSource;
  fieldType:         'input' | 'select' | 'textarea';
  inputType?:        string;
  required?:         boolean;
  /** Capped at 50 — see optionsTruncated. */
  options?:          AppFlowFieldOption[];
  optionsTruncated?: boolean;
}

export interface AppFlowFormGroup {
  formLabel?: string;
  fields:     AppFlowField[];
}

/** Column-level summary of a <table> — never carries actual row/cell values. */
export interface AppFlowTable {
  caption?:          string;
  columns:           string[];
  rowCountSampled:   number;
  rowCountTruncated: boolean;
}

/** One screen (or sub-screen / modal) in the app's ecosystem tree. */
export interface AppFlowNode {
  id:               string;
  /** From DiscoveredPage.parentPageId — the real "sub-screen of" signal (BFS discovery order, not URL shape). */
  parentId?:        string;
  url:               string;
  label:             string;
  nodeType:          AppFlowNodeType;
  depth:             number;
  /** Optional short AI-generated one-liner describing what this screen does. */
  description?:      string;
  screenshotPath:    string | null;
  /** Authoritative field content, grouped by <form> (or one implicit group for form-less field clusters). */
  forms:             AppFlowFormGroup[];
  /** Authoritative table content — column headers + a sampled row count only. */
  tables:            AppFlowTable[];
  /**
   * Flattened view baked by the pipeline script for simple field-list rendering —
   * derived from forms[]/tables[], not separately authored.
   */
  fields:            { label: string; fieldType: 'input' | 'select' | 'textarea' | 'table-column' }[];
  /** Baked layout — fractions 0-1 of a fixed virtual canvas, computed once by automation/utils/treeLayout.ts. */
  x:                 number;
  y:                 number;
  width:             number;
  height:            number;
}

/** Opening beat — full-map cascade reveal (nodes fade in by depth-level wave). */
export interface AppFlowIntroData {
  from:              number;
  durationInFrames:  number;
  productName:       string;
}

/** One guided-tour stop — camera frames a depth-1 branch node + all its descendants. */
export interface AppFlowTourStopData {
  id:                string;
  from:              number;
  durationInFrames:  number;
  focusNodeId:       string;
  /** focusNodeId + all its descendants — used for the union bounding box and the dim-rest-of-tree treatment. */
  subtreeNodeIds:    string[];
  caption?:          string;
}

/** One field-list "detail dive" — zooms into a single node and reveals its fields. */
export interface AppFlowDetailDiveData {
  id:                string;
  from:              number;
  durationInFrames:  number;
  nodeId:            string;
}

/** Closing beat — pull back to the full map, show summary stats. */
export interface AppFlowOutroData {
  from:              number;
  durationInFrames:  number;
  productName:       string;
  tagline?:          string;
  screenCount:       number;
  fieldCount:        number;
  logoPath?:         string;
}
