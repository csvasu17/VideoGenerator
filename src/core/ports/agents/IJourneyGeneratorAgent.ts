import type { ApplicationGraph } from '../../../discovery/graph/types';
import type { PrioritizedFeature } from '../../domain/entities/PrioritizedFeature';
import type { DemoJourney } from '../../domain/entities/DemoJourney';

export interface JourneyGeneratorOptions {
  /** Target number of steps. Default: 7. */
  targetSteps?: number;
  minSteps?: number;
  maxSteps?: number;
  /** Beam width for path search. Default: 8. */
  beamWidth?: number;
}

export interface IJourneyGeneratorAgent {
  generate(
    graph: ApplicationGraph,
    features: PrioritizedFeature[],
    options?: JourneyGeneratorOptions,
  ): DemoJourney;
}
