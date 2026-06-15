import type { DiscoveredPage } from '../../core/domain/entities/DiscoveredPage';
import type { ApplicationGraph, EdgeType, GraphEdge, GraphNode } from './types';
import { NavigationEdgeDetector } from './detectors/NavigationEdgeDetector';
import { ParentChildDetector } from './detectors/ParentChildDetector';
import { WorkflowSequenceDetector } from './detectors/WorkflowSequenceDetector';
import { NodeClassifier } from './NodeClassifier';

export class ApplicationGraphBuilder {
  constructor(
    private readonly navigationDetector: NavigationEdgeDetector,
    private readonly parentChildDetector: ParentChildDetector,
    private readonly workflowDetector: WorkflowSequenceDetector,
    private readonly nodeClassifier: NodeClassifier,
  ) {}

  build(pages: DiscoveredPage[]): ApplicationGraph {
    if (pages.length === 0) {
      return emptyGraph();
    }

    const nodes = this.buildNodes(pages);
    const edges = this.buildEdges(pages);
    const entryNodeId = nodes.find(n => n.type === 'entry')?.id ?? nodes[0].id;

    return {
      nodes,
      edges,
      meta: {
        totalNodes: nodes.length,
        totalEdges: edges.length,
        entryNodeId,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  // ── Nodes ──────────────────────────────────────────────────────────────────

  private buildNodes(pages: DiscoveredPage[]): GraphNode[] {
    return pages.map(page => ({
      id: page.id,
      url: page.url,
      title: page.title,
      type: this.nodeClassifier.classify(page),
      metadata: {
        depth: page.depth,
        visitOrder: page.visitOrder,
        interactiveElementCount: page.interactiveElements.length,
        hasForm: page.hasForm,
        urlPattern: normalizeUrlPattern(page.url),
      },
    }));
  }

  // ── Edges ──────────────────────────────────────────────────────────────────

  private buildEdges(pages: DiscoveredPage[]): GraphEdge[] {
    const all = [
      ...this.navigationDetector.detect(pages),
      ...this.parentChildDetector.detect(pages),
      ...this.workflowDetector.detect(pages),
    ];
    return mergeEdges(all);
  }
}

// ── Edge merge ────────────────────────────────────────────────────────────────
// When multiple detectors find the same source→target pair, collapse them into
// a single edge: union detectedBy[], take the highest weight, keep the primary
// type (the one with the highest weight among contributors).

function mergeEdges(edges: GraphEdge[]): GraphEdge[] {
  const map = new Map<string, GraphEdge>();

  for (const edge of edges) {
    const key = `${edge.source}→${edge.target}`;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, { ...edge, metadata: { ...edge.metadata } });
      continue;
    }

    const mergedDetectedBy = Array.from(
      new Set([...existing.metadata.detectedBy, ...edge.metadata.detectedBy]),
    ) as EdgeType[];

    const winner = edge.weight > existing.weight ? edge : existing;

    map.set(key, {
      ...winner,
      metadata: {
        ...winner.metadata,
        confidence: winner.weight,
        detectedBy: mergedDetectedBy,
      },
    });
  }

  return Array.from(map.values());
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeUrlPattern(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    // Replace numeric and UUID-like segments with :id
    url.pathname = url.pathname.replace(/\/[0-9a-f-]{8,}/gi, '/:id').replace(/\/\d+/g, '/:id');
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function emptyGraph(): ApplicationGraph {
  return {
    nodes: [],
    edges: [],
    meta: {
      totalNodes: 0,
      totalEdges: 0,
      entryNodeId: null,
      generatedAt: new Date().toISOString(),
    },
  };
}
