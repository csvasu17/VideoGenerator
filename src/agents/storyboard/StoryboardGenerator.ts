import { randomUUID } from 'crypto';
import type { IStoryboardGenerator, StoryboardOptions } from '../../core/ports/agents/IStoryboardGenerator';
import type { DemoJourney } from '../../core/domain/entities/DemoJourney';
import type { Storyboard } from '../../core/domain/entities/Storyboard';
import { SceneBuilder } from './SceneBuilder';
import { SalesNarrationEngine } from './SalesNarrationEngine';
import { HighlightTargetResolver } from './HighlightTargetResolver';
import { TransitionSelector } from './TransitionSelector';

// ─────────────────────────────────────────────────────────────────────────────
// Defaults (mirrored from SceneBuilder so the orchestrator can also use them
// when building the opening title and CTA without a step context).
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<Omit<StoryboardOptions, 'salesNarrationOverrides' | 'narrationHints'>> = {
  productName:    'the Platform',
  targetAudience: 'your team',
  primaryBenefit: 'save time and make better decisions',
  callToAction:   'Schedule a live demo today',
};

// ─────────────────────────────────────────────────────────────────────────────
// StoryboardGenerator — main orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a DemoJourney into a sales-ready Storyboard.
 *
 * Pipeline:
 *   DemoJourney
 *     └─ SceneBuilder          → Scene[] (narration + highlight + transition)
 *     └─ opening / closing     → title card, CTA card
 *     └─ Storyboard assembly   → { id, title, scenes, …metadata }
 *
 * Contract: never throws; returns a well-formed Storyboard even for empty
 * journeys or journeys with a single step.
 */
export class StoryboardGenerator implements IStoryboardGenerator {
  constructor(
    private readonly sceneBuilder: SceneBuilder = new SceneBuilder(
      new SalesNarrationEngine(),
      new HighlightTargetResolver(),
      new TransitionSelector(),
    ),
  ) {}

  generate(journey: DemoJourney, options: StoryboardOptions = {}): Storyboard {
    // Use ?? so that undefined values in `options` fall back to defaults rather than
    // overwriting them (plain spread treats undefined as a valid override value).
    const coreOpts: Required<Omit<StoryboardOptions, 'salesNarrationOverrides' | 'narrationHints'>> = {
      productName:    options.productName    ?? DEFAULT_OPTIONS.productName,
      targetAudience: options.targetAudience ?? DEFAULT_OPTIONS.targetAudience,
      primaryBenefit: options.primaryBenefit ?? DEFAULT_OPTIONS.primaryBenefit,
      callToAction:   options.callToAction   ?? DEFAULT_OPTIONS.callToAction,
    };
    // Merge narration overrides back for buildAll()
    const opts: StoryboardOptions = {
      ...coreOpts,
      salesNarrationOverrides: options.salesNarrationOverrides,
    };

    // ── Guard: empty journey ─────────────────────────────────────────────
    if (journey.steps.length === 0) {
      return this.emptyStoryboard(journey.id, coreOpts);
    }

    // ── 1. Build scenes ──────────────────────────────────────────────────
    const scenes = this.sceneBuilder.buildAll(journey, opts);

    // ── 2. Aggregate duration ────────────────────────────────────────────
    const totalDurationSec = scenes.reduce((s, c) => s + c.durationSec, 0);

    // ── 3. Title cards ───────────────────────────────────────────────────
    const openingTitle       = this.buildOpeningTitle(journey, coreOpts);
    const closingCallToAction = coreOpts.callToAction;

    return {
      id:                   randomUUID(),
      journeyId:            journey.id,
      title:                journey.title,
      openingTitle,
      closingCallToAction,
      totalScenes:          scenes.length,
      totalDurationSec,
      scenes,
      generatedAt:          new Date().toISOString(),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Generate the text shown on the pre-roll title card.
   * Adapts to the journey's narrative arc for maximum impact.
   */
  private buildOpeningTitle(
    journey: DemoJourney,
    opts:    Required<Omit<StoryboardOptions, 'salesNarrationOverrides' | 'narrationHints'>>,
  ): string {
    const { productName: p, targetAudience: a, primaryBenefit: b } = opts;

    switch (journey.narrativeArc) {
      case 'workflow-tour':
        return `See how ${a} get from start to finish — without a single bottleneck.`;
      case 'value-progression':
        return `${p}: built to help ${a} ${b}.`;
      case 'problem-solution':
        return `The problem is real. The solution is ${p}.`;
      case 'feature-showcase':
      default:
        return `${p} — everything ${a} need to ${b}.`;
    }
  }

  private emptyStoryboard(journeyId: string, opts: Required<Omit<StoryboardOptions, 'salesNarrationOverrides' | 'narrationHints'>>): Storyboard {
    return {
      id:                   randomUUID(),
      journeyId,
      title:                'Empty Storyboard',
      openingTitle:         `${opts.productName} — coming soon.`,
      closingCallToAction:  opts.callToAction,
      totalScenes:          0,
      totalDurationSec:     0,
      scenes:               [],
      generatedAt:          new Date().toISOString(),
    };
  }
}
