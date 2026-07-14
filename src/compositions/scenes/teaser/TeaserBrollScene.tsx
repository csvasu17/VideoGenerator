/**
 * TeaserBrollScene — full-bleed stock B-roll video with an optional text card.
 *
 * Reuses the video + gradient-scrim technique from EnterpriseBRollVideoScene,
 * but supports three text layouts instead of one:
 *   'hook'    — bold single-line headline, bottom-left, underline accent (cold open).
 *   'benefit' — left-aligned vertical accent bar + headline + up to 3 uppercase
 *               value words (mid-teaser benefit statement).
 *   'plain'   — no text overlay, a pure breathing beat between other scenes.
 *
 * No whole-frame fade in/out: the reference video cuts hard between beats
 * (confirmed by direct frame-by-frame inspection — no dip-to-black at any cut),
 * so scenes render at full opacity from frame 0 and cut instantly. Instead the
 * footage itself gets a fast "punch" settle (slight zoom-in easing to 1.0 over
 * ~9 frames) so the cut still reads as a deliberate transition, not a static
 * jump — cheap and memory-safe since it's a transform on the single already-
 * active scene, not an overlapping cross-dissolve of two decoders at once.
 */

import React from 'react';
import {
  AbsoluteFill,
  OffthreadVideo,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { FONT_STACK } from '../../tokens';
import type { TeaserBrollMode } from '../../../core/domain/entities/RemotionPackage';

export interface TeaserBrollSceneProps {
  videoPath?:       string;
  mode:             TeaserBrollMode;
  headline?:        string;
  benefitHeadline?: string;
  benefitWords?:    string[];
}

export const TeaserBrollScene: React.FC<TeaserBrollSceneProps> = ({
  videoPath,
  mode,
  headline,
  benefitHeadline,
  benefitWords,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const textEnter = spring({ frame: Math.max(0, frame - 10), fps, from: 0, to: 1, config: { damping: 18, stiffness: 60 } });
  const textY     = interpolate(textEnter, [0, 1], [22, 0]);

  // Fast "punch" settle on the footage at every cut — a quick zoom-in-to-1.0
  // snap (no fade) so cuts still read as a deliberate transition.
  const punch      = spring({ frame, fps, from: 0, to: 1, config: { damping: 20, stiffness: 210, mass: 0.6 } });
  const punchScale = interpolate(punch, [0, 1], [1.07, 1]);

  return (
    <AbsoluteFill style={{ fontFamily: FONT_STACK, overflow: 'hidden', background: '#0a0f1a' }}>

      {videoPath && (
        <div style={{ width: '100%', height: '100%', transform: `scale(${punchScale})` }}>
          <OffthreadVideo
            src={staticFile(videoPath)}
            volume={0}
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
          />
        </div>
      )}

      {/* Dark scrim so text stays readable regardless of footage brightness */}
      <div style={{
        position: 'absolute', inset: 0,
        background: mode === 'benefit'
          ? 'linear-gradient(105deg, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.42) 42%, rgba(0,0,0,0.12) 70%)'
          : 'linear-gradient(to bottom, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.08) 45%, rgba(0,0,0,0.70) 100%)',
        pointerEvents: 'none',
      }} />

      {mode === 'hook' && headline && (
        <div style={{
          position: 'absolute', left: 80, right: 80, bottom: 90,
          opacity: textEnter, transform: `translateY(${textY}px)`, pointerEvents: 'none',
        }}>
          <p style={{
            color: '#ffffff', fontSize: 56, fontWeight: 700, lineHeight: 1.15,
            letterSpacing: '-0.8px', margin: 0, textShadow: '0 2px 20px rgba(0,0,0,0.7)',
          }}>
            {headline}
          </p>
          <div style={{ width: 56, height: 4, borderRadius: 2, background: '#0a93d3', marginTop: 16, opacity: textEnter }} />
        </div>
      )}

      {mode === 'benefit' && benefitHeadline && (
        <div style={{
          position: 'absolute', left: 90, top: '50%', maxWidth: 900,
          transform: `translateY(calc(-50% + ${textY}px))`, opacity: textEnter, pointerEvents: 'none',
          display: 'flex', gap: 22,
        }}>
          <div style={{ width: 4, borderRadius: 2, background: 'linear-gradient(to bottom, #0a93d3, #059669)', flexShrink: 0 }} />
          <div>
            <p style={{
              color: '#ffffff', fontSize: 44, fontWeight: 700, lineHeight: 1.2,
              letterSpacing: '-0.6px', margin: 0, textShadow: '0 2px 20px rgba(0,0,0,0.7)',
            }}>
              {benefitHeadline}
            </p>
            {benefitWords && benefitWords.length > 0 && (
              <p style={{
                marginTop: 14, marginBottom: 0, color: 'rgba(255,255,255,0.68)',
                fontSize: 17, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase',
              }}>
                {benefitWords.join('.  ')}.
              </p>
            )}
          </div>
        </div>
      )}

    </AbsoluteFill>
  );
};
