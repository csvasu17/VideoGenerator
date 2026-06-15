import type {
  HighlightTarget,
  HighlightElementType,
  ScreenRegion,
} from '../../core/domain/entities/Storyboard';
import type { JourneyStep } from '../../core/domain/entities/DemoJourney';

// ─────────────────────────────────────────────────────────────────────────────
// Static mappings
// ─────────────────────────────────────────────────────────────────────────────

interface HighlightHint {
  elementType: HighlightElementType;
  region: ScreenRegion;
}

/** Primary highlight based on the page's node type. */
const NODE_TYPE_HIGHLIGHT: Record<string, HighlightHint> = {
  dashboard: { elementType: 'kpi',        region: 'top-right' },
  report:    { elementType: 'chart',      region: 'center'    },
  list:      { elementType: 'table',      region: 'center'    },
  detail:    { elementType: 'kpi',        region: 'center'    },
  form:      { elementType: 'form',       region: 'center'    },
  modal:     { elementType: 'modal',      region: 'center'    },
  settings:  { elementType: 'navigation', region: 'top-left'  },
  entry:     { elementType: 'full-page',  region: 'full'      },
  generic:   { elementType: 'full-page',  region: 'full'      },
};

/**
 * When the top feature's name matches a keyword, override the element type
 * for a more precise spotlight (e.g. a "Chart" feature on a list page → chart).
 */
const FEATURE_KEYWORD_OVERRIDES: Array<{ keywords: string[]; elementType: HighlightElementType }> = [
  { keywords: ['chart', 'graph', 'visuali', 'trend'],             elementType: 'chart'     },
  { keywords: ['kpi', 'metric', 'stat', 'count', 'total'],        elementType: 'kpi'       },
  { keywords: ['table', 'grid', 'list', 'row'],                   elementType: 'table'     },
  { keywords: ['form', 'input', 'field', 'create', 'submit'],     elementType: 'form'      },
  { keywords: ['button', 'action', 'cta', 'click'],               elementType: 'button'    },
  { keywords: ['modal', 'dialog', 'popup', 'overlay'],            elementType: 'modal'     },
  { keywords: ['menu', 'nav', 'sidebar', 'navigation', 'header'], elementType: 'navigation'},
];

// ─────────────────────────────────────────────────────────────────────────────
// HighlightTargetResolver
// ─────────────────────────────────────────────────────────────────────────────

export class HighlightTargetResolver {
  /**
   * Resolve the most meaningful UI element to spotlight for a scene.
   * Strategy:
   *  1. Base hint from nodeType
   *  2. Feature-keyword override for the top-ranked feature
   *  3. Human-readable description built from feature name + element type
   */
  resolve(step: JourneyStep): HighlightTarget {
    const baseHint: HighlightHint =
      NODE_TYPE_HIGHLIGHT[step.nodeType] ?? { elementType: 'full-page', region: 'full' };

    const topFeature = step.features[0];
    const featureName = topFeature?.featureName ?? step.pageTitle;

    // Feature-keyword override
    const override = topFeature
      ? this.featureKeywordOverride(topFeature.featureName)
      : null;

    const elementType: HighlightElementType = override ?? baseHint.elementType;

    return {
      elementType,
      description: this.buildDescription(elementType, featureName, step.pageTitle),
      region: baseHint.region,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────────

  private featureKeywordOverride(featureName: string): HighlightElementType | null {
    const lower = featureName.toLowerCase();
    for (const entry of FEATURE_KEYWORD_OVERRIDES) {
      if (entry.keywords.some(kw => lower.includes(kw))) {
        return entry.elementType;
      }
    }
    return null;
  }

  private buildDescription(
    elementType: HighlightElementType,
    featureName: string,
    pageTitle: string,
  ): string {
    switch (elementType) {
      case 'kpi':        return `${featureName} KPI metric card`;
      case 'chart':      return `${featureName} analytics chart`;
      case 'table':      return `${featureName} data table`;
      case 'form':       return `${featureName} input form`;
      case 'button':     return `${featureName} action button`;
      case 'modal':      return `${featureName} modal dialog`;
      case 'navigation': return `${featureName} navigation panel`;
      case 'full-page':
      default:           return `${pageTitle} — full page view`;
    }
  }
}
