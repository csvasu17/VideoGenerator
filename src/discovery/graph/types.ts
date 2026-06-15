export type NodeType =
  | 'entry'
  | 'dashboard'
  | 'list'
  | 'detail'
  | 'form'
  | 'modal'
  | 'settings'
  | 'report'
  | 'generic';

export type EdgeType =
  | 'navigation'
  | 'parent-child'
  | 'workflow-sequence'
  | 'redirect';

export interface NodeMetadata {
  depth: number;
  visitOrder: number;
  interactiveElementCount: number;
  hasForm: boolean;
  urlPattern: string;
}

export interface EdgeMetadata {
  confidence: number;
  detectedBy: EdgeType[];
  anchorText?: string;
  stepIndex?: number;
}

export interface GraphNode {
  id: string;
  url: string;
  title: string;
  type: NodeType;
  metadata: NodeMetadata;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  weight: number;
  metadata: EdgeMetadata;
}

export interface GraphMeta {
  totalNodes: number;
  totalEdges: number;
  entryNodeId: string | null;
  generatedAt: string;
}

export interface ApplicationGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: GraphMeta;
}
