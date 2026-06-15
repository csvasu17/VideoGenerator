// ─────────────────────────────────────────────────────────────────────────────
// InteractionSequenceBuilder — unit tests
// ─────────────────────────────────────────────────────────────────────────────

import { InteractionSequenceBuilder } from '../InteractionSequenceBuilder';
import type { ExplorationResult } from '../../agents/discovery/interaction/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeState(
  id:           string,
  screenshotPath: string,
  depth:        number,
  selector:     string,
  hint:         string,
  tokens:       string[],
  interactionClass: 'TAB_TRIGGER' | 'ACCORDION_HEADER' | 'EXPAND_TOGGLE' | 'VISUAL_TAB_CANDIDATE' = 'TAB_TRIGGER',
  boundingRect: { x: number; y: number; width: number; height: number } | null = null,
) {
  return {
    id,
    pageUrl:         'https://example.com/page',
    interactionPath: depth === 0 ? [] : [{
      targetSelector:      selector,
      interactionClass,
      detectionMethod:     'aria' as const,
      humanReadableHint:   hint,
      elementBoundingRect: boundingRect,
    }],
    depth,
    screenshotPath,
    screenshotHash:  `hash-${id}`,
    domSummary: {
      headings:          [{ level: 1, text: hint }],
      visibleTextTokens: tokens,
      elementCounts:     { tables: 0, canvases: 0, svgs: 0, forms: 0, lists: 0, buttons: 1, inputs: 0 },
      ariaRoleCounts:    {},
    },
    fingerprint: {
      stableTextHash:       `stable-${id}`,
      headingStructureHash: `heading-${id}`,
      widgetCounts:         { TABLE: 0, CHART: 0, FORM: 0, LIST: 0, UNKNOWN: 0 },
      interactiveCount:     1,
      compositeHash:        `composite-${id}`,
    },
    capturedAt: 1_700_000_000_000,
  };
}

function makeExploration(pageId: string, discoveredTokens: string[] = []): ExplorationResult {
  const base = makeState('base', '/base.png', 0, '', 'Base', ['Base', 'Dashboard']);
  const disc = makeState(
    'disc-1',
    '/disc-1.png',
    1,
    'button.tab-1',
    'Predictions Tab',
    ['Base', 'Dashboard', ...discoveredTokens],
  );

  return {
    baseState:        base,
    discoveredStates: [disc],
    totalAttempts:    1,
    totalMeaningful:  1,
    budgetStatus:     'completed',
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('InteractionSequenceBuilder', () => {
  const builder = new InteractionSequenceBuilder();

  it('returns empty array for empty explorations map', () => {
    const result = builder.build(new Map());
    expect(result).toHaveLength(0);
  });

  it('builds one sequence for a single depth-1 discovered state', () => {
    const explorations = new Map([['page-1', makeExploration('page-1')]]);
    const sequences    = builder.build(explorations);

    expect(sequences).toHaveLength(1);
    const seq = sequences[0];
    expect(seq.pageId).toBe('page-1');
    expect(seq.sequenceId).toHaveLength(16);
    expect(seq.businessScore).toBe(0);   // not scored yet
    expect(seq.trigger.cssSelector).toBe('button.tab-1');
    expect(seq.trigger.eventType).toBe('tab_switch');
    expect(seq.startState.screenshotPath).toBe('/base.png');
    expect(seq.endState.screenshotPath).toBe('/disc-1.png');
  });

  it('skips depth > 1 states', () => {
    const exploration = makeExploration('page-1');
    const deepState   = makeState('deep-2', '/deep.png', 2, 'div.nested', 'Nested', ['x'], 'EXPAND_TOGGLE');
    exploration.discoveredStates.push(deepState);

    const sequences = builder.build(new Map([['page-1', exploration]]));
    expect(sequences).toHaveLength(1);  // only the depth-1 state
  });

  it('detects AI business signals from token keywords', () => {
    // Phase 9b: ai_prediction uses value corpus (numeric tokens + hint).
    // '92% probability' is a value token; 'probability' matches RX_AI.
    const tokens   = ['92% probability', 'forecast trend'];
    const expl     = makeExploration('p1', tokens);
    const sequences = builder.build(new Map([['p1', expl]]));

    expect(sequences[0].businessSignals).toContain('ai_prediction');
  });

  it('detects KPI signal from token keywords', () => {
    // '24%' is a value token; the hint 'Predictions Tab' contains no RX_KPI match,
    // but '24% efficiency' is a value token that matches 'efficiency' in RX_KPI.
    const tokens   = ['24% efficiency', 'KPI dashboard'];
    const expl     = makeExploration('p1', tokens);
    const sequences = builder.build(new Map([['p1', expl]]));

    expect(sequences[0].businessSignals).toContain('kpi_revealed');
  });

  it('detects cost signal from token keywords', () => {
    // Phase 9b: need a value token (contains digit) matching RX_COST.
    // 'energy 1.2 kWh' matches 'energy' in RX_COST and contains digit.
    const tokens   = ['energy 1.2 kWh', 'cost: $1200'];
    const expl     = makeExploration('p1', tokens);
    const sequences = builder.build(new Map([['p1', expl]]));

    expect(sequences[0].businessSignals).toContain('cost_metric_revealed');
  });

  it('normalises bounding rect to 0–1 viewport coordinates', () => {
    const exploration = makeExploration('page-1');
    // Replace the discovered state with one that has a bounding rect
    exploration.discoveredStates[0].interactionPath[0].elementBoundingRect = {
      x: 960, y: 540, width: 192, height: 108,
    };

    const sequences = builder.build(new Map([['page-1', exploration]]));
    const bbox = sequences[0].trigger.elementBBox;
    expect(bbox).not.toBeNull();
    expect(bbox!.x).toBeCloseTo(0.5);
    expect(bbox!.y).toBeCloseTo(0.5);
    expect(bbox!.width).toBeCloseTo(0.1);
    expect(bbox!.height).toBeCloseTo(0.1);
  });

  it('produces null elementBBox when no bounding rect was recorded', () => {
    const exploration = makeExploration('page-1');
    // Ensure no bounding rect
    exploration.discoveredStates[0].interactionPath[0].elementBoundingRect = null;

    const sequences = builder.build(new Map([['page-1', exploration]]));
    expect(sequences[0].trigger.elementBBox).toBeNull();
  });

  it('maps ACCORDION_HEADER to accordion_expand event type', () => {
    const exploration = makeExploration('page-1');
    exploration.discoveredStates[0].interactionPath[0].interactionClass = 'ACCORDION_HEADER';

    const sequences = builder.build(new Map([['page-1', exploration]]));
    expect(sequences[0].trigger.eventType).toBe('accordion_expand');
  });

  it('produces deterministic sequenceId for same inputs', () => {
    const exploration = makeExploration('page-1');
    const a = builder.build(new Map([['page-1', exploration]]));
    const b = builder.build(new Map([['page-1', exploration]]));
    expect(a[0].sequenceId).toBe(b[0].sequenceId);
  });

  it('processes multiple pages independently', () => {
    const map = new Map([
      ['page-1', makeExploration('page-1', ['AI insight'])],
      ['page-2', makeExploration('page-2', ['cost savings'])],
    ]);
    const sequences = builder.build(map);
    expect(sequences).toHaveLength(2);
    const pageIds = sequences.map(s => s.pageId);
    expect(pageIds).toContain('page-1');
    expect(pageIds).toContain('page-2');
  });
});

// ── Phase 9b: Signal filtering and class penalties ────────────────────────────

function makeAccordionExploration(
  pageId:        string,
  discoveredTokens: string[] = [],
  hint:          string      = 'Toggle accordion header',
): ExplorationResult {
  const base = makeState('base', '/base.png', 0, '', 'Base', ['Base']);
  const disc = makeState(
    'disc-accordion',
    '/disc-accordion.png',
    1,
    'div.accordion',
    hint,
    ['Base', ...discoveredTokens],
    'ACCORDION_HEADER',
  );
  return {
    baseState:        base,
    discoveredStates: [disc],
    totalAttempts:    1,
    totalMeaningful:  1,
    budgetStatus:     'completed',
  };
}

describe('InteractionSequenceBuilder — Phase 9b quality', () => {
  const builder = new InteractionSequenceBuilder();

  it('ACCORDION_HEADER: alarm keywords in end state blocked in permittedSignals', () => {
    const expl = makeAccordionExploration('p-acc', ['alarm', 'alert', 'critical', 'warning'], 'Toggle panel');
    const seqs = builder.build(new Map([['p-acc', expl]]));
    expect(seqs).toHaveLength(1);
    // alarm_generated may appear in raw signals
    // but must NOT appear in permittedSignals
    expect(seqs[0].permittedSignals).not.toContain('alarm_generated');
    expect(seqs[0].permittedSignals).not.toContain('risk_score_change');
  });

  it('ACCORDION_HEADER with documentation hint: no permitted signals', () => {
    const expl = makeAccordionExploration('p-doc', ['Play', 'Pause', 'Reset'], 'Getting Started');
    const seqs = builder.build(new Map([['p-doc', expl]]));
    expect(seqs).toHaveLength(1);
    // No numeric tokens → no kpi_revealed or outcome_metric
    expect(seqs[0].permittedSignals).toHaveLength(0);
  });

  it('ACCORDION_HEADER with numeric KPI tokens: kpi_revealed is permitted', () => {
    const expl = makeAccordionExploration('p-kpi', ['142 kWh', 'Air 28%'], 'Energy Breakdown');
    const seqs = builder.build(new Map([['p-kpi', expl]]));
    expect(seqs).toHaveLength(1);
    expect(seqs[0].permittedSignals).toContain('kpi_revealed');
  });

  it('ACCORDION_HEADER: classPenaltyMultiplier is 0.50', () => {
    const expl = makeAccordionExploration('p-pen', [], 'Expand panel');
    const seqs = builder.build(new Map([['p-pen', expl]]));
    expect(seqs[0].classPenaltyMultiplier).toBe(0.50);
  });

  it('TAB_TRIGGER: classPenaltyMultiplier is 0.90', () => {
    const expl = makeExploration('p-tab', ['prediction 87%']);
    const seqs = builder.build(new Map([['p-tab', expl]]));
    expect(seqs[0].classPenaltyMultiplier).toBe(0.90);
  });

  it('transitionKey is stable across two builds with same hashes', () => {
    const expl = makeExploration('p-tk', ['metric']);
    const a = builder.build(new Map([['p-tk', expl]]));
    const b = builder.build(new Map([['p-tk', expl]]));
    expect(a[0].transitionKey).toBe(b[0].transitionKey);
    expect(a[0].transitionKey).toHaveLength(16);
  });

  it('storyRoleAffinity reflects permittedSignals not raw signals', () => {
    // Accordion with alarm content → alarm_generated blocked → role not 'problem'
    const expl = makeAccordionExploration('p-role', ['alarm', 'critical'], 'Show alerts');
    const seqs = builder.build(new Map([['p-role', expl]]));
    expect(seqs[0].storyRoleAffinity).not.toBe('problem');
  });
});
