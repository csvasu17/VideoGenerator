/**
 * i18n.ts — shared language-name lookup + generic batched-translation helper
 * for pipelines whose narration isn't already produced by a single LLM call
 * that can just be told to write in the target language directly (Teaser,
 * Manual Recording's vision prompt). Agent Recording's narration is built
 * from deterministic string templates with no LLM call in its path at all,
 * so it needs this as a genuine post-build translation pass.
 *
 * Enterprise (automation/record-app-clips.ts) has its own older, self-contained
 * translateAllContent() tailored to its specific demo-package.json shape — not
 * migrated to this file to avoid touching already-working code.
 */

import type { AzureOpenAI } from 'openai';

export const LANGUAGE_NAMES: Record<string, string> = {
  fr: 'French', de: 'German', es: 'Spanish', it: 'Italian', pt: 'Portuguese', ja: 'Japanese',
};

/** Returns the human-readable language name for a BCP-47 locale, or null for English/unknown. */
export function resolveLanguageName(locale: string | undefined): string | null {
  if (!locale) return null;
  return LANGUAGE_NAMES[locale.split('-')[0].toLowerCase()] ?? null;
}

/**
 * Translates an array of strings to the target language in one batched LLM call,
 * preserving order and count. Falls back to the original (untranslated) strings
 * on any failure — a missed translation is far less disruptive than a failed run.
 */
export async function translateTexts(
  azureClient:  AzureOpenAI,
  texts:        string[],
  languageName: string,
): Promise<string[]> {
  if (texts.length === 0) return texts;

  const prompt = `Translate each string in this JSON array into ${languageName}. Rules:
- Return ONLY a JSON array of the same length, in the same order — no markdown fences, no commentary.
- Translate the meaning naturally; don't translate word-for-word if it reads awkwardly.
- Do NOT translate product names, technical IDs/codes (e.g. "DV-104"), or numbers.

${JSON.stringify(texts)}`;

  try {
    const response = await azureClient.chat.completions.create({
      model:                 process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
      max_completion_tokens: Math.min(8000, Math.max(500, texts.join(' ').length * 3)),
      reasoning_effort:      'low',
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = (response.choices[0]?.message?.content ?? '').trim()
      .replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === texts.length) {
      return parsed.map(String);
    }
    console.warn(`  ⚠️  [i18n] Translation response shape mismatch — keeping original text.`);
    return texts;
  } catch (err) {
    console.warn(`  ⚠️  [i18n] Translation failed — keeping original text. (${(err as Error).message?.slice(0, 150)})`);
    return texts;
  }
}
