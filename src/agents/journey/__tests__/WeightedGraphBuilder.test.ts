import { WeightedGraphBuilder } from '../graph/WeightedGraphBuilder';
import type { ApplicationGraph } from '../../../discovery/graph/types';
import type { PrioritizedFeature } from '../../../core/domain/entities/PrioritizedFeature';

function baseGraph(): ApplicationGraph {
  return {
    nodes: [
      { id: 'n1', url: '/home',    title: 'Home',    type: 'entry',     metadata: { depth: 0, visitOrder: 0, interactiveElementCount: 2, hasForm: false, urlPattern: '/' } },
      { id: 'n2', url: '/reports', title: 'Reports', type: 'report',    metadata: { depth: 1, visitOrder: 1, interactiveElementCount: 6, hasForm: false, urlPattern: '/reports' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2', type: 'navigation', weight: 0.9, metadata: { confidence: 0.9, detectedBy: ['navigation'], anchorText: 'Reports' } },
    ],
    meta: { totalNodes: 2, totalEdges: 1, entryNodeId: 'n1', generatedAt: '' },
  };
}

function feature(id: string, pageId: string, composite: number): PrioritizedFeature {
  return {
    feature: {
      id,
      name: id,
      summary: '',
      detailedDescription: '',
      category: 'core',
      businessValue: { headline: 'h', painSolved: '', beneficiary: '', outcomeType: 'efficiency' },
      signals: { pageCount: 1, interactiveElementCount: 3, hasVisualizations: false, hasNotifications: false, isOnCriticalPath: false },
      relatedFeatureIds: [],
      pageIds: [pageId],
    },
    scores: { businessValue: composite, visualAppeal: composite, userImportance: composite, revenueImpact: composite },
    composite,
    rank: 1,
    rationale: '',
  };
}

describe('WeightedGraphBuilder', () => {
  const builder = new WeightedGraphBuilder();

  it('creates a node for every graph node', () => {
    const wg = builder.build(baseGraph(), []);
    expect(wg.nodes.size).toBe(2);
    expect(wg.nodes.has('n1')).toBe(true);
    expect(wg.nodes.has('n2')).toBe(true);
  });

  it('sets entryNodeId from graph meta', () => {
    const wg = builder.build(baseGraph(), []);
    expect(wg.entryNodeId).toBe('n1');
  });

  it('wires outEdges and inEdges symmetrically', () => {
    const wg = builder.build(baseGraph(), []);
    expect(wg.outEdges.get('n1')).toHaveLength(1);
    expect(wg.inEdges.get('n2')).toHaveLength(1);
    expect(wg.outEdges.get('n2')).toHaveLength(0);
  });

  it('edge cost is within expected range', () => {
    const wg = builder.build(baseGraph(), []);
    const edge = wg.outEdges.get('n1')![0];
    expect(edge.cost).toBeGreaterThan(0);
    expect(edge.cost).toBeLessThanOrEqual(3);
  });

  it('assigns features from pageIds map to correct nodes', () => {
    const features = [feature('f1', 'n2', 90)];
    const wg = builder.build(baseGraph(), features);

    const n2 = wg.nodes.get('n2')!;
    expect(n2.featureIds).toContain('f1');
    expect(n2.topFeatures[0].id).toBe('f1');
  });

  it('demoScore is higher for report node when features are present', () => {
    const features = [feature('f1', 'n2', 95)];
    const wg = builder.build(baseGraph(), features);
    const n1 = wg.nodes.get('n1')!;
    const n2 = wg.nodes.get('n2')!;
    // n2 (report + high-value feature) should outrank n1 (entry, no features)
    expect(n2.demoScore).toBeGreaterThan(n1.demoScore);
  });

  it('infers entry node when meta.entryNodeId is null', () => {
    const g = baseGraph();
    g.meta.entryNodeId = null;
    const wg = builder.build(g, []);
    expect(wg.entryNodeId).not.toBeNull();
    expect(wg.nodes.has(wg.entryNodeId!)).toBe(true);
  });
});
