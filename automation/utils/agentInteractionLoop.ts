/**
 * agentInteractionLoop.ts — per-page exhaustive interaction loop for Agent Recording.
 *
 * Classify-then-act-on-the-same-element-handle discipline: every element is
 * enumerated with a real, unique selector (interactionEnumerator.ts) and classified
 * from that same handle's own text/attributes (interactionSafety.ts) — the loop never
 * re-searches the page by text after classifying, which is the structural fix for the
 * `has-text()` substring trap already hit once in this project's history (a click on
 * "Acknowledge" matched a filter tab labeled "ACKNOWLEDGED" because has-text() searches
 * the whole page by substring; classifying and acting on one already-bound handle can't
 * do that).
 */

import type { Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { enumerateInteractiveElements } from './interactionEnumerator';
import type { EnumeratedElement } from './interactionEnumerator';
import { classifyElement, loadSafetyOverridesFromEnv } from './interactionSafety';
import type { SafetyCategory } from './interactionSafety';
import { generateFillValue } from './syntheticFill';

export interface SkipRecord {
  role:            string;
  pageId:          string;
  pageUrl:         string;
  selector:        string;
  text?:           string;
  ariaLabel?:      string;
  tag:             string;
  category:        'risky-skip';
  matchedPattern?: string;
  reason:          string;
}

export interface AgentPageResult {
  pageId:         string;
  url:            string;
  role:           string;
  startSec:       number;
  endSec:         number;
  elementsFound:  number;
  clicked:        number;
  filled:         number;
  skipped:        SkipRecord[];
  screenshotPath: string;
  truncated:      boolean;
}

const CONSENT_ACCEPT_SELECTOR =
  'button:has-text("Accept & Continue"), button:has-text("Accept All"), ' +
  'button:has-text("I Agree"), button:has-text("I Understand")';

async function suppressPopups(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(200);
  try {
    const checkbox = page.locator('input[type="checkbox"]:visible').first();
    if (await checkbox.isVisible({ timeout: 400 }).catch(() => false)) {
      await checkbox.check({ timeout: 800 }).catch(() => {});
    }
    const accept = page.locator(CONSENT_ACCEPT_SELECTOR).first();
    if (await accept.isVisible({ timeout: 800 }).catch(() => false)) {
      await accept.click({ timeout: 1000 }).catch(() => {});
    }
  } catch { /* best-effort */ }
  await page.keyboard.press('Escape').catch(() => {});
}

function toSafetySignal(el: EnumeratedElement) {
  return {
    tag:            el.tag,
    role:           el.kind === 'tab' ? 'tab' : undefined,
    text:           el.text,
    ariaLabel:      el.ariaLabel,
    title:          el.title,
    inputType:      el.inputType,
    href:           el.href,
    sameOrigin:     el.sameOrigin,
    insideForm:     el.insideForm,
    formFieldCount: el.formFieldCount,
  };
}

export interface AgentPageLoopOptions {
  screenshotDir: string;
  maxElements?:  number;
}

export async function runAgentPageLoop(
  page:    Page,
  pageId:  string,
  url:     string,
  role:    string,
  t0:      number,
  opts:    AgentPageLoopOptions,
): Promise<AgentPageResult> {
  const startSec = (Date.now() - t0) / 1000;
  const skipped: SkipRecord[] = [];
  const overrides = loadSafetyOverridesFromEnv();

  let elementsFound = 0;
  let clicked = 0;
  let filled = 0;
  let truncated = false;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(1200);
    await suppressPopups(page);

    const { elements, truncated: wasTruncated } = await enumerateInteractiveElements(page, { maxElements: opts.maxElements });
    truncated = wasTruncated;
    elementsFound = elements.length;

    // Order: safe-reveal first (settle the page into any tab/accordion states),
    // then form fields, then links last (never clicked here — navigation is owned
    // by the outer BFS crawl, not this per-page loop).
    const classified = elements.map(el => ({ el, classification: classifyElement(toSafetySignal(el), overrides) }));
    const order: Record<SafetyCategory, number> = { 'safe-reveal': 0, 'safe-fill': 1, 'safe-navigate': 2, 'risky-skip': 3 };
    classified.sort((a, b) => order[a.classification.category] - order[b.classification.category]);

    for (const { el, classification } of classified) {
      if (classification.category === 'risky-skip') {
        skipped.push({
          role, pageId, pageUrl: url, selector: el.selector,
          text: el.text, ariaLabel: el.ariaLabel, tag: el.tag,
          category: 'risky-skip', matchedPattern: classification.matchedPattern, reason: classification.reason,
        });
        continue;
      }

      if (classification.category === 'safe-navigate') {
        continue; // logged/queued by the outer DiscoveryAgent BFS, not clicked here
      }

      const locator = page.locator(el.selector).first();

      if (classification.category === 'safe-fill') {
        const fill = generateFillValue({
          label: el.text || el.ariaLabel || el.title || '', inputType: el.inputType,
          tag: el.kind === 'select' ? 'select' : el.kind === 'textarea' ? 'textarea' : 'input',
          options: el.options, placeholder: undefined, required: el.required,
        });
        try {
          if (fill.action === 'fill' && fill.value !== undefined) {
            await locator.click({ timeout: 1500 }).catch(() => {});
            await locator.fill(fill.value, { timeout: 2000 });
            filled++;
          } else if (fill.action === 'select' && fill.value !== undefined) {
            await locator.selectOption({ value: fill.value }, { timeout: 2000 });
            filled++;
          } else if (fill.action === 'check') {
            await locator.check({ timeout: 1500 }).catch(() => {});
            filled++;
          }
          // fill.action === 'skip' → intentionally not filled (password/PII/consent)
        } catch { /* best-effort — a failed fill shouldn't abort the page loop */ }
        continue;
      }

      // safe-reveal
      try {
        await locator.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(250);
        await locator.click({ timeout: 1500 });
        clicked++;
        await page.waitForTimeout(600);
        await suppressPopups(page);
      } catch { /* best-effort — a failed click shouldn't abort the page loop */ }
    }
  } catch { /* navigation failure — fall through and still return a (mostly empty) result */ }

  const screenshotPath = path.join(opts.screenshotDir, `${pageId}.png`);
  try {
    fs.mkdirSync(opts.screenshotDir, { recursive: true });
    await page.screenshot({ path: screenshotPath, type: 'png' });
  } catch { /* best-effort */ }

  const endSec = (Date.now() - t0) / 1000;
  return { pageId, url, role, startSec, endSec, elementsFound, clicked, filled, skipped, screenshotPath, truncated };
}
