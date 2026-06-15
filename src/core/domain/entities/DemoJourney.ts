export type NarrativeArc =
  | 'workflow-tour'      // Follows the natural user flow end-to-end
  | 'value-progression'  // Builds from low to peak business value
  | 'problem-solution'   // Opens with a pain point, ends with resolution
  | 'feature-showcase';  // Highlights top features in priority order

export interface StepFeature {
  featureId: string;
  featureName: string;
  importanceScore: number;
  businessValue: string;
}

export interface JourneyStep {
  stepNumber: number;
  pageId: string;
  pageTitle: string;
  url: string;
  nodeType: string;
  /** Features to highlight while on this page. */
  features: StepFeature[];
  /** Script cue for a presenter or narration overlay. */
  narrationCue: string;
  /** Label of the action / link that moves to the NEXT step. */
  transitionLabel?: string;
  /** Seconds to spend on this step in the demo video. */
  estimatedDurationSec: number;
}

export interface JourneyMetrics {
  /** Fraction of all features covered (0–1). */
  featureCoverageRatio: number;
  /** Average edge naturalness (0 best → 1 worst). */
  avgTransitionCost: number;
  /** Number of distinct page types visited. */
  uniqueNodeTypes: number;
  /** How many of the top-10 features by score are included. */
  topFeaturesHit: number;
  /** Raw beam-search optimisation score. */
  pathScore: number;
}

export interface DemoJourney {
  id: string;
  title: string;
  /** Opening sentence used as a demo hook / video tagline. */
  openingHook: string;
  steps: JourneyStep[];
  totalSteps: number;
  estimatedDurationSec: number;
  coveredFeatureIds: string[];
  metrics: JourneyMetrics;
  narrativeArc: NarrativeArc;
  generatedAt: string;
}
