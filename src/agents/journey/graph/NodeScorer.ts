import type { GraphNode, NodeType } from '../../../discovery/graph/types';
import type { PrioritizedFeature } from '../../../core/domain/entities/PrioritizedFeature';
import type { TopFeature } from './WeightedGraph';

/**
 * How intrinsically demo-worthy each node type is.
 * Dashboards / analytics are visually compelling; settings / entry pages are not.
 */
const NODE_TYPE_DEMO_VALUE: Record<NodeType, number> = {
  dashboard:  90,
  report:     82,
  list:       65,
  detail:     70,
  form:       58,
  modal:      50,
  entry:      30,
  settings:   18,
  generic:    45,
};

const MAX_TOP_FEATURES = 5;

export class NodeScorer {
  /**
   * Compute the demo score for a page node given the features present on it.
   * Returns a value in [0, 100].
   */
  score(node: GraphNode, pageFeatures: PrioritizedFeature[]): number {
    const typeValue = NODE_TYPE_DEMO_VALUE[node.type] ?? 45;

    if (pageFeatures.length === 0) {
      return Math.round(typeValue * 0.4); // low score — no features to demo
    }

    const scores = pageFeatures.map(f => f.composite);
    const avgScore = scores.reduce((s, v) => s + v, 0) / scores.length;
    const maxScore = Math.max(...scores);

    // Blend average + max so pages with one stellar feature still rank high.
    const featureScore = avgScore * 0.6 + maxScore * 0.4;

    return Math.round(featureScore * 0.7 + typeValue * 0.3);
  }

  /** Extract the top features for this node for downstream narration. */
  topFeatures(pageFeatures: PrioritizedFeature[]): TopFeature[] {
    return pageFeatures
      .sort((a, b) => b.composite - a.composite)
      .slice(0, MAX_TOP_FEATURES)
      .map(f => ({
        id:             f.feature.id,
        name:           f.feature.name,
        compositeScore: f.composite,
        businessValue:  f.feature.businessValue.headline,
      }));
  }
}
