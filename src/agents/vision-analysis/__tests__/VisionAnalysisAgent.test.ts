import { VisionAnalysisAgent } from '../VisionAnalysisAgent';
import { ResponseParser } from '../ResponseParser';
import { ScreenshotEncoder } from '../ScreenshotEncoder';
import { ScreenshotLoader } from '../../screenshot/ScreenshotLoader';
import { MockLLMProvider, buildDefaultResponse } from '../../../infrastructure/llm/MockLLMProvider';
import type { PageCapture, DOMSnapshot } from '../../../core/domain/entities/PageCapture';

// ── Constants ─────────────────────────────────────────────────────────────────

const VISION_PROMPT   = 'Analyze screenshot. DOM: {{DOM_CONTEXT}}';
const DOM_ONLY_PROMPT = 'Analyze DOM only. Content: {{DOM_CONTEXT}}';

const FAKE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
const FAKE_JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic bytes

// RF7: screenshots live on disk; tests use fake paths and a mock loader.
const FAKE_FULL_PATH     = '/fake/screenshots/page-1/full.png';
const FAKE_VIEWPORT_PATH = '/fake/screenshots/page-1/viewport.png';

// ── MockScreenshotLoader ──────────────────────────────────────────────────────
//
// Returns pre-configured Buffers keyed by file path, falling back to FAKE_PNG.
// This lets tests verify that the agent loads the preferred vs. fallback path.

class MockScreenshotLoader extends ScreenshotLoader {
  private readonly files: Map<string, Buffer>;

  constructor(files: Record<string, Buffer> = {}) {
    super();
    this.files = new Map(Object.entries(files));
  }

  override async load(filePath: string | null): Promise<Buffer | null> {
    if (!filePath) return null;
    return this.files.get(filePath) ?? FAKE_PNG;
  }
}

/** Default loader: returns FAKE_PNG for any non-null path. */
function defaultLoader(): MockScreenshotLoader {
  return new MockScreenshotLoader();
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeDom(overrides: Partial<DOMSnapshot> = {}): DOMSnapshot {
  return {
    html:         '<html><body>Test</body></html>',
    title:        'Test Page',
    url:          'https://app.test/page',
    textContent:  'Page text content',
    headings:     ['Dashboard Overview'],
    links:        [],
    formCount:    0,
    inputCount:   0,
    buttonCount:  2,
    imageCount:   0,
    ariaLandmarks: ['navigation'],
    ...overrides,
  };
}

function makeCapture(overrides: Partial<PageCapture> = {}): PageCapture {
  return {
    pageId:     'page-1',
    screenshot: {
      fullPath:     FAKE_FULL_PATH,
      viewportPath: FAKE_VIEWPORT_PATH,
      encoding:     'png',
    },
    dom: makeDom(),
    metadata: {
      capturedAt:              new Date().toISOString(),
      durationMs:              1200,
      status:                  'success',
      errors:                  [],
      viewportWidth:           1280,
      viewportHeight:          720,
      pageTitle:               'Test Page',
      finalUrl:                'https://app.test/page',
      htmlSizeBytes:           500,
      fullScreenshotBytes:     4,
      viewportScreenshotBytes: 4,
    },
    ...overrides,
  };
}

function makeAgent(
  llm:            MockLLMProvider,
  configOverrides: Record<string, unknown> = {},
  loader?:        ScreenshotLoader,
) {
  return new VisionAnalysisAgent(
    llm,
    VISION_PROMPT,
    DOM_ONLY_PROMPT,
    new ScreenshotEncoder(),
    new ResponseParser(),
    { retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, jitter: false }, ...configOverrides },
    loader ?? defaultLoader(),
  );
}

// ── Vision mode ───────────────────────────────────────────────────────────────

describe('vision mode', () => {
  it('returns analysisMode=vision when screenshot paths are set', async () => {
    const llm   = new MockLLMProvider(buildDefaultResponse());
    const agent = makeAgent(llm);

    const result = await agent.analyzePage(makeCapture());

    expect(result.analysisMode).toBe('vision');
  });

  it('passes image to the LLM provider', async () => {
    const llm          = new MockLLMProvider(buildDefaultResponse());
    const completeSpy  = jest.spyOn(llm, 'complete');
    const agent        = makeAgent(llm);

    await agent.analyzePage(makeCapture());

    const [messages] = completeSpy.mock.calls[0];
    const hasImage = messages[0].content.some(c => c.type === 'image');
    expect(hasImage).toBe(true);
  });

  it('prefers viewport screenshot by default', async () => {
    const viewportBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]);
    const fullBuf     = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x02]);

    const loader = new MockScreenshotLoader({
      [FAKE_VIEWPORT_PATH]: viewportBuf,
      [FAKE_FULL_PATH]:     fullBuf,
    });
    const llm         = new MockLLMProvider(buildDefaultResponse());
    const completeSpy = jest.spyOn(llm, 'complete');
    const agent       = makeAgent(llm, {}, loader);

    await agent.analyzePage(makeCapture());

    const [messages]  = completeSpy.mock.calls[0];
    const imageBlock  = messages[0].content.find(c => c.type === 'image');
    expect(imageBlock?.type === 'image' && imageBlock.data).toEqual(viewportBuf);
  });

  it('falls back to full screenshot when viewport path is null', async () => {
    const loader = new MockScreenshotLoader({ [FAKE_FULL_PATH]: FAKE_PNG });
    const llm         = new MockLLMProvider(buildDefaultResponse());
    const completeSpy = jest.spyOn(llm, 'complete');
    const agent       = makeAgent(llm, {}, loader);

    await agent.analyzePage(
      makeCapture({ screenshot: { fullPath: FAKE_FULL_PATH, viewportPath: null, encoding: 'png' } }),
    );

    const [messages] = completeSpy.mock.calls[0];
    const imageBlock = messages[0].content.find(c => c.type === 'image');
    expect(imageBlock?.type === 'image' && imageBlock.data).toEqual(FAKE_PNG);
  });
});

// ── DOM-only mode ─────────────────────────────────────────────────────────────

describe('dom-only fallback', () => {
  it('uses dom-only mode when both screenshot paths are null', async () => {
    const llm   = new MockLLMProvider(buildDefaultResponse());
    const agent = makeAgent(llm);

    const result = await agent.analyzePage(
      makeCapture({ screenshot: { fullPath: null, viewportPath: null, encoding: 'png' } }),
    );

    expect(result.analysisMode).toBe('dom-only');
  });

  it('sends no image block in dom-only mode', async () => {
    const llm         = new MockLLMProvider(buildDefaultResponse());
    const completeSpy = jest.spyOn(llm, 'complete');
    const agent       = makeAgent(llm);

    await agent.analyzePage(
      makeCapture({ screenshot: { fullPath: null, viewportPath: null, encoding: 'png' } }),
    );

    const [messages] = completeSpy.mock.calls[0];
    expect(messages[0].content.every(c => c.type !== 'image')).toBe(true);
  });
});

// ── Response parsing ──────────────────────────────────────────────────────────

describe('response parsing', () => {
  it('parses well-formed JSON from LLM response', async () => {
    const llm   = new MockLLMProvider(buildDefaultResponse());
    const agent = makeAgent(llm);

    const result = await agent.analyzePage(makeCapture());

    expect(result.pagePurpose).toBe('Manage and monitor operational data');
    expect(result.pageCategory).toBe('dashboard');
    expect(result.features).toHaveLength(2);
    expect(result.features[0].featureName).toBe('Real-Time Dashboard');
    expect(result.features[0].importanceScore).toBe(85);
    expect(result.kpiWidgets).toHaveLength(2);
    expect(result.overallImportanceScore).toBe(82);
  });

  it('handles JSON wrapped in markdown code fences', async () => {
    const wrapped = '```json\n' + buildDefaultResponse() + '\n```';
    const llm     = new MockLLMProvider(wrapped);
    const agent   = makeAgent(llm);

    const result = await agent.analyzePage(makeCapture());

    expect(result.pageCategory).toBe('dashboard');
    expect(result.features).toHaveLength(2);
  });

  it('handles JSON with extra text around it', async () => {
    const padded = 'Here is the analysis:\n\n' + buildDefaultResponse() + '\n\nLet me know if you need more.';
    const llm    = new MockLLMProvider(padded);
    const agent  = makeAgent(llm);

    const result = await agent.analyzePage(makeCapture());

    expect(result.pageCategory).toBe('dashboard');
  });

  it('produces a fallback result when LLM returns invalid JSON', async () => {
    const llm   = new MockLLMProvider('Sorry, I cannot analyze this image.');
    const agent = makeAgent(llm);

    const result = await agent.analyzePage(makeCapture());

    expect(result.pageId).toBe('page-1');
    expect(result.pageCategory).toBe('generic');
    expect(result.features).toEqual([]);
  });

  it('clamps importanceScore to 0–100', async () => {
    const clamped = JSON.stringify({
      ...JSON.parse(buildDefaultResponse()),
      overallImportanceScore: 999,
      features: [{ featureName: 'X', businessValue: 'Y', importanceScore: -5, recommendations: [] }],
    });
    const llm   = new MockLLMProvider(clamped);
    const agent = makeAgent(llm);

    const result = await agent.analyzePage(makeCapture());

    expect(result.overallImportanceScore).toBe(100);
    expect(result.features[0].importanceScore).toBe(0);
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe('error handling', () => {
  it('never throws — returns fallback PageIntelligence on LLM error', async () => {
    const llm = new MockLLMProvider();
    jest.spyOn(llm, 'complete').mockRejectedValue(new Error('API unavailable'));
    const agent = makeAgent(llm);

    await expect(agent.analyzePage(makeCapture())).resolves.toBeDefined();
  });

  it('retries on transient LLM failure then succeeds', async () => {
    const llm = new MockLLMProvider();
    let calls = 0;
    jest.spyOn(llm, 'complete').mockImplementation(async () => {
      calls++;
      if (calls === 1) throw new Error('rate limit');
      return buildDefaultResponse();
    });
    const agent = makeAgent(llm, { retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, jitter: false } });

    const result = await agent.analyzePage(makeCapture());

    expect(result.pageCategory).toBe('dashboard');
    expect(calls).toBe(2);
  });

  it('returns fallback after exhausting all retries', async () => {
    const llm = new MockLLMProvider();
    jest.spyOn(llm, 'complete').mockRejectedValue(new Error('persistent failure'));
    const agent = makeAgent(llm, { retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, jitter: false } });

    const result = await agent.analyzePage(makeCapture());

    expect(result.overallImportanceScore).toBe(0);
    expect(result.pagePurpose).toContain('persistent failure');
  });
});

// ── analyzeAll ────────────────────────────────────────────────────────────────

describe('analyzeAll', () => {
  it('returns one PageIntelligence per input capture', async () => {
    const llm     = new MockLLMProvider(buildDefaultResponse());
    const agent   = makeAgent(llm, { concurrency: 2 });
    const captures = Array.from({ length: 4 }, (_, i) => makeCapture({ pageId: `p${i}` }));

    const results = await agent.analyzeAll(captures);

    expect(results).toHaveLength(4);
    expect(results.map(r => r.pageId)).toEqual(['p0', 'p1', 'p2', 'p3']);
  });

  it('returns fallback for failing pages without aborting the batch', async () => {
    const llm = new MockLLMProvider();
    let calls = 0;
    jest.spyOn(llm, 'complete').mockImplementation(async () => {
      calls++;
      // Fail permanently from the 2nd call onwards so that retries also fail,
      // ensuring the 'bad' page exhausts all attempts and returns the fallback.
      if (calls >= 2) throw new Error('fail');
      return buildDefaultResponse();
    });
    const agent = makeAgent(llm);
    const captures = [
      makeCapture({ pageId: 'ok'  }),
      makeCapture({ pageId: 'bad' }),
    ];

    const results = await agent.analyzeAll(captures);

    expect(results).toHaveLength(2);
    expect(results[0].pageCategory).toBe('dashboard');
    expect(results[1].overallImportanceScore).toBe(0);
  });
});

// ── ScreenshotEncoder ─────────────────────────────────────────────────────────

describe('ScreenshotEncoder', () => {
  const encoder = new ScreenshotEncoder();

  it('detects PNG magic bytes', () => {
    expect(encoder.encode(FAKE_PNG).mimeType).toBe('image/png');
  });

  it('detects JPEG magic bytes', () => {
    expect(encoder.encode(FAKE_JPG).mimeType).toBe('image/jpeg');
  });

  it('produces valid base64', () => {
    const b64 = encoder.toBase64(Buffer.from('hello'));
    expect(Buffer.from(b64, 'base64').toString()).toBe('hello');
  });
});

// ── ResponseParser ────────────────────────────────────────────────────────────

describe('ResponseParser', () => {
  const parser = new ResponseParser();

  it('assigns the correct pageId', () => {
    const result = parser.parse(buildDefaultResponse(), 'my-page-id', 'vision');
    expect(result.pageId).toBe('my-page-id');
  });

  it('falls back gracefully on completely empty response', () => {
    const result = parser.parse('', 'p1', 'dom-only');
    expect(result.pagePurpose).toBe('Purpose not determined');
    expect(result.features).toEqual([]);
    expect(result.kpiWidgets).toEqual([]);
  });

  it('coerces unknown pageCategory to generic', () => {
    const json   = JSON.stringify({ ...JSON.parse(buildDefaultResponse()), pageCategory: 'space-station' });
    const result = parser.parse(json, 'p1', 'vision');
    expect(result.pageCategory).toBe('generic');
  });

  it('coerces unknown trend to unknown', () => {
    const json = JSON.stringify({
      ...JSON.parse(buildDefaultResponse()),
      kpiWidgets: [{ label: 'M', value: '42', trend: 'sideways' }],
    });
    const result = parser.parse(json, 'p1', 'vision');
    expect(result.kpiWidgets[0].trend).toBe('unknown');
  });
});
