export { VisionAnalysisAgent } from './VisionAnalysisAgent';
export { ResponseParser } from './ResponseParser';
export { ScreenshotEncoder } from './ScreenshotEncoder';
export type { VisionAgentConfig } from './VisionAnalysisAgent';

import { VisionAnalysisAgent } from './VisionAnalysisAgent';
import { ResponseParser } from './ResponseParser';
import { ScreenshotEncoder } from './ScreenshotEncoder';
import { loadPrompt } from '../../infrastructure/llm/PromptLoader';
import type { ILLMProvider } from '../../core/ports/services/ILLMProvider';
import type { VisionAgentConfig } from './VisionAnalysisAgent';

/**
 * Convenience factory.
 * Loads versioned prompt files from src/prompts/vision/ and wires up all dependencies.
 * Swap the LLMProvider to switch between Claude, OpenAI, or Mock.
 */
export function createVisionAnalysisAgent(
  llmProvider: ILLMProvider,
  config: Partial<VisionAgentConfig> = {},
): VisionAnalysisAgent {
  const visionPrompt  = loadPrompt('vision', 'analyze-page.v1');
  const domOnlyPrompt = loadPrompt('vision', 'analyze-dom-only.v1');

  // ScreenshotLoader uses its default constructor — loads from real disk paths.
  return new VisionAnalysisAgent(
    llmProvider,
    visionPrompt,
    domOnlyPrompt,
    new ScreenshotEncoder(),
    new ResponseParser(),
    config,
    // loader omitted → VisionAnalysisAgent uses `new ScreenshotLoader()` default
  );
}
