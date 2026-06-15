/**
 * MotionDirectionStage — Phase 7 pipeline stage.
 *
 * Runs after RemotionExportStage. Takes the demo-package.json output and
 * produces a motion-package.json that includes the full MotionPlan.
 *
 * Backward-compatible: all new input fields are optional.
 * When only `demoPackage` and `intelligence` are provided (Phase 6 context),
 * featureImportance falls back gracefully to spotlightTarget.priority values.
 *
 * Output: motion-package.json written to outputDir.
 */

import path            from 'path';
import fs              from 'fs/promises';
import type { PipelineStage } from '../PipelineStage';
import type { PipelineContext } from '../PipelineContext';
import type { RemotionPackage } from '../../../core/domain/entities/RemotionPackage';
import type { PageIntelligence } from '../../../core/domain/entities/PageIntelligence';
import type { PrioritizedFeature } from '../../../core/domain/entities/PrioritizedFeature';
import type { BusinessValueOutput } from '../../../core/domain/entities/BusinessValueOutput';
import type { GlobalMotionStyle, MotionPlan } from '../../../motion/types';
import { MotionDirectionEngine } from '../../../motion/MotionDirectionEngine';
import { resolveTemplate } from '../../../video-templates/VideoTemplateStrategy';

// ─────────────────────────────────────────────────────────────────────────────
// Stage I/O
// ─────────────────────────────────────────────────────────────────────────────

export interface MotionDirectionInput {
  /** demo-package.json content (from RemotionExportStage output). */
  demoPackage:      RemotionPackage;
  /**
   * Per-page vision intelligence, keyed by pageId.
   * Derive from ctx.pageIntelligence before calling.
   */
  intelligence:     Map<string, PageIntelligence>;
  /** Absolute path to the output directory (motion-package.json written here). */
  outputDir:        string;

  // ── Optional richer pipeline signals ─────────────────────────────────────
  /** Enables featureRankScore. From ctx.prioritizedFeatures. */
  rankedFeatures?:  PrioritizedFeature[];
  /** Enables businessValueTierScore. From ctx.businessValueOutputs.outputs. */
  businessOutputs?: BusinessValueOutput[];
  /** Override default motion style. */
  globalStyle?:     Partial<GlobalMotionStyle>;
}

export interface MotionDirectionOutput {
  /** Absolute path to the written motion-package.json. */
  motionPackagePath: string;
  /** The computed motion plan (same data as in the written file). */
  motionPlan:        MotionPlan;
  /** Wall-clock time for the stage in milliseconds. */
  durationMs:        number;
}

// ─────────────────────────────────────────────────────────────────────────────
// MotionDirectionStage
// ─────────────────────────────────────────────────────────────────────────────

export class MotionDirectionStage
  implements PipelineStage<MotionDirectionInput, MotionDirectionOutput>
{
  readonly name = 'Motion Direction';

  private readonly engine = new MotionDirectionEngine();

  async run(
    input: MotionDirectionInput,
    ctx:   PipelineContext,
  ): Promise<MotionDirectionOutput> {
    // Enterprise template uses static camera — skip motion planning entirely.
    if (resolveTemplate(ctx.input.options?.videoTemplate) === 'enterprise') {
      const outputPath = path.join(input.outputDir, 'motion-package.json');
      const stub = { motionPlan: null, skippedReason: 'enterprise-template' };
      await fs.writeFile(outputPath, JSON.stringify(stub, null, 2), 'utf-8');
      return { motionPackagePath: outputPath, motionPlan: null as unknown as MotionPlan, durationMs: 0 };
    }

    const t0 = Date.now();

    // Compute the motion package
    const motionPackage = this.engine.toMotionPackage({
      demoPackage:     input.demoPackage,
      intelligence:    input.intelligence,
      rankedFeatures:  input.rankedFeatures,
      businessOutputs: input.businessOutputs,
      globalStyle:     input.globalStyle,
    });

    // Write to disk
    const outputPath = path.join(input.outputDir, 'motion-package.json');
    await fs.writeFile(outputPath, JSON.stringify(motionPackage, null, 2), 'utf-8');

    const durationMs = Date.now() - t0;

    return {
      motionPackagePath: outputPath,
      motionPlan:        motionPackage.motionPlan,
      durationMs,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a MotionDirectionInput from PipelineContext after RemotionExportStage.
 * This avoids boilerplate in WorkflowOrchestrator.
 */
export function buildMotionDirectionInput(
  ctx:       PipelineContext,
  outputDir: string,
): MotionDirectionInput | null {
  if (!ctx.remotionPackage) return null;

  // Build intelligence map keyed by pageId
  const intelligence = new Map<string, PageIntelligence>();
  for (const intel of (ctx.pageIntelligence ?? [])) {
    intelligence.set(intel.pageId, intel);
  }

  const businessOutputs: BusinessValueOutput[] | undefined =
    ctx.businessValueOutputs?.outputs;

  return {
    demoPackage:     ctx.remotionPackage,
    intelligence,
    outputDir,
    rankedFeatures:  ctx.prioritizedFeatures,
    businessOutputs,
  };
}
