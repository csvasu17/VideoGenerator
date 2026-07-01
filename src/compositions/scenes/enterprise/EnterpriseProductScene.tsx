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
  /** 'fit' = inset with padding + rounded corners; 'full' = edge-to-edge (default). */
  screenFit?: 'fit' | 'full';
}

// ── Fit-mode layout constants — single source of truth ───────────────────────
// Change SCREEN_H to adjust the inset height; LABEL_TOP updates automatically.
const MARGIN      = 80;                        // uniform inset on left / right / top (px)
const SCREEN_W    = 1920 - MARGIN * 2;         // 1760 — width of the inset screen area
const SCREEN_H    = 900;                       // height of the inset screen area
const LABEL_GAP   = 16;                        // space between screen bottom and separator (px)
const LABEL_TOP   = MARGIN + SCREEN_H + LABEL_GAP; // 996 — derived, never a magic number

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
  screenFit = 'full',
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

      {/* ── Subtle radial glow behind screen — fit mode only ─────────────── */}
      {screenFit === 'fit' && (
        <div style={{
          position:      'absolute',
          inset:         0,
          background:    `radial-gradient(ellipse 1500px 750px at ${MARGIN + SCREEN_W / 2}px ${MARGIN + SCREEN_H / 2}px, rgba(99,102,241,0.09) 0%, transparent 65%)`,
          pointerEvents: 'none',
        }} />
      )}

      {/* ── Screen content — fit=inset with padding, full=edge-to-edge ─────── */}
      <div style={screenFit === 'fit' ? {
        position: 'absolute',
        top: MARGIN, left: MARGIN, width: SCREEN_W, height: SCREEN_H,
        overflow: 'hidden',
        borderRadius: 14,
        border: '1px solid rgba(255,255,255,0.11)',
        boxShadow: '0 36px 110px rgba(0,0,0,0.82), 0 0 0 1px rgba(255,255,255,0.05)',
      } : {
        position: 'absolute',
        left: 0, top: 0, right: 0, bottom: 0,
        overflow: 'hidden',
      }}>
        {hasRecording ? (
          <OffthreadVideo
            src={staticFile(vidSrc)}
            startFrom={recordingStartSec ? Math.round(recordingStartSec * fps) : 0}
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top left' }}
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

      {/* ── Scene title label below screen — fit mode only ──────────────── */}
      {screenFit === 'fit' && (
        <div style={{
          position:      'absolute',
          top:           LABEL_TOP,
          left:          MARGIN,
          right:         MARGIN,
          pointerEvents: 'none',
        }}>
          <div style={{
            height:     1,
            background: 'rgba(255,255,255,0.12)',
            marginBottom: 18,
          }} />
          <div style={{ textAlign: 'center', fontFamily: FONT_STACK }}>
            <div style={{
              fontSize:      18,
              fontWeight:    700,
              color:         'rgba(255,255,255,0.92)',
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
            }}>
              {title}
            </div>
            <div style={{
              fontSize:      13,
              fontWeight:    400,
              color:         'rgba(255,255,255,0.55)',
              marginTop:     7,
              letterSpacing: '0.02em',
            }}>
              {salesHook}
            </div>
          </div>
        </div>
      )}

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
