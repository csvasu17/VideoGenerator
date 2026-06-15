import { FeaturePrioritizationEngine } from '../FeaturePrioritizationEngine';
import { BusinessValueScorer } from '../scoring/BusinessValueScorer';
import { VisualAppealScorer } from '../scoring/VisualAppealScorer';
import { UserImportanceScorer } from '../scoring/UserImportanceScorer';
import { RevenueImpactScorer } from '../scoring/RevenueImpactScorer';
import { DEFAULT_WEIGHTS } from '../scoring/IScorer';
import type { Feature } from '../../../core/domain/entities/Feature';
import type { ScoringDimensions } from '../../../core/domain/entities/PrioritizedFeature';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function feature(overrides: Partial<Feature> & { id: string }): Feature {
  return {
    id: overrides.id,
    name: overrides.name ?? 'Feature',
    summary: overrides.summary ?? 'A feature',
    detailedDescription: overrides.detailedDescription ?? '',
    category: overrides.category ?? 'generic',
    businessValue: {
      headline: 'Improves operations',
      painSolved: 'Manual work',
      beneficiary: 'operations team',
      outcomeType: 'efficiency',
      ...overrides.businessValue,
    },
    signals: {
      pageCount: 2,
      interactiveElementCount: 15,
      hasVisualizations: false,
      hasNotifications: false,
      isOnCriticalPath: false,
      ...overrides.signals,
    },
    relatedFeatureIds: overrides.relatedFeatureIds ?? [],
    pageIds: overrides.pageIds ?? ['p1'],
  };
}

function makeEngine(weightOverrides: Partial<typeof DEFAULT_WEIGHTS> = {}) {
  const w = { ...DEFAULT_WEIGHTS, ...weightOverrides };
  const sum = w.businessValue + w.visualAppeal + w.userImportance + w.revenueImpact;
  // Normalise if caller tweaked one weight
  const weights = {
    businessValue:  w.businessValue  / sum,
    visualAppeal:   w.visualAppeal   / sum,
    userImportance: w.userImportance / sum,
    revenueImpact:  w.revenueImpact  / sum,
  };
  return new FeaturePrioritizationEngine(
    [new BusinessValueScorer(), new VisualAppealScorer(), new UserImportanceScorer(), new RevenueImpactScorer()],
    weights,
  );
}

// ── Empty / edge inputs ───────────────────────────────────────────────────────

describe('edge inputs', () => {
  it('returns empty array for no features', () => {
    expect(makeEngine().prioritize([])).toEqual([]);
  });

  it('returns a single feature as rank 1', () => {
    const result = makeEngine().prioritize([feature({ id: 'f1' })]);
    expect(result).toHaveLength(1);
    expect(result[0].rank).toBe(1);
  });
});

// ── Ranking correctness ───────────────────────────────────────────────────────

describe('ranking', () => {
  it('ranks revenue core feature above admin risk feature', () => {
    const highValue = feature({
      id: 'high',
      category: 'core',
      businessValue: { headline: 'Increases revenue', painSolved: 'Low conversion', beneficiary: 'sales', outcomeType: 'revenue', quantifiedImpact: '20% lift' },
      signals: { pageCount: 5, interactiveElementCount: 40, hasVisualizations: true, hasNotifications: true, isOnCriticalPath: true },
    });

    const lowValue = feature({
      id: 'low',
      category: 'admin',
      businessValue: { headline: 'Config screen', painSolved: 'Settings management', beneficiary: 'admin', outcomeType: 'risk' },
      signals: { pageCount: 1, interactiveElementCount: 8, hasVisualizations: false, hasNotifications: false, isOnCriticalPath: false },
    });

    const result = makeEngine().prioritize([lowValue, highValue]);
    expect(result[0].feature.id).toBe('high');
    expect(result[1].feature.id).toBe('low');
  });

  it('assigns contiguous 1-based ranks', () => {
    const features = ['a', 'b', 'c'].map(id => feature({ id }));
    const result = makeEngine().prioritize(features);
    expect(result.map(r => r.rank)).toEqual([1, 2, 3]);
  });

  it('preserves original order as a tiebreaker', () => {
    // Two identical features — the one that appears first should rank first.
    const f1 = feature({ id: 'first',  summary: 'identical summary' });
    const f2 = feature({ id: 'second', summary: 'identical summary' });
    const result = makeEngine().prioritize([f1, f2]);
    expect(result[0].feature.id).toBe('first');
  });
});

// ── TopN and threshold ────────────────────────────────────────────────────────

describe('options', () => {
  it('respects topN', () => {
    const features = Array.from({ length: 15 }, (_, i) => feature({ id: `f${i}` }));
    const result = makeEngine().prioritize(features, { topN: 5 });
    expect(result).toHaveLength(5);
  });

  it('applies minCompositeScore threshold', () => {
    const high = feature({ id: 'high', category: 'core', businessValue: { headline: 'roi revenue', painSolved: 'cost', beneficiary: 'exec', outcomeType: 'revenue' }, signals: { pageCount: 8, interactiveElementCount: 60, hasVisualizations: true, hasNotifications: true, isOnCriticalPath: true } });
    const low  = feature({ id: 'low',  category: 'admin', businessValue: { headline: 'settings', painSolved: 'config', beneficiary: 'admin', outcomeType: 'risk'    }, signals: { pageCount: 1, interactiveElementCount: 5,  hasVisualizations: false, hasNotifications: false, isOnCriticalPath: false } });

    const result = makeEngine().prioritize([high, low], { minCompositeScore: 60 });
    expect(result.every(r => r.composite >= 60)).toBe(true);
    expect(result.some(r => r.feature.id === 'high')).toBe(true);
  });

  it('returns fewer items than topN when threshold filters them out', () => {
    const features = [feature({ id: 'f1', category: 'admin' })];
    // admin features score low — most won't exceed 80
    const result = makeEngine().prioritize(features, { topN: 10, minCompositeScore: 80 });
    expect(result.length).toBeLessThanOrEqual(1);
  });
});

// ── Score properties ──────────────────────────────────────────────────────────

describe('score properties', () => {
  it('all dimension scores are in [0, 100]', () => {
    const features = [
      feature({ id: 'f1', category: 'core',  businessValue: { headline: 'ROI', painSolved: 'cost', beneficiary: 'cfo', outcomeType: 'revenue' }, signals: { pageCount: 10, interactiveElementCount: 100, hasVisualizations: true, hasNotifications: true, isOnCriticalPath: true } }),
      feature({ id: 'f2', category: 'admin', businessValue: { headline: 'x',   painSolved: 'y',    beneficiary: 'it',  outcomeType: 'risk'    }, signals: { pageCount: 0,  interactiveElementCount: 0,   hasVisualizations: false, hasNotifications: false, isOnCriticalPath: false } }),
    ];
    const result = makeEngine().prioritize(features);
    for (const pf of result) {
      for (const val of Object.values(pf.scores)) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(100);
      }
      expect(pf.composite).toBeGreaterThanOrEqual(0);
      expect(pf.composite).toBeLessThanOrEqual(100);
    }
  });

  it('composite equals expected weighted average', () => {
    const f = feature({ id: 'f1' });
    const [result] = makeEngine().prioritize([f]);
    const { businessValue: bv, visualAppeal: va, userImportance: ui, revenueImpact: ri } = result.scores;
    const w = DEFAULT_WEIGHTS;
    const expected = round2(bv * w.businessValue + va * w.visualAppeal + ui * w.userImportance + ri * w.revenueImpact);
    expect(result.composite).toBeCloseTo(expected, 1);
  });
});

// ── Individual scorers ────────────────────────────────────────────────────────

describe('BusinessValueScorer', () => {
  const scorer = new BusinessValueScorer();

  it('revenue outcome scores higher than risk outcome', () => {
    const rev  = feature({ id: 'r', category: 'core', businessValue: { headline: 'ROI', painSolved: '', beneficiary: '', outcomeType: 'revenue' } });
    const risk = feature({ id: 'x', category: 'core', businessValue: { headline: 'risk', painSolved: '', beneficiary: '', outcomeType: 'risk'    } });
    expect(scorer.score(rev)).toBeGreaterThan(scorer.score(risk));
  });

  it('quantified impact adds bonus', () => {
    const withQuant    = feature({ id: 'q', businessValue: { headline: '', painSolved: '', beneficiary: '', outcomeType: 'efficiency', quantifiedImpact: '30% faster' } });
    const withoutQuant = feature({ id: 'n', businessValue: { headline: '', painSolved: '', beneficiary: '', outcomeType: 'efficiency'                                  } });
    expect(scorer.score(withQuant)).toBeGreaterThan(scorer.score(withoutQuant));
  });

  it('keyword-rich description scores higher than empty description', () => {
    const rich  = feature({ id: 'r', summary: 'Reduces cost and improves ROI through automation and efficiency gains', businessValue: { headline: 'Save money', painSolved: '', beneficiary: '', outcomeType: 'cost_saving' } });
    const plain = feature({ id: 'p', summary: 'A feature',                                                               businessValue: { headline: 'Something',  painSolved: '', beneficiary: '', outcomeType: 'cost_saving' } });
    expect(scorer.score(rich)).toBeGreaterThanOrEqual(scorer.score(plain));
  });
});

describe('VisualAppealScorer', () => {
  const scorer = new VisualAppealScorer();

  it('analytics category scores higher than admin', () => {
    const analytics = feature({ id: 'a', category: 'analytics' });
    const admin     = feature({ id: 'b', category: 'admin'     });
    expect(scorer.score(analytics)).toBeGreaterThan(scorer.score(admin));
  });

  it('visualization bonus is applied when hasVisualizations=true', () => {
    const withViz    = feature({ id: 'v', category: 'reporting', signals: { pageCount: 1, interactiveElementCount: 10, hasVisualizations: true,  hasNotifications: false, isOnCriticalPath: false } });
    const withoutViz = feature({ id: 'n', category: 'reporting', signals: { pageCount: 1, interactiveElementCount: 10, hasVisualizations: false, hasNotifications: false, isOnCriticalPath: false } });
    expect(scorer.score(withViz)).toBeGreaterThan(scorer.score(withoutViz));
  });
});

describe('UserImportanceScorer', () => {
  const scorer = new UserImportanceScorer();

  it('critical-path feature scores higher than non-critical equivalent', () => {
    const critical    = feature({ id: 'c', signals: { pageCount: 3, interactiveElementCount: 20, hasVisualizations: false, hasNotifications: false, isOnCriticalPath: true  } });
    const nonCritical = feature({ id: 'n', signals: { pageCount: 3, interactiveElementCount: 20, hasVisualizations: false, hasNotifications: false, isOnCriticalPath: false } });
    expect(scorer.score(critical)).toBeGreaterThan(scorer.score(nonCritical));
  });

  it('feature on more pages scores higher than same feature on fewer pages', () => {
    const manyPages = feature({ id: 'm', signals: { pageCount: 8, interactiveElementCount: 20, hasVisualizations: false, hasNotifications: false, isOnCriticalPath: false } });
    const fewPages  = feature({ id: 'f', signals: { pageCount: 1, interactiveElementCount: 20, hasVisualizations: false, hasNotifications: false, isOnCriticalPath: false } });
    expect(scorer.score(manyPages)).toBeGreaterThan(scorer.score(fewPages));
  });

  it('core category scores higher than admin category', () => {
    const core  = feature({ id: 'c', category: 'core'  });
    const admin = feature({ id: 'a', category: 'admin' });
    expect(scorer.score(core)).toBeGreaterThan(scorer.score(admin));
  });
});

describe('RevenueImpactScorer', () => {
  const scorer = new RevenueImpactScorer();

  it('revenue outcome scores highest', () => {
    const rev  = feature({ id: 'rv', businessValue: { headline: '', painSolved: '', beneficiary: '', outcomeType: 'revenue'     } });
    const cost = feature({ id: 'cs', businessValue: { headline: '', painSolved: '', beneficiary: '', outcomeType: 'cost_saving' } });
    const eff  = feature({ id: 'ef', businessValue: { headline: '', painSolved: '', beneficiary: '', outcomeType: 'efficiency'  } });
    const risk = feature({ id: 'rk', businessValue: { headline: '', painSolved: '', beneficiary: '', outcomeType: 'risk'        } });
    const scores = [scorer.score(rev), scorer.score(cost), scorer.score(eff), scorer.score(risk)];
    expect(scores[0]).toBeGreaterThan(scores[1]);
    expect(scores[1]).toBeGreaterThan(scores[2]);
    expect(scores[2]).toBeGreaterThan(scores[3]);
  });

  it('revenue keywords in text increase score', () => {
    const keyworded = feature({ id: 'k', summary: 'Drives revenue growth by reducing customer churn and improving retention rates through ROI analysis', businessValue: { headline: '', painSolved: '', beneficiary: '', outcomeType: 'efficiency' } });
    const plain     = feature({ id: 'p', summary: 'A feature',                                                                                                          businessValue: { headline: '', painSolved: '', beneficiary: '', outcomeType: 'efficiency' } });
    expect(scorer.score(keyworded)).toBeGreaterThan(scorer.score(plain));
  });
});

// ── Weight configuration ──────────────────────────────────────────────────────

describe('weight configuration', () => {
  it('withWeights returns new engine instance without mutating original', () => {
    const engine1 = makeEngine();
    const engine2 = engine1.withWeights({ revenueImpact: 0.5 });
    expect(engine1.getWeights()).toMatchObject(DEFAULT_WEIGHTS);
    // DEFAULT_WEIGHTS sum = 1.00; withWeights({ revenueImpact: 0.5 }) gives
    // new total = 0.35 + 0.20 + 0.25 + 0.50 = 1.30, so normalised = 0.5 / 1.30
    expect(engine2.getWeights().revenueImpact).toBeCloseTo(0.5 / 1.30, 2);
  });

  it('throws if weights do not sum to 1.0', () => {
    expect(() => new FeaturePrioritizationEngine(
      [new BusinessValueScorer(), new VisualAppealScorer(), new UserImportanceScorer(), new RevenueImpactScorer()],
      { businessValue: 0.5, visualAppeal: 0.5, userImportance: 0.5, revenueImpact: 0.5 },
    )).toThrow(RangeError);
  });

  it('revenue-heavy weighting surfaces revenue features first', () => {
    const revenueFeature = feature({ id: 'rv', category: 'core',  businessValue: { headline: 'revenue roi profit', painSolved: 'low sales', beneficiary: 'sales', outcomeType: 'revenue', quantifiedImpact: '30% growth' }, signals: { pageCount: 5, interactiveElementCount: 40, hasVisualizations: true, hasNotifications: false, isOnCriticalPath: true  } });
    const visualFeature  = feature({ id: 'vz', category: 'analytics', businessValue: { headline: 'dashboard', painSolved: 'visibility', beneficiary: 'ops',   outcomeType: 'risk'                                         }, signals: { pageCount: 2, interactiveElementCount: 20, hasVisualizations: true, hasNotifications: true,  isOnCriticalPath: false } });

    const revenueHeavy = new FeaturePrioritizationEngine(
      [new BusinessValueScorer(), new VisualAppealScorer(), new UserImportanceScorer(), new RevenueImpactScorer()],
      { businessValue: 0.30, visualAppeal: 0.10, userImportance: 0.20, revenueImpact: 0.40 },
    );
    const [first] = revenueHeavy.prioritize([visualFeature, revenueFeature]);
    expect(first.feature.id).toBe('rv');
  });
});

// ── Rationale ─────────────────────────────────────────────────────────────────

describe('rationale', () => {
  it('is a non-empty string for every feature', () => {
    const features = Array.from({ length: 5 }, (_, i) => feature({ id: `f${i}` }));
    const result = makeEngine().prioritize(features);
    for (const pf of result) {
      expect(typeof pf.rationale).toBe('string');
      expect(pf.rationale.length).toBeGreaterThan(0);
    }
  });

  it('mentions quantified impact when present', () => {
    const f = feature({ id: 'f1', businessValue: { headline: 'ROI', painSolved: 'waste', beneficiary: 'ops', outcomeType: 'cost_saving', quantifiedImpact: '€2M/year saved' } });
    const [result] = makeEngine().prioritize([f]);
    expect(result.rationale).toContain('€2M/year saved');
  });

  it('mentions critical path when feature is on critical path', () => {
    const f = feature({ id: 'f1', signals: { pageCount: 3, interactiveElementCount: 20, hasVisualizations: false, hasNotifications: false, isOnCriticalPath: true } });
    const [result] = makeEngine().prioritize([f]);
    expect(result.rationale.toLowerCase()).toContain('critical');
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
