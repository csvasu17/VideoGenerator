/**
 * EnterpriseProductScene — shows either a real screen recording clip or a
 * static screenshot, wrapped in a designed card with a sales-copy bottom bar.
 *
 * When `recordingPath` is provided the scene plays the actual Playwright
 * screen recording (OffthreadVideo) so viewers see real navigation and
 * interactions. The static screenshot fallback (Ken-Burns zoom) is kept for
 * backwards-compatibility with packages that only have screenshots.
 */

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
  recordingPath?:          string;  // real screen recording mp4 — preferred
  title:                   string;
  salesHook:               string;
  narration:               string;
  presenterSrc?:           string;
  presenterWidthFraction?: number;
}

export const EnterpriseProductScene: React.FC<EnterpriseProductSceneProps> = ({
  screenshotPath,
  recordingPath,
  title,
  salesHook,
  narration,
  presenterSrc,
  presenterWidthFraction = 0.15,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Card slides up + fades in over first 22 frames
  const cardEnter  = spring({ frame, fps, from: 0, to: 1, config: { damping: 20, stiffness: 80 } });
  const cardOpacity = cardEnter;
  const cardY       = interpolate(cardEnter, [0, 1], [18, 0]);

  // Bottom bar text enters 10 frames after card
  const textEnter = spring({ frame: Math.max(0, frame - 10), fps, from: 0, to: 1, config: { damping: 18 } });

  // Ken-Burns zoom — only used for static screenshot fallback
  const zoom = interpolate(frame, [0, durationInFrames], [1.0, 1.04], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  const hasRecording = !!recordingPath;
  const imgSrc       = screenshotPath.replace(/\\/g, '/');
  const vidSrc       = recordingPath ? recordingPath.replace(/\\/g, '/') : '';

  // First sentence of narration for the subtitle line
  const firstSentence = (() => {
    const cut = narration?.indexOf('. ') ?? -1;
    return cut > 0 ? narration.substring(0, cut + 1) : narration;
  })();

  const presenterPadLeft = presenterSrc
    ? `calc(${presenterWidthFraction * 100}% + 52px)`
    : '48px';

  return (
    <AbsoluteFill style={{ background: '#eef2f7', fontFamily: FONT_STACK }}>

      {/* Subtle dot-grid background texture */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'radial-gradient(circle, rgba(10,147,211,0.12) 1px, transparent 1px)',
        backgroundSize: '28px 28px',
      }} />

      {/* Teal top accent line */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 4,
        background: 'linear-gradient(to right, #0a93d3, #059669)',
      }} />

      {/* Content card — fills most of the frame */}
      <div style={{
        position: 'absolute',
        top: 16, left: 32, right: 32, bottom: 120,
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: '0 12px 64px rgba(0,0,0,0.22), 0 3px 16px rgba(0,0,0,0.10)',
        border: '1px solid rgba(255,255,255,0.70)',
        opacity: cardOpacity,
        transform: `translateY(${cardY}px)`,
      }}>

        {hasRecording ? (
          /* ── Real screen recording: play the video clip ─────────────────── */
          <OffthreadVideo
            src={staticFile(vidSrc)}
            style={{
              width: '100%', height: '100%',
              objectFit: 'cover', objectPosition: 'top center',
            }}
          />
        ) : (
          /* ── Static screenshot fallback: Ken-Burns zoom ─────────────────── */
          <div style={{
            width: '100%', height: '100%',
            transform: `scale(${zoom})`,
            transformOrigin: 'center top',
          }}>
            <Img
              src={staticFile(imgSrc)}
              style={{
                width: '100%', height: '100%',
                objectFit: 'cover', objectPosition: 'top center',
              }}
            />
          </div>
        )}

        {/* Subtle inner bottom gradient */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 60,
          background: 'linear-gradient(to bottom, transparent, rgba(238,242,247,0.30))',
          pointerEvents: 'none',
        }} />
      </div>

      {/* Bottom title / sales-copy bar */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: 120,
        background: '#ffffff',
        borderTop: '2px solid rgba(10,147,211,0.22)',
        display: 'flex', alignItems: 'center',
        paddingLeft: presenterPadLeft,
        paddingRight: 48,
        gap: 18,
        opacity: textEnter,
      }}>
        {/* Gradient accent bar */}
        <div style={{
          width: 4, height: 62,
          background: 'linear-gradient(to bottom, #0a93d3, #059669)',
          borderRadius: 2, flexShrink: 0,
        }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflow: 'hidden' }}>
          <span style={{
            color: '#0a93d3', fontSize: 11, fontWeight: 700,
            letterSpacing: '2.2px', textTransform: 'uppercase',
          }}>
            FEATURE HIGHLIGHT
          </span>
          <span style={{
            color: '#0f172a', fontSize: 25, fontWeight: 800,
            lineHeight: 1.2, letterSpacing: '-0.4px',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {salesHook}
          </span>
          {firstSentence && (
            <span style={{
              color: 'rgba(15,23,42,0.52)', fontSize: 14, lineHeight: 1.4,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {firstSentence}
            </span>
          )}
        </div>
      </div>

      {/* Presenter overlay — bottom-left corner */}
      {presenterSrc && (
        <PresenterOverlay
          src={presenterSrc}
          widthFraction={presenterWidthFraction}
          position="bottom-left"
        />
      )}

    </AbsoluteFill>
  );
};
