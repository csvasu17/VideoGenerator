import { SalesStoryValidator } from '../SalesStoryValidator';
import type {
  SceneGoal,
  ArcType,
  BusinessOutcome,
  ProofElement,
  CameraIntent,
} from '../../core/domain/entities/SalesStory';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeProofElement(overrides?: Partial<ProofElement>): ProofElement {
  return {
    type:          'kpi_metric',
    label:         'Failure Probability: High Risk',
    evidenceClaim: 'AI detected failure 14 days ahead',
    boundingBox:   { x: 0.1, y: 0.2, width: 0.4, height: 0.3 },
    visualWeight:  0.9,
    ...overrides,
  };
}

function makeCamera(): CameraIntent {
  return {
    strategy:      'proof_focus',
    zoomTarget:    { x: 0.1, y: 0.2, width: 0.4, height: 0.3 },
    endZoom:       1.5,
    motionStyle:   'zoom_in',
    proofPopAtSec: 2.5,
  };
}

function makeOutcome(overrides?: Partial<BusinessOutcome>): BusinessOutcome {
  return {
    featureId:       'f1',
    featureName:     'AI Predictive Maintenance',
    callout:         'Prevent Failures Before They Happen',
    outcome:         'Reduce downtime by 40% and lower maintenance costs significantly',
    valueCategory:   'risk_prevention',
    narrativeHook:   'Equipment failures cause unexpected downtime and budget overruns',
    impactStatement: 'Predict failures before they occur with 92% accuracy',
    proofSignals:    [],
    pageIds:         ['page1'],
    ...overrides,
  };
}

function makeScene(overrides?: Partial<SceneGoal>): SceneGoal {
  const outcome = makeOutcome();
  return {
    sceneIndex:      0,
    pageId:          'page1',
    sceneRole:       'insight',
    feature:         'AI Predictive Maintenance',
    businessOutcome: outcome,
    callout:         'Prevent Failures Before They Happen',
    proofElement:    makeProofElement(),
    sceneGoal:       'insight: Prevent Failures Before They Happen',
    narrativeHook:   'Equipment failures cause unexpected downtime and budget overruns',
    closingLine:     'Reduce downtime by 40% and lower maintenance costs significantly',
    cameraIntent:    makeCamera(),
    minDurationSec:  10,
    storyPriority:   0.95,
    ...overrides,
  };
}

function makeArcScenes(): SceneGoal[] {
  return [
    makeScene({ sceneIndex: 0, sceneRole: 'hook',       feature: 'Dashboard Overview', businessOutcome: makeOutcome({ featureId: 'f_hook', featureName: 'Dashboard Overview', callout: 'See Everything. Act Faster.' }),      callout: 'See Everything. Act Faster.',           sceneGoal: 'hook: See Everything. Act Faster.',           pageId: 'p_hook' }),
    makeScene({ sceneIndex: 1, sceneRole: 'insight',    feature: 'AI Predictive Maintenance',                                                                                                                                    callout: 'Prevent Failures Before They Happen',   sceneGoal: 'insight: Prevent Failures Before They Happen', pageId: 'p_insight' }),
    makeScene({ sceneIndex: 2, sceneRole: 'action',     feature: 'Alarm Center',       businessOutcome: makeOutcome({ featureId: 'f_action', featureName: 'Alarm Center', callout: 'Respond Faster To Critical Issues' }),       callout: 'Respond Faster To Critical Issues',     sceneGoal: 'action: Respond Faster To Critical Issues',    pageId: 'p_action' }),
    makeScene({ sceneIndex: 3, sceneRole: 'validation', feature: 'Fault Simulator',    businessOutcome: makeOutcome({ featureId: 'f_valid', featureName: 'Fault Simulator', callout: 'Test Every Scenario. Zero Risk.' }),        callout: 'Test Every Scenario. Zero Risk.',       sceneGoal: 'validation: Test Every Scenario. Zero Risk.',  pageId: 'p_valid' }),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('SalesStoryValidator', () => {
  const validator = new SalesStoryValidator();
  const arcType: ArcType = 'reactive_to_predictive';

  it('arc is complete when all required roles for reactive_to_predictive are present', () => {
    const scenes = makeArcScenes();
    const { arcValidation } = validator.validate(scenes, arcType);
    expect(arcValidation.arcComplete).toBe(true);
    expect(arcValidation.missingRoles).toHaveLength(0);
  });

  it('missingRoles reports the right roles when insight is absent', () => {
    const scenes = makeArcScenes().filter(s => s.sceneRole !== 'insight');
    const { arcValidation } = validator.validate(scenes, arcType);
    expect(arcValidation.arcComplete).toBe(false);
    expect(arcValidation.missingRoles).toContain('insight');
  });

  it('calloutIsBenefitDriven fails for UI label "Alarm Center"', () => {
    const scene = makeScene({ callout: 'Alarm Center', sceneGoal: 'action: Alarm Center' });
    const { sceneValidations } = validator.validate([scene], arcType);
    expect(sceneValidations[0].checks.calloutIsBenefitDriven).toBe(false);
  });

  it('calloutIsBenefitDriven passes for "Respond Faster To Critical Issues"', () => {
    const scene = makeScene({
      callout:   'Respond Faster To Critical Issues',
      sceneGoal: 'action: Respond Faster To Critical Issues',
    });
    const { sceneValidations } = validator.validate([scene], arcType);
    expect(sceneValidations[0].checks.calloutIsBenefitDriven).toBe(true);
  });

  it('notSettings fails when sceneGoal contains "settings"', () => {
    const scene = makeScene({
      callout:   'Configure Platform Settings Now',
      sceneGoal: 'scale: settings configuration page',
      feature:   'Platform Settings',
    });
    const { sceneValidations } = validator.validate([scene], arcType);
    expect(sceneValidations[0].checks.notSettings).toBe(false);
  });

  it('notSettings passes when sceneGoal does not contain settings', () => {
    const scene = makeScene();
    const { sceneValidations } = validator.validate([scene], arcType);
    expect(sceneValidations[0].checks.notSettings).toBe(true);
  });

  it('overallScore is the average of scene scores', () => {
    const scenes = makeArcScenes();
    const { arcValidation, sceneValidations } = validator.validate(scenes, arcType);
    const expectedAvg = sceneValidations.reduce((s, sv) => s + sv.score, 0) / sceneValidations.length;
    expect(arcValidation.overallScore).toBeCloseTo(expectedAvg, 5);
  });

  it('overallScore is 0 when scenes array is empty', () => {
    const { arcValidation } = validator.validate([], arcType);
    expect(arcValidation.overallScore).toBe(0);
  });

  it('weakScenes includes scenes with score < 0.50', () => {
    // Create a scene that will score low: notSettings fails, callout is not benefit-driven, no hook
    const weakScene = makeScene({
      sceneIndex:   99,
      callout:      'Settings',
      sceneGoal:    'settings: Settings',
      feature:      'Settings',
      narrativeHook: '',
      closingLine:  '',
      proofElement: makeProofElement({
        boundingBox:  null,
        label:        '',
        visualWeight: 0.3,
      }),
      businessOutcome: makeOutcome({
        featureId: '',
        featureName: 'Settings',
        callout: 'Settings',
        narrativeHook: '',
        outcome: '',
        impactStatement: '',
      }),
    });
    const { arcValidation, sceneValidations } = validator.validate([weakScene], arcType);
    expect(sceneValidations[0].score).toBeLessThan(0.50);
    expect(arcValidation.weakScenes).toContain(String(weakScene.sceneIndex));
  });

  it('redundantScenes captures scenes with identical callouts and same role', () => {
    const callout = 'Prevent Failures Before They Happen';
    const scenes = [
      makeScene({ sceneIndex: 0, sceneRole: 'insight', callout, sceneGoal: `insight: ${callout}`, pageId: 'p1', storyPriority: 0.95 }),
      makeScene({ sceneIndex: 1, sceneRole: 'insight', callout, sceneGoal: `insight: ${callout}`, pageId: 'p2', storyPriority: 0.70 }),
    ];
    const { arcValidation } = validator.validate(scenes, arcType);
    expect(arcValidation.redundantScenes).toContain('p2');
  });

  it('recommendedChanges lists missing required roles', () => {
    const scenes = makeArcScenes().filter(s => s.sceneRole !== 'validation');
    const { arcValidation } = validator.validate(scenes, arcType);
    expect(arcValidation.recommendedChanges).toContain('Add a validation scene');
  });

  it('narrative contains scene count', () => {
    const scenes = makeArcScenes();
    const { arcValidation } = validator.validate(scenes, arcType);
    expect(arcValidation.narrative).toContain(String(scenes.length));
  });
});
