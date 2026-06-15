// ─────────────────────────────────────────────────────────────────────────────
// BusinessValueAgent
//
// Converts the businessValue fields of each PrioritizedFeature from
// vision-analysis prose into customer-facing sales copy via an LLM.
//
// Batching strategy:
//   Features are chunked into groups of `batchSize` (default 8).
//   Each chunk is one LLM call. Chunks run concurrently up to `concurrency`
//   (default 2) via CaptureQueue — matching VisionAnalysisAgent's pattern.
//
// Failure isolation:
//   - Per-feature failures: handled by parser (missing featureIds → fallback)
//   - Per-batch LLM failure: caught by retry chain; if all retries exhausted,
//     buildFallback() is called for every feature in that batch
//   - Any batch failure is non-fatal — the agent always returns a full result
// ─────────────────────────────────────────────────────────────────────────────

import type { ILLMProvider }          from '../../core/ports/services/ILLMProvider';
import type { IBusinessValueAgent }    from '../../core/ports/agents/IBusinessValueAgent';
import type { PrioritizedFeature }     from '../../core/domain/entities/PrioritizedFeature';
import type {
  BusinessValueOutput,
  BusinessValueEnrichmentResult,
} from '../../core/domain/entities/BusinessValueOutput';
import { CaptureQueue }                from '../screenshot/CaptureQueue';
import { RetryPolicy, DEFAULT_RETRY_OPTIONS } from '../screenshot/RetryPolicy';
import type { RetryOptions }           from '../screenshot/RetryPolicy';
import { fillTemplate }                from '../../infrastructure/llm/PromptLoader';
import { BusinessValueResponseParser } from './BusinessValueResponseParser';
import { buildFallback }               from './BusinessValueFallback';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface BusinessValueAgentConfig {
  /**
   * Maximum features sent to the LLM in a single call.
   * Keep ≤10 to maintain stylistic consistency and stay within token limits.
   * Default: 8.
   */
  batchSize: number;
  /**
   * Maximum concurrent LLM calls.
   * Default: 2.  Matches the default concurrency of VisionAnalysisAgent.
   */
  concurrency: number;
  /** Retry configuration for individual batch calls. */
  retry: RetryOptions;
  /** Max response tokens for the LLM. Default: 3000. */
  maxTokens: number;
  /**
   * LLM temperature. Lower = more consistent tone; slightly higher allows
   * more varied copy across features. Default: 0.2.
   */
  temperature: number;
  /** Injected into the prompt template as {{PRODUCT_NAME}}. */
  productName?: string;
  /** Injected into the prompt template as {{TARGET_AUDIENCE}}. */
  targetAudience?: string;
}

const DEFAULT_CONFIG: Readonly<BusinessValueAgentConfig> = {
  batchSize:     8,
  concurrency:   2,
  retry:         { ...DEFAULT_RETRY_OPTIONS, maxAttempts: 2 },
  maxTokens:     3_000,
  temperature:   0.2,
};

// ─────────────────────────────────────────────────────────────────────────────
// BusinessValueAgent
// ─────────────────────────────────────────────────────────────────────────────

export class BusinessValueAgent implements IBusinessValueAgent {
  private readonly config: BusinessValueAgentConfig;
  private readonly queue:  CaptureQueue;
  private readonly retry:  RetryPolicy;

  constructor(
    private readonly llmProvider:    ILLMProvider,
    private readonly promptTemplate: string,
    private readonly parser:         BusinessValueResponseParser,
    config: Partial<BusinessValueAgentConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.queue  = new CaptureQueue(this.config.concurrency);
    this.retry  = new RetryPolicy();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async enrich(features: PrioritizedFeature[]): Promise<BusinessValueEnrichmentResult> {
    const enrichedAt = new Date().toISOString();

    if (features.length === 0) {
      return { outputs: [], totalSubmitted: 0, totalEnriched: 0, enrichedAt };
    }

    // ── 1. Split into batches ──────────────────────────────────────────────
    const batches = chunk(features, this.config.batchSize);

    // ── 2. Run batches concurrently (CaptureQueue limits parallelism) ──────
    const batchResults = await this.queue.runAll(
      batches.map(batch => () => this.processBatch(batch)),
    );

    // ── 3. Flatten results, applying batch-level fallbacks ─────────────────
    const outputs: BusinessValueOutput[] = [];
    let totalEnriched = 0;

    for (let i = 0; i < batches.length; i++) {
      const result = batchResults[i];
      const batch  = batches[i];

      if (result.status === 'fulfilled') {
        for (const out of result.value) {
          outputs.push(out);
          if (out.source === 'llm') totalEnriched++;
        }
      } else {
        // Entire batch failed after all retries — fall back for all features
        const errMsg = result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);

        console.warn(
          `[BusinessValue] batch failed (${batch.length} features): ${errMsg.slice(0, 120)}`,
        );

        for (const pf of batch) {
          outputs.push(buildFallback(pf));
        }
      }
    }

    console.info(
      `[BusinessValue] enriched ${totalEnriched}/${features.length} features via LLM ` +
      `(${features.length - totalEnriched} used fallback)`,
    );

    return { outputs, totalSubmitted: features.length, totalEnriched, enrichedAt };
  }

  // ── Private — per-batch processing ─────────────────────────────────────────

  private async processBatch(batch: PrioritizedFeature[]): Promise<BusinessValueOutput[]> {
    return this.retry.execute(
      () => this.callLLM(batch),
      this.config.retry,
    );
  }

  private async callLLM(batch: PrioritizedFeature[]): Promise<BusinessValueOutput[]> {
    // ── Build the feature payload for the prompt ───────────────────────────
    const featureBatch = batch.map(pf => ({
      featureId:            pf.feature.id,
      featureName:          pf.feature.name,
      description:          pf.feature.summary,
      existingBusinessValue: pf.feature.businessValue.headline,
      category:             pf.feature.category,
      rank:                 pf.rank,
      compositeScore:       Math.round(pf.composite),
    }));

    // ── Fill prompt template ───────────────────────────────────────────────
    const prompt = fillTemplate(this.promptTemplate, {
      PRODUCT_NAME:    this.config.productName    ?? 'the Platform',
      TARGET_AUDIENCE: this.config.targetAudience ?? 'decision makers and operations leaders',
      FEATURE_BATCH:   JSON.stringify(featureBatch, null, 2),
    });

    // ── LLM call ───────────────────────────────────────────────────────────
    const rawText = await this.llmProvider.complete(
      [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      {
        maxTokens:   this.config.maxTokens,
        temperature: this.config.temperature,
      },
    );

    // ── Parse response ─────────────────────────────────────────────────────
    const submittedIds = batch.map(pf => pf.feature.id);
    const parsed       = this.parser.parse(rawText, submittedIds);

    const parsedById = new Map(parsed.map(p => [p.featureId, p]));

    // ── Map each feature to its enriched output (or fallback) ─────────────
    return batch.map(pf => {
      const enriched = parsedById.get(pf.feature.id);

      if (
        enriched &&
        enriched.businessProblem &&
        enriched.businessBenefit &&
        enriched.customerOutcome &&
        enriched.salesNarration
      ) {
        return {
          featureId:       pf.feature.id,
          featureName:     pf.feature.name,
          businessProblem: enriched.businessProblem,
          businessBenefit: enriched.businessBenefit,
          customerOutcome: enriched.customerOutcome,
          salesNarration:  enriched.salesNarration,
          source:          'llm' as const,
        };
      }

      // LLM omitted this feature or returned empty strings → use fallback
      return buildFallback(pf);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
