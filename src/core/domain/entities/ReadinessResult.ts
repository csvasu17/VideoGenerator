// ─────────────────────────────────────────────────────────────────────────────
// ReadinessResult — domain entity for Demo Readiness Scoring
//
// Produced by DemoReadinessStage for each PageIntelligence record.
// Carries the scored verdict, all contributing signals, and a DemoValueTier
// so downstream stages can reason about page quality without re-running the
// detector pipeline.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  PageCategory,
  VisualFeature,
  ActionSignal,
  KPIWidget,
  PrimaryElementBox,
} from './PageIntelligence';
import type { NodeType } from '../../../discovery/graph/types';

// ─────────────────────────────────────────────────────────────────────────────
// Signal taxonomy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every ReadinessSignal belongs to one of these types.
 *
 * Negative types (weight < 0) — detected low-value patterns.
 * Positive types (weight > 0) — detected high-demo-value patterns.
 * demo_value_tier — can be positive (tier 1–3) depending on weight.
 */
export type SignalType =
  // ── Negative ──────────────────────────────────────────────────────────────
  | 'auth_screen'
  | 'empty_state'
  | 'settings_screen'
  | 'placeholder_content'
  | 'duplicate_screen'
  | 'error_screen'
  | 'navigation_only'
  // ── Positive ──────────────────────────────────────────────────────────────
  | 'kpi_dashboard'
  | 'analytics_chart'
  | 'ai_insight'
  | 'active_workflow'
  | 'simulation'
  | 'alert_feed'
  | 'business_outcome'
  | 'feature_density'
  | 'top_feature_priority'
  /** Tier-based reward.  Weight encodes the tier (+0.30 T1, +0.20 T2, +0.05 T3). */
  | 'demo_value_tier';

/** Primary evidence source that produced the signal. */
export type SignalSource =
  | 'url'
  | 'title'
  | 'element_type'
  | 'feature_label'
  | 'graph'
  | 'ranking'
  | 'cross_page'
  | 'dom';

/**
 * A single evidence unit contributing to readinessScore.
 *
 *   net contribution = weight × confidence
 *   readinessScore   = clamp(BASE_SCORE + Σ contributions, 0, 1)
 */
export interface ReadinessSignal {
  type:       SignalType;
  /** Net scoring contribution.  Range [-1.0, +1.0]. */
  weight:     number;
  /** Certainty of the detection.  Range [0.0, 1.0]. */
  confidence: number;
  /** Human-readable evidence: e.g. "URL segment '/login' matched auth pattern". */
  evidence:   string;
  source:     SignalSource;
}

// ─────────────────────────────────────────────────────────────────────────────
// Demo Value Tier
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sales-demo impact classification — how compelling this screen is on the
 * demo floor, independent of BusinessValueTier.
 *
 *   tier1   — AI Insights, Predictive Analytics, Digital Twin, Simulator,
 *             Advanced Analytics
 *   tier2   — KPI Dashboards, Alerts, Device Health, Operational Monitoring
 *   tier3   — Sites, Users, Asset Lists, Inventory Views
 *   tier4   — Settings, Preferences, Administration, Configuration
 *   unknown — Could not be determined from available signals
 */
export type DemoValueTier = 'tier1' | 'tier2' | 'tier3' | 'tier4' | 'unknown';

// ─────────────────────────────────────────────────────────────────────────────
// Verdict and category
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gate outcome.
 *
 *   pass       — readinessScore ≥ threshold (default 0.40)
 *   borderline — readinessScore < threshold but ≥ 0.25 (eligible for promotion)
 *   reject     — readinessScore < 0.25 or hard-reject rule fired
 */
export type ReadinessVerdict = 'pass' | 'borderline' | 'reject';

/**
 * Semantic bucket for readinessScore.
 *
 *   high_value — ≥ 0.65: strong demo material
 *   acceptable — [0.40, 0.65): usable in journey
 *   borderline — [0.25, 0.40): only promoted when corpus is too small
 *   rejected   — < 0.25 or hard-reject
 */
export type ReadinessCategory =
  | 'high_value'
  | 'acceptable'
  | 'borderline'
  | 'rejected';

// ─────────────────────────────────────────────────────────────────────────────
// ReadinessResult
// ─────────────────────────────────────────────────────────────────────────────

export interface ReadinessResult {
  /** Matches PageIntelligence.pageId. */
  pageId:          string;
  url:             string;
  title:           string;
  /** Composite readiness score.  Range [0.0, 1.0]. */
  readinessScore:  number;
  /** How confident the scorer is in readinessScore.  Range [0.0, 1.0]. */
  confidence:      number;
  verdict:         ReadinessVerdict;
  category:        ReadinessCategory;
  demoValueTier:   DemoValueTier;
  /** Populated when verdict === 'reject'; summarises the primary reason. */
  rejectionReason: string | null;
  /** All contributing signals, strongest influence first. */
  signals:         ReadinessSignal[];
}

// ─────────────────────────────────────────────────────────────────────────────
// ScoringContext — internal per-page snapshot used by all detectors
//
// Built once by ScoringContextBuilder.  Detectors read this; they never write
// to PipelineContext directly.
// ─────────────────────────────────────────────────────────────────────────────

export interface ScoringContext {
  // ── Identity ──────────────────────────────────────────────────────────────
  pageId: string;
  url:    string;
  title:  string;

  // ── Vision analysis (from PageIntelligence) ───────────────────────────────
  pageCategory:           PageCategory;
  pagePurpose:            string;
  overallImportanceScore: number;   // 0–100
  features:               VisualFeature[];
  kpiWidgets:             KPIWidget[];
  importantActions:       ActionSignal[];
  primaryElementBoundingBox?: PrimaryElementBox;

  // ── DOM structure (from PageCapture.dom) ──────────────────────────────────
  formCount:   number;
  inputCount:  number;
  buttonCount: number;
  headings:    string[];

  // ── Application graph (from ApplicationGraph) ─────────────────────────────
  nodeType:  NodeType;
  pageDepth: number;

  // ── Feature ranking (from PrioritizedFeature[]) ───────────────────────────
  /** Highest composite score among PrioritizedFeatures linked to this page. 0–100. */
  topFeatureComposite: number;
  /** Count of PrioritizedFeatures linked to this page. */
  pageFeatureCount:    number;

  // ── Business value (from BusinessValueEnrichmentResult, when available) ───
  /** salesNarration + businessBenefit strings for features on this page. */
  businessBenefits: string[];
}
