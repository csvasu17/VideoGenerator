// ─────────────────────────────────────────────────────────────────────────────
// Storyboard Generator — public barrel
// ─────────────────────────────────────────────────────────────────────────────

// Main agent
export { StoryboardGenerator } from './StoryboardGenerator';

// Sub-components (exposed for testing / custom wiring)
export { SceneBuilder }                from './SceneBuilder';
export { SalesNarrationEngine }        from './SalesNarrationEngine';
export { EnterpriseNarrationEngine }   from './EnterpriseNarrationEngine';
export { HighlightTargetResolver }     from './HighlightTargetResolver';
export { TransitionSelector }          from './TransitionSelector';

export type { NarrationContext, NarrationResult } from './SalesNarrationEngine';

// ─────────────────────────────────────────────────────────────────────────────
// Convenience factory
// ─────────────────────────────────────────────────────────────────────────────

import { StoryboardGenerator }        from './StoryboardGenerator';
import { SceneBuilder }               from './SceneBuilder';
import { SalesNarrationEngine }       from './SalesNarrationEngine';
import { EnterpriseNarrationEngine }  from './EnterpriseNarrationEngine';
import { HighlightTargetResolver }    from './HighlightTargetResolver';
import { TransitionSelector }         from './TransitionSelector';
import type { VideoTemplate }         from '../../video-templates/VideoTemplateStrategy';

/**
 * Creates a fully-wired StoryboardGenerator.
 *
 * @param template  'enterprise' selects EnterpriseNarrationEngine (formal,
 *                  problem-first, short sentences). Any other value or absent
 *                  selects the default SalesNarrationEngine. ('teaser' never
 *                  reaches this factory in practice — see automation/record-teaser-clips.ts —
 *                  but the type accepts it for parity with VideoTemplate.)
 */
export function createStoryboardGenerator(
  template?: VideoTemplate,
): StoryboardGenerator {
  const narrationEngine = template === 'enterprise'
    ? new EnterpriseNarrationEngine()
    : new SalesNarrationEngine();

  return new StoryboardGenerator(
    new SceneBuilder(
      narrationEngine,
      new HighlightTargetResolver(),
      new TransitionSelector(),
    ),
  );
}
