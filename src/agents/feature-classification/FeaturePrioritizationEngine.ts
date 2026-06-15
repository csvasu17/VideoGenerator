import type { Feature } from '../../core/domain/entities/Feature';
import type { PrioritizedFeature, ScoringDimensions } from '../../core/domain/entities/PrioritizedFeature';
import type { IScorer, ScoringDimension, ScoringWeights } from './scoring/IScorer';
import { DEFAULT_WEIGHTS } from './scoring/IScorer';
import { BusinessValueScorer } from './scoring/BusinessValueScorer';
import { VisualAppealScorer } from './scoring/VisualAppealScorer';
import { UserImportanceScorer } from './scoring/UserImportanceScorer';
import { RevenueImpactScorer } from './scoring/RevenueImpactScorer';

export interface PrioritizationOptions {
  /** Maximum number of features to return. Default: 10. */
  topN?: number;
  /** Features with composite score below this threshold are excluded. Default: 0. */
  minCompositeScore?: number;
}

const DEFAULT_OPTIONS: Required<PrioritizationOptions> = {
  topN: 10,
  minCompositeScore: 0,
};

export class FeaturePrioritizationEngine {
  private readonly scorerMap: Map<ScoringDimension, IScorer>;

  constructor(
    private readonly scorers: IScorer[],
    private readonly weights: ScoringWeights = DEFAULT_WEIGHTS,
  ) {
    this.scorerMap = new Map(scorers.map(s => [s.dimension, s]));
    assertWeightsValid(weights);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Score, rank, and return the top features for the demo video.
   * Input order is preserved as a stable tiebreaker.
   */
  prioritize(
    features: Feature[],
    options: PrioritizationOptions = {},
  ): PrioritizedFeature[] {
    const { topN, minCompositeScore } = { ...DEFAULT_OPTIONS, ...options };

    if (features.length === 0) return [];

    const scored = features
      .map((feature, index) => this.scoreFeature(feature, index))
      .filter(pf => pf.composite >= minCompositeScore)
      .sort(byCompositeDesc);

    return scored
      .slice(0, topN)
      .map((pf, i) => ({ ...pf, rank: i + 1 }));
  }

  // ── Scoring ─────────────────────────────────────────────────────────────────

  private scoreFeature(feature: Feature, originalIndex: number): PrioritizedFeature {
    const scores = this.runAllScorers(feature);
    const composite = this.weightedComposite(scores);
    const rationale = buildRationale(feature, scores, composite);

    return {
      feature,
      scores,
      composite: round2(composite),
      rank: 0, // assigned after sort
      rationale,
      // Attach originalIndex as a hidden stable-sort key; stripped after sorting.
      ...(({ _idx: originalIndex } as unknown) as object),
    };
  }

  private runAllScorers(feature: Feature): ScoringDimensions {
    return {
      businessValue:  this.runScorer('businessValue',  feature),
      visualAppeal:   this.runScorer('visualAppeal',   feature),
      userImportance: this.runScorer('userImportance', feature),
      revenueImpact:  this.runScorer('revenueImpact',  feature),
    };
  }

  private runScorer(dimension: ScoringDimension, feature: Feature): number {
    const scorer = this.scorerMap.get(dimension);
    if (!scorer) return 0;
    const raw = scorer.score(feature);
    return Math.round(Math.min(100, Math.max(0, raw)));
  }

  private weightedComposite(scores: ScoringDimensions): number {
    const w = this.weights;
    return (
      scores.businessValue  * w.businessValue  +
      scores.visualAppeal   * w.visualAppeal   +
      scores.userImportance * w.userImportance +
      scores.revenueImpact  * w.revenueImpact
    );
  }

  // ── Weight accessors ────────────────────────────────────────────────────────

  getWeights(): Readonly<ScoringWeights> {
    return { ...this.weights };
  }

  withWeights(weights: Partial<ScoringWeights>): FeaturePrioritizationEngine {
    const merged = normaliseWeights({ ...this.weights, ...weights });
    return new FeaturePrioritizationEngine(this.scorers, merged);
  }
}

// ── Sort comparator ───────────────────────────────────────────────────────────

function byCompositeDesc(
  a: PrioritizedFeature & { _idx?: number },
  b: PrioritizedFeature & { _idx?: number },
): number {
  const diff = b.composite - a.composite;
  if (diff !== 0) return diff;
  // Stable tiebreaker: preserve original insertion order.
  return (a._idx ?? 0) - (b._idx ?? 0);
}

// ── Rationale builder ─────────────────────────────────────────────────────────

function buildRationale(
  feature: Feature,
  scores: ScoringDimensions,
  composite: number,
): string {
  const lines: string[] = [];

  const ranked = (Object.entries(scores) as Array<[ScoringDimension, number]>)
    .sort(([, a], [, b]) => b - a);

  for (const [dim, score] of ranked.slice(0, 2)) {
    if (score >= 65) lines.push(dimensionPhrase(dim, score, feature));
  }

  if (feature.signals.isOnCriticalPath) {
    lines.push('Part of critical user flow');
  }

  if (feature.businessValue.quantifiedImpact) {
    lines.push(`Quantified outcome: ${feature.businessValue.quantifiedImpact}`);
  }

  if (lines.length === 0) {
    lines.push(`Composite score ${composite.toFixed(0)}/100`);
  }

  return lines.slice(0, 3).join('. ');
}

function dimensionPhrase(
  dim: ScoringDimension,
  score: number,
  feature: Feature,
): string {
  const tier = score >= 85 ? 'High' : score >= 70 ? 'Strong' : 'Moderate';
  switch (dim) {
    case 'businessValue':
      return `${tier} business value for ${feature.businessValue.beneficiary}`;
    case 'visualAppeal':
      return `${tier} visual appeal (${feature.category})`;
    case 'userImportance':
      return `${tier} user importance across ${feature.signals.pageCount} page${feature.signals.pageCount !== 1 ? 's' : ''}`;
    case 'revenueImpact':
      return `${tier} revenue impact — ${feature.businessValue.outcomeType.replace('_', ' ')}`;
  }
}

// ── Guards and helpers ────────────────────────────────────────────────────────

function assertWeightsValid(w: ScoringWeights): void {
  const sum = w.businessValue + w.visualAppeal + w.userImportance + w.revenueImpact;
  if (Math.abs(sum - 1) > 0.001) {
    throw new RangeError(
      `ScoringWeights must sum to 1.0, got ${sum.toFixed(4)}. ` +
      `Use FeaturePrioritizationEngine.withWeights() to normalise automatically.`,
    );
  }
}

function normaliseWeights(w: ScoringWeights): ScoringWeights {
  const sum = w.businessValue + w.visualAppeal + w.userImportance + w.revenueImpact;
  if (sum === 0) throw new RangeError('At least one weight must be non-zero');
  return {
    businessValue:  w.businessValue  / sum,
    visualAppeal:   w.visualAppeal   / sum,
    userImportance: w.userImportance / sum,
    revenueImpact:  w.revenueImpact  / sum,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
