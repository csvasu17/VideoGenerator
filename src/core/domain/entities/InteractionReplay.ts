// ─────────────────────────────────────────────────────────────────────────────
// InteractionReplay — Phase 9 domain types
//
// Models the Interaction Replay Director's full output chain:
//   ExplorationResult[] → InteractionSequence[] → InteractionReplay[]
//                      → InteractionReplayPlan
//
// Zero imports from runtime modules. Pure TypeScript types only.
// ─────────────────────────────────────────────────────────────────────────────

import type { SceneRole } from './SalesStory';

// ── Primitive enumerations ─────────────────────────────────────────────────────

export type InteractionEventType =
  | 'click'
  | 'tab_switch'
  | 'accordion_expand'
  | 'toggle_expand'
  | 'filter_change'
  | 'scenario_execute';

/**
 * Business-value classification of what appeared or changed after an interaction.
 * Used for replay selection scoring and story role assignment.
 */
export type BusinessSignalType =
  | 'ai_prediction'         // AI generated a forecast / classification
  | 'risk_score_change'     // a risk / likelihood score appeared or changed
  | 'risk_score_changed'    // alias — numeric risk score value changed
  | 'alarm_generated'       // an alarm or alert appeared
  | 'fault_injected'        // a fault was injected (simulator)
  | 'kpi_revealed'          // a KPI metric panel appeared
  | 'kpi_changed'           // a KPI value changed (numeric delta)
  | 'cost_metric_revealed'  // an energy or cost metric appeared
  | 'workflow_completed'    // a workflow step was completed
  | 'simulation_result'     // a simulation produced an output
  | 'simulation_started'    // a simulation was started / triggered
  | 'simulation_completed'  // a simulation run finished with output
  | 'outcome_metric';       // a business outcome number appeared

// ── Geometry ──────────────────────────────────────────────────────────────────

/** All values 0–1, viewport-relative. */
export interface NormalisedBox {
  x:      number;
  y:      number;
  width:  number;
  height: number;
}

// ── Visual delta ───────────────────────────────────────────────────────────────

export interface ValueChange {
  label:           string;
  before:          string;
  after:           string;
  changeType:      'increase' | 'decrease' | 'appear' | 'disappear' | 'update';
  businessMeaning: string | null;
}

export interface ReplayVisualDelta {
  /** Normalised bounding box of the primary changed region. null when not determinable. */
  primaryChangeRegion:  NormalisedBox | null;
  /** Human-readable labels of elements that appeared in the after-state. */
  appearedElements:     string[];
  /** Human-readable labels of elements that disappeared. */
  disappearedElements:  string[];
  /** KPI / metric values that changed. */
  valueChanges:         ValueChange[];
  /** 0–1 how dramatic the visual change is (mapped from StateDelta.functionalScore). */
  changeIntensity:      number;
  /** Widget types that appeared (from StateDelta.addedWidgetTypes). */
  newWidgetTypes:       string[];
}

// ── Trigger ────────────────────────────────────────────────────────────────────

export interface InteractionTrigger {
  eventType:          InteractionEventType;
  /** CSS selector of the element that was interacted with. */
  cssSelector:        string;
  /** Normalised bounding box of the trigger element. null when bounding rect was not recorded. */
  elementBBox:        NormalisedBox | null;
  /** Human-readable description of what was interacted with. */
  humanReadableHint:  string;
  /** Business interpretation of this trigger action. */
  triggerPurpose:     string;
}

// ── State references ───────────────────────────────────────────────────────────

export interface InteractionStateRef {
  /** Absolute path to the screenshot PNG on disk. */
  screenshotPath: string;
  screenshotHash: string;
  pageId:         string;
  pageUrl:        string;
}

// ── Sequence (pre-scoring intermediate type) ────────────────────────────────────

export interface InteractionSequence {
  sequenceId:           string;
  pageId:               string;
  pageUrl:              string;
  trigger:              InteractionTrigger;
  startState:           InteractionStateRef;
  endState:             InteractionStateRef;
  visualDelta:          ReplayVisualDelta;
  /** Raw StateDelta.functionalScore from MVID StateComparator. */
  structuralDeltaScore: number;
  /**
   * Raw signals detected from end-state content (before class filtering).
   * Kept for debugging and validation reports.
   */
  businessSignals:      BusinessSignalType[];
  /**
   * Class-filtered signals: subset of businessSignals that are permitted
   * for this trigger's InteractionClass.  Set by InteractionSequenceBuilder.
   * BusinessInteractionScorer reads this, not businessSignals.
   */
  permittedSignals:     BusinessSignalType[];
  /**
   * Stable identity of the state transition: sha256(startHash:endHash).slice(0,16).
   * Used by InteractionSalesStoryBridge to deduplicate identical transitions
   * across multiple exploration paths.
   */
  transitionKey:        string;
  /**
   * 0.50–1.10 multiplier applied by BusinessInteractionScorer based on
   * trigger.eventType.  Accordion/toggle = 0.50; click = 1.00; scenario_execute = 1.10.
   */
  classPenaltyMultiplier: number;
  /** 0–1 composite business value score (set by BusinessInteractionScorer). */
  businessScore:        number;
  storyRoleAffinity:    SceneRole;
}

// ── Replay phases (all values in frames at 30 fps) ─────────────────────────────

export interface ReplayPhases {
  /** End of the base-state overview — camera drifts toward trigger area. */
  hookEndFrame:           number;
  /** Cursor sprite fades in and begins moving. */
  cursorMoveStartFrame:   number;
  /** Cursor arrives at trigger element bbox centre. */
  cursorArriveFrame:      number;
  /** Click ripple animation fires. */
  clickFrame:             number;
  /** Screenshot crossfade from base → after-state begins. */
  transitionStartFrame:   number;
  /** Crossfade complete — after-state fully visible. */
  transitionEndFrame:     number;
  /** Camera springs to primaryChangeRegion. */
  outcomeZoomFrame:       number;
  /** Callout label appears at primaryChangeRegion. */
  calloutFrame:           number;
}

// ── Camera ─────────────────────────────────────────────────────────────────────

export type ReplayCameraStrategy =
  | 'page_overview'   // full-frame Ken-Burns
  | 'follow_cursor'   // camera drifts toward cursor / trigger element
  | 'follow_change'   // camera pulls back slightly after the transition
  | 'reveal_outcome'; // camera springs to primaryChangeRegion for the business reveal

export interface ReplayCameraDirective {
  phase:      'hook' | 'action' | 'transition' | 'outcome';
  strategy:   ReplayCameraStrategy;
  zoom:       number;
  zoomTarget: NormalisedBox | null;
  atFrame:    number;
}

// ── Core replay type ───────────────────────────────────────────────────────────

export interface InteractionReplay {
  interactionId:     string;
  sequenceId:        string;
  pageId:            string;

  startState:        InteractionStateRef;
  endState:          InteractionStateRef;
  trigger:           InteractionTrigger;

  businessPurpose:   string;
  businessSignals:   BusinessSignalType[];
  storyRole:         SceneRole;

  visualDelta:       ReplayVisualDelta;
  replayDurationSec: number;
  phases:            ReplayPhases;
  cameraDirectives:  ReplayCameraDirective[];

  calloutText:       string;
  calloutBBox:       NormalisedBox | null;

  /**
   * Stable identity of the underlying state transition:
   * sha256(startHash:endHash).slice(0,16).
   * Used by InteractionSalesStoryBridge for deduplication.
   */
  transitionKey:     string;

  /**
   * 0–1 priority score combining business value, story role affinity, and arc position.
   *
   * Influences:
   *   - replay selection (higher priority preferred over lower-scoring candidates)
   *   - replayDurationSec via lerp(12s, 30s, replayPriority)
   *   - camera endZoom     via lerp(1.20, 1.65, replayPriority)
   *   - callout hold time  via lerp(0.25s, 0.50s, replayPriority)
   */
  replayPriority: number;
}

// ── Validation ──────────────────────────────────────────────────────────────────

export interface ReplayValidationCheck {
  name:    string;
  passed:  boolean;
  weight:  number;
  detail?: string;
}

export interface ReplayValidationResult {
  interactionId: string;
  /** Weighted pass rate: 0–1. */
  score:    number;
  /** score >= 0.60 → promoted to 'interaction' mode; else fallback to 'screenshot'. */
  promoted: boolean;
  checks:   ReplayValidationCheck[];
  /** Name of the first hard gate that failed, or null if all hard gates passed. */
  hardGateFailed:  string | null;
  /** Summary of trigger for report output. */
  triggerSummary:  string;
  /** changeIntensity from ReplayVisualDelta. */
  visualDelta:     number;
  /** storyRoleAffinity + compatible scene roles. */
  storyRelevance:  string;
  /** Whether this replay was deduped as a unique transition or a duplicate. */
  dedupeStatus:    'unique' | `duplicate_of:${string}`;
}

export interface ReplayValidationReport {
  replayResults:   ReplayValidationResult[];
  /** Fraction of StoryArc scenes with a qualifying replay. */
  coverageRate:    number;
  promotedCount:   number;
  demotedCount:    number;
  weakReplays:     ReplayValidationResult[];
  recommendations: string[];
}

// ── Plan (pipeline output) ─────────────────────────────────────────────────────

export interface InteractionReplayPlan {
  replays:          InteractionReplay[];
  /** SceneGoal.sceneIndex → interactionId. Map<> used internally; serialised separately. */
  sceneToReplayMap: Map<number, string>;
  /** 0–1 fraction of StoryArc scenes with a qualifying replay. */
  coverageRate:     number;
  validationReport: ReplayValidationReport;
}

// ── Serialised form for demo-package.json / Storyboard ────────────────────────
//
// Map<> is not JSON-serialisable. This plain-object form is written to disk.

export interface SerializedInteractionReplay {
  interactionId:       string;
  /** Path relative to outputDir root (e.g. "captures/pageId/viewport.png"). */
  startScreenshotPath: string;
  endScreenshotPath:   string;
  trigger: {
    eventType:         InteractionEventType;
    elementBBox:       NormalisedBox | null;
    humanReadableHint: string;
  };
  visualDelta: {
    primaryChangeRegion: NormalisedBox | null;
    changeIntensity:     number;
  };
  phases:           ReplayPhases;
  cameraDirectives: ReplayCameraDirective[];
  calloutText:      string;
  calloutBBox:      NormalisedBox | null;
  replayPriority:   number;
  businessPurpose:  string;
}
