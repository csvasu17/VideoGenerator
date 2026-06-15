import type { PageCapture } from '../../core/domain/entities/PageCapture';
import type { PageIntelligence } from '../../core/domain/entities/PageIntelligence';
import type { IVisionAnalysisAgent } from '../../core/ports/agents/IVisionAnalysisAgent';
import type { ILLMProvider } from '../../core/ports/services/ILLMProvider';
import { CaptureQueue } from '../screenshot/CaptureQueue';
import { RetryPolicy, DEFAULT_RETRY_OPTIONS } from '../screenshot/RetryPolicy';
import type { RetryOptions } from '../screenshot/RetryPolicy';
import { ScreenshotLoader } from '../screenshot/ScreenshotLoader';
import { ScreenshotEncoder } from './ScreenshotEncoder';
import { ResponseParser } from './ResponseParser';
import { fillTemplate } from '../../infrastructure/llm/PromptLoader';

// ── Configuration ─────────────────────────────────────────────────────────────

export interface VisionAgentConfig {
  /** Max concurrent LLM calls. Default: 2 (respect API rate limits). */
  concurrency: number;
  retry: RetryOptions;
  /** Max tokens for the LLM response. Default: 4096. */
  maxTokens: number;
  /**
   * Maximum characters of DOM HTML sent to the LLM.
   * Long HTML is trimmed from the bottom to fit.
   */
  maxDomChars: number;
  /**
   * Which screenshot to prefer for vision analysis.
   * 'full' sends the full-page screenshot; 'viewport' sends only the above-fold view.
   * Default: 'viewport' — faster and usually sufficient for feature identification.
   */
  screenshotPreference: 'full' | 'viewport';
}

const DEFAULT_CONFIG: Readonly<VisionAgentConfig> = {
  concurrency:          2,
  retry:                DEFAULT_RETRY_OPTIONS,
  maxTokens:            4096,
  maxDomChars:          8_000,
  screenshotPreference: 'viewport',
};

// ── Agent ─────────────────────────────────────────────────────────────────────

export class VisionAnalysisAgent implements IVisionAnalysisAgent {
  private readonly config: VisionAgentConfig;
  private readonly queue:  CaptureQueue;
  private readonly retry:  RetryPolicy;

  constructor(
    private readonly llmProvider:  ILLMProvider,
    private readonly visionPrompt: string,
    private readonly domOnlyPrompt: string,
    private readonly encoder:      ScreenshotEncoder,
    private readonly parser:       ResponseParser,
    config: Partial<VisionAgentConfig> = {},
    /**
     * RF7: on-demand disk reader.
     * Defaults to a real ScreenshotLoader; tests inject a mock to avoid
     * touching the filesystem.
     */
    private readonly loader: ScreenshotLoader = new ScreenshotLoader(),
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.queue  = new CaptureQueue(this.config.concurrency);
    this.retry  = new RetryPolicy();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async analyzeAll(captures: PageCapture[]): Promise<PageIntelligence[]> {
    const results = await this.queue.runAll(
      captures.map(c => () => this.analyzePage(c)),
    );

    return results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return this.buildFallback(captures[i].pageId, String((r as PromiseRejectedResult).reason));
    });
  }

  async analyzePage(capture: PageCapture): Promise<PageIntelligence> {
    try {
      return await this.retry.execute(
        () => this.runAnalysis(capture),
        this.config.retry,
      );
    } catch (err) {
      // All retries for vision analysis exhausted.
      // Graceful-degrade: try dom-only as a final fallback (no retry — best-effort).
      // This prevents a transient vision API error from wiping out all features.
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[VisionAnalysis] all retries failed for ${capture.pageId.slice(0, 8)}, ` +
        `falling back to dom-only. Error: ${errMsg.slice(0, 120)}`,
      );
      const domContext = this.trimDom(
        capture.dom.textContent,
        capture.dom.headings,
        capture.dom.html,
      );
      try {
        return await this.analyzeWithDomOnly(capture.pageId, domContext);
      } catch {
        return this.buildFallback(capture.pageId, errMsg);
      }
    }
  }

  // ── Core analysis ───────────────────────────────────────────────────────────

  private async runAnalysis(capture: PageCapture): Promise<PageIntelligence> {
    // RF7: load screenshot from disk only when needed — Buffer lives only for
    // the duration of this single LLM call, never accumulated across pages.
    const screenshot = await this.loadScreenshot(capture);
    const domContext = this.trimDom(
      capture.dom.textContent,
      capture.dom.headings,
      capture.dom.html,
    );

    if (screenshot && this.llmProvider.supportsVision) {
      return this.analyzeWithVision(capture.pageId, screenshot, domContext);
    }

    return this.analyzeWithDomOnly(capture.pageId, domContext);
  }

  private async analyzeWithVision(
    pageId:     string,
    screenshot: Buffer,
    domContext: string,
  ): Promise<PageIntelligence> {
    const prompt = fillTemplate(this.visionPrompt, { DOM_CONTEXT: domContext });
    const image  = this.encoder.encode(screenshot);

    const rawText = await this.llmProvider.complete(
      [{ role: 'user', content: [image, { type: 'text', text: prompt }] }],
      { maxTokens: this.config.maxTokens },
    );

    return this.parser.parse(rawText, pageId, 'vision');
  }

  private async analyzeWithDomOnly(pageId: string, domContext: string): Promise<PageIntelligence> {
    const prompt = fillTemplate(this.domOnlyPrompt, { DOM_CONTEXT: domContext });

    const rawText = await this.llmProvider.complete(
      [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      { maxTokens: this.config.maxTokens },
    );

    return this.parser.parse(rawText, pageId, 'dom-only');
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * RF7: Load the preferred screenshot from disk on demand.
   * Tries the preferred path first, then falls back to the other.
   * Returns null (→ dom-only mode) when both paths are null or unreadable.
   */
  private async loadScreenshot(capture: PageCapture): Promise<Buffer | null> {
    const { screenshotPreference } = this.config;
    const preferredPath = screenshotPreference === 'viewport'
      ? capture.screenshot.viewportPath
      : capture.screenshot.fullPath;
    const fallbackPath  = screenshotPreference === 'viewport'
      ? capture.screenshot.fullPath
      : capture.screenshot.viewportPath;

    return (
      (await this.loader.load(preferredPath)) ??
      (await this.loader.load(fallbackPath))
    );
  }

  /**
   * Build a compact DOM context string for the LLM.
   * Sends headings first (high signal density), then trimmed plain text, then raw HTML last.
   * Total capped at maxDomChars.
   */
  private trimDom(textContent: string, headings: string[], html: string): string {
    const headingBlock = headings.length
      ? `## Page Headings\n${headings.map(h => `- ${h}`).join('\n')}\n\n`
      : '';

    const remaining = this.config.maxDomChars - headingBlock.length;
    if (remaining <= 0) return headingBlock;

    const textBlock  = `## Page Text\n${textContent.slice(0, Math.floor(remaining * 0.4))}\n\n`;
    const htmlBudget = remaining - textBlock.length;

    const htmlBlock = htmlBudget > 200
      ? `## HTML Structure\n${html.slice(0, htmlBudget)}`
      : '';

    return headingBlock + textBlock + htmlBlock;
  }

  private buildFallback(pageId: string, errorMessage: string): PageIntelligence {
    return {
      pageId,
      analysedAt:             new Date().toISOString(),
      pagePurpose:            `Analysis failed: ${errorMessage}`,
      pageCategory:           'generic',
      features:               [],
      importantActions:       [],
      businessContext:        '',
      kpiWidgets:             [],
      overallImportanceScore: 0,
      analysisMode:           'dom-only',
    };
  }
}
