/**
 * VideoTemplateStrategy — type definitions for the template selection system.
 *
 * Three templates are supported:
 *   'modern_saas' — dark background, glassmorphic narration bar, spring-eased
 *                   camera zoom/pan, animated opening title, animated closing card.
 *   'enterprise'  — B-roll problem opening, white product screens, static camera,
 *                   presenter overlay, animated benefit slide, presenter closing.
 *   'teaser'      — short (~45-55s) music-only sizzle reel: B-roll hook, real
 *                   screen-recording feature clips, a mid-benefit statement card,
 *                   and a product logo/tagline outro. No spoken narration.
 *
 * "End to End" (VIDEO_TEMPLATE=end_to_end) is deliberately NOT part of this type —
 * it never runs through WorkflowOrchestrator's multi-stage pipeline at all. It's a
 * Config UI-only value that reveals the Agent Recording / Manual Recording section,
 * each with its own independent script and endpoints (see automation/config-server.ts's
 * /api/agent-recording/* and /api/manual-recording/* routes).
 *
 * Template is selected via VIDEO_TEMPLATE in .env or WorkflowOptions.videoTemplate.
 * The pipeline reads the template once in WorkflowOrchestrator and propagates it
 * through WorkflowOptions so every template-aware stage can branch on it.
 */

export type VideoTemplate = 'modern_saas' | 'enterprise' | 'teaser';

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
  if (env === 'enterprise' || env === 'modern_saas' || env === 'teaser') return env;
  return DEFAULT_TEMPLATE;
}
