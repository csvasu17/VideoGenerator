import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { Storyboard, Scene, HighlightElementType, ScreenRegion } from '../../core/domain/entities/Storyboard';
import type { PageCapture } from '../../core/domain/entities/PageCapture';
import type { PageIntelligence } from '../../core/domain/entities/PageIntelligence';
import type {
  RemotionPackage,
  RemotionScene,
  RemotionTransition,
  RemotionMeta,
  RemotionOpeningCard,
  RemotionClosingCard,
  RemotionComposition,
  RemotionBoundingBox,
  RemotionSpotlightTarget,
} from '../../core/domain/entities/RemotionPackage';
import {
  REMOTION_FPS,
  OPENING_CARD_FRAMES,
  CLOSING_CARD_FRAMES,
} from '../../core/domain/entities/RemotionPackage';

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

export interface RemotionExporterConfig {
  /** Output video width in pixels. Default: 1920. */
  width:  number;
  /** Output video height in pixels. Default: 1080. */
  height: number;
  /** Composition id used in Remotion Root.tsx. Default: "DemoVideo". */
  compositionId: string;
  /** Opening card accent colour. Default: "#1a1a2e". */
  accentColor: string;
  /** File name for the output JSON. Default: "demo-package.json". */
  outputFileName: string;
}

const DEFAULT_CONFIG: RemotionExporterConfig = {
  width:          1920,
  height:         1080,
  compositionId:  'DemoVideo',
  accentColor:    '#1a1a2e',
  outputFileName: 'demo-package.json',
};

// ─────────────────────────────────────────────────────────────────────────────
// ExportInput
// ─────────────────────────────────────────────────────────────────────────────

export interface RemotionExportInput {
  storyboard:    Storyboard;
  captures:      PageCapture[];
  outputDir:     string;
  meta: {
    productName:   string;
    targetAudience: string;
    primaryBenefit: string;
  };
  /**
   * Phase 3: per-page vision intelligence.
   * When provided, RemotionExporter builds a SpotlightTarget for each scene
   * using the elementType from the storyboard highlight and the LLM-detected
   * bounding box (or a region-based approximation as fallback).
   * Optional — when absent all scenes fall back to Ken-Burns in the renderer.
   */
  intelligence?: PageIntelligence[];
}

export interface RemotionExportResult {
  package:    RemotionPackage;
  outputPath: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// RemotionExporter
// ─────────────────────────────────────────────────────────────────────────────

export class RemotionExporter {
  private readonly config: RemotionExporterConfig;

  constructor(config: Partial<RemotionExporterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async export(input: RemotionExportInput): Promise<RemotionExportResult> {
    // ── 1. Write screenshot files to disk ────────────────────────────────
    const screenshotPaths = await this.writeScreenshots(input.captures, input.outputDir);

    // ── 2. Build RemotionPackage ─────────────────────────────────────────
    const pkg = this.buildPackage(input, screenshotPaths);

    // ── 3. Write demo-package.json ───────────────────────────────────────
    const outputPath = await this.writePackage(pkg, input.outputDir);

    return { package: pkg, outputPath };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Step 1 — write screenshots
  // ──────────────────────────────────────────────────────────────────────────

  private async writeScreenshots(
    captures:  PageCapture[],
    outputDir: string,
  ): Promise<Map<string, { viewport: string | null; full: string | null }>> {
    const capturesDir = path.join(outputDir, 'captures');
    fs.mkdirSync(capturesDir, { recursive: true });

    const map = new Map<string, { viewport: string | null; full: string | null }>();

    for (const capture of captures) {
      const pageDir = path.join(capturesDir, sanitizeId(capture.pageId));
      fs.mkdirSync(pageDir, { recursive: true });

      const ext = capture.screenshot.encoding === 'jpeg' ? 'jpg' : 'png';

      let viewportPath: string | null = null;
      let fullPath:     string | null = null;

      // RF7: screenshots are already on disk — copy them into the Remotion
      // output directory rather than re-writing from an in-memory Buffer.
      if (capture.screenshot.viewportPath) {
        const rel  = path.join('captures', sanitizeId(capture.pageId), `viewport.${ext}`);
        const dest = path.join(outputDir, rel);
        try {
          fs.copyFileSync(capture.screenshot.viewportPath, dest);
          viewportPath = rel;
        } catch { /* source missing — treat as no screenshot */ }
      }

      if (capture.screenshot.fullPath) {
        const rel  = path.join('captures', sanitizeId(capture.pageId), `full.${ext}`);
        const dest = path.join(outputDir, rel);
        try {
          fs.copyFileSync(capture.screenshot.fullPath, dest);
          fullPath = rel;
        } catch { /* source missing — treat as no screenshot */ }
      }

      map.set(capture.pageId, { viewport: viewportPath, full: fullPath });
    }

    return map;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Step 2 — build RemotionPackage
  // ──────────────────────────────────────────────────────────────────────────

  private buildPackage(
    input:           RemotionExportInput,
    screenshotPaths: Map<string, { viewport: string | null; full: string | null }>,
  ): RemotionPackage {
    const { storyboard, meta } = input;
    const fps = REMOTION_FPS;

    // ── Build per-page intelligence lookup (Phase 3) ──────────────────────
    const intelligenceMap = new Map<string, PageIntelligence>();
    for (const intel of (input.intelligence ?? [])) {
      intelligenceMap.set(intel.pageId, intel);
    }

    // ── Frame layout ──────────────────────────────────────────────────────
    let cursor = OPENING_CARD_FRAMES;
    const scenesWithFrames = storyboard.scenes.map(scene => {
      const durationFrames = Math.round(scene.durationSec * fps);
      const from = cursor;
      cursor += durationFrames;
      return { scene, from, durationFrames };
    });

    const totalFrames =
      OPENING_CARD_FRAMES +
      storyboard.scenes.reduce((s, sc) => s + Math.round(sc.durationSec * fps), 0) +
      CLOSING_CARD_FRAMES;

    // ── Sub-structures ────────────────────────────────────────────────────
    const composition: RemotionComposition = {
      id:               this.config.compositionId,
      fps,
      width:            this.config.width,
      height:           this.config.height,
      durationInFrames: totalFrames,
    };

    const openingCard: RemotionOpeningCard = {
      from:             0,
      durationInFrames: OPENING_CARD_FRAMES,
      title:            storyboard.openingTitle,
      subtitle:         meta.primaryBenefit,
      backgroundColor:  this.config.accentColor,
    };

    const scenes: RemotionScene[] = scenesWithFrames.map(({ scene, from, durationFrames }, idx) => {
      const paths = screenshotPaths.get(scene.pageId);
      const isLast = idx === storyboard.scenes.length - 1;
      return this.buildRemotionScene(
        scene, from, durationFrames,
        paths ?? null, fps, isLast,
        intelligenceMap.get(scene.pageId),
      );
    });

    const closingCard: RemotionClosingCard = {
      from:             cursor,
      durationInFrames: CLOSING_CARD_FRAMES,
      callToAction:     storyboard.closingCallToAction,
      productName:      meta.productName,
      backgroundColor:  this.config.accentColor,
    };

    const remotionMeta: RemotionMeta = {
      productName:      meta.productName,
      targetAudience:   meta.targetAudience,
      primaryBenefit:   meta.primaryBenefit,
      totalDurationSec: storyboard.totalDurationSec,
      totalScenes:      storyboard.totalScenes,
      narrativeArc:     storyboard.scenes[0]?.nodeType ?? 'unknown',
      generatedAt:      new Date().toISOString(),
      journeyId:        storyboard.journeyId,
      storyboardId:     storyboard.id,
    };

    return {
      schemaVersion: '1.0',
      id:            randomUUID(),
      meta:          remotionMeta,
      composition,
      openingCard,
      scenes,
      closingCard,
    };
  }

  private buildRemotionScene(
    scene:          Scene,
    from:           number,
    durationFrames: number,
    paths:          { viewport: string | null; full: string | null } | null,
    fps:            number,
    isLast:         boolean,
    intelligence?:  PageIntelligence,
  ): RemotionScene {
    const transition: RemotionTransition | null =
      !isLast && scene.transition
        ? {
            type:             scene.transition.type,
            durationInFrames: Math.round(scene.transition.durationMs / (1000 / fps)),
            label:            scene.transition.label,
          }
        : null;

    const spotlightTarget = buildSpotlightTarget(scene, intelligence);

    return {
      id:               `scene-${scene.sceneNumber}`,
      from,
      durationInFrames: durationFrames,
      pageId:           scene.pageId,
      title:            deriveSceneTitle(scene.highlightTarget.description, scene.title),
      narration:        scene.narration,
      salesHook:        scene.salesHook,
      description:      scene.description,
      screenshotPath:     paths?.viewport  ?? null,
      fullScreenshotPath: paths?.full      ?? null,
      highlightTarget: {
        elementType: scene.highlightTarget.elementType,
        region:      scene.highlightTarget.region,
        description: scene.highlightTarget.description,
      },
      transition,
      nodeType:        scene.nodeType ?? '',
      ...(spotlightTarget                ? { spotlightTarget }                : {}),
      // Phase 9: interaction replay passthrough — present only for promoted scenes
      ...(scene.sceneType                ? { sceneType: scene.sceneType }     : {}),
      ...(scene.interactionReplay        ? { interactionReplay: scene.interactionReplay } : {}),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Step 3 — write JSON
  // ──────────────────────────────────────────────────────────────────────────

  private async writePackage(pkg: RemotionPackage, outputDir: string): Promise<string> {
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, this.config.outputFileName);
    fs.writeFileSync(outputPath, JSON.stringify(pkg, null, 2), 'utf-8');
    return outputPath;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

/**
 * Derive a short display title from the highlight element description.
 *
 * Takes words from the description up to (but not including) the first
 * UI-element classifier word (KPI, chart, table, card…).  Those classifier
 * words describe the element type, not the feature name.
 *
 * Examples:
 *   "Consumption Tracking KPI metric card"       → "Consumption Tracking"
 *   "Role-Based Access Overview data table"      → "Role-Based Access Overview"
 *   "Energy Consumption Tracking analytics chart"→ "Energy Consumption Tracking"
 *   "Device Status Overview KPI metric card"     → "Device Status Overview"
 */
function deriveSceneTitle(highlightDesc: string, fallback: string): string {
  const stopWords = new Set([
    'kpi', 'metric', 'metrics', 'data', 'analytics', 'chart', 'table',
    'card', 'button', 'form', 'feed', 'widget', 'detail', 'modal',
  ]);
  const words  = highlightDesc.split(/\s+/);
  const stop   = words.findIndex(w => stopWords.has(w.toLowerCase()));
  const kept   = stop > 1 ? words.slice(0, stop) : words.slice(0, 3);
  return kept.join(' ') || fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3: SpotlightTarget construction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map HighlightElementType (storyboard domain) → ElementType (camera motion domain).
 * 'modal' and 'full-page' have no precise camera profile → 'default' (Ken-Burns).
 */
function mapElementType(ht: HighlightElementType): string {
  switch (ht) {
    case 'kpi':        return 'kpi_card';
    case 'chart':      return 'chart';
    case 'table':      return 'table';
    case 'form':       return 'form';
    case 'button':     return 'button';
    case 'navigation': return 'navigation';
    case 'modal':      return 'default';
    case 'full-page':  return 'default';
    default:           return 'default';
  }
}

/**
 * Convert a ScreenRegion hint into an approximate normalized BoundingBox.
 * Used as a fallback when the vision agent did not produce an explicit bbox.
 * Returns undefined for 'full' (entire page → no zoom target → Ken-Burns).
 */
function regionToBoundingBox(region: ScreenRegion): RemotionBoundingBox | undefined {
  switch (region) {
    case 'top-left':  return { x: 0.02, y: 0.02, width: 0.38, height: 0.28 };
    case 'top-right': return { x: 0.60, y: 0.02, width: 0.38, height: 0.28 };
    case 'center':    return { x: 0.15, y: 0.20, width: 0.70, height: 0.55 };
    case 'bottom':    return { x: 0.05, y: 0.62, width: 0.90, height: 0.32 };
    case 'full':
    default:          return undefined;
  }
}

/**
 * Build a RemotionSpotlightTarget for one scene.
 *
 * Priority chain for the bounding box:
 *   1. LLM-detected bbox from PageIntelligence (most precise — viewport-calibrated)
 *   2. Region-based approximation from HighlightTarget.region (quadrant-level)
 *   3. No bbox (CameraChoreographer uses canonical regions per element type)
 *
 * Returns undefined when the mapped element type is 'default' (no focused camera).
 */
function buildSpotlightTarget(
  scene:        Scene,
  intelligence?: PageIntelligence,
): RemotionSpotlightTarget | undefined {
  const elementType = mapElementType(scene.highlightTarget.elementType);

  // 'default' → Ken-Burns; no SpotlightTarget needed
  if (elementType === 'default') return undefined;

  // Priority: normalized importance score from vision analysis (fallback 0.5)
  const priority = intelligence
    ? Math.round(intelligence.overallImportanceScore) / 100
    : 0.5;

  // Bounding box: LLM-detected > region approximation > none
  const intelligenceBox = intelligence?.primaryElementBoundingBox;
  const boundingBox: RemotionBoundingBox | undefined = intelligenceBox
    ? { x: intelligenceBox.x, y: intelligenceBox.y, width: intelligenceBox.width, height: intelligenceBox.height }
    : regionToBoundingBox(scene.highlightTarget.region);

  return {
    elementType,
    label:    scene.highlightTarget.description,
    priority,
    ...(boundingBox ? { boundingBox } : {}),
  };
}
