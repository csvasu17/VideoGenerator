import { randomUUID } from 'crypto';
import type { DiscoveredPage } from '../../../core/domain/entities/DiscoveredPage';
import type { GraphEdge } from '../types';

/**
 * Detects navigation edges by matching each page's outbound links
 * against the set of discovered pages.
 */
export class NavigationEdgeDetector {
  detect(pages: DiscoveredPage[]): GraphEdge[] {
    const edges: GraphEdge[] = [];
    const byNormalizedUrl = new Map(pages.map(p => [normalize(p.url), p]));

    for (const page of pages) {
      for (const link of page.outboundLinks) {
        const target = byNormalizedUrl.get(normalize(link));
        if (!target || target.id === page.id) continue;

        const anchorEl = page.interactiveElements.find(
          el => el.type === 'link' && el.href !== undefined && normalize(el.href) === normalize(link),
        );

        edges.push({
          id: randomUUID(),
          source: page.id,
          target: target.id,
          type: 'navigation',
          weight: 1.0,
          metadata: {
            confidence: 1.0,
            detectedBy: ['navigation'],
            anchorText: anchorEl?.text ?? anchorEl?.ariaLabel,
          },
        });
      }
    }

    return deduplicate(edges);
  }
}

function normalize(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return rawUrl;
  }
}

function deduplicate(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  return edges.filter(e => {
    const key = `${e.source}→${e.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
