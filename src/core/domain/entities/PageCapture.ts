export type CaptureStatus = 'success' | 'partial' | 'failed';

export type CaptureErrorType =
  | 'navigation'
  | 'full-screenshot'
  | 'viewport-screenshot'
  | 'dom-snapshot';

export interface CaptureError {
  type: CaptureErrorType;
  message: string;
  attempts: number;
}

/**
 * RF7 — disk-based screenshot storage.
 *
 * Screenshots are written to disk immediately after capture and only the file
 * paths are kept in memory.  No Buffer accumulates across pages, so memory
 * usage stays O(1) regardless of how many pages are captured.
 *
 * Consumers that need the raw pixels (e.g. VisionAnalysisAgent) must load the
 * file on demand via ScreenshotLoader.
 */
export interface ScreenshotData {
  /** Absolute path to the full-page screenshot file, or null if capture failed. */
  fullPath:     string | null;
  /** Absolute path to the viewport screenshot file, or null if capture failed. */
  viewportPath: string | null;
  encoding:     'png' | 'jpeg';
}

export interface DOMSnapshot {
  html: string;
  title: string;
  url: string;
  textContent: string;
  headings: string[];
  links: Array<{ text: string; href: string }>;
  formCount: number;
  inputCount: number;
  buttonCount: number;
  imageCount: number;
  ariaLandmarks: string[];
}

export interface CaptureMetadata {
  capturedAt: string;
  durationMs: number;
  status: CaptureStatus;
  errors: CaptureError[];
  viewportWidth: number;
  viewportHeight: number;
  pageTitle: string;
  finalUrl: string;
  htmlSizeBytes: number;
  fullScreenshotBytes: number;
  viewportScreenshotBytes: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// InPageDiscovery exploration summary
//
// Populated by InPageDiscoveryStage after the stage runs against a base page.
// Undefined means the page was never explored (pipeline ran without the stage).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Summary of what InPageDiscovery found on one base page.
 * Stored on PageCapture so diagnostics and reports can access it without
 * reaching into the MVID module types.
 */
export interface PageExplorationSummary {
  /** Total interaction targets that were clicked (approximates detected count). */
  targetsDetected:       number;
  /** Total click-attempts made against this page. */
  statesAttempted:       number;
  /** Number of attempts that produced a meaningfully different state. */
  meaningfulStates:      number;
  /**
   * Why exploration stopped:
   *   completed        — all targets exhausted within budget
   *   time-exhausted   — maxTimeMs reached
   *   state-exhausted  — maxStates reached
   *   attempt-exhausted — maxAttempts reached
   *   skipped          — capture failed; exploration was not started
   *   failed           — an unexpected error aborted exploration
   */
  budgetStatus:          | 'completed'
                         | 'time-exhausted'
                         | 'state-exhausted'
                         | 'attempt-exhausted'
                         | 'skipped'
                         | 'failed';
  explorationDurationMs: number;
  /** Absolute filesystem paths to meaningful-state screenshots, in discovery order. */
  interactionStatePaths: string[];
}

export interface PageCapture {
  pageId: string;
  screenshot: ScreenshotData;
  dom: DOMSnapshot;
  metadata: CaptureMetadata;
  /**
   * Set by InPageDiscoveryStage after exploring this page for hidden states.
   * Undefined when the pipeline is run without InPageDiscoveryStage.
   */
  explorationResult?: PageExplorationSummary;
}
