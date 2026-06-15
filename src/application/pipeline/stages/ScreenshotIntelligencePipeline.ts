import type { BrowserContext } from 'playwright';
import type { DiscoveredPage } from '../../../core/domain/entities/DiscoveredPage';
import type { PageCapture } from '../../../core/domain/entities/PageCapture';
import type { PageIntelligence } from '../../../core/domain/entities/PageIntelligence';
import type { IScreenshotAgent } from '../../../core/ports/agents/IScreenshotAgent';
import type { IVisionAnalysisAgent } from '../../../core/ports/agents/IVisionAnalysisAgent';

export interface PageRecord {
  page: DiscoveredPage;
  capture: PageCapture;
  intelligence: PageIntelligence;
}

export interface PipelineResult {
  records: PageRecord[];
  successCount: number;
  partialCount: number;
  failedCount: number;
  visionCount: number;
  domOnlyCount: number;
}

/**
 * Chains the ScreenshotAgent → VisionAnalysisAgent in two sequential phases.
 *
 * Phase 1 — Screenshot: all pages are captured concurrently (controlled by
 *   ScreenshotAgent's CaptureQueue).
 *
 * Phase 2 — Vision Analysis: all captures are analysed concurrently (controlled
 *   by VisionAnalysisAgent's CaptureQueue, which respects LLM rate limits).
 *
 * Outputs one PageRecord per input page regardless of partial failures.
 */
export class ScreenshotIntelligencePipeline {
  constructor(
    private readonly screenshotAgent: IScreenshotAgent,
    private readonly visionAgent: IVisionAnalysisAgent,
  ) {}

  async run(pages: DiscoveredPage[], context: BrowserContext): Promise<PipelineResult> {
    // ── Phase 1: Capture ──────────────────────────────────────────────────────
    const captures = await this.screenshotAgent.captureAll(pages, context);

    // ── Phase 2: Analyse ──────────────────────────────────────────────────────
    const intelligences = await this.visionAgent.analyzeAll(captures);

    // ── Assemble records ──────────────────────────────────────────────────────
    const records: PageRecord[] = pages.map((page, i) => ({
      page,
      capture:      captures[i],
      intelligence: intelligences[i],
    }));

    return { records, ...this.summarise(records) };
  }

  private summarise(records: PageRecord[]) {
    return records.reduce(
      (acc, { capture, intelligence }) => {
        if (capture.metadata.status === 'success')  acc.successCount++;
        if (capture.metadata.status === 'partial')  acc.partialCount++;
        if (capture.metadata.status === 'failed')   acc.failedCount++;
        if (intelligence.analysisMode === 'vision')   acc.visionCount++;
        if (intelligence.analysisMode === 'dom-only') acc.domOnlyCount++;
        return acc;
      },
      { successCount: 0, partialCount: 0, failedCount: 0, visionCount: 0, domOnlyCount: 0 },
    );
  }
}
