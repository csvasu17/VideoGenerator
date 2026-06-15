import { randomUUID } from 'crypto';
import type { PipelineStage } from '../PipelineStage';
import type { PipelineContext } from '../PipelineContext';
import type { PageIntelligence } from '../../../core/domain/entities/PageIntelligence';
import type { Feature, FeatureCategory, OutcomeType } from '../../../core/domain/entities/Feature';
import type { PrioritizedFeature } from '../../../core/domain/entities/PrioritizedFeature';
import { createFeaturePrioritizationEngine } from '../../../agents/feature-classification';
import type { ContextEnvelope } from '../../../core/domain/entities/context/ContextEnvelope';
import { tokenize, overlapScore } from '../../../agents/context/ContextSignalValidator';

// ─────────────────────────────────────────────────────────────────────────────
// Mappings
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_CATEGORY_TO_FEATURE_CATEGORY: Record<string, FeatureCategory> = {
  dashboard: 'analytics',
  analytics: 'analytics',
  form:      'workflow',
  list:      'core',
  detail:    'core',
  workflow:  'workflow',
  settings:  'admin',
  entry:     'generic',
  generic:   'generic',
};

function inferOutcomeType(text: string): OutcomeType {
  const t = text.toLowerCase();
  if (/revenue|sales|growth|conversion|upsell/.test(t))        return 'revenue';
  if (/cost|sav|reduc|eliminat|cheaper|budget/.test(t))        return 'cost_saving';
  if (/risk|complian|security|audit|governance/.test(t))       return 'risk';
  return 'efficiency';
}

function inferPainSolved(businessValue: string): string {
  if (businessValue.length > 80) return businessValue.slice(0, 80) + '…';
  return businessValue || 'manual overhead';
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature extractor — converts PageIntelligence records → Feature[]
// ─────────────────────────────────────────────────────────────────────────────

function extractFeatures(records: PageIntelligence[]): Feature[] {
  // Build deduplication map: normalised name → merged Feature
  const deduped = new Map<string, Feature>();

  for (const page of records) {
    const featureCategory: FeatureCategory =
      PAGE_CATEGORY_TO_FEATURE_CATEGORY[page.pageCategory] ?? 'generic';

    const hasVisualizations =
      page.kpiWidgets.length > 0 ||
      page.features.some(f => /chart|graph|visual|trend/i.test(f.featureName));

    const hasNotifications =
      page.features.some(f => /notif|alert|badge|reminder/i.test(f.featureName));

    for (const vf of page.features) {
      const key = normalizeKey(vf.featureName);
      const existing = deduped.get(key);

      if (existing) {
        // Merge: add page to pageIds, keep highest importance
        if (!existing.pageIds.includes(page.pageId)) {
          existing.pageIds.push(page.pageId);
        }
        existing.signals.pageCount = existing.pageIds.length;
        existing.signals.hasVisualizations =
          existing.signals.hasVisualizations || hasVisualizations;
        existing.signals.hasNotifications =
          existing.signals.hasNotifications || hasNotifications;
        // Update isOnCriticalPath if improved
        if (vf.importanceScore >= 75) {
          existing.signals.isOnCriticalPath = true;
        }
      } else {
        const feature: Feature = {
          id:      randomUUID(),
          name:    vf.featureName,
          summary: vf.businessValue,
          detailedDescription: vf.recommendations.join(' '),
          category: featureCategory,
          businessValue: {
            headline:       vf.businessValue,
            painSolved:     inferPainSolved(vf.businessValue),
            beneficiary:    'team',
            outcomeType:    inferOutcomeType(vf.businessValue),
            quantifiedImpact: vf.recommendations[0],
          },
          signals: {
            pageCount:                1,
            interactiveElementCount:  page.importantActions.length,
            hasVisualizations,
            hasNotifications,
            isOnCriticalPath:         vf.importanceScore >= 75,
          },
          relatedFeatureIds: [],
          pageIds:           [page.pageId],
        };
        deduped.set(key, feature);
      }
    }
  }

  return Array.from(deduped.values());
}

function normalizeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-');
}

// ─────────────────────────────────────────────────────────────────────────────
// FeatureRankingStage
// ─────────────────────────────────────────────────────────────────────────────

export class FeatureRankingStage
  implements PipelineStage<PageIntelligence[], PrioritizedFeature[]>
{
  readonly name = 'Feature Ranking';

  async run(intelligence: PageIntelligence[], ctx: PipelineContext): Promise<PrioritizedFeature[]> {
    const features = extractFeatures(intelligence);

    if (features.length === 0) return [];

    const engine = createFeaturePrioritizationEngine();
    const ranked  = engine.prioritize(features);

    // ── Apply context boost (additive-only; max +15% of composite score) ────
    // Only active when context was provided and expanded successfully.
    // Produces 0 boost when contextEnvelope.isPresent() === false so behaviour
    // is identical to before for runs without a contextText.
    if (ctx.contextEnvelope.isPresent()) {
      return applyContextBoost(ranked, ctx.contextEnvelope);
    }

    return ranked;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Context boost
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Re-score ranked features by adding a context-alignment bonus.
 *
 * Formula per feature:
 *   adjustedComposite = min(100, composite + composite × effectiveWeight × relevance)
 *
 * Where:
 *   effectiveWeight = contextEnvelope.getEffectiveWeight()  (0–0.15)
 *   relevance       = text overlap between feature text and context signals (0–1)
 *
 * Properties:
 *   • Additive-only: composite=0 → boost=0
 *   • Bounded: effective boost never exceeds 15% of composite
 *   • Context-agnostic features (relevance≈0) are unchanged
 */
function applyContextBoost(
  features: PrioritizedFeature[],
  envelope: ContextEnvelope,
): PrioritizedFeature[] {
  const effectiveWeight = envelope.getEffectiveWeight();
  if (effectiveWeight === 0) return features;

  const ctx = envelope.active;
  if (!ctx) return features;

  // Build context signal token corpus once (businessGoals + demoPriorities
  // are the most actionable signals for demo-feature alignment).
  const contextSignals = [
    ctx.domain.value,
    ctx.targetAudience.value,
    ...ctx.businessGoals.map(g => g.value),
    ...ctx.demoPriorities.map(p => p.value),
  ].join(' ');
  const contextTokens = tokenize(contextSignals);

  // Score each feature.
  const boosted = features.map(pf => {
    const featureText = [
      pf.feature.name,
      pf.feature.summary,
      pf.feature.businessValue.headline,
      pf.feature.businessValue.painSolved,
    ].filter(Boolean).join(' ');

    const relevance       = overlapScore(tokenize(featureText), contextTokens);
    const boost           = pf.composite * effectiveWeight * relevance;
    const adjustedScore   = Math.min(100, Math.round((pf.composite + boost) * 100) / 100);

    return { ...pf, composite: adjustedScore };
  });

  // Re-sort and re-rank by adjusted composite (stable original-order tiebreak).
  boosted.sort((a, b) => b.composite - a.composite);
  return boosted.map((pf, i) => ({ ...pf, rank: i + 1 }));
}
