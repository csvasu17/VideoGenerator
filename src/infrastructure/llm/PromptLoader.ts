import { readFileSync } from 'fs';
import { join } from 'path';

const PROMPTS_ROOT = join(__dirname, '..', '..', 'prompts');

/** Cache loaded prompt strings to avoid repeated disk reads. */
const cache = new Map<string, string>();

/**
 * Load a versioned prompt file.
 * @param category  Sub-directory under src/prompts/  (e.g. 'vision')
 * @param name      File stem + version               (e.g. 'analyze-page.v1')
 */
export function loadPrompt(category: string, name: string): string {
  const key = `${category}/${name}`;
  if (cache.has(key)) return cache.get(key)!;

  const filePath = join(PROMPTS_ROOT, category, `${name}.txt`);
  const content = readFileSync(filePath, 'utf-8');
  cache.set(key, content);
  return content;
}

/** Replace a named placeholder in a prompt template. */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (t, [key, value]) => t.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value),
    template,
  );
}

/** Clear the prompt cache (useful in tests). */
export function clearPromptCache(): void {
  cache.clear();
}
