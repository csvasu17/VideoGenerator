import React from 'react';
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import { PresenterOverlay } from '../../layers/PresenterOverlay';
import { FONT_STACK } from '../../tokens';

export interface EnterpriseProductSceneProps {
  screenshotPath:          string;
  recordingPath?:          string;
  title:                   string;
  salesHook:               string;
  narration:               string;
  presenterSrc?:           string;
  presenterVideoSrc?:      string;
  presenterWidthFraction?: number;
  /** Frame offset within this scene at which voice starts — passed to PresenterOverlay for lip sync. */
  voiceSyncOffsetFrames?:  number;
}

export const EnterpriseProductScene: React.FC<EnterpriseProductSceneProps> = ({
  screenshotPath,
  recordingPath,
  title,
  salesHook,
  narration,
  presenterSrc,
  presenterVideoSrc,
  presenterWidthFraction = 0.15,
  voiceSyncOffsetFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Screen fades in over first 18 frames
  const screenEnter = spring({ frame, fps, from: 0, to: 1, config: { damping: 22, stiffness: 90 } });


  // Ken-Burns zoom for screenshot fallback
  const zoom = interpolate(frame, [0, durationInFrames], [1.0, 1.04], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  const hasRecording = !!recordingPath;
  const imgSrc       = screenshotPath.replace(/\\/g, '/');
  const vidSrc       = recordingPath ? recordingPath.replace(/\\/g, '/') : '';

  return (
    <AbsoluteFill style={{ background: '#0a0f1a', fontFamily: FONT_STACK }}>

      {/* ── Screen recording / screenshot — fills full frame ───────────────── */}
      <div style={{
        position: 'absolute', inset: 0,
        opacity: screenEnter,
        overflow: 'hidden',
      }}>
        {hasRecording ? (
          <OffthreadVideo
            src={staticFile(vidSrc)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', transform: `scale(${zoom})`, transformOrigin: 'center top' }}>
            <Img
              src={staticFile(imgSrc)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }}
            />
          </div>
        )}
      </div>

      {/* ── Thin bottom gradient for presenter readability only ─────────────── */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: 180,
        background: 'linear-gradient(to bottom, transparent, rgba(0,0,0,0.35))',
        pointerEvents: 'none',
      }} />

      {/* ── Presenter overlay — bottom-left, animated video ─────────────────── */}
      {(presenterSrc || presenterVideoSrc) && (
        <PresenterOverlay
          src={presenterSrc ?? ''}
          videoSrc={presenterVideoSrc}
          widthFraction={presenterWidthFraction}
          position="bottom-left"
          voiceSyncOffsetFrames={voiceSyncOffsetFrames}
        />
      )}

    </AbsoluteFill>
  );
};
