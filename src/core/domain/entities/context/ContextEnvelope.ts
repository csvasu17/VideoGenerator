// ─────────────────────────────────────────────────────────────────────────────
// ContextEnvelope — runtime carrier for optional application context.
//
// Always present in PipelineContext regardless of whether the user provided
// context text.  Downstream agents call isPresent() before using any context
// data — this prevents null propagation throughout the pipeline.
//
// Lifecycle:
//   1. ContextEnvelope.empty()        — created when no context text is given.
//   2. ContextEnvelope.fromContext()  — created after ContextExpansionAgent
//                                       produces an ExpandedApplicationContext.
//   3. applyValidation()              — called once by ContextSignalValidator
//                                       (Phase 3) after all evidence is ready.
//
// Design rules:
//   • isPresent() === false  → zero behavioural change from current pipeline.
//   • Context is additive-only: it can boost feature scores but never penalise.
//   • getEffectiveWeight() never exceeds MAX_CONTEXT_WEIGHT (0.15).
//   • applyValidation() is idempotent-guarded — a second call throws.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ExpandedApplicationContext,
  ValidatedApplicationContext,
} from './ExpandedApplicationContext';
import type { NarrationHints } from './NarrationHints';

// ── Thresholds ────────────────────────────────────────────────────────────────

export const CONTEXT_THRESHOLDS = {
  /** Minimum effectiveConfidence for a field to influence feature ranking. */
  MIN_FOR_RANKING:    0.50,
  /**
   * Minimum effectiveConfidence for a field to contribute to narration copy.
   * Stricter than ranking because narration makes explicit claims.
   */
  MIN_FOR_NARRATION:  0.65,
  /** Hard ceiling on context's share of any downstream score. */
  MAX_CONTEXT_WEIGHT: 0.15,
} as const;

// ── ContextEnvelope ───────────────────────────────────────────────────────────

export class ContextEnvelope {
  private readonly _expanded: ExpandedApplicationContext | null;
  private _validated:          ValidatedApplicationContext | null = null;
  private _validationApplied:  boolean                           = false;

  private constructor(expanded: ExpandedApplicationContext | null) {
    this._expanded = expanded;
  }

  // ── Factory methods ─────────────────────────────────────────────────────────

  /** Create an envelope carrying expanded context from ContextExpansionAgent. */
  static fromContext(expanded: ExpandedApplicationContext): ContextEnvelope {
    return new ContextEnvelope(expanded);
  }

  /**
   * Create an empty envelope.  isPresent() === false.
   * Use when the user did not supply context text.
   */
  static empty(): ContextEnvelope {
    return new ContextEnvelope(null);
  }

  // ── Guards ──────────────────────────────────────────────────────────────────

  /** True when the user provided context text and expansion succeeded. */
  isPresent(): boolean {
    return this._expanded !== null;
  }

  /** True when ContextSignalValidator (Phase 3) has run. */
  isValidated(): boolean {
    return this._validationApplied;
  }

  // ── Accessors ───────────────────────────────────────────────────────────────

  /** Raw expansion result.  Null when no context was provided. */
  get expanded(): ExpandedApplicationContext | null {
    return this._expanded;
  }

  /** Validated result.  Null until Phase 3 validation completes. */
  get validated(): ValidatedApplicationContext | null {
    return this._validated;
  }

  /**
   * Best available context for downstream use.
   * Returns validated context when Phase 3 has run; raw expansion otherwise.
   * Returns null when no context was provided.
   */
  get active(): ExpandedApplicationContext | ValidatedApplicationContext | null {
    return this._validated ?? this._expanded;
  }

  // ── Validation ──────────────────────────────────────────────────────────────

  /**
   * Apply validation results produced by ContextSignalValidator (Phase 3).
   *
   * Preconditions:
   *   - isPresent() must be true (cannot validate an empty envelope).
   *   - Must not have been called before (one-shot).
   *
   * @throws Error if called on an empty envelope or called a second time.
   */
  applyValidation(validated: ValidatedApplicationContext): void {
    if (!this._expanded) {
      throw new Error(
        '[ContextEnvelope] Cannot apply validation to an empty envelope. ' +
        'Check isPresent() before calling applyValidation().',
      );
    }
    if (this._validationApplied) {
      throw new Error(
        '[ContextEnvelope] applyValidation() may only be called once. ' +
        'Validation has already been applied to this envelope.',
      );
    }
    this._validated        = validated;
    this._validationApplied = true;
  }

  // ── Effective weight ────────────────────────────────────────────────────────

  /**
   * Context weight for downstream score contributions: 0.0–0.15.
   *
   * Formula: MAX_CONTEXT_WEIGHT × overallConfidence
   *   - Uses validated overallConfidence when Phase 3 has run.
   *   - Uses raw overallConfidence otherwise.
   *   - Returns 0.0 when no context is present.
   *
   * Downstream scoring: contextBoost = baseScore × getEffectiveWeight()
   * Final score never decreases because of this (additive-only).
   */
  getEffectiveWeight(): number {
    if (!this._expanded) return 0;
    const conf = this.active?.overallConfidence ?? 0;
    return CONTEXT_THRESHOLDS.MAX_CONTEXT_WEIGHT * conf;
  }

  // ── Narration hints ─────────────────────────────────────────────────────────

  /**
   * Copy-writing hints for StoryboardGenerator and NarrationGenerator (Phase 5+).
   * Includes only signals whose effectiveConfidence ≥ MIN_FOR_NARRATION.
   * Returns null when no context is present.
   */
  getNarrationHints(): NarrationHints | null {
    const ctx = this.active;
    if (!ctx) return null;

    const threshold = CONTEXT_THRESHOLDS.MIN_FOR_NARRATION;

    const domainConf   = this.resolveConfidence(ctx.domain);
    const audienceConf = this.resolveConfidence(ctx.targetAudience);

    const domainLabel   = domainConf   >= threshold ? ctx.domain.value        : null;
    const audienceLabel = audienceConf >= threshold ? ctx.targetAudience.value : null;

    const eligibleGoals = ctx.businessGoals
      .filter(g => this.resolveConfidence(g) >= threshold)
      .slice(0, 3)
      .map(g => g.value);

    const keyTerms: string[] = [
      ...(domainLabel   ? [domainLabel]   : []),
      ...(audienceLabel ? [audienceLabel] : []),
      ...eligibleGoals,
    ];

    return {
      audienceLabel,
      domainLabel,
      keyTerms,
      goalSummary:  eligibleGoals.length > 0 ? eligibleGoals.join(', ') : null,
      toneGuidance: this.buildToneGuidance(domainLabel, audienceLabel),
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * For validated fields, use effectiveConfidence; for raw fields, use confidence.
   * This keeps narration thresholds consistent whether or not Phase 3 has run.
   */
  private resolveConfidence(
    field: { confidence: number; effectiveConfidence?: number },
  ): number {
    return (field as { effectiveConfidence?: number }).effectiveConfidence
      ?? field.confidence;
  }

  private buildToneGuidance(
    domain:   string | null,
    audience: string | null,
  ): string | null {
    if (!domain && !audience) return null;
    const parts: string[] = [];
    if (domain)   parts.push(domain.toLowerCase());
    if (audience) parts.push(`for ${audience.toLowerCase()}`);
    return parts.join(' ');
  }
}
