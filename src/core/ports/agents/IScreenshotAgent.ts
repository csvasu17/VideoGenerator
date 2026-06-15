import type { BrowserContext } from 'playwright';
import type { DiscoveredPage } from '../../domain/entities/DiscoveredPage';
import type { PageCapture } from '../../domain/entities/PageCapture';

export interface IScreenshotAgent {
  /**
   * Capture screenshots and DOM snapshots for all pages concurrently.
   * Always resolves — individual page failures are recorded in PageCapture.metadata.errors.
   */
  captureAll(pages: DiscoveredPage[], context: BrowserContext): Promise<PageCapture[]>;

  /**
   * Capture a single page. Never rejects — returns a 'failed' status capture on error.
   */
  capturePage(page: DiscoveredPage, context: BrowserContext): Promise<PageCapture>;
}
