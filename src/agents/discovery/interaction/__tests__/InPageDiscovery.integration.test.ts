// ─────────────────────────────────────────────────────────────────────────────
// InPageDiscovery — integration tests
//
// These tests use real Playwright + a local HTTP server serving HTML fixtures.
// They validate the complete exploration loop end-to-end.
//
// Test groups:
//   A — ARIA fixture (tabs-and-accordions.html): full discovery, budget, reset
//   B — Visual fixture (tabs-no-aria.html): visual-pass discovery
//   C — Adversarial: empty page, no targets
// ─────────────────────────────────────────────────────────────────────────────

import * as http    from 'http';
import * as fs      from 'fs';
import * as path    from 'path';
import * as os      from 'os';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { InPageDiscovery } from '../InPageDiscovery';

// ── Constants ─────────────────────────────────────────────────────────────────

const FIXTURES_DIR  = path.join(__dirname, '__fixtures__');
const TEST_TIMEOUT  = 60_000;   // 60 s per test (browser startup included)

// ── Local fixture server ──────────────────────────────────────────────────────

let server: http.Server;
let serverPort: number;
let browser: Browser;
let outputDir: string;

beforeAll(async () => {
  // Start a minimal static HTTP server for the HTML fixtures
  server = http.createServer((req, res) => {
    const filename = (req.url ?? '/').replace(/^\//, '') || 'index.html';
    const filePath = path.join(FIXTURES_DIR, filename);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  serverPort = (server.address() as { port: number }).port;

  browser = await chromium.launch({ headless: true });
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvid-integration-'));
}, TEST_TIMEOUT);

afterAll(async () => {
  await browser.close();
  server.close();
  // Clean up screenshots
  try {
    fs.rmSync(outputDir, { recursive: true, force: true });
  } catch { /* ignore cleanup errors */ }
});

function fixtureUrl(filename: string): string {
  return `http://127.0.0.1:${serverPort}/${filename}`;
}

async function newPage(): Promise<Page> {
  const ctx = await browser.newContext();
  return ctx.newPage();
}

// ─────────────────────────────────────────────────────────────────────────────
// Group A — ARIA fixture
// ─────────────────────────────────────────────────────────────────────────────

describe('Group A — ARIA fixture (tabs-and-accordions.html)', () => {

  // ── A1: Full exploration discovers all 4 meaningful states ────────────────
  it('discovers 4 meaningful states: 2 inactive tabs + 2 accordions', async () => {
    const page = await newPage();
    await page.goto(fixtureUrl('tabs-and-accordions.html'), { waitUntil: 'load' });

    const discovery = new InPageDiscovery({ screenshotOutputDir: outputDir });
    const result = await discovery.explorePage(page);

    await page.context().close();

    expect(result.budgetStatus).toBe('completed');
    // Base state (Tab 1 active) + Tab 2 + Tab 3 + Accordion 1 + Accordion 2 = 4 discovered
    expect(result.discoveredStates.length).toBe(4);
    expect(result.totalMeaningful).toBe(4);
    // All discovered states must have exactly one interaction step
    for (const state of result.discoveredStates) {
      expect(state.interactionPath).toHaveLength(1);
      expect(state.depth).toBe(1);
    }
    // Base state has empty interaction path
    expect(result.baseState.interactionPath).toHaveLength(0);
    expect(result.baseState.depth).toBe(0);
  }, TEST_TIMEOUT);

  // ── A2: Budget enforcement — maxStates: 2 ─────────────────────────────────
  it('respects maxStates: 2 budget and reports correct budgetStatus', async () => {
    const page = await newPage();
    await page.goto(fixtureUrl('tabs-and-accordions.html'), { waitUntil: 'load' });

    const discovery = new InPageDiscovery({
      screenshotOutputDir: outputDir,
      maxStates:           2,
    });
    const result = await discovery.explorePage(page);

    await page.context().close();

    expect(result.discoveredStates.length).toBe(2);
    expect(result.budgetStatus).toBe('state-exhausted');
  }, TEST_TIMEOUT);

  // ── A3: Reset integrity — page fingerprint matches base after exploration ──
  it('leaves the page in the base state after full exploration', async () => {
    const page = await newPage();
    await page.goto(fixtureUrl('tabs-and-accordions.html'), { waitUntil: 'load' });

    const discovery = new InPageDiscovery({ screenshotOutputDir: outputDir });
    const result = await discovery.explorePage(page);

    // After exploration: re-capture the page and compare fingerprint to base
    const { StateCapture } = await import('../StateCapture');
    const capture       = new StateCapture(outputDir);
    const postExploration = await capture.capture(page, []);

    await page.context().close();

    expect(postExploration.fingerprint.compositeHash).toBe(
      result.baseState.fingerprint.compositeHash,
    );
  }, TEST_TIMEOUT);

  // ── A4: ARIA detection method recorded in interaction paths ───────────────
  it('records detectionMethod "aria" for ARIA-detected targets', async () => {
    const page = await newPage();
    await page.goto(fixtureUrl('tabs-and-accordions.html'), { waitUntil: 'load' });

    const discovery = new InPageDiscovery({ screenshotOutputDir: outputDir });
    const result = await discovery.explorePage(page);

    await page.context().close();

    const methods = result.discoveredStates.map(s => s.interactionPath[0].detectionMethod);
    expect(methods.every(m => m === 'aria')).toBe(true);
  }, TEST_TIMEOUT);
});

// ─────────────────────────────────────────────────────────────────────────────
// Group B — Visual fixture (no ARIA)
// ─────────────────────────────────────────────────────────────────────────────

describe('Group B — Visual fixture (tabs-no-aria.html)', () => {

  // ── B1: Visual detection discovers 2 hidden tab states ───────────────────
  it('discovers 2 meaningful states via visual detection (no ARIA markup)', async () => {
    const page = await newPage();
    await page.goto(fixtureUrl('tabs-no-aria.html'), { waitUntil: 'load' });

    const discovery = new InPageDiscovery({ screenshotOutputDir: outputDir });
    const result = await discovery.explorePage(page);

    await page.context().close();

    expect(result.discoveredStates.length).toBeGreaterThanOrEqual(2);
    expect(result.totalMeaningful).toBeGreaterThanOrEqual(2);

    // All discovered states should be from visual detection
    for (const state of result.discoveredStates) {
      expect(state.interactionPath[0].detectionMethod).toBe('visual');
      expect(state.interactionPath[0].interactionClass).toBe('VISUAL_TAB_CANDIDATE');
    }
  }, TEST_TIMEOUT);

  // ── B2: Visual reset integrity ────────────────────────────────────────────
  it('leaves the page in the base state after visual exploration', async () => {
    const page = await newPage();
    await page.goto(fixtureUrl('tabs-no-aria.html'), { waitUntil: 'load' });

    const discovery = new InPageDiscovery({ screenshotOutputDir: outputDir });
    const result = await discovery.explorePage(page);

    const { StateCapture } = await import('../StateCapture');
    const capture           = new StateCapture(outputDir);
    const postExploration   = await capture.capture(page, []);

    await page.context().close();

    expect(postExploration.fingerprint.compositeHash).toBe(
      result.baseState.fingerprint.compositeHash,
    );
  }, TEST_TIMEOUT);
});

// ─────────────────────────────────────────────────────────────────────────────
// Group C — Adversarial
// ─────────────────────────────────────────────────────────────────────────────

describe('Group C — Adversarial inputs', () => {

  // ── C1: Page with no interactive targets → empty result, no crash ─────────
  it('returns empty discoveredStates and does not throw for a page with no targets', async () => {
    const page = await newPage();
    // Minimal page with no tabs, accordions, or visual groups
    await page.setContent(`
      <html><body>
        <h1>Plain page</h1>
        <p>No interactive components here.</p>
        <a href="https://example.com">External link</a>
      </body></html>
    `);

    const discovery = new InPageDiscovery({ screenshotOutputDir: outputDir });
    const result    = await discovery.explorePage(page);

    await page.context().close();

    expect(result.discoveredStates).toHaveLength(0);
    expect(result.budgetStatus).toBe('completed');
    expect(result.totalAttempts).toBe(0);
  }, TEST_TIMEOUT);

  // ── C2: Fingerprint stability — two consecutive captures produce same hash ─
  it('produces identical compositeHash for two consecutive captures of the same page', async () => {
    const page = await newPage();
    await page.goto(fixtureUrl('tabs-and-accordions.html'), { waitUntil: 'load' });

    const { StateCapture } = await import('../StateCapture');
    const capture = new StateCapture(outputDir);

    const state1 = await capture.capture(page, []);
    const state2 = await capture.capture(page, []);

    await page.context().close();

    expect(state1.fingerprint.compositeHash).toBe(state2.fingerprint.compositeHash);
  }, TEST_TIMEOUT);
});
