/**
 * AppFlowVideo — Remotion composition for the Full Application Flow template.
 *
 * Structure (matches automation/record-appflow-map.ts output):
 *   1. Intro        (appFlowIntro)         — full-map cascade reveal, depth-level waves
 *   2. Tour stops    (appFlowTourStops[])   — camera visits each depth-1 branch
 *   3. Detail dives  (appFlowDetailDives[]) — zoom + crossfade into a screen's field list
 *   4. Outro         (appFlowOutro)         — pull back, summary stats card
 *
 * A single canonical appFlowNodes[] tree is shared unchanged across every
 * phase (passed straight through to each scene), so the map is pixel-identical
 * throughout — no per-phase copies. Reads all data from demo-package.json +
 * voice-script.json via calculateMetadata in Root.tsx.
 *
 * Memory note: only the active phase's <Sequence> is mounted (isActive
 * gating, same as EnterpriseVideo/TeaserVideo), and only the active detail
 * dive ever decodes a screenshot — map/tour phases render nodes as flat
 * color-coded boxes, never <Img>.
 */

import React from 'react';
import { AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { ChatWidget } from './ChatWidget';
import { AppFlowIntroScene }    from './scenes/app-flow/AppFlowIntroScene';
import { AppFlowTourStopScene } from './scenes/app-flow/AppFlowTourStopScene';
import { AppFlowDetailScene }   from './scenes/app-flow/AppFlowDetailScene';
import { AppFlowOutroScene }    from './scenes/app-flow/AppFlowOutroScene';
import type {
  AppFlowNode,
  AppFlowIntroData,
  AppFlowTourStopData,
  AppFlowDetailDiveData,
  AppFlowOutroData,
  TeaserMusicConfig,
  VoiceScript,
} from '../core/domain/entities/RemotionPackage';

export interface AppFlowVideoProps {
  appFlowNodes:       AppFlowNode[];
  appFlowIntro:       AppFlowIntroData;
  appFlowTourStops:   AppFlowTourStopData[];
  appFlowDetailDives: AppFlowDetailDiveData[];
  appFlowOutro:       AppFlowOutroData;
  /** Reuses the teaser template's music config verbatim — same shape, same <Audio> mechanism. */
  appFlowMusic?:      TeaserMusicConfig;
  /** Loaded from voice-script.json. When present, each segment plays its MP3 from voiceDir/. */
  voiceScript?:       VoiceScript;
  [key: string]: unknown;
}

/** True when [frame] falls inside [from, from+dur). */
function isActive(frame: number, from: number, dur: number): boolean {
  return frame >= from && frame < from + dur;
}

export const AppFlowVideo: React.FC<AppFlowVideoProps> = ({
  appFlowNodes,
  appFlowIntro,
  appFlowTourStops,
  appFlowDetailDives,
  appFlowOutro,
  appFlowMusic,
  voiceScript,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const voiceDir = voiceScript?.voiceDir ?? 'voice-segments';

  return (
    <AbsoluteFill style={{ background: '#0a0f1a' }}>

      {/* ── Intro — full-map cascade reveal — only mount when active ── */}
      {isActive(frame, appFlowIntro.from, appFlowIntro.durationInFrames) && (
        <Sequence from={appFlowIntro.from} durationInFrames={appFlowIntro.durationInFrames}>
          <AppFlowIntroScene nodes={appFlowNodes} productName={appFlowIntro.productName} />
        </Sequence>
      )}

      {/* ── Tour stops — one per depth-1 branch — only mount the active one ── */}
      {appFlowTourStops.map(stop => {
        if (!isActive(frame, stop.from, stop.durationInFrames)) return null;
        return (
          <Sequence key={stop.id} from={stop.from} durationInFrames={stop.durationInFrames}>
            <AppFlowTourStopScene nodes={appFlowNodes} subtreeNodeIds={stop.subtreeNodeIds} caption={stop.caption} />
          </Sequence>
        );
      })}

      {/* ── Detail dives — field-list reveal — only mount the active one ── */}
      {appFlowDetailDives.map(dive => {
        if (!isActive(frame, dive.from, dive.durationInFrames)) return null;
        const node = appFlowNodes.find(n => n.id === dive.nodeId);
        if (!node) return null;
        return (
          <Sequence key={dive.id} from={dive.from} durationInFrames={dive.durationInFrames}>
            <AppFlowDetailScene nodes={appFlowNodes} node={node} />
          </Sequence>
        );
      })}

      {/* ── Outro — pull back + stats card — only mount when active ── */}
      {isActive(frame, appFlowOutro.from, appFlowOutro.durationInFrames) && (
        <Sequence from={appFlowOutro.from} durationInFrames={appFlowOutro.durationInFrames}>
          <AppFlowOutroScene
            productName={appFlowOutro.productName}
            tagline={appFlowOutro.tagline}
            screenCount={appFlowOutro.screenCount}
            fieldCount={appFlowOutro.fieldCount}
            logoPath={appFlowOutro.logoPath}
          />
        </Sequence>
      )}

      {/* ── Background music — optional, same mechanism as TeaserVideo ── */}
      {appFlowMusic && (
        <Audio
          src={staticFile(appFlowMusic.path)}
          volume={f => {
            const fadeInFrames  = Math.round(0.5 * fps);
            const fadeOutFrames = Math.round(appFlowMusic.fadeOutSec * fps);
            const fadeIn  = interpolate(f, [0, fadeInFrames], [0, appFlowMusic.volume], { extrapolateRight: 'clamp' });
            const fadeOut = interpolate(
              f,
              [durationInFrames - fadeOutFrames, durationInFrames],
              [appFlowMusic.volume, 0],
              { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
            );
            return Math.min(fadeIn, fadeOut);
          }}
        />
      )}

      {/* ── Voice narration — only when MP3s are confirmed on disk ───────────
           voiceReady is stamped by the pipeline after voice:only succeeds.
           Skipping this block avoids 404 crashes when voice hasn't been
           generated yet (e.g. immediately after a fresh crawl).            */}
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

    </AbsoluteFill>
  );
};
