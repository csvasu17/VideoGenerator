import { ContextExpansionAgent } from '../ContextExpansionAgent';
import { MockLLMProvider } from '../../../infrastructure/llm/MockLLMProvider';
import type { ExpandedApplicationContext } from '../../../core/domain/entities/context/ExpandedApplicationContext';

// ── Constants ─────────────────────────────────────────────────────────────────

const PROMPT_TEMPLATE = 'Expand this context: {{RAW_CONTEXT}}';

/** No-delay retry config for unit tests. */
const FAST_RETRY = { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, jitter: false };

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A realistic LLM response for a typical single-sentence input. */
function buildTypicalResponse(): string {
  return JSON.stringify({
    domain: {
      value:      'Energy Management for Commercial Buildings',
      confidence: 0.92,
      provenance: 'STATED',
    },
    targetAudience: {
      value:      'Facility Managers',
      confidence: 0.90,
      provenance: 'STATED',
    },
    businessGoals: [
      { value: 'Reduce energy costs by 20% over the next year',       confidence: 0.91, provenance: 'STATED'   },
      { value: 'Improve equipment uptime and reduce unplanned outages', confidence: 0.72, provenance: 'INFERRED' },
      { value: 'Simplify compliance reporting for energy regulations',  confidence: 0.65, provenance: 'EXPANDED' },
    ],
    businessOutcomes: [
      { value: 'Lower monthly utility bills across all facilities',   confidence: 0.88, provenance: 'STATED'   },
      { value: 'Maintenance costs reduced through proactive alerts',  confidence: 0.70, provenance: 'INFERRED' },
    ],
    demoPriorities: [
      { value: 'Demonstrate real-time energy cost visibility across facilities', confidence: 0.89, provenance: 'STATED'   },
      { value: 'Show how quickly equipment issues can be identified before failures', confidence: 0.68, provenance: 'INFERRED' },
    ],
  });
}

/** LLM response where businessGoals and demoPriorities each have exactly 1 item. */
function buildMinimalResponse(): string {
  return JSON.stringify({
    domain:         { value: 'Healthcare Revenue Cycle', confidence: 0.88, provenance: 'STATED'   },
    targetAudience: { value: 'Revenue Cycle Analysts',   confidence: 0.85, provenance: 'STATED'   },
    businessGoals:  [{ value: 'Reduce claim denial rates', confidence: 0.90, provenance: 'STATED' }],
    businessOutcomes: [],
    demoPriorities: [{ value: 'Demonstrate claim status visibility at a glance', confidence: 0.82, provenance: 'INFERRED' }],
  });
}

function makeAgent(
  llm:            MockLLMProvider,
  configOverrides: Record<string, unknown> = {},
): ContextExpansionAgent {
  return new ContextExpansionAgent(
    llm,
    PROMPT_TEMPLATE,
    { retry: FAST_RETRY, ...configOverrides },
  );
}

// ── Typical input ─────────────────────────────────────────────────────────────

describe('typical input', () => {
  it('returns an ExpandedApplicationContext for a real-world sentence', async () => {
    const llm   = new MockLLMProvider(buildTypicalResponse());
    const agent = makeAgent(llm);

    const result = await agent.expand({
      rawText: 'We sell energy management software to facility managers who want to reduce energy costs.',
    });

    expect(result).not.toBeNull();
    const ctx = result as ExpandedApplicationContext;
    expect(ctx.domain.value).toBe('Energy Management for Commercial Buildings');
    expect(ctx.targetAudience.value).toBe('Facility Managers');
    expect(ctx.businessGoals.length).toBe(3);
    expect(ctx.demoPriorities.length).toBe(2);
    expect(ctx.rawInput).toBe(
      'We sell energy management software to facility managers who want to reduce energy costs.',
    );
  });

  it('calls the LLM exactly once for a single expansion', async () => {
    const llm   = new MockLLMProvider(buildTypicalResponse());
    const agent = makeAgent(llm);

    await agent.expand({ rawText: 'Energy management for facility managers.' });

    expect(llm.calls).toBe(1);
  });

  it('injects rawText into the prompt template via {{RAW_CONTEXT}}', async () => {
    const llm       = new MockLLMProvider(buildTypicalResponse());
    const completeSpy = jest.spyOn(llm, 'complete');
    const agent     = makeAgent(llm);

    const input = 'Energy management for buildings.';
    await agent.expand({ rawText: input });

    const [messages] = completeSpy.mock.calls[0];
    const textBlock  = messages[0].content.find((c: { type: string }) => c.type === 'text');
    expect((textBlock as { type: string; text: string } | undefined)?.text).toContain(input);
  });

  it('returns non-null overallConfidence > 0 for typical input', async () => {
    const llm   = new MockLLMProvider(buildTypicalResponse());
    const agent = makeAgent(llm);

    const result = await agent.expand({ rawText: 'Energy management for facility managers.' });

    expect(result?.overallConfidence).toBeGreaterThan(0);
    expect(result?.overallConfidence).toBeLessThanOrEqual(1);
  });

  it('sets expansionQuality based on overallConfidence', async () => {
    const llm   = new MockLLMProvider(buildTypicalResponse());
    const agent = makeAgent(llm);

    const result = await agent.expand({ rawText: 'Energy management for facility managers.' });

    // Typical response has high STATED/INFERRED confidence → RICH or ADEQUATE
    expect(['RICH', 'ADEQUATE']).toContain(result?.expansionQuality);
  });

  it('preserves rawInput verbatim', async () => {
    const llm   = new MockLLMProvider(buildTypicalResponse());
    const agent = makeAgent(llm);
    const input = '  Leading spaces and trailing spaces.  ';

    const result = await agent.expand({ rawText: input });

    // rawInput should be the trimmed version (agent trims before LLM call)
    expect(result?.rawInput).toBe(input.trim());
  });
});

// ── Empty / blank input ───────────────────────────────────────────────────────

describe('empty and blank input', () => {
  it('returns null for empty string without calling the LLM', async () => {
    const llm   = new MockLLMProvider(buildTypicalResponse());
    const agent = makeAgent(llm);

    const result = await agent.expand({ rawText: '' });

    expect(result).toBeNull();
    expect(llm.calls).toBe(0);
  });

  it('returns null for whitespace-only string without calling the LLM', async () => {
    const llm   = new MockLLMProvider(buildTypicalResponse());
    const agent = makeAgent(llm);

    const result = await agent.expand({ rawText: '   \n\t  ' });

    expect(result).toBeNull();
    expect(llm.calls).toBe(0);
  });
});

// ── Error handling — never throws ────────────────────────────────────────────

describe('error handling', () => {
  it('returns null when the LLM throws, without rethrowing', async () => {
    const llm = new MockLLMProvider();
    jest.spyOn(llm, 'complete').mockRejectedValue(new Error('API unavailable'));
    const agent = makeAgent(llm);

    const result = await agent.expand({ rawText: 'Some valid input.' });

    expect(result).toBeNull();
  });

  it('returns null when the LLM returns non-JSON text', async () => {
    const llm   = new MockLLMProvider('Sorry, I cannot help with that request.');
    const agent = makeAgent(llm);

    const result = await agent.expand({ rawText: 'Some valid input.' });

    expect(result).toBeNull();
  });

  it('returns null when the LLM returns JSON missing required fields', async () => {
    const incomplete = JSON.stringify({
      domain: { value: 'Energy', confidence: 0.9, provenance: 'STATED' },
      // targetAudience missing entirely
      businessGoals: [{ value: 'Cut costs', confidence: 0.9, provenance: 'STATED' }],
      demoPriorities: [{ value: 'Show savings', confidence: 0.8, provenance: 'INFERRED' }],
    });
    const llm   = new MockLLMProvider(incomplete);
    const agent = makeAgent(llm);

    const result = await agent.expand({ rawText: 'Some valid input.' });

    expect(result).toBeNull();
  });

  it('returns null when businessGoals is empty after parsing', async () => {
    const noGoals = JSON.stringify({
      domain:         { value: 'Energy',           confidence: 0.9, provenance: 'STATED' },
      targetAudience: { value: 'Facility Managers', confidence: 0.9, provenance: 'STATED' },
      businessGoals:  [],
      businessOutcomes: [],
      demoPriorities: [{ value: 'Show cost savings', confidence: 0.8, provenance: 'INFERRED' }],
    });
    const llm   = new MockLLMProvider(noGoals);
    const agent = makeAgent(llm);

    const result = await agent.expand({ rawText: 'Some valid input.' });

    expect(result).toBeNull();
  });

  it('returns null when demoPriorities is empty after parsing', async () => {
    const noPriorities = JSON.stringify({
      domain:         { value: 'Energy',           confidence: 0.9, provenance: 'STATED' },
      targetAudience: { value: 'Facility Managers', confidence: 0.9, provenance: 'STATED' },
      businessGoals:  [{ value: 'Cut costs', confidence: 0.9, provenance: 'STATED' }],
      businessOutcomes: [],
      demoPriorities:  [],
    });
    const llm   = new MockLLMProvider(noPriorities);
    const agent = makeAgent(llm);

    const result = await agent.expand({ rawText: 'Some valid input.' });

    expect(result).toBeNull();
  });

  it('does not throw — resolves to null even on repeated parse errors', async () => {
    const llm = new MockLLMProvider('{ not valid json }');
    const agent = makeAgent(llm, { retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, jitter: false } });

    await expect(agent.expand({ rawText: 'Some input.' })).resolves.toBeNull();
  });
});

// ── Confidence clamping ───────────────────────────────────────────────────────

describe('confidence clamping', () => {
  it('clamps EXPANDED fields to max 0.75', async () => {
    const highExpanded = JSON.stringify({
      domain:         { value: 'Energy', confidence: 0.99, provenance: 'EXPANDED' },
      targetAudience: { value: 'Managers', confidence: 0.99, provenance: 'EXPANDED' },
      businessGoals:  [{ value: 'Cut costs', confidence: 0.99, provenance: 'EXPANDED' }],
      businessOutcomes: [],
      demoPriorities: [{ value: 'Show savings', confidence: 0.99, provenance: 'EXPANDED' }],
    });
    const llm   = new MockLLMProvider(highExpanded);
    const agent = makeAgent(llm);

    const result = await agent.expand({ rawText: 'Valid input.' });

    expect(result?.domain.confidence).toBeLessThanOrEqual(0.75);
    expect(result?.targetAudience.confidence).toBeLessThanOrEqual(0.75);
    expect(result?.businessGoals[0].confidence).toBeLessThanOrEqual(0.75);
  });

  it('clamps STATED fields to min 0.85', async () => {
    const lowStated = JSON.stringify({
      domain:         { value: 'Energy', confidence: 0.10, provenance: 'STATED' },
      targetAudience: { value: 'Managers', confidence: 0.10, provenance: 'STATED' },
      businessGoals:  [{ value: 'Cut costs', confidence: 0.10, provenance: 'STATED' }],
      businessOutcomes: [],
      demoPriorities: [{ value: 'Show savings', confidence: 0.10, provenance: 'STATED' }],
    });
    const llm   = new MockLLMProvider(lowStated);
    const agent = makeAgent(llm);

    const result = await agent.expand({ rawText: 'Valid input.' });

    expect(result?.domain.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result?.targetAudience.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('clamps INFERRED fields within 0.60–0.80', async () => {
    const extremeInferred = JSON.stringify({
      domain:         { value: 'Energy',   confidence: 0.99, provenance: 'INFERRED' },
      targetAudience: { value: 'Managers', confidence: 0.01, provenance: 'INFERRED' },
      businessGoals:  [{ value: 'Cut costs', confidence: 0.50, provenance: 'INFERRED' }],
      businessOutcomes: [],
      demoPriorities: [{ value: 'Show savings', confidence: 0.95, provenance: 'INFERRED' }],
    });
    const llm   = new MockLLMProvider(extremeInferred);
    const agent = makeAgent(llm);

    const result = await agent.expand({ rawText: 'Valid input.' });

    expect(result?.domain.confidence).toBeLessThanOrEqual(0.80);
    expect(result?.targetAudience.confidence).toBeGreaterThanOrEqual(0.60);
  });
});

// ── Array limits ──────────────────────────────────────────────────────────────

describe('array limits', () => {
  it('caps businessGoals at 5 items even when LLM returns more', async () => {
    const tooMany = JSON.stringify({
      domain:         { value: 'Energy',   confidence: 0.9, provenance: 'STATED' },
      targetAudience: { value: 'Managers', confidence: 0.9, provenance: 'STATED' },
      businessGoals: Array.from({ length: 10 }, (_, i) => ({
        value: `Goal ${i + 1}`, confidence: 0.9, provenance: 'STATED',
      })),
      businessOutcomes: [],
      demoPriorities: [{ value: 'Show savings', confidence: 0.8, provenance: 'INFERRED' }],
    });
    const llm   = new MockLLMProvider(tooMany);
    const agent = makeAgent(llm);

    const result = await agent.expand({ rawText: 'Valid input.' });

    expect(result?.businessGoals.length).toBeLessThanOrEqual(5);
  });

  it('caps demoPriorities at 3 items even when LLM returns more', async () => {
    const tooMany = JSON.stringify({
      domain:         { value: 'Energy',   confidence: 0.9, provenance: 'STATED' },
      targetAudience: { value: 'Managers', confidence: 0.9, provenance: 'STATED' },
      businessGoals: [{ value: 'Cut costs', confidence: 0.9, provenance: 'STATED' }],
      businessOutcomes: [],
      demoPriorities: Array.from({ length: 8 }, (_, i) => ({
        value: `Priority ${i + 1}`, confidence: 0.8, provenance: 'INFERRED',
      })),
    });
    const llm   = new MockLLMProvider(tooMany);
    const agent = makeAgent(llm);

    const result = await agent.expand({ rawText: 'Valid input.' });

    expect(result?.demoPriorities.length).toBeLessThanOrEqual(3);
  });

  it('caps businessOutcomes at 5 items', async () => {
    const tooMany = JSON.stringify({
      domain:         { value: 'Energy',   confidence: 0.9, provenance: 'STATED' },
      targetAudience: { value: 'Managers', confidence: 0.9, provenance: 'STATED' },
      businessGoals:  [{ value: 'Cut costs', confidence: 0.9, provenance: 'STATED' }],
      businessOutcomes: Array.from({ length: 9 }, (_, i) => ({
        value: `Outcome ${i + 1}`, confidence: 0.7, provenance: 'INFERRED',
      })),
      demoPriorities: [{ value: 'Show savings', confidence: 0.8, provenance: 'INFERRED' }],
    });
    const llm   = new MockLLMProvider(tooMany);
    const agent = makeAgent(llm);

    const result = await agent.expand({ rawText: 'Valid input.' });

    expect(result?.businessOutcomes.length).toBeLessThanOrEqual(5);
  });
});

// ── Retry behaviour ───────────────────────────────────────────────────────────

describe('retry behaviour', () => {
  it('retries on transient LLM failure and succeeds on second attempt', async () => {
    const llm  = new MockLLMProvider();
    let calls  = 0;
    jest.spyOn(llm, 'complete').mockImplementation(async () => {
      calls++;
      if (calls === 1) throw new Error('rate limit');
      return buildTypicalResponse();
    });
    const agent = makeAgent(llm, {
      retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, jitter: false },
    });

    const result = await agent.expand({ rawText: 'Energy management for buildings.' });

    expect(result).not.toBeNull();
    expect(calls).toBe(2);
  });

  it('returns null after exhausting all retry attempts', async () => {
    const llm      = new MockLLMProvider();
    const spy      = jest.spyOn(llm, 'complete').mockRejectedValue(new Error('persistent API error'));
    const agent    = makeAgent(llm, {
      retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, jitter: false },
    });

    const result = await agent.expand({ rawText: 'Energy management for buildings.' });

    expect(result).toBeNull();
    // spy.mock.calls counts how many times the (replaced) method was called
    expect(spy.mock.calls.length).toBe(3);
  });
});

// ── JSON parsing edge cases ───────────────────────────────────────────────────

describe('JSON parsing edge cases', () => {
  it('parses JSON wrapped in markdown code fences', async () => {
    const fenced = '```json\n' + buildTypicalResponse() + '\n```';
    const llm    = new MockLLMProvider(fenced);
    const agent  = makeAgent(llm);

    const result = await agent.expand({ rawText: 'Energy management for buildings.' });

    expect(result?.domain.value).toBe('Energy Management for Commercial Buildings');
  });

  it('parses JSON embedded in surrounding prose', async () => {
    const padded = 'Here is the expansion:\n\n' + buildTypicalResponse() + '\n\nLet me know if you need more.';
    const llm    = new MockLLMProvider(padded);
    const agent  = makeAgent(llm);

    const result = await agent.expand({ rawText: 'Energy management for buildings.' });

    expect(result?.domain.value).toBe('Energy Management for Commercial Buildings');
  });
});

// ── overallConfidence calculation ─────────────────────────────────────────────

describe('overallConfidence', () => {
  it('gives higher overallConfidence when all fields are STATED', async () => {
    const allStated = JSON.stringify({
      domain:         { value: 'Energy',    confidence: 0.92, provenance: 'STATED' },
      targetAudience: { value: 'Managers',  confidence: 0.90, provenance: 'STATED' },
      businessGoals:  [{ value: 'Cut costs', confidence: 0.91, provenance: 'STATED' }],
      businessOutcomes: [{ value: 'Lower bills', confidence: 0.88, provenance: 'STATED' }],
      demoPriorities: [{ value: 'Show savings', confidence: 0.89, provenance: 'STATED' }],
    });

    const allExpanded = JSON.stringify({
      domain:         { value: 'Energy',    confidence: 0.50, provenance: 'EXPANDED' },
      targetAudience: { value: 'Managers',  confidence: 0.50, provenance: 'EXPANDED' },
      businessGoals:  [{ value: 'Cut costs', confidence: 0.50, provenance: 'EXPANDED' }],
      businessOutcomes: [{ value: 'Lower bills', confidence: 0.50, provenance: 'EXPANDED' }],
      demoPriorities: [{ value: 'Show savings', confidence: 0.50, provenance: 'EXPANDED' }],
    });

    const llmHigh = new MockLLMProvider(allStated);
    const llmLow  = new MockLLMProvider(allExpanded);
    const agentHigh = makeAgent(llmHigh);
    const agentLow  = makeAgent(llmLow);

    const resultHigh = await agentHigh.expand({ rawText: 'Energy management for buildings.' });
    const resultLow  = await agentLow.expand({  rawText: 'Energy management for buildings.' });

    expect(resultHigh!.overallConfidence).toBeGreaterThan(resultLow!.overallConfidence);
  });

  it('overallConfidence is between 0 and 1', async () => {
    const llm   = new MockLLMProvider(buildMinimalResponse());
    const agent = makeAgent(llm);

    const result = await agent.expand({ rawText: 'Healthcare revenue cycle.' });

    expect(result!.overallConfidence).toBeGreaterThanOrEqual(0);
    expect(result!.overallConfidence).toBeLessThanOrEqual(1);
  });
});

// ── Provenance assignment ─────────────────────────────────────────────────────

describe('provenance assignment', () => {
  it('preserves STATED provenance from LLM response', async () => {
    const llm   = new MockLLMProvider(buildTypicalResponse());
    const agent = makeAgent(llm);

    const result = await agent.expand({ rawText: 'Energy management for facility managers.' });

    expect(result?.domain.provenance).toBe('STATED');
    expect(result?.targetAudience.provenance).toBe('STATED');
  });

  it('preserves INFERRED provenance from LLM response', async () => {
    const llm   = new MockLLMProvider(buildTypicalResponse());
    const agent = makeAgent(llm);

    const result = await agent.expand({ rawText: 'Energy management for facility managers.' });

    // Second businessGoal in buildTypicalResponse is INFERRED
    expect(result?.businessGoals[1].provenance).toBe('INFERRED');
  });

  it('treats unknown provenance as EXPANDED conservatively', async () => {
    const unknownProvenance = JSON.stringify({
      domain:         { value: 'Energy',   confidence: 0.9, provenance: 'MAGIC'   },
      targetAudience: { value: 'Managers', confidence: 0.9, provenance: 'UNKNOWN' },
      businessGoals:  [{ value: 'Cut costs', confidence: 0.9, provenance: 'STATED' }],
      businessOutcomes: [],
      demoPriorities: [{ value: 'Show savings', confidence: 0.8, provenance: 'INFERRED' }],
    });
    const llm   = new MockLLMProvider(unknownProvenance);
    const agent = makeAgent(llm);

    const result = await agent.expand({ rawText: 'Valid input.' });

    expect(result?.domain.provenance).toBe('EXPANDED');
    expect(result?.targetAudience.provenance).toBe('EXPANDED');
    // Unknown provenance gets EXPANDED cap: max 0.75
    expect(result?.domain.confidence).toBeLessThanOrEqual(0.75);
  });
});
