import type { Feature } from './Feature';

export interface ScoringDimensions {
  /** How much business problem this feature solves. 0–100. */
  businessValue: number;
  /** How visually compelling this feature is for a demo video. 0–100. */
  visualAppeal: number;
  /** How central this feature is to the end-user's daily workflow. 0–100. */
  userImportance: number;
  /** Degree to which this feature drives or protects revenue. 0–100. */
  revenueImpact: number;
}

export interface PrioritizedFeature {
  feature: Feature;
  scores: ScoringDimensions;
  /** Weighted composite score. 0–100. */
  composite: number;
  /** 1-based rank in the prioritized list. */
  rank: number;
  /** Human-readable explanation of why this feature was ranked here. */
  rationale: string;
}
