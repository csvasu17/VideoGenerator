// ─────────────────────────────────────────────────────────────────────────────
// BusinessInteractionScorer — unit tests
// ─────────────────────────────────────────────────────────────────────────────

import { BusinessInteractionScorer } from '../BusinessInteractionScorer';
import type { InteractionSequence } from '../../core/domain/entities/InteractionReplay';

// ── Fixture ───────────────────────────────────────────────────────────────────

function makeSequence(
  opts: {
    structuralDeltaScore?: number;
    businessSignals?:      string[];
    permittedSignals?:     string[];
    newWidgetTypes?:       string[];
    eventType?:            import('../../core/domain/entities/InteractionReplay').InteractionEventType;
    classPenaltyMultiplier?: number;
  } = {},
): InteractionSequence {
  const eventType = opts.eventType ?? 'tab_switch';
  return {
    sequenceId:           'seq-test',
    pageId:               'page-1',
    pageUrl:              'https://example.com',
    trigger: {
      eventType,
      cssSelector:        'button.tab',
      elementBBox:        null,
      humanReadableHint:  'Predictions Tab',
      triggerPurpose:     'Switch to Predictions view',
    },
    startState: {
      screenshotPath: '/start.png',
      screenshotHash: 'hash-start',
      pageId:         'page-1',
      pageUrl:        'https://example.com',
    },
    endState: {
      screenshotPath: '/end.png',
      screenshotHash: 'hash-end',
      pageId:         'page-1',
      pageUrl:        'https://example.com',
    },
    visualDelta: {
      primaryChangeRegion:  null,
      appearedElements:     [],
      disappearedElements:  [],
      valueChanges:         [],
      changeIntensity:      opts.structuralDeltaScore ?? 0.5,
      newWidgetTypes:       opts.newWidgetTypes ?? [],
    },
    structuralDeltaScore:   opts.structuralDeltaScore ?? 0.5,
    businessSignals:        (opts.businessSignals ?? []) as any,
    permittedSignals:       (opts.permittedSignals ?? opts.businessSignals ?? []) as any,
    transitionKey:          'test-transition-key',
    classPenaltyMultiplier: opts.classPenaltyMultiplier ?? 1.00,
    businessScore:          0,
    storyRoleAffinity:      'insight',
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BusinessInteractionScorer', () => {
  const scorer = new BusinessInteractionScorer();

  it('assigns businessScore=0 when no signals and zero structural delta', () => {
    const seq = makeSequence({ structuralDeltaScore: 0, businessSignals: [], newWidgetTypes: [] });
    scorer.score([seq]);
    expect(seq.businessScore).toBe(0);
  });

  it('assigns high businessScore for ai_prediction signal', () => {
    const seq = makeSequence({ structuralDeltaScore: 0.8, businessSignals: ['ai_prediction'] });
    scorer.score([seq]);
    // Phase 9b formula: 0.35*0.8 + 0.45*1.0 + 0.20*0 = 0.28 + 0.45 = 0.73
    expect(seq.businessScore).toBeCloseTo(0.73, 2);
  });

  it('assigns lower score for workflow_completed vs ai_prediction', () => {
    const aiSeq       = makeSequence({ structuralDeltaScore: 0.5, businessSignals: ['ai_prediction'] });
    const workflowSeq = makeSequence({ structuralDeltaScore: 0.5, businessSignals: ['workflow_completed'] });
    scorer.score([aiSeq, workflowSeq]);
    expect(aiSeq.businessScore).toBeGreaterThan(workflowSeq.businessScore);
  });

  it('adds widget bonus for chart appearance', () => {
    const noChart = makeSequence({ structuralDeltaScore: 0.5, businessSignals: ['kpi_revealed'], newWidgetTypes: [] });
    const chart   = makeSequence({ structuralDeltaScore: 0.5, businessSignals: ['kpi_revealed'], newWidgetTypes: ['chart'] });
    scorer.score([noChart, chart]);
    expect(chart.businessScore).toBeGreaterThan(noChart.businessScore);
  });

  it('clamps score to [0, 1]', () => {
    // Max possible: 0.40*1 + 0.40*1 + 0.20*(0.30+0.20) = 0.40 + 0.40 + 0.10 = 0.90
    const max = makeSequence({
      structuralDeltaScore: 1.0,
      businessSignals: ['ai_prediction'],
      newWidgetTypes:  ['chart', 'table'],
    });
    scorer.score([max]);
    expect(max.businessScore).toBeGreaterThanOrEqual(0);
    expect(max.businessScore).toBeLessThanOrEqual(1);
  });

  it('modifies the array in-place and returns the same reference', () => {
    const seqs = [makeSequence(), makeSequence()];
    const result = scorer.score(seqs);
    expect(result).toBe(seqs);
    expect(seqs[0].businessScore).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic — same inputs produce identical scores', () => {
    const seq1 = makeSequence({ structuralDeltaScore: 0.7, businessSignals: ['kpi_revealed'] });
    const seq2 = makeSequence({ structuralDeltaScore: 0.7, businessSignals: ['kpi_revealed'] });
    scorer.score([seq1]);
    scorer.score([seq2]);
    expect(seq1.businessScore).toBe(seq2.businessScore);
  });
});

// ── Phase 9b: class penalties + permitted signal filtering ────────────────────

describe('BusinessInteractionScorer — Phase 9b', () => {
  const scorer = new BusinessInteractionScorer();

  it('accordion_expand multiplier 0.50 halves the raw score', () => {
    // raw = 0.35*0.8 + 0.45*1.0 = 0.73; × 0.50 = 0.365
    const seq = makeSequence({
      structuralDeltaScore:   0.8,
      businessSignals:        ['ai_prediction'],
      permittedSignals:       ['ai_prediction'],
      classPenaltyMultiplier: 0.50,
    });
    scorer.score([seq]);
    expect(seq.businessScore).toBeCloseTo(0.365, 2);
  });

  it('scenario_execute multiplier 1.10 boosts score up to 1.0 cap', () => {
    // raw = 0.35*1.0 + 0.45*1.0 + 0.20*0.30 = 0.80 + 0.06 = 0.86; × 1.10 = 0.946
    const seq = makeSequence({
      structuralDeltaScore:   1.0,
      businessSignals:        ['ai_prediction'],
      permittedSignals:       ['ai_prediction'],
      newWidgetTypes:         ['chart'],
      classPenaltyMultiplier: 1.10,
    });
    scorer.score([seq]);
    expect(seq.businessScore).toBeGreaterThan(0.85);
    expect(seq.businessScore).toBeLessThanOrEqual(1.0);
  });

  it('uses permittedSignals when present — ignores blocked raw signals', () => {
    // accordion with alarm in raw but not in permitted
    const blocked = makeSequence({
      structuralDeltaScore:   0.5,
      businessSignals:        ['alarm_generated'],    // raw — weight 0.90
      permittedSignals:       [],                     // blocked by class filter
      classPenaltyMultiplier: 0.50,
    });
    const permitted = makeSequence({
      structuralDeltaScore:   0.5,
      businessSignals:        ['alarm_generated'],    // raw — weight 0.90
      permittedSignals:       ['alarm_generated'],    // not blocked
      classPenaltyMultiplier: 0.50,
    });
    scorer.score([blocked, permitted]);
    // blocked: raw = 0.35*0.5 + 0 = 0.175; × 0.50 = 0.0875
    // permitted: raw = 0.35*0.5 + 0.45*0.90 = 0.175 + 0.405 = 0.58; × 0.50 = 0.29
    expect(permitted.businessScore).toBeGreaterThan(blocked.businessScore);
    expect(blocked.businessScore).toBeCloseTo(0.0875, 2);
  });

  it('falls back to businessSignals when permittedSignals is absent', () => {
    const seq = makeSequence({
      structuralDeltaScore: 0.5,
      businessSignals:      ['kpi_revealed'],
      // permittedSignals falls back to businessSignals in fixture (same value)
    });
    scorer.score([seq]);
    // raw = 0.35*0.5 + 0.45*0.80 = 0.175 + 0.36 = 0.535; × 1.00 = 0.535
    expect(seq.businessScore).toBeCloseTo(0.535, 2);
  });

  it('new Phase 9b signal: simulation_completed weight = 0.90', () => {
    const seq = makeSequence({
      structuralDeltaScore: 0.0,
      businessSignals:      ['simulation_completed'],
      permittedSignals:     ['simulation_completed'],
    });
    scorer.score([seq]);
    // raw = 0 + 0.45*0.90 = 0.405
    expect(seq.businessScore).toBeCloseTo(0.405, 2);
  });

  it('new Phase 9b signal: kpi_changed weight = 0.80', () => {
    const seq = makeSequence({
      structuralDeltaScore: 0.0,
      businessSignals:      ['kpi_changed'],
      permittedSignals:     ['kpi_changed'],
    });
    scorer.score([seq]);
    // raw = 0 + 0.45*0.80 = 0.36
    expect(seq.businessScore).toBeCloseTo(0.36, 2);
  });
});
