import type { JourneyStep } from '../../core/domain/entities/DemoJourney';
import type { StoryboardOptions } from '../../core/ports/agents/IStoryboardGenerator';
import type { NarrationContext, NarrationResult } from './SalesNarrationEngine';

// ─────────────────────────────────────────────────────────────────────────────
// Static vocabulary — enterprise register
//
// Key differences from SalesNarrationEngine:
//   • No power words ("effortlessly", "seamlessly", "in real time")
//   • No arc-preamble sentences ("In the risk-to-resilience arc…")
//   • Short sentences (≤ 15 words each)
//   • Problem-first framing (what the user sees, then why it matters)
//   • Formal, clinical, externally-presentable copy
// ─────────────────────────────────────────────────────────────────────────────

const ACTION_VERBS: Record<string, string> = {
  dashboard: 'provides visibility into',
  report:    'delivers a detailed view of',
  list:      'organises and manages',
  detail:    'shows the complete record for',
  form:      'enables configuration of',
  modal:     'confirms',
  settings:  'controls',
  entry:     'introduces',
  generic:   'manages',
};

/** Short enterprise-style hook per node type (replaces the SaaS one-liner hooks). */
const NODE_HOOKS: Record<string, string> = {
  dashboard: 'Central visibility across all operations.',
  report:    'Accurate data, available on demand.',
  list:      'A complete, organised inventory.',
  detail:    'Full record access without switching tools.',
  form:      'Streamlined entry, every time.',
  modal:     'Controlled approvals built into the process.',
  settings:  'Configurable to your exact requirements.',
  entry:     'A single starting point for the team.',
  generic:   'Enterprise-grade control over this process.',
};

// ─────────────────────────────────────────────────────────────────────────────
// EnterpriseNarrationEngine
// ─────────────────────────────────────────────────────────────────────────────

export class EnterpriseNarrationEngine {
  /**
   * Generate narration, hook, and description for one enterprise-template scene.
   *
   * Style guide:
   *   First scene  — product introduction (short, formal, solution-framed)
   *   Middle scenes — feature description + one-sentence business impact
   *   Last scene   — capability summary + brief CTA
   */
  generate(ctx: NarrationContext): NarrationResult {
    const { step, stepIndex, totalSteps, opts } = ctx;
    const isFirst = stepIndex === 0;
    const isLast  = stepIndex === totalSteps - 1;

    const topFeature  = step.features[0];
    const featureName = topFeature?.featureName ?? step.pageTitle;
    const businessVal = topFeature?.businessValue ?? opts.primaryBenefit;

    const narration = isFirst
      ? this.openingNarration(step, opts, featureName)
      : isLast
      ? this.closingNarration(step, opts, featureName)
      : this.midNarration(step, stepIndex, featureName, businessVal, opts);

    return {
      narration,
      salesHook:   NODE_HOOKS[step.nodeType] ?? `${featureName} — enterprise-ready.`,
      description: `${step.pageTitle}: ${featureName}. ${businessVal}.`,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────

  private openingNarration(
    step:        JourneyStep,
    opts:        Required<Omit<StoryboardOptions, 'salesNarrationOverrides' | 'narrationHints'>>,
    featureName: string,
  ): string {
    const { productName: p, targetAudience: a, primaryBenefit: b } = opts;
    return (
      `${p} gives ${a} the tools to ${b}. ` +
      `Starting here at ${step.pageTitle}, you can see how the platform centralises ${featureName.toLowerCase()}.`
    );
  }

  private closingNarration(
    step:        JourneyStep,
    opts:        Required<Omit<StoryboardOptions, 'salesNarrationOverrides' | 'narrationHints'>>,
    featureName: string,
  ): string {
    const { productName: p, targetAudience: a, callToAction: cta } = opts;
    return (
      `${step.pageTitle} completes the picture. ` +
      `Together, these capabilities give ${a} full control over ${featureName.toLowerCase()}. ` +
      `${cta ?? 'Contact us to schedule a live demo.'}`
    );
  }

  private midNarration(
    step:        JourneyStep,
    stepIndex:   number,
    featureName: string,
    businessVal: string,
    opts:        Required<Omit<StoryboardOptions, 'salesNarrationOverrides' | 'narrationHints'>>,
  ): string {
    const verb = ACTION_VERBS[step.nodeType] ?? ACTION_VERBS['generic'];

    // Alternate between two sentence patterns to avoid repetition.
    if (stepIndex % 2 === 0) {
      return (
        `${step.pageTitle} ${verb} ${featureName.toLowerCase()}. ` +
        `${businessVal}.`
      );
    }

    return (
      `Here, ${opts.targetAudience} ${verb} ${featureName.toLowerCase()} directly. ` +
      `${businessVal}.`
    );
  }
}
