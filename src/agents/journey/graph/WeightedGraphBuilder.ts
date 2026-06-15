import type { ApplicationGraph } from '../../../discovery/graph/types';
import type { PrioritizedFeature } from '../../../core/domain/entities/PrioritizedFeature';
import type { WeightedGraph, WeightedEdge } from './WeightedGraph';
import { NodeScorer } from './NodeScorer';
import { EdgeWeightCalculator } from './EdgeWeightCalculator';

let _edgeSeq = 0;

/**
 * Builds a WeightedGraph from the raw ApplicationGraph + prioritised features.
 *
 * Responsibilities:
 *  1. Build a reverse lookup: pageId → PrioritizedFeature[]
 *     (a feature may appear on multiple pages via its featureSignals.pageIds)
 *  2. Score every node with NodeScorer (demo value + top features)
 *  3. Calculate every edge cost with EdgeWeightCalculator
 *  4. Wire up adjacency lists (outEdges / inEdges)
 *  5. Detect the graph entry node
 */
export class WeightedGraphBuilder {
  constructor(
    private readonly nodeScorer: NodeScorer           = new NodeScorer(),
    private readonly edgeCalc:  EdgeWeightCalculator  = new EdgeWeightCalculator(),
  ) {}

  build(graph: ApplicationGraph, features: PrioritizedFeature[]): WeightedGraph {
    // ── 1. Reverse lookup: pageId → features ──────────────────────────────
    const pageFeatureMap = this.buildPageFeatureMap(features);

    // ── 2. Score nodes ────────────────────────────────────────────────────
    const nodes = new Map(
      graph.nodes.map(n => {
        const pageFeatures = pageFeatureMap.get(n.id) ?? [];
        return [
          n.id,
          {
            id:          n.id,
            url:         n.url,
            title:       n.title,
            nodeType:    n.type,
            demoScore:   this.nodeScorer.score(n, pageFeatures),
            featureIds:  pageFeatures.map(f => f.feature.id),
            topFeatures: this.nodeScorer.topFeatures(pageFeatures),
            depth:       n.metadata.depth,
          },
        ] as const;
      }),
    );

    // ── 3. Build adjacency lists with costs ───────────────────────────────
    const outEdges = new Map<string, WeightedEdge[]>();
    const inEdges  = new Map<string, WeightedEdge[]>();

    // Ensure every node has an entry (even if it has no edges)
    for (const nodeId of nodes.keys()) {
      outEdges.set(nodeId, []);
      inEdges.set(nodeId, []);
    }

    for (const e of graph.edges) {
      if (!nodes.has(e.source) || !nodes.has(e.target)) continue;

      const wEdge: WeightedEdge = {
        id:       e.id ?? `e_${++_edgeSeq}`,
        source:   e.source,
        target:   e.target,
        edgeType: e.type,
        cost:     this.edgeCalc.cost(e.type, e.metadata.confidence),
        label:    e.metadata.anchorText,
      };

      outEdges.get(e.source)!.push(wEdge);
      inEdges.get(e.target)!.push(wEdge);
    }

    // ── 4. Entry node ─────────────────────────────────────────────────────
    const entryNodeId = graph.meta.entryNodeId ?? this.inferEntry(nodes, inEdges);

    return { nodes, outEdges, inEdges, entryNodeId };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Build a pageId → PrioritizedFeature[] map.
   *
   * A feature's `featureSignals.pageIds` field lists every page it was found on.
   * If that field is absent we fall back to the feature's own `pageId` string.
   */
  private buildPageFeatureMap(
    features: PrioritizedFeature[],
  ): Map<string, PrioritizedFeature[]> {
    const map = new Map<string, PrioritizedFeature[]>();

    for (const pf of features) {
      const pageIds: string[] = pf.feature.pageIds ?? [];

      for (const pid of pageIds) {
        if (!map.has(pid)) map.set(pid, []);
        map.get(pid)!.push(pf);
      }
    }

    return map;
  }

  /**
   * Heuristic entry node: node with depth=0, or the one with the fewest
   * inbound edges and highest demo score.
   */
  private inferEntry(
    nodes:    Map<string, { depth: number; demoScore: number }>,
    inEdges:  Map<string, WeightedEdge[]>,
  ): string | null {
    let best: string | null = null;
    let bestPriority = -Infinity;

    for (const [id, node] of nodes) {
      const inCount = inEdges.get(id)?.length ?? 0;
      // depth=0 + no inbound edges is ideal entry; use negative inCount + score as tiebreak
      const priority = (node.depth === 0 ? 1000 : 0) + node.demoScore - inCount * 10;
      if (priority > bestPriority) {
        bestPriority = priority;
        best = id;
      }
    }

    return best;
  }
}
