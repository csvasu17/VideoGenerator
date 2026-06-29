import React from 'react';
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import { PresenterOverlay } from '../../layers/PresenterOverlay';
import { FONT_STACK } from '../../tokens';

export interface EnterpriseProductSceneProps {
  screenshotPath:          string;
  recordingPath?:          string;
  /** Seconds into the flow video to seek to — enables one-video-per-role with startFrom. */
  recordingStartSec?:      number;
  title:                   string;
  salesHook:               string;
  narration:               string;
  presenterSrc?:           string;
  presenterVideoSrc?:      string;
  presenterWidthFraction?: number;
  /** Frame offset within this scene at which voice starts — passed to PresenterOverlay for lip sync. */
  voiceSyncOffsetFrames?:  number;
  /** Per-scene MP3 for audio-amplitude mouth animation (relative to public dir). */
  voiceAudioSrc?:          string;
  mouthRegion?: { xFraction: number; yFraction: number; widthFraction: number };
}

export const EnterpriseProductScene: React.FC<EnterpriseProductSceneProps> = ({
  screenshotPath,
  recordingPath,
  recordingStartSec,
  title,
  salesHook,
  narration,
  presenterSrc,
  presenterVideoSrc,
  presenterWidthFraction = 0.15,
  voiceSyncOffsetFrames,
  voiceAudioSrc,
  mouthRegion,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Gentle Ken-Burns drift for screenshot fallback
  const zoom = interpolate(frame, [0, durationInFrames], [1.0, 1.04], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  const hasRecording = !!recordingPath;
  const imgSrc       = screenshotPath.replace(/\\/g, '/');
  const vidSrc       = recordingPath ? recordingPath.replace(/\\/g, '/') : '';

  return (
    <AbsoluteFill style={{ background: '#0a0f1a', fontFamily: FONT_STACK }}>

      {/* ── Full-frame screen recording ──────────────────────────────────────── */}
      <div style={{
        position: 'absolute',
        left: 0, top: 0, right: 0, bottom: 0,
        overflow: 'hidden',
      }}>
        {hasRecording ? (
          <OffthreadVideo
            src={staticFile(vidSrc)}
            startFrom={recordingStartSec ? Math.round(recordingStartSec * fps) : 0}
            style={{ width: '100%', height: '100%', objectFit: 'fill' }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
            <Img
              src={staticFile(imgSrc)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top left' }}
            />
          </div>
        )}
      </div>

      {/* ── Presenter overlay — bottom-left, slide-in + float + mouth sync ─── */}
      {(presenterSrc || presenterVideoSrc) && (
        <PresenterOverlay
          src={presenterSrc ?? ''}
          videoSrc={presenterVideoSrc}
          widthFraction={presenterWidthFraction}
          position="bottom-left"
          voiceSyncOffsetFrames={voiceSyncOffsetFrames}
          voiceAudioSrc={voiceAudioSrc}
          mouthRegion={mouthRegion}
        />
      )}

    </AbsoluteFill>
  );
};
