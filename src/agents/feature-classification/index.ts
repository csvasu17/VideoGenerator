export { FeaturePrioritizationEngine } from './FeaturePrioritizationEngine';
export { BusinessValueScorer } from './scoring/BusinessValueScorer';
export { VisualAppealScorer } from './scoring/VisualAppealScorer';
export { UserImportanceScorer } from './scoring/UserImportanceScorer';
export { RevenueImpactScorer } from './scoring/RevenueImpactScorer';
export { DEFAULT_WEIGHTS } from './scoring/IScorer';

export type { PrioritizationOptions } from './FeaturePrioritizationEngine';
export type { IScorer, ScoringDimension, ScoringWeights } from './scoring/IScorer';

import { FeaturePrioritizationEngine } from './FeaturePrioritizationEngine';
import { BusinessValueScorer } from './scoring/BusinessValueScorer';
import { VisualAppealScorer } from './scoring/VisualAppealScorer';
import { UserImportanceScorer } from './scoring/UserImportanceScorer';
import { RevenueImpactScorer } from './scoring/RevenueImpactScorer';
import { DEFAULT_WEIGHTS } from './scoring/IScorer';
import type { ScoringWeights } from './scoring/IScorer';

/** Convenience factory — wire into your DI container or use directly. */
export function createFeaturePrioritizationEngine(
  weights: Partial<ScoringWeights> = {},
): FeaturePrioritizationEngine {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const sum = w.businessValue + w.visualAppeal + w.userImportance + w.revenueImpact;
  const normalised: ScoringWeights = {
    businessValue:  w.businessValue  / sum,
    visualAppeal:   w.visualAppeal   / sum,
    userImportance: w.userImportance / sum,
    revenueImpact:  w.revenueImpact  / sum,
  };
  return new FeaturePrioritizationEngine(
    [
      new BusinessValueScorer(),
      new VisualAppealScorer(),
      new UserImportanceScorer(),
      new RevenueImpactScorer(),
    ],
    normalised,
  );
}
