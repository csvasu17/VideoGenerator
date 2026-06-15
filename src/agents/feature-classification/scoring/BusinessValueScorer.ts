import type { Feature, FeatureCategory, OutcomeType } from '../../../core/domain/entities/Feature';
import type { IScorer, ScoringDimension } from './IScorer';
import { clamp, keywordBonus } from './scoreUtils';

// Base score per category — how inherently valuable the category is to the business.
const CATEGORY_BASE: Record<FeatureCategory, number> = {
  core:         78,
  workflow:     70,
  analytics:    65,
  reporting:    62,
  integration:  52,
  notification: 48,
  admin:        28,
  generic:      42,
};

// Bonus for the type of outcome the feature delivers.
const OUTCOME_BONUS: Record<OutcomeType, number> = {
  revenue:      15,
  cost_saving:  12,
  efficiency:    8,
  risk:          4,
};

const BUSINESS_KEYWORDS: readonly string[] = [
  'roi', 'revenue', 'profit', 'cost', 'save', 'efficien',
  'automat', 'produc', 'compli', 'audit', 'growth', 'convert',
  'reduce', 'streamline', 'optimiz', 'competi',
];

/** Maximum bonus for having a concrete quantified impact statement. */
const QUANTIFIED_BONUS = 7;
/** Maximum keyword bonus. */
const KEYWORD_MAX = 10;

export class BusinessValueScorer implements IScorer {
  readonly dimension: ScoringDimension = 'businessValue';

  score(feature: Feature): number {
    const base = CATEGORY_BASE[feature.category];
    const outcomeMod = OUTCOME_BONUS[feature.businessValue.outcomeType];

    const textCorpus = [
      feature.summary,
      feature.detailedDescription,
      feature.businessValue.headline,
      feature.businessValue.painSolved,
    ].join(' ');

    const kwBonus = keywordBonus(textCorpus, BUSINESS_KEYWORDS, KEYWORD_MAX);
    const quantBonus = feature.businessValue.quantifiedImpact ? QUANTIFIED_BONUS : 0;

    return clamp(base + outcomeMod + kwBonus + quantBonus);
  }
}
