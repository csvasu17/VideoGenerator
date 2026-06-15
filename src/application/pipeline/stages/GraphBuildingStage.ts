import type { PipelineStage } from '../PipelineStage';
import type { PipelineContext } from '../PipelineContext';
import type { DiscoveredPage } from '../../../core/domain/entities/DiscoveredPage';
import type { ApplicationGraph } from '../../../discovery/graph/types';
import { createApplicationGraphBuilder } from '../../../discovery/graph';

export class GraphBuildingStage implements PipelineStage<DiscoveredPage[], ApplicationGraph> {
  readonly name = 'Graph Building';

  async run(pages: DiscoveredPage[], _ctx: PipelineContext): Promise<ApplicationGraph> {
    const builder = createApplicationGraphBuilder();
    return builder.build(pages);
  }
}
