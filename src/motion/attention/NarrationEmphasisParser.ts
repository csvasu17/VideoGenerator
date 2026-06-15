/**
 * NarrationEmphasisParser — pure text analysis, no LLM.
 *
 * Determines where a feature's label appears in the scene narration text
 * (salesHook → lead → body → close → absent) and returns an emphasis score.
 *
 * Matching strategy:
 *   - Tokenises the feature label and the narration into lowercase words.
 *   - Checks each narration segment in priority order.
 *   - Match requires ≥ 2 label tokens to appear within a 10-word sliding window
 *     (handles paraphrasing, e.g. "Scenario Playback Speed" → "control scenario playback").
 *   - Falls back to single-token match for very short labels (1–2 words).
 *
 * No I/O, no async. Pure string functions.
 */

import type { NarrativePosition } from './types';
import { NARRATIVE_POSITION_SCORES } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface NarrationInput {
  salesHook:  string;
  narration:  string;
}

export interface EmphasisResult {
  position: NarrativePosition;
  score:    number;
}

export class NarrationEmphasisParser {
  /**
   * Parse narration text to find where (if anywhere) the feature label appears.
   *
   * @param label     The feature's display label (1–4 words).
   * @param input     The scene's salesHook + narration strings.
   * @returns         Position + emphasis score (0–1).
   */
  parse(label: string, input: NarrationInput | undefined): EmphasisResult {
    if (!label || !input) {
      return { position: 'absent', score: NARRATIVE_POSITION_SCORES.absent };
    }

    const labelTokens = tokenise(label);
    if (labelTokens.length === 0) {
      return { position: 'absent', score: NARRATIVE_POSITION_SCORES.absent };
    }

    // ── Check salesHook ──────────────────────────────────────────────────────
    if (containsLabel(tokenise(input.salesHook), labelTokens)) {
      return { position: 'hook', score: NARRATIVE_POSITION_SCORES.hook };
    }

    // ── Split narration into sentences ───────────────────────────────────────
    const sentences = splitSentences(input.narration);

    // First sentence → lead
    if (sentences.length > 0 && containsLabel(tokenise(sentences[0]), labelTokens)) {
      return { position: 'lead', score: NARRATIVE_POSITION_SCORES.lead };
    }

    // Last sentence → close
    if (sentences.length > 1 && containsLabel(tokenise(sentences[sentences.length - 1]), labelTokens)) {
      return { position: 'close', score: NARRATIVE_POSITION_SCORES.close };
    }

    // Middle sentences → body
    for (let i = 1; i < sentences.length - 1; i++) {
      if (containsLabel(tokenise(sentences[i]), labelTokens)) {
        return { position: 'body', score: NARRATIVE_POSITION_SCORES.body };
      }
    }

    // Also check last sentence as body if there were only 2 sentences total
    // (avoiding double-counting with the 'close' check above)
    if (sentences.length === 2 && containsLabel(tokenise(sentences[1]), labelTokens)) {
      return { position: 'body', score: NARRATIVE_POSITION_SCORES.body };
    }

    return { position: 'absent', score: NARRATIVE_POSITION_SCORES.absent };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Common words to strip before token matching. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'your', 'our', 'is', 'are', 'can', 'this', 'that',
]);

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Returns true when labelTokens has sufficient overlap with textTokens.
 *
 * Matching rules:
 *   - If label has ≥ 3 tokens: need ≥ 2 tokens to appear within a 10-word window.
 *   - If label has 1–2 tokens: need ≥ 1 token match (with length > 4 to avoid noise).
 */
function containsLabel(textTokens: string[], labelTokens: string[]): boolean {
  if (labelTokens.length === 0 || textTokens.length === 0) return false;

  const labelSet = new Set(labelTokens);
  const threshold = labelTokens.length >= 3 ? 2 : 1;

  if (threshold === 1) {
    // Single-token or two-token label — just check if any label token appears
    return labelTokens.some(t => t.length > 4 && textTokens.includes(t));
  }

  // Sliding window of 10 tokens
  const windowSize = 10;
  for (let i = 0; i <= textTokens.length - windowSize; i++) {
    const window = textTokens.slice(i, i + windowSize);
    const hits = window.filter(t => labelSet.has(t)).length;
    if (hits >= threshold) return true;
  }

  // Also check the full text without windowing (catches spread-out matches)
  const totalHits = textTokens.filter(t => labelSet.has(t)).length;
  return totalHits >= threshold;
}
