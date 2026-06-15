import React from 'react';
import {Composition, staticFile} from 'remotion';
import {RheemDemo, totalFrames} from '../projects/rheem/composition';
import {rheemProject} from '../projects/rheem/config/project.config';
import {DemoVideo} from './compositions/DemoVideo';
import type {DemoVideoProps} from './compositions/DemoVideo';
import {EnterpriseVideo} from './compositions/EnterpriseVideo';
import type {EnterpriseVideoProps} from './compositions/EnterpriseVideo';

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

          const loaded: EnterpriseVideoProps = {
            brollScenes:     pkg.brollScenes     ?? [],
            scenes,
            benefitSlide:    pkg.benefitSlide,
            presenterClose:  pkg.presenterClose,
            presenterConfig: pkg.presenterConfig,
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
