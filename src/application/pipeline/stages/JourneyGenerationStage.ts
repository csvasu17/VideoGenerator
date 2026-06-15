import { randomUUID } from 'crypto';
import type { PipelineStage } from '../PipelineStage';
import type { PipelineContext } from '../PipelineContext';
import type { ApplicationGraph } from '../../../discovery/graph/types';
import type { PrioritizedFeature } from '../../../core/domain/entities/PrioritizedFeature';
import type { DemoJourney, NarrativeArc } from '../../../core/domain/entities/DemoJourney';
import type { StoryArc, ArcType } from '../../../core/domain/entities/SalesStory';
import { createJourneyGenerator } from '../../../agents/journey';

export interface JourneyGenerationInput {
  graph:        ApplicationGraph;
  features:     PrioritizedFeature[];
  targetSteps?: number;
  /**
   * Phase 8: when present, bypasses beam-search graph traversal and builds
   * DemoJourney directly from the ordered SceneGoal sequence.
   * Backward-compatible: absent = existing beam-search behaviour unchanged.
   */
  storyArc?:    StoryArc;
}

// ── ArcType → NarrativeArc mapping ──────────────────────────────────────────

const ARC_TYPE_TO_NARRATIVE: Record<ArcType, NarrativeArc> = {
  reactive_to_predictive: 'problem-solution',
  visibility_to_control:  'workflow-tour',
  data_to_decisions:      'value-progression',
  risk_to_resilience:     'problem-solution',
};

// ─────────────────────────────────────────────────────────────────────────────

export class JourneyGenerationStage
  implements PipelineStage<JourneyGenerationInput, DemoJourney>
{
  readonly name = 'Journey Generation';

  async run(input: JourneyGenerationInput, ctx: PipelineContext): Promise<DemoJourney> {
    // ── Phase 8: StoryArc bypass ─────────────────────────────────────────────
    // When a StoryArc is present, construct DemoJourney directly from the
    // ordered SceneGoal sequence.  This replaces beam-search graph traversal
    // entirely — the arc already encodes the optimal scene order.
    if (input.storyArc && input.storyArc.scenes.length > 0) {
      return this.buildFromStoryArc(input.storyArc, input.graph, ctx);
    }

    // ── Default: beam-search journey generation ──────────────────────────────
    const generator = createJourneyGenerator();
    return generator.generate(input.graph, input.features, {
      targetSteps: input.targetSteps ?? 7,
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private: build DemoJourney from StoryArc
  // ──────────────────────────────────────────────────────────────────────────

  private buildFromStoryArc(
    arc:   StoryArc,
    graph: ApplicationGraph,
    ctx:   PipelineContext,
  ): DemoJourney {
    // Build lookup maps for URL + title resolution
    const readinessByPageId = new Map(
      (ctx.readinessResults ?? []).map(r => [r.pageId, r]),
    );
    const graphNodeByUrl = new Map(
      graph.nodes.map(n => [n.url, n]),
    );

    const steps = arc.scenes.map((sceneGoal, index) => {
      const rr         = readinessByPageId.get(sceneGoal.pageId);
      const url        = rr?.url ?? '';
      const pageTitle  = rr?.title ?? sceneGoal.feature;
      const graphNode  = graphNodeByUrl.get(url);
      const nodeType   = graphNode?.type ?? 'generic';

      return {
        stepNumber:           index + 1,
        pageId:               sceneGoal.pageId,
        pageTitle,
        url,
        nodeType,
        features: [
          {
            featureId:      sceneGoal.businessOutcome.featureId,
            featureName:    sceneGoal.feature,
            importanceScore: Math.round(sceneGoal.storyPriority * 100),
            businessValue:  sceneGoal.businessOutcome.impactStatement ||
                            sceneGoal.callout,
          },
        ],
        narrationCue:          sceneGoal.narrativeHook || sceneGoal.callout,
        transitionLabel:       undefined,
        estimatedDurationSec:  sceneGoal.minDurationSec,
      };
    });

    const totalDurationSec = steps.reduce(
      (sum, s) => sum + s.estimatedDurationSec, 0,
    );

    const coveredFeatureIds = [
      ...new Set(steps.flatMap(s => s.features.map(f => f.featureId))),
    ];

    const narrativeArc: NarrativeArc =
      ARC_TYPE_TO_NARRATIVE[arc.arcType] ?? 'problem-solution';

    return {
      id:                 randomUUID(),
      title:              arc.title,
      openingHook:        arc.openingHook || arc.premise,
      steps,
      totalSteps:         steps.length,
      estimatedDurationSec: totalDurationSec,
      coveredFeatureIds,
      metrics: {
        featureCoverageRatio: coveredFeatureIds.length > 0 ? 1.0 : 0,
        avgTransitionCost:    0,
        uniqueNodeTypes:      new Set(steps.map(s => s.nodeType)).size,
        topFeaturesHit:       Math.min(coveredFeatureIds.length, 10),
        pathScore:            arc.validationSummary.overallScore,
      },
      narrativeArc,
      generatedAt: new Date().toISOString(),
    };
  }
}
