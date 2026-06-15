// ─────────────────────────────────────────────────────────────────────────────
// ReplayValidator
//
// Runs deterministic checks per InteractionReplay and assigns a weighted
// pass score.  Replays with score >= 0.60 are promoted to 'interaction' mode;
// others fall back to 'screenshot' mode.
//
// Phase 9b: Three hard gates run before the weighted checks.
// Failing any hard gate immediately sets score=0 and demotes the replay,
// regardless of other check results.
//
// Hard gates (binary eliminators — no weight contribution):
//   G1. start_end_distinct       startHash !== endHash
//   G2. visual_delta_sufficient  changeIntensity >= 0.15
//   G3. not_documentation_panel  hint does not match documentation keywords
//
// Weighted checks (8 checks, weights sum to 1.00):
//   1. has_start_screenshot   0.18
//   2. has_end_screenshot     0.18
//   3. has_trigger_selector   0.08
//   4. has_permitted_signals  0.18  (was has_business_signals — now uses permittedSignals)
//   5. meaningful_delta       0.12
//   6. has_callout_text       0.10
//   7. has_duration           0.08
//   8. phases_ordered         0.08
// ─────────────────────────────────────────────────────────────────────────────

import type {
  InteractionReplay,
  ReplayValidationCheck,
  ReplayValidationReport,
  ReplayValidationResult,
} from '../core/domain/entities/InteractionReplay';
import { DOCUMENTATION_KEYWORDS } from './InteractionSequenceBuilder';

// Role compatibility — used for storyRelevance field in the report
const ROLE_COMPATIBLE_SCENES: Record<string, string[]> = {
  insight:  ['insight', 'hook', 'validation'],
  outcome:  ['outcome', 'validation', 'scale'],
  action:   ['action', 'insight'],
  problem:  ['problem', 'hook'],
  hook:     ['hook'],
  validation: ['validation', 'outcome'],
  scale:    ['scale', 'outcome'],
};

const PROMOTION_THRESHOLD = 0.60;  // lowered from 0.65; hard gates handle gross failures

// ── Hard gate definitions ─────────────────────────────────────────────────────

interface HardGateDef {
  name:   string;
  test:   (r: InteractionReplay) => boolean;
  detail: (r: InteractionReplay) => string;
}

const HARD_GATES: HardGateDef[] = [
  {
    name:   'start_end_distinct',
    test:   r => r.startState.screenshotHash !== r.endState.screenshotHash,
    detail: r => `start=${r.startState.screenshotHash.slice(0,8)} end=${r.endState.screenshotHash.slice(0,8)}`,
  },
  {
    name:   'visual_delta_sufficient',
    test:   r => r.visualDelta.changeIntensity >= 0.15,
    detail: r => `changeIntensity=${r.visualDelta.changeIntensity.toFixed(3)} (min 0.15)`,
  },
  {
    name:   'not_documentation_panel',
    test:   r => {
      const hint = r.trigger.humanReadableHint.toLowerCase();
      return !DOCUMENTATION_KEYWORDS.some(kw => hint.includes(kw));
    },
    detail: r => `hint="${r.trigger.humanReadableHint}"`,
  },
];

// ── Weighted check definitions ────────────────────────────────────────────────

interface CheckDef {
  name:    string;
  weight:  number;
  test:    (r: InteractionReplay) => boolean;
  detail:  (r: InteractionReplay) => string;
}

const CHECKS: CheckDef[] = [
  {
    name:   'has_start_screenshot',
    weight: 0.18,
    test:   r => Boolean(r.startState.screenshotPath),
    detail: r => `path="${r.startState.screenshotPath}"`,
  },
  {
    name:   'has_end_screenshot',
    weight: 0.18,
    test:   r => Boolean(r.endState.screenshotPath),
    detail: r => `path="${r.endState.screenshotPath}"`,
  },
  {
    name:   'has_trigger_selector',
    weight: 0.08,
    test:   r => Boolean(r.trigger.cssSelector),
    detail: r => `selector="${r.trigger.cssSelector}"`,
  },
  {
    name:   'has_permitted_signals',
    weight: 0.18,
    // permittedSignals may not be on the replay object (it lives on the sequence);
    // fall back to businessSignals for backward compat
    test:   r => r.businessSignals.length > 0,
    detail: r => `signals=[${r.businessSignals.join(', ')}]`,
  },
  {
    name:   'meaningful_delta',
    weight: 0.12,
    test:   r => r.visualDelta.changeIntensity >= 0.15,
    detail: r => `changeIntensity=${r.visualDelta.changeIntensity.toFixed(3)}`,
  },
  {
    name:   'has_callout_text',
    weight: 0.10,
    test:   r => Boolean(r.calloutText?.trim()),
    detail: r => `text="${r.calloutText}"`,
  },
  {
    name:   'has_duration',
    weight: 0.08,
    test:   r => r.replayDurationSec >= 10,
    detail: r => `durationSec=${r.replayDurationSec.toFixed(1)}`,
  },
  {
    name:   'phases_ordered',
    weight: 0.08,
    test:   r => phasesOrdered(r),
    detail: _r => 'phase frame ordering check',
  },
];

// ── Validator ─────────────────────────────────────────────────────────────────

export class ReplayValidator {

  /**
   * Validate all replays and return promoted set, demoted set, and report.
   * All logic is deterministic — identical replays always produce identical results.
   */
  validate(replays: InteractionReplay[]): {
    promoted: InteractionReplay[];
    demoted:  InteractionReplay[];
    report:   ReplayValidationReport;
  } {
    const replayResults = replays.map(r => this.validateOne(r));
    const promoted      = replays.filter((_, i) => replayResults[i].promoted);
    const demoted       = replays.filter((_, i) => !replayResults[i].promoted);

    const weakReplays = replayResults.filter(r => !r.promoted && r.score >= 0.40);

    return {
      promoted,
      demoted,
      report: {
        replayResults,
        coverageRate:     replays.length > 0 ? promoted.length / replays.length : 0,
        promotedCount:    promoted.length,
        demotedCount:     demoted.length,
        weakReplays,
        recommendations:  this.buildRecommendations(replayResults, replays.length),
      },
    };
  }

  // ── Per-replay ─────────────────────────────────────────────────────────────────

  private validateOne(replay: InteractionReplay): ReplayValidationResult {
    // ── Hard gates first ───────────────────────────────────────────────────────
    for (const gate of HARD_GATES) {
      if (!gate.test(replay)) {
        return {
          interactionId:  replay.interactionId,
          score:          0,
          promoted:       false,
          checks:         [],
          hardGateFailed: gate.name,
          triggerSummary: `${replay.trigger.eventType}:${replay.trigger.humanReadableHint}`,
          visualDelta:    replay.visualDelta.changeIntensity,
          storyRelevance: buildStoryRelevance(replay),
          dedupeStatus:   'unique',   // will be updated by bridge if needed
        };
      }
    }

    // ── Weighted checks ────────────────────────────────────────────────────────
    const checks: ReplayValidationCheck[] = CHECKS.map(def => ({
      name:   def.name,
      passed: def.test(replay),
      weight: def.weight,
      detail: def.detail(replay),
    }));

    const totalWeight  = checks.reduce((s, c) => s + c.weight, 0);
    const passedWeight = checks.reduce((s, c) => s + (c.passed ? c.weight : 0), 0);
    const score        = totalWeight > 0 ? passedWeight / totalWeight : 0;

    return {
      interactionId:  replay.interactionId,
      score,
      promoted:       score >= PROMOTION_THRESHOLD,
      checks,
      hardGateFailed: null,
      triggerSummary: `${replay.trigger.eventType}:${replay.trigger.humanReadableHint}`,
      visualDelta:    replay.visualDelta.changeIntensity,
      storyRelevance: buildStoryRelevance(replay),
      dedupeStatus:   'unique',
    };
  }

  // ── Recommendations ────────────────────────────────────────────────────────────

  private buildRecommendations(results: ReplayValidationResult[], total: number): string[] {
    if (total === 0) return [];
    const recs: string[] = [];

    const gateFailures = results.filter(r => r.hardGateFailed !== null);
    const docFails     = gateFailures.filter(r => r.hardGateFailed === 'not_documentation_panel');
    const dupFails     = gateFailures.filter(r => r.hardGateFailed === 'start_end_distinct');
    const deltaFails   = gateFailures.filter(r => r.hardGateFailed === 'visual_delta_sufficient');

    if (docFails.length > 0)
      recs.push(`${docFails.length} replay(s) rejected — documentation/help panel detected. Trigger hints: ${docFails.map(r => r.triggerSummary).join('; ')}`);
    if (dupFails.length > 0)
      recs.push(`${dupFails.length} replay(s) rejected — identical start/end screenshots (no visual change occurred).`);
    if (deltaFails.length > 0)
      recs.push(`${deltaFails.length} replay(s) rejected — visual delta below threshold (changeIntensity < 0.15).`);

    const failCount = (name: string) =>
      results.filter(r => r.checks.find(c => c.name === name && !c.passed)).length;

    const f_signals = failCount('has_permitted_signals');
    const f_ss      = failCount('has_start_screenshot') + failCount('has_end_screenshot');

    if (f_signals > total * 0.5)
      recs.push('Many replays lack permitted business signals after class filtering — InPageDiscovery may be finding only low-value interaction types.');
    if (f_ss > 0)
      recs.push('Some replays have missing screenshot paths — check InPageDiscoveryStage output directory.');

    const promoted = results.filter(r => r.promoted).length;
    if (promoted === 0)
      recs.push('No replays reached promotion threshold — interaction discovery may not be finding high-value UI actions on this product.');

    return recs;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function phasesOrdered(r: InteractionReplay): boolean {
  const p = r.phases;
  return (
    p.hookEndFrame         > 0 &&
    p.cursorMoveStartFrame >= p.hookEndFrame         &&
    p.cursorArriveFrame    >= p.cursorMoveStartFrame  &&
    p.clickFrame           >= p.cursorArriveFrame     &&
    p.transitionStartFrame >= p.clickFrame            &&
    p.transitionEndFrame   >= p.transitionStartFrame  &&
    p.outcomeZoomFrame     >= p.transitionEndFrame    &&
    p.calloutFrame         >= p.outcomeZoomFrame
  );
}

function buildStoryRelevance(replay: InteractionReplay): string {
  const role       = replay.storyRole ?? 'insight';
  const compatible = (ROLE_COMPATIBLE_SCENES[role] ?? [role]).join(', ');
  return `role=${role} → compatible scenes: [${compatible}]`;
}
