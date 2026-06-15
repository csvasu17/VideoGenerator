// ─────────────────────────────────────────────────────────────────────────────
// ContextSignalValidator
//
// Validates every field in an ExpandedApplicationContext against all available
// discovery + vision + business-value evidence.
//
// Runs AFTER Discovery + Vision Analysis + Business Value Enrichment so it has
// access to the richest possible evidence corpus:
//   • DiscoveredPage.title         → PAGE_TITLE
//   • PageIntelligence feature names → FEATURE_NAME
//   • PageIntelligence feature businessValue → FEATURE_DESCRIPTION
//   • PageIntelligence.businessContext → VISION_SUMMARY
//   • BusinessValueOutput copy     → BUSINESS_VALUE
//
// Semantic matching uses stemmed token overlap — "Reduce energy costs" matches
// "energy usage patterns and cost drivers" through shared stems, not exact text.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ExpandedApplicationContext,
  ValidatedApplicationContext,
  ValidationSummary,
} from '../../core/domain/entities/context/ExpandedApplicationContext';
import { computeOverallConfidence } from '../../core/domain/entities/context/ExpandedApplicationContext';
import type { ConfidenceField } from '../../core/domain/entities/context/ConfidenceField';
import type {
  EvidenceReference,
  EvidenceSourceType,
  ValidatedConfidenceField,
  ValidationResult,
} from '../../core/domain/entities/context/ValidationResult';
import { applyValidationToField } from '../../core/domain/entities/context/ValidationResult';
import { CONTEXT_THRESHOLDS } from '../../core/domain/entities/context/ContextEnvelope';
import type { DiscoveredPage } from '../../core/domain/entities/DiscoveredPage';
import type { PageIntelligence } from '../../core/domain/entities/PageIntelligence';
import type { BusinessValueEnrichmentResult } from '../../core/domain/entities/BusinessValueOutput';

// ── Public input type ─────────────────────────────────────────────────────────

export interface ValidationInput {
  context:              ExpandedApplicationContext;
  discoveredPages:      DiscoveredPage[];
  pageIntelligence:     PageIntelligence[];
  businessValueOutputs?: BusinessValueEnrichmentResult;
}

// ── Internal evidence item ────────────────────────────────────────────────────

interface EvidenceItem {
  source:     EvidenceSourceType;
  text:       string;
  featureId?: string;
  pageId?:    string;
}

// ── Thresholds ────────────────────────────────────────────────────────────────

/** Minimum overlap score for an evidence item to count as a match. */
const MATCH_THRESHOLDS = {
  /** ≥2 sources at this level → STRONG_MATCH */
  STRONG:   0.25,
  /** ≥1 source at this level → WEAK_MATCH */
  WEAK:     0.18,
  /** ≥1 source at this level → INFERRED_MATCH */
  INFERRED: 0.08,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// ContextSignalValidator
// ─────────────────────────────────────────────────────────────────────────────

export class ContextSignalValidator {
  /**
   * Validate all fields in the expanded context against all available evidence.
   * Returns a ValidatedApplicationContext with per-field effective confidence.
   * Never throws.
   */
  validate(input: ValidationInput): ValidatedApplicationContext {
    const { context, discoveredPages, pageIntelligence, businessValueOutputs } = input;

    // Build evidence corpus once — shared across all field validations.
    const corpus = this.buildCorpus(discoveredPages, pageIntelligence, businessValueOutputs);

    // Validate each field.
    const domain          = this.validateField(context.domain,          corpus);
    const targetAudience  = this.validateField(context.targetAudience,  corpus);
    const businessGoals   = context.businessGoals.map(f  => this.validateField(f, corpus));
    const businessOutcomes = context.businessOutcomes.map(f => this.validateField(f, corpus));
    const demoPriorities  = context.demoPriorities.map(f  => this.validateField(f, corpus));

    // Recompute overall confidence from effective values.
    const overallConfidence = computeOverallConfidence(
      { ...domain,         confidence: domain.effectiveConfidence },
      { ...targetAudience, confidence: targetAudience.effectiveConfidence },
      businessGoals.map(f   => ({ ...f, confidence: f.effectiveConfidence })),
      businessOutcomes.map(f => ({ ...f, confidence: f.effectiveConfidence })),
      demoPriorities.map(f   => ({ ...f, confidence: f.effectiveConfidence })),
    );

    const effectiveWeight = CONTEXT_THRESHOLDS.MAX_CONTEXT_WEIGHT * overallConfidence;

    return {
      domain,
      targetAudience,
      businessGoals,
      businessOutcomes,
      demoPriorities,
      overallConfidence,
      effectiveWeight,
      validationSummary: this.buildSummary([
        domain, targetAudience,
        ...businessGoals, ...businessOutcomes, ...demoPriorities,
      ]),
    };
  }

  // ── Evidence corpus builder ───────────────────────────────────────────────

  private buildCorpus(
    pages:      DiscoveredPage[],
    intel:      PageIntelligence[],
    bvOutputs?: BusinessValueEnrichmentResult,
  ): EvidenceItem[] {
    const items: EvidenceItem[] = [];

    // PAGE_TITLE — discovered page titles
    for (const p of pages) {
      if (p.title?.trim()) {
        items.push({ source: 'PAGE_TITLE', text: p.title, pageId: p.id });
      }
    }

    // FEATURE_NAME + FEATURE_DESCRIPTION + VISION_SUMMARY — from vision analysis
    for (const page of intel) {
      if (page.businessContext?.trim()) {
        items.push({ source: 'VISION_SUMMARY', text: page.businessContext, pageId: page.pageId });
      }

      for (const feature of page.features) {
        if (feature.featureName?.trim()) {
          items.push({ source: 'FEATURE_NAME', text: feature.featureName, pageId: page.pageId });
        }
        if (feature.businessValue?.trim()) {
          items.push({
            source: 'FEATURE_DESCRIPTION',
            text:   feature.businessValue,
            pageId: page.pageId,
          });
        }
      }
    }

    // BUSINESS_VALUE — from BusinessValueAgent enrichment
    if (bvOutputs) {
      for (const bv of bvOutputs.outputs) {
        const combined = [bv.businessBenefit, bv.businessProblem, bv.customerOutcome]
          .filter(Boolean)
          .join('. ');
        if (combined.trim()) {
          items.push({ source: 'BUSINESS_VALUE', text: combined, featureId: bv.featureId });
        }
      }
    }

    return items;
  }

  // ── Field validator ───────────────────────────────────────────────────────

  private validateField<T extends string>(
    field:  ConfidenceField<T>,
    corpus: EvidenceItem[],
  ): ValidatedConfidenceField<T> {
    const signalTokens = tokenize(field.value);

    // Score every corpus item against this field value.
    const scored: Array<EvidenceItem & { score: number }> = corpus.map(item => ({
      ...item,
      score: overlapScore(signalTokens, tokenize(item.text)),
    }));

    // Filter to items that meet at least the INFERRED threshold.
    const matched = scored
      .filter(e => e.score >= MATCH_THRESHOLDS.INFERRED)
      .sort((a, b) => b.score - a.score);

    // Determine ValidationResult by score + source breadth.
    const result    = this.classify(matched);
    const topItems  = matched.slice(0, 5); // keep top 5 references at most

    const matchedRefs: EvidenceReference[] = topItems.map(e => ({
      source:        e.source,
      text:          e.text.slice(0, 200),
      featureId:     e.featureId,
      pageId:        e.pageId,
      semanticScore: e.score,
    }));

    return applyValidationToField(field, result, matchedRefs, []);
  }

  // ── Classification ────────────────────────────────────────────────────────

  private classify(
    matched: Array<EvidenceItem & { score: number }>,
  ): ValidationResult {
    if (matched.length === 0) return 'UNCONFIRMED';

    const maxScore = matched[0].score;

    // Count distinct source types that meet the STRONG threshold.
    const strongSources = new Set(
      matched
        .filter(e => e.score >= MATCH_THRESHOLDS.STRONG)
        .map(e => e.source),
    );

    if (strongSources.size >= 2) return 'STRONG_MATCH';
    if (maxScore >= MATCH_THRESHOLDS.WEAK) return 'WEAK_MATCH';
    if (maxScore >= MATCH_THRESHOLDS.INFERRED) return 'INFERRED_MATCH';
    return 'UNCONFIRMED';
  }

  // ── Validation summary builder ────────────────────────────────────────────

  private buildSummary(
    fields: ReadonlyArray<ValidatedConfidenceField<string>>,
  ): ValidationSummary {
    let strongMatchCount = 0, weakMatchCount = 0, inferredMatchCount = 0;
    let unconfirmedCount = 0, conflictCount = 0;

    for (const f of fields) {
      switch (f.validationResult) {
        case 'STRONG_MATCH':   strongMatchCount++;   break;
        case 'WEAK_MATCH':     weakMatchCount++;     break;
        case 'INFERRED_MATCH': inferredMatchCount++; break;
        case 'UNCONFIRMED':    unconfirmedCount++;   break;
        case 'CONFLICT':       conflictCount++;       break;
      }
    }

    const total = fields.length;
    const supported = strongMatchCount + weakMatchCount + inferredMatchCount;

    const humanReadable =
      total === 0
        ? 'No fields to validate'
        : `${supported}/${total} fields supported by evidence ` +
          `(${strongMatchCount} strong, ${weakMatchCount} weak, ` +
          `${inferredMatchCount} inferred, ${unconfirmedCount} unconfirmed)`;

    return { strongMatchCount, weakMatchCount, inferredMatchCount, unconfirmedCount, conflictCount, humanReadable };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Text similarity utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tokenise text into a set of normalised stems.
 * - Lowercases and strips punctuation.
 * - Drops tokens shorter than 3 characters (removes most stopwords).
 * - Applies minimal suffix stemming (plurals, -ing, -ed).
 */
export function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3)
    .map(stem);

  return new Set(words);
}

/** Minimal suffix stemmer — strips the most common English inflections. */
function stem(word: string): string {
  if (word.length > 6 && word.endsWith('ing'))  return word.slice(0, -3);
  if (word.length > 5 && word.endsWith('tion'))  return word.slice(0, -3); // "reduction" → "reduct"
  if (word.length > 5 && word.endsWith('ness'))  return word.slice(0, -4);
  if (word.length > 5 && word.endsWith('ment'))  return word.slice(0, -4);
  if (word.length > 4 && word.endsWith('ed'))    return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('er'))    return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('ly'))    return word.slice(0, -2);
  if (word.length > 4 && !word.endsWith('ss') && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/**
 * Compute token-set overlap score between two pre-tokenized sets.
 * Score = |A ∩ B| / max(|A|, |B|).
 * Returns 0 when either set is empty.
 */
export function overlapScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const tok of a) {
    if (b.has(tok)) intersection++;
  }

  return intersection / Math.max(a.size, b.size);
}
