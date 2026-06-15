// ─────────────────────────────────────────────────────────────────────────────
// ReplayBuilder
//
// Converts scored InteractionSequence objects into InteractionReplay objects.
//
// Responsibilities:
//   - Stable interactionId (SHA256 of sequenceId)
//   - replayPriority from businessScore + structuralDeltaScore + arc position
//   - replayDurationSec via lerp(12s, 30s, replayPriority)
//   - ReplayPhases — 8 frame milestones at 30 fps
//   - ReplayCameraDirective[] — 4 directives: hook, action, transition, outcome
//   - calloutText derived from visualDelta content
//   - businessPurpose from trigger
//
// Pure computation — deterministic, no I/O, no LLM.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'crypto';
import type {
  InteractionReplay,
  InteractionSequence,
  NormalisedBox,
  ReplayCameraDirective,
  ReplayPhases,
} from '../core/domain/entities/InteractionReplay';

const FPS = 30;

// ── Math helpers ───────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function secToFrames(sec: number): number {
  return Math.round(sec * FPS);
}

function framePct(total: number, pct: number): number {
  return Math.round(total * pct);
}

// ── Builder ────────────────────────────────────────────────────────────────────

export class ReplayBuilder {

  /**
   * Build InteractionReplay objects from scored sequences.
   *
   * @param sequences    Scored sequences (businessScore must be set ≥ 0).
   * @param arcPositions Map<sequenceId, 0–1 narrative arc position>.
   *                     Missing entries default to 0.5 (mid-arc).
   */
  build(
    sequences:    InteractionSequence[],
    arcPositions?: Map<string, number>,
  ): InteractionReplay[] {
    return sequences.map(seq =>
      this.buildOne(seq, arcPositions?.get(seq.sequenceId) ?? 0.5),
    );
  }

  // ── Per-sequence ─────────────────────────────────────────────────────────────

  private buildOne(seq: InteractionSequence, arcPositionNorm: number): InteractionReplay {
    const interactionId = createHash('sha256')
      .update(`replay:${seq.sequenceId}`)
      .digest('hex')
      .slice(0, 16);

    // Arc bonus peaks at the 50% arc position; falls off toward 0% and 100%
    const arcBonus      = 1 - Math.abs(arcPositionNorm - 0.50) * 2;
    const replayPriority = clamp(
      0.50 * seq.businessScore
      + 0.30 * seq.structuralDeltaScore
      + 0.20 * arcBonus,
      0, 1,
    );

    const replayDurationSec = lerp(12, 30, replayPriority);
    const totalFrames       = secToFrames(replayDurationSec);

    const phases           = this.buildPhases(totalFrames);
    const cameraDirectives = this.buildCameraDirectives(
      phases,
      seq.visualDelta.primaryChangeRegion,
      replayPriority,
    );

    const calloutText    = this.buildCalloutText(seq);
    const businessPurpose = seq.trigger.triggerPurpose;

    return {
      interactionId,
      sequenceId:      seq.sequenceId,
      pageId:          seq.pageId,
      startState:      seq.startState,
      endState:        seq.endState,
      trigger:         seq.trigger,
      businessPurpose,
      businessSignals: seq.businessSignals,
      storyRole:       seq.storyRoleAffinity,
      visualDelta:     seq.visualDelta,
      replayDurationSec,
      phases,
      cameraDirectives,
      calloutText,
      calloutBBox:     seq.visualDelta.primaryChangeRegion,
      transitionKey:   seq.transitionKey,
      replayPriority,
    };
  }

  // ── Phase timeline ───────────────────────────────────────────────────────────

  /**
   * 8-phase timeline across totalFrames:
   *
   *   0–15%   hook          base-state Ken-Burns overview
   *   15%     cursor_appear cursor fades in
   *   15–38%  cursor_move   cursor moves toward trigger element
   *   38–40%  hover_pause   brief hover dwell at element centre
   *   40%     click_ripple  click ripple fires
   *   42–60%  crossfade     screenshot crossfade base → after-state
   *   65%     outcome_zoom  camera springs to primaryChangeRegion
   *   72–100% callout_hold  callout appears and holds
   */
  private buildPhases(totalFrames: number): ReplayPhases {
    const f = (pct: number) => framePct(totalFrames, pct);
    return {
      hookEndFrame:         f(0.15),
      cursorMoveStartFrame: f(0.15),
      cursorArriveFrame:    f(0.38),
      clickFrame:           f(0.40),
      transitionStartFrame: f(0.42),
      transitionEndFrame:   f(0.60),
      outcomeZoomFrame:     f(0.65),
      calloutFrame:         f(0.72),
    };
  }

  // ── Camera directives ─────────────────────────────────────────────────────────

  private buildCameraDirectives(
    phases:         ReplayPhases,
    changeRegion:   NormalisedBox | null,
    replayPriority: number,
  ): ReplayCameraDirective[] {
    // Outcome zoom: calmer range prevents jarring zoom-in when focusTarget is
    // null (centred zoom only).  1.15→1.40 keeps the reveal dynamic but never
    // clips the content window at moderate priorities.
    const endZoom = lerp(1.15, 1.40, replayPriority);
    return [
      // Hook: gentle Ken-Burns drift on full page
      {
        phase:      'hook',
        strategy:   'page_overview',
        zoom:       lerp(1.00, 1.08, replayPriority),
        zoomTarget: null,
        atFrame:    0,
      },
      // Action: camera drifts toward cursor / trigger element
      {
        phase:      'action',
        strategy:   'follow_cursor',
        zoom:       lerp(1.05, 1.15, replayPriority),
        zoomTarget: changeRegion,
        atFrame:    phases.cursorMoveStartFrame,
      },
      // Transition: slight pull-back to reveal context during crossfade
      {
        phase:      'transition',
        strategy:   'follow_change',
        zoom:       lerp(1.05, 1.10, replayPriority),
        zoomTarget: null,
        atFrame:    phases.transitionStartFrame,
      },
      // Outcome: spring zoom to primary change region
      {
        phase:      'outcome',
        strategy:   'reveal_outcome',
        zoom:       endZoom,
        zoomTarget: changeRegion,
        atFrame:    phases.outcomeZoomFrame,
      },
    ];
  }

  // ── Callout text ──────────────────────────────────────────────────────────────

  private buildCalloutText(seq: InteractionSequence): string {
    if (seq.visualDelta.valueChanges.length > 0) {
      const first = seq.visualDelta.valueChanges[0];
      return first.after ? `${first.label}: ${first.after}` : first.label;
    }
    if (seq.visualDelta.appearedElements.length > 0) {
      const el = seq.visualDelta.appearedElements[0];
      return el.length <= 40 ? el : `${el.slice(0, 40)}…`;
    }
    return seq.trigger.humanReadableHint;
  }
}
