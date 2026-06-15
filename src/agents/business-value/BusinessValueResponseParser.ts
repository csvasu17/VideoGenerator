// ─────────────────────────────────────────────────────────────────────────────
// BusinessValueResponseParser
//
// Extracts and validates the JSON array returned by the LLM for business value
// enrichment.  Mirrors the strategy used in vision-analysis/ResponseParser.ts:
//
//  1. Direct parse — try JSON.parse() on the trimmed response
//  2. Code-fence strip — remove ```json … ``` or ``` … ``` wrappers
//  3. Array splice — find the first '[' and last ']' and parse the slice
//
// Parsing is permissive: unknown fields are dropped, missing required fields
// get safe empty-string defaults.  The `featureId` field is the only strict
// requirement — items whose featureId is not in `submittedIds` are discarded
// to prevent phantom results from hallucinating feature IDs.
// ─────────────────────────────────────────────────────────────────────────────

import type { BusinessValueOutput } from '../../core/domain/entities/BusinessValueOutput';

/** Raw shape expected from the LLM (before validation). */
interface RawItem {
  featureId?:       unknown;
  businessProblem?: unknown;
  businessBenefit?: unknown;
  customerOutcome?: unknown;
  salesNarration?:  unknown;
}

/** Validated item without source/featureName (those are added by the agent). */
export type ParsedItem = Pick<
  BusinessValueOutput,
  'featureId' | 'businessProblem' | 'businessBenefit' | 'customerOutcome' | 'salesNarration'
>;

// ─────────────────────────────────────────────────────────────────────────────
// Parser class
// ─────────────────────────────────────────────────────────────────────────────

export class BusinessValueResponseParser {
  /**
   * Parse the raw LLM response into validated items.
   *
   * @param rawText         Full text returned by the LLM provider.
   * @param submittedIds    Set of featureIds that were submitted in this batch.
   *                        Items with unknown featureIds are silently discarded.
   *
   * @returns Array of validated items.  May be shorter than submittedIds if:
   *   - The LLM omitted some items
   *   - Some items had unrecognised featureIds
   *   - The response was entirely unparseable (returns [])
   */
  parse(rawText: string, submittedIds: string[]): ParsedItem[] {
    const allowed = new Set(submittedIds);
    const raw     = this.extractArray(rawText.trim());

    if (!raw || !Array.isArray(raw) || raw.length === 0) {
      return [];
    }

    const results: ParsedItem[] = [];

    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;

      const typedItem = item as RawItem;
      const featureId = str(typedItem.featureId);

      if (!featureId || !allowed.has(featureId)) {
        // Unknown or missing featureId — discard to prevent hallucination
        continue;
      }

      results.push({
        featureId,
        businessProblem: str(typedItem.businessProblem),
        businessBenefit: str(typedItem.businessBenefit),
        customerOutcome: str(typedItem.customerOutcome),
        salesNarration:  str(typedItem.salesNarration),
      });
    }

    return results;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private — three-strategy JSON extraction
  // ──────────────────────────────────────────────────────────────────────────

  private extractArray(text: string): unknown[] | null {
    // Strategy 1 — direct parse
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* fall through */ }

    // Strategy 2 — strip markdown code fences
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenceMatch) {
      try {
        const parsed = JSON.parse(fenceMatch[1]);
        if (Array.isArray(parsed)) return parsed;
      } catch { /* fall through */ }
    }

    // Strategy 3 — splice between first '[' and last ']'
    const start = text.indexOf('[');
    const end   = text.lastIndexOf(']');
    if (start !== -1 && end > start) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        if (Array.isArray(parsed)) return parsed;
      } catch { /* fall through */ }
    }

    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Safely coerce an unknown value to a trimmed string; defaults to ''. */
function str(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}
