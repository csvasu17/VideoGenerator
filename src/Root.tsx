import React from 'react';
import {Composition, staticFile} from 'remotion';
import {DemoVideo} from './compositions/DemoVideo';
import type {DemoVideoProps} from './compositions/DemoVideo';
import {EnterpriseVideo} from './compositions/EnterpriseVideo';
import type {EnterpriseVideoProps} from './compositions/EnterpriseVideo';
import {TeaserVideo} from './compositions/TeaserVideo';
import type {TeaserVideoProps} from './compositions/TeaserVideo';
import {RoleTransitionCard} from './compositions/scenes/agent/RoleTransitionCard';
import type {RoleTransitionCardProps} from './compositions/scenes/agent/RoleTransitionCard';
import type {VoiceScript} from './core/domain/entities/RemotionPackage';
import {ConfigPage} from './compositions/ConfigPage';
import {RawVideoPlayback} from './compositions/RawVideoPlayback';
import type {RawVideoPlaybackProps} from './compositions/RawVideoPlayback';
import {getVideoMetadata} from '@remotion/media-utils';

// ─────────────────────────────────────────────────────────────────────────────
// Fallback props — used when out/localhost/demo-package.json is absent.
//
// Renders as a valid 8-second composition (opening card + closing card, no
// scenes) so Studio and render both degrade gracefully without crashing or
// triggering delayRender timeouts from broken screenshot paths.
//
// This value is ONLY active when the pipeline has never been run on this
// machine (fresh clone, CI cold-start, etc.). In all normal workflows the
// calculateMetadata function below replaces it with the live pipeline output.
// ─────────────────────────────────────────────────────────────────────────────

// Shared by the AgentRecordingVideo / ManualRecordingVideo compositions below —
// both just play back an already-assembled MP4 with no scene data of their
// own, so duration/dimensions have to be read from the file itself (video
// length varies per recording/upload, unlike the template-driven compositions
// above which get their duration from demo-package.json).
async function loadRawVideoMetadata(videoPath: string, emptyMessage: string, fps: number) {
  try {
    const meta = await getVideoMetadata(staticFile(videoPath));
    return {
      durationInFrames: Math.max(1, Math.round(meta.durationInSeconds * fps)),
      width:  Math.round(meta.width)  || 1920,
      height: Math.round(meta.height) || 1080,
      props: { videoPath, emptyMessage: '' } as RawVideoPlaybackProps,
    };
  } catch {
    // File doesn't exist yet (recording/upload never run on this machine) —
    // degrade to a short placeholder card instead of crashing Studio/render.
    return {
      durationInFrames: 90,
      width: 1920,
      height: 1080,
      props: { videoPath: '', emptyMessage } as RawVideoPlaybackProps,
    };
  }
}

const FALLBACK_PROPS: DemoVideoProps = {
  openingCard: {
    from:             0,
    durationInFrames: 90,
    title:            'ACL Digital Platform',
    subtitle:         'Run the pipeline to generate demo data.',
    backgroundColor:  '#1a1a2e',
  },
  scenes: [],
  closingCard: {
    from:             90,
    durationInFrames: 150,
    callToAction:     'Run the pipeline first',
    productName:      'ACL Digital Platform',
    backgroundColor:  '#1a1a2e',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// RemotionRoot
// ─────────────────────────────────────────────────────────────────────────────

export const RemotionRoot: React.FC = () => (
  <>
    {/*
      ── Config ─────────────────────────────────────────────────────────────────
      Interactive configuration form — fill in .env settings and launch the
      pipeline without leaving Remotion Studio.
      Requires the config API server: npm run config-ui (or npm run dev)
    */}
    {/*
      Registered at ConfigPage's actual native layout size (1280x800) — it used
      to be registered smaller (960x600) with an internal CSS scale-down, so
      "100%" zoom fit inside the preview pane alongside the side panels. That
      mismatch between registered size and real rendered size is what Studio's
      fullscreen mode rendered at native 1:1 pixel size, showing a small boxed
      canvas instead of filling the screen. "Fit" zoom handles any registered
      size correctly, so this only trades away 100%-zoom convenience on small
      windows in exchange for correct fullscreen behavior.
    */}
    <Composition
      id="Config"
      component={ConfigPage}
      durationInFrames={1}
      fps={30}
      width={1280}
      height={800}
    />

    {/*
      ── DemoVideo ──────────────────────────────────────────────────────────────
      Single source of truth: out/localhost/demo-package.json

      calculateMetadata runs inside Chromium (the Remotion renderer process),
      not in Node.js. Remotion always serves --public-dir files over HTTP so
      that Chromium can load them. fetch(staticFile('demo-package.json'))
      resolves to http://localhost:<PORT>/demo-package.json regardless of which
      port Remotion uses, and works identically in Studio and remotion render.

      Falls back to FALLBACK_PROPS if the file is missing or the fetch fails.

      Registered first so Remotion Studio opens this composition by default.
    */}
    <Composition
      id="DemoVideo"
      component={DemoVideo}
      durationInFrames={240}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={FALLBACK_PROPS}
      calculateMetadata={async () => {
        try {
          // Remotion serves --public-dir over HTTP so Chromium can reach it.
          // staticFile() returns the correct base-relative URL ('/demo-package.json')
          // which resolves to the Remotion dev-server root in both Studio and render.
          const response = await fetch(staticFile('demo-package.json'));
          if (!response.ok) {
            throw new Error(`demo-package.json fetch failed: HTTP ${response.status}`);
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pkg = await response.json() as any;

          // Normalise Windows backslash paths written by the pipeline on
          // Windows hosts so staticFile() URLs resolve correctly everywhere.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const scenes = (pkg.scenes ?? []).map((s: any) => ({
            ...s,
            screenshotPath:     String(s.screenshotPath     ?? '').replace(/\\/g, '/'),
            fullScreenshotPath: String(s.fullScreenshotPath ?? '').replace(/\\/g, '/'),
          }));

          // Phase 7 — optionally load motion-package.json for MotionPlan data.
          // Absent in Phase 6 pipelines; graceful fallback when missing.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let motionPlan: DemoVideoProps['motionPlan'];
          try {
            const motionResponse = await fetch(staticFile('motion-package.json'));
            if (motionResponse.ok) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const motionPkg = await motionResponse.json() as any;
              if (motionPkg?.motionPlan) {
                motionPlan = motionPkg.motionPlan;
              }
            }
          } catch {
            // motion-package.json is optional — Phase 6 fallback when absent.
          }

          // demo-package.json scenes carry extra fields (pageId, description,
          // nodeType) beyond the SceneData interface. These are harmless at
          // runtime; the type cast suppresses the TypeScript excess-property
          // error without losing any data used by the renderer.
          const loaded: DemoVideoProps = {
            openingCard: pkg.openingCard,
            scenes,
            closingCard: pkg.closingCard,
            ...(motionPlan !== undefined ? { motionPlan } : {}),
          } as unknown as DemoVideoProps;

          const durationInFrames =
            loaded.closingCard.from + loaded.closingCard.durationInFrames;
          return { props: loaded, durationInFrames };
        } catch {
          // File missing, fetch error, or malformed JSON — degrade gracefully.
          // Studio and render both continue with the fallback 8-second stub.
          const fallbackDuration =
            FALLBACK_PROPS.closingCard.from + FALLBACK_PROPS.closingCard.durationInFrames;
          return { props: FALLBACK_PROPS, durationInFrames: fallbackDuration };
        }
      }}
    />

    {/*
      ── EnterpriseVideo ────────────────────────────────────────────────────────
      Enterprise template: B-roll problem → product demo → benefit slide → presenter close.
      Data source: out/localhost/demo-package.json (meta.templateId === 'enterprise').
      Registered third — Studio shows DemoVideo by default.
    */}
    <Composition
      id="EnterpriseVideo"
      component={EnterpriseVideo}
      durationInFrames={240}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{
        brollScenes:    [],
        scenes:         [],
        benefitSlide:   { from: 90, durationInFrames: 900, title: 'Value Adds', bullets: [] },
        presenterClose: { from: 990, durationInFrames: 1020, tagline: 'Run the pipeline first', presenterSrc: 'assets/presenter/presenter-default.png' },
        presenterConfig:{ src: 'assets/presenter/presenter-default.png', widthFraction: 0.15, position: 'bottom-left' },
      } as EnterpriseVideoProps}
      calculateMetadata={async () => {
        try {
          const response = await fetch(staticFile('demo-package.json'));
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pkg = await response.json() as any;

          if (pkg?.meta?.templateId !== 'enterprise') {
            // demo-package.json was produced by the modern_saas pipeline — skip.
            throw new Error('demo-package.json is not an enterprise package');
          }

          // Normalise Windows backslash paths
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const scenes = (pkg.scenes ?? []).map((s: any) => ({
            ...s,
            screenshotPath:     String(s.screenshotPath     ?? '').replace(/\\/g, '/'),
            fullScreenshotPath: String(s.fullScreenshotPath ?? '').replace(/\\/g, '/'),
          }));

          // Also load voice-script.json so audio plays in Studio preview
          // and the script is editable via the Input Props panel.
          // Cache-bust with timestamp so voice-ready flag is always fresh after pipeline runs.
          let voiceScript: VoiceScript | undefined;
          try {
            const ts = Date.now();
            const vsRes = await fetch(staticFile('voice-script.json') + '?t=' + ts);
            if (vsRes.ok) {
              voiceScript = await vsRes.json() as VoiceScript;
              voiceScript.loadedAt = ts;
            }
          } catch { /* voice-script.json is optional */ }

          const loaded: EnterpriseVideoProps = {
            brollScenes:     pkg.brollScenes     ?? [],
            scenes,
            benefitSlide:    pkg.benefitSlide,
            presenterClose:  pkg.presenterClose,
            presenterConfig: pkg.presenterConfig,
            voiceScript,
            screenFit:       pkg.screenFit ?? 'full',
          } as unknown as EnterpriseVideoProps;

          const durationInFrames =
            loaded.presenterClose.from + loaded.presenterClose.durationInFrames;
          return { props: loaded, durationInFrames };
        } catch {
          // Not an enterprise package or file missing — degrade to 8-second stub.
          const stub: EnterpriseVideoProps = {
            brollScenes:    [],
            scenes:         [],
            benefitSlide:   { from: 90, durationInFrames: 900, title: 'Enterprise Demo', bullets: [] },
            presenterClose: { from: 990, durationInFrames: 1020, tagline: 'Run the pipeline with VIDEO_TEMPLATE=enterprise', presenterSrc: 'assets/presenter/presenter-default.png' },
            presenterConfig:{ src: 'assets/presenter/presenter-default.png', widthFraction: 0.15, position: 'bottom-left' },
          };
          return { props: stub, durationInFrames: 2010 };
        }
      }}
    />

    {/*
      ── ManualRecordingEnterpriseVideo ───────────────────────────────────────────
      Enterprise-shaped playback of a Manual Recording: same B-roll → product
      demo → benefit → presenter-close structure as EnterpriseVideo, but each
      product scene plays the user's own uploaded footage (recordingPath) instead
      of a Playwright-captured screenshot/clip.
      Data source: out/<slug>/manual-recording/demo-package.json +
      manual-recording/enterprise-voice-script.json — deliberately NOT the
      root-level demo-package.json (that belongs to the automated Enterprise
      pipeline and may already exist for this product).
      Produced by: automation/manual-recording-to-enterprise.ts
    */}
    <Composition
      id="ManualRecordingEnterpriseVideo"
      component={EnterpriseVideo}
      durationInFrames={240}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{
        brollScenes:    [],
        scenes:         [],
        benefitSlide:   { from: 90, durationInFrames: 900, title: 'Value Adds', bullets: [] },
        presenterClose: { from: 990, durationInFrames: 1020, tagline: 'Run manual-recording-to-enterprise.ts first', presenterSrc: '' },
        presenterConfig:{ src: '', widthFraction: 0, position: 'bottom-left' },
      } as EnterpriseVideoProps}
      calculateMetadata={async () => {
        try {
          const response = await fetch(staticFile('manual-recording/demo-package.json'));
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pkg = await response.json() as any;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const scenes = (pkg.scenes ?? []).map((s: any) => ({
            ...s,
            screenshotPath:     String(s.screenshotPath     ?? '').replace(/\\/g, '/'),
            fullScreenshotPath: String(s.fullScreenshotPath ?? '').replace(/\\/g, '/'),
            recordingPath:      s.recordingPath ? String(s.recordingPath).replace(/\\/g, '/') : undefined,
          }));

          let voiceScript: VoiceScript | undefined;
          try {
            const ts = Date.now();
            const vsRes = await fetch(staticFile('manual-recording/enterprise-voice-script.json') + '?t=' + ts);
            if (vsRes.ok) {
              voiceScript = await vsRes.json() as VoiceScript;
              voiceScript.loadedAt = ts;
            }
          } catch { /* voice script is optional */ }

          const loaded: EnterpriseVideoProps = {
            brollScenes:     pkg.brollScenes     ?? [],
            scenes,
            benefitSlide:    pkg.benefitSlide,
            presenterClose:  pkg.presenterClose,
            presenterConfig: pkg.presenterConfig,
            voiceScript,
            screenFit:       pkg.screenFit ?? 'full',
          } as unknown as EnterpriseVideoProps;

          const durationInFrames =
            loaded.presenterClose.from + loaded.presenterClose.durationInFrames;
          return { props: loaded, durationInFrames };
        } catch {
          const stub: EnterpriseVideoProps = {
            brollScenes:    [],
            scenes:         [],
            benefitSlide:   { from: 90, durationInFrames: 900, title: 'Value Adds', bullets: [] },
            presenterClose: { from: 990, durationInFrames: 1020, tagline: 'Run manual-recording-to-enterprise.ts first', presenterSrc: '' },
            presenterConfig:{ src: '', widthFraction: 0, position: 'bottom-left' },
          };
          return { props: stub, durationInFrames: 2010 };
        }
      }}
    />

    {/*
      ── TeaserVideo ────────────────────────────────────────────────────────────
      Teaser template: B-roll hook → real screen-recording feature montage →
      mid-benefit statement card → client app logo/tagline outro, with a short
      "quick overview" voiceover read over the beats plus background music.
      Data source: out/localhost/demo-package.json (meta.templateId === 'teaser')
      + voice-script.json.
      Registered fourth — Studio shows DemoVideo by default.
    */}
    <Composition
      id="TeaserVideo"
      component={TeaserVideo}
      durationInFrames={240}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{
        teaserBroll:    [],
        teaserFeatures: [],
        teaserOutro:    { from: 90, durationInFrames: 150, productName: 'Your Product', tagline: 'Run the pipeline first' },
      } as TeaserVideoProps}
      calculateMetadata={async () => {
        try {
          const response = await fetch(staticFile('demo-package.json'));
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pkg = await response.json() as any;

          if (pkg?.meta?.templateId !== 'teaser') {
            // demo-package.json was produced by a different template — skip.
            throw new Error('demo-package.json is not a teaser package');
          }

          // Normalise Windows backslash paths
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const teaserFeatures = (pkg.teaserFeatures ?? []).map((s: any) => ({
            ...s,
            screenshotPath: String(s.screenshotPath ?? '').replace(/\\/g, '/'),
          }));

          // Also load voice-script.json so narration plays in Studio preview
          // and the script is editable via the Input Props panel.
          // Cache-bust with timestamp so voice-ready flag is always fresh after pipeline runs.
          let voiceScript: VoiceScript | undefined;
          try {
            const ts = Date.now();
            const vsRes = await fetch(staticFile('voice-script.json') + '?t=' + ts);
            if (vsRes.ok) {
              voiceScript = await vsRes.json() as VoiceScript;
              voiceScript.loadedAt = ts;
            }
          } catch { /* voice-script.json is optional */ }

          const loaded: TeaserVideoProps = {
            teaserBroll:    pkg.teaserBroll ?? [],
            teaserFeatures,
            teaserOutro:    pkg.teaserOutro,
            teaserMusic:    pkg.teaserMusic,
            voiceScript,
          } as unknown as TeaserVideoProps;

          const durationInFrames =
            loaded.teaserOutro.from + loaded.teaserOutro.durationInFrames;
          return { props: loaded, durationInFrames };
        } catch {
          // Not a teaser package or file missing — degrade to an 8-second stub.
          const stub: TeaserVideoProps = {
            teaserBroll:    [],
            teaserFeatures: [],
            teaserOutro:    { from: 90, durationInFrames: 150, productName: 'Your Product', tagline: 'Run the pipeline with VIDEO_TEMPLATE=teaser' },
          };
          return { props: stub, durationInFrames: 240 };
        }
      }}
    />

    {/*
      ── RoleTransitionCard ─────────────────────────────────────────────────────
      Short title card rendered between each role's footage in the exhaustive
      Agent Recording walkthrough (automation/record-agent-exhaustive.ts).
      Props are supplied per-render via `--props=<json file>` — no calculateMetadata,
      no demo-package.json — this composition is used purely as a one-off renderer
      for a single short clip per role, not a full-package-driven template.
    */}
    <Composition
      id="RoleTransitionCard"
      component={RoleTransitionCard}
      durationInFrames={90}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{
        roleName: 'Role', roleIndex: 0, totalRoles: 1,
      } as RoleTransitionCardProps}
    />

    {/*
      ── AgentRecordingVideo ──────────────────────────────────────────────────
      Plays back the Config UI's "Agent Recording" output as-is (no scenes of
      our own) — out/<slug>/agent-recording/agent-walkthrough.mp4.
    */}
    <Composition
      id="AgentRecordingVideo"
      component={RawVideoPlayback}
      durationInFrames={90}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ videoPath: '', emptyMessage: 'Run Agent Recording once to see the walkthrough here.' } as RawVideoPlaybackProps}
      calculateMetadata={() => loadRawVideoMetadata(
        'agent-recording/agent-walkthrough.mp4',
        'Run Agent Recording once to see the walkthrough here.',
        30,
      )}
    />

    {/*
      ── ManualRecordingVideo ─────────────────────────────────────────────────
      Plays back the Config UI's "Manual Recording" assembled output as-is —
      out/<slug>/manual-recording/final-demo-video.mp4.
    */}
    <Composition
      id="ManualRecordingVideo"
      component={RawVideoPlayback}
      durationInFrames={90}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ videoPath: '', emptyMessage: 'Upload and process a Manual Recording once to see the result here.' } as RawVideoPlaybackProps}
      calculateMetadata={() => loadRawVideoMetadata(
        'manual-recording/final-demo-video.mp4',
        'Upload and process a Manual Recording once to see the result here.',
        30,
      )}
    />
  </>
);
