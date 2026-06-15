import type { PipelineStage } from '../PipelineStage';
import type { PipelineContext } from '../PipelineContext';
import type { Storyboard } from '../../../core/domain/entities/Storyboard';
import type { PageCapture } from '../../../core/domain/entities/PageCapture';
import type { PageIntelligence } from '../../../core/domain/entities/PageIntelligence';
import type { RemotionPackage } from '../../../core/domain/entities/RemotionPackage';
import { RemotionExporter } from '../../../agents/remotion/RemotionExporter';
import { EnterpriseRemotionExporter } from '../../../agents/remotion/EnterpriseRemotionExporter';
import { resolveTemplate } from '../../../video-templates/VideoTemplateStrategy';

export interface RemotionExportInput {
  storyboard: Storyboard;
  captures:   PageCapture[];
  outputDir:  string;
  meta: {
    productName:    string;
    targetAudience: string;
    primaryBenefit: string;
  };
  /**
   * Phase 3: per-page vision intelligence used to build SpotlightTargets.
   * Optional — when absent all scenes fall back to Ken-Burns.
   */
  intelligence?: PageIntelligence[];
}

export interface RemotionExportOutput {
  package:    RemotionPackage;
  outputPath: string;
}

export class RemotionExportStage
  implements PipelineStage<RemotionExportInput, RemotionExportOutput>
{
  readonly name = 'Remotion Export';

  async run(input: RemotionExportInput, ctx: PipelineContext): Promise<RemotionExportOutput> {
    const template = resolveTemplate(ctx.input.options?.videoTemplate);

    if (template === 'enterprise') {
      const exporter = new EnterpriseRemotionExporter();
      return exporter.export({
        ...input,
        storyArc:             ctx.salesStory,
        businessValueOutputs: ctx.businessValueOutputs?.outputs,
      });
    }

    return new RemotionExporter().export(input);
  }
}
