/**
 * VisualAttentionAnalyzer — builds an AttentionMap for one scene.
 *
 * Step 1: Extract primary target from scene.spotlightTarget.
 * Step 2: Look for a secondary target from intel.features (different element type,
 *         non-overlapping region, sufficiently high importance).
 * Step 3: Compute featureImportance for each target via FeatureImportanceResolver.
 * Step 4: Compute visualWeight from region area + position bonus.
 * Step 5: Score everything with MotionScorer.
 *
 * The optional `context?` parameter provides richer pipeline signals.
 * When absent, all signals fall back gracefully to Phase 6 equivalents.
 *
 * No LLM, no I/O. Pure geometry + scoring.
 */

import type { RemotionScene }     from '../../core/domain/entities/RemotionPackage';
import type { PageIntelligence }  from '../../core/domain/entities/PageIntelligence';
import type {
  AttentionContext,
  AttentionMap,
  AttentionTarget,
  NormalizedRegion,
} from './types';
import type { ElementType }       from '../camera/types';
import { CANONICAL_REGIONS }      from '../camera/CameraProfiles';
import { FeatureImportanceResolver } from './FeatureImportanceResolver';
import { MotionScorer }           from './MotionScorer';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Minimum scene duration (frames) required to consider adding a secondary target. */
const MIN_FRAMES_FOR_SECONDARY = 210;   // 7 s at 30 fps

/** Minimum feature importance score for a secondary candidate. */
const SECONDARY_IMPORTANCE_THRESHOLD = 0.50;

/** Maximum overlap fraction between primary and secondary regions. */
const MAX_REGION_OVERLAP = 0.40;

// ─────────────────────────────────────────────────────────────────────────────
// VisualAttentionAnalyzer
// ─────────────────────────────────────────────────────────────────────────────

export class VisualAttentionAnalyzer {
  private readonly resolver = new FeatureImportanceResolver();
  private readonly scorer   = new MotionScorer();

  /**
   * Build a scored AttentionMap for the given scene.
   *
   * @param scene    RemotionScene — provides spotlightTarget, narration, salesHook
   * @param intel    PageIntelligence — provides features[], overallImportanceScore
   * @param context  Optional pipeline context for richer featureImportance signals
   */
  analyze(
    scene:    RemotionScene,
    intel:    PageIntelligence,
    context?: AttentionContext,
  ): AttentionMap {
    const targets: AttentionTarget[] = [];

    // ── Primary target (always present) ──────────────────────────────────────
    const primaryTarget = this.buildPrimaryTarget(scene, intel, context);
    targets.push(primaryTarget);

    // ── Secondary target (optional — only for long enough scenes) ─────────
    if (scene.durationInFrames >= MIN_FRAMES_FOR_SECONDARY) {
      const secondary = this.findSecondaryTarget(scene, intel, context, primaryTarget);
      if (secondary) {
        targets.push(secondary);
      }
    }

    // ── Score and rank ────────────────────────────────────────────────────
    this.scorer.score(targets);

    return { sceneId: scene.id, targets };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private buildPrimaryTarget(
    scene:   RemotionScene,
    intel:   PageIntelligence,
    context: AttentionContext | undefined,
  ): AttentionTarget {
    const st         = scene.spotlightTarget;
    const elementType = (st?.elementType as ElementType) ?? 'default';
    const priority    = st?.priority ?? (intel.overallImportanceScore / 100);

    // Region: use provided bounding box or canonical region
    const region: NormalizedRegion = st?.boundingBox
      ? { x: st.boundingBox.x, y: st.boundingBox.y, width: st.boundingBox.width, height: st.boundingBox.height }
      : canonicalRegion(elementType);

    // Label: from highlightTarget.description or scene title
    const label = deriveLabel(scene.highlightTarget?.description, scene.title);

    // featureImportance via resolver
    const importanceResult = this.resolver.resolve({
      featureLabel:     label,
      fallbackPriority: priority,
      elementType,
      rankedFeatures:   context?.rankedFeatures,
      businessOutputs:  context?.businessOutputs,
      narration:        { salesHook: scene.salesHook ?? '', narration: scene.narration ?? '' },
    });

    const visualWeight = computeVisualWeight(region);

    return {
      id:                  'primary',
      elementType,
      region,
      businessValue:       priority,
      visualWeight,
      narrativeRole:       1.0,
      featureImportance:   importanceResult.featureImportance,
      featureRank:         importanceResult.featureRank,
      featureTotalRanked:  importanceResult.featureTotalRanked,
      businessValueTier:   importanceResult.businessValueTier,
      contextConfidence:   importanceResult.contextConfidence,
      narrativeEmphasis:   importanceResult.narrativeEmphasis,
      narrativePosition:   importanceResult.narrativePosition,
      motionScore:         0,    // populated by MotionScorer.score()
      storyRole:           'hero', // will be overwritten by MotionScorer
      label,
      benefit:             undefined,
      metric:              undefined,
    };
  }

  private findSecondaryTarget(
    scene:         RemotionScene,
    intel:         PageIntelligence,
    context:       AttentionContext | undefined,
    primaryTarget: AttentionTarget,
  ): AttentionTarget | undefined {
    if (!intel.features || intel.features.length < 2) return undefined;

    // Find a second visual feature with a different elementType and sufficient score
    const candidates = intel.features
      .filter(f => f.importanceScore >= SECONDARY_IMPORTANCE_THRESHOLD * 100)
      .slice(1);  // skip the first (already used for primary)

    for (const candidate of candidates) {
      const et = inferElementType(candidate.featureName);
      if (et === primaryTarget.elementType) continue;

      const candidateRegion = canonicalRegion(et);
      if (regionsOverlap(primaryTarget.region, candidateRegion) > MAX_REGION_OVERLAP) continue;

      const fallback = clamp(candidate.importanceScore / 100, 0, 1);
      const label    = deriveLabel(candidate.featureName, candidate.featureName);

      const importanceResult = this.resolver.resolve({
        featureLabel:     label,
        fallbackPriority: fallback,
        elementType:      et,
        rankedFeatures:   context?.rankedFeatures,
        businessOutputs:  context?.businessOutputs,
        narration:        { salesHook: scene.salesHook ?? '', narration: scene.narration ?? '' },
      });

      if (importanceResult.featureImportance < SECONDARY_IMPORTANCE_THRESHOLD) continue;

      return {
        id:                  'secondary-0',
        elementType:          et,
        region:               candidateRegion,
        businessValue:        fallback,
        visualWeight:         computeVisualWeight(candidateRegion),
        narrativeRole:        0.55,
        featureImportance:    importanceResult.featureImportance,
        featureRank:          importanceResult.featureRank,
        featureTotalRanked:   importanceResult.featureTotalRanked,
        businessValueTier:    importanceResult.businessValueTier,
        contextConfidence:    importanceResult.contextConfidence,
        narrativeEmphasis:    importanceResult.narrativeEmphasis,
        narrativePosition:    importanceResult.narrativePosition,
        motionScore:          0,
        storyRole:            'supporting',
        label,
        benefit:              undefined,
        metric:               undefined,
      };
    }

    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function canonicalRegion(et: ElementType): NormalizedRegion {
  const cr = CANONICAL_REGIONS[et] ?? CANONICAL_REGIONS.default;
  // Canonical regions are focal points — create a synthetic bbox around them
  return { x: cr.focusX - 0.15, y: cr.focusY - 0.10, width: 0.30, height: 0.20 };
}

function computeVisualWeight(region: NormalizedRegion): number {
  const area = region.width * region.height;
  const inTopHalf  = (region.y + region.height / 2) < 0.50 ? 0.10 : 0;
  const inHCentre  = Math.abs(region.x + region.width / 2 - 0.50) < 0.25 ? 0.10 : 0;
  return clamp(Math.min(area * 4.0, 0.80) + inTopHalf + inHCentre, 0, 1);
}

function regionsOverlap(a: NormalizedRegion, b: NormalizedRegion): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = ix * iy;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

/** Strip trailing UI-classifier words from a feature description to get a label. */
function deriveLabel(description: string | undefined, fallback: string): string {
  if (!description) return (fallback ?? 'Feature').split(/\s+/).slice(0, 4).join(' ');
  const stopWords = new Set([
    'kpi', 'metric', 'metrics', 'data', 'analytics', 'chart', 'table',
    'card', 'button', 'form', 'feed', 'widget', 'detail', 'modal', 'action',
  ]);
  const words = description.split(/\s+/);
  const stop  = words.findIndex(w => stopWords.has(w.toLowerCase()));
  const kept  = stop > 1 ? words.slice(0, stop) : words.slice(0, 4);
  return (kept.join(' ') || fallback).split(/\s+/).slice(0, 4).join(' ');
}

/** Infer ElementType from a feature name string using simple keyword matching. */
function inferElementType(name: string): ElementType {
  const lower = name.toLowerCase();
  if (/\balert|alarm|notif|warning/i.test(lower))    return 'alert';
  if (/\bkpi|metric|stat|score|count\b/i.test(lower)) return 'kpi_card';
  if (/\bchart|graph|trend|analytic/i.test(lower))   return 'chart';
  if (/\btable|list|grid|feed\b/i.test(lower))       return 'table';
  if (/\bform|input|create|add\b/i.test(lower))      return 'form';
  if (/\bbutton|action|cta\b/i.test(lower))          return 'button';
  if (/\bmap|geo|floor/i.test(lower))                return 'map';
  if (/\bmodal|dialog|overlay/i.test(lower))         return 'modal';
  if (/\bnav|menu|sidebar/i.test(lower))             return 'navigation';
  return 'default';
}
