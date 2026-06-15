/**
 * MotionDirectionEngine — top-level orchestrator for Phase 7 motion planning.
 *
 * Takes a RemotionPackage (demo-package.json) and optional pipeline context,
 * and produces a MotionPlan that can be attached to the package to produce
 * a MotionPackage (motion-package.json).
 *
 * Execution order:
 *   1. Plan each scene individually (SceneMotionPlanner) — independent, fast
 *   2. Plan transitions between adjacent scenes (TransitionPlanner)
 *   3. Wire enterTransition / exitTransition onto MotionDirectedScenes
 *   4. Apply cross-scene camera continuity (MotionContinuityEngine)
 *
 * No LLM, no I/O. Pure orchestration of deterministic functions.
 */

import type { RemotionPackage, RemotionScene } from '../core/domain/entities/RemotionPackage';
import type { PageIntelligence }               from '../core/domain/entities/PageIntelligence';
import type { PrioritizedFeature }             from '../core/domain/entities/PrioritizedFeature';
import type { BusinessValueOutput }            from '../core/domain/entities/BusinessValueOutput';
import type { AttentionContext }               from './attention/types';
import type { MotionDirectedScene, MotionPlan, MotionPackage, GlobalMotionStyle } from './types';
import { SceneMotionPlanner }                  from './SceneMotionPlanner';
import { TransitionPlanner }                   from './transitions/TransitionPlanner';
import { MotionContinuityEngine }              from './transitions/MotionContinuityEngine';
import { ACCENT_TEAL }                         from '../compositions/tokens';

// ─────────────────────────────────────────────────────────────────────────────
// MotionDirectionInput
// ─────────────────────────────────────────────────────────────────────────────

export interface MotionDirectionInput {
  /** The demo-package.json output from RemotionExportStage. */
  demoPackage:       RemotionPackage;
  /**
   * PageIntelligence keyed by pageId.
   * Used to look up intel for each scene's page.
   */
  intelligence:      Map<string, PageIntelligence>;
  /**
   * Optional ranked feature list from FeatureRankingStage.
   * Enables featureRankScore component of featureImportance.
   */
  rankedFeatures?:   PrioritizedFeature[];
  /**
   * Optional per-feature business value copy from BusinessValueStage.
   * Enables businessValueTierScore via outcomeType lookup.
   */
  businessOutputs?:  BusinessValueOutput[];
  /**
   * Override the global motion style.
   * When absent, defaults to 'moderate' intensity with glass-light callouts.
   */
  globalStyle?:      Partial<GlobalMotionStyle>;
}

// ─────────────────────────────────────────────────────────────────────────────
// MotionDirectionEngine
// ─────────────────────────────────────────────────────────────────────────────

export class MotionDirectionEngine {
  private readonly scenePlanner     = new SceneMotionPlanner();
  private readonly transitionPlanner = new TransitionPlanner();
  private readonly continuityEngine  = new MotionContinuityEngine();

  /**
   * Produce a MotionPlan for all scenes in the package.
   */
  plan(input: MotionDirectionInput): MotionPlan {
    const { demoPackage, intelligence, rankedFeatures, businessOutputs, globalStyle } = input;
    const style = resolveStyle(globalStyle);

    // Shared AttentionContext (same pipeline data for all scenes)
    const context: AttentionContext | undefined =
      rankedFeatures || businessOutputs
        ? { rankedFeatures, businessOutputs }
        : undefined;

    const fps = demoPackage.composition.fps;

    // ── Step 1: Plan each scene independently ────────────────────────────────
    const directedScenes: MotionDirectedScene[] = demoPackage.scenes.map(scene => {
      const intel = resolveIntel(scene, intelligence);
      return this.scenePlanner.plan(scene, intel, style, context, fps);
    });

    // ── Step 2: Plan transitions ─────────────────────────────────────────────
    const transitionPlans = this.transitionPlanner.plan(directedScenes);

    // ── Step 3: Wire enter/exit onto directed scenes ─────────────────────────
    for (let i = 0; i < directedScenes.length; i++) {
      directedScenes[i].enterTransition = transitionPlans[i - 1] ?? null;
      directedScenes[i].exitTransition  = transitionPlans[i]     ?? null;
    }

    // ── Step 4: Apply cross-scene camera continuity ──────────────────────────
    this.continuityEngine.applyContinuity(directedScenes, transitionPlans);

    return {
      version:    '1.0.0',
      generatedAt: new Date().toISOString(),
      globalStyle: style,
      scenes:      directedScenes,
      transitions: transitionPlans,
    };
  }

  /**
   * Produce a full MotionPackage by attaching the motionPlan to the package.
   */
  toMotionPackage(input: MotionDirectionInput): MotionPackage {
    const motionPlan = this.plan(input);
    return {
      ...input.demoPackage,
      motionPlan,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function resolveStyle(override?: Partial<GlobalMotionStyle>): GlobalMotionStyle {
  const defaults: GlobalMotionStyle = {
    intensity:           'moderate',
    calloutVariant:      'glass-light',
    calloutAccentColor:  ACCENT_TEAL,
    preferredTransition: 'slide-parallax',
    maxZoom:             1.8,
    holdPctMin:          0.50,
  };
  return { ...defaults, ...override };
}

/**
 * Resolve PageIntelligence for a scene.
 * Tries to match by scene.pageId; falls back to a stub if not found.
 */
function resolveIntel(
  scene:       RemotionScene,
  intelligence: Map<string, PageIntelligence>,
): PageIntelligence {
  const found = intelligence.get(scene.pageId);
  if (found) return found;

  // Stub fallback — provides enough structure for scoring without crashing
  return {
    pageId:                 scene.pageId,
    analysedAt:             new Date().toISOString(),
    pagePurpose:            scene.description ?? '',
    pageCategory:           'generic',
    features:               [],
    importantActions:       [],
    businessContext:        '',
    kpiWidgets:             [],
    overallImportanceScore: (scene.spotlightTarget?.priority ?? 0.5) * 100,
    analysisMode:           'dom-only',
  };
}
