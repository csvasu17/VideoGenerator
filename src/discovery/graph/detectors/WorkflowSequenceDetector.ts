import { randomUUID } from 'crypto';
import type { DiscoveredPage } from '../../../core/domain/entities/DiscoveredPage';
import type { GraphEdge } from '../types';

/**
 * URL path segments that signal a multi-step workflow.
 */
const WORKFLOW_URL_PATTERNS: RegExp[] = [
  /\/step[-_]?(\d+)/i,
  /\/wizard\//i,
  /\/onboarding\//i,
  /\/setup\//i,
  /\/checkout\//i,
  /\/flow\//i,
];

/**
 * Button / link text that signals forward progression in a flow.
 */
const FORWARD_MARKERS: string[] = [
  'next', 'continue', 'proceed', 'submit', 'confirm',
  'complete', 'finish', 'save & continue', 'save and continue',
];

export class WorkflowSequenceDetector {
  detect(pages: DiscoveredPage[]): GraphEdge[] {
    const byUrl = new Map(pages.map(p => [normalize(p.url), p]));
    const sorted = [...pages].sort((a, b) => a.visitOrder - b.visitOrder);

    const edges = [
      ...this.fromUrlStepPattern(pages),
      ...this.fromNavigationOrder(sorted, byUrl),
    ];

    return deduplicate(edges);
  }

  // ── Strategy 1: step-N URL pattern ────────────────────────────────────────

  private fromUrlStepPattern(pages: DiscoveredPage[]): GraphEdge[] {
    const edges: GraphEdge[] = [];
    const workflowPages = pages.filter(p =>
      WORKFLOW_URL_PATTERNS.some(rx => rx.test(p.url))
    );

    for (const [, group] of groupByWorkflowRoot(workflowPages)) {
      const ordered = sortByStepNumber(group);
      for (let i = 0; i < ordered.length - 1; i++) {
        edges.push({
          id: randomUUID(),
          source: ordered[i].id,
          target: ordered[i + 1].id,
          type: 'workflow-sequence',
          weight: 0.95,
          metadata: {
            confidence: 0.95,
            detectedBy: ['workflow-sequence'],
            stepIndex: i,
          },
        });
      }
    }

    return edges;
  }

  // ── Strategy 2: forward-action button + observed navigation order ─────────

  private fromNavigationOrder(
    sorted: DiscoveredPage[],
    byUrl: Map<string, DiscoveredPage>,
  ): GraphEdge[] {
    const edges: GraphEdge[] = [];

    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];

      const hasForwardButton = current.interactiveElements.some(
        el =>
          el.type === 'button' &&
          el.text !== undefined &&
          FORWARD_MARKERS.some(m => el.text!.toLowerCase().includes(m)),
      );

      const nextReachableFromCurrent = current.outboundLinks.some(
        link => byUrl.has(normalize(link)) && byUrl.get(normalize(link))!.id === next.id,
      );

      if (hasForwardButton && nextReachableFromCurrent) {
        const forwardEl = current.interactiveElements.find(
          el => el.type === 'button' && FORWARD_MARKERS.some(m => el.text?.toLowerCase().includes(m)),
        );

        edges.push({
          id: randomUUID(),
          source: current.id,
          target: next.id,
          type: 'workflow-sequence',
          weight: 0.75,
          metadata: {
            confidence: 0.75,
            detectedBy: ['workflow-sequence'],
            anchorText: forwardEl?.text,
            stepIndex: i,
          },
        });
      }
    }

    return edges;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function groupByWorkflowRoot(pages: DiscoveredPage[]): Map<string, DiscoveredPage[]> {
  const groups = new Map<string, DiscoveredPage[]>();

  for (const page of pages) {
    const root = extractWorkflowRoot(page.url);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(page);
  }

  return groups;
}

function extractWorkflowRoot(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.pathname = url.pathname.replace(/\/step[-_]?\d+.*$/i, '');
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function sortByStepNumber(pages: DiscoveredPage[]): DiscoveredPage[] {
  return [...pages].sort((a, b) => extractStepNumber(a.url) - extractStepNumber(b.url));
}

function extractStepNumber(rawUrl: string): number {
  const match = rawUrl.match(/\/step[-_]?(\d+)/i);
  return match ? parseInt(match[1], 10) : 0;
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
