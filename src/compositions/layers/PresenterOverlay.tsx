import React, { useState } from 'react';
import {
  Img,
  OffthreadVideo,
  staticFile,
  spring,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';


// ── PresenterOverlay ──────────────────────────────────────────────────────────

export interface TalkingWindow {
  /** Presenter-sequence-local start frame (0 = when presenter first appears). */
  startFrame: number;
  /** Presenter-sequence-local end frame. */
  endFrame: number;
}

export interface PresenterOverlayProps {
  src:                    string;
  videoSrc?:              string;
  widthFraction?:         number;
  position?:              'bottom-left' | 'bottom-right';
  /**
   * Voice-script windows in presenter-local frames.
   * When provided and a lip-synced video exists, the talking video is blended
   * in/out around these windows.  Falls back to continuous play otherwise.
   */
  talkingWindows?:        TalkingWindow[];
  voiceSyncOffsetFrames?: number;
  voiceAudioSrc?:         string;
  mouthRegion?: {
    xFraction:     number;
    yFraction:     number;
    widthFraction: number;
  };
}

const FRAME_SEQ_TOTAL = 300;

export const PresenterOverlay: React.FC<PresenterOverlayProps> = ({
  src,
  videoSrc,
  widthFraction         = 0.15,
  position              = 'bottom-left',
  talkingWindows,
  voiceSyncOffsetFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const [hidden, setHidden] = useState(false);

  if ((!src && !videoSrc) || hidden) return null;

  const imgWidth  = Math.round(width * widthFraction);
  const imgHeight = Math.round(imgWidth * 1.4);

  const entryProg  = spring({ frame, fps, from: 0, to: 1, config: { damping: 20, stiffness: 70 } });
  const slideInY   = interpolate(entryProg, [0, 1], [60, 0]);
  const floatY     = Math.sin(frame * ((2 * Math.PI * 0.4) / fps)) * 3 * entryProg;
  const translateY = slideInY + floatY;

  const containerStyle: React.CSSProperties = {
    position:      'absolute',
    bottom:         0,
    left:           position === 'bottom-left'  ? 0 : undefined,
    right:          position === 'bottom-right' ? 0 : undefined,
    width:          imgWidth,
    height:         imgHeight,
    opacity:        entryProg,
    transform:     `translateY(${translateY}px)`,
    pointerEvents: 'none',
    zIndex:         10,
    overflow:      'hidden',
  };

  const fillStyle: React.CSSProperties = {
    position:       'absolute',
    inset:           0,
    width:          '100%',
    height:         '100%',
    objectFit:      'cover',
    objectPosition: 'center',
  };

  // ── Direct video mode (.mp4 or .webm) ───────────────────────────────────────
  const isDirectVideo = videoSrc ? /\.(mp4|webm)$/i.test(videoSrc) : false;

  if (isDirectVideo) {
    // When talkingWindows are provided (D-ID lip-sync path): blend talking video
    // in during voice segments and neutral PNG during silence.
    // When no windows: play the video continuously (current generic animation path).
    const hasWindows = talkingWindows && talkingWindows.length > 0;

    if (hasWindows) {
      const TRANS = Math.round(fps * 0.3);

      const talkingLevel = talkingWindows!.reduce((maxLevel, win) => {
        const level = interpolate(
          frame,
          [win.startFrame - TRANS, win.startFrame, win.endFrame, win.endFrame + TRANS],
          [0, 1, 1, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
        );
        return Math.max(maxLevel, level);
      }, 0);

      return (
        <div style={containerStyle}>
          <Img src={staticFile(src)} style={fillStyle} />
          <OffthreadVideo
            src={staticFile(videoSrc!)}
            startFrom={0}
            muted
            transparent
            style={{ ...fillStyle, opacity: talkingLevel }}
          />
        </div>
      );
    }

    // No windows — single continuous video, no restarts
    return (
      <div style={containerStyle}>
        <OffthreadVideo
          src={staticFile(videoSrc!)}
          startFrom={0}
          muted
          transparent
          style={fillStyle}
        />
      </div>
    );
  }

  // ── Frame-sequence / static fallback ─────────────────────────────────────────
  const frameDir = videoSrc
    ? videoSrc.substring(0, videoSrc.lastIndexOf('/')) + '/frames_alpha'
    : null;

  const voiceRelFrame =
    voiceSyncOffsetFrames !== undefined && frame >= voiceSyncOffsetFrames
      ? frame - voiceSyncOffsetFrames
      : 0;

  const videoFrameNum = (voiceRelFrame % FRAME_SEQ_TOTAL) + 1;
  const frameSrc = frameDir
    ? `${frameDir}/frame_${String(videoFrameNum).padStart(4, '0')}.png`
    : null;

  return (
    <div style={containerStyle}>
      <Img
        src={staticFile(frameSrc ?? src)}
        style={fillStyle}
        onError={() => setHidden(true)}
      />
    </div>
  );
};
