import { ApplicationGraphBuilder } from '../ApplicationGraphBuilder';
import { NavigationEdgeDetector } from '../detectors/NavigationEdgeDetector';
import { ParentChildDetector } from '../detectors/ParentChildDetector';
import { WorkflowSequenceDetector } from '../detectors/WorkflowSequenceDetector';
import { NodeClassifier } from '../NodeClassifier';
import type { DiscoveredPage } from '../../../core/domain/entities/DiscoveredPage';

function makeBuilder(): ApplicationGraphBuilder {
  return new ApplicationGraphBuilder(
    new NavigationEdgeDetector(),
    new ParentChildDetector(),
    new WorkflowSequenceDetector(),
    new NodeClassifier(),
  );
}

function page(overrides: Partial<DiscoveredPage> & { id: string; url: string }): DiscoveredPage {
  return {
    title: 'Page',
    depth: 1,
    visitOrder: 0,
    outboundLinks: [],
    interactiveElements: [],
    hasForm: false,
    httpStatus: 200,
    ...overrides,
  };
}

// ── Empty input ───────────────────────────────────────────────────────────────

describe('empty input', () => {
  it('returns an empty graph', () => {
    const graph = makeBuilder().build([]);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
    expect(graph.meta.entryNodeId).toBeNull();
    expect(graph.meta.totalNodes).toBe(0);
    expect(graph.meta.totalEdges).toBe(0);
  });
});

// ── Nodes ─────────────────────────────────────────────────────────────────────

describe('node classification', () => {
  it('classifies login page as entry', () => {
    const graph = makeBuilder().build([page({ id: 'p1', url: 'https://app.test/login', depth: 0 })]);
    expect(graph.nodes[0].type).toBe('entry');
  });

  it('classifies dashboard page correctly', () => {
    const graph = makeBuilder().build([page({ id: 'p1', url: 'https://app.test/dashboard' })]);
    expect(graph.nodes[0].type).toBe('dashboard');
  });

  it('sets urlPattern replacing numeric segment with :id', () => {
    const graph = makeBuilder().build([page({ id: 'p1', url: 'https://app.test/users/42' })]);
    expect(graph.nodes[0].metadata.urlPattern).toBe('https://app.test/users/:id');
  });

  it('includes visitOrder and depth in metadata', () => {
    const graph = makeBuilder().build([
      page({ id: 'p1', url: 'https://app.test/home', depth: 0, visitOrder: 0 }),
    ]);
    expect(graph.nodes[0].metadata.depth).toBe(0);
    expect(graph.nodes[0].metadata.visitOrder).toBe(0);
  });
});

// ── Parent-child edges ────────────────────────────────────────────────────────

describe('parent-child detection', () => {
  it('creates a parent-child edge from /users to /users/123', () => {
    const pages = [
      page({ id: 'parent', url: 'https://app.test/users', depth: 1 }),
      page({ id: 'child', url: 'https://app.test/users/123', depth: 2 }),
    ];
    const graph = makeBuilder().build(pages);
    const pcEdge = graph.edges.find(e => e.type === 'parent-child');
    expect(pcEdge).toBeDefined();
    expect(pcEdge!.source).toBe('parent');
    expect(pcEdge!.target).toBe('child');
  });

  it('does not create a self-referencing edge', () => {
    const pages = [page({ id: 'p1', url: 'https://app.test/users', depth: 1 })];
    const graph = makeBuilder().build(pages);
    expect(graph.edges.every(e => e.source !== e.target)).toBe(true);
  });

  it('creates a chain for three nested levels', () => {
    const pages = [
      page({ id: 'a', url: 'https://app.test/a', depth: 1 }),
      page({ id: 'b', url: 'https://app.test/a/b', depth: 2 }),
      page({ id: 'c', url: 'https://app.test/a/b/c', depth: 3 }),
    ];
    const graph = makeBuilder().build(pages);
    const pcEdges = graph.edges.filter(e => e.type === 'parent-child');
    expect(pcEdges).toHaveLength(2);
  });
});

// ── Navigation edges ──────────────────────────────────────────────────────────

describe('navigation edge detection', () => {
  it('creates navigation edge when page A links to page B', () => {
    const pages = [
      page({
        id: 'a',
        url: 'https://app.test/home',
        outboundLinks: ['https://app.test/dashboard'],
        interactiveElements: [
          { type: 'link', selector: 'a', text: 'Dashboard', href: 'https://app.test/dashboard' },
        ],
      }),
      page({ id: 'b', url: 'https://app.test/dashboard' }),
    ];
    const graph = makeBuilder().build(pages);
    const navEdge = graph.edges.find(e => e.type === 'navigation');
    expect(navEdge).toBeDefined();
    expect(navEdge!.source).toBe('a');
    expect(navEdge!.target).toBe('b');
    expect(navEdge!.metadata.anchorText).toBe('Dashboard');
  });

  it('ignores links to pages not in the discovered set', () => {
    const pages = [
      page({
        id: 'a',
        url: 'https://app.test/home',
        outboundLinks: ['https://external.com/page'],
      }),
    ];
    const graph = makeBuilder().build(pages);
    expect(graph.edges).toHaveLength(0);
  });
});

// ── Workflow-sequence edges ───────────────────────────────────────────────────

describe('workflow-sequence detection', () => {
  it('orders step-1 → step-2 → step-3 correctly', () => {
    const pages = [
      page({ id: 's1', url: 'https://app.test/checkout/step-1', depth: 2, visitOrder: 0 }),
      page({ id: 's2', url: 'https://app.test/checkout/step-2', depth: 2, visitOrder: 1 }),
      page({ id: 's3', url: 'https://app.test/checkout/step-3', depth: 2, visitOrder: 2 }),
    ];
    const graph = makeBuilder().build(pages);
    const wfEdges = graph.edges.filter(e => e.metadata.detectedBy.includes('workflow-sequence'));
    expect(wfEdges).toHaveLength(2);
    expect(wfEdges[0].source).toBe('s1');
    expect(wfEdges[0].target).toBe('s2');
    expect(wfEdges[1].source).toBe('s2');
    expect(wfEdges[1].target).toBe('s3');
  });
});

// ── Edge merging ──────────────────────────────────────────────────────────────

describe('edge merging', () => {
  it('merges parent-child and navigation into a single edge with both detectedBy entries', () => {
    // /users is both the URL parent of /users/123 AND has a direct link to it
    const pages = [
      page({
        id: 'list',
        url: 'https://app.test/users',
        outboundLinks: ['https://app.test/users/123'],
        interactiveElements: [
          { type: 'link', selector: 'a', href: 'https://app.test/users/123', text: 'John' },
        ],
      }),
      page({ id: 'detail', url: 'https://app.test/users/123' }),
    ];
    const graph = makeBuilder().build(pages);

    // Should be collapsed into one edge
    const edge = graph.edges.find(e => e.source === 'list' && e.target === 'detail');
    expect(edge).toBeDefined();
    expect(edge!.metadata.detectedBy).toContain('navigation');
    expect(edge!.metadata.detectedBy).toContain('parent-child');
  });

  it('does not produce duplicate edges for the same source→target pair', () => {
    const pages = [
      page({
        id: 'a',
        url: 'https://app.test/users',
        outboundLinks: ['https://app.test/users/1'],
      }),
      page({ id: 'b', url: 'https://app.test/users/1' }),
    ];
    const graph = makeBuilder().build(pages);
    const ab = graph.edges.filter(e => e.source === 'a' && e.target === 'b');
    expect(ab).toHaveLength(1);
  });
});

// ── Meta ──────────────────────────────────────────────────────────────────────

describe('graph meta', () => {
  it('sets entryNodeId to the first entry-type node', () => {
    const pages = [
      page({ id: 'login', url: 'https://app.test/login', depth: 0, visitOrder: 0 }),
      page({ id: 'home', url: 'https://app.test/home', depth: 1, visitOrder: 1 }),
    ];
    const graph = makeBuilder().build(pages);
    expect(graph.meta.entryNodeId).toBe('login');
  });

  it('totalNodes and totalEdges match array lengths', () => {
    const pages = [
      page({ id: 'a', url: 'https://app.test/a' }),
      page({ id: 'b', url: 'https://app.test/a/b' }),
    ];
    const graph = makeBuilder().build(pages);
    expect(graph.meta.totalNodes).toBe(graph.nodes.length);
    expect(graph.meta.totalEdges).toBe(graph.edges.length);
  });

  it('generatedAt is a valid ISO date string', () => {
    const graph = makeBuilder().build([page({ id: 'p', url: 'https://app.test/' })]);
    expect(() => new Date(graph.meta.generatedAt)).not.toThrow();
    expect(new Date(graph.meta.generatedAt).toISOString()).toBe(graph.meta.generatedAt);
  });
});
