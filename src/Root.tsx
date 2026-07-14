import React from 'react';
import {Composition, staticFile} from 'remotion';
import {RheemDemo, totalFrames} from '../projects/rheem/composition';
import {rheemProject} from '../projects/rheem/config/project.config';
import {DemoVideo} from './compositions/DemoVideo';
import type {DemoVideoProps} from './compositions/DemoVideo';
import {EnterpriseVideo} from './compositions/EnterpriseVideo';
import type {EnterpriseVideoProps} from './compositions/EnterpriseVideo';
import {TeaserVideo} from './compositions/TeaserVideo';
import type {TeaserVideoProps} from './compositions/TeaserVideo';
import {AppFlowVideo} from './compositions/AppFlowVideo';
import type {AppFlowVideoProps} from './compositions/AppFlowVideo';
import {RoleTransitionCard} from './compositions/scenes/agent/RoleTransitionCard';
import type {RoleTransitionCardProps} from './compositions/scenes/agent/RoleTransitionCard';
import type {VoiceScript} from './core/domain/entities/RemotionPackage';
import {ConfigPage} from './compositions/ConfigPage';

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
      Registered smaller than the component's internal 1280x800 layout —
      ConfigPage renders that layout at full size into a fixed-size wrapper and
      scales it down with a CSS transform (see ConfigPage.tsx render root), so
      Remotion Studio's "100%" zoom has a real chance of fitting inside the
      preview pane alongside the Compositions/Props side panels. "Fit" always
      works regardless; this just makes 100% usable too on typical windows.
    */}
    <Composition
      id="Config"
      component={ConfigPage}
      durationInFrames={1}
      fps={30}
      width={960}
      height={600}
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
      ── AppFlowVideo ─────────────────────────────────────────────────────────
      Full Application Flow template: animated sitemap of the target app's
      entire screen tree (every screen, sub-screen) plus each screen's
      individual data fields — intro cascade → guided branch tour → per-screen
      field-list dives → outro stats card. Spoken narration over the beats
      plus optional background music.
      Data source: out/localhost/demo-package.json (meta.templateId === 'app_flow')
      + voice-script.json.
      Registered fifth — Studio shows DemoVideo by default.
    */}
    <Composition
      id="AppFlowVideo"
      component={AppFlowVideo}
      durationInFrames={240}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{
        appFlowNodes:       [],
        appFlowIntro:       { from: 0, durationInFrames: 90, productName: 'Your Product' },
        appFlowTourStops:   [],
        appFlowDetailDives: [],
        appFlowOutro:       { from: 90, durationInFrames: 150, productName: 'Your Product', screenCount: 0, fieldCount: 0 },
      } as AppFlowVideoProps}
      calculateMetadata={async () => {
        try {
          const response = await fetch(staticFile('demo-package.json'));
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pkg = await response.json() as any;

          if (pkg?.meta?.templateId !== 'app_flow') {
            // demo-package.json was produced by a different template — skip.
            throw new Error('demo-package.json is not an app_flow package');
          }

          // Normalise Windows backslash paths
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const appFlowNodes = (pkg.appFlowNodes ?? []).map((n: any) => ({
            ...n,
            screenshotPath: n.screenshotPath ? String(n.screenshotPath).replace(/\\/g, '/') : null,
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

          const loaded: AppFlowVideoProps = {
            appFlowNodes,
            appFlowIntro:       pkg.appFlowIntro,
            appFlowTourStops:   pkg.appFlowTourStops ?? [],
            appFlowDetailDives: pkg.appFlowDetailDives ?? [],
            appFlowOutro:       pkg.appFlowOutro,
            appFlowMusic:       pkg.appFlowMusic,
            voiceScript,
          } as unknown as AppFlowVideoProps;

          const durationInFrames =
            loaded.appFlowOutro.from + loaded.appFlowOutro.durationInFrames;
          return { props: loaded, durationInFrames };
        } catch {
          // Not an app_flow package or file missing — degrade to an 8-second stub.
          const stub: AppFlowVideoProps = {
            appFlowNodes:       [],
            appFlowIntro:       { from: 0, durationInFrames: 90, productName: 'Your Product' },
            appFlowTourStops:   [],
            appFlowDetailDives: [],
            appFlowOutro: {
              from: 90, durationInFrames: 150, productName: 'Your Product',
              screenCount: 0, fieldCount: 0, tagline: 'Run the pipeline with VIDEO_TEMPLATE=app_flow',
            },
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
      ── RheemDemo ──────────────────────────────────────────────────────────────
      Legacy cinematic sales demo driven by pre-recorded MP4 clips.
      Data source: projects/rheem/clipManifest.json (static, bundled).
      Registered last — Studio opens DemoVideo by default.
    */}
    <Composition
      id="RheemDemo"
      component={RheemDemo}
      durationInFrames={totalFrames}
      fps={rheemProject.fps}
      width={rheemProject.width}
      height={rheemProject.height}
      defaultProps={{}}
    />
  </>
);
