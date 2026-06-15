import type { SceneTransition, TransitionType } from '../../core/domain/entities/Storyboard';

// ─────────────────────────────────────────────────────────────────────────────
// Transition cost table (animation duration in ms per type)
// ─────────────────────────────────────────────────────────────────────────────

const TRANSITION_DURATION_MS: Record<TransitionType, number> = {
  cut:          0,
  fade:       500,
  'slide-left': 400,
  'slide-right':400,
  'zoom-in':  600,
  'zoom-out': 600,
};

// ─────────────────────────────────────────────────────────────────────────────
// Mapping rules (evaluated in order; first match wins)
// ─────────────────────────────────────────────────────────────────────────────

interface TransitionRule {
  /** Node type of the current scene (leaving). */
  from?: string;
  /** Node type of the next scene (entering). */
  to?: string;
  transition: TransitionType;
}

/**
 * Priority-ordered rules.
 * "entry" pages always fade in; modals always zoom; dashboards from detail zoom out.
 * Any unlisted combination falls through to the default at the bottom.
 */
const RULES: TransitionRule[] = [
  // ── Scene 1 always fades in gently ──────────────────────────────────────
  { to: 'entry',     transition: 'fade'        },

  // ── Coming back to an overview pulls the camera back ────────────────────
  { to: 'dashboard', transition: 'zoom-out'    },

  // ── Drilling into data / a detail pushes in ──────────────────────────────
  { to: 'report',    transition: 'zoom-in'     },
  { to: 'detail',    transition: 'zoom-in'     },
  { to: 'modal',     transition: 'zoom-in'     },

  // ── Moving forward through a workflow or list slides left ─────────────────
  { to: 'form',      transition: 'slide-left'  },
  { to: 'list',      transition: 'slide-left'  },

  // ── Leaving a completed form signals forward motion ───────────────────────
  { from: 'form',    transition: 'slide-left'  },

  // ── Settings / admin — cut; no animation overhead ────────────────────────
  { to: 'settings',  transition: 'cut'         },

  // ── Opening scene of the whole video — soft fade ─────────────────────────
  { from: 'entry',   transition: 'fade'        },
];

// ─────────────────────────────────────────────────────────────────────────────
// TransitionSelector
// ─────────────────────────────────────────────────────────────────────────────

export class TransitionSelector {
  /**
   * Choose the right transition FROM the current scene TO the next.
   *
   * @param currentNodeType  Node type of the page being LEFT.
   * @param nextNodeType     Node type of the page being ENTERED (undefined for last).
   * @param actionLabel      Human label for the on-screen annotation ("Click 'Create'").
   * @param isLast           True when this is the last scene (no outbound transition).
   */
  select(
    currentNodeType: string,
    nextNodeType:    string | undefined,
    actionLabel:     string | undefined,
    isLast:          boolean,
  ): SceneTransition | undefined {
    if (isLast) return undefined;

    const type = this.resolveType(currentNodeType, nextNodeType);

    return {
      type,
      durationMs: TRANSITION_DURATION_MS[type],
      label: actionLabel,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private
  // ──────────────────────────────────────────────────────────────────────────

  private resolveType(from: string, to: string | undefined): TransitionType {
    for (const rule of RULES) {
      const fromMatch = rule.from === undefined || rule.from === from;
      const toMatch   = rule.to   === undefined || rule.to   === to;
      if (fromMatch && toMatch) return rule.transition;
    }
    return 'cut'; // safe, zero-duration default
  }
}
