import type { ILLMProvider, LLMCompletionOptions, LLMMessage } from '../../core/ports/services/ILLMProvider';

/**
 * Deterministic LLM provider for tests and CI.
 * Returns a fixed response by default; individual responses can be queued.
 */
export class MockLLMProvider implements ILLMProvider {
  readonly modelId = 'mock-1.0';
  readonly supportsVision = true;

  private readonly queue: string[] = [];
  private defaultResponse: string;
  private callCount = 0;

  constructor(defaultResponse?: string) {
    this.defaultResponse = defaultResponse ?? buildDefaultResponse();
  }

  /** Queue a specific response for the next call(s). FIFO. */
  queueResponse(response: string): this {
    this.queue.push(response);
    return this;
  }

  /** Set the fallback response once the queue is empty. */
  setDefaultResponse(response: string): this {
    this.defaultResponse = response;
    return this;
  }

  async complete(_messages: LLMMessage[], _options?: LLMCompletionOptions): Promise<string> {
    this.callCount++;
    return this.queue.shift() ?? this.defaultResponse;
  }

  get calls(): number {
    return this.callCount;
  }

  reset(): void {
    this.queue.length = 0;
    this.callCount = 0;
  }
}

export function buildDefaultResponse(): string {
  return JSON.stringify({
    pagePurpose: 'Manage and monitor operational data',
    pageCategory: 'dashboard',
    features: [
      {
        featureName: 'Real-Time Dashboard',
        businessValue: 'Provides instant visibility into operational KPIs, reducing decision latency.',
        importanceScore: 85,
        recommendations: ['Demonstrate live data updates', 'Highlight the time-to-insight reduction'],
      },
      {
        featureName: 'Alert Management',
        businessValue: 'Proactively surfaces issues before they impact customers.',
        importanceScore: 78,
        recommendations: ['Show an active alert being resolved to demonstrate workflow'],
      },
    ],
    importantActions: [
      { label: 'Create Report', intent: 'Generate a shareable performance report', impactLevel: 'high' },
      { label: 'Export Data', intent: 'Download data for external analysis',        impactLevel: 'medium' },
    ],
    businessContext:
      'This dashboard consolidates operational data into a single pane of glass, ' +
      'enabling managers to reduce incident response time and improve team efficiency.',
    kpiWidgets: [
      { label: 'Active Alerts', value: '3',   trend: 'down',    unit: 'count' },
      { label: 'Uptime',        value: '99.8', trend: 'neutral', unit: '%'    },
    ],
    overallImportanceScore: 82,
  });
}
