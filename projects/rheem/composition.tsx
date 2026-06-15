/**
 * projects/rheem/composition.tsx — Rheem cinematic sales demo.
 *
 * Narrative structure — outcome-first:
 *   CLAIM (StoryMoment) -> EVIDENCE (ProductDemoScene) -> PROOF (MicroClaim)
 *
 *  [HOOK]   A rooftop unit failed. Nobody knew.
 *  INTRO
 *  Ch 01 VISIBILITY -> [27 Devices.] -> TotalView / Dashboard / Sites
 *  Ch 02 MONITORING -> [RTU F202401391] -> Alarms / Device Detail
 *  Ch 03 PREDICTION -> [72 Hours.] -> AI Predict   <-- hero
 *  Ch 04 ACTION     -> [Simulate First.] -> Simulator / Users
 *  KPI + OUTRO
 */

import React from 'react';
import {AbsoluteFill, Sequence, Audio} from 'remotion';
import {CaptionComponent} from '../../core/components/CaptionComponent';
import {BrandingEngine}    from '../../core/branding/BrandingEngine';
import {NarrativeHook}     from '../../core/scenes/NarrativeHook';
import {StoryMoment}       from '../../core/scenes/StoryMoment';
import {SharedIntro}       from '../../core/scenes/SharedIntro';
import {SharedOutro}       from '../../core/scenes/SharedOutro';
import {ProductDemoScene}  from '../../core/scenes/ProductDemoScene';
import {ChapterCard}       from '../../core/scenes/ChapterCard';
import {MicroClaim}        from '../../core/scenes/MicroClaim';
import {KPIScene}          from '../../core/scenes/KPIScene';
import {FeatureProof}      from '../../src/scenes/FeatureProof';
import {rheemProject}      from './config/project.config';
import clipManifest        from './clipManifest.json';
import {SEGMENT_DEFS}      from './config/segmentDefs';
import type {ResolvedSegment} from '../../automation/types';
import type {DemoSegment}     from '../../core/scenes/ProductDemoScene';
import type {MicroClaimProps} from '../../core/scenes/MicroClaim';
import type {StoryMomentProps} from '../../core/scenes/StoryMoment';

// --- Types -------------------------------------------------------------------
interface ClipOverride { durationInFrames: number; startFrom: number; }
interface ZoomRegionDef {
  startFrame: number; endFrame: number;
  x: number; y: number; width: number; height: number;
  label?: string;
}

// --- Clip-level overrides — show the DATA POINT, not the whole screen --------
// IMPORTANT: ai-predict recording (public/projects/rheem/recordings/ai-predict.mp4)
// only captured the login page (8s, 482 frames). This clip MUST be re-recorded to
// show the actual AI Prediction dashboard. Until then, it shows the branded login page.
// To re-record: npm run record:rheem -- and ensure the automation navigates to the AI page.
const CLIP_OVERRIDES: Record<string, ClipOverride> = {
  'rheem-totalview': { durationInFrames: 180, startFrom:  60 },  //  3.0s
  'dashboard':       { durationInFrames: 300, startFrom:  30 },  //  5.0s
  'alarms':          { durationInFrames: 270, startFrom:  30 },  //  4.5s
  'device-detail':   { durationInFrames: 270, startFrom: 480 },  //  4.5s — skip fleet list (0-8s), start at RTU telemetry detail
  'ai-predict':      { durationInFrames: 420, startFrom:  60 },  //  7.0s — recording only has login page (482f total); re-record needed
  'simulator':       { durationInFrames: 240, startFrom:  30 },  //  4.0s
};

// Zoom regions disabled — all clips show full screen at 1:1 scale
const ZOOM_REGIONS: Record<string, ZoomRegionDef[]> = {};

// --- Click highlights — ripple effect on key interactions --------------------
// frame: clip-relative (0-based). x,y: 1920x1080 viewport coordinates.
// These fire the orange ripple from ScreenShowcase at the exact frame.
const CLICK_HIGHLIGHTS: Record<string, Array<{frame:number; x:number; y:number; label?:string}>> = {
  'alarms': [
    {frame:  95, x:  960, y: 178, label: 'Critical fault selected'},
  ],
  'device-detail': [
    // RTU F202401367 detail: alerts section (lower-left), then comfort panel (center-right)
    {frame:  80, x:  420, y: 760, label: 'Fault alert triggered'},
    {frame: 180, x:  960, y: 480, label: 'Live telemetry active'},
  ],
  // 'ai-predict': [] — re-add after recording is fixed to show the AI prediction dashboard
  'simulator': [
    {frame:  95, x:  960, y: 225, label: 'Run simulation'},
  ],
};

// --- Sales copy per segment — Claim -> Proof copy ---------------------------
const SUBTITLES: Record<string, string> = {
  'rheem-totalview': '"27 devices. 6 sites. All connected. All live. Right now."',
  'dashboard':       '"Every KPI. Every site. One command center."',
  'sites':           '"6 sites. 15 buildings. All connected."',
  'alarms':          '"RTU F202401391 — floor 3 comfort breach — surfaced before you heard about it."',
  'device-detail':   '"Temperature spiking. One click. Resolved remotely."',
  'ai-predict':      '"This failure was predicted 72 hours before it happened."',
  'simulator':       '"Simulate the failure scenario first. Zero risk to live systems."',
  'users':           '"Every role. Every permission. Enterprise-grade access control."',
  'settings':        '"One configuration. Scales to thousands of devices."',
  'insights':        '"Operational patterns across 27 devices. Instant decisions."',
};

// --- Story groups ------------------------------------------------------------
interface GroupDef {
  counter: string; eyebrow: string; headline: string; subline: string;
  accent: 'blue'|'orange'; clips: readonly string[];
  hero?: boolean; backgroundVariant?: 'default'|'intense';
  storyMoment?: StoryMomentProps;
  micro: MicroClaimProps | null;
}

const GROUPS: GroupDef[] = [
  {
    counter: '01 / 04', eyebrow: 'Visibility',
    headline: 'Your entire fleet.\nAt a glance.',
    subline: '6 enterprise sites · 27 connected devices · One command center',
    accent: 'blue',
    clips: ['rheem-totalview', 'dashboard'],
    storyMoment: { eyebrow: 'TOTAL VISIBILITY', headline: '27 Devices.', sub: '6 sites. One screen. Always on.', accent: 'blue' },
    micro: { line1: 'Real-time visibility.', line2: 'Zero blind spots.', stat: '6 sites · 27 devices · Always on', accent: 'blue' },
  },
  {
    counter: '02 / 04', eyebrow: 'Fault Detection',
    headline: 'Fault detected.\nAlready resolved.',
    subline: 'Critical alerts surface instantly · Remote diagnostics · Zero delays',
    accent: 'orange',
    clips: ['alarms', 'device-detail'],
    storyMoment: { eyebrow: 'CRITICAL FAULT', headline: 'RTU F202401391', sub: 'Floor 3. Comfort threshold exceeded.', accent: 'orange' },
    micro: { line1: 'Fault detected.', line2: 'Fixed remotely.', stat: '60% faster resolution · Critical alerts · Remote control', accent: 'orange' },
  },
  {
    counter: '03 / 04', eyebrow: 'AI Prediction',
    headline: 'Before the\nfailure happens.',
    subline: '72-hour advance warning · Zero surprises · Full confidence',
    accent: 'blue',
    clips: ['ai-predict'],
    hero: true, backgroundVariant: 'intense',
    storyMoment: { eyebrow: 'AI PREDICTED', headline: '72 Hours.', sub: 'Before the failure occurred.', accent: 'blue' },
    micro: { line1: "Tomorrow's failure.", line2: 'Known today.', stat: '72h advance warning · Zero surprises · Full confidence', accent: 'blue' },
  },
  {
    counter: '04 / 04', eyebrow: 'Action',
    headline: 'Test every scenario.\nDeploy with certainty.',
    subline: 'Zero-risk simulation · Enterprise RBAC · Every decision de-risked',
    accent: 'orange',
    clips: ['simulator'],
    storyMoment: { eyebrow: 'ZERO RISK', headline: 'Simulate First.', sub: 'Test before you deploy. No surprises.', accent: 'orange' },
    micro: { line1: 'Every decision,', line2: 'de-risked.', stat: 'Simulate before deploy · Enterprise RBAC · Full control', accent: 'orange' },
  },
];

// --- Durations ---------------------------------------------------------------
// Target: exactly 5400 frames = 90.0 seconds @ 60fps
// HOOK(180) + INTRO(120) + Ch01(960) + Ch02(1020) + Ch03(1170) + Ch04(720)
//   + FeatureProof(210) + KPI(600) + OUTRO(420) = 5400 ✓
const HOOK_DUR          = 180;  //  3.0s
const INTRO_DUR         = 120;  //  2.0s  — trimmed from 5s; no brand filler, get to product fast
const CHAPTER_DUR       = 180;  //  3.0s
const CHAPTER_HERO_DUR  = 270;  //  4.5s  — AI chapter is the hero, gets full room
const STORY_DUR         = 150;  //  2.5s
const MICRO_DUR         = 150;  //  2.5s
const FEATURE_PROOF_DUR = 210;  //  3.5s  — moved to pre-KPI as capability summary
const KPI_DUR           = 600;  // 10.0s  — numbers need time to land
const OUTRO_DUR         = 420;  //  7.0s

// --- Helpers -----------------------------------------------------------------
const manifSegs = (clipManifest.segments ?? []) as ResolvedSegment[];

function idToLabel(id: string): string {
  return id.split(/[-_]/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function buildGroupSegs(clipIds: readonly string[]): DemoSegment[] {
  let cursor = 0;
  const segs: DemoSegment[] = [];

  for (const id of clipIds) {
    const ms       = manifSegs.find(s => s.id === id);
    const def      = SEGMENT_DEFS.find(d => d.id === id);
    const override = CLIP_OVERRIDES[id];

    const dur       = override?.durationInFrames ?? ms?.durationInFrames ?? Math.ceil(8 * 60);
    const startFrom = override?.startFrom ?? 0;

    segs.push({
      id,
      startFrame: cursor, endFrame: cursor + dur,
      title:    ms?.label    || def?.label    || idToLabel(id),
      subtitle: SUBTITLES[id] || ms?.subtitle  || def?.subtitle,
      src:      ms?.resolvedClip?.file,
      startFrom,
      accent:   (ms?.accent || def?.accent || 'blue') as 'blue'|'orange',
      zoomRegions:     ZOOM_REGIONS[id]     ?? [],
      clickHighlights: CLICK_HIGHLIGHTS[id] ?? [],
    });
    cursor += dur;
  }
  return segs;
}

// --- Timeline builder --------------------------------------------------------
interface Block {
  type:   'hook'|'intro'|'chapter'|'story'|'demo'|'micro'|'kpi'|'outro'|'featureproof';
  from:   number; dur: number;
  chapter?:    GroupDef;
  story?:      StoryMomentProps;
  segs?:       DemoSegment[];
  segIdxBase?: number;
  micro?:      MicroClaimProps | null;
}

function buildTimeline(): {blocks: Block[]; total: number} {
  const blocks: Block[] = [];
  let cursor = 0;
  let globalIdx = 0;

  function add(b: Omit<Block,'from'>) { blocks.push({...b, from:cursor}); cursor += b.dur; }

  add({type:'hook',  dur:HOOK_DUR});
  add({type:'intro', dur:INTRO_DUR});

  for (let gi = 0; gi < GROUPS.length; gi++) {
    const g = GROUPS[gi];
    const chapterDur = g.hero ? CHAPTER_HERO_DUR : CHAPTER_DUR;
    add({type:'chapter', dur:chapterDur, chapter:g as any});

    if (g.storyMoment) {
      add({type:'story', dur:STORY_DUR, story:g.storyMoment});
    }

    const segs     = buildGroupSegs(g.clips);
    const groupDur = segs.reduce((s,seg) => s + (seg.endFrame - seg.startFrame), 0);
    add({type:'demo', dur:groupDur, segs, segIdxBase:globalIdx});
    globalIdx += g.clips.length;

    if (g.micro) {
      add({type:'micro', dur:MICRO_DUR, micro:g.micro});
    }
  }

  // FeatureProof BEFORE KPI — acts as capability summary bridge into the numbers
  add({type:'featureproof', dur:FEATURE_PROOF_DUR});
  add({type:'kpi',   dur:KPI_DUR});
  add({type:'outro', dur:OUTRO_DUR});

  return {blocks, total:cursor};
}

const {blocks, total} = buildTimeline();
export const totalFrames = total;
const p = rheemProject;

// --- Composition -------------------------------------------------------------
export const RheemDemo: React.FC = () => {
  const CROSS_MAP: Record<string, number> = {
    hook:         20,
    intro:        30,
    chapter:      22,
    story:        16,
    demo:         32,
    micro:        18,
    featureproof: 22,
    kpi:          28,
    outro:        32,
  };
  const crossFor = (type: string) => CROSS_MAP[type] ?? 20;

  return (
    <BrandingEngine project={p}>
      <AbsoluteFill style={{background:'#000'}}>

        {/* ── Audio layer — add files to project.config media field ── */}
        {p.media?.backgroundMusic && (
          <Audio src={p.media.backgroundMusic} volume={p.media.musicVolume ?? 0.25} />
        )}
        {p.media?.voiceover && (
          <Audio src={p.media.voiceover} volume={p.media.voiceoverVolume ?? 1.0} />
        )}

        {/* ── Burned-in captions — add entries to project.config captions field ── */}
        {p.captions?.map((cap, idx) => (
          <Sequence key={'cap-' + idx} from={cap.startFrame} durationInFrames={cap.endFrame - cap.startFrame}>
            <CaptionComponent
              captions={[{startFrame:0, endFrame: cap.endFrame - cap.startFrame, text:cap.text, speaker:cap.speaker}]}
              position="bottom"
            />
          </Sequence>
        ))}

        {blocks.map((b, i) => {
          const prevCross = i > 0               ? Math.min(crossFor(b.type), crossFor(blocks[i-1].type)) : 0;
          const nextCross = i < blocks.length-1 ? Math.min(crossFor(b.type), crossFor(blocks[i+1].type)) : 0;

          const seqFrom = b.from - prevCross;
          const seqDur  = b.dur  + prevCross + nextCross;

          if (b.type === 'hook') return (
            <Sequence key={i} from={seqFrom} durationInFrames={seqDur}>
              <NarrativeHook
                line1={p.hook?.line1}
                line2={p.hook?.line2}
                line3={p.hook?.line3}
              />
            </Sequence>
          );

          if (b.type === 'intro') return (
            <Sequence key={i} from={seqFrom} durationInFrames={seqDur}>
              <SharedIntro product={p.product}/>
            </Sequence>
          );

          if (b.type === 'chapter' && b.chapter) return (
            <Sequence key={i} from={seqFrom} durationInFrames={seqDur}>
              <ChapterCard
                headline={b.chapter.headline}
                subline={b.chapter.subline}
                accent={b.chapter.accent}
                counter={b.chapter.counter}
                eyebrow={b.chapter.eyebrow}
                hero={b.chapter.hero}
                backgroundVariant={b.chapter.backgroundVariant}
              />
            </Sequence>
          );

          if (b.type === 'story' && b.story) return (
            <Sequence key={i} from={seqFrom} durationInFrames={seqDur}>
              <StoryMoment
                eyebrow={b.story.eyebrow}
                headline={b.story.headline}
                sub={b.story.sub}
                accent={b.story.accent}
              />
            </Sequence>
          );

          if (b.type === 'demo' && b.segs) return (
            <Sequence key={i} from={seqFrom} durationInFrames={seqDur}>
              <ProductDemoScene segments={b.segs} firstSegIndex={b.segIdxBase}/>
            </Sequence>
          );

          if (b.type === 'micro' && b.micro) return (
            <Sequence key={i} from={seqFrom} durationInFrames={seqDur}>
              <MicroClaim
                line1={b.micro.line1}
                line2={b.micro.line2}
                stat={b.micro.stat}
                accent={b.micro.accent}
              />
            </Sequence>
          );

          if (b.type === 'featureproof') return (
            <Sequence key={i} from={seqFrom} durationInFrames={seqDur}>
              <FeatureProof accent="blue" />
            </Sequence>
          );

          if (b.type === 'kpi') return (
            <Sequence key={i} from={seqFrom} durationInFrames={seqDur}>
              <KPIScene metrics={p.kpiMetrics} />
            </Sequence>
          );

          if (b.type === 'outro') return (
            <Sequence key={i} from={seqFrom} durationInFrames={seqDur}>
              <SharedOutro
                product={p.product}
                contacts={[
                  {label:'', value: p.product.websiteUrl ?? 'rheem.com'},
                  {label:'Enterprise', value:'enterprise@rheem.com'},
                ]}
              />
            </Sequence>
          );

          return null;
        })}

      </AbsoluteFill>
    </BrandingEngine>
  );
};
