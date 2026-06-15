import type { Browser, BrowserContext } from 'playwright';
import type { AuthSession } from '../../core/ports/agents/IAuthAgent';
import type { DiscoveredPage } from '../../core/domain/entities/DiscoveredPage';
import type { ApplicationGraph } from '../../discovery/graph/types';
import type { PageCapture } from '../../core/domain/entities/PageCapture';
import type { PageIntelligence } from '../../core/domain/entities/PageIntelligence';
import type { PrioritizedFeature } from '../../core/domain/entities/PrioritizedFeature';
import type { DemoJourney } from '../../core/domain/entities/DemoJourney';
import type { Storyboard } from '../../core/domain/entities/Storyboard';
import type { RemotionPackage } from '../../core/domain/entities/RemotionPackage';
import type { SealedCredentials } from '../../core/domain/entities/Credentials';
import type { BusinessValueEnrichmentResult } from '../../core/domain/entities/BusinessValueOutput';
import { ContextEnvelope } from '../../core/domain/entities/context/ContextEnvelope';
import type { MotionPlan }             from '../../motion/types';
import type { ReadinessResult }       from '../../core/domain/entities/ReadinessResult';
import type { StoryArc }              from '../../core/domain/entities/SalesStory';
import type { ExplorationResult }     from '../../agents/discovery/interaction/types';
import type { InteractionReplayPlan } from '../../core/domain/entities/InteractionReplay';

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowOptions — tuning knobs shared by both public and internal input types
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkflowOptions {
  /** Product name for sales narration. */
  productName?:     string;
  /** Buyer persona for opening copy. */
  targetAudience?:  string;
  /** The single most compelling benefit to land in the demo. */
  primaryBenefit?:  string;
  /** Closing CTA text. Default: "Schedule a live demo today". */
  callToAction?:    string;
  /** BFS depth for discovery. Default: 3. */
  maxDepth?:        number;
  /** Max pages to capture. Default: 50. */
  maxPages?:        number;
  /** Target number of journey steps. Default: 7. */
  targetJourneySteps?: number;
  /**
   * Minimum readinessScore for a page to be included in the journey.
   * Pages below this threshold are filtered out before JourneyGenerationStage.
   * Default: 0.40.
   */
  readinessThreshold?: number;
  /**
   * Minimum number of pages guaranteed to reach journey generation regardless
   * of readinessThreshold — borderline pages are promoted to meet this floor.
   * Hard-rejected pages (login, error, blank) are never promoted.
   * Default: 5.
   */
  minScenesAfterFilter?: number;
  /** Run browser in headless mode. Default: true. */
  headless?:        boolean;
  /**
   * Skip SSRF / private-IP validation.
   * Set to `true` when targeting a local dev server (localhost, 127.x, …).
   * Never set this in production — it exists only for developer workflows.
   */
  allowLocalUrls?:  boolean;
  /**
   * Additional URLs (absolute or relative to the app origin) to seed the
   * discovery BFS queue. Use for SPA routes that are not reachable via normal
   * link extraction (e.g. React Router sidebar items rendered as JS events).
   * Relative paths are resolved against the app URL origin.
   * Example: ['/dashboard', '/sites', '/alarms', '/devices']
   */
  seedUrls?: string[];
  /**
   * Browser device pixel ratio used when capturing screenshots.
   * 2 = Retina quality (3840×2160 physical pixels at 1920×1080 logical viewport).
   * Defaults to 2 in WorkflowOrchestrator; set to 1 to halve disk usage at the
   * cost of visible pixelation when camera zoom is applied.
   */
  screenshotScale?: number;
  /**
   * Video presentation template.
   * 'modern_saas' — dark background, glassmorphic narration bar, camera zoom/pan,
   *                 animated opening title, animated closing card. (default)
   * 'enterprise'  — B-roll problem opening, white product screens, static camera,
   *                 presenter overlay, animated benefit slide, presenter closing.
   */
  videoTemplate?: 'modern_saas' | 'enterprise';
}

// ─────────────────────────────────────────────────────────────────────────────
// RunInput — public API boundary (raw strings from callers / CLI / env)
//
// The orchestrator accepts RunInput, validates the URL (RF6), wraps the
// credentials in SealedCredentials (RF5), then converts to WorkflowInput
// before touching any pipeline logic.
// ─────────────────────────────────────────────────────────────────────────────

export interface RunInput {
  /** Application root URL (must be http/https, no private/metadata hosts). */
  url:      string;
  /** Plaintext username — consumed once by AuthStage then sealed. */
  username: string;
  /** Plaintext password — consumed once by AuthStage then sealed. */
  password: string;
  /** Absolute path where captures + demo-package.json will be written. */
  outputDir: string;
  options?: WorkflowOptions;
  /**
   * Optional natural language description of the application's business context.
   * 1–5 sentences from a Sales Engineer, Pre-Sales Consultant, PM, or AE.
   * Must never contain page names, feature names, or technical configuration.
   * When provided, ContextExpansionAgent expands this into structured context
   * that boosts (never penalises) feature ranking and narration quality.
   * When absent, the pipeline runs with zero behavioural change from default.
   */
  contextText?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowInput — internal pipeline type (credentials already sealed)
//
// Created by WorkflowOrchestrator.run() after URL validation and credential
// wrapping.  Stages only ever see SealedCredentials — they never receive
// raw username/password strings.
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkflowInput {
  /** Validated application root URL. */
  url:         string;
  /** Sealed credential holder — readable exactly once in AuthStage. */
  credentials: SealedCredentials;
  /** Absolute path where captures + demo-package.json will be written. */
  outputDir:   string;
  options?:    WorkflowOptions;
}

// ─────────────────────────────────────────────────────────────────────────────
// PipelineContext — mutable accumulator passed through every stage.
// ─────────────────────────────────────────────────────────────────────────────

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
}

export interface PipelineContext {
  // ── Immutable input ──────────────────────────────────────────────────────
  readonly input: WorkflowInput;

  // ── Live Playwright session (auth → screenshot; closed after screenshot) ─
  browserSession?: BrowserSession;

  // ── Stage outputs (set by each stage) ───────────────────────────────────
  authSession?:         AuthSession;
  discoveredPages?:     DiscoveredPage[];
  applicationGraph?:    ApplicationGraph;
  pageCaptures?:        PageCapture[];
  pageIntelligence?:    PageIntelligence[];
  prioritizedFeatures?:  PrioritizedFeature[];
  /** Set by BusinessValueStage; used by StoryboardStage for narration overrides. */
  businessValueOutputs?: BusinessValueEnrichmentResult;
  demoJourney?:          DemoJourney;
  storyboard?:          Storyboard;
  remotionPackage?:     RemotionPackage;
  /** Phase 7: motion plan written to motion-package.json by MotionDirectionStage. */
  motionPlan?:          MotionPlan;
  /**
   * Full audit trail from DemoReadinessStage — one ReadinessResult per page.
   * Includes passing, borderline, and rejected pages with all contributing
   * signals so operators can diagnose why scenes were filtered out.
   */
  readinessResults?:    ReadinessResult[];
  /**
   * Phase 8: narrative arc produced by SalesStoryDirectorStage.
   * Consumed by JourneyGenerationStage (scene order bypass) and
   * StoryboardStage (callout + camera overrides).
   * Absent when SalesStoryDirectorStage is skipped or has no eligible pages.
   */
  salesStory?:          StoryArc;
  /**
   * Phase 9: raw MVID ExplorationResults preserved for the Interaction Replay Director.
   * Keyed by pageId. Populated by InPageDiscoveryStage after each explorePage() call.
   * Absent on legacy runs where InPageDiscoveryStage was not upgraded.
   */
  interactionExplorations?: Map<string, ExplorationResult>;
  /**
   * Phase 9: interaction replay plan produced by InteractionReplayDirectorStage.
   * Consumed by StoryboardStage and RemotionExporter to upgrade scenes from
   * 'screenshot' to 'interaction' mode.
   * Absent when the stage is skipped or no qualifying replays were found.
   */
  interactionReplayPlan?: InteractionReplayPlan;

  // ── Application Context (Phase 1–3) ─────────────────────────────────────
  /**
   * Always-present envelope for optional business context supplied by the user.
   *
   *   isPresent() === false  → user did not provide context; zero pipeline change.
   *   isPresent() === true   → context expanded and (after Phase 3) validated.
   *
   * Initialised to ContextEnvelope.empty() by createPipelineContext().
   * Replaced by ContextEnvelope.fromContext() in ContextExpansionStage (Phase 3).
   * applyValidation() called once in ContextSignalValidationStage (Phase 3).
   */
  contextEnvelope: ContextEnvelope;

  // ── Final output ─────────────────────────────────────────────────────────
  outputPath?: string;
}

export function createPipelineContext(input: WorkflowInput): PipelineContext {
  return {
    input,
    contextEnvelope: ContextEnvelope.empty(),
  };
}
