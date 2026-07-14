/**
 * TeaserFeatureScene — full-bleed real product screen recording (or a
 * Ken-Burns-zoomed screenshot fallback), with an optional small caption chip.
 *
 * Adapted from EnterpriseProductScene, stripped of the presenter overlay and
 * the title/salesHook footer bar — the teaser template has no narration and
 * no presenter, just short punchy on-screen captions over real product UI.
 *
 * No whole-frame fade in/out: the reference video cuts hard between beats, so
 * this renders at full opacity from frame 0. Instead the footage itself gets a
 * fast "punch" settle (slight zoom-in easing to 1.0 over ~9 frames) so the cut
 * still reads as a deliberate transition — cheap and memory-safe since it's a
 * transform on the single already-active scene, not an overlapping cross-
 * dissolve of two video decoders at once.
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
import { FONT_STACK } from '../../tokens';

export interface TeaserFeatureSceneProps {
  screenshotPath:     string;
  recordingPath?:     string;
  /** Seconds into the recorded clip to seek to. */
  recordingStartSec?: number;
  /** Short 3-5 word caption chip, e.g. "AI Chat Assistant". Omit to show no chip. */
  caption?:           string;
}

export const TeaserFeatureScene: React.FC<TeaserFeatureSceneProps> = ({
  screenshotPath,
  recordingPath,
  recordingStartSec,
  caption,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Gentle Ken-Burns drift for the screenshot fallback
  const zoom = interpolate(frame, [0, durationInFrames], [1.0, 1.05], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Fast "punch" settle at the cut — same technique as TeaserBrollScene.
  const punch      = spring({ frame, fps, from: 0, to: 1, config: { damping: 20, stiffness: 210, mass: 0.6 } });
  const punchScale = interpolate(punch, [0, 1], [1.06, 1]);

  const chipEnter = spring({ frame: Math.max(0, frame - 8), fps, from: 0, to: 1, config: { damping: 18, stiffness: 70 } });
  const chipY     = interpolate(chipEnter, [0, 1], [14, 0]);

  const hasRecording = !!recordingPath;
  const imgSrc = screenshotPath.replace(/\\/g, '/');
  const vidSrc = recordingPath ? recordingPath.replace(/\\/g, '/') : '';

  return (
    <AbsoluteFill style={{ background: '#0a0f1a', fontFamily: FONT_STACK, overflow: 'hidden' }}>

      <div style={{ width: '100%', height: '100%', transform: `scale(${punchScale})` }}>
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

      {caption && (
        <div style={{
          position: 'absolute', bottom: 40, left: 40,
          opacity: chipEnter, transform: `translateY(${chipY}px)`,
          background: 'rgba(10,15,26,0.72)', backdropFilter: 'blur(6px)',
          border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999,
          padding: '9px 20px', pointerEvents: 'none',
        }}>
          <span style={{ color: '#ffffff', fontSize: 19, fontWeight: 600, letterSpacing: '-0.1px' }}>
            {caption}
          </span>
        </div>
      )}

    </AbsoluteFill>
  );
};
