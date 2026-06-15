import { StoryArcSelector } from '../StoryArcSelector';
import type { BusinessOutcome } from '../../core/domain/entities/SalesStory';
import type { ReadinessResult } from '../../core/domain/entities/ReadinessResult';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeOutcome(
  featureId:     string,
  featureName:   string,
  pageIds:       string[],
  valueCategory: BusinessOutcome['valueCategory'] = 'risk_prevention',
): BusinessOutcome {
  return {
    featureId,
    featureName,
    callout:         'Prevent Failures Before They Happen',
    outcome:         'Reduce downtime by 40%',
    valueCategory,
    narrativeHook:   'Equipment failures cause unexpected downtime',
    impactStatement: 'Predict failures before they occur',
    proofSignals:    [],
    pageIds,
  };
}

function makeReadinessResult(
  pageId:  string,
  score:   number,
  verdict: ReadinessResult['verdict'] = 'pass',
  tier:    ReadinessResult['demoValueTier'] = 'tier1',
): ReadinessResult {
  return {
    pageId,
    url:             `https://app.example.com/${pageId}`,
    title:           pageId,
    readinessScore:  score,
    confidence:      0.9,
    verdict,
    category:        'high_value',
    demoValueTier:   tier,
    rejectionReason: null,
    signals:         [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('StoryArcSelector', () => {
  const selector = new StoryArcSelector();

  it('selects reactive_to_predictive when AI + alarm + simulator outcomes are available', () => {
    const outcomes = new Map<string, BusinessOutcome>([
      ['ai1',  makeOutcome('ai1',  'AI Predictive Analytics', ['p1'], 'risk_prevention')],
      ['alm1', makeOutcome('alm1', 'Alarm Management',        ['p2'], 'efficiency_gain')],
      ['sim1', makeOutcome('sim1', 'Fault Simulator',         ['p3'], 'risk_prevention')],
      ['dash', makeOutcome('dash', 'Dashboard Overview',      ['p4'], 'operational_intelligence')],
    ]);
    const rr = [
      makeReadinessResult('p1', 0.9),
      makeReadinessResult('p2', 0.8),
      makeReadinessResult('p3', 0.85),
      makeReadinessResult('p4', 0.7),
    ];
    const { arcType } = selector.select(outcomes, rr);
    expect(arcType).toBe('reactive_to_predictive');
  });

  it('assigns role "insight" to a feature with "ai" in name', () => {
    const outcomes = new Map<string, BusinessOutcome>([
      ['ai1',  makeOutcome('ai1',  'AI Predictive Maintenance', ['p1'], 'risk_prevention')],
      ['dash', makeOutcome('dash', 'Dashboard Overview',        ['p2'], 'operational_intelligence')],
    ]);
    const rr = [
      makeReadinessResult('p1', 0.9),
      makeReadinessResult('p2', 0.7),
    ];
    const { scenes } = selector.select(outcomes, rr);
    const aiScene = scenes.find(s => s.outcomeId === 'ai1');
    expect(aiScene?.sceneRole).toBe('insight');
  });

  it('assigns role "insight" to a feature with "predict" in name', () => {
    const outcomes = new Map<string, BusinessOutcome>([
      ['pred', makeOutcome('pred', 'Predictive Fault Detection', ['p1'], 'risk_prevention')],
      ['dash', makeOutcome('dash', 'Dashboard Overview',         ['p2'], 'operational_intelligence')],
    ]);
    const rr = [
      makeReadinessResult('p1', 0.9),
      makeReadinessResult('p2', 0.7),
    ];
    const { scenes } = selector.select(outcomes, rr);
    const predScene = scenes.find(s => s.outcomeId === 'pred');
    expect(predScene?.sceneRole).toBe('insight');
  });

  it('assigns role "validation" and storyPriority >= 0.90 to a feature with "simulat" in name', () => {
    const outcomes = new Map<string, BusinessOutcome>([
      ['sim', makeOutcome('sim', 'Fault Simulation Engine', ['p1'], 'risk_prevention')],
      ['ai',  makeOutcome('ai',  'AI Predictive Analytics', ['p2'], 'risk_prevention')],
    ]);
    const rr = [
      makeReadinessResult('p1', 0.85),
      makeReadinessResult('p2', 0.9),
    ];
    const { scenes } = selector.select(outcomes, rr);
    const simScene = scenes.find(s => s.outcomeId === 'sim');
    expect(simScene?.sceneRole).toBe('validation');
    expect(simScene?.storyPriority).toBeGreaterThanOrEqual(0.90);
  });

  it('hook scene comes first in scene order', () => {
    const outcomes = new Map<string, BusinessOutcome>([
      ['ai',   makeOutcome('ai',   'AI Predictive Analytics', ['p1'], 'risk_prevention')],
      ['alm',  makeOutcome('alm',  'Alarm Center',            ['p2'], 'efficiency_gain')],
      ['dash', makeOutcome('dash', 'Dashboard Overview',      ['p3'], 'operational_intelligence')],
    ]);
    const rr = [
      makeReadinessResult('p1', 0.9),
      makeReadinessResult('p2', 0.8),
      makeReadinessResult('p3', 0.75),
    ];
    const { scenes } = selector.select(outcomes, rr);
    if (scenes.length > 0) {
      expect(scenes[0].sceneRole).toBe('hook');
    }
  });

  it('excludes features with only rejected readiness results', () => {
    const outcomes = new Map<string, BusinessOutcome>([
      ['ai',       makeOutcome('ai',      'AI Predictive Analytics', ['p1'], 'risk_prevention')],
      ['rejected', makeOutcome('rejected', 'Login Page',             ['p2'], 'operational_intelligence')],
    ]);
    const rr = [
      makeReadinessResult('p1', 0.9,  'pass'),
      makeReadinessResult('p2', 0.1,  'reject'),
    ];
    const { scenes } = selector.select(outcomes, rr);
    const rejectedScene = scenes.find(s => s.outcomeId === 'rejected');
    expect(rejectedScene).toBeUndefined();
  });

  it('returns empty scenes when no passing readiness results exist', () => {
    const outcomes = new Map<string, BusinessOutcome>([
      ['f1', makeOutcome('f1', 'AI Predictive Analytics', ['p1'], 'risk_prevention')],
    ]);
    const rr = [makeReadinessResult('p1', 0.1, 'reject')];
    const { scenes } = selector.select(outcomes, rr);
    expect(scenes).toHaveLength(0);
  });

  it('returns empty scenes when outcomes map is empty', () => {
    const { scenes } = selector.select(new Map(), [makeReadinessResult('p1', 0.9)]);
    expect(scenes).toHaveLength(0);
  });

  it('does not exceed 7 scenes', () => {
    const outcomes = new Map<string, BusinessOutcome>();
    const rr: ReadinessResult[] = [];
    for (let i = 0; i < 10; i++) {
      const id = `f${i}`;
      const pid = `p${i}`;
      outcomes.set(id, makeOutcome(id, `Feature ${i}`, [pid], 'operational_intelligence'));
      rr.push(makeReadinessResult(pid, 0.7));
    }
    const { scenes } = selector.select(outcomes, rr);
    expect(scenes.length).toBeLessThanOrEqual(7);
  });
});
