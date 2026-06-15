/**
 * workflow-recorder.ts — Workflow-driven recording engine.
 *
 * Executes an ordered list of WorkflowClips using Playwright.
 * Each clip:
 *  1. Opens a new page in the shared auth context (no re-login)
 *  2. Executes each WorkflowStep in sequence
 *  3. Suppresses notification panels before / during recording
 *  4. Saves the recording as <clip.id>.mp4
 *
 * Generic — works for any application. Project-specific behaviour lives
 * entirely in the ProjectWorkflows config (projects/<id>/config/workflows.ts).
 */

import type {Browser, BrowserContext, Page} from 'playwright';
import type {ProjectWorkflows, WorkflowClip, WorkflowStep} from './workflow-types';
import type {ClipInfo, RecordingConfig} from './types';
import {ensureSession, createAuthContext, performLogin} from './utils/session';
import {getVideoInfo, durationToFrames} from './utils/ffprobe';
import {mvInteract} from './utils/interaction-recorder';
import * as path from 'path';
import * as fs   from 'fs';

// ─── Notification suppression (injected on every page) ───────────────────────
const SUPPRESS_CSS = `
  [class*="alert"][class*="panel"],    [class*="Alert"][class*="Panel"],
  [class*="notification"][class*="panel"], [class*="Notification"][class*="Panel"],
  [class*="notification-drawer"],      [class*="NotificationDrawer"],
  [class*="alerts-drawer"],            [class*="AlertsDrawer"],
  [class*="alert-sidebar"],            [class*="AlertSidebar"],
  [class*="side-alert"],               [class*="SideAlert"],
  [class*="toast-container"],          [class*="ToastContainer"],
  [class*="toast"]:not(button),
  [class*="snackbar"],
  [data-testid*="alert-panel"],
  [aria-label="Alerts"], [aria-label="Notifications"],
  .alerts-panel, .notification-panel {
    display: none !important; visibility: hidden !important;
    opacity: 0 !important;    pointer-events: none !important;
  }
`;

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function recordProjectWorkflows(
  browser:    Browser,
  workflows:  ProjectWorkflows,
  outputDir:  string,
  fps:        number,
): Promise<ClipInfo[]> {
  const origin = new URL(workflows.appUrl).origin;
  fs.mkdirSync(outputDir, {recursive: true});

  console.log(`\n🎬 Workflow recorder — project: ${workflows.projectId}`);
  console.log(`   App: ${workflows.appUrl}`);
  console.log(`   Clips: ${workflows.clips.length}\n`);

  // Build a RecordingConfig so we can reuse ensureSession / createAuthContext
  const rc: RecordingConfig = {
    appUrl:    workflows.appUrl,
    viewport:  {width: 1920, height: 1080},
    credentials: workflows.credentials as RecordingConfig['credentials'],
  };

  const session = await ensureSession(browser, rc);
  const vp      = {width: 1920, height: 1080};

  // ONE context for all clips — session shared, no re-authentication
  const ctx: BrowserContext = session
    ? await createAuthContext(browser, session, {viewport: vp, recordVideo: {dir: outputDir, size: vp}})
    : await browser.newContext({viewport: vp, recordVideo: {dir: outputDir, size: vp}, ignoreHTTPSErrors: true});

  const results: ClipInfo[] = [];

  try {
    for (const clip of workflows.clips) {
      const result = await recordClip(ctx, clip, origin, outputDir, fps);
      if (result) {
        results.push(result);
        console.log(`   ✅ ${clip.id}.mp4 (${result.duration.toFixed(1)}s)`);
      }
    }
  } finally {
    try { await ctx.close(); } catch {}
  }

  console.log(`\n✅ Recorded ${results.length}/${workflows.clips.length} clips`);
  return results;
}

// ─── Record a single clip ─────────────────────────────────────────────────────

async function recordClip(
  ctx:       BrowserContext,
  clip:      WorkflowClip,
  origin:    string,
  outputDir: string,
  fps:       number,
): Promise<ClipInfo | null> {
  console.log(`\n   📹 [${clip.id}] ${clip.title}`);

  const page = await ctx.newPage();
  try {
    // Inject suppression CSS from the very first paint
    await page.addStyleTag({content: SUPPRESS_CSS}).catch(() => {});

    let stepNum = 0;
    for (const step of clip.steps) {
      stepNum++;
      try {
        await executeStep(page, step, origin);
        // Re-suppress after each step (some steps open panels)
        await page.addStyleTag({content: SUPPRESS_CSS}).catch(() => {});
      } catch (e) {
        const msg = (e as Error).message;
        if (step.optional) {
          console.log(`      ⚠️  Step ${stepNum} (${step.type}) skipped: ${msg.slice(0, 80)}`);
        } else {
          console.error(`      ❌ Step ${stepNum} (${step.type}) failed: ${msg.slice(0, 120)}`);
          // Don't abort — continue with remaining steps for partial recording
        }
      }
    }

    // ── Optional MVID phase: auto-discover & click remaining controls ──────────
    // Runs after all explicit steps. Discovers tabs, accordions, and visual
    // controls that weren't hardcoded in the workflow — without any selectors.
    if (clip.interactionDiscovery === true) {
      const mvClicked = await mvInteract(page, {
        maxTargets:       4,    // conservative in workflow mode (script handled main flow)
        pauseBeforeMs:    600,
        pauseAfterMs:     1_200,
        visualDetection:  true,
        maxVisualGroups:  2,
        verbose:          true,
      }).catch(() => 0);
      if (mvClicked > 0) {
        console.log(`      🔍 MVID: discovered and clicked ${mvClicked} additional control(s)`);
      }
    }

    // Final hold on the last screen
    await page.waitForTimeout(clip.holdMs ?? 2500);
    await page.addStyleTag({content: SUPPRESS_CSS}).catch(() => {});

    const vid = await page.video()?.path();
    await page.close();

    if (!vid || !fs.existsSync(vid)) {
      console.warn(`      ⚠️  No video produced for ${clip.id}`);
      return null;
    }

    const dest = path.join(outputDir, `${clip.id}.mp4`);
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    fs.renameSync(vid, dest);

    const info = getVideoInfo(dest);
    return {
      id:               clip.id,
      file:             `projects/rheem/recordings/${clip.id}.mp4`,
      duration:         info.duration,
      durationInFrames: durationToFrames(info.duration, fps),
      width:            info.width,
      height:           info.height,
      source:           'auto',
      capturedAt:       '',
    };
  } catch (e) {
    console.error(`      ❌ Fatal error recording ${clip.id}: ${(e as Error).message}`);
    try { await page.close(); } catch {}
    return null;
  }
}

// ─── Step executor ────────────────────────────────────────────────────────────

async function executeStep(page: Page, step: WorkflowStep, origin: string): Promise<void> {
  switch (step.type) {

    case 'navigate': {
      const url = step.url!.startsWith('http') ? step.url! : origin + step.url!;
      await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 60000});
      await page.waitForTimeout(step.waitAfter ?? 2500);
      break;
    }

    case 'click':
    case 'tab_click': {
      const el = await findElement(page, step);
      if (!el) {
        if (!step.optional) throw new Error(`Not found: text="${step.text}" selector="${step.selector}"`);
        return;
      }
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.click({timeout: 6000});
      await page.waitForTimeout(step.waitAfter ?? (step.type === 'tab_click' ? 1500 : 1000));
      break;
    }

    case 'wait': {
      if (step.waitFor) {
        await page.waitForSelector(step.waitFor, {timeout: step.timeout ?? 12000});
      }
      await page.waitForTimeout(step.ms ?? 1000);
      break;
    }

    case 'scroll': {
      if (step.y !== undefined) {
        await page.evaluate((y: number) => window.scrollTo({top: y, behavior: 'smooth'}), step.y);
      } else if (step.by !== undefined) {
        await page.evaluate((by: number) => window.scrollBy({top: by, behavior: 'smooth'}), step.by);
      } else {
        // Default: scroll down one viewport
        await page.evaluate(() => window.scrollBy({top: window.innerHeight * 0.7, behavior: 'smooth'}));
      }
      await page.waitForTimeout(step.waitAfter ?? 700);
      break;
    }

    case 'hover': {
      const el = await findElement(page, step);
      if (!el) {
        if (!step.optional) throw new Error(`Hover target not found`);
        return;
      }
      await el.hover();
      await page.waitForTimeout(step.waitAfter ?? 700);
      break;
    }

    case 'fill': {
      if (!step.selector) throw new Error('fill step requires selector');
      await page.fill(step.selector, step.value ?? '');
      await page.waitForTimeout(step.waitAfter ?? 300);
      break;
    }

    case 'key': {
      await page.keyboard.press(step.key ?? 'Escape');
      await page.waitForTimeout(step.waitAfter ?? 300);
      break;
    }

    case 'back': {
      await page.goBack({waitUntil: 'domcontentloaded', timeout: 20000});
      await page.waitForTimeout(step.waitAfter ?? 1500);
      break;
    }

    case 'suppress': {
      await page.keyboard.press('Escape').catch(() => {});
      await page.addStyleTag({content: SUPPRESS_CSS}).catch(() => {});
      // Click close buttons
      for (const sel of [
        'button[aria-label*="close" i]:visible',
        'button[aria-label*="dismiss" i]:visible',
        '[class*="closeBtn"]:visible',
        '[class*="dismiss"]:visible',
      ]) {
        try {
          const els = await page.$$(sel);
          for (const el of els.slice(0, 3)) await el.click({timeout: 300, force: true}).catch(() => {});
        } catch {}
      }
      await page.waitForTimeout(step.waitAfter ?? 300);
      break;
    }
  }
}

// ─── Element finder ───────────────────────────────────────────────────────────
// Tries multiple strategies to locate an element by text or selector.

async function findElement(page: Page, step: WorkflowStep): Promise<any | null> {
  const idx = step.index ?? 0;

  if (step.selector) {
    try {
      const loc = page.locator(step.selector).nth(idx);
      if (await loc.count() > 0) return loc;
    } catch {}
  }

  if (step.text) {
    // Priority order for matching text — tabs first, then buttons, then links, then any
    const strategies = [
      `[role="tab"]:has-text("${step.text}")`,
      `button:has-text("${step.text}")`,
      `a:has-text("${step.text}")`,
      `li:has-text("${step.text}")`,
      `[class*="nav"]:has-text("${step.text}")`,
      `[class*="menu"]:has-text("${step.text}")`,
      `:text-is("${step.text}")`,
      `:has-text("${step.text}")`,
    ];
    for (const sel of strategies) {
      try {
        const loc = page.locator(sel).nth(idx);
        if (await loc.count() > 0) return loc;
      } catch {}
    }
  }

  return null;
}
