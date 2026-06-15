import { randomUUID } from 'crypto';
import type { DiscoveredPage } from '../../../core/domain/entities/DiscoveredPage';
import type { GraphEdge } from '../types';

/**
 * Detects parent-child relationships by URL path hierarchy.
 * /users is the parent of /users/123; /users/123 is the parent of /users/123/profile.
 */
export class ParentChildDetector {
  detect(pages: DiscoveredPage[]): GraphEdge[] {
    const edges: GraphEdge[] = [];
    const byNormalizedUrl = new Map(pages.map(p => [normalize(p.url), p]));

    for (const page of pages) {
      const parentUrl = getParentUrl(page.url);
      if (parentUrl === null) continue;

      const parent = byNormalizedUrl.get(normalize(parentUrl));
      if (!parent || parent.id === page.id) continue;

      edges.push({
        id: randomUUID(),
        source: parent.id,
        target: page.id,
        type: 'parent-child',
        weight: 0.9,
        metadata: {
          confidence: 0.9,
          detectedBy: ['parent-child'],
        },
      });
    }

    return edges;
  }
}

function getParentUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const segments = url.pathname.replace(/\/$/, '').split('/');
    if (segments.length <= 1) return null;
    segments.pop();
    url.pathname = segments.join('/') || '/';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
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
