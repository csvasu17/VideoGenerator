import type { BrowserContext } from 'playwright';
import type { PipelineStage } from '../PipelineStage';
import type { PipelineContext } from '../PipelineContext';
import type { DiscoveredPage } from '../../../core/domain/entities/DiscoveredPage';
import type { PageCapture } from '../../../core/domain/entities/PageCapture';
import type { PageIntelligence } from '../../../core/domain/entities/PageIntelligence';
import { ScreenshotIntelligencePipeline } from './ScreenshotIntelligencePipeline';
import type { IScreenshotAgent } from '../../../core/ports/agents/IScreenshotAgent';
import type { IVisionAnalysisAgent } from '../../../core/ports/agents/IVisionAnalysisAgent';

export interface ScreenshotIntelligenceInput {
  pages:   DiscoveredPage[];
  context: BrowserContext;
}

export interface ScreenshotIntelligenceOutput {
  captures:     PageCapture[];
  intelligence: PageIntelligence[];
}

/**
 * Pipeline stage that chains Screenshot → Vision Analysis.
 * After this stage the BrowserContext is no longer needed.
 */
export class ScreenshotIntelligenceStage
  implements PipelineStage<ScreenshotIntelligenceInput, ScreenshotIntelligenceOutput>
{
  readonly name = 'Screenshot + Vision Analysis';

  private readonly pipeline: ScreenshotIntelligencePipeline;

  constructor(
    screenshotAgent: IScreenshotAgent,
    visionAgent:     IVisionAnalysisAgent,
  ) {
    this.pipeline = new ScreenshotIntelligencePipeline(screenshotAgent, visionAgent);
  }

  async run(
    input: ScreenshotIntelligenceInput,
    _ctx:  PipelineContext,
  ): Promise<ScreenshotIntelligenceOutput> {
    const result = await this.pipeline.run(input.pages, input.context);
    return {
      captures:     result.records.map(r => r.capture),
      intelligence: result.records.map(r => r.intelligence),
    };
  }
}
