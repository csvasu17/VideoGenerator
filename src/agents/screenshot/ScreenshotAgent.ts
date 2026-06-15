import * as nodePath from 'path';
import type { BrowserContext, Page as PlaywrightPage } from 'playwright';
import type { DiscoveredPage } from '../../core/domain/entities/DiscoveredPage';
import type {
  CaptureError,
  CaptureErrorType,
  CaptureStatus,
  DOMSnapshot,
  PageCapture,
  ScreenshotData,
} from '../../core/domain/entities/PageCapture';
import type { IScreenshotAgent } from '../../core/ports/agents/IScreenshotAgent';
import { CaptureQueue } from './CaptureQueue';
import { DOMExtractor } from './DOMExtractor';
import { DEFAULT_RETRY_OPTIONS, RetryPolicy, type RetryOptions } from './RetryPolicy';
import { ScreenshotCapture, type ImageEncoding } from './ScreenshotCapture';

// ── Configuration ─────────────────────────────────────────────────────────────

export interface ScreenshotAgentConfig {
  /** Max pages captured simultaneously. Default: 3. */
  concurrency: number;
  /** Retry policy applied to each capture operation individually. */
  retry: RetryOptions;
  /** Playwright wait condition after navigation. Default: 'networkidle'. */
  waitUntil: 'domcontentloaded' | 'load' | 'networkidle';
  /** Screenshot image format. Default: 'png'. */
  screenshotEncoding: ImageEncoding;
  /** JPEG quality 0–100. Ignored for PNG. */
  screenshotQuality?: number;
  /** Navigation timeout in ms. Default: 30 000. */
  navigationTimeoutMs: number;
  /**
   * RF7: Root directory where screenshot files are written immediately after
   * capture.  Path pattern:
   *   {outputDir}/screenshots/{pageId}/{full|viewport}.{ext}
   *
   * Defaults to process.cwd() so the agent is usable without explicit config,
   * but callers should always supply a dedicated directory.
   */
  outputDir: string;
}

const DEFAULT_CONFIG: Readonly<ScreenshotAgentConfig> = {
  concurrency:        3,
  retry:              DEFAULT_RETRY_OPTIONS,
  waitUntil:          'networkidle',
  screenshotEncoding: 'png',
  navigationTimeoutMs: 30_000,
  outputDir:          process.cwd(),
};

// ── Null fallback ─────────────────────────────────────────────────────────────

function nullScreenshot(encoding: ImageEncoding): ScreenshotData {
  return { fullPath: null, viewportPath: null, encoding };
}

function nullDom(page: DiscoveredPage): DOMSnapshot {
  return {
    html:         '',
    title:        page.title,
    url:          page.url,
    textContent:  '',
    headings:     [],
    links:        [],
    formCount:    0,
    inputCount:   0,
    buttonCount:  0,
    imageCount:   0,
    ariaLandmarks: [],
  };
}

// ── Agent ─────────────────────────────────────────────────────────────────────

export class ScreenshotAgent implements IScreenshotAgent {
  private readonly config: ScreenshotAgentConfig;
  private readonly queue:  CaptureQueue;
  private readonly retry:  RetryPolicy;

  constructor(
    private readonly screenshotCapture: ScreenshotCapture,
    private readonly domExtractor:      DOMExtractor,
    config: Partial<ScreenshotAgentConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.queue  = new CaptureQueue(this.config.concurrency);
    this.retry  = new RetryPolicy();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async captureAll(
    pages:   DiscoveredPage[],
    context: BrowserContext,
  ): Promise<PageCapture[]> {
    const results = await this.queue.runAll(
      pages.map(p => () => this.capturePage(p, context)),
    );

    return results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return this.buildFailedCapture(pages[i], Date.now(), [
        { type: 'navigation', message: String((r as PromiseRejectedResult).reason), attempts: 1 },
      ]);
    });
  }

  async capturePage(
    discoveredPage: DiscoveredPage,
    context:        BrowserContext,
  ): Promise<PageCapture> {
    const startMs = Date.now();
    const errors: CaptureError[] = [];
    let browserPage: PlaywrightPage | null = null;

    try {
      browserPage = await context.newPage();

      const navigated = await this.navigate(browserPage, discoveredPage.url, errors);
      if (!navigated) {
        return this.buildFailedCapture(discoveredPage, startMs, errors);
      }

      const viewport = this.screenshotCapture.getViewport(browserPage);

      // RF7: resolve output paths before capture — no Buffer ever lives
      // beyond a single captureXxxToPath call.
      const { fullFilePath, viewportFilePath } = this.buildPaths(discoveredPage.id);

      // Capture all three in parallel; individual failures don't abort others.
      const [fullBytes, viewBytes, dom] = await Promise.all([
        this.capture('full-screenshot', errors, () =>
          this.screenshotCapture.captureFullToPath(browserPage!, fullFilePath, {
            encoding: this.config.screenshotEncoding,
            quality:  this.config.screenshotQuality,
          }),
        ),
        this.capture('viewport-screenshot', errors, () =>
          this.screenshotCapture.captureViewportToPath(browserPage!, viewportFilePath, {
            encoding: this.config.screenshotEncoding,
            quality:  this.config.screenshotQuality,
          }),
        ),
        this.capture('dom-snapshot', errors, () =>
          this.domExtractor.extract(browserPage!),
        ),
      ]);

      // A path is only stored when the corresponding capture succeeded.
      const screenshot: ScreenshotData = {
        fullPath:     fullBytes     !== null ? fullFilePath     : null,
        viewportPath: viewBytes     !== null ? viewportFilePath : null,
        encoding:     this.config.screenshotEncoding,
      };

      const resolvedDom: DOMSnapshot = dom ?? nullDom(discoveredPage);
      const finalUrl = browserPage.url();

      return {
        pageId: discoveredPage.id,
        screenshot,
        dom:    resolvedDom,
        metadata: {
          capturedAt:              new Date().toISOString(),
          durationMs:              Date.now() - startMs,
          status:                  deriveStatus(fullBytes, viewBytes, dom),
          errors,
          viewportWidth:           viewport.width,
          viewportHeight:          viewport.height,
          pageTitle:               resolvedDom.title || discoveredPage.title,
          finalUrl,
          htmlSizeBytes:           Buffer.byteLength(resolvedDom.html, 'utf-8'),
          fullScreenshotBytes:     fullBytes  ?? 0,
          viewportScreenshotBytes: viewBytes  ?? 0,
        },
      };
    } catch (err) {
      errors.push({
        type:     'navigation',
        message:  err instanceof Error ? err.message : String(err),
        attempts: 1,
      });
      return this.buildFailedCapture(discoveredPage, startMs, errors);
    } finally {
      await browserPage?.close().catch(() => undefined);
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * RF7: Deterministic output paths for one page.
   * Pattern: {outputDir}/screenshots/{sanitized-pageId}/{full|viewport}.{ext}
   */
  private buildPaths(pageId: string): {
    fullFilePath:     string;
    viewportFilePath: string;
  } {
    const ext = this.config.screenshotEncoding === 'jpeg' ? 'jpg' : 'png';
    const dir = nodePath.join(
      this.config.outputDir,
      'screenshots',
      sanitizeId(pageId),
    );
    return {
      fullFilePath:     nodePath.join(dir, `full.${ext}`),
      viewportFilePath: nodePath.join(dir, `viewport.${ext}`),
    };
  }

  private async navigate(
    page:   PlaywrightPage,
    url:    string,
    errors: CaptureError[],
  ): Promise<boolean> {
    let attempts = 0;
    try {
      await this.retry.execute(async () => {
        attempts++;
        await page.goto(url, {
          waitUntil: this.config.waitUntil,
          timeout:   this.config.navigationTimeoutMs,
        });
      }, this.config.retry);
      return true;
    } catch (err) {
      errors.push({
        type:     'navigation',
        message:  err instanceof Error ? err.message : String(err),
        attempts,
      });
      return false;
    }
  }

  private async capture<T>(
    errorType: CaptureErrorType,
    errors:    CaptureError[],
    fn:        () => Promise<T>,
  ): Promise<T | null> {
    let attempts = 0;
    try {
      return await this.retry.execute(async () => {
        attempts++;
        return fn();
      }, this.config.retry);
    } catch (err) {
      errors.push({
        type:     errorType,
        message:  err instanceof Error ? err.message : String(err),
        attempts,
      });
      return null;
    }
  }

  private buildFailedCapture(
    page:    DiscoveredPage,
    startMs: number,
    errors:  CaptureError[],
  ): PageCapture {
    return {
      pageId:     page.id,
      screenshot: nullScreenshot(this.config.screenshotEncoding),
      dom:        nullDom(page),
      metadata: {
        capturedAt:              new Date().toISOString(),
        durationMs:              Date.now() - startMs,
        status:                  'failed',
        errors,
        viewportWidth:           0,
        viewportHeight:          0,
        pageTitle:               page.title,
        finalUrl:                page.url,
        htmlSizeBytes:           0,
        fullScreenshotBytes:     0,
        viewportScreenshotBytes: 0,
      },
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Replace characters unsafe in file system paths with underscores. */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Derive overall capture status from the three concurrent sub-results.
 * `fullBytes` / `viewportBytes` are file sizes (number) on success, null on failure.
 */
function deriveStatus(
  fullBytes:     number | null,
  viewportBytes: number | null,
  dom:           DOMSnapshot | null,
): CaptureStatus {
  const hits = [fullBytes, viewportBytes, dom].filter(v => v !== null).length;
  if (hits === 3) return 'success';
  if (hits === 0) return 'failed';
  return 'partial';
}
