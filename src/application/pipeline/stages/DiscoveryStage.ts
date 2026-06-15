import type { BrowserContext } from 'playwright';
import type { PipelineStage } from '../PipelineStage';
import type { PipelineContext } from '../PipelineContext';
import type { DiscoveredPage } from '../../../core/domain/entities/DiscoveredPage';
import { DiscoveryAgent } from '../../../agents/discovery/DiscoveryAgent';

export interface DiscoveryInput {
  startUrl:  string;
  context:   BrowserContext;
  maxDepth?: number;
  maxPages?: number;
  /**
   * Playwright `waitUntil` used for each discovery page.
   * Default: `'load'` — waits for all scripts to execute (React/Vue render)
   * but does NOT wait for network idle, which would hang on apps with
   * persistent WebSocket / long-polling connections (e.g. socket.io).
   */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  /**
   * Extra URLs pre-seeded into the BFS queue (depth 1).
   * Forwarded verbatim to DiscoveryAgent.discover() — see DiscoveryOptions.
   */
  seedUrls?: string[];
}

export class DiscoveryStage implements PipelineStage<DiscoveryInput, DiscoveredPage[]> {
  readonly name = 'Discovery';

  constructor(private readonly agent: DiscoveryAgent = new DiscoveryAgent()) {}

  async run(input: DiscoveryInput, _ctx: PipelineContext): Promise<DiscoveredPage[]> {
    const pages = await this.agent.discover(input.startUrl, input.context, {
      maxDepth:  input.maxDepth  ?? 3,
      maxPages:  input.maxPages  ?? 50,
      waitUntil: input.waitUntil ?? 'load',
      seedUrls:  input.seedUrls,
    });

    if (pages.length === 0) {
      throw new Error(
        `Discovery found 0 pages starting from ${input.startUrl}. ` +
        `Ensure the authenticated session is valid and the app loads correctly.`,
      );
    }

    return pages;
  }
}
