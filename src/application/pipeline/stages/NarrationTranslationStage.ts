// ─────────────────────────────────────────────────────────────────────────────
// NarrationTranslationStage
//
// When the pipeline runs with a non-English locale (options.locale !== 'en'),
// this stage translates all natural-language text fields in ctx.storyboard to
// the target language using a single batched LLM call.
//
// This is intentionally a post-processing step applied after StoryboardStage:
//   - Existing narration engines (SalesNarrationEngine, EnterpriseNarrationEngine)
//     stay untouched — no locale-specific vocabulary files needed.
//   - Any new locale is supported immediately without touching narration logic.
//
// Translated fields per scene: title, description, narration, salesHook,
//   highlightTarget.description, transition.label
// Translated storyboard fields: title, openingTitle, closingCallToAction
//
// LLM provider selection: Azure OpenAI → OpenAI → Claude (reads from env vars).
// When no provider is available, the stage logs a warning and skips translation.
// ─────────────────────────────────────────────────────────────────────────────

import type { PipelineStage }   from '../PipelineStage';
import type { PipelineContext } from '../PipelineContext';
import type { Storyboard, Scene } from '../../../core/domain/entities/Storyboard';
import type { ILLMProvider }    from '../../../core/ports/services/ILLMProvider';
import { resolveLocale, isEnglish } from '../../../core/domain/types/Locale';

// ── Translation payload shapes ────────────────────────────────────────────────

interface SceneTextPayload {
  title:                 string;
  description:           string;
  narration:             string;
  salesHook:             string;
  highlightDescription:  string;
  transitionLabel?:      string;
}

interface StoryboardTextPayload {
  storyboardTitle:      string;
  openingTitle:         string;
  closingCallToAction:  string;
  scenes: Record<string, SceneTextPayload>;  // keyed by scene.pageId + sceneNumber
}

interface TranslationResult extends StoryboardTextPayload {}

// ── Stage ─────────────────────────────────────────────────────────────────────

export class NarrationTranslationStage
  implements PipelineStage<undefined, Storyboard>
{
  readonly name = 'Narration Translation';

  async run(_input: undefined, ctx: PipelineContext): Promise<Storyboard> {
    const locale  = ctx.input.options?.locale ?? process.env['APP_LANGUAGE'] ?? 'en';
    const storyboard = ctx.storyboard;

    if (!storyboard) {
      throw new Error('[NarrationTranslation] ctx.storyboard must be set before this stage runs');
    }

    // No-op for English — return storyboard unchanged
    if (isEnglish(locale)) {
      return storyboard;
    }

    const localeConfig = resolveLocale(locale);
    const llm = createLLMProvider();

    if (!llm) {
      console.warn(
        `[NarrationTranslation] No LLM provider available — skipping translation to ${localeConfig.name}. ` +
        `Set AZURE_OPENAI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY to enable.`,
      );
      return storyboard;
    }

    console.info(
      `[NarrationTranslation] Translating storyboard (${storyboard.scenes.length} scenes) → ${localeConfig.name}`,
    );

    // ── Build payload ─────────────────────────────────────────────────────────
    const payload: StoryboardTextPayload = {
      storyboardTitle:     storyboard.title,
      openingTitle:        storyboard.openingTitle,
      closingCallToAction: storyboard.closingCallToAction,
      scenes: {},
    };

    for (const scene of storyboard.scenes) {
      const key = `${scene.sceneNumber}_${scene.pageId}`;
      payload.scenes[key] = {
        title:                scene.title,
        description:          scene.description,
        narration:            scene.narration,
        salesHook:            scene.salesHook,
        highlightDescription: scene.highlightTarget.description,
        transitionLabel:      scene.transition?.label,
      };
    }

    // ── LLM call ──────────────────────────────────────────────────────────────
    const translated = await this.translate(llm, payload, localeConfig.name);

    // ── Merge translated values back into storyboard ──────────────────────────
    const translatedScenes: Scene[] = storyboard.scenes.map(scene => {
      const key  = `${scene.sceneNumber}_${scene.pageId}`;
      const t    = translated.scenes[key];

      if (!t) {
        console.warn(`[NarrationTranslation] Missing translation for scene key "${key}" — keeping English`);
        return scene;
      }

      return {
        ...scene,
        title:       t.title       || scene.title,
        description: t.description || scene.description,
        narration:   t.narration   || scene.narration,
        salesHook:   t.salesHook   || scene.salesHook,
        highlightTarget: {
          ...scene.highlightTarget,
          description: t.highlightDescription || scene.highlightTarget.description,
        },
        transition: scene.transition
          ? { ...scene.transition, label: t.transitionLabel || scene.transition.label }
          : undefined,
      };
    });

    return {
      ...storyboard,
      title:               translated.storyboardTitle     || storyboard.title,
      openingTitle:        translated.openingTitle        || storyboard.openingTitle,
      closingCallToAction: translated.closingCallToAction || storyboard.closingCallToAction,
      scenes: translatedScenes,
    };
  }

  // ── LLM translation ─────────────────────────────────────────────────────────

  private async translate(
    llm:          ILLMProvider,
    payload:      StoryboardTextPayload,
    languageName: string,
  ): Promise<TranslationResult> {
    const prompt = buildTranslationPrompt(payload, languageName);

    let responseText: string;
    try {
      responseText = await llm.complete(
        [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        { maxTokens: 8192 },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[NarrationTranslation] LLM call failed: ${msg}`);
    }

    return parseTranslationResponse(responseText, payload);
  }
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildTranslationPrompt(payload: StoryboardTextPayload, languageName: string): string {
  return `You are a professional localization specialist for B2B SaaS marketing videos.

Translate the following JSON object into ${languageName}. Rules:
- Translate ONLY the string values — do NOT translate JSON keys.
- Keep proper nouns (product names, company names, technical terms) untranslated.
- Preserve tone: sales narration should stay engaging and persuasive; descriptions factual.
- For "narration" fields: keep natural spoken phrasing suitable for voice-over.
- For "salesHook" fields: keep concise and impactful (≤15 words).
- Return ONLY valid JSON matching the exact same structure. No markdown, no code fences.

JSON to translate:
${JSON.stringify(payload, null, 2)}`;
}

// ── Response parser ───────────────────────────────────────────────────────────

function parseTranslationResponse(
  responseText: string,
  fallback:     StoryboardTextPayload,
): TranslationResult {
  // Strip markdown code fences if present
  const cleaned = responseText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  // Find the first { … } block
  const start = cleaned.indexOf('{');
  const end   = cleaned.lastIndexOf('}');

  if (start === -1 || end === -1) {
    console.warn('[NarrationTranslation] LLM returned no JSON — keeping English storyboard');
    return fallback;
  }

  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as TranslationResult;

    // Verify we got the same scene keys; if a key is missing, fill from fallback
    for (const key of Object.keys(fallback.scenes)) {
      if (!parsed.scenes?.[key]) {
        parsed.scenes = parsed.scenes ?? {};
        parsed.scenes[key] = fallback.scenes[key];
      }
    }

    return parsed;
  } catch (err) {
    console.warn(
      `[NarrationTranslation] JSON parse failed (${(err as Error).message}) — keeping English storyboard`,
    );
    return fallback;
  }
}

// ── LLM provider auto-selection ───────────────────────────────────────────────

function createLLMProvider(): ILLMProvider | null {
  // Azure OpenAI (preferred — same provider used by the rest of the pipeline)
  if (process.env['AZURE_OPENAI_API_KEY'] && process.env['AZURE_OPENAI_ENDPOINT'] && process.env['AZURE_OPENAI_DEPLOYMENT']) {
    try {
      const { AzureOpenAIProvider } = require('../../../infrastructure/llm/AzureOpenAIProvider') as
        typeof import('../../../infrastructure/llm/AzureOpenAIProvider');
      return new AzureOpenAIProvider();
    } catch { /* fall through */ }
  }

  // OpenAI (secondary)
  if (process.env['OPENAI_API_KEY']) {
    try {
      const { OpenAIProvider } = require('../../../infrastructure/llm/OpenAIProvider') as
        typeof import('../../../infrastructure/llm/OpenAIProvider');
      return new OpenAIProvider();
    } catch { /* fall through */ }
  }

  // Anthropic Claude (tertiary)
  if (process.env['ANTHROPIC_API_KEY']) {
    try {
      const { ClaudeProvider } = require('../../../infrastructure/llm/ClaudeProvider') as
        typeof import('../../../infrastructure/llm/ClaudeProvider');
      return new ClaudeProvider();
    } catch { /* fall through */ }
  }

  return null;
}
