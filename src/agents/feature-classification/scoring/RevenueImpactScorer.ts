import type { Feature, FeatureCategory, OutcomeType } from '../../../core/domain/entities/Feature';
import type { IScorer, ScoringDimension } from './IScorer';
import { clamp, keywordBonus } from './scoreUtils';

// Base revenue score driven primarily by the declared outcome type.
const OUTCOME_BASE: Record<OutcomeType, number> = {
  revenue:      82,
  cost_saving:  72,
  efficiency:   58,
  risk:         42,
};

// Category modifier — core and workflow features drive more direct business impact.
const CATEGORY_BONUS: Record<FeatureCategory, number> = {
  core:          8,
  workflow:      6,
  analytics:     5,
  reporting:     4,
  integration:   3,
  notification:  2,
  generic:       1,
  admin:         0,
};

const REVENUE_KEYWORDS: readonly string[] = [
  'revenue', 'profit', 'growth', 'convert', 'upsell', 'sale',
  'customer', 'retention', 'churn', 'arr', 'mrr', 'ltv',
  'cost', 'save', 'reduce', 'spend', 'budget', 'roi',
  'return on investment', 'payback',
];

const KEYWORD_MAX    = 12;
const QUANTIFIED_BONUS = 6;

export class RevenueImpactScorer implements IScorer {
  readonly dimension: ScoringDimension = 'revenueImpact';

  score(feature: Feature): number {
    const base = OUTCOME_BASE[feature.businessValue.outcomeType];

    const textCorpus = [
      feature.summary,
      feature.detailedDescription,
      feature.businessValue.headline,
      feature.businessValue.painSolved,
    ].join(' ');

    const kwBonus    = keywordBonus(textCorpus, REVENUE_KEYWORDS, KEYWORD_MAX);
    const quantBonus = feature.businessValue.quantifiedImpact ? QUANTIFIED_BONUS : 0;
    const catBonus   = CATEGORY_BONUS[feature.category];

    return clamp(base + kwBonus + quantBonus + catBonus);
  }
}
