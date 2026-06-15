import type { EdgeType } from '../../../discovery/graph/types';

/**
 * Maps each EdgeType to a transition cost for beam-search path finding.
 *
 * Lower cost = more natural, less jarring for a demo viewer.
 *   workflow-sequence — the designer explicitly labelled it a sequential step
 *   parent-child      — drilling into a child from its parent is intuitive
 *   navigation        — a regular link; slightly higher cognitive jump
 *   redirect          — usually a technical artefact; highest cost
 */
const EDGE_TYPE_COST: Record<EdgeType, number> = {
  'workflow-sequence': 0.5,
  'parent-child':      1.0,
  'navigation':        1.5,
  'redirect':          2.5,
};

const MIN_COST = 0.1;
const MAX_COST = 3.0;

export class EdgeWeightCalculator {
  /**
   * Return the traversal cost for an edge.
   * Confidence ∈ (0, 1] from the original GraphEdge is used as a minor
   * discount: high-confidence edges cost slightly less than low-confidence ones.
   */
  cost(edgeType: EdgeType, confidence: number = 1): number {
    const base = EDGE_TYPE_COST[edgeType] ?? 1.5;
    const clampedConf = Math.max(0.1, Math.min(1, confidence));
    // discount up to 20 % for high-confidence edges
    const discounted = base * (1 - 0.2 * (clampedConf - 0.1) / 0.9);
    return Math.max(MIN_COST, Math.min(MAX_COST, discounted));
  }

  /**
   * Given a node's outbound edge costs, return the average transition quality
   * as a normalised value ∈ [0, 1] (0 = very cheap / natural).
   */
  avgCostNormalised(costs: number[]): number {
    if (costs.length === 0) return 0;
    const avg = costs.reduce((s, c) => s + c, 0) / costs.length;
    return avg / MAX_COST;
  }
}
