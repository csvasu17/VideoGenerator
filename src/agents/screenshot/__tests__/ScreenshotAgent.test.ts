import * as nodePath from 'path';
import type { BrowserContext, Page as PlaywrightPage } from 'playwright';
import type { DiscoveredPage } from '../../../core/domain/entities/DiscoveredPage';
import type { DOMSnapshot } from '../../../core/domain/entities/PageCapture';
import { DOMExtractor } from '../DOMExtractor';
import { ScreenshotCapture } from '../ScreenshotCapture';
import { ScreenshotAgent } from '../ScreenshotAgent';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Synthetic output directory — mocks intercept before any real I/O. */
const TEST_OUTPUT_DIR = '/tmp/rf7-test-shots';
/** Expected file size returned by the mocked captureXxxToPath helpers. */
const FAKE_FULL_BYTES     = 1024;
const FAKE_VIEWPORT_BYTES = 512;

const FAKE_HTML = '<html><body>Test</body></html>';

const FAKE_DOM_EVAL: Omit<DOMSnapshot, 'html'> = {
  title:        'Test Page',
  url:          'https://app.test/page',
  textContent:  'Test content',
  headings:     ['Heading 1'],
  links:        [{ text: 'Link', href: 'https://app.test/other' }],
  formCount:    0,
  inputCount:   0,
  buttonCount:  1,
  imageCount:   0,
  ariaLandmarks: ['navigation'],
};

// ── Factory helpers ───────────────────────────────────────────────────────────

function makePage(overrides: Partial<Record<string, jest.Mock>> = {}): jest.Mocked<PlaywrightPage> {
  return {
    goto:         jest.fn().mockResolvedValue(null),
    screenshot:   jest.fn().mockResolvedValue(Buffer.alloc(0)),
    content:      jest.fn().mockResolvedValue(FAKE_HTML),
    evaluate:     jest.fn().mockResolvedValue(FAKE_DOM_EVAL),
    viewportSize: jest.fn().mockReturnValue({ width: 1280, height: 720 }),
    url:          jest.fn().mockReturnValue('https://app.test/page'),
    close:        jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as jest.Mocked<PlaywrightPage>;
}

function makeContext(page: jest.Mocked<PlaywrightPage>): jest.Mocked<BrowserContext> {
  return {
    newPage: jest.fn().mockResolvedValue(page),
  } as unknown as jest.Mocked<BrowserContext>;
}

function makeDiscoveredPage(overrides: Partial<DiscoveredPage> = {}): DiscoveredPage {
  return {
    id:                  'page-1',
    url:                 'https://app.test/page',
    title:               'Test Page',
    depth:               1,
    visitOrder:          0,
    outboundLinks:       [],
    interactiveElements: [],
    hasForm:             false,
    httpStatus:          200,
    ...overrides,
  };
}

function makeAgent(config: Partial<ConstructorParameters<typeof ScreenshotAgent>[2]> = {}) {
  const screenshotCapture = new ScreenshotCapture();
  const domExtractor      = new DOMExtractor();
  return {
    agent: new ScreenshotAgent(
      screenshotCapture,
      domExtractor,
      {
        outputDir: TEST_OUTPUT_DIR,
        retry:     { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, jitter: false },
        ...config,
      },
    ),
    screenshotCapture,
    domExtractor,
  };
}

// Spy helper — uses `any` to avoid Jest 30 strict generic inference narrowing
// return type to `never` when casting through `Record<string, unknown>`.
function spyOn<T extends object>(obj: T, method: keyof T) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return jest.spyOn(obj as any, method as any);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Expected full-page path for page-1 with the default TEST_OUTPUT_DIR. */
function expectedFullPath(pageId = 'page-1') {
  return nodePath.join(TEST_OUTPUT_DIR, 'screenshots', pageId, 'full.png');
}
function expectedViewportPath(pageId = 'page-1') {
  return nodePath.join(TEST_OUTPUT_DIR, 'screenshots', pageId, 'viewport.png');
}

// ── Success path ──────────────────────────────────────────────────────────────

describe('successful capture', () => {
  it('returns a PageCapture with status success', async () => {
    const browserPage = makePage();
    const context = makeContext(browserPage);
    const { agent, screenshotCapture, domExtractor } = makeAgent();

    spyOn(screenshotCapture, 'captureFullToPath').mockResolvedValue(FAKE_FULL_BYTES);
    spyOn(screenshotCapture, 'captureViewportToPath').mockResolvedValue(FAKE_VIEWPORT_BYTES);
    spyOn(domExtractor, 'extract').mockResolvedValue({ html: FAKE_HTML, ...FAKE_DOM_EVAL });

    const capture = await agent.capturePage(makeDiscoveredPage(), context);

    expect(capture.metadata.status).toBe('success');
    // RF7: paths stored, not Buffers
    expect(capture.screenshot.fullPath).toBe(expectedFullPath());
    expect(capture.screenshot.viewportPath).toBe(expectedViewportPath());
    expect(capture.dom.html).toBe(FAKE_HTML);
    expect(capture.metadata.errors).toHaveLength(0);
  });

  it('stores file sizes in metadata', async () => {
    const browserPage = makePage();
    const context = makeContext(browserPage);
    const { agent, screenshotCapture, domExtractor } = makeAgent();

    spyOn(screenshotCapture, 'captureFullToPath').mockResolvedValue(FAKE_FULL_BYTES);
    spyOn(screenshotCapture, 'captureViewportToPath').mockResolvedValue(FAKE_VIEWPORT_BYTES);
    spyOn(domExtractor, 'extract').mockResolvedValue({ html: FAKE_HTML, ...FAKE_DOM_EVAL });

    const capture = await agent.capturePage(makeDiscoveredPage(), context);

    expect(capture.metadata.fullScreenshotBytes).toBe(FAKE_FULL_BYTES);
    expect(capture.metadata.viewportScreenshotBytes).toBe(FAKE_VIEWPORT_BYTES);
  });

  it('populates metadata correctly', async () => {
    const browserPage = makePage();
    const context = makeContext(browserPage);
    const { agent, screenshotCapture, domExtractor } = makeAgent();

    spyOn(screenshotCapture, 'captureFullToPath').mockResolvedValue(FAKE_FULL_BYTES);
    spyOn(screenshotCapture, 'captureViewportToPath').mockResolvedValue(FAKE_VIEWPORT_BYTES);
    spyOn(domExtractor, 'extract').mockResolvedValue({ html: FAKE_HTML, ...FAKE_DOM_EVAL });

    const capture = await agent.capturePage(makeDiscoveredPage(), context);

    expect(capture.pageId).toBe('page-1');
    expect(capture.metadata.viewportWidth).toBe(1280);
    expect(capture.metadata.viewportHeight).toBe(720);
    expect(capture.metadata.durationMs).toBeGreaterThanOrEqual(0);
    expect(() => new Date(capture.metadata.capturedAt)).not.toThrow();
  });

  it('closes the browser page after success', async () => {
    const browserPage = makePage();
    const context = makeContext(browserPage);
    const { agent, screenshotCapture, domExtractor } = makeAgent();

    spyOn(screenshotCapture, 'captureFullToPath').mockResolvedValue(FAKE_FULL_BYTES);
    spyOn(screenshotCapture, 'captureViewportToPath').mockResolvedValue(FAKE_VIEWPORT_BYTES);
    spyOn(domExtractor, 'extract').mockResolvedValue({ html: FAKE_HTML, ...FAKE_DOM_EVAL });

    await agent.capturePage(makeDiscoveredPage(), context);
    expect(browserPage.close).toHaveBeenCalledTimes(1);
  });

  it('passes the resolved output path to captureFullToPath', async () => {
    const browserPage = makePage();
    const context = makeContext(browserPage);
    const { agent, screenshotCapture, domExtractor } = makeAgent();

    const fullSpy = spyOn(screenshotCapture, 'captureFullToPath').mockResolvedValue(FAKE_FULL_BYTES);
    spyOn(screenshotCapture, 'captureViewportToPath').mockResolvedValue(FAKE_VIEWPORT_BYTES);
    spyOn(domExtractor, 'extract').mockResolvedValue({ html: FAKE_HTML, ...FAKE_DOM_EVAL });

    await agent.capturePage(makeDiscoveredPage(), context);

    expect(fullSpy).toHaveBeenCalledWith(
      browserPage,
      expectedFullPath(),
      expect.objectContaining({ encoding: 'png' }),
    );
  });
});

// ── Navigation failure ────────────────────────────────────────────────────────

describe('navigation failure', () => {
  it('returns a failed capture when goto rejects', async () => {
    const browserPage = makePage({
      goto: jest.fn().mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED')),
    });
    const context = makeContext(browserPage);
    const { agent } = makeAgent();

    const capture = await agent.capturePage(makeDiscoveredPage(), context);

    expect(capture.metadata.status).toBe('failed');
    // RF7: no paths on failure
    expect(capture.screenshot.fullPath).toBeNull();
    expect(capture.screenshot.viewportPath).toBeNull();
    expect(capture.metadata.errors).toHaveLength(1);
    expect(capture.metadata.errors[0].type).toBe('navigation');
    expect(capture.metadata.errors[0].message).toContain('ERR_CONNECTION_REFUSED');
  });

  it('never throws — always returns a PageCapture', async () => {
    const context = {
      newPage: jest.fn().mockRejectedValue(new Error('Context destroyed')),
    } as unknown as BrowserContext;

    const { agent } = makeAgent();
    await expect(agent.capturePage(makeDiscoveredPage(), context)).resolves.toBeDefined();
  });

  it('closes the page even after navigation failure', async () => {
    const browserPage = makePage({
      goto: jest.fn().mockRejectedValue(new Error('timeout')),
    });
    const context = makeContext(browserPage);
    const { agent } = makeAgent();

    await agent.capturePage(makeDiscoveredPage(), context);
    expect(browserPage.close).toHaveBeenCalled();
  });
});

// ── Partial failure ───────────────────────────────────────────────────────────

describe('partial capture failure', () => {
  it('returns partial status when full screenshot fails', async () => {
    const browserPage = makePage();
    const context = makeContext(browserPage);
    const { agent, screenshotCapture, domExtractor } = makeAgent();

    spyOn(screenshotCapture, 'captureFullToPath').mockRejectedValue(new Error('screenshot error'));
    spyOn(screenshotCapture, 'captureViewportToPath').mockResolvedValue(FAKE_VIEWPORT_BYTES);
    spyOn(domExtractor, 'extract').mockResolvedValue({ html: FAKE_HTML, ...FAKE_DOM_EVAL });

    const capture = await agent.capturePage(makeDiscoveredPage(), context);

    expect(capture.metadata.status).toBe('partial');
    // Full failed → path is null; viewport succeeded → path is set
    expect(capture.screenshot.fullPath).toBeNull();
    expect(capture.screenshot.viewportPath).toBe(expectedViewportPath());
    expect(capture.metadata.errors[0].type).toBe('full-screenshot');
  });

  it('returns partial status when DOM extraction fails', async () => {
    const browserPage = makePage();
    const context = makeContext(browserPage);
    const { agent, screenshotCapture, domExtractor } = makeAgent();

    spyOn(screenshotCapture, 'captureFullToPath').mockResolvedValue(FAKE_FULL_BYTES);
    spyOn(screenshotCapture, 'captureViewportToPath').mockResolvedValue(FAKE_VIEWPORT_BYTES);
    spyOn(domExtractor, 'extract').mockRejectedValue(new Error('evaluate failed'));

    const capture = await agent.capturePage(makeDiscoveredPage(), context);

    expect(capture.metadata.status).toBe('partial');
    expect(capture.dom.html).toBe('');
    expect(capture.metadata.errors[0].type).toBe('dom-snapshot');
  });

  it('records correct attempt count from retry', async () => {
    const browserPage = makePage();
    const context = makeContext(browserPage);
    const { agent, screenshotCapture, domExtractor } = makeAgent({
      retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, jitter: false },
    });

    spyOn(screenshotCapture, 'captureFullToPath').mockRejectedValue(new Error('always fails'));
    spyOn(screenshotCapture, 'captureViewportToPath').mockResolvedValue(FAKE_VIEWPORT_BYTES);
    spyOn(domExtractor, 'extract').mockResolvedValue({ html: FAKE_HTML, ...FAKE_DOM_EVAL });

    const capture = await agent.capturePage(makeDiscoveredPage(), context);

    const fullError = capture.metadata.errors.find(e => e.type === 'full-screenshot');
    expect(fullError).toBeDefined();
    expect(fullError!.attempts).toBe(3);
  });
});

// ── Retry behaviour ───────────────────────────────────────────────────────────

describe('retry', () => {
  it('succeeds on the second attempt after transient failure', async () => {
    const browserPage = makePage();
    const context = makeContext(browserPage);
    const { agent, screenshotCapture, domExtractor } = makeAgent({
      retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, jitter: false },
    });

    let calls = 0;
    spyOn(screenshotCapture, 'captureFullToPath').mockImplementation(() => {
      calls++;
      return calls === 1
        ? Promise.reject(new Error('transient'))
        : Promise.resolve(FAKE_FULL_BYTES);
    });
    spyOn(screenshotCapture, 'captureViewportToPath').mockResolvedValue(FAKE_VIEWPORT_BYTES);
    spyOn(domExtractor, 'extract').mockResolvedValue({ html: FAKE_HTML, ...FAKE_DOM_EVAL });

    const capture = await agent.capturePage(makeDiscoveredPage(), context);

    expect(capture.metadata.status).toBe('success');
    expect(calls).toBe(2);
    expect(capture.screenshot.fullPath).toBe(expectedFullPath());
  });
});

// ── captureAll ────────────────────────────────────────────────────────────────

describe('captureAll', () => {
  it('returns one PageCapture per input page', async () => {
    const pages = [
      makeDiscoveredPage({ id: 'p1', url: 'https://app.test/1' }),
      makeDiscoveredPage({ id: 'p2', url: 'https://app.test/2' }),
      makeDiscoveredPage({ id: 'p3', url: 'https://app.test/3' }),
    ];
    const browserPage = makePage();
    const context = makeContext(browserPage);
    const { agent, screenshotCapture, domExtractor } = makeAgent({ concurrency: 2 });

    spyOn(screenshotCapture, 'captureFullToPath').mockResolvedValue(FAKE_FULL_BYTES);
    spyOn(screenshotCapture, 'captureViewportToPath').mockResolvedValue(FAKE_VIEWPORT_BYTES);
    spyOn(domExtractor, 'extract').mockResolvedValue({ html: FAKE_HTML, ...FAKE_DOM_EVAL });

    const captures = await agent.captureAll(pages, context);

    expect(captures).toHaveLength(3);
    expect(captures.map(c => c.metadata.status)).toEqual(['success', 'success', 'success']);
  });

  it('returns failed captures for failing pages without aborting the batch', async () => {
    const pages = [
      makeDiscoveredPage({ id: 'ok',  url: 'https://app.test/ok' }),
      makeDiscoveredPage({ id: 'bad', url: 'https://app.test/bad' }),
    ];

    let callCount = 0;
    const context = {
      newPage: jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 2) return Promise.reject(new Error('Page limit reached'));
        return Promise.resolve(makePage());
      }),
    } as unknown as BrowserContext;

    const { agent, screenshotCapture, domExtractor } = makeAgent();
    spyOn(screenshotCapture, 'captureFullToPath').mockResolvedValue(FAKE_FULL_BYTES);
    spyOn(screenshotCapture, 'captureViewportToPath').mockResolvedValue(FAKE_VIEWPORT_BYTES);
    spyOn(domExtractor, 'extract').mockResolvedValue({ html: FAKE_HTML, ...FAKE_DOM_EVAL });

    const captures = await agent.captureAll(pages, context);

    expect(captures).toHaveLength(2);
    expect(captures[0].metadata.status).toBe('success');
    expect(captures[1].metadata.status).toBe('failed');
  });

  it('respects concurrency — never exceeds the limit', async () => {
    const CONCURRENCY = 2;
    const PAGE_COUNT  = 6;
    let peakActive    = 0;
    let currentActive = 0;

    const pages = Array.from({ length: PAGE_COUNT }, (_, i) =>
      makeDiscoveredPage({ id: `p${i}`, url: `https://app.test/${i}` }),
    );

    const context = {
      newPage: jest.fn().mockImplementation(async () => {
        currentActive++;
        peakActive = Math.max(peakActive, currentActive);
        await new Promise(r => setTimeout(r, 5));
        currentActive--;
        return makePage();
      }),
    } as unknown as BrowserContext;

    const { agent, screenshotCapture, domExtractor } = makeAgent({ concurrency: CONCURRENCY });
    spyOn(screenshotCapture, 'captureFullToPath').mockResolvedValue(FAKE_FULL_BYTES);
    spyOn(screenshotCapture, 'captureViewportToPath').mockResolvedValue(FAKE_VIEWPORT_BYTES);
    spyOn(domExtractor, 'extract').mockResolvedValue({ html: FAKE_HTML, ...FAKE_DOM_EVAL });

    await agent.captureAll(pages, context);

    expect(peakActive).toBeLessThanOrEqual(CONCURRENCY);
  });
});

// ── CaptureQueue isolation unit test ─────────────────────────────────────────

describe('CaptureQueue', () => {
  it('queues excess tasks and processes them as slots free', async () => {
    const { CaptureQueue } = await import('../CaptureQueue');
    const q = new CaptureQueue(2);
    const order: number[] = [];

    await Promise.all(
      [1, 2, 3, 4].map(n => q.run(async () => {
        await new Promise(r => setTimeout(r, 5));
        order.push(n);
      })),
    );

    expect(order).toHaveLength(4);
    expect(q.activeCount).toBe(0);
    expect(q.queuedCount).toBe(0);
  });
});

// ── RetryPolicy isolation unit test ──────────────────────────────────────────

describe('RetryPolicy', () => {
  it('retries the configured number of times then throws', async () => {
    const { RetryPolicy } = await import('../RetryPolicy');
    const policy = new RetryPolicy();
    let calls = 0;

    await expect(
      policy.execute(
        async () => {
          calls++;
          throw new Error('always');
        },
        { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, jitter: false },
      ),
    ).rejects.toThrow('always');

    expect(calls).toBe(3);
  });

  it('resolves immediately on first success', async () => {
    const { RetryPolicy } = await import('../RetryPolicy');
    const policy = new RetryPolicy();
    let calls = 0;

    const result = await policy.execute(async () => {
      calls++;
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });
});
