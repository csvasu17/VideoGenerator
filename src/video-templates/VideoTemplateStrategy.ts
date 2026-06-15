/**
 * VideoTemplateStrategy — type definitions for the template selection system.
 *
 * Two templates are supported:
 *   'modern_saas' — dark background, glassmorphic narration bar, spring-eased
 *                   camera zoom/pan, animated opening title, animated closing card.
 *   'enterprise'  — B-roll problem opening, white product screens, static camera,
 *                   presenter overlay, animated benefit slide, presenter closing.
 *
 * Template is selected via VIDEO_TEMPLATE in .env or WorkflowOptions.videoTemplate.
 * The pipeline reads the template once in WorkflowOrchestrator and propagates it
 * through WorkflowOptions so every template-aware stage can branch on it.
 */

export type VideoTemplate = 'modern_saas' | 'enterprise';

export const DEFAULT_TEMPLATE: VideoTemplate = 'modern_saas';

/**
 * Resolve the active template from env + options.
 * Options take precedence over the environment variable.
 */
export function resolveTemplate(
  optionsTemplate?: VideoTemplate,
): VideoTemplate {
  if (optionsTemplate) return optionsTemplate;
  const env = process.env['VIDEO_TEMPLATE'];
  if (env === 'enterprise' || env === 'modern_saas') return env;
  return DEFAULT_TEMPLATE;
}
