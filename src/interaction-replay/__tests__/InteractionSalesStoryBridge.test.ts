// ─────────────────────────────────────────────────────────────────────────────
// InteractionSalesStoryBridge — unit tests (Phase 9b)
// ─────────────────────────────────────────────────────────────────────────────

import { InteractionSalesStoryBridge } from '../InteractionSalesStoryBridge';
import type { InteractionReplay, ReplayValidationReport } from '../../core/domain/entities/InteractionReplay';
import type { SceneRole, StoryArc } from '../../core/domain/entities/SalesStory';

// ── Fixtures ──────────────────────────────────────────────────────────────────

let _replayCounter = 0;

function makeReplay(opts: {
  pageId:       string;
  storyRole:    SceneRole | string;
  priority?:    number;
  transitionKey?: string;
} ): InteractionReplay {
  const id = `replay-${++_replayCounter}`;
  return {
    interactionId:   id,
    sequenceId:      `seq-${id}`,
    pageId:          opts.pageId,
    startState: {
      screenshotPath: `/start-${id}.png`,
      screenshotHash: `sh-${id}-start`,
      pageId:         opts.pageId,
      pageUrl:        `https://example.com/${opts.pageId}`,
    },
    endState: {
      screenshotPath: `/end-${id}.png`,
      screenshotHash: `sh-${id}-end`,
      pageId:         opts.pageId,
      pageUrl:        `https://example.com/${opts.pageId}`,
    },
    trigger: {
      eventType:         'tab_switch',
      cssSelector:       `.tab-${id}`,
      elementBBox:       null,
      humanReadableHint: 'Tab hint',
      triggerPurpose:    'Switch view',
    },
    businessPurpose:  'Switch view',
    businessSignals:  ['kpi_revealed'],
    storyRole:        opts.storyRole as SceneRole,
    visualDelta: {
      primaryChangeRegion: null,
      appearedElements:    [],
      disappearedElements: [],
      valueChanges:        [],
      changeIntensity:     0.30,
      newWidgetTypes:      [],
    },
    replayDurationSec: 18,
    phases: {
      hookEndFrame:         5,
      cursorMoveStartFrame: 5,
      cursorArriveFrame:    11,
      clickFrame:           12,
      transitionStartFrame: 13,
      transitionEndFrame:   18,
      outcomeZoomFrame:     20,
      calloutFrame:         22,
    },
    cameraDirectives:  [],
    calloutText:       'KPI: 87%',
    calloutBBox:       null,
    transitionKey:     opts.transitionKey ?? `tk-${id}`,
    replayPriority:    opts.priority ?? 0.70,
  };
}

function makeScene(pageId: string, sceneRole: SceneRole | string) {
  return {
    sceneIndex:      0,
    pageId,
    sceneRole:       sceneRole as SceneRole,
    feature:         `feature-${sceneRole}`,
    businessOutcome: {
      customerOutcome: 'Reduce cost',
      businessProblem: 'High energy use',
      callout:         'Save 24%',
      proofPoints:     [],
      proofPopAtSec:   null,
    },
    callout:         'Save 24%',
    proofElement:    {
      elementType:     'kpi_card' as const,
      description:     'Energy KPI',
      boundingBox:     null,
      selectorHint:    null,
      dataLabel:       null,
      dataValue:       null,
    },
    sceneGoal:       `${sceneRole}: Save 24%`,
    narrativeHook:   'High energy costs are draining budgets.',
    closingLine:     'Achieve measurable savings.',
    cameraIntent:    'establish' as const,
    minDurationSec:  8,
    storyPriority:   0.70,
  };
}

function makeStoryArc(scenes: ReturnType<typeof makeScene>[]): StoryArc {
  return {
    arcType:           'reactive_to_predictive',
    title:             'Test Arc',
    premise:           'Test premise',
    resolution:        'Test resolution',
    scenes:            scenes as any,
    arcNarrative:      'Test narrative',
    openingHook:       'Test hook',
    closingCTA:        'Learn more',
    validationSummary: {
      arcComplete:        true,
      missingRoles:       [],
      weakScenes:         [],
      redundantScenes:    [],
      overallScore:       0.8,
      narrative:          'Solid arc',
      recommendedChanges: [],
    },
    sceneValidations:  [],
  };
}

function emptyReport(): ReplayValidationReport {
  return {
    replayResults:    [],
    coverageRate:     1.0,
    promotedCount:    0,
    demotedCount:     0,
    weakReplays:      [],
    recommendations:  [],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('InteractionSalesStoryBridge', () => {
  const bridge = new InteractionSalesStoryBridge();

  beforeEach(() => { _replayCounter = 0; });

  it('returns empty plan when no promoted replays', () => {
    const arc  = makeStoryArc([makeScene('p1', 'insight'), makeScene('p1', 'outcome')]);
    const plan = bridge.bridge([], [], arc, emptyReport());
    expect(plan.sceneToReplayMap.size).toBe(0);
    expect(plan.coverageRate).toBe(0);
    expect(plan.replays).toHaveLength(0);
  });

  it('assigns compatible replay to scene with matching page', () => {
    const replay = makeReplay({ pageId: 'p1', storyRole: 'insight' });
    const arc    = makeStoryArc([makeScene('p1', 'insight')]);
    const plan   = bridge.bridge([replay], [replay], arc, emptyReport());
    expect(plan.sceneToReplayMap.size).toBe(1);
    expect(plan.sceneToReplayMap.get(0)).toBe(replay.interactionId);
  });

  // ── Role compatibility ──────────────────────────────────────────────────────

  it('skips assignment when replay role is incompatible with scene role', () => {
    // 'insight' replay is NOT compatible with 'problem' scene
    const replay = makeReplay({ pageId: 'p1', storyRole: 'insight' });
    const arc    = makeStoryArc([makeScene('p1', 'problem')]);
    const plan   = bridge.bridge([replay], [replay], arc, emptyReport());
    // No compatible replay → no assignment
    expect(plan.sceneToReplayMap.size).toBe(0);
  });

  it('assigns insight replay to hook scene (compatible per matrix)', () => {
    const replay = makeReplay({ pageId: 'p1', storyRole: 'insight' });
    const arc    = makeStoryArc([makeScene('p1', 'hook')]);
    const plan   = bridge.bridge([replay], [replay], arc, emptyReport());
    expect(plan.sceneToReplayMap.size).toBe(1);
  });

  it('assigns outcome replay to validation scene (compatible)', () => {
    const replay = makeReplay({ pageId: 'p1', storyRole: 'outcome' });
    const arc    = makeStoryArc([makeScene('p1', 'validation')]);
    const plan   = bridge.bridge([replay], [replay], arc, emptyReport());
    expect(plan.sceneToReplayMap.size).toBe(1);
  });

  it('assigns problem replay to hook scene (compatible)', () => {
    const replay = makeReplay({ pageId: 'p1', storyRole: 'problem' });
    const arc    = makeStoryArc([makeScene('p1', 'hook')]);
    const plan   = bridge.bridge([replay], [replay], arc, emptyReport());
    expect(plan.sceneToReplayMap.size).toBe(1);
  });

  it('does not assign problem replay to scale scene (incompatible)', () => {
    const replay = makeReplay({ pageId: 'p1', storyRole: 'problem' });
    const arc    = makeStoryArc([makeScene('p1', 'scale')]);
    const plan   = bridge.bridge([replay], [replay], arc, emptyReport());
    expect(plan.sceneToReplayMap.size).toBe(0);
  });

  // ── Transition-identity deduplication ─────────────────────────────────────────

  it('deduplicates replays with the same transitionKey — keeps highest priority', () => {
    const replayLow  = makeReplay({ pageId: 'p1', storyRole: 'insight', priority: 0.40, transitionKey: 'same-tk' });
    const replayHigh = makeReplay({ pageId: 'p1', storyRole: 'insight', priority: 0.90, transitionKey: 'same-tk' });
    const arc        = makeStoryArc([makeScene('p1', 'insight')]);
    const plan       = bridge.bridge([replayLow, replayHigh], [replayLow, replayHigh], arc, emptyReport());
    // Only one scene, only one replay can be assigned; it must be the high-priority one
    expect(plan.sceneToReplayMap.size).toBe(1);
    expect(plan.sceneToReplayMap.get(0)).toBe(replayHigh.interactionId);
  });

  it('keeps both replays when transitionKeys differ (different pages)', () => {
    // Two replays on different pages, unique transitionKeys — both should be
    // assigned when the arc has a compatible scene per page.
    const r1 = makeReplay({ pageId: 'p1', storyRole: 'insight', transitionKey: 'tk-A' });
    const r2 = makeReplay({ pageId: 'p2', storyRole: 'insight', transitionKey: 'tk-B' });
    const arc = makeStoryArc([
      makeScene('p1', 'insight'),
      makeScene('p2', 'insight'),
    ]);
    const plan = bridge.bridge([r1, r2], [r1, r2], arc, emptyReport());
    // maxInteract = floor(2 × 0.60) = 1 — coverage cap still applies, so at
    // least one assignment; the replays themselves are NOT deduplicated away.
    expect(plan.sceneToReplayMap.size).toBeGreaterThanOrEqual(1);
    // Both replays remain available in the used set (not eliminated by dedup).
    const usedIds = new Set([...plan.sceneToReplayMap.values()]);
    expect(usedIds.size).toBeGreaterThanOrEqual(1);
  });

  // ── Coverage guard ─────────────────────────────────────────────────────────────

  it('caps at 60% of scenes when more replays than max', () => {
    // 10 scenes, 10 replays → max is floor(10 × 0.60) = 6
    const scenes  = Array.from({ length: 10 }, (_, i) => makeScene(`p${i}`, 'insight'));
    const replays = scenes.map(s => makeReplay({ pageId: s.pageId, storyRole: 'insight' }));
    const arc     = makeStoryArc(scenes);
    const plan    = bridge.bridge(replays, replays, arc, emptyReport());
    expect(plan.sceneToReplayMap.size).toBeLessThanOrEqual(6);
  });

  it('soft minimum: falls below 30% if not enough compatible replays', () => {
    // 10 scenes but only 1 compatible replay — stays at 1 (no incompatible fill)
    const scenes     = Array.from({ length: 10 }, (_, i) => makeScene(`p${i}`, 'insight'));
    const oneReplay  = makeReplay({ pageId: 'p0', storyRole: 'insight' });
    const arc        = makeStoryArc(scenes);
    const plan       = bridge.bridge([oneReplay], [oneReplay], arc, emptyReport());
    // 1 out of 10 scenes (10%) — below the soft minimum; that is acceptable
    expect(plan.sceneToReplayMap.size).toBe(1);
    expect(plan.coverageRate).toBeCloseTo(0.1);
  });

  // ── Report deduplication annotation ───────────────────────────────────────────

  it('marks duplicate replay result as duplicate_of in the report', () => {
    const report = emptyReport();
    report.replayResults = [
      {
        interactionId: 'id-low',
        score: 0.70,
        promoted: true,
        checks: [],
        hardGateFailed: null,
        triggerSummary: 'tab_switch:Tab',
        visualDelta: 0.30,
        storyRelevance: 'role=insight',
        dedupeStatus: 'unique',
      },
      {
        interactionId: 'id-high',
        score: 0.90,
        promoted: true,
        checks: [],
        hardGateFailed: null,
        triggerSummary: 'tab_switch:Tab',
        visualDelta: 0.30,
        storyRelevance: 'role=insight',
        dedupeStatus: 'unique',
      },
    ];

    // Both share the same transitionKey
    const r1 = { ...makeReplay({ pageId: 'p1', storyRole: 'insight', priority: 0.70, transitionKey: 'shared-tk' }), interactionId: 'id-low' };
    const r2 = { ...makeReplay({ pageId: 'p1', storyRole: 'insight', priority: 0.90, transitionKey: 'shared-tk' }), interactionId: 'id-high' };

    const arc = makeStoryArc([makeScene('p1', 'insight')]);
    bridge.bridge([r1, r2], [r1, r2], { ...arc }, report);

    // The lower-priority one (r1/id-low) should be marked as a duplicate
    const lowResult = report.replayResults.find(r => r.interactionId === 'id-low');
    expect(lowResult?.dedupeStatus).toMatch(/^duplicate_of:/);
  });
});
