import type { EdgeType, NodeType } from '../../../discovery/graph/types';

export interface TopFeature {
  id: string;
  name: string;
  compositeScore: number;
  businessValue: string;
}

export interface WeightedNode {
  id: string;
  url: string;
  title: string;
  nodeType: NodeType;
  /** Aggregate demo value of this node. 0–100. */
  demoScore: number;
  featureIds: string[];
  topFeatures: TopFeature[];
  depth: number;
}

export interface WeightedEdge {
  id: string;
  source: string;
  target: string;
  edgeType: EdgeType;
  /** Lower = more natural for a demo viewer. 0–3. */
  cost: number;
  /** Anchor text or action label, if known. */
  label?: string;
}

export interface WeightedGraph {
  nodes: Map<string, WeightedNode>;
  /** Adjacency list: source node ID → outbound edges. */
  outEdges: Map<string, WeightedEdge[]>;
  /** Reverse adjacency: target node ID → inbound edges. */
  inEdges:  Map<string, WeightedEdge[]>;
  entryNodeId: string | null;
}
