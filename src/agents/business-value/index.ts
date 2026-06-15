// ─────────────────────────────────────────────────────────────────────────────
// business-value agent — public barrel
// ─────────────────────────────────────────────────────────────────────────────

export { BusinessValueAgent }             from './BusinessValueAgent';
export { BusinessValueResponseParser }    from './BusinessValueResponseParser';
export { buildFallback, KEYWORD_TEMPLATES, CATEGORY_TEMPLATES } from './BusinessValueFallback';
export type { BusinessValueAgentConfig }  from './BusinessValueAgent';
export type { ParsedItem }                from './BusinessValueResponseParser';

// ─────────────────────────────────────────────────────────────────────────────
// Convenience factory — mirrors createVisionAnalysisAgent() in vision-analysis
// ─────────────────────────────────────────────────────────────────────────────

import { BusinessValueAgent }          from './BusinessValueAgent';
import { BusinessValueResponseParser } from './BusinessValueResponseParser';
import type { BusinessValueAgentConfig } from './BusinessValueAgent';
import type { ILLMProvider }           from '../../core/ports/services/ILLMProvider';
import { loadPrompt }                  from '../../infrastructure/llm/PromptLoader';

/**
 * Creates a fully-wired BusinessValueAgent with default implementations.
 *
 * @param llmProvider  The LLM provider to use (typically AzureOpenAIProvider).
 * @param config       Optional overrides for batchSize, concurrency, etc.
 *                     Pass `productName` and `targetAudience` to inject them
 *                     into the prompt template for domain-relevant copy.
 */
export function createBusinessValueAgent(
  llmProvider: ILLMProvider,
  config: Partial<BusinessValueAgentConfig> = {},
): BusinessValueAgent {
  const promptTemplate = loadPrompt('business-value', 'enrich-features.v1');
  return new BusinessValueAgent(
    llmProvider,
    promptTemplate,
    new BusinessValueResponseParser(),
    config,
  );
}
