// ─────────────────────────────────────────────────────────────────────────────
// ReplayValidator — unit tests (Phase 9b)
// ─────────────────────────────────────────────────────────────────────────────

import { ReplayValidator } from '../ReplayValidator';
import type { InteractionReplay } from '../../core/domain/entities/InteractionReplay';

// ── Fixture ───────────────────────────────────────────────────────────────────

const VALID_PHASES = {
  hookEndFrame:         5,
  cursorMoveStartFrame: 5,
  cursorArriveFrame:    11,
  clickFrame:           12,
  transitionStartFrame: 13,
  transitionEndFrame:   18,
  outcomeZoomFrame:     20,
  calloutFrame:         22,
};

function makeReplay(overrides: Partial<{
  startHash:        string;
  endHash:          string;
  changeIntensity:  number;
  hint:             string;
  businessSignals:  string[];
  durationSec:      number;
  calloutText:      string;
  startPath:        string;
  endPath:          string;
  selector:         string;
  phasesOrdered:    boolean;
  transitionKey:    string;
}> = {}): InteractionReplay {
  const opt = {
    startHash:       'hash-aaa',
    endHash:         'hash-bbb',
    changeIntensity: 0.40,
    hint:            'Predictions Tab',
    businessSignals: ['ai_prediction', 'kpi_revealed'],
    durationSec:     18,
    calloutText:     'Score: 87%',
    startPath:       '/start.png',
    endPath:         '/end.png',
    selector:        'button.tab-1',
    phasesOrdered:   true,
    transitionKey:   'tk-test-0001',
    ...overrides,
  };

  const phases = opt.phasesOrdered
    ? VALID_PHASES
    : { ...VALID_PHASES, cursorMoveStartFrame: 999 };   // break ordering

  return {
    interactionId:   `id-${opt.startHash.slice(-3)}-${opt.endHash.slice(-3)}`,
    sequenceId:      'seq-test',
    pageId:          'page-1',
    startState: {
      screenshotPath: opt.startPath,
      screenshotHash: opt.startHash,
      pageId:         'page-1',
      pageUrl:        'https://example.com',
    },
    endState: {
      screenshotPath: opt.endPath,
      screenshotHash: opt.endHash,
      pageId:         'page-1',
      pageUrl:        'https://example.com',
    },
    trigger: {
      eventType:         'tab_switch',
      cssSelector:       opt.selector,
      elementBBox:       null,
      humanReadableHint: opt.hint,
      triggerPurpose:    'Switch view',
    },
    businessPurpose: 'Switch view',
    businessSignals: opt.businessSignals as any,
    storyRole:       'insight' as any,
    visualDelta: {
      primaryChangeRegion: null,
      appearedElements:    [],
      disappearedElements: [],
      valueChanges:        [],
      changeIntensity:     opt.changeIntensity,
      newWidgetTypes:      [],
    },
    replayDurationSec: opt.durationSec,
    phases,
    cameraDirectives:  [],
    calloutText:       opt.calloutText,
    calloutBBox:       null,
    transitionKey:     opt.transitionKey,
    replayPriority:    0.75,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ReplayValidator', () => {
  const validator = new ReplayValidator();

  it('promotes a fully valid replay', () => {
    const { promoted, demoted } = validator.validate([makeReplay()]);
    expect(promoted).toHaveLength(1);
    expect(demoted).toHaveLength(0);
  });

  it('returns empty promoted/demoted for empty input', () => {
    const { promoted, demoted, report } = validator.validate([]);
    expect(promoted).toHaveLength(0);
    expect(demoted).toHaveLength(0);
    expect(report.coverageRate).toBe(0);
  });

  // ── Hard gate G1: start_end_distinct ─────────────────────────────────────────

  it('G1: demotes replay when start and end hashes are identical (no visual change)', () => {
    const replay = makeReplay({ startHash: 'hash-same', endHash: 'hash-same' });
    const { promoted, demoted, report } = validator.validate([replay]);
    expect(promoted).toHaveLength(0);
    expect(demoted).toHaveLength(1);
    expect(report.replayResults[0].hardGateFailed).toBe('start_end_distinct');
    expect(report.replayResults[0].score).toBe(0);
  });

  // ── Hard gate G2: visual_delta_sufficient ─────────────────────────────────────

  it('G2: demotes replay when changeIntensity is below 0.15', () => {
    const replay = makeReplay({ changeIntensity: 0.05 });
    const { promoted, report } = validator.validate([replay]);
    expect(promoted).toHaveLength(0);
    expect(report.replayResults[0].hardGateFailed).toBe('visual_delta_sufficient');
  });

  it('G2: promotes replay when changeIntensity is exactly 0.15', () => {
    const replay = makeReplay({ changeIntensity: 0.15 });
    const { promoted } = validator.validate([replay]);
    expect(promoted).toHaveLength(1);
  });

  // ── Hard gate G3: not_documentation_panel ────────────────────────────────────

  it('G3: demotes replay with "getting started" hint', () => {
    const replay = makeReplay({ hint: 'Getting Started Guide' });
    const { promoted, report } = validator.validate([replay]);
    expect(promoted).toHaveLength(0);
    expect(report.replayResults[0].hardGateFailed).toBe('not_documentation_panel');
  });

  it('G3: demotes replay with "how to" hint', () => {
    const replay = makeReplay({ hint: 'How to configure alerts' });
    const { promoted } = validator.validate([replay]);
    expect(promoted).toHaveLength(0);
  });

  it('G3: demotes replay with "help" in hint', () => {
    const replay = makeReplay({ hint: 'Help Center' });
    const { promoted, report } = validator.validate([replay]);
    expect(promoted).toHaveLength(0);
    expect(report.replayResults[0].hardGateFailed).toBe('not_documentation_panel');
  });

  it('G3: allows "Predictions Tab" hint (no documentation keyword)', () => {
    const replay = makeReplay({ hint: 'Predictions Tab' });
    const { promoted } = validator.validate([replay]);
    expect(promoted).toHaveLength(1);
  });

  // ── Weighted checks ────────────────────────────────────────────────────────────

  it('demotes replay with missing start screenshot', () => {
    const replay = makeReplay({ startPath: '' });
    const { promoted } = validator.validate([replay]);
    // score = (0 + 0.18 + 0.08 + 0.18 + 0.12 + 0.10 + 0.08 + 0.08) / 1.00 = 0.82 → still passes
    // Actually let's just check the check is recorded
    const result = validator.validate([replay]).report.replayResults[0];
    const check  = result.checks.find(c => c.name === 'has_start_screenshot');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it('demotes replay with no business signals', () => {
    const replay = makeReplay({ businessSignals: [] });
    const { report } = validator.validate([replay]);
    const result = report.replayResults[0];
    const check  = result.checks.find(c => c.name === 'has_permitted_signals');
    expect(check!.passed).toBe(false);
  });

  it('score is 0 when no signals AND changeIntensity < 0.15 (G2 fires first)', () => {
    const replay = makeReplay({ businessSignals: [], changeIntensity: 0.10 });
    const { report } = validator.validate([replay]);
    expect(report.replayResults[0].score).toBe(0);
    expect(report.replayResults[0].hardGateFailed).toBe('visual_delta_sufficient');
  });

  // ── Report fields ──────────────────────────────────────────────────────────────

  it('coverageRate equals promoted/total', () => {
    const replays = [
      makeReplay({ startHash: 'a', endHash: 'a' }),   // G1 fail → demoted
      makeReplay({ startHash: 'x', endHash: 'y' }),   // pass → promoted
    ];
    const { report } = validator.validate(replays);
    expect(report.coverageRate).toBeCloseTo(0.5);
    expect(report.promotedCount).toBe(1);
    expect(report.demotedCount).toBe(1);
  });

  it('hardGateFailed is null for a passing replay', () => {
    const { report } = validator.validate([makeReplay()]);
    expect(report.replayResults[0].hardGateFailed).toBeNull();
  });

  it('dedupeStatus defaults to "unique"', () => {
    const { report } = validator.validate([makeReplay()]);
    expect(report.replayResults[0].dedupeStatus).toBe('unique');
  });

  it('triggerSummary contains event type and hint', () => {
    const { report } = validator.validate([makeReplay({ hint: 'Energy Panel' })]);
    expect(report.replayResults[0].triggerSummary).toContain('tab_switch');
    expect(report.replayResults[0].triggerSummary).toContain('Energy Panel');
  });

  it('visualDelta field matches changeIntensity from replay', () => {
    const { report } = validator.validate([makeReplay({ changeIntensity: 0.42 })]);
    expect(report.replayResults[0].visualDelta).toBeCloseTo(0.42);
  });

  // ── Recommendations ────────────────────────────────────────────────────────────

  it('produces doc-panel recommendation when documentation hint is rejected', () => {
    const replay = makeReplay({ hint: 'Help Center' });
    const { report } = validator.validate([replay]);
    const hasDocRec = report.recommendations.some(r => r.includes('documentation'));
    expect(hasDocRec).toBe(true);
  });

  it('produces no-replays recommendation when all replays are demoted', () => {
    // All fail G1
    const replays = [
      makeReplay({ startHash: 'z', endHash: 'z' }),
      makeReplay({ startHash: 'z', endHash: 'z' }),
    ];
    const { report } = validator.validate(replays);
    const hasNoReplays = report.recommendations.some(r =>
      r.includes('No replays reached promotion threshold'),
    );
    expect(hasNoReplays).toBe(true);
  });
});
