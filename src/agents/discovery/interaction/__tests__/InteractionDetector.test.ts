// ─────────────────────────────────────────────────────────────────────────────
// InteractionDetector — integration tests
//
// Requires a real Chromium browser (Playwright) and a local HTTP server.
// Tests the three-pass detection pipeline:
//   Pass 1 — ARIA   (high confidence)
//   Pass 2 — Structural (stub in MVID)
//   Pass 3 — Visual (VisualGroupDetector)
// ─────────────────────────────────────────────────────────────────────────────

import * as http    from 'http';
import * as fs      from 'fs';
import * as path    from 'path';
import * as os      from 'os';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { InteractionDetector } from '../InteractionDetector';

// ── Constants ─────────────────────────────────────────────────────────────────

const FIXTURES_DIR = path.join(__dirname, '__fixtures__');
const TEST_TIMEOUT = 60_000;  // 60 s — browser cold-start included

// ── Shared infrastructure ─────────────────────────────────────────────────────

let server: http.Server;
let serverPort: number;
let browser: Browser;
let tmpDir: string;

beforeAll(async () => {
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

  browser  = await chromium.launch({ headless: true });
  tmpDir   = fs.mkdtempSync(path.join(os.tmpdir(), 'mvid-detector-'));
}, TEST_TIMEOUT);

afterAll(async () => {
  await browser.close();
  server.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function fixtureUrl(filename: string): string {
  return `http://127.0.0.1:${serverPort}/${filename}`;
}

async function newPage(): Promise<Page> {
  const ctx = await browser.newContext();
  return ctx.newPage();
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('InteractionDetector', () => {

  // ── Test 1: ARIA fixture → ARIA-detected tabs + accordions ───────────────
  it('detects ≥5 targets on the ARIA fixture (≥2 TAB_TRIGGER, ≥2 ACCORDION_HEADER)', async () => {
    const page = await newPage();
    await page.goto(fixtureUrl('tabs-and-accordions.html'), { waitUntil: 'load' });

    const detector = new InteractionDetector();
    const targets  = await detector.detect(page);

    await page.context().close();

    expect(targets.length).toBeGreaterThanOrEqual(5);

    const tabTriggers    = targets.filter(t => t.interactionClass === 'TAB_TRIGGER');
    const accordionHeaders = targets.filter(t => t.interactionClass === 'ACCORDION_HEADER');

    expect(tabTriggers.length).toBeGreaterThanOrEqual(2);
    expect(accordionHeaders.length).toBeGreaterThanOrEqual(2);

    // All targets on an ARIA-only fixture must be detected via the ARIA pass
    for (const target of targets) {
      expect(target.detectionMethod).toBe('aria');
    }
  }, TEST_TIMEOUT);

  // ── Test 2: No-ARIA fixture → VISUAL_TAB_CANDIDATE targets only ───────────
  it('detects ≥2 VISUAL_TAB_CANDIDATE targets on the no-ARIA fixture', async () => {
    const page = await newPage();
    await page.goto(fixtureUrl('tabs-no-aria.html'), { waitUntil: 'load' });

    const detector = new InteractionDetector();
    const targets  = await detector.detect(page);

    await page.context().close();

    const visualCandidates = targets.filter(t => t.interactionClass === 'VISUAL_TAB_CANDIDATE');

    expect(visualCandidates.length).toBeGreaterThanOrEqual(2);

    for (const target of visualCandidates) {
      expect(target.detectionMethod).toBe('visual');
    }
  }, TEST_TIMEOUT);

  // ── Test 3: visualDetection:false suppresses VISUAL_TAB_CANDIDATE ─────────
  it('returns zero VISUAL_TAB_CANDIDATE when visualDetection option is false', async () => {
    const page = await newPage();
    // Use the ARIA fixture — it normally produces only ARIA targets.
    // With visualDetection:false the visual pass must not run even when
    // the page happens to have visually-detectable groups.
    await page.goto(fixtureUrl('tabs-and-accordions.html'), { waitUntil: 'load' });

    const detector = new InteractionDetector();
    const targets  = await detector.detect(page, { visualDetection: false });

    await page.context().close();

    const visualCandidates = targets.filter(t => t.interactionClass === 'VISUAL_TAB_CANDIDATE');
    expect(visualCandidates).toHaveLength(0);
  }, TEST_TIMEOUT);

  // ── Test 4: Nav-links-only page → zero targets ────────────────────────────
  it('returns no targets on a page that contains only navigation links', async () => {
    const page = await newPage();
    await page.setContent(`
      <!DOCTYPE html>
      <html><body>
        <nav>
          <a href="/home">Home</a>
          <a href="/about">About</a>
          <a href="/contact">Contact</a>
        </nav>
        <main>
          <h1>Simple page</h1>
          <p>No tabs, accordions, or grouped interactive controls.</p>
        </main>
      </body></html>
    `);

    const detector = new InteractionDetector();
    const targets  = await detector.detect(page);

    await page.context().close();

    expect(targets).toHaveLength(0);
  }, TEST_TIMEOUT);

  // ── Test 5: Merged result respects priority-DESC sort ─────────────────────
  it('returns targets sorted by estimatedPriority descending', async () => {
    const page = await newPage();
    await page.goto(fixtureUrl('tabs-and-accordions.html'), { waitUntil: 'load' });

    const detector = new InteractionDetector();
    const targets  = await detector.detect(page);

    await page.context().close();

    for (let i = 1; i < targets.length; i++) {
      expect(targets[i - 1].estimatedPriority).toBeGreaterThanOrEqual(
        targets[i].estimatedPriority,
      );
    }
  }, TEST_TIMEOUT);

  // ── Test 6: Every target carries a stable id (SHA256-like hex string) ─────
  it('assigns a non-empty stable id to every returned target', async () => {
    const page = await newPage();
    await page.goto(fixtureUrl('tabs-and-accordions.html'), { waitUntil: 'load' });

    const detector = new InteractionDetector();
    const targets  = await detector.detect(page);

    await page.context().close();

    for (const target of targets) {
      expect(typeof target.id).toBe('string');
      expect(target.id.length).toBeGreaterThan(0);
      // Ids must be unique across the result set
    }
    const ids = targets.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  }, TEST_TIMEOUT);
});
