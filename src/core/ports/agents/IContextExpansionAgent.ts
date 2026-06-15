// ─────────────────────────────────────────────────────────────────────────────
// IContextExpansionAgent — port for natural language context expansion.
//
// Takes 1–5 sentences of free-form business description from a non-technical
// user and expands it into a structured ExpandedApplicationContext.
//
// Design rules:
//   • The input MUST be natural language — never feature names, page routes,
//     or technical configuration strings.
//   • Returns null (never throws) on empty input or any failure.
//   • null → caller creates ContextEnvelope.empty() → zero pipeline change.
// ─────────────────────────────────────────────────────────────────────────────

import type { ExpandedApplicationContext } from '../../domain/entities/context/ExpandedApplicationContext';

export interface ContextExpansionInput {
  /** Natural language business description.  1–5 sentences.  Max ~500 chars. */
  readonly rawText: string;
}

export interface IContextExpansionAgent {
  /**
   * Expand minimal natural language into structured business context.
   *
   * Returns null when:
   *   - rawText is empty or whitespace-only  (no LLM call made)
   *   - LLM call fails after all retries
   *   - LLM response cannot be parsed into a valid ExpandedApplicationContext
   *
   * Null result → caller creates ContextEnvelope.empty().
   * Never throws.
   */
  expand(input: ContextExpansionInput): Promise<ExpandedApplicationContext | null>;
}
