import type { DiscoveredPage } from '../../core/domain/entities/DiscoveredPage';
import type { NodeType } from './types';

type UrlRule = [pattern: RegExp, type: NodeType];

const URL_RULES: UrlRule[] = [
  [/\/(login|signin|sign-in|auth|sso)(\?|$|\/)/i, 'entry'],
  [/\/(register|signup|sign-up|onboard)(\?|$|\/)/i, 'entry'],
  [/\/(dashboard|home|overview|main|workspace)(\?|$|\/)/i, 'dashboard'],
  [/\/(settings|preferences|configuration|profile|account)(\?|$|\/)/i, 'settings'],
  [/\/(report|analytics|metrics|stats|insights|kpi)(\?|$|\/)/i, 'report'],
  [/\/(modal|dialog|popup|overlay)(\?|$|\/)/i, 'modal'],
  [/\/(new|create|add)(\?|$|\/)/i, 'form'],
  [/\/(edit|update|modify)(\?|$|\/)/i, 'form'],
  // Numeric or UUID tail segment → detail page
  [/\/[0-9a-f-]{8,}(\?|$)/i, 'detail'],
  [/\/\d+(\?|$)/, 'detail'],
];

export class NodeClassifier {
  classify(page: DiscoveredPage): NodeType {
    for (const [pattern, type] of URL_RULES) {
      if (pattern.test(page.url)) return type;
    }

    if (page.depth === 0) return 'entry';
    if (page.hasForm) return 'form';

    // Heuristic: shallow pages with many interactive elements are often list views
    const isShallow = page.depth <= 2;
    const isInteractive = page.interactiveElements.length > 5;
    if (isShallow && isInteractive) return 'list';

    return 'generic';
  }
}
