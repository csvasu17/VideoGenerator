/**
 * TeaserVideo — Remotion composition for the teaser video template.
 *
 * Structure (matches automation/record-teaser-clips.ts output):
 *   1. B-roll cards (teaserBroll[])   — cold-open hook, breathing beat, mid-benefit statement
 *   2. Feature clips (teaserFeatures[]) — real product screen-recording montage
 *   3. Outro         (teaserOutro)     — client app's own logo/tagline reveal
 *
 * A short "quick overview" voiceover reads continuously over the B-roll/feature
 * beats (no presenter/talking-head, unlike EnterpriseVideo) — one MP3 segment
 * per beat, played as a native Remotion <Audio>, same mechanism EnterpriseVideo
 * uses for its narration. A single background-music track plays underneath at
 * constant low volume with a fade-out near the end. Reads all data from
 * demo-package.json + voice-script.json via calculateMetadata.
 *
 * Memory note: scenes are conditionally rendered (only the active scene is
 * mounted), same rationale as EnterpriseVideo — avoids decoding every clip's
 * video/image into RAM simultaneously.
 */

import React from 'react';
import { AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { ChatWidget } from './ChatWidget';
import { TeaserBrollScene }   from './scenes/teaser/TeaserBrollScene';
import { TeaserFeatureScene } from './scenes/teaser/TeaserFeatureScene';
import { TeaserOutroScene }   from './scenes/teaser/TeaserOutroScene';
import type {
  TeaserBrollCardData,
  TeaserFeatureSceneData,
  TeaserOutroData,
  TeaserMusicConfig,
  VoiceScript,
} from '../core/domain/entities/RemotionPackage';

export interface TeaserVideoProps {
  teaserBroll:    TeaserBrollCardData[];
  teaserFeatures: TeaserFeatureSceneData[];
  teaserOutro:    TeaserOutroData;
  teaserMusic?:   TeaserMusicConfig;
  /** Loaded from voice-script.json. When present, each segment plays its MP3 from voiceDir/. */
  voiceScript?:   VoiceScript;
  [key: string]: unknown;
}

/** True when [frame] falls inside [from, from+dur). */
function isActive(frame: number, from: number, dur: number): boolean {
  return frame >= from && frame < from + dur;
}

export const TeaserVideo: React.FC<TeaserVideoProps> = ({
  teaserBroll,
  teaserFeatures,
  teaserOutro,
  teaserMusic,
  voiceScript,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const voiceDir = voiceScript?.voiceDir ?? 'voice-segments';

  return (
    <AbsoluteFill style={{ background: '#0a0f1a' }}>

      {/* ── B-roll cards — hook / plain / benefit — only mount the active one ── */}
      {teaserBroll.map(broll => {
        if (!isActive(frame, broll.from, broll.durationInFrames)) return null;
        return (
          <Sequence key={broll.id} from={broll.from} durationInFrames={broll.durationInFrames}>
            <TeaserBrollScene
              videoPath={broll.videoPath}
              mode={broll.mode}
              headline={broll.headline}
              benefitHeadline={broll.benefitHeadline}
              benefitWords={broll.benefitWords}
            />
          </Sequence>
        );
      })}

      {/* ── Feature clips — real screen recordings — only mount the active one ── */}
      {teaserFeatures.map(scene => {
        if (!isActive(frame, scene.from, scene.durationInFrames)) return null;
        return (
          <Sequence key={scene.id} from={scene.from} durationInFrames={scene.durationInFrames}>
            <TeaserFeatureScene
              screenshotPath={scene.screenshotPath}
              recordingPath={scene.recordingPath}
              recordingStartSec={scene.recordingStartSec}
              caption={scene.caption}
            />
          </Sequence>
        );
      })}

      {/* ── Outro — client app logo/tagline reveal — only mount when active ── */}
      {isActive(frame, teaserOutro.from, teaserOutro.durationInFrames) && (
        <Sequence from={teaserOutro.from} durationInFrames={teaserOutro.durationInFrames}>
          <TeaserOutroScene
            productName={teaserOutro.productName}
            tagline={teaserOutro.tagline}
            logoPath={teaserOutro.logoPath}
          />
        </Sequence>
      )}

      {/* ── Background music — single track, fade in/out, no per-segment audio ── */}
      {teaserMusic && (
        <Audio
          src={staticFile(teaserMusic.path)}
          volume={f => {
            const fadeInFrames  = Math.round(0.5 * fps);
            const fadeOutFrames = Math.round(teaserMusic.fadeOutSec * fps);
            const fadeIn  = interpolate(f, [0, fadeInFrames], [0, teaserMusic.volume], { extrapolateRight: 'clamp' });
            const fadeOut = interpolate(
              f,
              [durationInFrames - fadeOutFrames, durationInFrames],
              [teaserMusic.volume, 0],
              { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
            );
            return Math.min(fadeIn, fadeOut);
          }}
        />
      )}

      {/* ── Voice narration — only when MP3s are confirmed on disk ───────────
           voiceReady is stamped by the pipeline after voice:only succeeds.
           Skipping this block avoids 404 crashes when voice hasn't been
           generated yet (e.g. immediately after a fresh recording run).    */}
      {voiceScript?.voiceReady && voiceScript.segments
        .filter(seg => seg.enabled !== false)
        .map(seg => (
          <Sequence
            key={seg.id}
            from={Math.round(seg.startSec * fps)}
            durationInFrames={Math.round(seg.durationSec * fps)}
          >
            <Audio
              src={staticFile(`${voiceDir}/${seg.id}.mp3`) + (voiceScript.loadedAt ? `?t=${voiceScript.loadedAt}` : '')}
              volume={1}
            />
          </Sequence>
        ))
      }

      {/* ── ACL Digital logo — transparent watermark, top-right corner ── */}
      <div style={{
        position:      'absolute',
        top:           20,
        right:         24,
        pointerEvents: 'none',
        zIndex:        200,
        lineHeight:    0,
      }}>
        <Img
          src={staticFile('assets/acl-logo.png')}
          style={{ width: 140, height: 'auto', display: 'block' }}
        />
      </div>

      {/* ── Studio-only chat widget — invisible in rendered video ────────── */}
      <ChatWidget />

      {/* ── Opening fade-in — the only fade in the whole video ───────────────
           Internal cuts between beats are instant (matches the reference —
           confirmed frame-by-frame, no dip-to-black at any cut). A brief
           fade from black at frame 0 is still standard practice so the video
           doesn't just snap into existence. */}
      <AbsoluteFill
        style={{
          background:    '#000000',
          opacity:       interpolate(frame, [0, 12], [1, 0], { extrapolateRight: 'clamp' }),
          pointerEvents: 'none',
        }}
      />

    </AbsoluteFill>
  );
};
