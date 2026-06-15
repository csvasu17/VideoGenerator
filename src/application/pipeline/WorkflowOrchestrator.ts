import { randomUUID } from 'crypto';
import type { PipelineRun, StageResult } from '../../core/domain/entities/PipelineRun';
import type { IScreenshotAgent } from '../../core/ports/agents/IScreenshotAgent';
import type { IVisionAnalysisAgent } from '../../core/ports/agents/IVisionAnalysisAgent';
import { createPipelineContext } from './PipelineContext';
import { runStage, type ProgressCallback } from './PipelineStage';
import { AuthStage }                 from './stages/AuthStage';
import { DiscoveryStage }            from './stages/DiscoveryStage';
import { GraphBuildingStage }        from './stages/GraphBuildingStage';
import { ScreenshotIntelligenceStage } from './stages/ScreenshotIntelligenceStage';
import { FeatureRankingStage }       from './stages/FeatureRankingStage';
import { JourneyGenerationStage }    from './stages/JourneyGenerationStage';
import { StoryboardStage }           from './stages/StoryboardStage';
import { RemotionExportStage }       from './stages/RemotionExportStage';
import type { RunInput, WorkflowInput } from './PipelineContext';
import { AuthAgent }                 from '../../agents/auth/AuthAgent';
import { SealedCredentials }         from '../../core/domain/entities/Credentials';
import { UrlValidator, UrlValidationError } from './UrlValidator';
import type { IBusinessValueAgent }       from '../../core/ports/agents/IBusinessValueAgent';
import { BusinessValueStage }             from './stages/BusinessValueStage';
import type { IContextExpansionAgent }    from '../../core/ports/agents/IContextExpansionAgent';
import { ContextExpansionStage }          from './stages/ContextExpansionStage';
import { ContextSignalValidationStage }   from './stages/ContextSignalValidationStage';
import { InPageDiscoveryStage }          from './stages/InPageDiscoveryStage';
import { MotionDirectionStage, buildMotionDirectionInput } from './stages/MotionDirectionStage';
import { DemoReadinessStage }           from './stages/DemoReadinessStage';
import { SalesStoryDirectorStage }         from './stages/SalesStoryDirectorStage';
import { InteractionReplayDirectorStage } from './stages/InteractionReplayDirectorStage';

// ─────────────────────────────────────────────────────────────────────────────
// Stage progress weights (must sum to 100)
// ─────────────────────────────────────────────────────────────────────────────

const STAGE_PROGRESS: Record<string, number> = {
  'Authentication':              5,
  'Context Expansion':           2,
  'Discovery':                  14,
  'Graph Building':              5,
  'Screenshot + Vision Analysis': 25,  // reduced by 10 to accommodate In-Page Discovery
  'In-Page Discovery':           10,   // browser-driven hidden-state exploration
  'Feature Ranking':             1,   // -1 to accommodate Sales Story (Phase 8)
  'Business Value Enrichment':   7,
  'Context Signal Validation':   3,
  'Demo Readiness':              3,   // new — filters pages before journey generation
  'Sales Story':                 2,   // Phase 8 — narrative arc construction
  'Interaction Replay Director': 2,   // Phase 9 — interaction replay plan
  'Journey Generation':          1,   // -1 to accommodate Phase 9 stage
  'Storyboard Generation':       5,   // -1 to accommodate Phase 9 stage
  'Remotion Export':             10,
  'Motion Direction':            5,
  // Total: 100
};

function progressAt(completedStage: string): number {
  const names = Object.keys(STAGE_PROGRESS);
  let total = 0;
  for (const name of names) {
    total += STAGE_PROGRESS[name];
    if (name === completedStage) break;
  }
  return total;
}

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowOrchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs the full demo-generation pipeline end to end:
 *
 *   Auth → Discovery → Graph → Screenshot+Vision → Feature Ranking
 *   → Journey → Storyboard → Remotion Export → demo-package.json
 *
 * Browser lifecycle:
 *   - Auth stage launches the browser and stores the live BrowserContext in ctx.
 *   - Screenshot+Vision stage consumes the context.
 *   - The orchestrator closes browser+context in a finally block — always.
 *
 * Error behaviour:
 *   - Any stage failure aborts the pipeline and updates PipelineRun.status.
 *   - The browser is ALWAYS closed regardless of success or failure.
 */
export class WorkflowOrchestrator {
  constructor(
    private readonly screenshotAgent:      IScreenshotAgent,
    private readonly visionAgent:          IVisionAnalysisAgent,
    /**
     * Optional.  When provided, a BusinessValueStage is inserted between
     * Feature Ranking and Context Signal Validation to enrich feature copy
     * with LLM-generated customer-facing language.
     * When absent the pipeline runs exactly as before (backward-compatible).
     */
    private readonly businessValueAgent?:  IBusinessValueAgent,
    /**
     * Optional.  When provided AND RunInput.contextText is non-empty, a
     * ContextExpansionStage runs early in the pipeline to expand the
     * natural-language description into structured business context.
     * ContextSignalValidationStage then validates it against all evidence.
     * When absent (or contextText is empty) the pipeline runs unchanged.
     */
    private readonly contextExpansionAgent?: IContextExpansionAgent,
  ) {}

  async run(
    rawInput:    RunInput,
    onProgress?: ProgressCallback,
  ): Promise<PipelineRun> {
    const runId   = randomUUID();
    const startedAt = new Date().toISOString();
    const stageResults: StageResult[] = [];

    // ── RF6: URL validation (throws UrlValidationError for blocked URLs) ─────
    // Skip when the caller explicitly opts in to local/dev targets via
    // options.allowLocalUrls — this is safe because this tool runs as a local
    // CLI process, not as a server (SSRF is only a threat in server contexts).
    if (!rawInput.options?.allowLocalUrls) {
      try {
        UrlValidator.validate(rawInput.url);
      } catch (err) {
        if (err instanceof UrlValidationError) {
          const run: PipelineRun = {
            id: runId, inputUrl: rawInput.url, startedAt,
            status: 'failed', stages: stageResults,
            completedAt: new Date().toISOString(), totalDurationMs: 0,
          };
          onProgress?.({
            type: 'pipeline:error', stageName: 'Validation', progress: 0,
            message: err.message, error: err.message,
          });
          return run;
        }
        throw err;
      }
    }

    // ── RF5: Wrap raw strings in SealedCredentials — AuthStage seals after use
    const input: WorkflowInput = {
      url:         rawInput.url,
      credentials: new SealedCredentials(rawInput.username, rawInput.password),
      outputDir:   rawInput.outputDir,
      options:     rawInput.options,
    };

    const ctx = createPipelineContext(input);
    const opts = input.options ?? {};

    const run: PipelineRun = {
      id:       runId,
      inputUrl: input.url,
      startedAt,
      status:   'running',
      stages:   stageResults,
    };

    // ── Stage instances ──────────────────────────────────────────────────────
    const authStage          = new AuthStage(new AuthAgent({
      headless:          opts.headless ?? true,
      // Default to 2× so screenshots stay sharp when camera zoom is applied
      // in later phases.  Callers can override via options.screenshotScale: 1.
      deviceScaleFactor: opts.screenshotScale ?? 2,
    }));
    const discoveryStage          = new DiscoveryStage();
    const graphStage              = new GraphBuildingStage();
    const siStage                 = new ScreenshotIntelligenceStage(this.screenshotAgent, this.visionAgent);
    const inPageDiscoveryStage           = new InPageDiscoveryStage();
    const featureStage                   = new FeatureRankingStage();
    const interactionReplayDirectorStage = new InteractionReplayDirectorStage();
    const journeyStage                   = new JourneyGenerationStage();
    const storyboardStage         = new StoryboardStage();
    const remotionExportStage     = new RemotionExportStage();

    try {
      // ── 1. Authentication ─────────────────────────────────────────────────
      ctx.authSession = await runStage(
        authStage, input, ctx,
        progressAt('Authentication'), stageResults, onProgress,
      );

      // ── 1b. Context Expansion (optional) ─────────────────────────────────
      // Runs immediately after auth — no browser needed — so the expanded
      // context is available to all downstream stages.
      // Skipped when no contextExpansionAgent was injected (zero-change) or
      // when rawInput.contextText is empty/absent.
      if (this.contextExpansionAgent && rawInput.contextText?.trim()) {
        const expansionStage = new ContextExpansionStage(this.contextExpansionAgent);
        await runStage(
          expansionStage, rawInput.contextText, ctx,
          progressAt('Context Expansion'), stageResults, onProgress,
        );
      }

      // ── 2. Discovery ──────────────────────────────────────────────────────
      // Use the URL we actually landed on after login as the discovery root.
      // For apps where root ("/") always renders the login form regardless of
      // auth state (no server-side redirect), starting from landedUrl (e.g.
      // "/dashboard") ensures we discover authenticated pages, not the login
      // page's zero nav-links.
      const discoveryStartUrl = ctx.authSession?.landedUrl ?? input.url;
      ctx.discoveredPages = await runStage(
        discoveryStage,
        {
          startUrl: discoveryStartUrl,
          context:  ctx.browserSession!.context,
          maxDepth: opts.maxDepth,
          maxPages: opts.maxPages,
          seedUrls: opts.seedUrls,
        },
        ctx,
        progressAt('Discovery'),
        stageResults,
        onProgress,
      );

      // ── 3. Graph building ─────────────────────────────────────────────────
      ctx.applicationGraph = await runStage(
        graphStage, ctx.discoveredPages, ctx,
        progressAt('Graph Building'), stageResults, onProgress,
      );

      // ── 4. Screenshot + Vision Analysis ───────────────────────────────────
      const siOutput = await runStage(
        siStage,
        {
          pages:   ctx.discoveredPages,
          context: ctx.browserSession!.context,
        },
        ctx,
        progressAt('Screenshot + Vision Analysis'),
        stageResults,
        onProgress,
      );
      ctx.pageCaptures     = siOutput.captures;
      ctx.pageIntelligence = siOutput.intelligence;

      // ── 4b. In-Page Discovery ─────────────────────────────────────────────
      // Explores each base page for hidden in-page states (tabs, accordions,
      // expand-toggles) while the browser context is still open.
      //
      // Synthetic captures (one per meaningful state) are returned for vision
      // analysis.  They are NEVER added to ctx.pageCaptures — RemotionExporter
      // must continue to see only base-page screenshots unchanged.
      const inPageOutput = await runStage(
        inPageDiscoveryStage,
        {
          pages:     ctx.discoveredPages,
          captures:  ctx.pageCaptures,          // explorationResult populated in-place
          context:   ctx.browserSession!.context,
          outputDir: input.outputDir,
        },
        ctx,
        progressAt('In-Page Discovery'),
        stageResults,
        onProgress,
      );

      // Run vision analysis on discovered state screenshots, then extend
      // ctx.pageIntelligence.  FeatureRankingStage sees the richer set automatically.
      if (inPageOutput.stateSyntheticCaptures.length > 0) {
        const stateIntelligence = await this.visionAgent.analyzeAll(
          inPageOutput.stateSyntheticCaptures,
        );
        ctx.pageIntelligence = [...ctx.pageIntelligence, ...stateIntelligence];
      }

      // ── Close browser — no longer needed ─────────────────────────────────
      // Moved after InPageDiscovery (was after Screenshot+Vision) so the
      // exploration loop can open fresh tabs within the authenticated context.
      await this.closeBrowser(ctx);

      // ── 5. Feature ranking ────────────────────────────────────────────────
      ctx.prioritizedFeatures = await runStage(
        featureStage, ctx.pageIntelligence, ctx,
        progressAt('Feature Ranking'), stageResults, onProgress,
      );

      // ── 5b. Business Value Enrichment (optional) ──────────────────────────
      // Replaces Feature.businessValue copy with LLM-generated customer-facing
      // language before the journey and storyboard generators consume it.
      // Skipped when no businessValueAgent was injected (zero-breaking-change).
      if (this.businessValueAgent) {
        const bvStage = new BusinessValueStage(this.businessValueAgent);
        ctx.prioritizedFeatures = await runStage(
          bvStage,
          ctx.prioritizedFeatures,
          ctx,
          progressAt('Business Value Enrichment'),
          stageResults,
          onProgress,
        );
      }

      // ── 5c. Context Signal Validation (optional) ──────────────────────────
      // Runs after all evidence sources are complete (Discovery + Vision +
      // BusinessValue) so the validator has the full semantic corpus.
      // Skipped entirely when no context was provided (isPresent() === false).
      if (ctx.contextEnvelope.isPresent()) {
        const cvStage = new ContextSignalValidationStage();
        await runStage(
          cvStage, undefined, ctx,
          progressAt('Context Signal Validation'), stageResults, onProgress,
        );
      }

      // ── 5d. Demo Readiness Scoring ────────────────────────────────────────
      // Pure-computation stage: scores every PageIntelligence record for demo
      // suitability, filters out login pages, empty states, settings screens,
      // and near-duplicate views, then replaces ctx.pageIntelligence and
      // ctx.prioritizedFeatures with the demo-ready subset.
      //
      // Runs unconditionally — never modifies ctx.pageCaptures (RemotionExporter
      // constraint).  Falls back gracefully if applicationGraph is absent.
      if (ctx.applicationGraph && ctx.pageIntelligence && ctx.pageIntelligence.length > 0) {
        const readinessStage = new DemoReadinessStage();
        const readinessOutput = await runStage(
          readinessStage,
          {
            intelligence:    ctx.pageIntelligence,
            features:        ctx.prioritizedFeatures ?? [],
            captures:        ctx.pageCaptures        ?? [],
            graph:           ctx.applicationGraph,
            businessOutputs: ctx.businessValueOutputs,
            threshold:       opts.readinessThreshold   ?? 0.40,
            minScenes:       opts.minScenesAfterFilter  ?? 5,
          },
          ctx,
          progressAt('Demo Readiness'),
          stageResults,
          onProgress,
        );
        ctx.pageIntelligence    = readinessOutput.filteredIntelligence;
        ctx.prioritizedFeatures = readinessOutput.filteredFeatures;
        ctx.readinessResults    = readinessOutput.scoredPages;

        onProgress?.({
          type:      'stage:complete',
          stageName: 'Demo Readiness',
          progress:  progressAt('Demo Readiness'),
          message:   `Demo Readiness: ${readinessOutput.passCount} passed, ` +
                     `${readinessOutput.borderlineCount} borderline, ` +
                     `${readinessOutput.rejectedCount} rejected` +
                     (readinessOutput.readinessWarning
                       ? ` (${readinessOutput.promotedCount} borderline pages promoted to meet scene floor)`
                       : '') +
                     (readinessOutput.tier1EligibleCount > 0
                       ? ` — ${readinessOutput.tier1EligibleCount} Tier 1 page(s) boosted for journey priority`
                       : ' — ⚠ no Tier 1 pages in eligible set'),
        });

        // ── Prune applicationGraph to eligible pages only ───────────────────
        // JourneyGenerationStage traverses ctx.applicationGraph topology to fill
        // targetSteps.  Without this filter it visits zero-feature nodes
        // (form/settings interaction states) that Demo Readiness already rejected,
        // causing those pages to appear as journey steps and ultimately as scenes.
        // We rebuild the graph here so only demo-ready nodes and their connecting
        // edges reach the Journey Generator.
        //
        // URL correlation: ReadinessResult.url comes from PageCapture.dom.url;
        // GraphNode.url is set by the Discovery crawler from the same URL.
        // Exact match is sufficient — ScoringContextBuilder uses the same lookup.
        {
          const eligiblePageIds = new Set(readinessOutput.filteredIntelligence.map(pi => pi.pageId));
          const eligibleUrls    = new Set(
            readinessOutput.scoredPages
              .filter(r => eligiblePageIds.has(r.pageId))
              .map(r => r.url)
              .filter(u => u.length > 0),
          );
          if (eligibleUrls.size > 0) {
            const eligibleNodeIds = new Set(
              ctx.applicationGraph.nodes
                .filter(n => eligibleUrls.has(n.url))
                .map(n => n.id),
            );
            const filteredNodes = ctx.applicationGraph.nodes.filter(n => eligibleNodeIds.has(n.id));
            const filteredEdges = ctx.applicationGraph.edges.filter(
              e => eligibleNodeIds.has(e.source) && eligibleNodeIds.has(e.target),
            );
            ctx.applicationGraph = {
              ...ctx.applicationGraph,
              nodes: filteredNodes,
              edges: filteredEdges,
              meta:  {
                ...ctx.applicationGraph.meta,
                totalNodes: filteredNodes.length,
                totalEdges: filteredEdges.length,
              },
            };
          }
        }
      }

      // ── 5e. Sales Story Director (Phase 8) ───────────────────────────────
      // Pure-computation stage: maps filtered page intelligence into a
      // structured narrative arc (SceneGoals + camera intents + callouts).
      // Runs when Demo Readiness produced passing pages.
      // Skipped gracefully when readinessResults is absent (e.g. legacy runs).
      if (
        ctx.pageIntelligence &&
        ctx.pageIntelligence.length > 0 &&
        ctx.readinessResults &&
        ctx.readinessResults.length > 0
      ) {
        const salesStoryStage = new SalesStoryDirectorStage();
        ctx.salesStory = await runStage(
          salesStoryStage,
          {
            intelligence:    ctx.pageIntelligence,
            features:        ctx.prioritizedFeatures ?? [],
            businessOutputs: ctx.businessValueOutputs,
            readinessResults: ctx.readinessResults,
            captures:        ctx.pageCaptures ?? [],
          },
          ctx,
          progressAt('Sales Story'),
          stageResults,
          onProgress,
        );
      }

      // ── 5g. Interaction Replay Director (Phase 9) ─────────────────────────
      // Guard: requires both a sales story and non-empty exploration data.
      // Absent guard conditions → stage runs and self-skips (no ctx write).
      if (
        ctx.salesStory &&
        ctx.interactionExplorations &&
        ctx.interactionExplorations.size > 0
      ) {
        await runStage(
          interactionReplayDirectorStage,
          {},
          ctx,
          progressAt('Interaction Replay Director'),
          stageResults,
          onProgress,
        );
      }

      // ── 6. Journey generation ─────────────────────────────────────────────
      ctx.demoJourney = await runStage(
        journeyStage,
        {
          graph:       ctx.applicationGraph,
          features:    ctx.prioritizedFeatures,
          targetSteps: opts.targetJourneySteps,
          storyArc:    ctx.salesStory,   // Phase 8: bypasses beam-search when set
        },
        ctx,
        progressAt('Journey Generation'),
        stageResults,
        onProgress,
      );

      // ── 7. Storyboard ─────────────────────────────────────────────────────
      ctx.storyboard = await runStage(
        storyboardStage,
        {
          journey:  ctx.demoJourney,
          options:  opts,
          storyArc: ctx.salesStory,      // Phase 8: overrides callouts + camera
        },
        ctx,
        progressAt('Storyboard Generation'),
        stageResults,
        onProgress,
      );

      // ── 8. Remotion export ────────────────────────────────────────────────
      const exportOutput = await runStage(
        remotionExportStage,
        {
          storyboard:  ctx.storyboard,
          captures:    ctx.pageCaptures,
          outputDir:   input.outputDir,
          meta: {
            productName:    opts.productName    ?? 'the Platform',
            targetAudience: opts.targetAudience ?? 'your team',
            primaryBenefit: opts.primaryBenefit ?? 'save time and make better decisions',
          },
          // Phase 3: wire per-page vision intelligence so the exporter can
          // build SpotlightTargets (elementType + bbox) for each scene.
          intelligence: ctx.pageIntelligence,
        },
        ctx,
        progressAt('Remotion Export'),
        stageResults,
        onProgress,
      );
      ctx.remotionPackage = exportOutput.package;
      ctx.outputPath      = exportOutput.outputPath;

      // ── 9. Motion Direction (Phase 7) ─────────────────────────────────────
      // Pure-computation stage: derives the MotionPlan from the RemotionPackage
      // and writes motion-package.json.  Runs unconditionally — takes < 100ms
      // and produces no browser I/O.  Skipped gracefully if remotionPackage is
      // somehow absent (shouldn't happen in normal flow).
      const motionInput = buildMotionDirectionInput(ctx, input.outputDir);
      if (motionInput) {
        const motionStage  = new MotionDirectionStage();
        const motionOutput = await runStage(
          motionStage,
          motionInput,
          ctx,
          progressAt('Motion Direction'),
          stageResults,
          onProgress,
        );
        ctx.motionPlan = motionOutput.motionPlan;
      }

      // ── Finalise run ──────────────────────────────────────────────────────
      run.status           = 'completed';
      run.completedAt      = new Date().toISOString();
      run.outputPath       = ctx.outputPath;
      run.pagesDiscovered  = ctx.discoveredPages.length;
      run.featuresRanked   = ctx.prioritizedFeatures.length;
      run.sceneCount       = ctx.storyboard.totalScenes;
      run.totalDurationMs  = Date.now() - new Date(startedAt).getTime();

      onProgress?.({
        type:      'pipeline:complete',
        stageName: 'Pipeline',
        progress:  100,
        message:   `demo-package.json written to ${ctx.outputPath}`,
      });

      return run;
    } catch (err) {
      run.status      = 'failed';
      run.completedAt = new Date().toISOString();
      run.totalDurationMs = Date.now() - new Date(startedAt).getTime();

      const error = err instanceof Error ? err.message : String(err);
      onProgress?.({
        type:      'pipeline:error',
        stageName: 'Pipeline',
        progress:  stageResults.length * 12,
        message:   `Pipeline failed: ${error}`,
        error,
      });

      return run;
    } finally {
      // ALWAYS close the browser — even if a stage or the error handler throws
      await this.closeBrowser(ctx).catch(() => {});
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────────

  private async closeBrowser(ctx: ReturnType<typeof createPipelineContext>): Promise<void> {
    if (!ctx.browserSession) return;
    await ctx.browserSession.context.close().catch(() => {});
    await ctx.browserSession.browser.close().catch(() => {});
    ctx.browserSession = undefined;
  }
}
