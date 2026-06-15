import type { WeightedGraph, WeightedNode, WeightedEdge } from '../graph/WeightedGraph';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface BeamSearchOptions {
  beamWidth:    number;   // candidates kept per expansion round (default 8)
  minSteps:     number;   // minimum path length (default 4)
  maxSteps:     number;   // maximum path length (default 12)
  targetSteps:  number;   // ideal path length for length-fitness bonus (default 7)
  maxIterations: number;  // guard against infinite loops (default 500)
}

const DEFAULT_OPTIONS: BeamSearchOptions = {
  beamWidth:    8,
  minSteps:     4,
  maxSteps:     12,
  targetSteps:  7,
  maxIterations: 500,
};

export interface SearchPath {
  nodeIds:      string[];
  edges:        WeightedEdge[];
  score:        number;
  coveredFeatureIds: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Normalise a feature set into a flat deduplicated array. */
function unionFeatures(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b]));
}

/**
 * Score a candidate path for use as the beam ranking key.
 *
 * Four components:
 *  1. Feature novelty   — rewards visiting pages that add new feature IDs
 *  2. Node demo quality — average demoScore of visited nodes (0–100)
 *  3. Diversity bonus   — distinct node types visited
 *  4. Length fitness    — closeness of path length to targetSteps
 *  5. Edge cost penalty — average traversal cost (higher = worse)
 */
function scorePath(
  path:       CandidatePath,
  graph:      WeightedGraph,
  opts:       BeamSearchOptions,
): number {
  const nodes = path.nodeIds.map(id => graph.nodes.get(id)!).filter(Boolean);
  if (nodes.length === 0) return 0;

  // 1. Feature novelty: number of unique features / number of nodes
  const novelty = path.coveredFeatureIds.length / Math.max(1, nodes.length);

  // 2. Avg node demo score (normalised to 0–1)
  const avgDemo = nodes.reduce((s, n) => s + n.demoScore, 0) / nodes.length / 100;

  // 3. Diversity: distinct node types / 9 (total NodeType count)
  const types = new Set(nodes.map(n => n.nodeType));
  const diversity = types.size / 9;

  // 4. Length fitness: 1 at targetSteps, tapers off
  const lengthDiff = Math.abs(nodes.length - opts.targetSteps);
  const lengthFitness = Math.max(0, 1 - lengthDiff / opts.targetSteps);

  // 5. Edge cost: average cost; normalised to 0–1 (cost range 0–3)
  const edgeCost =
    path.edges.length > 0
      ? path.edges.reduce((s, e) => s + e.cost, 0) / path.edges.length / 3
      : 0;

  return (
    novelty       * 0.30 +
    avgDemo       * 0.30 +
    diversity     * 0.15 +
    lengthFitness * 0.15 -
    edgeCost      * 0.10
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal candidate (mutable during search)
// ─────────────────────────────────────────────────────────────────────────────

interface CandidatePath {
  nodeIds:           string[];
  edges:             WeightedEdge[];
  visitedNodeIds:    Set<string>;
  coveredFeatureIds: string[];
  score:             number;
}

function makeSeedPath(entryNode: WeightedNode): CandidatePath {
  return {
    nodeIds:           [entryNode.id],
    edges:             [],
    visitedNodeIds:    new Set([entryNode.id]),
    coveredFeatureIds: [...entryNode.featureIds],
    score:             0,
  };
}

function extendPath(
  path:  CandidatePath,
  edge:  WeightedEdge,
  node:  WeightedNode,
  graph: WeightedGraph,
  opts:  BeamSearchOptions,
): CandidatePath {
  const next: CandidatePath = {
    nodeIds:           [...path.nodeIds, node.id],
    edges:             [...path.edges, edge],
    visitedNodeIds:    new Set([...path.visitedNodeIds, node.id]),
    coveredFeatureIds: unionFeatures(path.coveredFeatureIds, node.featureIds),
    score:             0,
  };
  next.score = scorePath(next, graph, opts);
  return next;
}

// ─────────────────────────────────────────────────────────────────────────────
// BeamSearch
// ─────────────────────────────────────────────────────────────────────────────

export class BeamSearch {
  /**
   * Run beam search on the WeightedGraph to find the highest-scoring demo path.
   *
   * Returns the best complete path found, or the best partial path if no
   * path reaches minSteps within the iteration budget.
   */
  run(
    graph:       WeightedGraph,
    partialOpts: Partial<BeamSearchOptions> = {},
  ): SearchPath {
    const opts: BeamSearchOptions = { ...DEFAULT_OPTIONS, ...partialOpts };

    // ── Seed ──────────────────────────────────────────────────────────────
    const entryId = graph.entryNodeId;
    if (!entryId || !graph.nodes.has(entryId)) {
      return this.fallbackPath(graph, opts);
    }

    let beam: CandidatePath[] = [makeSeedPath(graph.nodes.get(entryId)!)];
    const completed: CandidatePath[] = [];
    let iterations = 0;

    // ── Expansion loop ────────────────────────────────────────────────────
    while (beam.length > 0 && iterations < opts.maxIterations) {
      iterations++;

      const nextBeam: CandidatePath[] = [];

      for (const candidate of beam) {
        const currentNodeId = candidate.nodeIds[candidate.nodeIds.length - 1];
        const outEdges = graph.outEdges.get(currentNodeId) ?? [];

        let expanded = false;

        for (const edge of outEdges) {
          if (candidate.visitedNodeIds.has(edge.target)) continue; // no cycles
          const targetNode = graph.nodes.get(edge.target);
          if (!targetNode) continue;

          expanded = true;
          const extended = extendPath(candidate, edge, targetNode, graph, opts);
          const pathLen = extended.nodeIds.length;

          if (pathLen >= opts.minSteps && pathLen <= opts.maxSteps) {
            completed.push(extended);
          }
          if (pathLen < opts.maxSteps) {
            nextBeam.push(extended);
          }
        }

        // Dead-end node: if long enough, harvest it
        if (!expanded && candidate.nodeIds.length >= opts.minSteps) {
          completed.push(candidate);
        }
      }

      // Keep the top-beamWidth candidates
      nextBeam.sort((a, b) => b.score - a.score);
      beam = nextBeam.slice(0, opts.beamWidth);
    }

    // ── Pick the winner ───────────────────────────────────────────────────
    const pool = completed.length > 0 ? completed : beam;
    if (pool.length === 0) return this.fallbackPath(graph, opts);

    pool.sort((a, b) => b.score - a.score);
    const winner = pool[0];

    return {
      nodeIds:           winner.nodeIds,
      edges:             winner.edges,
      score:             winner.score,
      coveredFeatureIds: winner.coveredFeatureIds,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Emergency fallback when the graph has no reachable entry node.
   * Returns the top-N nodes by demoScore in order.
   */
  private fallbackPath(graph: WeightedGraph, opts: BeamSearchOptions): SearchPath {
    const sorted = Array.from(graph.nodes.values()).sort(
      (a, b) => b.demoScore - a.demoScore,
    );
    const taken = sorted.slice(0, opts.targetSteps);
    return {
      nodeIds:           taken.map(n => n.id),
      edges:             [],
      score:             0,
      coveredFeatureIds: Array.from(new Set(taken.flatMap(n => n.featureIds))),
    };
  }
}
