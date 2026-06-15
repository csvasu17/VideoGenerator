// ─────────────────────────────────────────────────────────────────────────────
// BusinessValueAgent — unit tests
//
// Test strategy:
//  • All LLM calls use a mock ILLMProvider that returns pre-canned strings.
//  • No file I/O, no network calls, no Playwright dependency.
//  • Tests are grouped by behaviour category.
// ─────────────────────────────────────────────────────────────────────────────

import { BusinessValueAgent, type BusinessValueAgentConfig } from '../BusinessValueAgent';
import { BusinessValueResponseParser }                        from '../BusinessValueResponseParser';
import { buildFallback, KEYWORD_TEMPLATES }                   from '../BusinessValueFallback';
import type { ILLMProvider }                                  from '../../../core/ports/services/ILLMProvider';
import type { PrioritizedFeature }                            from '../../../core/domain/entities/PrioritizedFeature';
import type { Feature }                                       from '../../../core/domain/entities/Feature';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

let idCounter = 0;
function makeFeature(overrides: Partial<Feature> = {}): Feature {
  const id = `feature-${++idCounter}`;
  return {
    id,
    name:               overrides.name                ?? `Feature ${id}`,
    summary:            overrides.summary             ?? 'A useful capability',
    detailedDescription: overrides.detailedDescription ?? '',
    category:           overrides.category            ?? 'analytics',
    businessValue: {
      headline:         'Existing headline',
      painSolved:       'Existing pain',
      beneficiary:      'team',
      outcomeType:      'efficiency',
      quantifiedImpact: 'saves time',
      ...overrides.businessValue,
    },
    signals: {
      pageCount:               1,
      interactiveElementCount: 2,
      hasVisualizations:       true,
      hasNotifications:        false,
      isOnCriticalPath:        true,
      ...overrides.signals,
    },
    relatedFeatureIds: [],
    pageIds:           ['page-1'],
    ...overrides,
  };
}

function makePrioritizedFeature(
  featureOverrides: Partial<Feature>      = {},
  pfOverrides: Partial<PrioritizedFeature> = {},
): PrioritizedFeature {
  const feature = makeFeature(featureOverrides);
  return {
    feature,
    scores: {
      businessValue:   70,
      visualAppeal:    65,
      userImportance:  80,
      revenueImpact:   60,
    },
    composite: 70,
    rank:      1,
    rationale: 'High user importance',
    ...pfOverrides,
  };
}

/** Build a valid LLM JSON response for the given features. */
function buildLLMResponse(features: PrioritizedFeature[]): string {
  return JSON.stringify(
    features.map(pf => ({
      featureId:       pf.feature.id,
      businessProblem: `Problem for ${pf.feature.name}`,
      businessBenefit: `Benefit for ${pf.feature.name}`,
      customerOutcome: `Outcome for ${pf.feature.name}`,
      salesNarration:  `With ${pf.feature.name}, your team can do great things. This changes everything.`,
    })),
    null,
    2,
  );
}

/** Mock LLM provider. */
class MockLLMProvider implements ILLMProvider {
  readonly modelId        = 'mock-model';
  readonly supportsVision = false;

  private readonly responses: string[];
  private callCount = 0;

  constructor(responses: string | string[]) {
    this.responses = Array.isArray(responses) ? responses : [responses];
  }

  async complete(): Promise<string> {
    const idx = Math.min(this.callCount, this.responses.length - 1);
    this.callCount++;
    return this.responses[idx];
  }

  get calls(): number { return this.callCount; }
}

/** Mock LLM that throws on every call. */
class FailingLLMProvider implements ILLMProvider {
  readonly modelId        = 'failing-model';
  readonly supportsVision = false;

  async complete(): Promise<string> {
    throw new Error('LLM unavailable');
  }
}

/** Mock LLM that fails N times then succeeds. */
class TransientLLMProvider implements ILLMProvider {
  readonly modelId        = 'transient-model';
  readonly supportsVision = false;

  private calls = 0;

  constructor(
    private readonly failCount: number,
    private readonly successResponse: string,
  ) {}

  async complete(): Promise<string> {
    this.calls++;
    if (this.calls <= this.failCount) throw new Error(`Transient failure ${this.calls}`);
    return this.successResponse;
  }

  get callCount(): number { return this.calls; }
}

const PROMPT_TEMPLATE = 'Enrich these features: {{FEATURE_BATCH}} for {{PRODUCT_NAME}} targeting {{TARGET_AUDIENCE}}';

function makeAgent(
  provider: ILLMProvider,
  config: Partial<BusinessValueAgentConfig> = {},
): BusinessValueAgent {
  return new BusinessValueAgent(
    provider,
    PROMPT_TEMPLATE,
    new BusinessValueResponseParser(),
    { retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, jitter: false }, ...config },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests — enrich() happy path
// ─────────────────────────────────────────────────────────────────────────────

describe('BusinessValueAgent.enrich() — happy path', () => {
  it('returns one output per input feature', async () => {
    const features = [makePrioritizedFeature(), makePrioritizedFeature(), makePrioritizedFeature()];
    const llm      = new MockLLMProvider(buildLLMResponse(features));
    const agent    = makeAgent(llm);

    const result = await agent.enrich(features);

    expect(result.totalSubmitted).toBe(3);
    expect(result.outputs).toHaveLength(3);
  });

  it('marks all LLM-sourced outputs with source === "llm"', async () => {
    const features = [makePrioritizedFeature(), makePrioritizedFeature()];
    const llm      = new MockLLMProvider(buildLLMResponse(features));
    const agent    = makeAgent(llm);

    const result = await agent.enrich(features);

    expect(result.totalEnriched).toBe(2);
    result.outputs.forEach(out => expect(out.source).toBe('llm'));
  });

  it('enriched copy differs from existing feature metadata', async () => {
    const pf   = makePrioritizedFeature({ businessValue: { headline: 'OLD HEADLINE', painSolved: '', beneficiary: 'team', outcomeType: 'efficiency' } });
    const llm  = new MockLLMProvider(buildLLMResponse([pf]));
    const agent = makeAgent(llm);

    const result = await agent.enrich([pf]);

    expect(result.outputs[0].businessBenefit).not.toBe('OLD HEADLINE');
    expect(result.outputs[0].businessBenefit).toContain('Benefit for');
  });

  it('returns the four required output fields for every record', async () => {
    const features = [makePrioritizedFeature()];
    const llm      = new MockLLMProvider(buildLLMResponse(features));
    const agent    = makeAgent(llm);

    const result  = await agent.enrich(features);
    const output  = result.outputs[0];

    expect(output.businessProblem).toBeTruthy();
    expect(output.businessBenefit).toBeTruthy();
    expect(output.customerOutcome).toBeTruthy();
    expect(output.salesNarration).toBeTruthy();
    expect(output.featureId).toBe(features[0].feature.id);
    expect(output.featureName).toBe(features[0].feature.name);
  });

  it('handles an empty feature array without calling the LLM', async () => {
    const llm   = new MockLLMProvider('');
    const agent = makeAgent(llm);

    const result = await agent.enrich([]);

    expect(result.totalSubmitted).toBe(0);
    expect(result.outputs).toHaveLength(0);
    expect(llm.calls).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — partial LLM response (LLM omits some features)
// ─────────────────────────────────────────────────────────────────────────────

describe('BusinessValueAgent.enrich() — partial LLM response', () => {
  it('falls back for features missing from the LLM response', async () => {
    const features = [makePrioritizedFeature(), makePrioritizedFeature()];
    // LLM only returns the first feature
    const partialResponse = JSON.stringify([
      {
        featureId:       features[0].feature.id,
        businessProblem: 'Problem for first',
        businessBenefit: 'Benefit for first',
        customerOutcome: 'Outcome for first',
        salesNarration:  'Narration for first.',
      },
    ]);
    const llm   = new MockLLMProvider(partialResponse);
    const agent = makeAgent(llm);

    const result = await agent.enrich(features);

    expect(result.outputs[0].source).toBe('llm');
    expect(result.outputs[1].source).toBe('fallback');
    expect(result.totalEnriched).toBe(1);
  });

  it('preserves feature metadata in fallback output', async () => {
    const pf = makePrioritizedFeature({ name: 'Export CSV' });
    // LLM returns empty array
    const llm   = new MockLLMProvider('[]');
    const agent = makeAgent(llm);

    const result = await agent.enrich([pf]);

    expect(result.outputs[0].source).toBe('fallback');
    expect(result.outputs[0].featureId).toBe(pf.feature.id);
    expect(result.outputs[0].featureName).toBe('Export CSV');
  });

  it('reports correct totalEnriched vs totalSubmitted counts', async () => {
    const features = [makePrioritizedFeature(), makePrioritizedFeature(), makePrioritizedFeature()];
    // LLM returns only 2 of 3
    const partial = JSON.stringify([
      { featureId: features[0].feature.id, businessProblem: 'P', businessBenefit: 'B', customerOutcome: 'O', salesNarration: 'S.' },
      { featureId: features[2].feature.id, businessProblem: 'P', businessBenefit: 'B', customerOutcome: 'O', salesNarration: 'S.' },
    ]);
    const llm   = new MockLLMProvider(partial);
    const agent = makeAgent(llm);

    const result = await agent.enrich(features);

    expect(result.totalSubmitted).toBe(3);
    expect(result.totalEnriched).toBe(2);
    expect(result.outputs.filter(o => o.source === 'fallback')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — LLM failures
// ─────────────────────────────────────────────────────────────────────────────

describe('BusinessValueAgent.enrich() — LLM failures', () => {
  it('never rejects when all LLM calls fail', async () => {
    const features = [makePrioritizedFeature(), makePrioritizedFeature()];
    const agent    = makeAgent(new FailingLLMProvider());

    await expect(agent.enrich(features)).resolves.not.toThrow();
  });

  it('returns fallback for all features when LLM always fails', async () => {
    const features = [makePrioritizedFeature(), makePrioritizedFeature()];
    const agent    = makeAgent(new FailingLLMProvider());

    const result = await agent.enrich(features);

    expect(result.totalEnriched).toBe(0);
    result.outputs.forEach(out => expect(out.source).toBe('fallback'));
    result.outputs.forEach(out => {
      expect(out.businessProblem).toBeTruthy();
      expect(out.salesNarration).toBeTruthy();
    });
  });

  it('returns fallback when LLM returns invalid JSON', async () => {
    const features = [makePrioritizedFeature()];
    const llm      = new MockLLMProvider('This is not valid JSON at all!');
    const agent    = makeAgent(llm);

    const result = await agent.enrich(features);

    expect(result.totalEnriched).toBe(0);
    expect(result.outputs[0].source).toBe('fallback');
  });

  it('retries on transient failure and succeeds', async () => {
    const features = [makePrioritizedFeature()];
    const llm      = new TransientLLMProvider(1, buildLLMResponse(features));
    const agent    = makeAgent(llm);

    const result = await agent.enrich(features);

    expect(result.totalEnriched).toBe(1);
    expect(llm.callCount).toBe(2);  // 1 failure + 1 success
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — batching
// ─────────────────────────────────────────────────────────────────────────────

describe('BusinessValueAgent.enrich() — batching', () => {
  it('chunks features into correct batch sizes', async () => {
    const features = Array.from({ length: 5 }, () => makePrioritizedFeature());

    const responses: string[] = [];
    for (let i = 0; i < 3; i++) {
      responses.push(buildLLMResponse(
        features.slice(i * 2, Math.min((i + 1) * 2, features.length))
      ));
    }
    const llm   = new MockLLMProvider(responses);
    const agent = makeAgent(llm, { batchSize: 2, concurrency: 1 });

    const result = await agent.enrich(features);

    // 5 features / batchSize 2 = 3 batches
    expect(llm.calls).toBe(3);
    expect(result.totalSubmitted).toBe(5);
    expect(result.outputs).toHaveLength(5);
  });

  it('uses single batch when features count ≤ batchSize', async () => {
    const features = [makePrioritizedFeature(), makePrioritizedFeature()];
    const llm      = new MockLLMProvider(buildLLMResponse(features));
    const agent    = makeAgent(llm, { batchSize: 8 });

    await agent.enrich(features);

    expect(llm.calls).toBe(1);
  });

  it('handles individual batch failure gracefully (other batches still succeed)', async () => {
    const features = [
      makePrioritizedFeature({ name: 'Feature A' }),
      makePrioritizedFeature({ name: 'Feature B' }),
      makePrioritizedFeature({ name: 'Feature C' }),
    ];

    // Batch 1 (A,B) fails; batch 2 (C) succeeds
    let callN = 0;
    const provider: ILLMProvider = {
      modelId: 'partial', supportsVision: false,
      complete: async () => {
        callN++;
        if (callN === 1) throw new Error('Batch 1 failed');
        return buildLLMResponse([features[2]]);
      },
    };

    const agent = makeAgent(provider, { batchSize: 2, concurrency: 1 });
    const result = await agent.enrich(features);

    expect(result.outputs).toHaveLength(3);
    // A and B fallback (batch 1 failed), C enriched (batch 2 succeeded)
    expect(result.outputs[0].source).toBe('fallback');
    expect(result.outputs[1].source).toBe('fallback');
    expect(result.outputs[2].source).toBe('llm');
    expect(result.totalEnriched).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — buildFallback()
// ─────────────────────────────────────────────────────────────────────────────

describe('buildFallback()', () => {
  it('returns source === "fallback"', () => {
    const pf  = makePrioritizedFeature({ name: 'Unknown Feature' });
    const out = buildFallback(pf);
    expect(out.source).toBe('fallback');
  });

  it('returns all four required fields as non-empty strings', () => {
    const pf  = makePrioritizedFeature();
    const out = buildFallback(pf);
    expect(out.businessProblem).toBeTruthy();
    expect(out.businessBenefit).toBeTruthy();
    expect(out.customerOutcome).toBeTruthy();
    expect(out.salesNarration).toBeTruthy();
  });

  it('uses keyword template for Export CSV', () => {
    const pf  = makePrioritizedFeature({ name: 'Export CSV Report' });
    const out = buildFallback(pf);
    // Should hit the export/csv pattern
    expect(out.businessProblem).toContain('stakeholder');
    expect(out.salesNarration).toContain('Export');
  });

  it('uses keyword template for Alarm monitoring', () => {
    const pf  = makePrioritizedFeature({ name: 'Active Alarm Feed' });
    const out = buildFallback(pf);
    expect(out.businessProblem).toMatch(/fault|outage/i);
  });

  it('uses category template for analytics features with no keyword match', () => {
    const pf = makePrioritizedFeature(
      { name: 'Something Unusual', category: 'analytics' },
    );
    const out = buildFallback(pf);
    expect(out.businessProblem).toBeTruthy();
    expect(out.salesNarration).toBeTruthy();
  });

  it('preserves featureId correlation', () => {
    const pf  = makePrioritizedFeature({ name: 'My Feature' });
    const out = buildFallback(pf);
    expect(out.featureId).toBe(pf.feature.id);
    expect(out.featureName).toBe('My Feature');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — BusinessValueResponseParser
// ─────────────────────────────────────────────────────────────────────────────

describe('BusinessValueResponseParser', () => {
  const parser = new BusinessValueResponseParser();

  const VALID_ID = 'test-feature-id';
  const VALID_ITEM = {
    featureId:       VALID_ID,
    businessProblem: 'A problem',
    businessBenefit: 'A benefit',
    customerOutcome: 'An outcome',
    salesNarration:  'Narration.',
  };

  it('parses a plain JSON array', () => {
    const raw    = JSON.stringify([VALID_ITEM]);
    const result = parser.parse(raw, [VALID_ID]);
    expect(result).toHaveLength(1);
    expect(result[0].featureId).toBe(VALID_ID);
  });

  it('parses JSON inside markdown code fences', () => {
    const raw    = '```json\n' + JSON.stringify([VALID_ITEM]) + '\n```';
    const result = parser.parse(raw, [VALID_ID]);
    expect(result).toHaveLength(1);
  });

  it('parses JSON surrounded by extra explanation text', () => {
    const raw    = 'Here is the enriched data:\n' + JSON.stringify([VALID_ITEM]) + '\nEnd of output.';
    const result = parser.parse(raw, [VALID_ID]);
    expect(result).toHaveLength(1);
  });

  it('discards items whose featureId is not in the submitted list', () => {
    const raw    = JSON.stringify([{ ...VALID_ITEM, featureId: 'unknown-id' }]);
    const result = parser.parse(raw, [VALID_ID]);
    expect(result).toHaveLength(0);
  });

  it('returns empty array for completely unparseable input', () => {
    const result = parser.parse('This is not JSON at all.', [VALID_ID]);
    expect(result).toHaveLength(0);
  });

  it('coerces missing fields to empty strings', () => {
    const raw    = JSON.stringify([{ featureId: VALID_ID }]);
    const result = parser.parse(raw, [VALID_ID]);
    expect(result[0].businessProblem).toBe('');
    expect(result[0].salesNarration).toBe('');
  });

  it('handles multiple valid items in order', () => {
    const id1 = 'id-one', id2 = 'id-two';
    const raw  = JSON.stringify([
      { ...VALID_ITEM, featureId: id1, businessBenefit: 'Benefit 1' },
      { ...VALID_ITEM, featureId: id2, businessBenefit: 'Benefit 2' },
    ]);
    const result = parser.parse(raw, [id1, id2]);
    expect(result).toHaveLength(2);
    expect(result[0].featureId).toBe(id1);
    expect(result[1].featureId).toBe(id2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — KEYWORD_TEMPLATES coverage
// ─────────────────────────────────────────────────────────────────────────────

describe('KEYWORD_TEMPLATES', () => {
  const testCases: Array<[string, RegExp]> = [
    ['Export to CSV',          /stakeholder/i],
    ['Analytics Dashboard',    /manual|check/i],
    ['Real-Time Alarm Feed',   /fault|outage/i],
    ['Energy Consumption Chart', /cost-saving|waste|baseline/i],
    ['Temperature Sensor',      /drift|outage/i],
    ['Device Fleet Status',     /site|manual/i],
    ['Live Telemetry',          /field|sensor/i],
    ['User Role Management',    /access|complian/i],
  ];

  test.each(testCases)('%s matches the correct template', (name, expectedProblemPattern) => {
    const pf  = makePrioritizedFeature({ name });
    const out = buildFallback(pf);
    expect(out.businessProblem).toMatch(expectedProblemPattern);
    expect(out.source).toBe('fallback');
  });
});
