import type { DemoJourney } from '../../core/domain/entities/DemoJourney';
import type { Scene } from '../../core/domain/entities/Storyboard';
import type { StoryboardOptions } from '../../core/ports/agents/IStoryboardGenerator';
import { SalesNarrationEngine } from './SalesNarrationEngine';
import type { NarrationContext, NarrationResult } from './SalesNarrationEngine';
import { HighlightTargetResolver } from './HighlightTargetResolver';
import { TransitionSelector } from './TransitionSelector';

/** Structural interface accepted by SceneBuilder for any narration engine. */
export interface INarrationEngine {
  generate(ctx: NarrationContext): NarrationResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<Omit<StoryboardOptions, 'salesNarrationOverrides' | 'narrationHints'>> = {
  productName:    'the Platform',
  targetAudience: 'your team',
  primaryBenefit: 'save time and make better decisions',
  callToAction:   'Schedule a live demo today',
};

// ─────────────────────────────────────────────────────────────────────────────
// Page-title sanitization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map common SPA route segments to human-readable section labels.
 * Add entries here when a new target app uses different URL conventions.
 */
const PATH_LABELS: Record<string, string> = {
  '':           'Dashboard',
  'dashboard':  'Dashboard',
  'sites':      'Sites & Buildings',
  'alarms':     'Alarm Center',
  'devices':    'Device Fleet',
  'insights':   'Insights & Analytics',
  'ai-predict': 'AI Predictions',
  'simulator':  'Fault Simulator',
  'users':      'User Management',
  'settings':   'Platform Settings',
  'login':      'Login',
  'signup':     'Sign Up',
  'reports':    'Reports',
  'analytics':  'Analytics',
  'admin':      'Administration',
  'profile':    'User Profile',
};

function toTitleCase(s: string): string {
  return s
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Derive a URL-based label for the page.
 * Falls back gracefully when the URL cannot be parsed.
 */
function labelFromUrl(url: string): string {
  try {
    const { pathname } = new URL(url);
    const segment = pathname.replace(/^\//, '').replace(/\/$/, '').split('/')[0] ?? '';
    return PATH_LABELS[segment] ?? toTitleCase(segment || 'Dashboard');
  } catch {
    return 'Platform Page';
  }
}

/**
 * Sanitize a raw page title so that bare product-name titles (e.g. every page
 * of a SPA that shares the same <title> tag) get replaced with a meaningful
 * URL-derived label.
 *
 * A title is considered "bare product noise" when, after stripping trailing
 * suffixes like "input", "navigation", "overview", "dashboard", the remainder
 * matches the productName.
 */
function sanitizePageTitle(
  rawTitle:    string,
  url:         string,
  productName: string,
): string {
  const cleanTitle = rawTitle.trim();
  const cleanProduct = productName.trim();

  // Strip common trailing route descriptors that SPAs append to a shared title
  const titleBase = cleanTitle
    .replace(/\s+(–|—|-|\|)\s+.*/,  '')   // "App Name — Route" → "App Name"
    .replace(/\s+(input|navigation|overview|dashboard|form|view|page)$/i, '')
    .trim();

  // Case-insensitive match against the resolved product name
  if (titleBase.toLowerCase() === cleanProduct.toLowerCase()) {
    return labelFromUrl(url);
  }

  return cleanTitle;
}

// ─────────────────────────────────────────────────────────────────────────────
// SceneBuilder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a DemoJourney's steps into fully-rendered Scenes.
 *
 * Responsibilities:
 *  1. Delegate sales narration to SalesNarrationEngine
 *  2. Resolve highlight targets via HighlightTargetResolver
 *  3. Select scene transitions via TransitionSelector
 *  4. Wire everything into Scene objects
 */
export class SceneBuilder {
  constructor(
    private readonly narrationEngine:    INarrationEngine        = new SalesNarrationEngine(),
    private readonly highlightResolver:  HighlightTargetResolver = new HighlightTargetResolver(),
    private readonly transitionSelector: TransitionSelector      = new TransitionSelector(),
  ) {}

  buildAll(journey: DemoJourney, options: StoryboardOptions = {}): Scene[] {
    const opts: Required<Omit<StoryboardOptions, 'salesNarrationOverrides' | 'narrationHints'>> = {
      productName:    options.productName    ?? DEFAULT_OPTIONS.productName,
      targetAudience: options.targetAudience ?? DEFAULT_OPTIONS.targetAudience,
      primaryBenefit: options.primaryBenefit ?? DEFAULT_OPTIONS.primaryBenefit,
      callToAction:   options.callToAction   ?? DEFAULT_OPTIONS.callToAction,
    };
    // LLM-generated narration overrides keyed by Feature.id.
    // When present for a mid-scene's top feature, these replace the template.
    const narrationOverrides = options.salesNarrationOverrides ?? {};
    // Context narration hints for vocabulary enrichment of mid-scene copy.
    const hints = options.narrationHints;

    const steps = journey.steps;
    const total = steps.length;

    return steps.map((step, idx) => {
      const isFirst  = idx === 0;
      const isLast   = idx === total - 1;
      const nextStep = steps[idx + 1];

      // ── 1. Sales narration ───────────────────────────────────────────────
      // Sanitize the page title so narration templates never emit raw app
      // product-name titles (e.g. "Rheem TotalView") when every page shares
      // the same <title> tag.  A sanitized copy of the step is used for all
      // text generation; the original step is unchanged.
      const sanitizedStep = {
        ...step,
        pageTitle: sanitizePageTitle(step.pageTitle, step.url, opts.productName),
      };
      const { narration: generatedNarration, salesHook, description } = this.narrationEngine.generate({
        step: sanitizedStep,
        stepIndex:  idx,
        totalSteps: total,
        arc:        journey.narrativeArc,
        opts,
        hints,
      });

      // Use LLM salesNarration for mid-scenes only; opening/closing keep templates.
      const topFeatureId = step.features[0]?.featureId;
      const narration =
        !isFirst && !isLast && topFeatureId && narrationOverrides[topFeatureId]
          ? narrationOverrides[topFeatureId]
          : generatedNarration;

      // ── 2. Highlight target ──────────────────────────────────────────────
      // Use sanitizedStep so highlight descriptions don't embed raw product names.
      const highlightTarget = this.highlightResolver.resolve(sanitizedStep);

      // ── 3. Transition ────────────────────────────────────────────────────
      //  transitionLabel comes from JourneyStep — it's the anchor text/action
      //  that navigates to the next page (e.g. "Click 'Create Project'").
      const transition = this.transitionSelector.select(
        step.nodeType,
        nextStep?.nodeType,
        step.transitionLabel,
        isLast,
      );

      // ── 4. Assemble scene ────────────────────────────────────────────────
      return {
        sceneNumber:     step.stepNumber,
        pageId:          step.pageId,
        title:           sanitizedStep.pageTitle,
        description,
        narration,
        salesHook,
        highlightTarget,
        durationSec:     step.estimatedDurationSec,
        transition,
      } satisfies Scene;
    });
  }
}
