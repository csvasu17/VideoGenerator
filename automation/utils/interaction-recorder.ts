/**
 * interaction-recorder.ts — MVID-powered page interaction for video recording.
 *
 * Uses the InteractionDetector (3-pass: ARIA → structural → visual) to discover
 * all clickable in-page controls (tabs, accordions, segmented controls, custom
 * React/Angular/Vue components) and clicks them in priority order with
 * camera-friendly pauses.
 *
 * Unlike InPageDiscovery (which resets between each click to measure state change),
 * this recorder performs a LINEAR cinematic journey:
 *
 *   scroll to target → pause (viewer sees pre-click state)
 *     → click → pause (viewer sees revealed content)
 *       → next target …
 *         → scroll to top (clean clip ending)
 *
 * The result is a natural-looking, demo-quality recording of app exploration.
 *
 * Integration points:
 *   1. explorer.ts — replaces clickAllTabs() + expandSections() in fullInteraction()
 *   2. workflow-recorder.ts — optional post-script phase (opt-in per clip)
 */

import type { Page } from 'playwright';
import { InteractionDetector } from '../../src/agents/discovery/interaction/InteractionDetector';
import type { InteractionTarget } from '../../src/agents/discovery/interaction/types';

// ── Options ────────────────────────────────────────────────────────────────────

export interface MvInteractOptions {
  /** Maximum number of targets to click.  Default: 6. */
  maxTargets?:       number;
  /** Pause BEFORE each click (ms) — camera captures the pre-click state.  Default: 700. */
  pauseBeforeMs?:    number;
  /** Pause AFTER each click (ms) — camera captures the revealed content.  Default: 1_400. */
  pauseAfterMs?:     number;
  /** Run the visual-detection pass (finds tabs with no ARIA markup).  Default: true. */
  visualDetection?:  boolean;
  /** Maximum visual groups per page.  Default: 3. */
  maxVisualGroups?:  number;
  /** Minimum estimatedPriority threshold for clicking.  Default: 0.20. */
  minPriority?:      number;
  /** Log per-click progress to console.  Default: false. */
  verbose?:          boolean;
}

const DEFAULTS: Required<MvInteractOptions> = {
  maxTargets:       6,
  pauseBeforeMs:    700,
  pauseAfterMs:     1_400,
  visualDetection:  true,
  maxVisualGroups:  3,
  minPriority:      0.20,
  verbose:          false,
};

// ── Main entry ─────────────────────────────────────────────────────────────────

/**
 * Discover and cinematically interact with all in-page controls.
 *
 * Returns the number of targets successfully clicked.
 * Never throws — errors on individual targets are silently skipped.
 */
export async function mvInteract(
  page: Page,
  opts: MvInteractOptions = {},
): Promise<number> {
  const o = { ...DEFAULTS, ...opts };

  // ── 1. Detect all in-page targets via 3-pass MVID engine ───────────────────
  const detector = new InteractionDetector();
  let targets: InteractionTarget[];
  try {
    targets = await detector.detect(page, {
      visualDetection: o.visualDetection,
      maxVisualGroups: o.maxVisualGroups,
    });
  } catch {
    return 0;  // Page may have navigated / closed — skip silently
  }

  // ── 2. Filter and cap ──────────────────────────────────────────────────────
  const toClick = targets
    .filter((t: InteractionTarget) => t.estimatedPriority > o.minPriority)
    .slice(0, o.maxTargets);

  if (toClick.length === 0) return 0;

  if (o.verbose) {
    console.log(
      `      🔍 MVID: ${targets.length} target(s) found, ` +
      `${toClick.length} to click (max ${o.maxTargets})`,
    );
  }

  // ── 3. Linear cinematic traversal ─────────────────────────────────────────
  let clicked = 0;
  for (const target of toClick) {
    try {
      // Scroll target into view so camera can see it
      await page.locator(target.cssSelector).scrollIntoViewIfNeeded({ timeout: 2_000 });
      // Pre-click pause: viewer sees the current state
      await page.waitForTimeout(o.pauseBeforeMs);
      // Click
      await page.locator(target.cssSelector).click({ timeout: 3_000 });
      // Post-click pause: viewer sees the revealed content
      await page.waitForTimeout(o.pauseAfterMs);
      clicked++;

      if (o.verbose) {
        console.log(
          `         ✅ [${target.interactionClass}/${target.detectionMethod}] ` +
          `${target.humanReadableHint}`,
        );
      }
    } catch {
      if (o.verbose) {
        console.log(`         ⚠️  Skipped: ${target.cssSelector} (stale / obscured)`);
      }
    }
  }

  // ── 4. Scroll back to top for a clean clip ending ─────────────────────────
  if (clicked > 0) {
    try {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
      await page.waitForTimeout(600);
    } catch {}
  }

  return clicked;
}
