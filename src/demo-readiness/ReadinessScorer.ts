// ─────────────────────────────────────────────────────────────────────────────
// ReadinessScorer
//
// Orchestrates all detector modules → produces ReadinessResult[] for a
// set of ScoringContexts.
//
// Pipeline:
//   1. Run all per-page detectors (Auth, Empty, Settings, Placeholder, Value)
//   2. Apply hard-reject rules — immediately assign score=0 when triggered
//   3. Compute readinessScore = clamp(BASE_SCORE + Σ(weight×confidence), 0, 1)
//   4. Derive confidence, verdict, category, demoValueTier
//   5. Run DuplicateDetector second pass (cross-page)
//   6. Return final ReadinessResult[]
//
// No I/O, no LLM, no state (DuplicateDetector constructs its seen-set fresh
// per call).
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ReadinessResult,
  ReadinessSignal,
  ScoringContext,
  DemoValueTier,
} from '../core/domain/entities/ReadinessResult';
import { AuthScreenDetector }     from './signals/AuthScreenDetector';
import { EmptyStateDetector }     from './signals/EmptyStateDetector';
import { SettingsDetector }       from './signals/SettingsDetector';
import { PlaceholderDetector }    from './signals/PlaceholderDetector';
import { ValueScreenClassifier }  from './signals/ValueScreenClassifier';
import { DuplicateDetector, deriveVerdict, deriveCategory } from './DuplicateDetector';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Starting point — pages must earn readiness through positive evidence. */
const BASE_SCORE = 0.35;

// ─────────────────────────────────────────────────────────────────────────────
// Hard-reject rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check whether any combination of signals warrants an immediate hard reject
 * (score = 0.0, bypassing the scoring formula).
 *
 * Returns the rejection reason string or null.
 */
function checkHardReject(signals: ReadinessSignal[]): string | null {
  const authSignals = signals.filter(s => s.type === 'auth_screen');

  // HR-1: Single high-confidence URL pattern match
  const authUrl = authSignals.find(s => s.source === 'url' && s.confidence >= 0.90);
  if (authUrl) return authUrl.evidence;

  // HR-2: Two or more corroborating auth signals at high combined confidence
  if (authSignals.length >= 2 && authSignals.some(s => s.confidence >= 0.80)) {
    return authSignals
      .slice(0, 2)
      .map(s => s.evidence)
      .join('; ');
  }

  // HR-3: Error screen
  const errorSig = signals.find(s => s.type === 'error_screen' && s.confidence >= 0.85);
  if (errorSig) return errorSig.evidence;

  // HR-4: Structurally empty page (zero features AND zero KPI widgets, both
  // signals present at the thresholds EmptyStateDetector uses)
  const zeroFeatures = signals.find(
    s => s.type === 'empty_state' && s.source === 'element_type' &&
         s.evidence.includes('zero features') && s.confidence >= 0.75,
  );
  const zeroKpi = signals.find(
    s => s.type === 'empty_state' && s.source === 'element_type' &&
         s.evidence.includes('zero KPI') && s.confidence >= 0.70,
  );
  if (zeroFeatures && zeroKpi) return zeroFeatures.evidence;

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Confidence derivation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Weight-averaged confidence of all signals, where each signal's contribution
 * is proportional to the absolute magnitude of its influence.
 *
 *   confidence = Σ(|weight| × confidence²) / Σ(|weight| × confidence)
 *
 * Falls back to 0.30 (low certainty) when no signals are present.
 */
function computeConfidence(signals: ReadinessSignal[]): number {
  const totalAbsInfluence = signals.reduce(
    (sum, s) => sum + Math.abs(s.weight) * s.confidence,
    0,
  );
  if (totalAbsInfluence === 0) return 0.30;

  const weightedConf = signals.reduce(
    (sum, s) => sum + Math.abs(s.weight) * s.confidence * s.confidence,
    0,
  );
  return Math.max(0.10, Math.min(1.0, weightedConf / totalAbsInfluence));
}

// ─────────────────────────────────────────────────────────────────────────────
// Demo Value Tier derivation
// ─────────────────────────────────────────────────────────────────────────────

function deriveDemoValueTier(signals: ReadinessSignal[]): DemoValueTier {
  const tierSig = signals.find(s => s.type === 'demo_value_tier');
  const settingsSig = signals.some(s => s.type === 'settings_screen');

  if (tierSig) {
    if (tierSig.weight >= 0.28) return 'tier1';  // +0.30
    if (tierSig.weight >= 0.18) return 'tier2';  // +0.20
    if (tierSig.weight >= 0.03) return 'tier3';  // +0.05
  }
  if (settingsSig) return 'tier4';
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// Score for a single page
// ─────────────────────────────────────────────────────────────────────────────

function scoreOne(ctx: ScoringContext, threshold: number): ReadinessResult {
  // ── 1. Run all detectors ──────────────────────────────────────────────────
  const signals: ReadinessSignal[] = [
    ...AuthScreenDetector.detect(ctx),
    ...EmptyStateDetector.detect(ctx),
    ...SettingsDetector.detect(ctx),
    ...PlaceholderDetector.detect(ctx),
    ...ValueScreenClassifier.classify(ctx),
  ];

  // Sort strongest influence first for readability in reports.
  signals.sort((a, b) =>
    Math.abs(b.weight * b.confidence) - Math.abs(a.weight * a.confidence),
  );

  // ── 2. Hard-reject check ──────────────────────────────────────────────────
  const hardRejectReason = checkHardReject(signals);
  if (hardRejectReason) {
    return {
      pageId:          ctx.pageId,
      url:             ctx.url,
      title:           ctx.title,
      readinessScore:  0.0,
      confidence:      computeConfidence(signals),
      verdict:         'reject',
      category:        'rejected',
      demoValueTier:   deriveDemoValueTier(signals),
      rejectionReason: hardRejectReason,
      signals,
    };
  }

  // ── 3. Compute readiness score ────────────────────────────────────────────
  const net  = signals.reduce((sum, s) => sum + s.weight * s.confidence, 0);
  const raw  = BASE_SCORE + net;
  const score = Math.max(0, Math.min(1, raw));

  // ── 4. Derive outputs ─────────────────────────────────────────────────────
  const verdict  = deriveVerdict(score, threshold);
  const category = deriveCategory(score);
  const conf     = computeConfidence(signals);
  const tier     = deriveDemoValueTier(signals);

  const rejectionReason =
    verdict === 'reject'
      ? (signals.find(s => s.weight < 0)?.evidence ?? 'Score below rejection threshold')
      : null;

  return {
    pageId:          ctx.pageId,
    url:             ctx.url,
    title:           ctx.title,
    readinessScore:  Math.round(score * 1000) / 1000,
    confidence:      Math.round(conf  * 1000) / 1000,
    verdict,
    category,
    demoValueTier:   tier,
    rejectionReason,
    signals,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ReadinessScorer
// ─────────────────────────────────────────────────────────────────────────────

export const ReadinessScorer = {
  /**
   * Score all pages and apply cross-page duplicate detection.
   *
   * @param contexts   One ScoringContext per page (built by ScoringContextBuilder).
   * @param threshold  Minimum score for 'pass' verdict.  Default 0.40.
   * @returns ReadinessResult[] in the same order as `contexts`.
   */
  score(contexts: ScoringContext[], threshold = 0.40): ReadinessResult[] {
    if (contexts.length === 0) return [];

    // Per-page scoring (independent)
    const results = contexts.map(ctx => scoreOne(ctx, threshold));

    // Cross-page duplicate detection (second pass, mutates results in-place)
    DuplicateDetector.applyDuplicatePenalties(results, contexts);

    return results;
  },
};
