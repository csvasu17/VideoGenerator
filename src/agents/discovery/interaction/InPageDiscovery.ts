// ─────────────────────────────────────────────────────────────────────────────
// InPageDiscovery — the exploration loop
//
// The only class in this module that calls imperative Playwright APIs
// (.click(), .reload(), .waitForFunction()).
//
// Algorithm:
//   1. Capture base state (depth=0)
//   2. Detect all targets via InteractionDetector (3 passes)
//   3. For each high-priority target (priority > 0.20):
//      a. Build reset context before clicking
//      b. Click the target
//      c. Wait for DOM stability
//      d. Capture candidate state
//      e. Compare to base (StateComparator)
//      f. If meaningful → push to discoveredStates
//      g. Reset to base state
//      h. If reset fails → reload + re-verify; abort if irrecoverable
//   4. Return ExplorationResult
//
// Budget checks happen at the start of each iteration:
//   maxStates, maxAttempts, maxTimeMs
// ─────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';
import type {
  ExplorationOptions,
  ExplorationResult,
  InteractionStep,
  InteractionTarget,
  PageInteractionState,
  ResetContext,
} from './types';
import { DEFAULT_EXPLORATION_OPTIONS } from './types';
import { InteractionDetector } from './InteractionDetector';
import { StateCapture }        from './StateCapture';
import { compare }             from './StateComparator';

// ── Class ─────────────────────────────────────────────────────────────────────

export class InPageDiscovery {
  private readonly opts: Required<Omit<ExplorationOptions, 'screenshotOutputDir'>> & {
    screenshotOutputDir: string;
  };

  constructor(options: ExplorationOptions) {
    this.opts = {
      maxStates:           options.maxStates           ?? DEFAULT_EXPLORATION_OPTIONS.maxStates,
      maxDepth:            options.maxDepth            ?? DEFAULT_EXPLORATION_OPTIONS.maxDepth,
      maxAttempts:         options.maxAttempts         ?? DEFAULT_EXPLORATION_OPTIONS.maxAttempts,
      maxTimeMs:           options.maxTimeMs           ?? DEFAULT_EXPLORATION_OPTIONS.maxTimeMs,
      meaningfulThreshold: options.meaningfulThreshold ?? DEFAULT_EXPLORATION_OPTIONS.meaningfulThreshold,
      visualDetection:     options.visualDetection     ?? DEFAULT_EXPLORATION_OPTIONS.visualDetection,
      maxVisualGroups:     options.maxVisualGroups     ?? DEFAULT_EXPLORATION_OPTIONS.maxVisualGroups,
      screenshotOutputDir: options.screenshotOutputDir,
    };
  }

  /**
   * Explore a single already-loaded page for hidden in-page functionality.
   *
   * @param page  Playwright page — must be loaded, stable, and authenticated.
   * @returns     ExplorationResult with base state + all meaningful discovered states.
   */
  async explorePage(page: Page): Promise<ExplorationResult> {
    const startTime = Date.now();
    const capture   = new StateCapture(this.opts.screenshotOutputDir);
    const detector  = new InteractionDetector();

    // 1. Capture base state
    const baseState = await capture.capture(page, []);

    // 2. Detect all targets
    const allTargets = await detector.detect(page, {
      visualDetection: this.opts.visualDetection,
      maxVisualGroups: this.opts.maxVisualGroups,
    });

    // Separate exploration targets (priority > 0.20) from reset-only targets (≤ 0.20)
    const explorationTargets = allTargets.filter(t => t.estimatedPriority > 0.20);

    const discoveredStates: PageInteractionState[] = [];
    let attempts = 0;

    // 3. Exploration loop
    for (const target of explorationTargets) {

      // Budget checks
      if (discoveredStates.length >= this.opts.maxStates) {
        return this.buildResult(baseState, discoveredStates, attempts, 'state-exhausted');
      }
      if (attempts >= this.opts.maxAttempts) {
        return this.buildResult(baseState, discoveredStates, attempts, 'attempt-exhausted');
      }
      if (Date.now() - startTime >= this.opts.maxTimeMs) {
        return this.buildResult(baseState, discoveredStates, attempts, 'time-exhausted');
      }

      attempts++;

      const urlBefore  = page.url();
      const resetCtx   = this.buildResetContext(target, allTargets, urlBefore);

      // 3a. Scroll into view and click
      let clicked = false;
      try {
        await page.locator(target.cssSelector).scrollIntoViewIfNeeded({ timeout: 2_000 });
        await page.locator(target.cssSelector).click({ timeout: 3_000 });
        clicked = true;
      } catch {
        // Element stale, detached, or obscured — skip silently
        continue;
      }
      if (!clicked) continue;

      // 3b. Wait for DOM stability
      await this.waitForStability(page, 3_000);

      // 3c. Capture candidate state
      const step: InteractionStep = {
        targetSelector:       target.cssSelector,
        interactionClass:     target.interactionClass,
        detectionMethod:      target.detectionMethod,
        humanReadableHint:    target.humanReadableHint,
        // Phase 9: preserve pixel bbox — InteractionSequenceBuilder normalises
        // to 0–1 viewport coordinates for cursor animation without a live browser.
        elementBoundingRect:  target.boundingRect ?? null,
      };
      const candidate = await capture.capture(page, [step]);

      // 3d. Compare to base
      const delta = compare(baseState, candidate, this.opts.meaningfulThreshold);
      if (delta.isMeaningful) {
        discoveredStates.push(candidate);
      }

      // 3e. Reset to base state
      const resetOk = await this.resetToBase(page, resetCtx);

      if (!resetOk) {
        // Reset failed — attempt a full page reload
        await page.reload({ waitUntil: 'load', timeout: 15_000 }).catch(() => undefined);
        await this.waitForStability(page, 2_000);

        // Verify reload restored base state
        const postReload = await capture.capture(page, []);
        if (postReload.fingerprint.compositeHash !== baseState.fingerprint.compositeHash) {
          // Page is in an irrecoverable state — stop exploration here
          break;
        }
      }
    }

    return this.buildResult(baseState, discoveredStates, attempts, 'completed');
  }

  // ── Reset context ───────────────────────────────────────────────────────────

  /**
   * Build reset instructions BEFORE clicking, while we still know the current state.
   */
  private buildResetContext(
    target:     InteractionTarget,
    allTargets: InteractionTarget[],
    urlBefore:  string,
  ): ResetContext {

    const { interactionClass } = target;

    if (interactionClass === 'TAB_TRIGGER' || interactionClass === 'VISUAL_TAB_CANDIDATE') {
      // Find the active sibling in the same group (low-priority reset-only element)
      const activeSibling = allTargets.find(t =>
        t.groupId === target.groupId &&
        t.id !== target.id &&
        t.estimatedPriority <= 0.15,
      );
      if (activeSibling) {
        return {
          strategy:        'restore-sibling',
          toggleSelector:  null,
          siblingSelector: activeSibling.cssSelector,
          urlBeforeClick:  urlBefore,
        };
      }
      // Fallback: use groupActiveMemberSelector if available
      if (target.groupActiveMemberSelector && target.groupActiveMemberSelector !== target.cssSelector) {
        return {
          strategy:        'restore-sibling',
          toggleSelector:  null,
          siblingSelector: target.groupActiveMemberSelector,
          urlBeforeClick:  urlBefore,
        };
      }
      return { strategy: 'reload', toggleSelector: null, siblingSelector: null, urlBeforeClick: urlBefore };
    }

    // ACCORDION_HEADER and EXPAND_TOGGLE: re-click to toggle back
    return {
      strategy:        'toggle',
      toggleSelector:  target.cssSelector,
      siblingSelector: null,
      urlBeforeClick:  urlBefore,
    };
  }

  // ── Reset execution ─────────────────────────────────────────────────────────

  private async resetToBase(page: Page, ctx: ResetContext): Promise<boolean> {
    try {
      // If the click navigated away, go back first
      if (page.url() !== ctx.urlBeforeClick) {
        await page.goBack({ waitUntil: 'load', timeout: 10_000 });
        await this.waitForStability(page, 1_000);
        return true;
      }

      switch (ctx.strategy) {
        case 'toggle': {
          await page.locator(ctx.toggleSelector!).click({ timeout: 3_000 });
          await this.waitForStability(page, 800);
          return true;
        }
        case 'restore-sibling': {
          await page.locator(ctx.siblingSelector!).click({ timeout: 3_000 });
          await this.waitForStability(page, 800);
          return true;
        }
        case 'reload': {
          await page.reload({ waitUntil: 'load', timeout: 15_000 });
          await this.waitForStability(page, 1_500);
          return true;
        }
      }
    } catch {
      return false;
    }
    return false;
  }

  // ── DOM stability ──────────────────────────────────────────────────────────

  /**
   * Wait until the DOM has been mutation-quiet for at least 300 ms,
   * or until maxMs elapses (non-fatal — we proceed with whatever state we have).
   */
  private async waitForStability(page: Page, maxMs: number): Promise<void> {
    await page.waitForFunction(
      () => new Promise<boolean>(resolve => {
        let mutationCount = 0;
        const observer = new MutationObserver(() => { mutationCount++; });
        observer.observe(document.body || document.documentElement, {
          childList:  true,
          subtree:    true,
          attributes: true,
        });
        const intervalMs = 300;
        const check = setInterval(() => {
          if (mutationCount === 0) {
            clearInterval(check);
            observer.disconnect();
            resolve(true);
          }
          mutationCount = 0;
        }, intervalMs);
      }),
      { timeout: maxMs },
    ).catch(() => undefined); // timeout is non-fatal
  }

  // ── Result builder ─────────────────────────────────────────────────────────

  private buildResult(
    baseState:        PageInteractionState,
    discoveredStates: PageInteractionState[],
    totalAttempts:    number,
    budgetStatus:     ExplorationResult['budgetStatus'],
  ): ExplorationResult {
    return {
      baseState,
      discoveredStates,
      totalAttempts,
      totalMeaningful: discoveredStates.length,
      budgetStatus,
    };
  }
}
