import type { DemoJourney } from '../../domain/entities/DemoJourney';
import type { Storyboard } from '../../domain/entities/Storyboard';
import type { NarrationHints } from '../../domain/entities/context/NarrationHints';

/**
 * Runtime context that shapes the sales-oriented messaging.
 * All fields are optional — sensible defaults are used when absent.
 */
export interface StoryboardOptions {
  /**
   * Product or platform name used in narration.
   * Default: "the Platform"
   */
  productName?: string;

  /**
   * Primary buyer persona, used to personalise openings.
   * Default: "your team"
   * Examples: "VP of Operations", "Sales Managers", "Finance teams"
   */
  targetAudience?: string;

  /**
   * The single most compelling benefit this demo is meant to land.
   * Default: "save time and make better decisions"
   * Example: "reduce reporting cycles from days to minutes"
   */
  primaryBenefit?: string;

  /**
   * Text on the closing call-to-action card.
   * Default: "Schedule a live demo today"
   */
  callToAction?: string;

  /**
   * LLM-generated scene narration overrides keyed by Feature.id.
   * When present for a scene's top feature, the override REPLACES the
   * template-generated mid-scene narration (opening and closing cards
   * still use the arc-aware templates).
   *
   * Populated by StoryboardStage from ctx.businessValueOutputs.
   * Undefined when BusinessValueStage was not run.
   */
  salesNarrationOverrides?: Record<string, string>;

  /**
   * Copy-writing hints from validated application context.
   * Populated by StoryboardStage from ctx.contextEnvelope.getNarrationHints().
   * When present, SalesNarrationEngine weaves audience, domain, and goal
   * vocabulary into mid-scene narration copy.
   * Undefined when no context was provided or confidence was too low.
   */
  narrationHints?: NarrationHints;
}

export interface IStoryboardGenerator {
  /**
   * Convert a fully-resolved DemoJourney into a sales-ready Storyboard.
   *
   * Contract:
   * - Never throws; returns a well-formed Storyboard even for empty journeys.
   * - The returned Storyboard.scenes array mirrors journey.steps in order.
   * - Sales messaging is shaped by options (product name, audience, benefit, CTA).
   */
  generate(journey: DemoJourney, options?: StoryboardOptions): Storyboard;
}
