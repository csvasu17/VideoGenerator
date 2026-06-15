// ─────────────────────────────────────────────────────────────────────────────
// SalesStory — domain entities for the Sales Story Director (Phase 8)
//
// Sits between DemoReadinessStage and JourneyGenerationStage.
// Converts filtered page intelligence into a structured narrative arc where
// every scene has a business outcome, a proof element, and a camera intent.
// ─────────────────────────────────────────────────────────────────────────────

/** How the feature delivers measurable business value. */
export type ValueCategory =
  | 'cost_reduction'
  | 'risk_prevention'
  | 'efficiency_gain'
  | 'revenue_protection'
  | 'decision_speed'
  | 'operational_intelligence'
  | 'compliance_assurance';

/** The class of on-screen element that proves the stated business claim. */
export type ProofElementType =
  | 'prediction_card'
  | 'risk_indicator'
  | 'kpi_metric'
  | 'cost_savings_metric'
  | 'alert_severity'
  | 'outcome_metric'
  | 'anomaly_highlight'
  | 'trend_chart'
  | 'simulation_result'
  | 'fleet_health_summary';

/**
 * Normalised bounding box within the viewport.
 * All values in [0, 1] relative to viewport width / height.
 */
export interface NormalisedBox {
  x:      number;
  y:      number;
  width:  number;
  height: number;
}

/** The specific on-screen element that proves the business claim. */
export interface ProofElement {
  type:           ProofElementType;
  /** Short label: "Failure Probability: High Risk" */
  label:          string;
  /** What this element proves: "AI detected failure 14 days ahead" */
  evidenceClaim:  string;
  /**
   * Normalised bbox from PageIntelligence.primaryElementBoundingBox
   * or derived from kpiWidgets.  null when unavailable.
   */
  boundingBox:    NormalisedBox | null;
  /**
   * 0-1.  Drives zoom intensity and callout animation speed.
   * 1.0 = tight zoom.  0.5 = moderate drift.
   */
  visualWeight:   number;
}

/** Every scene's structural role in the narrative arc. */
export type SceneRole =
  | 'hook'        // Scene 1: establish platform, grab attention
  | 'problem'     // Surface the operational pain
  | 'insight'     // The "aha moment" — AI / analytics showing what humans cannot see
  | 'action'      // Rapid response enabled by the platform
  | 'outcome'     // Quantified result, proof of impact
  | 'validation'  // Risk-free testing / simulation
  | 'scale';      // Multi-site / enterprise-wide view

/** Feature mapped to its business value. */
export interface BusinessOutcome {
  featureId:       string;
  featureName:     string;
  /** 3-6 word benefit headline: "Prevent Failures Before They Happen" */
  callout:         string;
  /** 1-sentence business result (from customerOutcome). */
  outcome:         string;
  valueCategory:   ValueCategory;
  /** Problem framing that opens the scene narration (from businessProblem). */
  narrativeHook:   string;
  /** Quantified claim (from businessBenefit). */
  impactStatement: string;
  /** Visual proof signals detected on this page. */
  proofSignals:    ProofElement[];
  /** pageIds where this feature was observed — from Feature.pageIds */
  pageIds:         string[];
}

/** Primary camera movement strategy. */
export type CameraStrategy =
  | 'proof_focus'   // zoom to proof element's bounding box
  | 'page_overview' // wide Ken-Burns across full page
  | 'data_sweep'    // drift across data region
  | 'drift';        // gentle ambient drift

/** Motion style for the camera move. */
export type CameraMotionStyle =
  | 'zoom_in'
  | 'drift_right'
  | 'drift_up'
  | 'ken_burns'
  | 'pulse';

/** Per-scene camera direction consumed by CameraChoreographer. */
export interface CameraIntent {
  strategy:      CameraStrategy;
  /** Normalised bbox to zoom toward.  null for non-proof-focus strategies. */
  zoomTarget:    NormalisedBox | null;
  /**
   * Final zoom level at end of camera move.
   * Scales with storyPriority: 1.0 => 1.10 (overview), 0.95 => 1.65 (tight).
   */
  endZoom:       number;
  motionStyle:   CameraMotionStyle;
  /**
   * Seconds into the scene when the camera snaps to the proof element
   * before easing back ("proof pop").  null = no proof pop.
   */
  proofPopAtSec: number | null;
}

/** Complete per-scene contract driving storyboard, camera, and validation. */
export interface SceneGoal {
  sceneIndex:      number;
  pageId:          string;
  sceneRole:       SceneRole;
  /** Feature display name. */
  feature:         string;
  businessOutcome: BusinessOutcome;
  /** 3-6 word benefit headline (duplicated from businessOutcome for convenience). */
  callout:         string;
  /** Primary visual proof element for this scene. */
  proofElement:    ProofElement;
  /** One-line scene purpose: "{role}: {callout}" */
  sceneGoal:       string;
  /** Opening line of narration (from businessProblem). */
  narrativeHook:   string;
  /** Closing line of narration (from customerOutcome). */
  closingLine:     string;
  cameraIntent:    CameraIntent;
  /** Minimum scene duration in seconds (driven by sceneRole). */
  minDurationSec:  number;
  /**
   * 0-1: importance of this scene in the arc.
   * Drives scene duration, motion intensity, and callout timing.
   *
   * Example values:
   *   AI Predictive Maintenance = 1.00
   *   Fault Simulator           = 0.95
   *   Dashboard KPI             = 0.85
   *   Device Fleet              = 0.60
   *   User List                 = 0.20
   */
  storyPriority:   number;
}

/** Narrative arc pattern. */
export type ArcType =
  | 'reactive_to_predictive'  // Monitor => Detect => Predict => Prevent => Validate
  | 'visibility_to_control'   // See => Understand => Act => Measure => Scale
  | 'data_to_decisions'       // Collect => Analyse => Predict => Respond => Improve
  | 'risk_to_resilience';     // Risk => Detection => Prevention => Confidence => ROI

/** Arc-level quality summary. */
export interface ArcValidation {
  arcComplete:        boolean;
  missingRoles:       SceneRole[];
  weakScenes:         string[];       // sceneGoal strings for scenes with score < 0.50
  redundantScenes:    string[];       // pageIds of scenes with duplicate role + callout
  overallScore:       number;         // 0-1
  narrative:          string;         // one-line arc description
  recommendedChanges: string[];
}

/** Per-scene quality result. */
export interface SceneValidation {
  /** sceneIndex as string for map keying. */
  sceneId:  string;
  pageId:   string;
  passed:   boolean;
  score:    number;
  checks: {
    hasBusinessOutcome:     boolean;
    hasProofElement:        boolean;
    proofElementHasBBox:    boolean;
    calloutIsBenefitDriven: boolean;
    sceneRoleAssigned:      boolean;
    notNavigation:          boolean;
    notEmptyState:          boolean;
    notForm:                boolean;
    notSettings:            boolean;
    contributesToArc:       boolean;
    narrativeHookPresent:   boolean;
    closingLinePresent:     boolean;
  };
  warnings:        string[];
  rejectionReason: string | null;
}

/** The complete story structure produced by SalesStoryDirectorStage. */
export interface StoryArc {
  arcType:           ArcType;
  title:             string;
  premise:           string;
  resolution:        string;
  scenes:            SceneGoal[];
  arcNarrative:      string;
  openingHook:       string;
  closingCTA:        string;
  validationSummary: ArcValidation;
  sceneValidations:  SceneValidation[];
}
