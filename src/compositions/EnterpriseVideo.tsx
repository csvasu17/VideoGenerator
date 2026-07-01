/**
 * EnterpriseVideo — Remotion composition for the enterprise video template.
 *
 * Structure (matches EnterpriseRemotionExporter output):
 *   1. B-roll problem scenes (brollScenes[])  — dark, cinematic problem statements
 *   2. Product demo scenes  (scenes[])         — full-frame screenshots, presenter overlay
 *   3. Benefit slide        (benefitSlide)      — white, animated value bullets
 *   4. Presenter close      (presenterClose)    — white, full-screen presenter + tagline
 *
 * Reads all data from demo-package.json via calculateMetadata + inputProps.
 * The DemoVideo composition is not touched; this file is self-contained.
 *
 * Memory note: scenes are conditionally rendered (only the active scene is mounted).
 * This prevents all product screenshots from being decoded into RAM simultaneously
 * during B-roll, which caused Chrome OOM at 3900+ frames.
 */

import React from 'react';
import { AbsoluteFill, Audio, Img, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { PresenterOverlay, TalkingWindow } from './layers/PresenterOverlay';
import { EnterpriseBRollScene }        from './scenes/enterprise/EnterpriseBRollScene';
import { EnterpriseAnimatedBRoll }     from './scenes/enterprise/EnterpriseAnimatedBRoll';
import { EnterpriseBRollVideoScene }   from './scenes/enterprise/EnterpriseBRollVideoScene';
import { EnterpriseProductScene }      from './scenes/enterprise/EnterpriseProductScene';
import { EnterpriseBenefitSlide }      from './scenes/enterprise/EnterpriseBenefitSlide';
import { EnterprisePresenterClose }    from './scenes/enterprise/EnterprisePresenterClose';
import type {
  EnterpriseBRollSceneData,
  EnterpriseBenefitSlideData,
  EnterprisePresenterCloseData,
  EnterprisePresenterConfig,
  VoiceScript,
} from '../core/domain/entities/RemotionPackage';

// ─────────────────────────────────────────────────────────────────────────────
// Prop types (must extend Record<string, unknown> for Remotion's Composition)
// ─────────────────────────────────────────────────────────────────────────────

interface SceneData {
  id:                 string;
  from:               number;
  durationInFrames:   number;
  title:              string;
  narration:          string;
  salesHook:          string;
  screenshotPath:     string;
  fullScreenshotPath: string;
  recordingPath?:     string;  // real screen recording clip (mp4) — preferred over screenshot
  recordingStartSec?: number;  // seek offset into the flow video (seconds)
}

export interface EnterpriseVideoProps {
  brollScenes:     EnterpriseBRollSceneData[];
  scenes:          SceneData[];
  benefitSlide:    EnterpriseBenefitSlideData;
  presenterClose:  EnterprisePresenterCloseData;
  presenterConfig: EnterprisePresenterConfig;
  /**
   * Loaded from voice-script.json. When present, each segment plays its
   * corresponding MP3 file from voice-segments/ in Studio preview.
   * Editable live via the Remotion Studio Input Props panel (⌥P / the {} button).
   */
  voiceScript?:    VoiceScript;
  /**
   * 'fit'  — product screen rendered inset with padding and rounded corners.
   * 'full' — product screen fills the frame edge-to-edge (default).
   */
  screenFit?:      'fit' | 'full';
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** True when [frame] falls inside [from, from+dur). */
function isActive(frame: number, from: number, dur: number): boolean {
  return frame >= from && frame < from + dur;
}

// ─────────────────────────────────────────────────────────────────────────────
// EnterpriseVideo
// ─────────────────────────────────────────────────────────────────────────────

export const EnterpriseVideo: React.FC<EnterpriseVideoProps> = ({
  brollScenes,
  scenes,
  benefitSlide,
  presenterClose,
  presenterConfig,
  voiceScript,
  screenFit = 'full',
}) => {
  const frame      = useCurrentFrame();
  const { fps }    = useVideoConfig();
  const brollCount = brollScenes.length;

  // voiceDir controls which pre-generated audio folder to load MP3s from.
  // Change this in Studio Input Props (voiceScript.voiceDir) to switch voices live.
  const voiceDir   = voiceScript?.voiceDir ?? 'voice-segments';

  // When the presenter is a real talking video (.mp4/.webm) render it ONCE at
  // the composition level so it plays continuously across scene transitions.
  // Per-scene PresenterOverlay instances would re-run the entry animation on
  // every mount, causing visible blinking at every scene cut.
  const isDirectVideo = /\.(mp4|webm)$/i.test(presenterConfig.videoSrc ?? '');
  const firstSceneFrom    = scenes.length > 0 ? scenes[0].from : 0;
  const lastSceneEnd      = benefitSlide.from + benefitSlide.durationInFrames;
  const presenterDuration = lastSceneEnd - firstSceneFrom;

  // Convert voice-script segment times to presenter-local frames so
  // PresenterOverlay can show the talking animation only while narration plays.
  const presenterOffsetSec = firstSceneFrom / fps;
  const talkingWindows: TalkingWindow[] = (voiceScript?.segments ?? [])
    .map(seg => ({
      startFrame: Math.round((seg.startSec - presenterOffsetSec) * fps),
      endFrame:   Math.round((seg.startSec + seg.durationSec - presenterOffsetSec) * fps),
    }))
    .filter(w => w.endFrame > 0);

  return (
    <AbsoluteFill style={{ background: '#ffffff' }}>

      {/* ── Act 1: B-roll problem scenes — only mount the active one ─────── */}
      {brollScenes.map((broll, i) => {
        if (!isActive(frame, broll.from, broll.durationInFrames)) return null;
        return (
          <Sequence key={broll.id} from={broll.from} durationInFrames={broll.durationInFrames}>
            {broll.videoPath ? (
              /* Real stock video footage — preferred when downloaded */
              <EnterpriseBRollVideoScene
                videoPath={broll.videoPath}
                subtitle={broll.subtitle}
                index={i}
                total={brollCount}
              />
            ) : broll.animationType ? (
              /* Animated fallback if no video downloaded yet */
              <EnterpriseAnimatedBRoll
                animationType={broll.animationType as import('./scenes/enterprise/EnterpriseAnimatedBRoll').BRollAnimationType}
                subtitle={broll.subtitle}
                index={i}
                total={brollCount}
              />
            ) : (
              <EnterpriseBRollScene
                subtitle={broll.subtitle}
                category={broll.category}
                index={i}
                total={brollCount}
              />
            )}
          </Sequence>
        );
      })}

      {/* ── Act 2: Product demo scenes — only mount the active one ──────── */}
      {scenes.map(scene => {
        if (!isActive(frame, scene.from, scene.durationInFrames)) return null;
        // Calculate how many frames into the scene the voice narration starts,
        // so the presenter video starts lip-animating exactly when audio begins.
        const voiceSeg = voiceScript?.segments.find(s => s.id === scene.id);
        const voiceSyncOffsetFrames = voiceSeg
          ? Math.max(0, Math.round(voiceSeg.startSec * fps) - scene.from)
          : undefined;
        const voiceAudioSrc = voiceSeg ? `${voiceDir}/${voiceSeg.id}.mp3` : undefined;
        return (
          <Sequence key={scene.id} from={scene.from} durationInFrames={scene.durationInFrames}>
            <EnterpriseProductScene
              screenshotPath={scene.screenshotPath}
              recordingPath={scene.recordingPath}
              recordingStartSec={scene.recordingStartSec}
              title={scene.title}
              salesHook={scene.salesHook}
              narration={scene.narration}
              presenterSrc={isDirectVideo ? '' : presenterConfig.src}
              presenterVideoSrc={isDirectVideo ? undefined : presenterConfig.videoSrc}
              presenterWidthFraction={presenterConfig.widthFraction}
              voiceSyncOffsetFrames={voiceSyncOffsetFrames}
              voiceAudioSrc={voiceAudioSrc}
              mouthRegion={presenterConfig.mouthRegion}
              screenFit={screenFit}
            />
          </Sequence>
        );
      })}

      {/* ── Act 3: Benefit slide — only mount when active ────────────────── */}
      {isActive(frame, benefitSlide.from, benefitSlide.durationInFrames) && (
        <Sequence from={benefitSlide.from} durationInFrames={benefitSlide.durationInFrames}>
          {(() => {
            const benefitSeg = voiceScript?.segments.find(s => s.id === 'benefit-slide');
            const benefitVoiceOffset = benefitSeg
              ? Math.max(0, Math.round(benefitSeg.startSec * fps) - benefitSlide.from)
              : undefined;
            return (
              <EnterpriseBenefitSlide
                title={benefitSlide.title}
                bullets={benefitSlide.bullets}
                presenterSrc={isDirectVideo ? '' : presenterConfig.src}
                presenterVideoSrc={isDirectVideo ? undefined : presenterConfig.videoSrc}
                presenterWidthFraction={presenterConfig.widthFraction}
                voiceSyncOffsetFrames={benefitVoiceOffset}
                voiceAudioSrc={benefitSeg ? `${voiceDir}/${benefitSeg.id}.mp3` : undefined}
                mouthRegion={presenterConfig.mouthRegion}
              />
            );
          })()}
        </Sequence>
      )}

      {/* ── Act 4: Presenter close — only mount when active ──────────────── */}
      {isActive(frame, presenterClose.from, presenterClose.durationInFrames) && (
        <Sequence from={presenterClose.from} durationInFrames={presenterClose.durationInFrames}>
          <EnterprisePresenterClose
            tagline={presenterClose.tagline}
            presenterSrc={presenterClose.presenterSrc}
          />
        </Sequence>
      )}

      {/* ── Voice narration — one <Audio> per segment, timed to startSec ───── */}
      {voiceScript?.segments
        .filter(seg => seg.enabled !== false)
        .map(seg => (
          <Sequence
            key={seg.id}
            from={Math.round(seg.startSec * fps)}
            durationInFrames={Math.round(seg.durationSec * fps)}
          >
            <Audio
              src={staticFile(`${voiceDir}/${seg.id}.mp3`)}
              volume={1}
            />
          </Sequence>
        ))
      }

      {/* ── Persistent presenter overlay (direct-video mode only) ────────────
           Rendered here so the talking video plays without interruption across
           every scene transition.  Per-scene rendering is suppressed below.    */}
      {isDirectVideo && isActive(frame, firstSceneFrom, presenterDuration) && (
        <Sequence from={firstSceneFrom} durationInFrames={presenterDuration}>
          <PresenterOverlay
            src={presenterConfig.src}
            videoSrc={presenterConfig.videoSrc}
            widthFraction={presenterConfig.widthFraction ?? 0.15}
            position={presenterConfig.position ?? 'bottom-left'}
          />
        </Sequence>
      )}

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

    </AbsoluteFill>
  );
};
