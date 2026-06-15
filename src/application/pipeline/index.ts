// ─────────────────────────────────────────────────────────────────────────────
// Workflow Pipeline — public barrel
// ─────────────────────────────────────────────────────────────────────────────

export { WorkflowOrchestrator } from './WorkflowOrchestrator';
export { createPipelineContext } from './PipelineContext';
export type { PipelineContext, RunInput, WorkflowInput, WorkflowOptions, BrowserSession } from './PipelineContext';
export type { PipelineStage, ProgressEvent, ProgressCallback } from './PipelineStage';
export { UrlValidator, UrlValidationError } from './UrlValidator';

// Stages (exported for custom wiring or testing)
export { AuthStage }                   from './stages/AuthStage';
export { DiscoveryStage }              from './stages/DiscoveryStage';
export { GraphBuildingStage }          from './stages/GraphBuildingStage';
export { ScreenshotIntelligenceStage } from './stages/ScreenshotIntelligenceStage';
export { FeatureRankingStage }         from './stages/FeatureRankingStage';
export { JourneyGenerationStage }      from './stages/JourneyGenerationStage';
export { StoryboardStage }             from './stages/StoryboardStage';
export { RemotionExportStage }         from './stages/RemotionExportStage';

// ─────────────────────────────────────────────────────────────────────────────
// Convenience factory
// ─────────────────────────────────────────────────────────────────────────────

import { WorkflowOrchestrator } from './WorkflowOrchestrator';
import type { IScreenshotAgent }    from '../../core/ports/agents/IScreenshotAgent';
import type { IVisionAnalysisAgent } from '../../core/ports/agents/IVisionAnalysisAgent';

/**
 * Create a fully-wired WorkflowOrchestrator.
 *
 * Callers inject the LLM-backed agents (ScreenshotAgent + VisionAnalysisAgent)
 * so they can swap providers (Claude / OpenAI / Mock) without touching the
 * pipeline code.
 *
 * @example
 * ```typescript
 * const orchestrator = createWorkflowOrchestrator(
 *   createScreenshotAgent(),
 *   createVisionAnalysisAgent(new ClaudeProvider(apiKey)),
 * );
 *
 * // run() accepts RunInput (raw strings at the API boundary).
 * // The orchestrator validates the URL (RF6) and seals credentials (RF5)
 * // before any pipeline stage sees them.
 * const run = await orchestrator.run({
 *   url:      'https://app.example.com',
 *   username: 'demo@example.com',
 *   password: 'secret',
 *   outputDir: './output',
 *   options: { productName: 'ExampleApp', targetAudience: 'Operations teams' },
 * }, event => console.log(event));
 * ```
 */
export function createWorkflowOrchestrator(
  screenshotAgent: IScreenshotAgent,
  visionAgent:     IVisionAnalysisAgent,
): WorkflowOrchestrator {
  return new WorkflowOrchestrator(screenshotAgent, visionAgent);
}
