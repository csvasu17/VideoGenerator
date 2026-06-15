// ─────────────────────────────────────────────────────────────────────────────
// NarrationHints — copy-writing guidance derived from validated context.
//
// Passed to StoryboardGenerator and NarrationGenerator (Phase 5+).
// Only carries signals whose effectiveConfidence meets MIN_FOR_NARRATION (0.65).
// Fields are null when confidence is too low to influence narration copy.
// ─────────────────────────────────────────────────────────────────────────────

export interface NarrationHints {
  /**
   * Primary user persona label.
   * e.g. "Facility Managers"
   * null when audience confidence is below MIN_FOR_NARRATION.
   */
  readonly audienceLabel:  string | null;

  /**
   * Industry / functional domain label.
   * e.g. "Energy Management"
   * null when domain confidence is below MIN_FOR_NARRATION.
   */
  readonly domainLabel:    string | null;

  /**
   * Key vocabulary terms to weave into narration scripts.
   * Derived from domain, audience, and high-confidence business goals.
   */
  readonly keyTerms:       string[];

  /**
   * Comma-separated top business goals for narration arc guidance.
   * null when no goals meet MIN_FOR_NARRATION threshold.
   * e.g. "reduce energy costs, improve equipment uptime"
   */
  readonly goalSummary:    string | null;

  /**
   * Soft tone / vocabulary hint for LLM narration prompts.
   * e.g. "energy management for facility managers"
   * null when neither domain nor audience is available.
   */
  readonly toneGuidance:   string | null;
}
