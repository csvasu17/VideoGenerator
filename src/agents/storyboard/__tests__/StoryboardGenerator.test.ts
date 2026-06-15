import { StoryboardGenerator } from '../StoryboardGenerator';
import type { DemoJourney, NarrativeArc } from '../../../core/domain/entities/DemoJourney';
import type { StoryboardOptions } from '../../../core/ports/agents/IStoryboardGenerator';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeJourney(overrides: Partial<DemoJourney> = {}): DemoJourney {
  return {
    id:                   'journey-001',
    title:                'End-to-End Workflow Demo',
    openingHook:          "Let's walk through the complete workflow.",
    narrativeArc:         'workflow-tour',
    totalSteps:           5,
    estimatedDurationSec: 42,
    coveredFeatureIds:    ['f1', 'f2', 'f3'],
    generatedAt:          '2026-01-01T00:00:00.000Z',
    metrics: {
      featureCoverageRatio: 0.75,
      avgTransitionCost:    0.5,
      uniqueNodeTypes:      4,
      topFeaturesHit:       3,
      pathScore:            0.82,
    },
    steps: [
      {
        stepNumber:           1,
        pageId:               'p1',
        pageTitle:            'Dashboard',
        url:                  '/dashboard',
        nodeType:             'dashboard',
        narrationCue:         'We start at Dashboard.',
        transitionLabel:      'Navigate to Projects',
        estimatedDurationSec: 12,
        features: [
          { featureId: 'f1', featureName: 'Revenue KPI', importanceScore: 90, businessValue: 'real-time revenue tracking' },
          { featureId: 'f2', featureName: 'Team Workload', importanceScore: 75, businessValue: 'balances team capacity' },
        ],
      },
      {
        stepNumber:           2,
        pageId:               'p2',
        pageTitle:            'Projects',
        url:                  '/projects',
        nodeType:             'list',
        narrationCue:         'Next: Projects.',
        transitionLabel:      'Click Create',
        estimatedDurationSec: 7,
        features: [
          { featureId: 'f3', featureName: 'Project Pipeline', importanceScore: 80, businessValue: 'organises all active work' },
        ],
      },
      {
        stepNumber:           3,
        pageId:               'p3',
        pageTitle:            'Create Project',
        url:                  '/projects/create',
        nodeType:             'form',
        narrationCue:         'Fill the form.',
        transitionLabel:      'Submit',
        estimatedDurationSec: 9,
        features: [
          { featureId: 'f4', featureName: 'Project Setup', importanceScore: 70, businessValue: 'launch projects in seconds' },
        ],
      },
      {
        stepNumber:           4,
        pageId:               'p4',
        pageTitle:            'Assign User',
        url:                  '/users/assign',
        nodeType:             'form',
        narrationCue:         'Assign a user.',
        transitionLabel:      'Go to Reports',
        estimatedDurationSec: 9,
        features: [],
      },
      {
        stepNumber:           5,
        pageId:               'p5',
        pageTitle:            'Reports',
        url:                  '/reports',
        nodeType:             'report',
        narrationCue:         'Wrap up at Reports.',
        transitionLabel:      undefined,
        estimatedDurationSec: 10,
        features: [
          { featureId: 'f5', featureName: 'Executive Report', importanceScore: 95, businessValue: 'delivers C-suite insights' },
        ],
      },
    ],
    ...overrides,
  };
}

const DEFAULT_OPTS: StoryboardOptions = {
  productName:    'Acme Platform',
  targetAudience: 'Operations Managers',
  primaryBenefit: 'reduce reporting time by 60%',
  callToAction:   'Book your demo now',
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('StoryboardGenerator', () => {
  let generator: StoryboardGenerator;

  beforeEach(() => {
    generator = new StoryboardGenerator();
  });

  // ── Output shape ──────────────────────────────────────────────────────────

  it('returns a Storyboard with the correct top-level shape', () => {
    const sb = generator.generate(makeJourney(), DEFAULT_OPTS);

    expect(typeof sb.id).toBe('string');
    expect(sb.id.length).toBeGreaterThan(0);
    expect(sb.journeyId).toBe('journey-001');
    expect(typeof sb.title).toBe('string');
    expect(typeof sb.openingTitle).toBe('string');
    expect(typeof sb.closingCallToAction).toBe('string');
    expect(typeof sb.totalDurationSec).toBe('number');
    expect(sb.totalScenes).toBe(sb.scenes.length);
    expect(typeof sb.generatedAt).toBe('string');
  });

  it('produces one scene per journey step', () => {
    const journey = makeJourney();
    const sb = generator.generate(journey, DEFAULT_OPTS);
    expect(sb.scenes.length).toBe(journey.steps.length);
  });

  it('scene numbers are sequential starting at 1', () => {
    const sb = generator.generate(makeJourney(), DEFAULT_OPTS);
    sb.scenes.forEach((s, i) => expect(s.sceneNumber).toBe(i + 1));
  });

  it('totalDurationSec equals sum of scene durations', () => {
    const sb = generator.generate(makeJourney(), DEFAULT_OPTS);
    const sum = sb.scenes.reduce((a, s) => a + s.durationSec, 0);
    expect(sb.totalDurationSec).toBe(sum);
  });

  // ── Scene content ─────────────────────────────────────────────────────────

  it('every scene has a non-empty title, narration, and salesHook', () => {
    const sb = generator.generate(makeJourney(), DEFAULT_OPTS);
    sb.scenes.forEach(s => {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.narration.length).toBeGreaterThan(0);
      expect(s.salesHook.length).toBeGreaterThan(0);
    });
  });

  it('every scene has a highlightTarget with elementType and region', () => {
    const sb = generator.generate(makeJourney(), DEFAULT_OPTS);
    sb.scenes.forEach(s => {
      expect(typeof s.highlightTarget.elementType).toBe('string');
      expect(typeof s.highlightTarget.region).toBe('string');
      expect(s.highlightTarget.description.length).toBeGreaterThan(0);
    });
  });

  it('dashboard scene highlights a kpi element', () => {
    const sb = generator.generate(makeJourney(), DEFAULT_OPTS);
    const dashScene = sb.scenes.find(s => s.pageId === 'p1');
    expect(dashScene?.highlightTarget.elementType).toBe('kpi');
  });

  it('report scene highlights a chart element', () => {
    const sb = generator.generate(makeJourney(), DEFAULT_OPTS);
    const reportScene = sb.scenes.find(s => s.pageId === 'p5');
    expect(reportScene?.highlightTarget.elementType).toBe('chart');
  });

  // ── Transitions ───────────────────────────────────────────────────────────

  it('last scene has no transition', () => {
    const sb = generator.generate(makeJourney(), DEFAULT_OPTS);
    const last = sb.scenes[sb.scenes.length - 1];
    expect(last.transition).toBeUndefined();
  });

  it('all non-last scenes have a transition', () => {
    const sb = generator.generate(makeJourney(), DEFAULT_OPTS);
    sb.scenes.slice(0, -1).forEach(s => {
      expect(s.transition).toBeDefined();
      expect(typeof s.transition!.type).toBe('string');
      expect(typeof s.transition!.durationMs).toBe('number');
    });
  });

  it('transition label mirrors the step transitionLabel', () => {
    const sb = generator.generate(makeJourney(), DEFAULT_OPTS);
    const scene1 = sb.scenes[0];
    expect(scene1.transition?.label).toBe('Navigate to Projects');
  });

  it('transition to report uses zoom-in', () => {
    const sb = generator.generate(makeJourney(), DEFAULT_OPTS);
    // scene 4 → scene 5 (report), scene index 3
    const scene4 = sb.scenes[3];
    expect(scene4.transition?.type).toBe('zoom-in');
  });

  // ── Sales messaging ───────────────────────────────────────────────────────

  it('opening narration mentions the product name', () => {
    const sb = generator.generate(makeJourney(), DEFAULT_OPTS);
    expect(sb.scenes[0].narration).toContain('Acme Platform');
  });

  it('closing narration contains the CTA', () => {
    const sb = generator.generate(makeJourney(), DEFAULT_OPTS);
    const last = sb.scenes[sb.scenes.length - 1];
    expect(last.narration).toContain('Book your demo now');
  });

  it('opening title is arc-specific', () => {
    const wfJourney = makeJourney({ narrativeArc: 'workflow-tour' });
    const vsJourney = makeJourney({ narrativeArc: 'value-progression' });
    const wfSb = generator.generate(wfJourney, DEFAULT_OPTS);
    const vsSb = generator.generate(vsJourney, DEFAULT_OPTS);
    expect(wfSb.openingTitle).not.toBe(vsSb.openingTitle);
  });

  it('closingCallToAction matches the provided callToAction option', () => {
    const sb = generator.generate(makeJourney(), DEFAULT_OPTS);
    expect(sb.closingCallToAction).toBe('Book your demo now');
  });

  // ── Options defaults ──────────────────────────────────────────────────────

  it('works with no options provided (uses defaults)', () => {
    const sb = generator.generate(makeJourney());
    expect(sb.scenes.length).toBeGreaterThan(0);
    expect(sb.closingCallToAction).toBe('Schedule a live demo today');
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('returns empty storyboard for a journey with no steps', () => {
    const empty = makeJourney({ steps: [], totalSteps: 0, estimatedDurationSec: 0 });
    const sb = generator.generate(empty, DEFAULT_OPTS);
    expect(sb.scenes).toHaveLength(0);
    expect(sb.totalScenes).toBe(0);
    expect(sb.totalDurationSec).toBe(0);
    expect(sb.title).toBe('Empty Storyboard');
  });

  it('handles a single-step journey', () => {
    const oneStep = makeJourney({ steps: [makeJourney().steps[0]], totalSteps: 1 });
    const sb = generator.generate(oneStep, DEFAULT_OPTS);
    expect(sb.scenes).toHaveLength(1);
    expect(sb.scenes[0].transition).toBeUndefined();
  });

  it('narrative arcs produce different opening narrations', () => {
    const arcs: NarrativeArc[] = ['workflow-tour', 'value-progression', 'problem-solution', 'feature-showcase'];
    const openings = arcs.map(arc =>
      generator.generate(makeJourney({ narrativeArc: arc }), DEFAULT_OPTS).scenes[0].narration,
    );
    // All four should be distinct
    const unique = new Set(openings);
    expect(unique.size).toBe(4);
  });
});
