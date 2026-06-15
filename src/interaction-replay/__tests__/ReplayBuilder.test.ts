// ─────────────────────────────────────────────────────────────────────────────
// ReplayBuilder — unit tests
// ─────────────────────────────────────────────────────────────────────────────

import { ReplayBuilder } from '../ReplayBuilder';
import type { InteractionSequence } from '../../core/domain/entities/InteractionReplay';

// ── Fixture ───────────────────────────────────────────────────────────────────

function makeSequence(
  businessScore: number,
  structuralDeltaScore = 0.5,
): InteractionSequence {
  return {
    sequenceId:           `seq-${businessScore}`,
    pageId:               'page-1',
    pageUrl:              'https://example.com',
    trigger: {
      eventType:          'tab_switch',
      cssSelector:        '.tab-1',
      elementBBox:        { x: 0.5, y: 0.1, width: 0.1, height: 0.05 },
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
      primaryChangeRegion:  { x: 0.1, y: 0.1, width: 0.4, height: 0.3 },
      appearedElements:     ['Prediction Score: 87%', 'AI Alert'],
      disappearedElements:  [],
      valueChanges:         [{ label: 'Score', before: '', after: '87%', changeType: 'appear', businessMeaning: null }],
      changeIntensity:      structuralDeltaScore,
      newWidgetTypes:       ['chart'],
    },
    structuralDeltaScore,
    businessSignals:        ['ai_prediction', 'kpi_revealed'],
    permittedSignals:       ['ai_prediction', 'kpi_revealed'],
    transitionKey:          'test-tk-01',
    classPenaltyMultiplier: 1.00,
    businessScore,
    storyRoleAffinity:      'insight' as import('../../core/domain/entities/SalesStory').SceneRole,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ReplayBuilder', () => {
  const builder = new ReplayBuilder();

  it('returns empty array for empty sequences', () => {
    expect(builder.build([])).toHaveLength(0);
  });

  it('builds one replay per sequence', () => {
    const replays = builder.build([makeSequence(0.8)]);
    expect(replays).toHaveLength(1);
  });

  it('sets a stable 16-char hex interactionId', () => {
    const replay = builder.build([makeSequence(0.7)])[0];
    expect(replay.interactionId).toHaveLength(16);
    expect(replay.interactionId).toMatch(/^[0-9a-f]+$/);
  });

  it('replayDurationSec is between 12 and 30 seconds', () => {
    const low  = builder.build([makeSequence(0.0)])[0];
    const high = builder.build([makeSequence(1.0)])[0];
    expect(low.replayDurationSec).toBeGreaterThanOrEqual(12);
    expect(high.replayDurationSec).toBeLessThanOrEqual(30);
    expect(high.replayDurationSec).toBeGreaterThan(low.replayDurationSec);
  });

  it('higher priority sequence gets longer replay', () => {
    const lowPriority  = builder.build([makeSequence(0.2)])[0];
    const highPriority = builder.build([makeSequence(0.9)])[0];
    expect(highPriority.replayDurationSec).toBeGreaterThan(lowPriority.replayDurationSec);
    expect(highPriority.replayPriority).toBeGreaterThan(lowPriority.replayPriority);
  });

  it('replayPriority is in [0, 1]', () => {
    const replays = builder.build([makeSequence(0), makeSequence(1)]);
    for (const r of replays) {
      expect(r.replayPriority).toBeGreaterThanOrEqual(0);
      expect(r.replayPriority).toBeLessThanOrEqual(1);
    }
  });

  it('phases are ordered (monotonically non-decreasing frame values)', () => {
    const replay = builder.build([makeSequence(0.7)])[0];
    const p = replay.phases;
    expect(p.hookEndFrame).toBeGreaterThan(0);
    expect(p.cursorMoveStartFrame).toBeGreaterThanOrEqual(p.hookEndFrame);
    expect(p.cursorArriveFrame).toBeGreaterThanOrEqual(p.cursorMoveStartFrame);
    expect(p.clickFrame).toBeGreaterThanOrEqual(p.cursorArriveFrame);
    expect(p.transitionStartFrame).toBeGreaterThanOrEqual(p.clickFrame);
    expect(p.transitionEndFrame).toBeGreaterThanOrEqual(p.transitionStartFrame);
    expect(p.outcomeZoomFrame).toBeGreaterThanOrEqual(p.transitionEndFrame);
    expect(p.calloutFrame).toBeGreaterThanOrEqual(p.outcomeZoomFrame);
  });

  it('builds 4 camera directives per replay', () => {
    const replay = builder.build([makeSequence(0.7)])[0];
    expect(replay.cameraDirectives).toHaveLength(4);
    const phases = replay.cameraDirectives.map(d => d.phase);
    expect(phases).toContain('hook');
    expect(phases).toContain('action');
    expect(phases).toContain('transition');
    expect(phases).toContain('outcome');
  });

  it('outcome camera zoom is higher for higher priority replays', () => {
    const low  = builder.build([makeSequence(0.0)])[0];
    const high = builder.build([makeSequence(1.0)])[0];
    const lowOutcome  = low.cameraDirectives.find(d => d.phase === 'outcome')!;
    const highOutcome = high.cameraDirectives.find(d => d.phase === 'outcome')!;
    expect(highOutcome.zoom).toBeGreaterThan(lowOutcome.zoom);
  });

  it('derives callout text from valueChanges when available', () => {
    const replay = builder.build([makeSequence(0.7)])[0];
    // The fixture has valueChanges[0] = { label: 'Score', after: '87%' }
    expect(replay.calloutText).toContain('Score');
  });

  it('produces deterministic interactionId for the same sequence', () => {
    const seq = makeSequence(0.7);
    const a   = builder.build([seq])[0];
    const b   = builder.build([seq])[0];
    expect(a.interactionId).toBe(b.interactionId);
  });

  it('passes arc position into priority calculation', () => {
    const seq = makeSequence(0.7);
    const midArc  = builder.build([seq], new Map([[seq.sequenceId, 0.50]]))[0];
    const earlyArc = builder.build([seq], new Map([[seq.sequenceId, 0.0]]))[0];
    // Mid-arc gets an arc bonus, early-arc does not
    expect(midArc.replayPriority).toBeGreaterThan(earlyArc.replayPriority);
  });
});
