import type {Browser} from 'playwright';
import type {RecordingConfig, WorkflowDef} from '../types';
import {ensureSession, applySession} from './session';
import * as path from 'path';
import * as fs   from 'fs';

export async function recordWorkflow(
  browser:   Browser,
  config:    RecordingConfig,
  workflow:  WorkflowDef,
  outputDir: string,
): Promise<string | null> {
  console.log(`🎬 Recording: ${workflow.label}`);
  const session = await ensureSession(browser, config);
  const vp = config.viewport || {width: 1920, height: 1080};

  const ctx = await browser.newContext({
    viewport: vp,
    recordVideo: {dir: outputDir, size: vp},
    ignoreHTTPSErrors: true,
  });

  try {
    if (session) await applySession(ctx, session);
    const page = await ctx.newPage();
    await page.goto(config.appUrl, {waitUntil: 'networkidle', timeout: 20000});
    await page.waitForTimeout(500);

    for (const step of workflow.steps) {
      try {
        switch (step.action) {
          case 'goto':
            await page.goto(step.url!, {waitUntil: 'networkidle', timeout: 15000});
            break;
          case 'click':
            if (step.optional) {
              try { await page.click(step.selector!, {timeout: 3000}); } catch {}
            } else {
              await page.click(step.selector!, {timeout: 8000});
            }
            break;
          case 'fill':
            await page.fill(step.selector!, step.value!);
            break;
          case 'wait':
            await page.waitForTimeout(step.ms!);
            break;
          case 'waitForSelector':
            await page.waitForSelector(step.selector!, {timeout: step.timeout || 10000});
            break;
          case 'scroll':
            await page.evaluate(
              (y: number) => window.scrollTo({top: y, behavior: 'smooth'}),
              step.y || 600,
            );
            await page.waitForTimeout(500);
            break;
          case 'key':
            await page.keyboard.press(step.key!);
            break;
          case 'hover':
            await page.hover(step.selector!, {timeout: 3000});
            break;
        }
      } catch (e) {
        if (!step.optional) {
          console.warn(`    ⚠️  Step ${step.action} failed: ${(e as Error).message}`);
        }
      }
    }

    await page.waitForTimeout(2000);
    const videoPath = await page.video()?.path();
    await ctx.close();

    if (!videoPath || !fs.existsSync(videoPath)) {
      console.warn(`    ⚠️  No video produced for ${workflow.id}`);
      return null;
    }

    const dest = path.join(outputDir, `${workflow.id}.mp4`);
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    fs.renameSync(videoPath, dest);
    console.log(`    ✅ Saved: recordings/${workflow.id}.mp4`);
    return dest;
  } catch (e) {
    console.error(`    ❌ Error recording ${workflow.id}: ${(e as Error).message}`);
    try { await ctx.close(); } catch {}
    return null;
  }
}
