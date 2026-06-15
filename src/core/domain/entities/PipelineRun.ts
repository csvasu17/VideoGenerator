// ─────────────────────────────────────────────────────────────────────────────
// PipelineRun — tracks the full execution of one workflow invocation.
// ─────────────────────────────────────────────────────────────────────────────

export type StageStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface StageResult {
  stageName:   string;
  status:      StageStatus;
  startedAt:   string;     // ISO timestamp
  completedAt: string;     // ISO timestamp
  durationMs:  number;
  /** Human-readable summary of what the stage produced. */
  summary?:    string;
  /** Stringified error message if status === 'failed'. */
  error?:      string;
}

export type PipelineStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface PipelineRun {
  id:             string;
  inputUrl:       string;
  startedAt:      string;
  completedAt?:   string;
  totalDurationMs?: number;
  status:         PipelineStatus;
  /** One entry per pipeline stage, in execution order. */
  stages:         StageResult[];
  /** Absolute path to the written demo-package.json. */
  outputPath?:    string;
  /** Total number of pages discovered. */
  pagesDiscovered?: number;
  /** Total number of features ranked. */
  featuresRanked?:  number;
  /** Total number of scenes in the storyboard. */
  sceneCount?:      number;
}
