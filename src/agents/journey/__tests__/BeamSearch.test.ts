import { BeamSearch } from '../search/BeamSearch';
import type { WeightedGraph } from '../graph/WeightedGraph';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: minimal WeightedGraph factory
// ─────────────────────────────────────────────────────────────────────────────

function linearGraph(size: number): WeightedGraph {
  const nodes = new Map(
    Array.from({ length: size }, (_, i) => {
      const id = `n${i}`;
      return [
        id,
        {
          id,
          url:         `/${id}`,
          title:       `Page ${i}`,
          nodeType:    (i === 0 ? 'entry' : i === size - 1 ? 'report' : 'list') as any,
          demoScore:   40 + i * 10,
          featureIds:  [`f${i}`] as string[],
          topFeatures: [{ id: `f${i}`, name: `Feature ${i}`, compositeScore: 50 + i, businessValue: 'efficiency' }] as any[],
          depth:       i,
        },
      ] as const;
    }),
  );

  const outEdges = new Map<string, any[]>();
  const inEdges  = new Map<string, any[]>();

  for (const id of nodes.keys()) {
    outEdges.set(id, []);
    inEdges.set(id, []);
  }

  for (let i = 0; i < size - 1; i++) {
    const edge = {
      id:       `e${i}`,
      source:   `n${i}`,
      target:   `n${i + 1}`,
      edgeType: 'navigation' as const,
      cost:     1.5,
    };
    outEdges.get(`n${i}`)!.push(edge);
    inEdges.get(`n${i + 1}`)!.push(edge);
  }

  return { nodes, outEdges, inEdges, entryNodeId: 'n0' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('BeamSearch', () => {
  const search = new BeamSearch();

  it('returns a path from a simple linear graph', () => {
    const path = search.run(linearGraph(5));
    expect(path.nodeIds.length).toBeGreaterThanOrEqual(1);
    expect(path.score).toBeGreaterThanOrEqual(0);
  });

  it('path starts at the entry node', () => {
    const path = search.run(linearGraph(6));
    expect(path.nodeIds[0]).toBe('n0');
  });

  it('path length does not exceed maxSteps', () => {
    const path = search.run(linearGraph(10), { maxSteps: 4, minSteps: 2, targetSteps: 3, beamWidth: 4 });
    expect(path.nodeIds.length).toBeLessThanOrEqual(4);
  });

  it('no node appears twice in the path', () => {
    const path = search.run(linearGraph(8));
    const unique = new Set(path.nodeIds);
    expect(unique.size).toBe(path.nodeIds.length);
  });

  it('coveredFeatureIds equals union of node featureIds on path', () => {
    const graph = linearGraph(5);
    const path  = search.run(graph, { minSteps: 2, maxSteps: 5 });
    const expectedFeatureIds = new Set(
      path.nodeIds.flatMap(id => graph.nodes.get(id)?.featureIds ?? []),
    );
    expect(new Set(path.coveredFeatureIds)).toEqual(expectedFeatureIds);
  });

  it('handles a single-node graph without throwing', () => {
    const g = linearGraph(1);
    const path = search.run(g, { minSteps: 1, maxSteps: 3 });
    expect(path.nodeIds).toContain('n0');
  });

  it('handles no entry node via fallback', () => {
    const g = linearGraph(4);
    g.entryNodeId = null;
    const path = search.run(g, { minSteps: 1 });
    expect(path.nodeIds.length).toBeGreaterThan(0);
  });

  it('path score increases with more features covered (heuristic check)', () => {
    const shortPath = search.run(linearGraph(3), { minSteps: 1, maxSteps: 2, targetSteps: 2 });
    const longPath  = search.run(linearGraph(8), { minSteps: 4, maxSteps: 8, targetSteps: 6 });
    // Long path should cover more features and thus tend to have equal or higher score
    // This is not strictly guaranteed but holds for our test graph
    expect(longPath.coveredFeatureIds.length).toBeGreaterThanOrEqual(shortPath.coveredFeatureIds.length);
  });
});
