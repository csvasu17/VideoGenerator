import type { PipelineStage } from '../PipelineStage';
import type { PipelineContext } from '../PipelineContext';
import type {
  StoryArc,
  ArcType,
} from '../../../core/domain/entities/SalesStory';
import type { PageIntelligence } from '../../../core/domain/entities/PageIntelligence';
import type { PrioritizedFeature } from '../../../core/domain/entities/PrioritizedFeature';
import type { PageCapture } from '../../../core/domain/entities/PageCapture';
import type { BusinessValueEnrichmentResult } from '../../../core/domain/entities/BusinessValueOutput';
import type { ReadinessResult } from '../../../core/domain/entities/ReadinessResult';
import { BusinessOutcomeMapper } from '../../../sales-story/BusinessOutcomeMapper';
import { StoryArcSelector } from '../../../sales-story/StoryArcSelector';
import { SceneGoalBuilder } from '../../../sales-story/SceneGoalBuilder';
import { SalesStoryValidator } from '../../../sales-story/SalesStoryValidator';

// ─────────────────────────────────────────────────────────────────────────────
// Input type
// ─────────────────────────────────────────────────────────────────────────────

export interface SalesStoryDirectorInput {
  intelligence:      PageIntelligence[];
  features:          PrioritizedFeature[];
  businessOutputs?:  BusinessValueEnrichmentResult;
  readinessResults:  ReadinessResult[];
  captures:          PageCapture[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildArcTitle(arcType: ArcType): string {
  const titles: Record<ArcType, string> = {
    reactive_to_predictive: 'From Reactive to Predictive Operations',
    visibility_to_control:  'From Visibility to Complete Control',
    data_to_decisions:      'From Data to Better Decisions',
    risk_to_resilience:     'From Risk to Operational Resilience',
  };
  return titles[arcType];
}

function buildPremise(arcType: ArcType): string {
  const premises: Record<ArcType, string> = {
    reactive_to_predictive: 'Unplanned failures drain budgets and teams',
    visibility_to_control:  'Scattered data makes informed action impossible',
    data_to_decisions:      'Data without insight is just noise',
    risk_to_resilience:     'Operational risk erodes margin and confidence',
  };
  return premises[arcType];
}

function buildResolution(arcType: ArcType, productName: string): string {
  const resolutions: Record<ArcType, string> = {
    reactive_to_predictive: `${productName} turns every data point into a prevention strategy`,
    visibility_to_control:  `${productName} gives your team one place to see, act, and scale`,
    data_to_decisions:      `${productName} surfaces the insight buried in your operational data`,
    risk_to_resilience:     `${productName} builds confidence through prediction and validation`,
  };
  return resolutions[arcType];
}

// ─────────────────────────────────────────────────────────────────────────────
// SalesStoryDirectorStage
// ─────────────────────────────────────────────────────────────────────────────

export class SalesStoryDirectorStage
  implements PipelineStage<SalesStoryDirectorInput, StoryArc>
{
  readonly name = 'Sales Story';

  private readonly arcSelector = new StoryArcSelector();
  private readonly goalBuilder = new SceneGoalBuilder();
  private readonly validator   = new SalesStoryValidator();

  async run(input: SalesStoryDirectorInput, _ctx: PipelineContext): Promise<StoryArc> {
    // 1. Map features => BusinessOutcomes
    const outcomes = BusinessOutcomeMapper.build(
      input.features,
      input.businessOutputs,
      input.intelligence,
      input.readinessResults,
    );

    // 2. Select arc type + scene order
    const { arcType, scenes: selectedScenes } = this.arcSelector.select(
      outcomes,
      input.readinessResults,
    );

    // 3. Build scene goals
    const intelMap = new Map(input.intelligence.map(i => [i.pageId, i]));
    const sceneGoals = this.goalBuilder.buildAll(selectedScenes, outcomes, intelMap);

    // 4. Validate
    const { arcValidation, sceneValidations } = this.validator.validate(sceneGoals, arcType);

    // 5. Assemble StoryArc
    const productName = 'the Platform'; // WorkflowOrchestrator will override via opts

    const storyArc: StoryArc = {
      arcType,
      title:             buildArcTitle(arcType),
      premise:           buildPremise(arcType),
      resolution:        buildResolution(arcType, productName),
      scenes:            sceneGoals,
      arcNarrative:      arcValidation.narrative,
      openingHook:       sceneGoals[0]?.narrativeHook ?? '',
      closingCTA:        'Schedule a live demo today',
      validationSummary: arcValidation,
      sceneValidations,
    };

    return storyArc;
  }
}
