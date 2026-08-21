/**
 * manualRecordingVision.ts — per-scene AI vision analysis + narration generation
 * for Manual Recording ingestion.
 *
 * Deliberately a lightweight, direct Azure vision call (adapting
 * automation/rebuild-enterprise-package.ts's already-proven pattern), NOT routed
 * through the full VisionAnalysisAgent/PageIntelligence pipeline — that pipeline's
 * structured output (camera bounding boxes, KPI widgets) exists to drive Remotion's
 * Ken-Burns camera on live-rendered screenshots. Manual Recording never re-renders
 * the footage through Remotion — the original video plays back verbatim — so that
 * output would be dead JSON here.
 */

import * as fs from 'fs';
import { AzureOpenAI } from 'openai';
import { loadPrompt, fillTemplate } from '../../src/infrastructure/llm/PromptLoader';
import { CaptureQueue } from '../../src/agents/screenshot/CaptureQueue';
import { resolveLanguageName } from './i18n';

export interface SceneNarration {
  sceneTitle:      string;
  narration:       string;
  onScreenSummary: string;
  confidence:      'high' | 'low' | 'failed';
}

async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let delay = 2000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt === maxRetries) throw err;
      const is429 = err?.status === 429 || String(err?.message).includes('429');
      if (!is429) throw err;
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
  throw new Error('retryWithBackoff: unreachable');
}

// Words-per-second budget for spoken narration. Deliberately below natural TTS
// pace (~2.3-2.5 wps at the pipeline's default 0.95 speed) so narration finishes
// with a little breathing room before the scene cuts, instead of exactly at — or
// past — the cut point. Without this budget, narration length was unrelated to
// scene duration and drifted up to two minutes behind the picture by the end of
// a long recording.
const NARRATION_WORDS_PER_SEC = 2.0;
const MIN_NARRATION_WORDS = 5;
const MAX_NARRATION_WORDS_CAP = 70;

export async function analyzeScene(
  azureClient:      AzureOpenAI,
  framePath:        string,
  productContext:   string,
  sceneDurationSec: number,
): Promise<SceneNarration> {
  try {
    return await retryWithBackoff(async () => {
      const b64 = fs.readFileSync(framePath).toString('base64');
      const promptTemplate = loadPrompt('vision', 'manual-recording-scene.v1');
      const languageName = resolveLanguageName(process.env['APP_LANGUAGE']);
      const maxWords = Math.max(
        MIN_NARRATION_WORDS,
        Math.min(MAX_NARRATION_WORDS_CAP, Math.round(sceneDurationSec * NARRATION_WORDS_PER_SEC)),
      );
      const prompt = fillTemplate(promptTemplate, {
        PRODUCT_CONTEXT:      productContext ? `PRODUCT CONTEXT:\n${productContext.slice(0, 1000)}` : '',
        LANGUAGE_INSTRUCTION: languageName ? `Write "sceneTitle" and "narration" in natural, native-sounding ${languageName} (not a literal translation). Keep "onScreenSummary" and "confidence" in English — those are for an internal report, never shown to viewers.` : '',
        SCENE_DURATION_SEC:   String(Math.round(sceneDurationSec)),
        MAX_NARRATION_WORDS:  String(maxWords),
      });

      const response = await azureClient.chat.completions.create({
        model:                 process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
        max_completion_tokens: 300,
        reasoning_effort:      'low',
        messages: [
          { role: 'system', content: prompt },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}`, detail: 'low' } },
              { type: 'text', text: 'Analyze this frame and return the JSON.' },
            ],
          },
        ],
      });

      const raw = (response.choices[0]?.message?.content ?? '').trim()
        .replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
      const parsed = JSON.parse(raw);
      return {
        sceneTitle:      String(parsed.sceneTitle ?? 'Screen'),
        narration:       String(parsed.narration ?? ''),
        onScreenSummary: String(parsed.onScreenSummary ?? ''),
        confidence:      parsed.confidence === 'low' ? 'low' : 'high',
      };
    });
  } catch (err) {
    console.warn(`    ⚠️  Vision analysis failed for ${framePath}: ${(err as Error).message?.slice(0, 80)}`);
    return { sceneTitle: 'Screen', narration: '', onScreenSummary: '', confidence: 'failed' };
  }
}

/** Analyzes all scenes at concurrency 2 — matches VisionAnalysisAgent's own default
 *  rate-limit posture. Individual failures degrade to confidence:'failed', never abort the batch. */
export async function analyzeAllScenes(
  azureClient:    AzureOpenAI,
  frames:         { sceneIndex: number; framePath: string; durationSec: number }[],
  productContext: string,
): Promise<Map<number, SceneNarration>> {
  const queue = new CaptureQueue(2);
  const results = await queue.runAll(
    frames.map(f => async () => ({ sceneIndex: f.sceneIndex, result: await analyzeScene(azureClient, f.framePath, productContext, f.durationSec) })),
  );

  const map = new Map<number, SceneNarration>();
  for (const r of results) {
    if (r.status === 'fulfilled') {
      map.set(r.value.sceneIndex, r.value.result);
    }
  }
  return map;
}
