import type { Feature, FeatureCategory } from '../../../core/domain/entities/Feature';
import type { IScorer, ScoringDimension } from './IScorer';
import { clamp, logScore, linearScore } from './scoreUtils';

// Score bands must sum to exactly 100 to allow a perfect score.
const PAGE_COUNT_MAX      = 35;  // log scale — 10+ pages approaches this ceiling
const ELEMENT_MAX         = 20;  // linear — saturates at 50 interactive elements
const CRITICAL_PATH_BONUS = 25;  // feature sits on a known user flow
const CATEGORY_BONUS_MAX  = 20;  // category modifier (see table below)

// How user-facing each category is.
const CATEGORY_BONUS: Record<FeatureCategory, number> = {
  core:         20,
  workflow:     18,
  analytics:    12,
  reporting:    10,
  notification:  8,
  integration:   5,
  generic:       5,
  admin:         0,
};

const ELEMENT_SATURATION = 50;

export class UserImportanceScorer implements IScorer {
  readonly dimension: ScoringDimension = 'userImportance';

  score(feature: Feature): number {
    const pageScore    = logScore(feature.signals.pageCount, PAGE_COUNT_MAX);
    const elemScore    = linearScore(
      feature.signals.interactiveElementCount,
      ELEMENT_SATURATION,
      ELEMENT_MAX,
    );
    const critBonus    = feature.signals.isOnCriticalPath ? CRITICAL_PATH_BONUS : 0;
    const catBonus     = CATEGORY_BONUS[feature.category];

    return clamp(pageScore + elemScore + critBonus + catBonus);
  }
}
