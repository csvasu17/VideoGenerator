// ─────────────────────────────────────────────────────────────────────────────
// User Journey Generator — public barrel
// ─────────────────────────────────────────────────────────────────────────────

// Main agent
export { JourneyGenerator } from './JourneyGenerator';

// Graph layer
export { WeightedGraphBuilder } from './graph/WeightedGraphBuilder';
export { NodeScorer }           from './graph/NodeScorer';
export { EdgeWeightCalculator } from './graph/EdgeWeightCalculator';
export type {
  WeightedGraph,
  WeightedNode,
  WeightedEdge,
  TopFeature,
} from './graph/WeightedGraph';

// Search layer
export { BeamSearch }    from './search/BeamSearch';
export { PathEvaluator } from './search/PathEvaluator';
export type {
  BeamSearchOptions,
  SearchPath,
} from './search/BeamSearch';

// Narration layer
export { NarrativeSequencer } from './narration/NarrativeSequencer';

// ─────────────────────────────────────────────────────────────────────────────
// Convenience factory
// ─────────────────────────────────────────────────────────────────────────────

import { JourneyGenerator } from './JourneyGenerator';
import { WeightedGraphBuilder } from './graph/WeightedGraphBuilder';
import { NodeScorer } from './graph/NodeScorer';
import { EdgeWeightCalculator } from './graph/EdgeWeightCalculator';
import { BeamSearch } from './search/BeamSearch';
import { PathEvaluator } from './search/PathEvaluator';
import { NarrativeSequencer } from './narration/NarrativeSequencer';

/**
 * Creates a fully-wired JourneyGenerator with default implementations.
 * Replace any dependency via the constructor to customise scoring weights
 * or swap the search algorithm.
 */
export function createJourneyGenerator(): JourneyGenerator {
  return new JourneyGenerator(
    new WeightedGraphBuilder(new NodeScorer(), new EdgeWeightCalculator()),
    new BeamSearch(),
    new PathEvaluator(),
    new NarrativeSequencer(),
  );
}
