// ─────────────────────────────────────────────────────────────────────────────
// DemoReadinessStage
//
// Pipeline stage (Stage 5d) that scores every PageIntelligence record for
// demo suitability and filters the corpus before JourneyGenerationStage runs.
//
// Position: after ContextSignalValidationStage, before JourneyGenerationStage.
//
// What it does:
//   1. Builds a ScoringContext per page (no I/O, reads from existing ctx fields).
//   2. Runs ReadinessScorer → ReadinessResult[] with full signal audit trail.
//   3. Applies the configurable threshold + minimum-scene guarantee.
//   4. Replaces ctx.pageIntelligence and ctx.prioritizedFeatures with the
//      filtered (passing) subsets — downstream stages see only demo-ready pages.
//   5. Stores the full ReadinessResult[] in ctx.readinessResults for
//      debugging and report generation.
//
// Backward compatibility:
//   — Never modifies ctx.pageCaptures (RemotionExporter constraint).
//   — Defaults to threshold=0.40 and minScenes=5; callers can override via
//     WorkflowOptions.readinessThreshold / WorkflowOptions.minScenesAfterFilter.
//   — If pageIntelligence or applicationGraph is missing, stage is a no-op.
// ─────────────────────────────────────────────────────────────────────────────

import type { PipelineStage }         from '../PipelineStage';
import type { PipelineContext }        from '../PipelineContext';
import type { PageIntelligence }       from '../../../core/domain/entities/PageIntelligence';
import type { PrioritizedFeature }     from '../../../core/domain/entities/PrioritizedFeature';
import type { PageCapture }            from '../../../core/domain/entities/PageCapture';
import type { ApplicationGraph }       from '../../../discovery/graph/types';
import type { BusinessValueEnrichmentResult } from '../../../core/domain/entities/BusinessValueOutput';
import type { ReadinessResult }        from '../../../core/domain/entities/ReadinessResult';
import { ScoringContextBuilder }       from '../../../demo-readiness/ScoringContextBuilder';
import { ReadinessScorer }             from '../../../demo-readiness/ReadinessScorer';

// ─────────────────────────────────────────────────────────────────────────────
// I/O types
// ─────────────────────────────────────────────────────────────────────────────

export interface DemoReadinessInput {
  intelligence:     PageIntelligence[];
  features:         PrioritizedFeature[];
  captures:         PageCapture[];
  graph:            ApplicationGraph;
  businessOutputs?: BusinessValueEnrichmentResult;
  /** Minimum readinessScore for 'pass' verdict.  Default: 0.40. */
  threshold:        number;
  /**
   * Minimum number of pages that must reach JourneyGeneration.
   * Borderline pages are promoted (in score order) if the passing set is
   * smaller than this floor.  Hard-rejected pages are never promoted.
   * Default: 5.
   */
  minScenes:        number;
}

export interface DemoReadinessOutput {
  scoredPages:          ReadinessResult[];
  filteredIntelligence: PageIntelligence[];
  filteredFeatures:     PrioritizedFeature[];
  passCount:            number;
  borderlineCount:      number;
  rejectedCount:        number;
  /** Number of borderline pages promoted to meet the minimum scene floor. */
  promotedCount:        number;
  /** True when borderline pages were promoted due to a thin corpus. */
  readinessWarning:     boolean;
  /**
   * Number of eligible pages classified as DemoValueTier 1
   * (AI / Predictive / Digital Twin / Simulator).
   * Their overallImportanceScore is boosted to ≥ 90 in filteredIntelligence
   * so Journey Generator prioritises them in path selection.
   */
  tier1EligibleCount:   number;
}

// ─────────────────────────────────────────────────────────────────────────────
// DemoReadinessStage
// ─────────────────────────────────────────────────────────────────────────────

export class DemoReadinessStage
  implements PipelineStage<DemoReadinessInput, DemoReadinessOutput>
{
  readonly name = 'Demo Readiness';

  async run(
    input: DemoReadinessInput,
    ctx:   PipelineContext,
  ): Promise<DemoReadinessOutput> {
    const {
      intelligence, features, captures, graph,
      businessOutputs, threshold, minScenes,
    } = input;

    // ── Guard: empty corpus ───────────────────────────────────────────────────
    if (intelligence.length === 0) {
      return {
        scoredPages: [], filteredIntelligence: [], filteredFeatures: [],
        passCount: 0, borderlineCount: 0, rejectedCount: 0,
        promotedCount: 0, readinessWarning: false, tier1EligibleCount: 0,
      };
    }

    // ── 1. Build scoring contexts ─────────────────────────────────────────────
    const contexts = ScoringContextBuilder.build(
      intelligence, features, captures, graph, businessOutputs,
    );

    // ── 2. Score all pages ────────────────────────────────────────────────────
    const scored = ReadinessScorer.score(contexts, threshold);

    // Store full audit trail in ctx for diagnostics and reports.
    ctx.readinessResults = scored;

    // ── 3. Partition by verdict ───────────────────────────────────────────────
    const passing    = scored.filter(r => r.verdict === 'pass');
    const borderline = scored
      .filter(r => r.verdict === 'borderline')
      .sort((a, b) => b.readinessScore - a.readinessScore);  // best first
    const rejected   = scored.filter(r => r.verdict === 'reject');

    // ── 4. Apply minimum scene guarantee ─────────────────────────────────────
    // Hard-rejects are never promoted.
    let promoted: ReadinessResult[] = [];
    if (passing.length < minScenes && borderline.length > 0) {
      const needed = minScenes - passing.length;
      promoted = borderline.slice(0, needed);
    }

    const eligible = [...passing, ...promoted];
    const eligiblePageIds = new Set(eligible.map(r => r.pageId));

    // ── 5. Filter intelligence and features ───────────────────────────────────

    // Identify Tier 1 pages (AI / Predictive / Digital Twin / Simulator) so we
    // can boost their overallImportanceScore before Journey Generation sees them.
    // This ensures the Journey Generator's path-scoring algorithm prefers these
    // high-value screens over generic interaction states.
    const tier1EligibleIds = new Set(
      eligible.filter(r => r.demoValueTier === 'tier1').map(r => r.pageId),
    );

    const filteredIntelligence = intelligence
      .filter(pi => eligiblePageIds.has(pi.pageId))
      .map(pi =>
        tier1EligibleIds.has(pi.pageId)
          ? { ...pi, overallImportanceScore: Math.max(pi.overallImportanceScore, 90) }
          : pi,
      );

    // Remove features whose ALL associated pages were rejected.
    // A feature that appears on both a passing and a rejected page is kept.
    // CRITICAL: also scrub non-eligible pageIds from each feature's pageIds list.
    // Without this, StoryboardStage generates scenes for rejected pages by following
    // the feature→pageId links, allowing login / form / settings pages to appear in
    // the final storyboard even though they were blocked by Demo Readiness.
    const passingPageIds = eligiblePageIds; // same set
    const filteredFeatures = features
      .filter(pf => pf.feature.pageIds.some(pid => passingPageIds.has(pid)))
      .map(pf => ({
        ...pf,
        feature: {
          ...pf.feature,
          pageIds: pf.feature.pageIds.filter(pid => passingPageIds.has(pid)),
        },
      }));

    const readinessWarning = promoted.length > 0;

    return {
      scoredPages:          scored,
      filteredIntelligence,
      filteredFeatures,
      passCount:            passing.length,
      borderlineCount:      borderline.length,
      rejectedCount:        rejected.length,
      promotedCount:        promoted.length,
      readinessWarning,
      tier1EligibleCount:   tier1EligibleIds.size,
    };
  }
}
