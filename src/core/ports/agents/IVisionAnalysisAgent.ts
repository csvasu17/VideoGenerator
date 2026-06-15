import type { PageCapture } from '../../domain/entities/PageCapture';
import type { PageIntelligence } from '../../domain/entities/PageIntelligence';

export interface IVisionAnalysisAgent {
  /**
   * Analyse all captures concurrently.
   * Always resolves — individual failures produce a 'generic' fallback PageIntelligence.
   */
  analyzeAll(captures: PageCapture[]): Promise<PageIntelligence[]>;

  /**
   * Analyse a single page capture.
   * Never rejects.
   */
  analyzePage(capture: PageCapture): Promise<PageIntelligence>;
}
