import type {
  SceneGoal,
  SceneRole,
  BusinessOutcome,
  ProofElement,
  ProofElementType,
  ValueCategory,
  CameraIntent,
  CameraStrategy,
  CameraMotionStyle,
  NormalisedBox,
} from '../core/domain/entities/SalesStory';
import type { PageIntelligence } from '../core/domain/entities/PageIntelligence';
import type { SelectedScene } from './StoryArcSelector';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MIN_DURATION_BY_ROLE: Record<SceneRole, number> = {
  hook:       12,
  problem:     8,
  insight:    10,
  action:      7,
  outcome:     8,
  validation:  9,
  scale:       7,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function proofTypeFromValueCategory(cat: ValueCategory): ProofElementType {
  switch (cat) {
    case 'risk_prevention':          return 'prediction_card';
    case 'cost_reduction':           return 'kpi_metric';
    case 'efficiency_gain':          return 'alert_severity';
    case 'revenue_protection':       return 'outcome_metric';
    case 'operational_intelligence': return 'kpi_metric';
    case 'compliance_assurance':     return 'outcome_metric';
    case 'decision_speed':           return 'trend_chart';
  }
}

function selectProofElement(
  outcome: BusinessOutcome,
  intel:   PageIntelligence | undefined,
): ProofElement {
  if (outcome.proofSignals.length > 0) {
    return outcome.proofSignals[0];
  }

  const type = proofTypeFromValueCategory(outcome.valueCategory);
  const firstWidget = intel?.kpiWidgets[0];
  const label = firstWidget?.label ?? outcome.featureName;

  const evidenceClaim = firstWidget?.value
    ? `${firstWidget.label}: ${firstWidget.value}`
    : outcome.outcome;

  let boundingBox: NormalisedBox | null = null;
  if (intel?.primaryElementBoundingBox) {
    const peb = intel.primaryElementBoundingBox;
    boundingBox = { x: peb.x, y: peb.y, width: peb.width, height: peb.height };
  }

  const visualWeight = 0.7;

  return { type, label, evidenceClaim, boundingBox, visualWeight };
}

function buildCameraIntent(
  role:     SceneRole,
  priority: number,
  proof:    ProofElement,
): CameraIntent {
  const endZoom = lerp(1.10, 1.65, priority);

  let strategy:    CameraStrategy;
  let zoomTarget:  NormalisedBox | null;
  let motionStyle: CameraMotionStyle;
  let proofPopAtSec: number | null;

  switch (role) {
    case 'hook':
      strategy      = 'page_overview';
      zoomTarget    = null;
      motionStyle   = 'ken_burns';
      proofPopAtSec = null;
      break;

    case 'insight':
      strategy      = 'proof_focus';
      zoomTarget    = proof.boundingBox;
      motionStyle   = 'zoom_in';
      proofPopAtSec = 2.5;
      break;

    case 'action':
      strategy      = 'proof_focus';
      zoomTarget    = proof.boundingBox;
      motionStyle   = 'zoom_in';
      proofPopAtSec = null;
      break;

    case 'validation':
      strategy      = 'proof_focus';
      zoomTarget    = proof.boundingBox;
      motionStyle   = 'drift_right';
      proofPopAtSec = 3.0;
      break;

    case 'scale':
      strategy      = 'data_sweep';
      zoomTarget    = proof.boundingBox;
      motionStyle   = 'drift_right';
      proofPopAtSec = null;
      break;

    case 'outcome':
      strategy      = 'proof_focus';
      zoomTarget    = proof.boundingBox;
      motionStyle   = 'zoom_in';
      proofPopAtSec = null;
      break;

    case 'problem':
      strategy      = 'data_sweep';
      zoomTarget    = proof.boundingBox;
      motionStyle   = 'drift_up';
      proofPopAtSec = null;
      break;

    default: {
      const _exhaustive: never = role;
      strategy      = 'page_overview';
      zoomTarget    = null;
      motionStyle   = 'ken_burns';
      proofPopAtSec = null;
      void _exhaustive;
    }
  }

  // When no boundingBox: override strategy to page_overview
  if (proof.boundingBox === null) {
    strategy      = 'page_overview';
    zoomTarget    = null;
    proofPopAtSec = null;
  }

  return { strategy, zoomTarget, endZoom, motionStyle, proofPopAtSec };
}

function makeDefaultOutcome(selected: SelectedScene): BusinessOutcome {
  return {
    featureId:       selected.outcomeId,
    featureName:     '',
    callout:         '',
    outcome:         '',
    valueCategory:   'operational_intelligence',
    narrativeHook:   '',
    impactStatement: '',
    proofSignals:    [],
    pageIds:         [selected.pageId],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SceneGoalBuilder
// ─────────────────────────────────────────────────────────────────────────────

export class SceneGoalBuilder {
  buildAll(
    selectedScenes: SelectedScene[],
    outcomes:       Map<string, BusinessOutcome>,
    intelligence:   Map<string, PageIntelligence>,
  ): SceneGoal[] {
    const goals: SceneGoal[] = [];

    for (let index = 0; index < selectedScenes.length; index++) {
      const selected = selectedScenes[index];
      const outcome  = outcomes.get(selected.outcomeId) ?? makeDefaultOutcome(selected);
      const intel    = intelligence.get(selected.pageId);

      const proofElement  = selectProofElement(outcome, intel);
      const cameraIntent  = buildCameraIntent(selected.sceneRole, selected.storyPriority, proofElement);
      const minDurationSec = MIN_DURATION_BY_ROLE[selected.sceneRole];

      const goal: SceneGoal = {
        sceneIndex:      index,
        pageId:          selected.pageId,
        sceneRole:       selected.sceneRole,
        feature:         outcome.featureName,
        businessOutcome: outcome,
        callout:         outcome.callout,
        proofElement,
        sceneGoal:       `${selected.sceneRole}: ${outcome.callout}`,
        narrativeHook:   outcome.narrativeHook || outcome.callout,
        closingLine:     outcome.outcome || outcome.impactStatement,
        cameraIntent,
        minDurationSec,
        storyPriority:   selected.storyPriority,
      };

      goals.push(goal);
    }

    return goals;
  }
}
