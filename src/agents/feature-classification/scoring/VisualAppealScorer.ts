import type { Feature, FeatureCategory } from '../../../core/domain/entities/Feature';
import type { IScorer, ScoringDimension } from './IScorer';
import { clamp, logScore, linearScore } from './scoreUtils';

// Base visual score by category — reflects how visually rich that class of feature
// typically is (dashboards/analytics rank high; admin/settings rank low).
const CATEGORY_VISUAL_BASE: Record<FeatureCategory, number> = {
  analytics:    85,
  reporting:    82,
  core:         72,
  workflow:     68,
  notification: 60,
  integration:  48,
  generic:      52,
  admin:        32,
};

const VISUALIZATION_BONUS = 12;   // charts, graphs, data-vis present
const NOTIFICATION_BONUS   =  8;  // live alerts / status badges present
const PAGE_COUNT_MAX       =  8;  // bonus for appearing across many pages
const ELEMENT_RICHNESS_MAX =  5;  // bonus for dense interactive content

// Saturation threshold: pages with 30+ interactive elements count as "rich".
const ELEMENT_SATURATION = 30;

export class VisualAppealScorer implements IScorer {
  readonly dimension: ScoringDimension = 'visualAppeal';

  score(feature: Feature): number {
    const base = CATEGORY_VISUAL_BASE[feature.category];
    const vizBonus  = feature.signals.hasVisualizations ? VISUALIZATION_BONUS : 0;
    const notifBonus = feature.signals.hasNotifications  ? NOTIFICATION_BONUS  : 0;
    const pageBonus  = logScore(feature.signals.pageCount, PAGE_COUNT_MAX);
    const elemBonus  = linearScore(
      feature.signals.interactiveElementCount,
      ELEMENT_SATURATION,
      ELEMENT_RICHNESS_MAX,
    );

    return clamp(base + vizBonus + notifBonus + pageBonus + elemBonus);
  }
}
