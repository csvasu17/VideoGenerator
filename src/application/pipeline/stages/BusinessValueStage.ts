// ─────────────────────────────────────────────────────────────────────────────
// BusinessValueStage
//
// Pipeline slot: between FeatureRankingStage (stage 5) and
// JourneyGenerationStage (stage 6).
//
// Responsibilities:
//   1. Call BusinessValueAgent.enrich() with ranked features
//   2. Merge the LLM-generated copy back into Feature.businessValue so
//      every downstream stage (JourneyGenerator, StoryboardGenerator) sees
//      the improved customer-facing text without needing explicit wiring
//   3. Store the raw enrichment result in ctx.businessValueOutputs for
//      downstream stages that want the full output (e.g. StoryboardStage
//      can use salesNarration as a direct scene-narration override)
//   4. Return the enriched PrioritizedFeature[] — same length, same order,
//      same scores/ranks; only the Feature.businessValue sub-object changes
// ─────────────────────────────────────────────────────────────────────────────

import type { PipelineStage }          from '../PipelineStage';
import type { PipelineContext }         from '../PipelineContext';
import type { PrioritizedFeature }      from '../../../core/domain/entities/PrioritizedFeature';
import type { IBusinessValueAgent }     from '../../../core/ports/agents/IBusinessValueAgent';
import type { BusinessValueOutput }     from '../../../core/domain/entities/BusinessValueOutput';

// ─────────────────────────────────────────────────────────────────────────────
// BusinessValueStage
// ─────────────────────────────────────────────────────────────────────────────

export class BusinessValueStage
  implements PipelineStage<PrioritizedFeature[], PrioritizedFeature[]>
{
  readonly name = 'Business Value Enrichment';

  constructor(private readonly agent: IBusinessValueAgent) {}

  async run(
    features:  PrioritizedFeature[],
    ctx:       PipelineContext,
  ): Promise<PrioritizedFeature[]> {
    if (features.length === 0) return features;

    // ── 1. Enrich via agent ────────────────────────────────────────────────
    const result = await this.agent.enrich(features);

    // ── 2. Persist raw outputs in context (used by StoryboardStage) ────────
    ctx.businessValueOutputs = result;

    // ── 3. Build lookup map ────────────────────────────────────────────────
    const byFeatureId = new Map<string, BusinessValueOutput>(
      result.outputs.map(o => [o.featureId, o]),
    );

    // ── 4. Merge enriched copy back into features ──────────────────────────
    //
    // Merge strategy:
    //  - businessBenefit → Feature.businessValue.headline
    //    (the "BusinessValue.headline" is the one-liner used by SalesNarrationEngine)
    //  - businessProblem → Feature.businessValue.painSolved
    //  - customerOutcome → Feature.businessValue.quantifiedImpact
    //
    // salesNarration is NOT merged into Feature — it lives in ctx.businessValueOutputs
    // and is picked up by StoryboardStage as a scene-narration override.
    //
    // Rationale for merge targets:
    //  • headline is read by JourneyGenerator when building StepFeature.businessValue
    //    (a string), which is then consumed by SalesNarrationEngine.midNarration().
    //    Updating it here means the storyboard automatically uses better copy.
    //  • painSolved and quantifiedImpact improve downstream heuristics and logs.
    //
    // Only LLM-sourced outputs are merged — fallback outputs preserve the
    // existing metadata unchanged (they were already based on it).
    return features.map(pf => {
      const enriched = byFeatureId.get(pf.feature.id);

      if (!enriched || enriched.source !== 'llm') {
        // No enrichment or fallback — return unchanged
        return pf;
      }

      // Deep-clone to avoid mutating the original (keeps the pipeline side-effect free)
      return {
        ...pf,
        feature: {
          ...pf.feature,
          businessValue: {
            ...pf.feature.businessValue,
            headline:         enriched.businessBenefit,
            painSolved:       enriched.businessProblem,
            quantifiedImpact: enriched.customerOutcome,
          },
        },
      } satisfies PrioritizedFeature;
    });
  }
}
