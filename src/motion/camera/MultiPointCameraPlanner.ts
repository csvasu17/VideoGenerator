/**
 * MultiPointCameraPlanner — extends the single-spotlight CameraChoreographer
 * to support multi-beat attention sequences.
 *
 * For each AttentionBeat that targets a distinct AttentionTarget, the planner
 * calls CameraChoreographer internally and merges the resulting keyframe arrays
 * into a single ExtendedCameraTimeline. This keeps CameraLayer.tsx unchanged —
 * it still receives a sorted keyframe array and spring-interpolates through it.
 *
 * Phase structure produced:
 *   A. Context (full view)
 *   B. Approach → primary
 *   C. Hold-primary (drift)
 *   D. [Pan → secondary]
 *   E. [Hold-secondary (drift)]
 *   F. Return (soft pull-back)
 *
 * No LLM, no I/O. Pure geometry.
 */

import type { AttentionMap, AttentionBeat, NormalizedRegion } from '../attention/types';
import type {
  CameraKeyframe,
  ExtendedCameraTimeline,
  CameraBeatRange,
  SpotlightTarget,
} from './types';
import { CAMERA_PROFILES, CANONICAL_REGIONS } from './CameraProfiles';
import { CameraChoreographer }                from './CameraChoreographer';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MAX_ZOOM  = 1.80;   // Phase 7 ceiling (below existing 2.0 contract)
const MIN_ZOOM  = 1.00;
const FOCUS_MIN = 0.10;
const FOCUS_MAX = 0.90;

const SPRING_APPROACH = { damping: 20, stiffness: 90 };
const SPRING_PAN      = { damping: 22, stiffness: 70 };
const SPRING_RETURN   = { damping: 22, stiffness: 60 };

// ─────────────────────────────────────────────────────────────────────────────
// MultiPointCameraPlanner
// ─────────────────────────────────────────────────────────────────────────────

export class MultiPointCameraPlanner {
  private readonly mono = new CameraChoreographer();

  /**
   * Produce an ExtendedCameraTimeline from an attention beat sequence.
   *
   * @param beats     Ordered attention beats from AttentionSequencer
   * @param map       AttentionMap providing target regions and element types
   * @param duration  Total scene duration in frames
   * @param fps       Frames per second
   * @param sceneId   For timeline bookkeeping
   */
  plan(
    beats:    AttentionBeat[],
    map:      AttentionMap,
    duration: number,
    fps:      number,
    sceneId:  string,
  ): ExtendedCameraTimeline {
    // Safety: very short scene or no beats — fall back to Ken-Burns via mono choreographer
    if (duration < 60 || beats.length === 0) {
      const mono = this.mono.choreograph({ sceneId, durationInFrames: duration, fps });
      return { ...mono, beats: [] };
    }

    const primary   = map.targets[0];
    const secondary = map.targets.find(t => t.storyRole === 'supporting');

    // Use the existing CameraChoreographer to produce a spotlight timeline for
    // the primary target — this gives us the correct Context → Approach → Hold → Return
    // keyframes for the primary.
    const primarySpotlight: SpotlightTarget = {
      elementType: primary.elementType,
      boundingBox: {
        x:      primary.region.x,
        y:      primary.region.y,
        width:  primary.region.width,
        height: primary.region.height,
      },
      label:    primary.label,
      priority: primary.businessValue,
    };

    const monoTimeline = this.mono.choreograph({
      sceneId,
      durationInFrames: duration,
      fps,
      spotlightTarget: primarySpotlight,
    });

    // If there is no secondary, wrap mono result as ExtendedCameraTimeline
    if (!secondary) {
      const beatRanges: CameraBeatRange[] = buildBeatRanges(beats);
      return {
        ...monoTimeline,
        beats: beatRanges,
      };
    }

    // ── Multi-point: merge primary mono timeline with secondary pan segment ──
    const panBeat   = beats.find(b => b.phase === 'pan-to-secondary');
    const holdS2    = beats.find(b => b.phase === 'hold-secondary');
    const returnBeat = beats.find(b => b.phase === 'return');

    if (!panBeat || !holdS2) {
      // No secondary beat in sequence — fall back to primary-only
      return { ...monoTimeline, beats: buildBeatRanges(beats) };
    }

    const secondaryFocus = regionToFocus(secondary.region);
    const secondaryProfile = CAMERA_PROFILES[secondary.elementType];
    const secondaryZoom  = clamp(
      lerp(secondaryProfile.zoomMin, secondaryProfile.zoomMax, secondary.businessValue),
      MIN_ZOOM, MAX_ZOOM,
    );

    // Start from mono keyframes, then append pan → secondary keyframes
    const keyframes: CameraKeyframe[] = [...monoTimeline.keyframes];

    // Find the last keyframe before the pan starts and override the return keyframe
    // Truncate monoTimeline keyframes at panBeat.startFrame
    const truncated = keyframes.filter(kf => kf.frame < panBeat.startFrame);

    // Add a keyframe at the exact pan start (hold-primary state)
    const holdEndKf = mostRecentKf(monoTimeline.keyframes, panBeat.startFrame - 1);
    if (holdEndKf) {
      truncated.push(kf(panBeat.startFrame, holdEndKf.zoom, holdEndKf.focusX, holdEndKf.focusY, 'spring', SPRING_PAN));
    }

    // Pan to secondary
    truncated.push(kf(panBeat.endFrame, secondaryZoom, secondaryFocus.x, secondaryFocus.y, 'spring', SPRING_PAN));

    // Hold-secondary with drift
    const holdMid = Math.round((holdS2.startFrame + holdS2.endFrame) / 2);
    truncated.push(kf(
      holdMid,
      secondaryZoom,
      clamp(secondaryFocus.x + secondaryProfile.driftX * 0.5, FOCUS_MIN, FOCUS_MAX),
      clamp(secondaryFocus.y + secondaryProfile.driftY * 0.5, FOCUS_MIN, FOCUS_MAX),
      'linear',
    ));
    truncated.push(kf(
      holdS2.endFrame,
      secondaryZoom,
      clamp(secondaryFocus.x + secondaryProfile.driftX, FOCUS_MIN, FOCUS_MAX),
      clamp(secondaryFocus.y + secondaryProfile.driftY, FOCUS_MIN, FOCUS_MAX),
      'linear',
    ));

    // Return (soft pull-back)
    const returnZoom   = clamp(secondaryZoom * 0.85, MIN_ZOOM, MAX_ZOOM);
    const returnFocusX = clamp((secondaryFocus.x + 0.5) / 2, FOCUS_MIN, FOCUS_MAX);
    const returnFocusY = clamp((secondaryFocus.y + 0.5) / 2, FOCUS_MIN, FOCUS_MAX);
    truncated.push(kf(duration - 1, returnZoom, returnFocusX, returnFocusY, 'spring', SPRING_RETURN));

    return {
      sceneId,
      durationInFrames: duration,
      keyframes:        truncated.sort((a, b) => a.frame - b.frame),
      spotlightTarget:  primarySpotlight,
      beats:            buildBeatRanges(beats),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function regionToFocus(region: NormalizedRegion): { x: number; y: number } {
  return {
    x: clamp(region.x + region.width  / 2, FOCUS_MIN, FOCUS_MAX),
    y: clamp(region.y + region.height / 2, FOCUS_MIN, FOCUS_MAX),
  };
}

function mostRecentKf(keyframes: CameraKeyframe[], beforeFrame: number): CameraKeyframe | undefined {
  const candidates = keyframes.filter(kf => kf.frame <= beforeFrame);
  if (candidates.length === 0) return undefined;
  return candidates.reduce((prev, cur) => (cur.frame > prev.frame ? cur : prev));
}

function buildBeatRanges(beats: AttentionBeat[]): CameraBeatRange[] {
  return beats.map(b => ({
    beatId:     b.id,
    phase:      b.phase,
    startFrame: b.startFrame,
    endFrame:   b.endFrame,
  }));
}

function kf(
  frame:        number,
  zoom:         number,
  focusX:       number,
  focusY:       number,
  easing:       'spring' | 'linear',
  springConfig?: { damping: number; stiffness: number },
): CameraKeyframe {
  return { frame, zoom, focusX, focusY, easing, springConfig };
}
