export { ScreenshotAgent } from './ScreenshotAgent';
export { CaptureQueue } from './CaptureQueue';
export { DOMExtractor } from './DOMExtractor';
export { RetryPolicy, DEFAULT_RETRY_OPTIONS } from './RetryPolicy';
export { ScreenshotCapture } from './ScreenshotCapture';
export { ScreenshotLoader } from './ScreenshotLoader';   // RF7

export type { ScreenshotAgentConfig } from './ScreenshotAgent';
export type { RetryOptions } from './RetryPolicy';
export type { CaptureOptions, ImageEncoding } from './ScreenshotCapture';

import { ScreenshotAgent } from './ScreenshotAgent';
import { DOMExtractor } from './DOMExtractor';
import { ScreenshotCapture } from './ScreenshotCapture';
import type { ScreenshotAgentConfig } from './ScreenshotAgent';

/** Convenience factory — use directly or replace with your DI container bindings. */
export function createScreenshotAgent(
  config: Partial<ScreenshotAgentConfig> = {},
): ScreenshotAgent {
  return new ScreenshotAgent(new ScreenshotCapture(), new DOMExtractor(), config);
}
