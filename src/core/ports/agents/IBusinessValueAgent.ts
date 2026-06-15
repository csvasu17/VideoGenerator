import type { PrioritizedFeature }           from '../../domain/entities/PrioritizedFeature';
import type {
  BusinessValueEnrichmentResult,
} from '../../domain/entities/BusinessValueOutput';

// ─────────────────────────────────────────────────────────────────────────────
// IBusinessValueAgent
//
// Hexagonal-architecture port for the Business Value Enrichment agent.
// The pipeline depends only on this interface; the concrete agent is injected
// by the orchestrator. This allows mock injection in tests and alternative
// implementations (e.g. a non-LLM rule engine).
// ─────────────────────────────────────────────────────────────────────────────

export interface IBusinessValueAgent {
  /**
   * Convert the businessValue fields of each feature into customer-facing copy.
   *
   * Contract:
   * - Never rejects. Individual LLM failures fall back to rule-based defaults.
   * - Always returns exactly one BusinessValueOutput per input feature, in the
   *   same order as the input array.
   * - Features using the LLM path have source === 'llm'.
   * - Features that fell back have source === 'fallback'.
   *
   * @param features  The ranked feature list from FeatureRankingStage.
   */
  enrich(features: PrioritizedFeature[]): Promise<BusinessValueEnrichmentResult>;
}
