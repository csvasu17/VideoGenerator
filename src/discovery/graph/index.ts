export { ApplicationGraphBuilder } from './ApplicationGraphBuilder';
export { GraphExporter } from './GraphExporter';
export { NodeClassifier } from './NodeClassifier';
export { NavigationEdgeDetector } from './detectors/NavigationEdgeDetector';
export { ParentChildDetector } from './detectors/ParentChildDetector';
export { WorkflowSequenceDetector } from './detectors/WorkflowSequenceDetector';
export type {
  ApplicationGraph,
  EdgeType,
  GraphEdge,
  GraphMeta,
  GraphNode,
  NodeType,
  NodeMetadata,
  EdgeMetadata,
} from './types';

import { ApplicationGraphBuilder } from './ApplicationGraphBuilder';
import { NavigationEdgeDetector } from './detectors/NavigationEdgeDetector';
import { ParentChildDetector } from './detectors/ParentChildDetector';
import { WorkflowSequenceDetector } from './detectors/WorkflowSequenceDetector';
import { NodeClassifier } from './NodeClassifier';

/** Convenience factory — use directly or replace with your DI container bindings. */
export function createApplicationGraphBuilder(): ApplicationGraphBuilder {
  return new ApplicationGraphBuilder(
    new NavigationEdgeDetector(),
    new ParentChildDetector(),
    new WorkflowSequenceDetector(),
    new NodeClassifier(),
  );
}
