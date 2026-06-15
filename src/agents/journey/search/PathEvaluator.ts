import type { WeightedGraph } from '../graph/WeightedGraph';
import type { SearchPath } from './BeamSearch';
import type { JourneyMetrics, NarrativeArc } from '../../../core/domain/entities/DemoJourney';
import type { PrioritizedFeature } from '../../../core/domain/entities/PrioritizedFeature';

const TOP_FEATURES_COUNT = 10;

/**
 * Derives quality metrics and narrative arc classification from a beam-search
 * result path.  All values are deterministic given the same inputs.
 */
export class PathEvaluator {
  /**
   * Compute JourneyMetrics for a completed SearchPath.
   */
  metrics(
    path:         SearchPath,
    graph:        WeightedGraph,
    allFeatures:  PrioritizedFeature[],
  ): JourneyMetrics {
    // Feature coverage ratio
    const totalFeatureIds = new Set(
      Array.from(graph.nodes.values()).flatMap(n => n.featureIds),
    );
    const featureCoverageRatio =
      totalFeatureIds.size === 0
        ? 0
        : path.coveredFeatureIds.length / totalFeatureIds.size;

    // Average transition cost (normalised 0–1)
    const avgTransitionCost =
      path.edges.length === 0
        ? 0
        : path.edges.reduce((s, e) => s + e.cost, 0) / path.edges.length / 3;

    // Unique node types
    const types = new Set(
      path.nodeIds
        .map(id => graph.nodes.get(id)?.nodeType)
        .filter(Boolean),
    );
    const uniqueNodeTypes = types.size;

    // Top-10 features hit
    const top10Ids = new Set(
      allFeatures
        .sort((a, b) => b.composite - a.composite)
        .slice(0, TOP_FEATURES_COUNT)
        .map(f => f.feature.id),
    );
    const coveredSet = new Set(path.coveredFeatureIds);
    const topFeaturesHit = [...top10Ids].filter(id => coveredSet.has(id)).length;

    return {
      featureCoverageRatio: Math.round(featureCoverageRatio * 1000) / 1000,
      avgTransitionCost:    Math.round(avgTransitionCost * 1000) / 1000,
      uniqueNodeTypes,
      topFeaturesHit,
      pathScore:            Math.round(path.score * 1000) / 1000,
    };
  }

  /**
   * Classify the narrative arc based on path structure.
   *
   * Heuristic rules (first match wins):
   *  workflow-tour      — ≥ 50 % of transitions are workflow-sequence edges
   *  value-progression  — node demoScores rise monotonically (net upward trend ≥ 60 %)
   *  problem-solution   — path starts on a form/detail page and ends on a report/dashboard
   *  feature-showcase   — fallback (highest variety of node types)
   */
  narrativeArc(path: SearchPath, graph: WeightedGraph): NarrativeArc {
    if (path.edges.length === 0) return 'feature-showcase';

    // workflow-tour
    const workflowEdges = path.edges.filter(e => e.edgeType === 'workflow-sequence').length;
    if (workflowEdges / path.edges.length >= 0.5) return 'workflow-tour';

    // value-progression: count consecutive rising demoScore pairs
    const scores = path.nodeIds.map(id => graph.nodes.get(id)?.demoScore ?? 0);
    const rises = scores.slice(1).filter((s, i) => s >= scores[i]).length;
    if (rises / (scores.length - 1) >= 0.6) return 'value-progression';

    // problem-solution
    const firstNode = graph.nodes.get(path.nodeIds[0]);
    const lastNode  = graph.nodes.get(path.nodeIds[path.nodeIds.length - 1]);
    if (
      firstNode && lastNode &&
      ['form', 'detail', 'list'].includes(firstNode.nodeType) &&
      ['dashboard', 'report'].includes(lastNode.nodeType)
    ) {
      return 'problem-solution';
    }

    return 'feature-showcase';
  }
}
