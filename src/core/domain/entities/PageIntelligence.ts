export type PageCategory =
  | 'dashboard'
  | 'analytics'
  | 'form'
  | 'list'
  | 'detail'
  | 'workflow'
  | 'settings'
  | 'entry'
  | 'generic';

export type ImpactLevel = 'high' | 'medium' | 'low';
export type Trend = 'up' | 'down' | 'neutral' | 'unknown';
export type AnalysisMode = 'vision' | 'dom-only';

/** A single feature identified on the page. Matches the user-requested output shape. */
export interface VisualFeature {
  featureName: string;
  businessValue: string;
  importanceScore: number;     // 0–100
  recommendations: string[];   // demo-production tips
}

/** A user-actionable element worth highlighting in the demo. */
export interface ActionSignal {
  label: string;
  intent: string;
  impactLevel: ImpactLevel;
}

/** A metric, counter, chart, or status widget visible on the page. */
export interface KPIWidget {
  label: string;
  value: string;
  trend: Trend;
  unit?: string;
}

/**
 * Normalized bounding box of the primary demo-worthy element on this page.
 * All values are fractions of the visible viewport area, in [0, 1].
 * Populated only when a screenshot was available (analysisMode === 'vision').
 */
export interface PrimaryElementBox {
  /** Left edge of the element as a fraction of the viewport width. */
  x:      number;
  /** Top edge of the element as a fraction of the viewport height. */
  y:      number;
  /** Element width as a fraction of the viewport width. */
  width:  number;
  /** Element height as a fraction of the viewport height. */
  height: number;
}

export interface PageIntelligence {
  pageId: string;
  analysedAt: string;
  pagePurpose: string;
  pageCategory: PageCategory;
  features: VisualFeature[];
  importantActions: ActionSignal[];
  businessContext: string;
  kpiWidgets: KPIWidget[];
  /** Weighted aggregate of feature importanceScores. 0–100. */
  overallImportanceScore: number;
  /** 'vision' when a screenshot was available; 'dom-only' when falling back to HTML. */
  analysisMode: AnalysisMode;
  /**
   * Estimated bounding box of the single most demo-worthy element on this page.
   * Coordinates normalized to [0, 1] relative to the viewport.
   * undefined when the full page is the focus or the LLM could not reliably
   * estimate the position (e.g. dom-only mode, settings/generic pages).
   * Phase 3: consumed by RemotionExporter → SpotlightTarget → CameraChoreographer.
   */
  primaryElementBoundingBox?: PrimaryElementBox;
}
