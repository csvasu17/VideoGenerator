import type { PipelineContext } from './PipelineContext';
import type { StageResult } from '../../core/domain/entities/PipelineRun';

// ─────────────────────────────────────────────────────────────────────────────
// Stage contract
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single, isolated pipeline step.
 *
 * TInput  — data the stage needs (derived from PipelineContext by the orchestrator).
 * TOutput — data the stage produces (stored back into PipelineContext).
 */
export interface PipelineStage<TInput, TOutput> {
  /** Human-readable stage name used in progress events and PipelineRun records. */
  readonly name: string;
  run(input: TInput, ctx: PipelineContext): Promise<TOutput>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Progress events
// ─────────────────────────────────────────────────────────────────────────────

export type ProgressEventType =
  | 'stage:start'
  | 'stage:complete'
  | 'stage:error'
  | 'stage:skip'
  | 'pipeline:complete'
  | 'pipeline:error';

export interface ProgressEvent {
  type:      ProgressEventType;
  stageName: string;
  /** 0–100 overall pipeline progress. */
  progress:  number;
  message?:  string;
  durationMs?: number;
  error?:    string;
}

export type ProgressCallback = (event: ProgressEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// StageRunner — wraps execution with timing, error capture, progress events
// ─────────────────────────────────────────────────────────────────────────────

export async function runStage<TInput, TOutput>(
  stage:      PipelineStage<TInput, TOutput>,
  input:      TInput,
  ctx:        PipelineContext,
  progress:   number,
  stageResults: StageResult[],
  onProgress?: ProgressCallback,
): Promise<TOutput> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  onProgress?.({ type: 'stage:start', stageName: stage.name, progress, message: `Starting ${stage.name}…` });

  try {
    const output = await stage.run(input, ctx);
    const durationMs = Date.now() - t0;

    stageResults.push({
      stageName:   stage.name,
      status:      'success',
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs,
    });

    onProgress?.({
      type: 'stage:complete',
      stageName: stage.name,
      progress,
      message: `${stage.name} completed in ${durationMs} ms`,
      durationMs,
    });

    return output;
  } catch (err) {
    const durationMs = Date.now() - t0;
    const error = err instanceof Error ? err.message : String(err);

    stageResults.push({
      stageName:   stage.name,
      status:      'failed',
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs,
      error,
    });

    onProgress?.({
      type: 'stage:error',
      stageName: stage.name,
      progress,
      message: `${stage.name} failed: ${error}`,
      durationMs,
      error,
    });

    throw err; // propagate so the orchestrator can abort
  }
}
