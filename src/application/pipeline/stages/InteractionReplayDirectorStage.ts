// ─────────────────────────────────────────────────────────────────────────────
// InteractionReplayDirectorStage — Phase 9 pipeline stage (5g)
//
// Insertion point: AFTER SalesStoryDirectorStage, BEFORE JourneyGenerationStage
//
// Pipeline:
//   ctx.interactionExplorations
//     → InteractionSequenceBuilder   (ExplorationResult → InteractionSequence[])
//     → BusinessInteractionScorer    (score each sequence)
//     → ReplayBuilder                (InteractionSequence → InteractionReplay[])
//     → ReplayValidator              (promote/demote each replay)
//     → InteractionSalesStoryBridge  (match to StoryArc, enforce coverage guard)
//     → ctx.interactionReplayPlan
//
// Guards:
//   - Skips when ctx.interactionExplorations is absent or empty
//   - Skips when ctx.salesStory is absent
//   - Skips when zero sequences are built from explorations
//
// Requirements: No LLM calls. Deterministic. Backward compatible.
// ─────────────────────────────────────────────────────────────────────────────

import type { PipelineContext } from '../PipelineContext';
import type { PipelineStage }   from '../PipelineStage';
import { InteractionSequenceBuilder  } from '../../../interaction-replay/InteractionSequenceBuilder';
import { BusinessInteractionScorer   } from '../../../interaction-replay/BusinessInteractionScorer';
import { ReplayBuilder               } from '../../../interaction-replay/ReplayBuilder';
import { ReplayValidator             } from '../../../interaction-replay/ReplayValidator';
import { InteractionSalesStoryBridge } from '../../../interaction-replay/InteractionSalesStoryBridge';

// ── I/O ───────────────────────────────────────────────────────────────────────

/** No additional inputs beyond PipelineContext — all data comes from ctx. */
export type InteractionReplayDirectorInput = Record<string, never>;

export interface InteractionReplayDirectorOutput {
  totalSequencesBuilt:  number;
  totalReplaysPromoted: number;
  totalReplaysDemoted:  number;
  coverageRate:         number;
  skipped:              boolean;
  skipReason?:          string;
}

// ── Stage ─────────────────────────────────────────────────────────────────────

export class InteractionReplayDirectorStage
  implements PipelineStage<InteractionReplayDirectorInput, InteractionReplayDirectorOutput>
{
  readonly name = 'Interaction Replay Director';

  async run(
    _input: InteractionReplayDirectorInput,
    ctx:    PipelineContext,
  ): Promise<InteractionReplayDirectorOutput> {

    // Guard 1: requires interaction explorations
    if (!ctx.interactionExplorations || ctx.interactionExplorations.size === 0) {
      console.log('[InteractionReplayDirector] No exploration data — skipping.');
      return skip('no_explorations');
    }

    // Guard 2: requires a sales story for scene-level matching
    if (!ctx.salesStory) {
      console.log('[InteractionReplayDirector] No sales story — skipping.');
      return skip('no_sales_story');
    }

    // ── Step 1: Build InteractionSequences ──────────────────────────────────
    const sequences = new InteractionSequenceBuilder().build(ctx.interactionExplorations);

    console.log(
      `[InteractionReplayDirector] Built ${sequences.length} sequences ` +
      `from ${ctx.interactionExplorations.size} explored pages.`,
    );

    if (sequences.length === 0) {
      return skip('no_sequences');
    }

    // ── Step 2: Business-score each sequence ─────────────────────────────────
    const scored = new BusinessInteractionScorer().score(sequences);

    // ── Step 3: Build replays (arc positions default to 0.5 — no LLM needed)
    const allReplays = new ReplayBuilder().build(scored);

    // ── Step 4: Validate (promote / demote) ──────────────────────────────────
    const { promoted, demoted, report } = new ReplayValidator().validate(allReplays);

    console.log(
      `[InteractionReplayDirector] Validation: ` +
      `${promoted.length} promoted, ${demoted.length} demoted.`,
    );

    // ── Step 5: Bridge to story arc + apply coverage guard ───────────────────
    const plan = new InteractionSalesStoryBridge().bridge(
      promoted,
      allReplays,
      ctx.salesStory,
      report,
    );

    console.log(
      `[InteractionReplayDirector] Plan: ` +
      `${plan.replays.length} replays mapped to ` +
      `${plan.sceneToReplayMap.size}/${ctx.salesStory.scenes.length} scenes ` +
      `(coverage ${(plan.coverageRate * 100).toFixed(0)}%).`,
    );

    // ── Step 6: Write to context ──────────────────────────────────────────────
    ctx.interactionReplayPlan = plan;

    return {
      totalSequencesBuilt:  sequences.length,
      totalReplaysPromoted: promoted.length,
      totalReplaysDemoted:  demoted.length,
      coverageRate:         plan.coverageRate,
      skipped:              false,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function skip(reason: string): InteractionReplayDirectorOutput {
  return {
    totalSequencesBuilt:  0,
    totalReplaysPromoted: 0,
    totalReplaysDemoted:  0,
    coverageRate:         0,
    skipped:              true,
    skipReason:           reason,
  };
}
