/**
 * VideoTemplateStrategy — type definitions for the template selection system.
 *
 * Four templates are supported:
 *   'modern_saas' — dark background, glassmorphic narration bar, spring-eased
 *                   camera zoom/pan, animated opening title, animated closing card.
 *   'enterprise'  — B-roll problem opening, white product screens, static camera,
 *                   presenter overlay, animated benefit slide, presenter closing.
 *   'teaser'      — short (~45-55s) music-only sizzle reel: B-roll hook, real
 *                   screen-recording feature clips, a mid-benefit statement card,
 *                   and a product logo/tagline outro. No spoken narration.
 *   'app_flow'    — animated sitemap/diagram video mapping the target app's
 *                   entire screen tree (every screen, sub-screen) and each
 *                   screen's individual data fields, with a guided camera tour
 *                   and per-screen field-list dives. Not a screen-recording
 *                   montage — a structural map with spoken narration.
 *
 * Template is selected via VIDEO_TEMPLATE in .env or WorkflowOptions.videoTemplate.
 * The pipeline reads the template once in WorkflowOrchestrator and propagates it
 * through WorkflowOptions so every template-aware stage can branch on it.
 */

export type VideoTemplate = 'modern_saas' | 'enterprise' | 'teaser' | 'app_flow';

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
  if (env === 'enterprise' || env === 'modern_saas' || env === 'teaser' || env === 'app_flow') return env;
  return DEFAULT_TEMPLATE;
}
