import type { JourneyStep, NarrativeArc } from '../../core/domain/entities/DemoJourney';
import type { StoryboardOptions } from '../../core/ports/agents/IStoryboardGenerator';
import type { NarrationHints } from '../../core/domain/entities/context/NarrationHints';

// ─────────────────────────────────────────────────────────────────────────────
// Static vocabulary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Power words for mid-scene narration.
 * Cycled by scene index so the script never sounds repetitive.
 */
const POWER_WORDS = [
  'effortlessly',
  'automatically',
  'in real time',
  'seamlessly',
  'instantly',
  'with zero manual effort',
];

/**
 * Dominant action verb per node type — used in mid-scene copy.
 * Multiple options listed; index 0 is the primary pick.
 */
const ACTION_VERBS: Record<string, string[]> = {
  dashboard: ['monitor', 'oversee', 'track', 'visualise'],
  report:    ['analyse', 'drill into', 'uncover', 'explore'],
  list:      ['manage', 'browse', 'access', 'organise'],
  detail:    ['review', 'inspect', 'examine', 'deep-dive into'],
  form:      ['create', 'configure', 'initiate', 'submit'],
  modal:     ['confirm', 'approve', 'finalise'],
  settings:  ['customise', 'configure', 'tailor'],
  entry:     ['begin', 'enter', 'start'],
  generic:   ['leverage', 'access', 'use'],
};

/**
 * One-line value proposition per node type.
 * Shown as an on-screen lower-third.
 */
const NODE_TYPE_HOOK: Record<string, string> = {
  dashboard: 'Full visibility. Zero guesswork.',
  report:    'Insight without the wait.',
  list:      'Everything you need, right where you need it.',
  detail:    'Go deep without getting lost.',
  form:      'New workflows, launched in seconds.',
  modal:     'Confirm and move — no context switching.',
  settings:  'Built to fit your exact process.',
  entry:     "Your team's new command centre.",
  generic:   'More power, less effort.',
};

// ─────────────────────────────────────────────────────────────────────────────
// Context type passed to generate()
// ─────────────────────────────────────────────────────────────────────────────

export interface NarrationContext {
  step:       JourneyStep;
  stepIndex:  number;
  totalSteps: number;
  arc:        NarrativeArc;
  opts:       Required<Omit<StoryboardOptions, 'salesNarrationOverrides' | 'narrationHints'>>;
  /** Optional context hints for vocabulary enrichment of mid-scene narrations. */
  hints?:     NarrationHints;
}

export interface NarrationResult {
  narration:   string;  // Full voice-over script for this scene
  salesHook:   string;  // One-liner lower-third caption
  description: string;  // Factual B-roll description
}

// ─────────────────────────────────────────────────────────────────────────────
// SalesNarrationEngine
// ─────────────────────────────────────────────────────────────────────────────

export class SalesNarrationEngine {
  /**
   * Generate all three text components for a scene.
   * The narration follows the pattern:
   *   Scene 1 → bold opening hook (arc-specific)
   *   Scene N → arc-aware mid-scene benefit copy
   *   Last scene → reinforcement + explicit CTA
   */
  generate(ctx: NarrationContext): NarrationResult {
    const { step, stepIndex, totalSteps, arc, opts, hints } = ctx;
    const isFirst = stepIndex === 0;
    const isLast  = stepIndex === totalSteps - 1;

    const topFeature   = step.features[0];
    const featureName  = topFeature?.featureName  ?? step.pageTitle;
    const businessVal  = topFeature?.businessValue ?? opts.primaryBenefit;

    const narration = isFirst
      ? this.openingNarration(step, arc, opts, featureName)
      : isLast
      ? this.closingNarration(step, opts, featureName, hints)
      : this.midNarration(step, arc, stepIndex, totalSteps, featureName, businessVal, opts, hints);

    return {
      narration,
      salesHook:   NODE_TYPE_HOOK[step.nodeType] ?? `Unlock ${featureName}`,
      description: this.description(step, featureName, businessVal),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Narration per position
  // ──────────────────────────────────────────────────────────────────────────

  private openingNarration(
    step:        JourneyStep,
    arc:         NarrativeArc,
    opts:        Required<Omit<StoryboardOptions, 'salesNarrationOverrides' | 'narrationHints'>>,
    featureName: string,
  ): string {
    const { productName: p, targetAudience: a, primaryBenefit: b } = opts;

    switch (arc) {
      case 'workflow-tour':
        return (
          `Meet ${p} — the end-to-end platform that ${a} rely on to ${b}. ` +
          `We start at ${step.pageTitle}: your team's live command centre, ` +
          `where every critical metric is one glance away.`
        );

      case 'value-progression':
        return (
          `What if your team could ${b} — without changing how they work? ` +
          `With ${p}, it starts right here on ${step.pageTitle}. ` +
          `Every insight you need, surfaced automatically, so ${a} can focus on what matters.`
        );

      case 'problem-solution':
        return (
          `Right now, ${a} are spending hours manually tracking ${featureName.toLowerCase()}. ` +
          `There's a better way. This is ${p} — and this is where the transformation begins.`
        );

      case 'feature-showcase':
      default:
        return (
          `Welcome to ${p}. In the next few minutes, you'll see exactly why ${a} ` +
          `choose us to ${b}. Let's start with ${step.pageTitle}.`
        );
    }
  }

  private closingNarration(
    step:        JourneyStep,
    opts:        Required<Omit<StoryboardOptions, 'salesNarrationOverrides' | 'narrationHints'>>,
    featureName: string,
    hints?:      NarrationHints,
  ): string {
    const { productName: p, targetAudience: a, callToAction: cta } = opts;
    const safeCta = cta ?? 'Schedule a live demo today';

    // Weave context goal summary into the closing if available.
    const goalFragment = hints?.goalSummary
      ? ` to ${hints.goalSummary}`
      : '';

    return (
      `And that's ${p} — giving ${a} the visibility, control, and speed to ` +
      `act on what matters most${goalFragment}. ${featureName} is just one piece of a platform ` +
      `built to transform how your business operates. ` +
      `${safeCta} and see what we can unlock together.`
    );
  }

  private midNarration(
    step:        JourneyStep,
    arc:         NarrativeArc,
    stepIndex:   number,
    total:       number,
    featureName: string,
    businessVal: string,
    opts:        Required<Omit<StoryboardOptions, 'salesNarrationOverrides' | 'narrationHints'>>,
    hints?:      NarrationHints,
  ): string {
    const verb      = this.actionVerb(step.nodeType);
    // When context provides a tone-guidance string, use it as the power word
    // slot for one cycle to inject domain vocabulary naturally.
    const defaultPowerWord = POWER_WORDS[stepIndex % POWER_WORDS.length];
    const powerWord = (hints?.toneGuidance && stepIndex % 3 === 1)
      ? `for ${hints.toneGuidance}`
      : defaultPowerWord;
    const isEarly   = stepIndex <= Math.ceil(total / 2);

    switch (arc) {
      case 'workflow-tour':
        return (
          `Now we ${verb} ${featureName} — ${powerWord}. ` +
          `${businessVal}. ` +
          `The whole process is guided, consistent, and repeatable for every team member.`
        );

      case 'value-progression':
        return isEarly
          ? (
              `Here's where the value starts stacking up. ` +
              `${step.pageTitle} lets ${opts.targetAudience} ${verb} ${featureName} ${powerWord}. ` +
              `${businessVal}.`
            )
          : (
              `Now we're at peak impact. ` +
              `${featureName} delivers exactly what ${opts.targetAudience} need: ${businessVal}. ` +
              `No exports. No waiting. Just answers.`
            );

      case 'problem-solution':
        return isEarly
          ? (
              `This is where manual effort used to pile up — ` +
              `${step.pageTitle} required hours of work across multiple systems. ` +
              `Not anymore.`
            )
          : (
              `${opts.productName} ${verb} ${featureName} ${powerWord}, ` +
              `eliminating that overhead entirely. ${businessVal}.`
            );

      case 'feature-showcase':
      default:
        return (
          `${step.pageTitle}: ${verb} ${featureName} ${powerWord}. ` +
          `${businessVal}. ` +
          `Everything your team needs, right here.`
        );
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Scene description (factual B-roll notes)
  // ──────────────────────────────────────────────────────────────────────────

  private description(
    step:        JourneyStep,
    featureName: string,
    businessVal: string,
  ): string {
    const featureList = step.features
      .slice(0, 3)
      .map(f => f.featureName)
      .join(', ') || featureName;

    return `${step.pageTitle} highlights ${featureList}. ${businessVal}.`;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  private actionVerb(nodeType: string): string {
    return (ACTION_VERBS[nodeType] ?? ACTION_VERBS['generic'])[0];
  }
}
