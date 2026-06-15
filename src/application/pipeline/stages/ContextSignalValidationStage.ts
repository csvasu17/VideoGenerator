// ─────────────────────────────────────────────────────────────────────────────
// ContextSignalValidationStage
//
// Pipeline slot: after BusinessValueStage (or FeatureRankingStage when no
// BusinessValueAgent is injected), before JourneyGenerationStage.
//
// Preconditions (asserted at runtime):
//   ctx.discoveredPages    — set by DiscoveryStage
//   ctx.pageIntelligence   — set by ScreenshotIntelligenceStage
//   ctx.businessValueOutputs — optionally set by BusinessValueStage
//
// Behaviour:
//   • ctx.contextEnvelope.isPresent() === false → skip (zero pipeline change).
//   • Otherwise: builds full evidence corpus from all three sources, runs
//     ContextSignalValidator, and calls ctx.contextEnvelope.applyValidation().
//
// After this stage:
//   • ctx.contextEnvelope.isValidated() === true
//   • ctx.contextEnvelope.getEffectiveWeight() uses validated overallConfidence
//   • ctx.contextEnvelope.getNarrationHints() uses effectiveConfidence thresholds
// ─────────────────────────────────────────────────────────────────────────────

import type { PipelineStage } from '../PipelineStage';
import type { PipelineContext } from '../PipelineContext';
import { ContextSignalValidator } from '../../../agents/context/ContextSignalValidator';

export class ContextSignalValidationStage
  implements PipelineStage<void, void>
{
  readonly name = 'Context Signal Validation';

  async run(_input: void, ctx: PipelineContext): Promise<void> {
    // Guard: nothing to validate when no context was provided.
    if (!ctx.contextEnvelope.isPresent()) {
      return;
    }

    const validator = new ContextSignalValidator();

    const validated = validator.validate({
      context:              ctx.contextEnvelope.expanded!,
      discoveredPages:      ctx.discoveredPages      ?? [],
      pageIntelligence:     ctx.pageIntelligence     ?? [],
      businessValueOutputs: ctx.businessValueOutputs,
    });

    ctx.contextEnvelope.applyValidation(validated);

    console.log(
      `[ContextSignalValidationStage] ${validated.validationSummary.humanReadable}. ` +
      `effectiveWeight=${validated.effectiveWeight.toFixed(3)}`,
    );
  }
}
