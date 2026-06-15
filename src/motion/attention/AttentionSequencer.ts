/**
 * AttentionSequencer — produces an ordered AttentionBeat[] from an AttentionMap.
 *
 * Determines the temporal sequence of camera focus phases within a scene:
 *
 *   context       → establish full layout
 *   approach      → dolly-in to primary target
 *   hold-primary  → settle + drift on primary target
 *   [pan-to-secondary → only when secondary target exists + scene is long enough]
 *   [hold-secondary   → settle on secondary target]
 *   return        → soft pull-back before transition
 *
 * No LLM, no I/O. Pure arithmetic.
 */

import type { AttentionMap, AttentionBeat, BeatMotionType } from './types';
import { CAMERA_PROFILES }       from '../camera/CameraProfiles';
import type { AttentionPhase }   from '../camera/types';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Minimum frames left after primary hold to bother adding secondary beat. */
const MIN_FRAMES_FOR_SECONDARY_BEAT = 60;

/** Minimum duration (frames) for a secondary hold to be meaningful. */
const MIN_SECONDARY_HOLD = 30;

// ─────────────────────────────────────────────────────────────────────────────
// AttentionSequencer
// ─────────────────────────────────────────────────────────────────────────────

export class AttentionSequencer {
  /**
   * Build the ordered attention beat sequence for a scene.
   *
   * @param map       AttentionMap for the scene (targets sorted desc by motionScore)
   * @param duration  Total scene duration in frames
   * @param fps       Frames per second
   */
  sequence(map: AttentionMap, duration: number, fps: number): AttentionBeat[] {
    if (duration < 30) {
      // Very short scene — single static beat
      return [beat('static-hold', 'hold-primary', 0, duration - 1, 'primary', 'static')];
    }

    const primary   = map.targets[0];
    const secondary = map.targets.find(t => t.storyRole === 'supporting');

    const profile = CAMERA_PROFILES[primary?.elementType ?? 'default'];

    // ── Phase timing ─────────────────────────────────────────────────────────
    const contextDur  = Math.max(10, Math.round(fps * 0.4));   // ~12 frames @ 30fps
    const approachDur = profile.approachFrames;
    const contextEnd  = contextDur;
    const approachEnd = contextEnd + approachDur;

    // When secondary exists, shorten primary hold fraction to leave room
    const holdFraction = secondary
      ? profile.holdPct * 0.65
      : profile.holdPct;

    const holdPrimaryEnd = Math.max(
      approachEnd + 20,
      Math.round(duration * holdFraction),
    );

    const beats: AttentionBeat[] = [];

    // ── Context ──────────────────────────────────────────────────────────────
    beats.push(beat('context', 'context', 0, contextEnd - 1, primary?.id ?? 'primary', 'static'));

    // ── Approach ─────────────────────────────────────────────────────────────
    if (approachDur > 0) {
      beats.push(beat('approach', 'approach', contextEnd, approachEnd - 1, primary?.id ?? 'primary', 'dolly-in'));
    }

    // ── Hold-primary ─────────────────────────────────────────────────────────
    beats.push(beat('hold-primary', 'hold-primary', approachEnd, holdPrimaryEnd - 1, primary?.id ?? 'primary', 'drift'));

    // ── Secondary (optional) ──────────────────────────────────────────────────
    if (secondary && (duration - holdPrimaryEnd) > MIN_FRAMES_FOR_SECONDARY_BEAT) {
      const panDur    = Math.max(25, Math.round(fps * 0.9));
      const panEnd    = holdPrimaryEnd + panDur;

      if (panEnd < duration - MIN_SECONDARY_HOLD) {
        const holdSecEnd = Math.min(panEnd + 60, duration - 15);

        beats.push(beat('pan-secondary',  'pan-to-secondary', holdPrimaryEnd, panEnd - 1,     secondary.id, 'pan'));
        beats.push(beat('hold-secondary', 'hold-secondary',   panEnd,         holdSecEnd - 1, secondary.id, 'drift'));
        beats.push(beat('return',         'return',           holdSecEnd,     duration - 1,   primary?.id ?? 'primary', 'pull-back'));
        return beats;
      }
    }

    // ── Return (no secondary) ────────────────────────────────────────────────
    beats.push(beat('return', 'return', holdPrimaryEnd, duration - 1, primary?.id ?? 'primary', 'pull-back'));

    return beats;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Builder helper
// ─────────────────────────────────────────────────────────────────────────────

function beat(
  id:         string,
  phase:      AttentionPhase,
  startFrame: number,
  endFrame:   number,
  targetId:   string,
  motionType: BeatMotionType,
): AttentionBeat {
  return { id, phase, startFrame, endFrame, targetId, motionType };
}
