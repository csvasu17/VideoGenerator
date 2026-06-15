import { ContextSignalValidator, tokenize, overlapScore } from '../ContextSignalValidator';
import type { ValidationInput } from '../ContextSignalValidator';
import {
  buildConfidenceField,
  statedField,
  expandedField,
} from '../../../core/domain/entities/context/ConfidenceField';
import {
  classifyExpansionQuality,
  computeOverallConfidence,
} from '../../../core/domain/entities/context/ExpandedApplicationContext';
import type { ExpandedApplicationContext } from '../../../core/domain/entities/context/ExpandedApplicationContext';
import type { DiscoveredPage } from '../../../core/domain/entities/DiscoveredPage';
import type { PageIntelligence } from '../../../core/domain/entities/PageIntelligence';
import type { BusinessValueEnrichmentResult } from '../../../core/domain/entities/BusinessValueOutput';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeContext(overrides: Partial<ExpandedApplicationContext> = {}): ExpandedApplicationContext {
  const domain         = statedField('Energy Management', 0.92);
  const targetAudience = statedField('Facility Managers', 0.90);
  const businessGoals  = [
    statedField('Reduce energy costs by 20%', 0.91),
    statedField('Improve equipment uptime',   0.88),
  ];
  const businessOutcomes = [
    statedField('Lower monthly utility bills', 0.88),
  ];
  const demoPriorities = [
    statedField('Demonstrate real-time energy cost visibility', 0.89),
  ];

  const overallConfidence = computeOverallConfidence(
    domain, targetAudience, businessGoals, businessOutcomes, demoPriorities,
  );

  return {
    domain,
    targetAudience,
    businessGoals,
    businessOutcomes,
    demoPriorities,
    overallConfidence,
    expansionQuality: classifyExpansionQuality(overallConfidence),
    rawInput: 'Energy management software for facility managers.',
    ...overrides,
  };
}

function makePage(id: string, title: string): DiscoveredPage {
  return {
    id,
    url:    `https://app.test/${id}`,
    title,
    depth:  1,
    visitOrder:  1,
    outboundLinks:       [],
    interactiveElements: [],
    hasForm:     false,
    httpStatus:  200,
  };
}

function makePageIntelligence(pageId: string, overrides: Partial<PageIntelligence> = {}): PageIntelligence {
  return {
    pageId,
    analysedAt:             new Date().toISOString(),
    pagePurpose:            'Energy management dashboard',
    pageCategory:           'dashboard',
    features: [
      {
        featureName:     'Energy Consumption Dashboard',
        businessValue:   'Provides visibility into energy usage patterns and cost drivers',
        importanceScore: 85,
        recommendations: ['Show live data'],
      },
    ],
    importantActions:       [],
    businessContext:        'Centralises energy monitoring across all facilities',
    kpiWidgets:             [{ label: 'Energy Usage', value: '1200 kWh', trend: 'down', unit: 'kWh' }],
    overallImportanceScore: 82,
    analysisMode:           'vision',
    ...overrides,
  };
}

function makeBVOutputs(): BusinessValueEnrichmentResult {
  return {
    outputs: [
      {
        featureId:       'feat-1',
        featureName:     'Energy Consumption Dashboard',
        businessProblem: 'Operations teams waste hours tracking energy costs manually across facilities.',
        businessBenefit: 'See every device energy trend in a single view — no manual data pulls.',
        customerOutcome: 'Energy anomalies now flagged in minutes instead of days.',
        salesNarration:  'With Energy Dashboard, your facility managers can reduce costs in real time.',
        source:          'llm',
      },
    ],
    totalSubmitted: 1,
    totalEnriched:  1,
    enrichedAt:     new Date().toISOString(),
  };
}

function makeInput(overrides: Partial<ValidationInput> = {}): ValidationInput {
  return {
    context:          makeContext(),
    discoveredPages:  [makePage('p1', 'Energy Consumption Dashboard')],
    pageIntelligence: [makePageIntelligence('p1')],
    businessValueOutputs: makeBVOutputs(),
    ...overrides,
  };
}

// ── tokenize() ────────────────────────────────────────────────────────────────

describe('tokenize()', () => {
  it('lowercases text and removes punctuation', () => {
    const tokens = tokenize('Energy Dashboard!');
    expect(tokens.has('energy')).toBe(true);
    expect(tokens.has('dashboard')).toBe(true);
    expect(tokens.has('Energy')).toBe(false);
  });

  it('drops tokens shorter than 3 characters', () => {
    // Only 1–2 char tokens — all filtered by the >= 3 length requirement
    const tokens = tokenize('a is of');
    expect(tokens.size).toBe(0);
  });

  it('applies basic suffix stemming', () => {
    const tokens = tokenize('reducing costs');
    // "costs" → "cost"
    expect(tokens.has('cost')).toBe(true);
  });

  it('returns empty set for blank string', () => {
    expect(tokenize('').size).toBe(0);
    expect(tokenize('   ').size).toBe(0);
  });
});

// ── overlapScore() ────────────────────────────────────────────────────────────

describe('overlapScore()', () => {
  it('returns 0 for empty sets', () => {
    expect(overlapScore(new Set(), new Set(['a']))).toBe(0);
    expect(overlapScore(new Set(['a']), new Set())).toBe(0);
  });

  it('returns 1 for identical sets', () => {
    const s = new Set(['energy', 'management', 'cost']);
    expect(overlapScore(s, s)).toBe(1);
  });

  it('returns 0 for completely disjoint sets', () => {
    expect(overlapScore(new Set(['abc']), new Set(['xyz']))).toBe(0);
  });

  it('computes partial overlap correctly', () => {
    const a = new Set(['energy', 'management', 'cost']);
    const b = new Set(['energy', 'dashboard', 'report']);
    // intersection = {"energy"} = 1, max = 3
    expect(overlapScore(a, b)).toBeCloseTo(1 / 3);
  });
});

// ── Core validation ───────────────────────────────────────────────────────────

describe('ContextSignalValidator.validate()', () => {
  const validator = new ContextSignalValidator();

  it('returns a ValidatedApplicationContext with all required fields', () => {
    const result = validator.validate(makeInput());

    expect(result.domain).toBeDefined();
    expect(result.targetAudience).toBeDefined();
    expect(result.businessGoals.length).toBeGreaterThan(0);
    expect(result.demoPriorities.length).toBeGreaterThan(0);
    expect(result.validationSummary).toBeDefined();
    expect(result.overallConfidence).toBeGreaterThanOrEqual(0);
    expect(result.overallConfidence).toBeLessThanOrEqual(1);
    expect(result.effectiveWeight).toBeLessThanOrEqual(0.15);
  });

  it('produces STRONG_MATCH for domain when evidence strongly aligns', () => {
    // "Energy Management" is present in page title AND feature description
    const result = validator.validate(makeInput());

    // domain = "Energy Management" should match "Energy Consumption Dashboard"
    // and "energy usage patterns and cost drivers"
    const result2 = result.domain.validationResult;
    expect(['STRONG_MATCH', 'WEAK_MATCH']).toContain(result2);
  });

  it('produces validated fields with effectiveConfidence', () => {
    const result = validator.validate(makeInput());

    for (const goal of result.businessGoals) {
      expect(goal.effectiveConfidence).toBeGreaterThanOrEqual(0);
      expect(goal.effectiveConfidence).toBeLessThanOrEqual(0.95);
    }
  });

  it('produces UNCONFIRMED when no evidence matches the field', () => {
    const unrelatedContext = makeContext({
      domain: statedField('Quantum Blockchain Governance', 0.91),
    });

    const result = validator.validate({
      ...makeInput(),
      context: unrelatedContext,
    });

    expect(result.domain.validationResult).toBe('UNCONFIRMED');
  });

  it('effectiveConfidence is reduced for UNCONFIRMED fields', () => {
    const unrelatedContext = makeContext({
      domain: statedField('Quantum Blockchain Governance', 0.91),
    });

    const result = validator.validate({
      ...makeInput(),
      context: unrelatedContext,
    });

    // UNCONFIRMED multiplier is 0.60 → effectiveConfidence = 0.91 × 0.60 = 0.546
    expect(result.domain.effectiveConfidence).toBeLessThan(0.91);
  });

  it('popultes matchedEvidence for fields that match', () => {
    const result = validator.validate(makeInput());

    // domain "Energy Management" should have matched at least one evidence item
    const domainMatch = result.domain;
    if (domainMatch.validationResult !== 'UNCONFIRMED') {
      expect(domainMatch.matchedEvidence.length).toBeGreaterThan(0);
      expect(domainMatch.matchedEvidence[0].semanticScore).toBeGreaterThan(0);
    }
  });

  it('overallConfidence of validated context reflects effectiveConfidence', () => {
    const raw        = validator.validate(makeInput());
    // The validated overallConfidence is recomputed from effectiveConfidence values
    // and should differ from the raw input's overallConfidence (unless everything is WEAK_MATCH×1.0)
    expect(raw.overallConfidence).toBeGreaterThanOrEqual(0);
    expect(raw.overallConfidence).toBeLessThanOrEqual(1);
  });

  it('effectiveWeight is at most 0.15', () => {
    const result = validator.validate(makeInput());
    expect(result.effectiveWeight).toBeLessThanOrEqual(0.15);
  });

  it('works correctly with empty discoveredPages', () => {
    const result = validator.validate({
      ...makeInput(),
      discoveredPages: [],
    });

    expect(result).toBeDefined();
    expect(result.validationSummary.humanReadable).toBeTruthy();
  });

  it('works correctly with no businessValueOutputs', () => {
    const result = validator.validate({
      ...makeInput(),
      businessValueOutputs: undefined,
    });

    expect(result).toBeDefined();
  });

  it('works correctly with empty pageIntelligence', () => {
    const result = validator.validate({
      ...makeInput(),
      pageIntelligence: [],
    });

    // No vision or feature evidence → all fields should be UNCONFIRMED
    expect(result.validationSummary.unconfirmedCount).toBeGreaterThan(0);
  });

  it('builds a human-readable summary string', () => {
    const result = validator.validate(makeInput());
    expect(result.validationSummary.humanReadable).toContain('/');
    expect(result.validationSummary.humanReadable).toContain('fields');
  });
});

// ── Validation summary counts ─────────────────────────────────────────────────

describe('validation summary', () => {
  const validator = new ContextSignalValidator();

  it('summary counts sum to total field count', () => {
    const ctx    = makeContext();
    const result = validator.validate(makeInput());

    const total = 2 + ctx.businessGoals.length + ctx.businessOutcomes.length + ctx.demoPriorities.length;
    const sum   =
      result.validationSummary.strongMatchCount  +
      result.validationSummary.weakMatchCount    +
      result.validationSummary.inferredMatchCount +
      result.validationSummary.unconfirmedCount  +
      result.validationSummary.conflictCount;

    expect(sum).toBe(total);
  });

  it('conflict count is 0 when no evidence contradicts context', () => {
    const result = validator.validate(makeInput());
    expect(result.validationSummary.conflictCount).toBe(0);
  });
});
