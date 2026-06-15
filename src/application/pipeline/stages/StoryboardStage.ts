import type { PipelineStage } from '../PipelineStage';
import type { PipelineContext, WorkflowOptions } from '../PipelineContext';
import type { DemoJourney } from '../../../core/domain/entities/DemoJourney';
import type { Storyboard } from '../../../core/domain/entities/Storyboard';
import type { HighlightElementType } from '../../../core/domain/entities/Storyboard';
import type { StoryArc, SceneGoal, ProofElementType } from '../../../core/domain/entities/SalesStory';
import type {
  InteractionReplay,
  InteractionReplayPlan,
  SerializedInteractionReplay,
} from '../../../core/domain/entities/InteractionReplay';
import { createStoryboardGenerator } from '../../../agents/storyboard';
import { resolveTemplate } from '../../../video-templates/VideoTemplateStrategy';

export interface StoryboardInput {
  journey:   DemoJourney;
  options?:  WorkflowOptions;
  /**
   * Phase 8: when present, overrides scene callouts, narration opening/closing
   * lines, highlight targets, and minimum durations with values derived from
   * the business-story layer.
   * Backward-compatible: absent = existing behaviour unchanged.
   */
  storyArc?: StoryArc;
}

// ── ProofElementType → HighlightElementType mapping ─────────────────────────

const PROOF_TO_HIGHLIGHT: Record<ProofElementType, HighlightElementType> = {
  prediction_card:     'kpi',
  risk_indicator:      'kpi',
  kpi_metric:          'kpi',
  cost_savings_metric: 'kpi',
  alert_severity:      'kpi',
  outcome_metric:      'kpi',
  anomaly_highlight:   'chart',
  trend_chart:         'chart',
  simulation_result:   'chart',
  fleet_health_summary:'table',
};

// ─────────────────────────────────────────────────────────────────────────────

export class StoryboardStage implements PipelineStage<StoryboardInput, Storyboard> {
  readonly name = 'Storyboard Generation';

  async run(input: StoryboardInput, ctx: PipelineContext): Promise<Storyboard> {
    // ── Build salesNarration overrides from BusinessValueStage output ─────
    // When BusinessValueAgent successfully enriched features, use its LLM-
    // generated salesNarration as the scene narration for mid-scenes.
    // Only use LLM-sourced outputs (source === 'llm') — fallbacks already
    // mirror the template-generated copy and adding them provides no benefit.
    const salesNarrationOverrides: Record<string, string> = {};
    const bvOutputs = ctx.businessValueOutputs?.outputs ?? [];
    for (const bv of bvOutputs) {
      if (bv.source === 'llm' && bv.salesNarration) {
        salesNarrationOverrides[bv.featureId] = bv.salesNarration;
      }
    }

    // ── Apply context narration hints ─────────────────────────────────────
    // NarrationHints only carry fields that met MIN_FOR_NARRATION (0.65
    // effectiveConfidence), so they are safe to inject without review.
    //
    // Override strategy:
    //   audienceLabel → opts.targetAudience  (only when caller did not set one)
    //   goalSummary   → opts.primaryBenefit  (only when caller did not set one)
    //   narrationHints passed through to SalesNarrationEngine for mid-scene copy
    const hints = ctx.contextEnvelope.getNarrationHints() ?? undefined;

    const effectiveTargetAudience =
      input.options?.targetAudience ??
      hints?.audienceLabel ??
      undefined;

    const effectivePrimaryBenefit =
      input.options?.primaryBenefit ??
      hints?.goalSummary ??
      undefined;

    const template = resolveTemplate(ctx.input.options?.videoTemplate);
    const generator = createStoryboardGenerator(template);

    const storyboard = await generator.generate(input.journey, {
      productName:             input.options?.productName,
      targetAudience:          effectiveTargetAudience,
      primaryBenefit:          effectivePrimaryBenefit,
      callToAction:            input.options?.callToAction,
      salesNarrationOverrides: Object.keys(salesNarrationOverrides).length > 0
        ? salesNarrationOverrides
        : undefined,
      narrationHints: hints,
    });

    // ── Phase 8: StoryArc overrides ───────────────────────────────────────
    // Apply SceneGoal data (callout, narration hooks, highlight, duration,
    // sceneRole) to each scene.  Overrides are applied after generation so
    // the existing generator output is always the base; we only strengthen it.
    if (input.storyArc && input.storyArc.scenes.length > 0) {
      applyStoryArcOverrides(storyboard, input.storyArc);
    }

    // ── Phase 9: Interaction replay overrides ─────────────────────────────
    // For each scene matched by InteractionReplayDirectorStage, promote it
    // to sceneType='interaction' and attach the serialised replay data.
    // Absent plan = no-op (backward compatible).
    if (ctx.interactionReplayPlan) {
      applyInteractionOverrides(storyboard, ctx.interactionReplayPlan, ctx.input.outputDir);
    }

    return storyboard;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// applyStoryArcOverrides — post-generation scene enrichment
// ─────────────────────────────────────────────────────────────────────────────

function applyStoryArcOverrides(storyboard: Storyboard, arc: StoryArc): void {
  // Build map: pageId → SceneGoal (last scene wins for duplicate pageIds)
  const goalByPageId = new Map<string, SceneGoal>(
    arc.scenes.map(sg => [sg.pageId, sg]),
  );

  // Apply opening / closing CTA from arc
  if (arc.openingHook) {
    storyboard.openingTitle = arc.openingHook;
  }
  if (arc.closingCTA) {
    storyboard.closingCallToAction = arc.closingCTA;
  }

  for (const scene of storyboard.scenes) {
    const goal = goalByPageId.get(scene.pageId);
    if (!goal) continue;

    // ── salesHook → callout ───────────────────────────────────────────────
    if (goal.callout) {
      scene.salesHook = goal.callout;
    }

    // ── Narration: prepend narrativeHook, append closingLine ──────────────
    // Only inject when the goal has non-trivial hooks (length > 10).
    const hasHook   = goal.narrativeHook.length > 10;
    const hasCloser = goal.closingLine.length    > 10;
    if (hasHook || hasCloser) {
      const parts: string[] = [];
      if (hasHook)   parts.push(goal.narrativeHook);
      parts.push(scene.narration);
      if (hasCloser) parts.push(goal.closingLine);
      scene.narration = parts.join('\n\n');
    }

    // ── Minimum duration ──────────────────────────────────────────────────
    scene.durationSec = Math.max(scene.durationSec, goal.minDurationSec);

    // ── Highlight target element type ─────────────────────────────────────
    const highlightType = PROOF_TO_HIGHLIGHT[goal.proofElement.type];
    if (highlightType) {
      scene.highlightTarget.elementType = highlightType;
    }

    // ── Scene role ────────────────────────────────────────────────────────
    scene.sceneRole = goal.sceneRole;
  }

  // Recompute total duration after overrides
  storyboard.totalDurationSec = storyboard.scenes.reduce(
    (sum, s) => sum + s.durationSec, 0,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// applyInteractionOverrides — Phase 9 scene promotion
// ─────────────────────────────────────────────────────────────────────────────

function applyInteractionOverrides(
  storyboard: Storyboard,
  plan:       InteractionReplayPlan,
  outputDir:  string,
): void {
  // Build interactionId → InteractionReplay map for fast lookup
  const replayById = new Map<string, InteractionReplay>(
    plan.replays.map(r => [r.interactionId, r]),
  );

  for (const [sceneIdx, interactionId] of plan.sceneToReplayMap) {
    const scene  = storyboard.scenes[sceneIdx];
    const replay = replayById.get(interactionId);
    if (!scene || !replay) continue;

    scene.sceneType        = 'interaction';
    scene.interactionReplay = serialiseReplay(replay, outputDir);

    // Extend scene duration to match replay duration (interaction scenes run longer)
    scene.durationSec = Math.max(scene.durationSec, replay.replayDurationSec);
  }

  // Recompute total after duration changes
  storyboard.totalDurationSec = storyboard.scenes.reduce(
    (sum, s) => sum + s.durationSec, 0,
  );
}

/**
 * Convert an absolute Windows/POSIX path to a path relative to the Remotion
 * public dir (outputDir).  Remotion's staticFile() only accepts paths that
 * are relative to the public dir — absolute paths throw at render time.
 *
 * Example:
 *   abs    : D:\Vasu\...\out\localhost\interactions\abc\state-xyz.png
 *   base   : D:\Vasu\...\out\localhost
 *   result : interactions/abc/state-xyz.png
 */
function toPublicRelative(absPath: string, outputDir: string): string {
  // Normalise both to forward-slash for comparison
  const normalPath = absPath.replace(/\\/g, '/');
  const normalBase = outputDir.replace(/\\/g, '/').replace(/\/$/, '');
  if (normalPath.startsWith(normalBase + '/')) {
    return normalPath.slice(normalBase.length + 1);
  }
  // Already relative or from an unexpected location — return as-is
  return normalPath;
}

function serialiseReplay(r: InteractionReplay, outputDir: string): SerializedInteractionReplay {
  return {
    interactionId:       r.interactionId,
    startScreenshotPath: toPublicRelative(r.startState.screenshotPath, outputDir),
    endScreenshotPath:   toPublicRelative(r.endState.screenshotPath,   outputDir),
    trigger: {
      eventType:         r.trigger.eventType,
      elementBBox:       r.trigger.elementBBox,
      humanReadableHint: r.trigger.humanReadableHint,
    },
    visualDelta: {
      primaryChangeRegion: r.visualDelta.primaryChangeRegion,
      changeIntensity:     r.visualDelta.changeIntensity,
    },
    phases:           r.phases,
    cameraDirectives: r.cameraDirectives,
    calloutText:      r.calloutText,
    calloutBBox:      r.calloutBBox,
    replayPriority:   r.replayPriority,
    businessPurpose:  r.businessPurpose,
  };
}
