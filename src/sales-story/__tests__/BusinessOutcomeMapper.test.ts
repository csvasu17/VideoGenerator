import { extractCallout, isBenefitDriven } from '../CalloutExtractor';
import { BusinessOutcomeMapper } from '../BusinessOutcomeMapper';
import type { PrioritizedFeature } from '../../core/domain/entities/PrioritizedFeature';
import type { BusinessValueEnrichmentResult } from '../../core/domain/entities/BusinessValueOutput';
import type { PageIntelligence } from '../../core/domain/entities/PageIntelligence';
import type { ReadinessResult } from '../../core/domain/entities/ReadinessResult';

// ─────────────────────────────────────────────────────────────────────────────
// extractCallout
// ─────────────────────────────────────────────────────────────────────────────

describe('extractCallout — template matches', () => {
  it('matches AI/predictive feature name', () => {
    const result = extractCallout('AI Predictive Maintenance', 'Some benefit text');
    expect(result).toBe('Prevent Failures Before They Happen');
  });

  it('matches alarm feature name', () => {
    const result = extractCallout('Alarm Center', 'Some benefit text');
    expect(result).toBe('Respond Faster To Critical Issues');
  });

  it('matches alert feature name', () => {
    const result = extractCallout('Alert Management', 'Some benefit text');
    expect(result).toBe('Respond Faster To Critical Issues');
  });

  it('matches simulator feature name', () => {
    const result = extractCallout('Fault Simulator', 'Some benefit text');
    expect(result).toBe('Test Every Scenario. Zero Risk.');
  });

  it('matches simulat prefix in feature name', () => {
    const result = extractCallout('Simulation Engine', 'Some benefit text');
    expect(result).toBe('Test Every Scenario. Zero Risk.');
  });

  it('matches fleet feature name', () => {
    const result = extractCallout('Fleet Monitor', 'Some benefit text');
    expect(result).toBe('Monitor Every Device In Real Time');
  });

  it('matches device feature name', () => {
    const result = extractCallout('Device Health', 'Some benefit text');
    expect(result).toBe('Monitor Every Device In Real Time');
  });

  it('matches building/site feature name', () => {
    const result = extractCallout('Site Onboarding', 'Some benefit text');
    expect(result).toBe('Add New Sites In Minutes');
  });

  it('matches user management feature name', () => {
    const result = extractCallout('User Management', 'Some benefit text');
    expect(result).toBe('Control Access From One Screen');
  });

  it('matches dashboard feature name', () => {
    const result = extractCallout('KPI Dashboard', 'Some benefit text');
    expect(result).toBe('See Everything. Act Faster.');
  });

  it('matches energy/consumption feature name', () => {
    const result = extractCallout('Energy Consumption Monitor', 'Some benefit text');
    expect(result).toBe('Cut Costs With Live Energy Data');
  });
});

describe('extractCallout — heuristic from businessBenefit', () => {
  it('extracts clause from benefit starting with action verb', () => {
    const result = extractCallout('Unknown Feature', 'Prevent equipment failures before they cost money');
    // Should start with the action verb and be max 6 words
    expect(result).toMatch(/^Prevent/i);
    const words = result.split(/\s+/);
    expect(words.length).toBeLessThanOrEqual(6);
  });

  it('falls back to template match in businessBenefit', () => {
    const result = extractCallout('Generic Feature', 'Real-time predictive insights for every device');
    expect(result).toBe('Prevent Failures Before They Happen');
  });

  it('falls back to first 5 words when no match', () => {
    const result = extractCallout('Xyzzy Widget', 'Lorem ipsum dolor sit amet consectetur');
    const words = result.split(/\s+/);
    expect(words.length).toBeLessThanOrEqual(5);
    expect(result).toBe('Lorem ipsum dolor sit amet');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isBenefitDriven
// ─────────────────────────────────────────────────────────────────────────────

describe('isBenefitDriven', () => {
  it('passes with action verb and 3-8 words', () => {
    expect(isBenefitDriven('Prevent Failures Before They Happen')).toBe(true);
  });

  it('passes with Respond action verb', () => {
    expect(isBenefitDriven('Respond Faster To Critical Issues')).toBe(true);
  });

  it('passes with Monitor action verb', () => {
    expect(isBenefitDriven('Monitor Every Device In Real Time')).toBe(true);
  });

  it('fails for UI label "Dashboard"', () => {
    expect(isBenefitDriven('Dashboard')).toBe(false);
  });

  it('fails for UI label "Alarm Center"', () => {
    expect(isBenefitDriven('Alarm Center')).toBe(false);
  });

  it('fails for UI label "Settings"', () => {
    expect(isBenefitDriven('Settings')).toBe(false);
  });

  it('fails for UI label "Device Fleet"', () => {
    expect(isBenefitDriven('Device Fleet')).toBe(false);
  });

  it('fails for too-short string (1 word)', () => {
    expect(isBenefitDriven('Prevent')).toBe(false);
  });

  it('fails for too-short string (2 words)', () => {
    expect(isBenefitDriven('Prevent Failures')).toBe(false);
  });

  it('fails for plain noun phrase without action verb', () => {
    expect(isBenefitDriven('Operational Data Intelligence Platform')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BusinessOutcomeMapper.build
// ─────────────────────────────────────────────────────────────────────────────

function makeFeature(
  id: string,
  name: string,
  pageIds: string[],
): PrioritizedFeature {
  return {
    feature: {
      id,
      name,
      summary: '',
      detailedDescription: '',
      category: 'analytics',
      businessValue: {
        headline: '',
        painSolved: '',
        beneficiary: '',
        outcomeType: 'efficiency',
      },
      signals: {
        pageCount: pageIds.length,
        interactiveElementCount: 0,
        hasVisualizations: false,
        hasNotifications: false,
        isOnCriticalPath: false,
      },
      relatedFeatureIds: [],
      pageIds,
    },
    scores: {
      businessValue: 80,
      visualAppeal:  70,
      userImportance: 75,
      revenueImpact: 65,
    },
    composite: 73,
    rank:      1,
    rationale: '',
  };
}

function makeIntelligence(pageId: string): PageIntelligence {
  return {
    pageId,
    analysedAt: new Date().toISOString(),
    pagePurpose: 'Dashboard',
    pageCategory: 'dashboard',
    features: [],
    importantActions: [],
    businessContext: '',
    kpiWidgets: [
      { label: 'Failure Probability', value: 'High Risk', trend: 'up' },
    ],
    overallImportanceScore: 85,
    analysisMode: 'vision',
    primaryElementBoundingBox: { x: 0.1, y: 0.2, width: 0.4, height: 0.3 },
  };
}

function makeReadinessResult(pageId: string, score: number): ReadinessResult {
  return {
    pageId,
    url:            `https://app.example.com/${pageId}`,
    title:          pageId,
    readinessScore: score,
    confidence:     0.9,
    verdict:        'pass',
    category:       'high_value',
    demoValueTier:  'tier1',
    rejectionReason: null,
    signals:        [],
  };
}

describe('BusinessOutcomeMapper.build', () => {
  it('returns an empty map when features array is empty', () => {
    const result = BusinessOutcomeMapper.build([], undefined, [], []);
    expect(result.size).toBe(0);
  });

  it('returns correct valueCategory = risk_prevention for AI feature', () => {
    const features = [makeFeature('f1', 'AI Predictive Maintenance', ['page1'])];
    const bvOutputs: BusinessValueEnrichmentResult = {
      outputs: [{
        featureId:       'f1',
        featureName:     'AI Predictive Maintenance',
        businessProblem: 'Equipment failures cause unexpected downtime',
        businessBenefit: 'Predict failures before they occur',
        customerOutcome: 'Reduce downtime by 40%',
        salesNarration:  'With AI Predictive Maintenance, your team can...',
        source:          'llm',
      }],
      totalSubmitted: 1,
      totalEnriched:  1,
      enrichedAt:     new Date().toISOString(),
    };
    const intel = [makeIntelligence('page1')];
    const rr    = [makeReadinessResult('page1', 0.9)];

    const result = BusinessOutcomeMapper.build(features, bvOutputs, intel, rr);
    expect(result.size).toBe(1);
    const outcome = result.get('f1');
    expect(outcome?.valueCategory).toBe('risk_prevention');
  });

  it('returns correct valueCategory = cost_reduction for energy feature', () => {
    const features = [makeFeature('f2', 'Energy Cost Tracker', ['page2'])];
    const bvOutputs: BusinessValueEnrichmentResult = {
      outputs: [{
        featureId:       'f2',
        featureName:     'Energy Cost Tracker',
        businessProblem: 'High energy costs due to inefficient monitoring',
        businessBenefit: 'Reduce energy bills by tracking live consumption',
        customerOutcome: 'Save 20% on utility costs',
        salesNarration:  'With Energy Cost Tracker, your team can...',
        source:          'llm',
      }],
      totalSubmitted: 1,
      totalEnriched:  1,
      enrichedAt:     new Date().toISOString(),
    };
    const intel = [makeIntelligence('page2')];
    const rr    = [makeReadinessResult('page2', 0.8)];

    const result = BusinessOutcomeMapper.build(features, bvOutputs, intel, rr);
    const outcome = result.get('f2');
    expect(outcome?.valueCategory).toBe('cost_reduction');
  });

  it('truncates narrativeHook to at most 15 words', () => {
    const features = [makeFeature('f3', 'Generic Feature', ['page3'])];
    const longProblem = 'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12 word13 word14 word15 word16 word17';
    const bvOutputs: BusinessValueEnrichmentResult = {
      outputs: [{
        featureId:       'f3',
        featureName:     'Generic Feature',
        businessProblem: longProblem,
        businessBenefit: 'Some benefit',
        customerOutcome: 'Some outcome',
        salesNarration:  'Some narration',
        source:          'llm',
      }],
      totalSubmitted: 1,
      totalEnriched:  1,
      enrichedAt:     new Date().toISOString(),
    };
    const result = BusinessOutcomeMapper.build(features, bvOutputs, [makeIntelligence('page3')], [makeReadinessResult('page3', 0.7)]);
    const outcome = result.get('f3');
    const wordCount = (outcome?.narrativeHook ?? '').split(/\s+/).filter(w => w.length > 0).length;
    expect(wordCount).toBeLessThanOrEqual(15);
  });

  it('populates proofSignals when intel has kpiWidgets', () => {
    const features = [makeFeature('f4', 'Dashboard KPI', ['page4'])];
    const result = BusinessOutcomeMapper.build(features, undefined, [makeIntelligence('page4')], [makeReadinessResult('page4', 0.85)]);
    const outcome = result.get('f4');
    expect(outcome?.proofSignals.length).toBeGreaterThan(0);
    expect(outcome?.proofSignals[0].label).toBe('Failure Probability');
    expect(outcome?.proofSignals[0].evidenceClaim).toBe('Failure Probability: High Risk');
  });

  it('includes pageIds in the outcome', () => {
    const pageIds = ['page5a', 'page5b'];
    const features = [makeFeature('f5', 'Device Fleet', pageIds)];
    const result = BusinessOutcomeMapper.build(features, undefined, [], []);
    const outcome = result.get('f5');
    expect(outcome?.pageIds).toEqual(pageIds);
  });

  it('handles businessOutputs === undefined gracefully', () => {
    const features = [makeFeature('f6', 'Some Feature', ['page6'])];
    expect(() => BusinessOutcomeMapper.build(features, undefined, [], [])).not.toThrow();
    const result = BusinessOutcomeMapper.build(features, undefined, [], []);
    expect(result.size).toBe(1);
    const outcome = result.get('f6');
    expect(outcome?.narrativeHook).toBe('');
    expect(outcome?.impactStatement).toBe('');
  });

  it('proof signal has boundingBox from primaryElementBoundingBox', () => {
    const features = [makeFeature('f7', 'Alarm Center', ['page7'])];
    const intel: PageIntelligence = {
      ...makeIntelligence('page7'),
      pageId: 'page7',
      primaryElementBoundingBox: { x: 0.25, y: 0.35, width: 0.5, height: 0.2 },
    };
    const result = BusinessOutcomeMapper.build(features, undefined, [intel], [makeReadinessResult('page7', 0.8)]);
    const outcome = result.get('f7');
    expect(outcome?.proofSignals[0].boundingBox).toEqual({ x: 0.25, y: 0.35, width: 0.5, height: 0.2 });
  });
});
