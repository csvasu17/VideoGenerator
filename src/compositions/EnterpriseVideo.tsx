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
}) => {
  const frame      = useCurrentFrame();
  const { fps }    = useVideoConfig();
  const brollCount = brollScenes.length;

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
        return (
          <Sequence key={scene.id} from={scene.from} durationInFrames={scene.durationInFrames}>
            <EnterpriseProductScene
              screenshotPath={scene.screenshotPath}
              recordingPath={scene.recordingPath}
              title={scene.title}
              salesHook={scene.salesHook}
              narration={scene.narration}
              presenterSrc={presenterConfig.src}
              presenterVideoSrc={presenterConfig.videoSrc}
              presenterWidthFraction={presenterConfig.widthFraction}
              voiceSyncOffsetFrames={voiceSyncOffsetFrames}
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
                presenterSrc={presenterConfig.src}
                presenterVideoSrc={presenterConfig.videoSrc}
                presenterWidthFraction={presenterConfig.widthFraction}
                voiceSyncOffsetFrames={benefitVoiceOffset}
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
              src={staticFile(`voice-segments/${seg.id}.mp3`)}
              volume={1}
            />
          </Sequence>
        ))
      }

      {/* ── ACL Digital logo — persistent top-right overlay on every frame ── */}
      <div style={{
        position: 'absolute', top: 24, right: 32,
        pointerEvents: 'none', zIndex: 100,
      }}>
        <Img
          src={staticFile('assets/acl-logo.png')}
          style={{ width: 180, height: 'auto', display: 'block' }}
        />
      </div>

    </AbsoluteFill>
  );
};
