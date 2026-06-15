import { randomUUID } from 'crypto';
import type { IJourneyGeneratorAgent, JourneyGeneratorOptions } from '../../core/ports/agents/IJourneyGeneratorAgent';
import type { ApplicationGraph } from '../../discovery/graph/types';
import type { PrioritizedFeature } from '../../core/domain/entities/PrioritizedFeature';
import type { DemoJourney } from '../../core/domain/entities/DemoJourney';
import { WeightedGraphBuilder } from './graph/WeightedGraphBuilder';
import { BeamSearch } from './search/BeamSearch';
import { PathEvaluator } from './search/PathEvaluator';
import { NarrativeSequencer } from './narration/NarrativeSequencer';
import { NodeScorer } from './graph/NodeScorer';
import { EdgeWeightCalculator } from './graph/EdgeWeightCalculator';

const DEFAULTS: Required<JourneyGeneratorOptions> = {
  targetSteps:  7,
  minSteps:     4,
  maxSteps:     12,
  beamWidth:    8,
};

/**
 * Main orchestrator for the User Journey Generator.
 *
 * Pipeline:
 *  1. WeightedGraphBuilder  — score nodes + weight edges
 *  2. BeamSearch            — find optimal demo path
 *  3. PathEvaluator         — compute metrics + classify narrative arc
 *  4. NarrativeSequencer    — assemble JourneySteps with narration cues
 *
 * Implements IJourneyGeneratorAgent (never throws; returns a well-formed
 * DemoJourney even for degenerate / empty inputs).
 */
export class JourneyGenerator implements IJourneyGeneratorAgent {
  constructor(
    private readonly graphBuilder:  WeightedGraphBuilder  = new WeightedGraphBuilder(new NodeScorer(), new EdgeWeightCalculator()),
    private readonly beamSearch:    BeamSearch             = new BeamSearch(),
    private readonly pathEvaluator: PathEvaluator          = new PathEvaluator(),
    private readonly sequencer:     NarrativeSequencer     = new NarrativeSequencer(),
  ) {}

  generate(
    graph:    ApplicationGraph,
    features: PrioritizedFeature[],
    options:  JourneyGeneratorOptions = {},
  ): DemoJourney {
    const opts: Required<JourneyGeneratorOptions> = { ...DEFAULTS, ...options };

    // ── Guard: empty graph ────────────────────────────────────────────────
    if (graph.nodes.length === 0) {
      return this.emptyJourney();
    }

    // ── 1. Build weighted graph ───────────────────────────────────────────
    const wGraph = this.graphBuilder.build(graph, features);

    // ── 2. Beam search ────────────────────────────────────────────────────
    let path = this.beamSearch.run(wGraph, {
      beamWidth:    opts.beamWidth,
      minSteps:     opts.minSteps,
      maxSteps:     opts.maxSteps,
      targetSteps:  opts.targetSteps,
      maxIterations: 500,
    });

    // ── 2b. Top-N supplement — ensure we reach targetSteps ────────────────
    // When BeamSearch finds fewer steps than targetSteps (common for flat SPAs
    // where all pages share the same parent and have few cross-page edges),
    // fill remaining slots with the highest-scoring unvisited nodes.
    // This guarantees a comprehensive demo even on sparse application graphs.
    if (path.nodeIds.length < opts.targetSteps) {
      const visitedIds = new Set(path.nodeIds);
      const extras = Array.from(wGraph.nodes.values())
        .filter(n => !visitedIds.has(n.id))
        .sort((a, b) => b.demoScore - a.demoScore)
        .slice(0, opts.targetSteps - path.nodeIds.length);

      if (extras.length > 0) {
        path = {
          nodeIds:           [...path.nodeIds, ...extras.map(n => n.id)],
          edges:             path.edges,   // no new real edges — supplemented nodes are "jumps"
          score:             path.score,
          coveredFeatureIds: Array.from(new Set([
            ...path.coveredFeatureIds,
            ...extras.flatMap(n => n.featureIds),
          ])),
        };
      }
    }

    // ── 3. Evaluate ───────────────────────────────────────────────────────
    const metrics = this.pathEvaluator.metrics(path, wGraph, features);
    const arc     = this.pathEvaluator.narrativeArc(path, wGraph);

    // ── 4. Assemble ───────────────────────────────────────────────────────
    return this.sequencer.assemble(
      randomUUID(),
      path,
      wGraph,
      arc,
      metrics,
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────────

  private emptyJourney(): DemoJourney {
    return {
      id:                   randomUUID(),
      title:                'Empty Demo Journey',
      openingHook:          'No pages were discovered.',
      steps:                [],
      totalSteps:           0,
      estimatedDurationSec: 0,
      coveredFeatureIds:    [],
      narrativeArc:         'feature-showcase',
      generatedAt:          new Date().toISOString(),
      metrics: {
        featureCoverageRatio: 0,
        avgTransitionCost:    0,
        uniqueNodeTypes:      0,
        topFeaturesHit:       0,
        pathScore:            0,
      },
    };
  }
}
