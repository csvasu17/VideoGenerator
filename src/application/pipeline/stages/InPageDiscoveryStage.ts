// ─────────────────────────────────────────────────────────────────────────────
// InPageDiscoveryStage
//
// Runs AFTER ScreenshotIntelligenceStage while the browser context is still
// open.  For each discovered base page:
//
//   1. Opens a fresh browser tab.
//   2. Navigates to the page URL (using the same authenticated session).
//   3. Calls InPageDiscovery.explorePage() to surface hidden in-page states
//      (tabs, accordions, expand-toggles, visual candidates).
//   4. Stores exploration metadata in baseCapture.explorationResult (in-place).
//   5. Returns *synthetic* PageCapture objects — one per meaningful state —
//      for downstream VisionAnalysisAgent processing.
//
// ── INVARIANT ────────────────────────────────────────────────────────────────
//
//   Synthetic captures are NEVER added to ctx.pageCaptures.
//   ctx.pageCaptures contains only base-page screenshots so that
//   RemotionExporter produces the correct output unchanged.
//
//   Flow:  state screenshot → VisionAnalysisAgent → PageIntelligence
//       → merged into ctx.pageIntelligence by WorkflowOrchestrator
//
// ── Error handling ────────────────────────────────────────────────────────────
//
//   Per-page errors are caught, logged, and marked 'failed' in explorationResult.
//   A single page failure never aborts the stage or the pipeline.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs   from 'fs/promises';
import * as path from 'path';
import type { BrowserContext, Page as PlaywrightPage } from 'playwright';
import type { DiscoveredPage }       from '../../../core/domain/entities/DiscoveredPage';
import type {
  PageCapture,
  PageExplorationSummary,
}                                    from '../../../core/domain/entities/PageCapture';
import type { PipelineContext }      from '../PipelineContext';
import type { PipelineStage }        from '../PipelineStage';
import { InPageDiscovery }           from '../../../agents/discovery/interaction/InPageDiscovery';
import type { ExplorationResult, PageInteractionState } from '../../../agents/discovery/interaction/types';
import { adaptDomSummaryToDOMSnapshot } from '../../../agents/discovery/interaction/DomSummaryAdapter';

// ── I/O types ─────────────────────────────────────────────────────────────────

export interface InPageDiscoveryInput {
  /** All discovered pages — one exploration attempt per page. */
  pages:     DiscoveredPage[];
  /**
   * Base captures from ScreenshotIntelligenceStage.
   * explorationResult is populated in-place on each capture.
   */
  captures:  PageCapture[];
  /** Live Playwright browser context (still open at this point in the pipeline). */
  context:   BrowserContext;
  /** Pipeline output directory — interaction screenshots written under {outputDir}/interactions/. */
  outputDir: string;
}

export interface InPageDiscoveryOutput {
  /**
   * Synthetic PageCapture objects — one per meaningful interaction state found.
   * Passed to VisionAnalysisAgent by the orchestrator.
   * Never placed into ctx.pageCaptures.
   */
  stateSyntheticCaptures: PageCapture[];
  totalTargetsDetected:   number;
  totalStatesFound:       number;
  totalStatesMeaningful:  number;
  durationMs:             number;
}

// ── Exploration configuration ─────────────────────────────────────────────────

const EXPLORATION_CONFIG = {
  maxStates:           10,
  maxAttempts:         30,
  maxTimeMs:           30_000,
  meaningfulThreshold: 0.20,
  visualDetection:     true,
  maxVisualGroups:     5,
} as const;

const NAV_TIMEOUT_MS  = 20_000;  // page.goto() timeout
const SPA_SETTLE_MS   =    800;  // brief wait for SPA hydration after load event
const VIEWPORT_WIDTH  = 1_920;
const VIEWPORT_HEIGHT = 1_080;

// ── Stage ─────────────────────────────────────────────────────────────────────

export class InPageDiscoveryStage
  implements PipelineStage<InPageDiscoveryInput, InPageDiscoveryOutput>
{
  readonly name = 'In-Page Discovery';

  async run(
    input: InPageDiscoveryInput,
    ctx:   PipelineContext,
  ): Promise<InPageDiscoveryOutput> {

    const stageStart            = Date.now();
    const allSyntheticCaptures: PageCapture[] = [];
    let   totalTargets          = 0;
    let   totalStatesFound      = 0;
    let   totalStatesMeaningful = 0;

    // Phase 9: initialise exploration result store keyed by pageId.
    // InteractionReplayDirectorStage reads this after the stage completes.
    ctx.interactionExplorations = new Map<string, ExplorationResult>();

    // Index base captures by pageId for O(1) lookup.
    // DiscoveredPage.id === PageCapture.pageId by ScreenshotAgent convention.
    const captureMap = new Map<string, PageCapture>(
      input.captures.map(c => [c.pageId, c]),
    );

    for (const discoveredPage of input.pages) {
      const baseCapture = captureMap.get(discoveredPage.id);
      if (!baseCapture) {
        // Defensive: ScreenshotAgent guarantees one capture per page, but be safe
        continue;
      }

      // Skip pages where screenshot capture already failed — no reliable base state
      if (baseCapture.metadata.status === 'failed') {
        baseCapture.explorationResult = makeZeroSummary('skipped');
        continue;
      }

      const screenshotOutputDir = path.join(
        input.outputDir,
        'interactions',
        sanitizeId(discoveredPage.id),
      );

      let browserPage: PlaywrightPage | null = null;
      const pageStart = Date.now();

      try {
        await fs.mkdir(screenshotOutputDir, { recursive: true });

        browserPage = await input.context.newPage();
        await browserPage.goto(discoveredPage.url, {
          waitUntil: 'load',
          timeout:   NAV_TIMEOUT_MS,
        });
        // Allow SPA to finish rendering initial route after the load event fires
        await browserPage.waitForTimeout(SPA_SETTLE_MS);

        const discovery = new InPageDiscovery({
          ...EXPLORATION_CONFIG,
          screenshotOutputDir,
        });

        const result = await discovery.explorePage(browserPage);
        const explorationMs = Date.now() - pageStart;

        // Phase 9: preserve full ExplorationResult for InteractionReplayDirectorStage.
        // ctx.pageCaptures must NOT be modified — see stage INVARIANT header.
        ctx.interactionExplorations!.set(discoveredPage.id, result);

        // Persist exploration metadata in the base capture (in-place mutation)
        baseCapture.explorationResult = {
          targetsDetected:       result.totalAttempts,
          statesAttempted:       result.totalAttempts,
          meaningfulStates:      result.totalMeaningful,
          budgetStatus:          result.budgetStatus,
          explorationDurationMs: explorationMs,
          interactionStatePaths: result.discoveredStates.map(s => s.screenshotPath),
        };

        totalTargets           += result.totalAttempts;
        totalStatesFound       += result.totalAttempts;
        totalStatesMeaningful  += result.totalMeaningful;

        // Build one synthetic PageCapture per discovered meaningful state
        for (const state of result.discoveredStates) {
          allSyntheticCaptures.push(
            buildSyntheticCapture(discoveredPage, state),
          );
        }

        console.log(
          `[InPageDiscovery] ${discoveredPage.url} — ` +
          `${result.totalAttempts} explored, ` +
          `${result.totalMeaningful} meaningful, ` +
          `${result.budgetStatus} (${explorationMs}ms)`,
        );

      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(
          `[InPageDiscovery] ERROR on ${discoveredPage.url}: ${errMsg.slice(0, 200)}`,
        );
        baseCapture.explorationResult = {
          ...makeZeroSummary('failed'),
          explorationDurationMs: Date.now() - pageStart,
        };

      } finally {
        // Always close the per-page tab — never leak handles back to the context
        await browserPage?.close().catch(() => {});
      }
    }

    console.log(
      `[InPageDiscovery] stage complete — ` +
      `${totalStatesMeaningful} meaningful states across ` +
      `${input.pages.length} pages in ${Date.now() - stageStart}ms`,
    );

    return {
      stateSyntheticCaptures:  allSyntheticCaptures,
      totalTargetsDetected:    totalTargets,
      totalStatesFound,
      totalStatesMeaningful,
      durationMs:              Date.now() - stageStart,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a synthetic PageCapture wrapping one PageInteractionState screenshot.
 *
 * Key design decisions:
 *
 *   pageId    = base page's id
 *               FeatureRankingStage deduplicates features by name, not pageId.
 *               Using the parent's pageId correctly associates discovered
 *               features with their originating page.
 *
 *   fullPath  = null
 *               StateCapture only takes viewport screenshots.
 *               VisionAnalysisAgent falls back gracefully to dom-only when
 *               neither full nor viewport path loads successfully; viewport
 *               here is always set so vision analysis is attempted.
 *
 *   status    = 'partial'
 *               Signals to downstream consumers that html is empty and no
 *               full screenshot was captured — a legitimate partial capture.
 */
function buildSyntheticCapture(
  page:  DiscoveredPage,
  state: PageInteractionState,
): PageCapture {
  return {
    pageId: page.id,
    screenshot: {
      viewportPath: state.screenshotPath,
      fullPath:     null,
      encoding:     'png',
    },
    dom: adaptDomSummaryToDOMSnapshot(
      state.domSummary,
      state.pageUrl,
      page.title,
    ),
    metadata: {
      capturedAt:              new Date(state.capturedAt).toISOString(),
      durationMs:              0,
      status:                  'partial',
      errors:                  [],
      viewportWidth:           VIEWPORT_WIDTH,
      viewportHeight:          VIEWPORT_HEIGHT,
      pageTitle:               page.title,
      finalUrl:                state.pageUrl,
      htmlSizeBytes:           0,
      fullScreenshotBytes:     0,
      viewportScreenshotBytes: 0,
    },
    // explorationResult intentionally absent — synthetic captures are leaf states,
    // not base pages, and are never themselves explored further.
  };
}

function makeZeroSummary(
  budgetStatus: PageExplorationSummary['budgetStatus'],
): PageExplorationSummary {
  return {
    targetsDetected:       0,
    statesAttempted:       0,
    meaningfulStates:      0,
    budgetStatus,
    explorationDurationMs: 0,
    interactionStatePaths: [],
  };
}

/** Mirrors ScreenshotAgent.sanitizeId — safe characters for filesystem paths. */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}
