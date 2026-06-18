import React, { useState } from 'react';
import { Img, staticFile, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export interface PresenterOverlayProps {
  src:                    string;   // alpha PNG — fallback static image
  videoSrc?:              string;   // MP4 path; used to derive frames_alpha/ directory
  widthFraction?:         number;
  position?:              'bottom-left' | 'bottom-right';
  voiceSyncOffsetFrames?: number;
}

// presenter-talking.mp4 is 10 s at 30 fps = 300 frames (frame_0001 … frame_0300)
const TOTAL_VIDEO_FRAMES = 300;

export const PresenterOverlay: React.FC<PresenterOverlayProps> = ({
  src,
  videoSrc,
  widthFraction = 0.15,
  position      = 'bottom-left',
  voiceSyncOffsetFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const [hidden, setHidden] = useState(false);

  if ((!src && !videoSrc) || hidden) return null;

  const opacity   = spring({ frame, fps, from: 0, to: 1, config: { damping: 20, stiffness: 100 } });
  const imgWidth  = Math.round(width * widthFraction);
  const imgHeight = Math.round(imgWidth * 1.46);

  const xPos   = position === 'bottom-left'  ? 0 : undefined;
  const xRight = position === 'bottom-right' ? 0 : undefined;

  // ── Frame-sequence source (pre-processed alpha frames) ──────────────────
  // Derive the frames_alpha/ directory from the videoSrc path, e.g.
  //   "assets/presenter/presenter-talking.mp4"
  //   → "assets/presenter/frames_alpha"
  const frameDir = videoSrc
    ? videoSrc.substring(0, videoSrc.lastIndexOf('/')) + '/frames_alpha'
    : null;

  // How many Remotion frames have elapsed since the voice started.
  // Before voice: voiceRelFrame = 0 → always shows frame_0001 (static neutral pose).
  // After voice:  advances 1:1 with output frames (both at 30 fps) and loops every 10 s.
  const voiceRelFrame =
    voiceSyncOffsetFrames !== undefined && frame >= voiceSyncOffsetFrames
      ? frame - voiceSyncOffsetFrames
      : 0;

  const videoFrameNum = (voiceRelFrame % TOTAL_VIDEO_FRAMES) + 1; // 1-indexed
  const frameSrc = frameDir
    ? `${frameDir}/frame_${String(videoFrameNum).padStart(4, '0')}.png`
    : null;

  // Use frame sequence if available, otherwise fall back to static alpha PNG
  const displaySrc = frameSrc ?? src;

  const imgStyle: React.CSSProperties = {
    position:       'absolute',
    inset:           0,
    width:          '100%',
    height:         '100%',
    objectFit:      'cover',
    objectPosition: 'top center',
  };

  return (
    <div
      style={{
        position:      'absolute',
        bottom:         0,
        left:           xPos,
        right:          xRight,
        width:          imgWidth,
        height:         imgHeight,
        opacity,
        pointerEvents: 'none',
        zIndex:         10,
        overflow:      'hidden',
      }}
    >
      <Img
        src={staticFile(displaySrc)}
        style={imgStyle}
        onError={() => setHidden(true)}
      />
    </div>
  );
};
