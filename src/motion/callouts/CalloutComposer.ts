/**
 * CalloutComposer — builds the CalloutTrack for a scene from AttentionBeats.
 *
 * Rules:
 *   - Each attention beat that has a 'hero' or 'supporting' target can receive one callout.
 *   - Callout appears 15 frames after camera ARRIVES (hold phase starts).
 *   - Callout disappears 15 frames before camera LEAVES (hold phase ends).
 *   - Enter animation: 12 frames. Exit animation: 10 frames.
 *   - Minimum visible hold duration: 30 frames. Suppress if not achievable.
 *   - Max 2 callouts visible simultaneously.
 *
 * Spatial placement:
 *   - Primary callout: to the LEFT of target if target.x > 0.55, else RIGHT.
 *   - Secondary callout: opposite side from primary.
 *   - Panels clipped to product window safe zone: x ∈ [0.04, 0.92], y ∈ [0.04, 0.88].
 *
 * No LLM, no I/O. Pure geometry.
 */

import type { AttentionMap, AttentionBeat }   from '../attention/types';
import type { AnimatedCallout, CalloutTrack, CalloutStyle, CalloutConnector, CalloutVariant } from './types';
import type { GlobalMotionStyle }              from '../types';
import type { Vec2 }                           from '../attention/types';
import { ACCENT_TEAL }                         from '../../compositions/tokens';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const CALLOUT_DELAY_AFTER_ARRIVE   = 15;   // frames after hold starts
const CALLOUT_LEAD_BEFORE_DEPART   = 15;   // frames before hold ends
const ENTER_DURATION               = 12;
const EXIT_DURATION                = 10;
const MIN_HOLD_DURATION            = 30;

const SAFE_ZONE = { xMin: 0.04, xMax: 0.92, yMin: 0.04, yMax: 0.88 };
const PANEL_W   = 0.22;   // normalized panel width
const PANEL_H   = 0.08;   // normalized panel height

// ─────────────────────────────────────────────────────────────────────────────
// CalloutComposer
// ─────────────────────────────────────────────────────────────────────────────

export class CalloutComposer {
  compose(
    beats:      AttentionBeat[],
    map:        AttentionMap,
    sceneId:    string,
    style:      GlobalMotionStyle,
  ): CalloutTrack {
    const callouts: AnimatedCallout[] = [];
    let calloutIndex = 0;
    let previousPanelSide: 'left' | 'right' | null = null;

    for (const beat of beats) {
      if (beat.phase !== 'hold-primary' && beat.phase !== 'hold-secondary') continue;

      const target = map.targets.find(t => t.id === beat.targetId);
      if (!target) continue;
      if (target.storyRole !== 'hero' && target.storyRole !== 'supporting') continue;

      // Timing
      const holdStart = beat.startFrame + CALLOUT_DELAY_AFTER_ARRIVE;
      const holdEnd   = beat.endFrame   - CALLOUT_LEAD_BEFORE_DEPART;

      if (holdEnd - holdStart < MIN_HOLD_DURATION) continue;

      const startFrame = holdStart;
      const endFrame   = holdEnd + EXIT_DURATION;
      const holdStartF = holdStart + ENTER_DURATION;
      const holdEndF   = holdEnd;

      // Spatial placement
      const targetCentreX = target.region.x + target.region.width  / 2;
      const targetCentreY = target.region.y + target.region.height / 2;

      let side: 'left' | 'right';
      if (previousPanelSide === null) {
        side = targetCentreX > 0.55 ? 'left' : 'right';
      } else {
        side = previousPanelSide === 'left' ? 'right' : 'left';
      }
      previousPanelSide = side;

      const panelX = side === 'right'
        ? clamp(targetCentreX + 0.08,      SAFE_ZONE.xMin, SAFE_ZONE.xMax - PANEL_W)
        : clamp(targetCentreX - 0.08 - PANEL_W, SAFE_ZONE.xMin, SAFE_ZONE.xMax - PANEL_W);

      const panelY = clamp(targetCentreY - PANEL_H / 2, SAFE_ZONE.yMin, SAFE_ZONE.yMax - PANEL_H);

      const panelCenter: Vec2 = {
        x: panelX + PANEL_W / 2,
        y: panelY + PANEL_H / 2,
      };

      // Anchor: nearest edge of the target to the panel
      const anchorX = side === 'right'
        ? target.region.x + target.region.width    // right edge
        : target.region.x;                          // left edge
      const anchor: Vec2 = {
        x: clamp(anchorX, 0, 1),
        y: clamp(targetCentreY, 0, 1),
      };

      const calloutStyle = buildStyle(style, calloutIndex);
      const connector: CalloutConnector = {
        type:         'line',
        anchorPoint:  anchor,
        strokeColor:  style.calloutAccentColor,
        strokeWidth:  1.0,
        drawDuration: ENTER_DURATION,
      };

      callouts.push({
        id:           `callout-${sceneId}-${calloutIndex}`,
        beatId:       beat.id,
        startFrame,
        holdStart:    holdStartF,
        holdEnd:      holdEndF,
        endFrame,
        anchor,
        panelPosition: panelCenter,
        panelSize:    { width: PANEL_W, height: PANEL_H },
        content: {
          headline:  target.label,
          subline:   target.benefit,
          metric:    target.metric,
        },
        style:     calloutStyle,
        connector,
        enter: calloutIndex === 0 ? 'fade-slide-up' : 'scale-pop',
        exit:  calloutIndex === 0 ? 'fade-down'     : 'dissolve',
      });

      calloutIndex++;
      if (calloutIndex >= 2) break;  // max 2 callouts per scene
    }

    return { sceneId, callouts };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function buildStyle(globalStyle: GlobalMotionStyle, index: number): CalloutStyle {
  const variant: CalloutVariant = globalStyle.calloutVariant;
  const accent = globalStyle.calloutAccentColor || ACCENT_TEAL;

  return {
    variant,
    accentColor:   accent,
    backdropBlur:  index === 0 ? 20 : 16,
    borderOpacity: 0.18,
    panelOpacity:  variant === 'glass-dark' ? 0.88 : 0.12,
    cornerRadius:  10,
  };
}
