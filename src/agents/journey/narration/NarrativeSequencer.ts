import type { SearchPath } from '../search/BeamSearch';
import type { WeightedGraph } from '../graph/WeightedGraph';
import type {
  JourneyStep,
  StepFeature,
  NarrativeArc,
  DemoJourney,
  JourneyMetrics,
} from '../../../core/domain/entities/DemoJourney';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Seconds per page for the demo video (adjustable per arc). */
const DURATION_BY_NODE_TYPE: Record<string, number> = {
  dashboard:  12,
  report:     10,
  list:        7,
  detail:      8,
  form:        9,
  modal:       5,
  settings:    5,
  entry:       4,
  generic:     6,
};

const OPENING_HOOKS: Record<NarrativeArc, string> = {
  'workflow-tour':     "Let's walk through the complete end-to-end workflow.",
  'value-progression': 'Watch how business value builds at every step.',
  'problem-solution':  'Here is the problem — and here is how the platform solves it.',
  'feature-showcase':  'Explore the key features that make this platform stand out.',
};

// ─────────────────────────────────────────────────────────────────────────────
// Narration cue templates
// ─────────────────────────────────────────────────────────────────────────────

function narrationCue(
  step:         number,
  total:        number,
  title:        string,
  nodeType:     string,
  features:     StepFeature[],
  arc:          NarrativeArc,
): string {
  const featureNames = features.slice(0, 3).map(f => f.featureName).join(', ');
  const isFirst  = step === 1;
  const isLast   = step === total;

  if (isFirst) {
    return `We start at ${title} — the ${nodeType} where ${featureNames || 'the journey begins'}.`;
  }
  if (isLast) {
    return `We wrap up at ${title}${featureNames ? `, spotlighting ${featureNames}` : ''}. That's the complete demo.`;
  }

  switch (arc) {
    case 'workflow-tour':
      return `Next up: ${title}. ${featureNames ? `Key actions here: ${featureNames}.` : ''}`;
    case 'value-progression':
      return `${title} ramps up the value. ${featureNames ? `Notice ${featureNames}.` : ''}`;
    case 'problem-solution':
      return step <= Math.ceil(total / 2)
        ? `${title} illustrates the challenge: ${featureNames || 'complexity ahead'}.`
        : `${title} resolves it: ${featureNames || 'the platform takes over'}.`;
    case 'feature-showcase':
    default:
      return `${title}: ${featureNames ? `focus on ${featureNames}.` : 'a key part of the platform.'}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NarrativeSequencer
// ─────────────────────────────────────────────────────────────────────────────

export class NarrativeSequencer {
  /**
   * Assemble a complete DemoJourney from a scored path + its metrics.
   */
  assemble(
    id:       string,
    path:     SearchPath,
    graph:    WeightedGraph,
    arc:      NarrativeArc,
    metrics:  JourneyMetrics,
  ): DemoJourney {
    const steps = this.buildSteps(path, graph, arc);
    const totalDuration = steps.reduce((s, st) => s + st.estimatedDurationSec, 0);

    return {
      id,
      title:                this.titleFromArc(arc),
      openingHook:          OPENING_HOOKS[arc],
      steps,
      totalSteps:           steps.length,
      estimatedDurationSec: totalDuration,
      coveredFeatureIds:    path.coveredFeatureIds,
      metrics,
      narrativeArc:         arc,
      generatedAt:          new Date().toISOString(),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private
  // ──────────────────────────────────────────────────────────────────────────

  private buildSteps(
    path:  SearchPath,
    graph: WeightedGraph,
    arc:   NarrativeArc,
  ): JourneyStep[] {
    const total = path.nodeIds.length;
    return path.nodeIds.map((nodeId, idx) => {
      const node = graph.nodes.get(nodeId)!;
      const stepNumber = idx + 1;

      const features: StepFeature[] = node.topFeatures.map(tf => ({
        featureId:       tf.id,
        featureName:     tf.name,
        importanceScore: tf.compositeScore,
        businessValue:   tf.businessValue,
      }));

      // The edge that leads OUT of this step (to next step)
      const transitionEdge = path.edges[idx]; // edge[i] goes from node[i] → node[i+1]

      return {
        stepNumber,
        pageId:              node.id,
        pageTitle:           node.title,
        url:                 node.url,
        nodeType:            node.nodeType,
        features,
        narrationCue:        narrationCue(stepNumber, total, node.title, node.nodeType, features, arc),
        transitionLabel:     transitionEdge?.label,
        estimatedDurationSec: DURATION_BY_NODE_TYPE[node.nodeType] ?? 6,
      };
    });
  }

  private titleFromArc(arc: NarrativeArc): string {
    switch (arc) {
      case 'workflow-tour':     return 'End-to-End Workflow Demo';
      case 'value-progression': return 'Business Value Progression';
      case 'problem-solution':  return 'Problem → Solution Showcase';
      case 'feature-showcase':  return 'Feature Highlights Demo';
    }
  }
}
