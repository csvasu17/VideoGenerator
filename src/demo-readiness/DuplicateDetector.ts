// ─────────────────────────────────────────────────────────────────────────────
// DuplicateDetector
//
// Cross-page second pass: identifies pages whose content is near-identical to
// a higher-scoring page already in the scored set and applies a duplicate
// penalty to the lower-scoring copy.
//
// Similarity metric (weighted average of three dimensions):
//   url_sim     (0.35) — normalised URL path segment overlap
//   element_sim (0.35) — Jaccard on KPI widget label + page-category sets
//   feature_sim (0.30) — Jaccard on normalised feature-name sets
//
// Penalty application:
//   similarity > 0.85 → readinessScore *= (1 − similarity × 0.70)
//   0.70 < similarity ≤ 0.85 → readinessScore *= (1 − similarity × 0.45)
//   similarity ≤ 0.70 → no penalty (pages are considered distinct)
//
// The seen-set is built in descending readinessScore order so the
// highest-quality page in each group never receives a penalty — only
// lower-scoring near-duplicates are penalised.
//
// Stateful per invocation (the `applyDuplicatePenalties` call maintains its
// own seen-set and does not persist between calls).
// ─────────────────────────────────────────────────────────────────────────────

import type { ReadinessResult, ReadinessSignal, ScoringContext } from '../core/domain/entities/ReadinessResult';

// ─────────────────────────────────────────────────────────────────────────────
// URL normalisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract normalised path segments from a URL.
 * Strips UUIDs, pure numeric segments, and query strings.
 */
function normaliseSegments(url: string): string[] {
  try {
    const { pathname } = new URL(url);
    return pathname
      .split('/')
      .filter(Boolean)
      .map(s => s.toLowerCase())
      .map(s => s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id'))
      .map(s => (/^\d+$/.test(s) ? ':num' : s));
  } catch {
    return [];
  }
}

function urlSimilarity(urlA: string, urlB: string): number {
  const segA = normaliseSegments(urlA);
  const segB = normaliseSegments(urlB);
  if (segA.length === 0 && segB.length === 0) return 1.0;
  if (segA.length === 0 || segB.length === 0) return 0.0;
  const setA = new Set(segA);
  const setB = new Set(segB);
  const intersection = [...setA].filter(s => setB.has(s)).length;
  const union = new Set([...segA, ...segB]).size;
  return union === 0 ? 1.0 : intersection / union;
}

// ─────────────────────────────────────────────────────────────────────────────
// Element / feature composition similarity
// ─────────────────────────────────────────────────────────────────────────────

function makeElementSet(ctx: ScoringContext): Set<string> {
  const s = new Set<string>();
  s.add(ctx.pageCategory);
  s.add(ctx.nodeType);
  for (const w of ctx.kpiWidgets) {
    s.add(w.label.toLowerCase().replace(/[^a-z0-9]/g, ''));
  }
  return s;
}

function makeFeatureSet(ctx: ScoringContext): Set<string> {
  return new Set(
    ctx.features.map(f => f.featureName.toLowerCase().replace(/[^a-z0-9]/g, '')),
  );
}

function jaccardSets(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1.0;
  if (a.size === 0 || b.size === 0) return 0.0;
  const intersection = [...a].filter(x => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 1.0 : intersection / union;
}

// ─────────────────────────────────────────────────────────────────────────────
// Combined similarity
// ─────────────────────────────────────────────────────────────────────────────

function computeSimilarity(ctxA: ScoringContext, ctxB: ScoringContext): number {
  const urlSim     = urlSimilarity(ctxA.url, ctxB.url);
  const elementSim = jaccardSets(makeElementSet(ctxA), makeElementSet(ctxB));
  const featureSim = jaccardSets(makeFeatureSet(ctxA), makeFeatureSet(ctxB));
  return 0.35 * urlSim + 0.35 * elementSim + 0.30 * featureSim;
}

// ─────────────────────────────────────────────────────────────────────────────
// DuplicateDetector
// ─────────────────────────────────────────────────────────────────────────────

export const DuplicateDetector = {
  /**
   * Apply duplicate penalties to the result set.
   *
   * Modifies `results` in-place: appends duplicate_screen signals and
   * adjusts `readinessScore` for near-duplicate pages.
   *
   * @param results   Scored ReadinessResult[] (will be mutated).
   * @param contexts  Corresponding ScoringContext[] indexed by position.
   * @returns The same array with penalties applied.
   */
  applyDuplicatePenalties(
    results:  ReadinessResult[],
    contexts: ScoringContext[],
  ): ReadinessResult[] {
    if (results.length < 2) return results;

    // Build an index by pageId so context lookup is O(1).
    const ctxByPageId = new Map<string, ScoringContext>(
      contexts.map(c => [c.pageId, c]),
    );

    // ── Sort by descending readinessScore: best page in each duplicate group
    // anchors the seen-set; lower-scoring copies receive the penalty.
    const order = [...results]
      .sort((a, b) => b.readinessScore - a.readinessScore)
      .map(r => r.pageId);

    // seen-set: already-anchored page contexts
    const seen: Array<{ ctx: ScoringContext; result: ReadinessResult }> = [];

    for (const pageId of order) {
      const result = results.find(r => r.pageId === pageId)!;
      const ctx    = ctxByPageId.get(pageId);
      if (!ctx) { seen.push({ ctx: { pageId } as ScoringContext, result }); continue; }

      let penaltyApplied = false;
      let strongestSimilarity = 0;
      let anchorEvidence = '';

      for (const { ctx: seenCtx, result: seenResult } of seen) {
        const similarity = computeSimilarity(ctx, seenCtx);
        if (similarity > strongestSimilarity) {
          strongestSimilarity = similarity;
          anchorEvidence      = seenResult.title || seenResult.url;
        }

        if (similarity > 0.85) {
          // Strong duplicate — significant penalty
          const multiplier = 1 - similarity * 0.70;
          result.readinessScore = Math.max(0, result.readinessScore * multiplier);
          penaltyApplied = true;
          break; // One strong duplicate match is sufficient
        } else if (similarity > 0.70) {
          // Soft duplicate — lighter penalty
          const multiplier = 1 - similarity * 0.45;
          result.readinessScore = Math.max(0, result.readinessScore * multiplier);
          penaltyApplied = true;
          // Continue checking for stronger matches
        }
      }

      if (penaltyApplied) {
        const signal: ReadinessSignal = {
          type:       'duplicate_screen',
          weight:     -(strongestSimilarity * 0.55),
          confidence: strongestSimilarity,
          evidence:   `${Math.round(strongestSimilarity * 100)}% similar to already-selected page "${anchorEvidence}"`,
          source:     'cross_page',
        };
        result.signals.push(signal);

        // Re-derive verdict and category after penalty
        result.verdict  = deriveVerdict(result.readinessScore);
        result.category = deriveCategory(result.readinessScore);
        if (result.verdict === 'reject' && !result.rejectionReason) {
          result.rejectionReason = signal.evidence;
        }
      }

      seen.push({ ctx, result });
    }

    return results;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared verdict / category derivations (exported for ReadinessScorer)
// ─────────────────────────────────────────────────────────────────────────────

export function deriveVerdict(
  score: number,
  threshold = 0.40,
): ReadinessResult['verdict'] {
  if (score >= threshold) return 'pass';
  if (score >= 0.25)      return 'borderline';
  return 'reject';
}

export function deriveCategory(score: number): ReadinessResult['category'] {
  if (score >= 0.65) return 'high_value';
  if (score >= 0.40) return 'acceptable';
  if (score >= 0.25) return 'borderline';
  return 'rejected';
}
