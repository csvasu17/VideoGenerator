// ─────────────────────────────────────────────────────────────────────────────
// ContextExpansionStage
//
// Pipeline slot: immediately after AuthStage, before DiscoveryStage.
// No browser needed — reads contextText from the pipeline context's input
// and calls IContextExpansionAgent to expand it.
//
// Behaviour:
//   • contextText absent / blank → ctx.contextEnvelope stays ContextEnvelope.empty()
//     (zero pipeline change, exactly equivalent to current behaviour).
//   • Agent returns null (parse fail / retry exhausted) → same: empty envelope.
//   • Agent returns ExpandedApplicationContext → ctx.contextEnvelope updated to
//     ContextEnvelope.fromContext(result).
//
// The ContextEnvelope is then available to every downstream stage before
// ContextSignalValidationStage replaces it with validated signals.
// ─────────────────────────────────────────────────────────────────────────────

import type { PipelineStage } from '../PipelineStage';
import type { PipelineContext } from '../PipelineContext';
import type { IContextExpansionAgent } from '../../../core/ports/agents/IContextExpansionAgent';
import { ContextEnvelope } from '../../../core/domain/entities/context/ContextEnvelope';

export class ContextExpansionStage
  implements PipelineStage<string | undefined, void>
{
  readonly name = 'Context Expansion';

  constructor(private readonly agent: IContextExpansionAgent) {}

  async run(contextText: string | undefined, ctx: PipelineContext): Promise<void> {
    const text = (contextText ?? '').trim();

    if (!text) {
      // No context text supplied — envelope stays empty; no LLM call made.
      return;
    }

    let result = null;
    try {
      result = await this.agent.expand({ rawText: text });
    } catch {
      // expand() never throws by contract, but guard defensively.
      result = null;
    }

    if (result) {
      ctx.contextEnvelope = ContextEnvelope.fromContext(result);
      console.log(
        `[ContextExpansionStage] Expanded context: quality=${result.expansionQuality}, ` +
        `confidence=${result.overallConfidence.toFixed(2)}, ` +
        `goals=${result.businessGoals.length}, priorities=${result.demoPriorities.length}`,
      );
    } else {
      console.log(
        '[ContextExpansionStage] Expansion returned null — continuing with empty envelope.',
      );
    }
  }
}
