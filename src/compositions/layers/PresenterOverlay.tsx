/**
 * PresenterOverlay — floating presenter image at bottom-left (enterprise template).
 *
 * Positioned absolutely so it can be composited over any background.
 * Fades in over the first 20 frames. Degrades gracefully when the asset is
 * missing — the overlay is hidden rather than crashing the render.
 */

import React, { useState } from 'react';
import { AbsoluteFill, Img, staticFile, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export interface PresenterOverlayProps {
  /** Path relative to the Remotion public dir (e.g. 'assets/presenter/presenter-default.png'). */
  src:           string;
  /** Fraction of video width the presenter image occupies. Default: 0.15 */
  widthFraction?: number;
  /** Which corner to anchor to. */
  position?:     'bottom-left' | 'bottom-right';
}

export const PresenterOverlay: React.FC<PresenterOverlayProps> = ({
  src,
  widthFraction = 0.15,
  position      = 'bottom-left',
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const [hidden, setHidden] = useState(false);

  // Skip rendering entirely if src is empty or image failed to load
  if (!src || hidden) return null;

  const opacity = spring({ frame, fps, from: 0, to: 1, config: { damping: 20, stiffness: 100 } });

  const imgWidth  = Math.round(width * widthFraction);
  const imgHeight = Math.round(imgWidth * 1.5);

  const xPos   = position === 'bottom-left'  ? 32 : undefined;
  const xRight = position === 'bottom-right' ? 32 : undefined;

  return (
    <div
      style={{
        position:     'absolute',
        bottom:        0,
        left:          xPos,
        right:         xRight,
        width:         imgWidth,
        height:        imgHeight,
        opacity,
        pointerEvents: 'none',
        zIndex:         10,
      }}
    >
      <Img
        src={staticFile(src)}
        style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'bottom' }}
        onError={() => setHidden(true)}
      />
    </div>
  );
};
