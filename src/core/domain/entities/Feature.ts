export type FeatureCategory =
  | 'core'
  | 'workflow'
  | 'analytics'
  | 'reporting'
  | 'integration'
  | 'notification'
  | 'admin'
  | 'generic';

export type OutcomeType = 'revenue' | 'cost_saving' | 'efficiency' | 'risk';

export interface BusinessValue {
  headline: string;
  painSolved: string;
  beneficiary: string;
  outcomeType: OutcomeType;
  /** Free-text quantified metric, e.g. "reduces cycle time by 40%". */
  quantifiedImpact?: string;
}

/**
 * Signals aggregated by the FeatureClassificationAgent from the discovered pages
 * where this feature was observed. Used by the scoring engine; not derived from
 * the Feature entity itself.
 */
export interface FeatureSignals {
  /** Number of distinct pages where the feature was found. */
  pageCount: number;
  /** Sum of interactive elements across all pages where the feature appears. */
  interactiveElementCount: number;
  /** Charts, graphs, or data-visualisation components detected. */
  hasVisualizations: boolean;
  /** Real-time alerts, status badges, or notification indicators detected. */
  hasNotifications: boolean;
  /** Feature is part of at least one identified critical user flow. */
  isOnCriticalPath: boolean;
}

export interface Feature {
  id: string;
  name: string;
  summary: string;
  detailedDescription: string;
  category: FeatureCategory;
  businessValue: BusinessValue;
  signals: FeatureSignals;
  relatedFeatureIds: string[];
  pageIds: string[];
}
