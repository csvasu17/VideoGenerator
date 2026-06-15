import type { Feature } from '../../../core/domain/entities/Feature';
import type { ScoringDimensions } from '../../../core/domain/entities/PrioritizedFeature';

export type ScoringDimension = keyof ScoringDimensions;

export interface IScorer {
  readonly dimension: ScoringDimension;
  /**
   * Score a single feature on this dimension.
   * Must return a value in the range [0, 100].
   */
  score(feature: Feature): number;
}

export interface ScoringWeights {
  businessValue: number;
  visualAppeal: number;
  userImportance: number;
  revenueImpact: number;
}

export const DEFAULT_WEIGHTS: Readonly<ScoringWeights> = {
  businessValue: 0.35,
  visualAppeal: 0.20,
  userImportance: 0.25,
  revenueImpact: 0.20,
};
