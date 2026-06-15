/**
 * StateTransitionLayer — Phase 9
 *
 * Renders two screenshots — base state and after-state — and crossfades between
 * them over the transition window [transitionStartFrame, transitionEndFrame].
 *
 * Before transitionStartFrame: only start screenshot visible.
 * During transition:           end screenshot fades in over start screenshot.
 * After transitionEndFrame:    only end screenshot visible.
 *
 * The component does NOT apply camera motion — that is handled by the parent
 * InteractionScene wrapping both in a CameraLayer.
 */

import React from 'react';
import { Img, interpolate, staticFile, useCurrentFrame } from 'remotion';

interface StateTransitionLayerProps {
  startScreenshotPath: string;
  endScreenshotPath:   string;
  transitionStartFrame: number;
  transitionEndFrame:   number;
  /** Viewport dimensions for the screenshot fill. */
  viewportW?: number;
  viewportH?: number;
}

export const StateTransitionLayer: React.FC<StateTransitionLayerProps> = ({
  startScreenshotPath,
  endScreenshotPath,
  transitionStartFrame,
  transitionEndFrame,
  viewportW = 1920,
  viewportH = 1080,
}) => {
  const frame = useCurrentFrame();

  // Crossfade: 0 = start state fully visible, 1 = end state fully visible
  const crossfade = interpolate(
    frame,
    [transitionStartFrame, transitionEndFrame],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const screenshotStyle: React.CSSProperties = {
    position:        'absolute',
    top:              0,
    left:             0,
    width:            viewportW,
    height:           viewportH,
    objectFit:       'fill',
    display:         'block',
  };

  return (
    <div style={{ position: 'relative', width: viewportW, height: viewportH, overflow: 'hidden' }}>
      {/* Start (base) screenshot — always present, fades out during transition */}
      <Img
        src={staticFile(startScreenshotPath)}
        style={{ ...screenshotStyle, opacity: 1 - crossfade }}
      />

      {/* End (after-state) screenshot — fades in during transition */}
      {crossfade > 0 && (
        <Img
          src={staticFile(endScreenshotPath)}
          style={{ ...screenshotStyle, opacity: crossfade }}
        />
      )}
    </div>
  );
};
