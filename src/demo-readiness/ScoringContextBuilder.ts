// ─────────────────────────────────────────────────────────────────────────────
// ScoringContextBuilder
//
// Flattens the four pipeline context objects into a per-page ScoringContext
// that all detectors consume.  Called once by DemoReadinessStage before
// scoring begins.
//
// Data joins performed:
//   PageIntelligence.pageId  ↔  PageCapture.pageId
//     → URL, title, DOM structure (formCount, inputCount, buttonCount, headings)
//   PageCapture.dom.url      ↔  ApplicationGraph.nodes[].url
//     → nodeType, pageDepth
//   PageIntelligence.pageId  ↔  PrioritizedFeature.feature.pageIds[]
//     → topFeatureComposite, pageFeatureCount
//   PrioritizedFeature.feature.id ↔ BusinessValueOutput.featureId
//     → businessBenefits (salesNarration + businessBenefit strings)
//
// When a lookup fails (capture/node not found) the fields default to safe
// zero-values so detectors can always run without null-checks.
// ─────────────────────────────────────────────────────────────────────────────

import type { PageIntelligence }               from '../core/domain/entities/PageIntelligence';
import type { PageCapture }                    from '../core/domain/entities/PageCapture';
import type { PrioritizedFeature }             from '../core/domain/entities/PrioritizedFeature';
import type { BusinessValueEnrichmentResult }  from '../core/domain/entities/BusinessValueOutput';
import type { ApplicationGraph, GraphNode }    from '../discovery/graph/types';
import type { ScoringContext }                 from '../core/domain/entities/ReadinessResult';

// ─────────────────────────────────────────────────────────────────────────────
// URL matching helpers
// ─────────────────────────────────────────────────────────────────────────────

function normaliseUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`.toLowerCase().replace(/\/+$/, '');
  } catch {
    return url.toLowerCase().replace(/\/+$/, '');
  }
}

function findGraphNode(url: string, graph: ApplicationGraph): GraphNode | undefined {
  // 1. Exact URL match
  const exact = graph.nodes.find(n => n.url === url);
  if (exact) return exact;
  // 2. Normalised path match (strips trailing slash, lowercases)
  const normTarget = normaliseUrl(url);
  return graph.nodes.find(n => normaliseUrl(n.url) === normTarget);
}

// ─────────────────────────────────────────────────────────────────────────────
// ScoringContextBuilder
// ─────────────────────────────────────────────────────────────────────────────

export const ScoringContextBuilder = {
  /**
   * Build a ScoringContext for every PageIntelligence record.
   *
   * @param intelligence  All PageIntelligence records (base pages + in-page states).
   * @param features      All PrioritizedFeatures from FeatureRankingStage.
   * @param captures      All PageCaptures — provides URL, title, and DOM structure.
   * @param graph         ApplicationGraph — provides nodeType and pageDepth.
   * @param businessOutputs  Optional enrichment result from BusinessValueStage.
   */
  build(
    intelligence:    PageIntelligence[],
    features:        PrioritizedFeature[],
    captures:        PageCapture[],
    graph:           ApplicationGraph,
    businessOutputs?: BusinessValueEnrichmentResult,
  ): ScoringContext[] {
    // ── Index lookups ────────────────────────────────────────────────────────
    // Build a map from pageId → capture for O(1) lookup.
    const captureByPageId = new Map<string, PageCapture>(
      captures.map(c => [c.pageId, c]),
    );

    // Build a map from featureId → businessBenefits for O(1) lookup.
    const benefitsByFeatureId = new Map<string, string[]>();
    for (const o of businessOutputs?.outputs ?? []) {
      const texts: string[] = [];
      if (o.salesNarration) texts.push(o.salesNarration);
      if (o.businessBenefit) texts.push(o.businessBenefit);
      if (texts.length) benefitsByFeatureId.set(o.featureId, texts);
    }

    // ── Build one ScoringContext per intelligence record ─────────────────────
    return intelligence.map((intel): ScoringContext => {
      const capture = captureByPageId.get(intel.pageId);
      const url     = capture?.dom.url   ?? '';
      const title   = capture?.dom.title ?? '';

      // Graph lookup by URL
      const graphNode = url ? findGraphNode(url, graph) : undefined;

      // Prioritized features for this page
      const pageFeatures = features.filter(
        pf => pf.feature.pageIds.includes(intel.pageId),
      );
      const topFeatureComposite =
        pageFeatures.length > 0
          ? Math.max(...pageFeatures.map(pf => pf.composite))
          : 0;

      // Business benefits from enrichment outputs
      const featureIds = new Set(pageFeatures.map(pf => pf.feature.id));
      const businessBenefits: string[] = [];
      for (const id of featureIds) {
        const texts = benefitsByFeatureId.get(id);
        if (texts) businessBenefits.push(...texts);
      }

      return {
        // Identity
        pageId: intel.pageId,
        url,
        title,

        // Vision analysis
        pageCategory:           intel.pageCategory,
        pagePurpose:            intel.pagePurpose,
        overallImportanceScore: intel.overallImportanceScore,
        features:               intel.features,
        kpiWidgets:             intel.kpiWidgets,
        importantActions:       intel.importantActions,
        primaryElementBoundingBox: intel.primaryElementBoundingBox,

        // DOM structure
        formCount:   capture?.dom.formCount   ?? 0,
        inputCount:  capture?.dom.inputCount  ?? 0,
        buttonCount: capture?.dom.buttonCount ?? 0,
        headings:    capture?.dom.headings    ?? [],

        // Application graph
        nodeType:  graphNode?.type           ?? 'generic',
        pageDepth: graphNode?.metadata.depth ?? 0,

        // Feature ranking
        topFeatureComposite,
        pageFeatureCount: pageFeatures.length,

        // Business value
        businessBenefits,
      };
    });
  },
};
