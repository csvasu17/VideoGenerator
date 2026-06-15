/**
 * FeatureImportanceResolver — pure function, no LLM, no I/O.
 *
 * Computes the featureImportance composite score (0–1) from up to four
 * optional pipeline signals, each with a defined fallback:
 *
 *   featureImportance =
 *       0.40 × featureRankScore        (ordinal rank — strongest story signal)
 *     + 0.28 × businessValueTierScore  (category — separates AI from Settings)
 *     + 0.20 × narrativeEmphasisScore  (narration alignment — camera → words)
 *     + 0.12 × contextConfidenceScore  (quality gate — avoid invisible features)
 *
 * Fallback hierarchy when signals are absent:
 *   rank:       uses spotlightTarget.priority (always available)
 *   tier:       uses elementType proxy table
 *   narration:  NarrationEmphasisParser on scene narration text (always available)
 *   confidence: 0.75 conservative default
 */

import type { ElementType }              from '../camera/types';
import type { PrioritizedFeature }       from '../../core/domain/entities/PrioritizedFeature';
import type { BusinessValueOutput }      from '../../core/domain/entities/BusinessValueOutput';
import type {
  BusinessValueTier,
  FeatureImportanceResult,
  FeatureImportanceSignals,
  NarrativePosition,
} from './types';
import { BUSINESS_TIER_WEIGHTS }         from './types';
import { NarrationEmphasisParser }       from './NarrationEmphasisParser';
import type { NarrationInput }           from './NarrationEmphasisParser';

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolverInput {
  /** The feature's display label (from highlightTarget.description or scene.title). */
  featureLabel:      string;
  /** spotlightTarget.priority — always available; used when rank signal is absent. */
  fallbackPriority:  number;
  /** Primary element type for tier proxy fallback. */
  elementType:       ElementType;
  /** Optional: full ranked feature list from FeatureRankingStage. */
  rankedFeatures?:   PrioritizedFeature[];
  /** Optional: per-feature business copy from BusinessValueStage. */
  businessOutputs?:  BusinessValueOutput[];
  /** Optional: scene narration for NarrationEmphasisParser. */
  narration?:        NarrationInput;
  /**
   * Optional: explicit context confidence (0–1) from ContextValidationStage.
   * When absent, defaults to 0.75.
   */
  contextConfidence?: number;
}

export class FeatureImportanceResolver {
  private readonly narrationParser = new NarrationEmphasisParser();

  resolve(input: ResolverInput): FeatureImportanceResult {
    const signals: FeatureImportanceSignals = {
      rankSource:      'default',
      tierSource:      'default',
      confidenceSource:'default',
      emphasisSource:  'default',
    };

    // ── A: featureRankScore ──────────────────────────────────────────────────
    let featureRank: number | undefined;
    let featureTotalRanked: number | undefined;
    let featureRankScore: number;

    const matched = findMatchingFeature(input.featureLabel, input.rankedFeatures);
    if (matched) {
      featureRank         = matched.rank;
      featureTotalRanked  = input.rankedFeatures!.length;
      featureRankScore    = computeRankScore(matched.rank);
      signals.rankSource  = 'pipeline';
    } else if (input.fallbackPriority > 0) {
      featureRankScore   = clamp(input.fallbackPriority, 0, 1);
      signals.rankSource = 'fallback_priority';
    } else {
      featureRankScore   = 0.60;
      signals.rankSource = 'default';
    }

    // ── B: businessValueTierScore ────────────────────────────────────────────
    let businessValueTier: BusinessValueTier | undefined;
    let businessValueTierScore: number;

    const businessOutput = findMatchingOutput(input.featureLabel, input.businessOutputs);
    if (businessOutput) {
      // We have business copy — derive tier from the matched feature's outcomeType
      const feature = matched?.feature;
      if (feature?.businessValue?.outcomeType) {
        businessValueTier      = outcomeTypeToBvTier(feature.businessValue.outcomeType);
        businessValueTierScore = BUSINESS_TIER_WEIGHTS[businessValueTier];
        signals.tierSource     = 'pipeline';
      } else {
        businessValueTier      = elementTypeToBvTier(input.elementType);
        businessValueTierScore = BUSINESS_TIER_WEIGHTS[businessValueTier];
        signals.tierSource     = 'elementType_proxy';
      }
    } else if (matched?.feature?.businessValue?.outcomeType) {
      businessValueTier      = outcomeTypeToBvTier(matched.feature.businessValue.outcomeType);
      businessValueTierScore = BUSINESS_TIER_WEIGHTS[businessValueTier];
      signals.tierSource     = 'pipeline';
    } else {
      businessValueTier      = elementTypeToBvTier(input.elementType);
      businessValueTierScore = BUSINESS_TIER_WEIGHTS[businessValueTier];
      signals.tierSource     = 'elementType_proxy';
    }

    // ── C: contextConfidenceScore ────────────────────────────────────────────
    let contextConfidence: number;
    if (input.contextConfidence !== undefined) {
      contextConfidence        = clamp(input.contextConfidence, 0, 1);
      signals.confidenceSource = 'pipeline';
    } else {
      contextConfidence        = 0.75;  // conservative default
      signals.confidenceSource = 'default';
    }

    // ── D: narrativeEmphasisScore ────────────────────────────────────────────
    let narrativeEmphasis: number;
    let narrativePosition: NarrativePosition;

    if (input.narration) {
      const result        = this.narrationParser.parse(input.featureLabel, input.narration);
      narrativeEmphasis   = result.score;
      narrativePosition   = result.position;
      signals.emphasisSource = 'narration_parse';
    } else {
      narrativeEmphasis   = 0.50;
      narrativePosition   = 'absent';
      signals.emphasisSource = 'default';
    }

    // ── Composite ────────────────────────────────────────────────────────────
    const featureImportance = clamp(
      0.40 * featureRankScore +
      0.28 * businessValueTierScore +
      0.20 * narrativeEmphasis +
      0.12 * contextConfidence,
      0, 1,
    );

    return {
      featureImportance,
      featureRank,
      featureTotalRanked,
      businessValueTier,
      contextConfidence,
      narrativeEmphasis,
      narrativePosition,
      signals,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Non-linear rank score:
 *   rank 1 = 1.00, rank 2 = 0.88, rank 3 = 0.78, rank 5 = 0.63, rank 10 = 0.35
 *
 * Formula: max(0, 1.0 - (k-1) × 0.072 - (k-1)² × 0.004)
 */
function computeRankScore(rank: number): number {
  const k = Math.max(1, rank);
  return clamp(1.0 - (k - 1) * 0.072 - Math.pow(k - 1, 2) * 0.004, 0, 1);
}

/**
 * Fuzzy name match — tokenise both sides, require ≥ 2 shared tokens
 * or ≥ 1 shared token for short labels.
 */
function findMatchingFeature(
  label:    string,
  features: PrioritizedFeature[] | undefined,
): PrioritizedFeature | undefined {
  if (!features || features.length === 0 || !label) return undefined;

  const labelTokens = tokeniseLabel(label);
  const threshold   = labelTokens.length >= 3 ? 2 : 1;

  for (const pf of features) {
    const nameTokens = tokeniseLabel(pf.feature.name);
    const hits = labelTokens.filter(t => nameTokens.includes(t)).length;
    if (hits >= threshold) return pf;
  }
  return undefined;
}

function findMatchingOutput(
  label:   string,
  outputs: BusinessValueOutput[] | undefined,
): BusinessValueOutput | undefined {
  if (!outputs || outputs.length === 0 || !label) return undefined;

  const labelTokens = tokeniseLabel(label);
  const threshold   = labelTokens.length >= 3 ? 2 : 1;

  for (const bo of outputs) {
    const nameTokens = tokeniseLabel(bo.featureName);
    const hits = labelTokens.filter(t => nameTokens.includes(t)).length;
    if (hits >= threshold) return bo;
  }
  return undefined;
}

const LABEL_STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
]);

function tokeniseLabel(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !LABEL_STOP.has(t));
}

import type { OutcomeType } from '../../core/domain/entities/Feature';

function outcomeTypeToBvTier(outcome: OutcomeType): BusinessValueTier {
  switch (outcome) {
    case 'revenue':     return 'revenue_impact';
    case 'cost_saving': return 'cost_reduction';
    case 'efficiency':  return 'operational_efficiency';
    case 'risk':        return 'safety_compliance';
    default:            return 'informational';
  }
}

/**
 * Proxy mapping from ElementType to BusinessValueTier.
 * Used when BusinessValueStage data is unavailable.
 */
function elementTypeToBvTier(et: ElementType): BusinessValueTier {
  switch (et) {
    case 'alert':      return 'safety_compliance';
    case 'kpi_card':   return 'informational';
    case 'metric':     return 'informational';
    case 'chart':      return 'informational';
    case 'modal':      return 'operational_efficiency';
    case 'button':     return 'operational_efficiency';
    case 'form':       return 'operational_efficiency';
    case 'table':      return 'informational';
    case 'list':       return 'informational';
    case 'map':        return 'informational';
    case 'navigation': return 'structural';
    default:           return 'informational';
  }
}
