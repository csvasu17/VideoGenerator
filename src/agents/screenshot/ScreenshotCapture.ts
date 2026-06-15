import { mkdir, stat } from 'fs/promises';
import * as nodePath from 'path';
import type { Page } from 'playwright';

export type ImageEncoding = 'png' | 'jpeg';

export interface CaptureOptions {
  encoding: ImageEncoding;
  /** JPEG quality 0–100. Ignored for PNG. */
  quality?: number;
  /** Maximum time in ms to wait for the screenshot to complete. */
  timeoutMs?: number;
  /**
   * Whether to capture at CSS pixels ('css', the browser default) or at
   * physical device pixels ('device').  Defaults to 'device' so that a
   * BrowserContext created with deviceScaleFactor: 2 produces 3840×2160
   * screenshots rather than the logical 1920×1080.  Set to 'css' if you
   * need the smaller file and sharpness-at-zoom is not required.
   */
  scale?: 'css' | 'device';
}

const DEFAULTS: Required<CaptureOptions> = {
  encoding:  'png',
  quality:   85,
  timeoutMs: 30_000,
  scale:     'device',
};

export class ScreenshotCapture {
  // ── In-memory helpers (kept for utility / backward compat) ────────────────

  /** Capture the current viewport only (no scroll). Returns raw Buffer. */
  async captureViewport(page: Page, options: Partial<CaptureOptions> = {}): Promise<Buffer> {
    const opts = { ...DEFAULTS, ...options };
    return page.screenshot({
      fullPage: false,
      type:     opts.encoding,
      scale:    opts.scale,
      ...(opts.encoding === 'jpeg' ? { quality: opts.quality } : {}),
      timeout:  opts.timeoutMs,
    });
  }

  /** Capture the entire scrollable page. Returns raw Buffer. */
  async captureFull(page: Page, options: Partial<CaptureOptions> = {}): Promise<Buffer> {
    const opts = { ...DEFAULTS, ...options };
    return page.screenshot({
      fullPage: true,
      type:     opts.encoding,
      scale:    opts.scale,
      ...(opts.encoding === 'jpeg' ? { quality: opts.quality } : {}),
      timeout:  opts.timeoutMs,
    });
  }

  // ── RF7: disk-based capture (no Buffer held in memory after the call) ─────

  /**
   * Capture the full-page screenshot and write it directly to `filePath`.
   *
   * Playwright streams the image from the browser process straight to disk.
   * The Buffer it returns internally is discarded so it never accumulates in
   * the Node.js heap across multiple pages.
   *
   * @returns File size in bytes — stored in `CaptureMetadata.fullScreenshotBytes`.
   */
  async captureFullToPath(
    page:     Page,
    filePath: string,
    options:  Partial<CaptureOptions> = {},
  ): Promise<number> {
    const opts = { ...DEFAULTS, ...options };
    await mkdir(nodePath.dirname(filePath), { recursive: true });
    await page.screenshot({
      path:     filePath,
      fullPage: true,
      type:     opts.encoding,
      scale:    opts.scale,
      ...(opts.encoding === 'jpeg' ? { quality: opts.quality } : {}),
      timeout:  opts.timeoutMs,
    });
    const { size } = await stat(filePath);
    return size;
  }

  /**
   * Capture the viewport screenshot and write it directly to `filePath`.
   * @returns File size in bytes.
   */
  async captureViewportToPath(
    page:     Page,
    filePath: string,
    options:  Partial<CaptureOptions> = {},
  ): Promise<number> {
    const opts = { ...DEFAULTS, ...options };
    await mkdir(nodePath.dirname(filePath), { recursive: true });
    await page.screenshot({
      path:     filePath,
      fullPage: false,
      type:     opts.encoding,
      scale:    opts.scale,
      ...(opts.encoding === 'jpeg' ? { quality: opts.quality } : {}),
      timeout:  opts.timeoutMs,
    });
    const { size } = await stat(filePath);
    return size;
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  /** Returns the current viewport dimensions; falls back to 1280×720. */
  getViewport(page: Page): { width: number; height: number } {
    return page.viewportSize() ?? { width: 1280, height: 720 };
  }
}
