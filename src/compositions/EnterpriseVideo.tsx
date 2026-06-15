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
import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion';
import { EnterpriseBRollScene }     from './scenes/enterprise/EnterpriseBRollScene';
import { EnterpriseProductScene }   from './scenes/enterprise/EnterpriseProductScene';
import { EnterpriseBenefitSlide }   from './scenes/enterprise/EnterpriseBenefitSlide';
import { EnterprisePresenterClose } from './scenes/enterprise/EnterprisePresenterClose';
import type {
  EnterpriseBRollSceneData,
  EnterpriseBenefitSlideData,
  EnterprisePresenterCloseData,
  EnterprisePresenterConfig,
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
  brollScenes:    EnterpriseBRollSceneData[];
  scenes:         SceneData[];
  benefitSlide:   EnterpriseBenefitSlideData;
  presenterClose: EnterprisePresenterCloseData;
  presenterConfig: EnterprisePresenterConfig;
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
}) => {
  const frame      = useCurrentFrame();
  const brollCount = brollScenes.length;

  return (
    <AbsoluteFill style={{ background: '#ffffff' }}>

      {/* ── Act 1: B-roll problem scenes — only mount the active one ─────── */}
      {brollScenes.map((broll, i) => {
        if (!isActive(frame, broll.from, broll.durationInFrames)) return null;
        return (
          <Sequence key={broll.id} from={broll.from} durationInFrames={broll.durationInFrames}>
            <EnterpriseBRollScene
              subtitle={broll.subtitle}
              category={broll.category}
              index={i}
              total={brollCount}
            />
          </Sequence>
        );
      })}

      {/* ── Act 2: Product demo scenes — only mount the active one ──────── */}
      {scenes.map(scene => {
        if (!isActive(frame, scene.from, scene.durationInFrames)) return null;
        return (
          <Sequence key={scene.id} from={scene.from} durationInFrames={scene.durationInFrames}>
            <EnterpriseProductScene
              screenshotPath={scene.screenshotPath}
              recordingPath={scene.recordingPath}
              title={scene.title}
              salesHook={scene.salesHook}
              narration={scene.narration}
              presenterSrc={presenterConfig.src}
              presenterWidthFraction={presenterConfig.widthFraction}
            />
          </Sequence>
        );
      })}

      {/* ── Act 3: Benefit slide — only mount when active ────────────────── */}
      {isActive(frame, benefitSlide.from, benefitSlide.durationInFrames) && (
        <Sequence from={benefitSlide.from} durationInFrames={benefitSlide.durationInFrames}>
          <EnterpriseBenefitSlide
            title={benefitSlide.title}
            bullets={benefitSlide.bullets}
            presenterSrc={presenterConfig.src}
            presenterWidthFraction={presenterConfig.widthFraction}
          />
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

    </AbsoluteFill>
  );
};
