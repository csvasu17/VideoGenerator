// ─────────────────────────────────────────────────────────────────────────────
// StateCapture — screenshot + DOM summary + fingerprint
//
// Given an already-loaded Playwright Page, produces a complete
// PageInteractionState by:
//   1. Taking a viewport screenshot and writing it to disk
//   2. Extracting a lean DomSummary via page.evaluate()
//   3. Building a FunctionalFingerprint via FingerprintBuilder
//
// Screenshot filename = first 16 hex chars of SHA256(buffer).png
// Re-capturing an identical page writes to the same file — safe and
// deduplication-friendly at the filesystem level.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs   from 'fs/promises';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import type { Page } from 'playwright';
import type {
  DomSummary,
  FunctionalFingerprint,
  InteractionStep,
  PageInteractionState,
} from './types';
import { buildFingerprint } from './FingerprintBuilder';

// ── Class ─────────────────────────────────────────────────────────────────────

export class StateCapture {
  constructor(private readonly outputDir: string) {}

  /**
   * Capture a full PageInteractionState for the current page.
   *
   * @param page            Playwright page — must be loaded and stable.
   * @param interactionPath Steps taken to reach this state.  Empty = base state.
   */
  async capture(
    page:             Page,
    interactionPath:  InteractionStep[],
  ): Promise<PageInteractionState> {

    await fs.mkdir(this.outputDir, { recursive: true });

    // Step 1 — Screenshot
    const { screenshotPath, screenshotHash } = await this.captureScreenshot(page);

    // Step 2 — DOM summary
    const domSummary = await this.extractDomSummary(page);

    // Step 3 — Fingerprint
    const fingerprint: FunctionalFingerprint = buildFingerprint(domSummary);

    return {
      id:              randomUUID(),
      pageUrl:         page.url(),
      interactionPath,
      depth:           interactionPath.length,
      screenshotPath,
      screenshotHash,
      domSummary,
      fingerprint,
      capturedAt:      Date.now(),
    };
  }

  // ── Private — screenshot ───────────────────────────────────────────────────

  private async captureScreenshot(
    page: Page,
  ): Promise<{ screenshotPath: string; screenshotHash: string }> {
    const buffer = await page.screenshot({ type: 'png', fullPage: false, timeout: 8_000 });
    const screenshotHash = createHash('sha256').update(buffer).digest('hex');
    const filename = `state-${screenshotHash.slice(0, 16)}.png`;
    const screenshotPath = path.join(this.outputDir, filename);
    await fs.writeFile(screenshotPath, buffer);
    return { screenshotPath, screenshotHash };
  }

  // ── Private — DOM extraction ───────────────────────────────────────────────

  private async extractDomSummary(page: Page): Promise<DomSummary> {
    return page.evaluate((): DomSummary => {

      // ── Headings — visible h1-h6 in document order ──────────────────────────
      const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
        .filter((el): el is HTMLElement => (el as HTMLElement).offsetParent !== null)
        .map(el => ({
          level: parseInt(el.tagName[1], 10),
          text:  (el.textContent ?? '').trim(),
        }))
        .slice(0, 80);

      // ── Visible text tokens from leaf elements ────────────────────────────
      const visibleTextTokens: string[] = [];
      const leafSel = 'p, span, li, td, th, dt, dd, label, caption, figcaption';
      const leafEls = Array.from(document.querySelectorAll(leafSel));

      for (const el of leafEls) {
        if (visibleTextTokens.length >= 2000) break;
        const htmlEl = el as HTMLElement;
        if (htmlEl.offsetParent === null) continue;  // hidden
        if (el.children.length > 0) continue;         // not leaf

        const tokens = (el.textContent ?? '')
          .trim()
          .split(/\s+/)
          .filter(t => t.length > 1);

        for (const t of tokens) {
          if (visibleTextTokens.length >= 2000) break;
          visibleTextTokens.push(t);
        }
      }

      // ── Element counts ─────────────────────────────────────────────────────
      const elementCounts = {
        // Count only elements whose offsetParent is non-null (rendered in
        // the current layout).  Hidden tab panels and collapsed accordions
        // have offsetParent === null, so they are excluded.
        tables:   Array.from(document.querySelectorAll('table'))
                    .filter(el => (el as HTMLElement).offsetParent !== null).length,
        canvases: Array.from(document.querySelectorAll('canvas'))
                    .filter(el => (el as HTMLElement).offsetParent !== null).length,
        // Exclude decorative inline SVG icons via aria-hidden, then filter hidden
        svgs:     Array.from(document.querySelectorAll('svg:not([aria-hidden="true"])'))
                    .filter(el => (el as HTMLElement).offsetParent !== null).length,
        forms:    Array.from(document.querySelectorAll('form'))
                    .filter(el => (el as HTMLElement).offsetParent !== null).length,
        lists:    Array.from(document.querySelectorAll('ul, ol'))
                    .filter(el => (el as HTMLElement).offsetParent !== null).length,
        buttons:  Array.from(document.querySelectorAll('button, [role="button"]'))
                    .filter(el => (el as HTMLElement).offsetParent !== null).length,
        inputs:   Array.from(document.querySelectorAll(
                    'input:not([type="hidden"]), select, textarea',
                  )).filter(el => (el as HTMLElement).offsetParent !== null).length,
      };

      // ── ARIA role counts ────────────────────────────────────────────────────
      const ariaRoleCounts: Record<string, number> = {};
      document.querySelectorAll('[role]').forEach(el => {
        const r = el.getAttribute('role');
        if (r) ariaRoleCounts[r] = (ariaRoleCounts[r] ?? 0) + 1;
      });

      return { headings, visibleTextTokens, elementCounts, ariaRoleCounts };
    });
  }
}
