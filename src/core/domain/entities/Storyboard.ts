// ─────────────────────────────────────────────────────────────────────────────
// Storyboard — domain entity
// Output of the Storyboard Generator agent.
// ─────────────────────────────────────────────────────────────────────────────

import type { SceneRole } from './SalesStory';
import type { SerializedInteractionReplay } from './InteractionReplay';

/** Visual cut style between scenes. */
export type TransitionType =
  | 'cut'          // Instantaneous hard cut
  | 'fade'         // Gentle fade to black / white
  | 'slide-left'   // Current slides out left, next slides in — forward progress
  | 'slide-right'  // Reverse / back
  | 'zoom-in'      // Camera pushes into detail / new feature
  | 'zoom-out';    // Camera pulls back to overview

/** The class of UI element to spotlight with the screen recorder overlay. */
export type HighlightElementType =
  | 'button'
  | 'chart'
  | 'table'
  | 'form'
  | 'kpi'
  | 'navigation'
  | 'modal'
  | 'full-page';

/** Rough screen quadrant hint for the highlight overlay. */
export type ScreenRegion = 'top-left' | 'top-right' | 'center' | 'bottom' | 'full';

// ─────────────────────────────────────────────────────────────────────────────

export interface HighlightTarget {
  /** What kind of element to spotlight. */
  elementType: HighlightElementType;
  /** Human-readable description for the video editor / recording agent. */
  description: string;
  /**
   * Optional CSS selector injected by the Recording agent if available
   * after DOM analysis.  Undefined here; filled downstream.
   */
  selector?: string;
  /** Screen area where this element is most likely to appear. */
  region: ScreenRegion;
}

export interface SceneTransition {
  type: TransitionType;
  /** Transition animation length in milliseconds. */
  durationMs: number;
  /** Action label shown as an on-screen annotation: "Click 'Create Project'". */
  label?: string;
}

// ─────────────────────────────────────────────────────────────────────────────

export interface Scene {
  /** 1-based position within the storyboard. */
  sceneNumber: number;
  /** Matches the pageId from the originating JourneyStep. */
  pageId: string;
  /** Short screen title / slide heading. */
  title: string;
  /**
   * Factual description of what is visible on screen.
   * Used as B-roll notes or slide subtitle.
   */
  description: string;
  /**
   * Full sales-oriented narration script for a voice-over or presenter.
   * Follows the story arc: hook → build → close.
   */
  narration: string;
  /**
   * One-line value proposition for this page.
   * Used as an on-screen caption or lower-third.
   */
  salesHook: string;
  /** What the recording overlay should spotlight during this scene. */
  highlightTarget: HighlightTarget;
  /** How long this scene plays in the final video (in seconds). */
  durationSec: number;
  /**
   * Transition to the NEXT scene.
   * Undefined on the last scene (video ends with a hold + fade handled by
   * the closing card).
   */
  transition?: SceneTransition;
  /**
   * Graph node classification carried from JourneyStep (e.g. 'hub', 'detail',
   * 'leaf').  Optional so existing code that builds Scene objects without it
   * remains valid; RemotionExporter defaults to '' when absent.
   */
  nodeType?: string;
  /**
   * Narrative role from the Sales Story Director (Phase 8).
   * Optional for backward compatibility — absent when the pipeline runs
   * without the SalesStoryDirectorStage.
   * Examples: 'hook', 'insight', 'action', 'validation'.
   */
  sceneRole?: SceneRole;
  /**
   * Phase 9: rendering mode for this scene.
   *   'screenshot'  — static screenshot with Ken-Burns camera (default)
   *   'interaction' — animated cursor replay with crossfade transition
   * Absent in storyboards produced before Phase 9 — defaults to 'screenshot'.
   */
  sceneType?: 'screenshot' | 'interaction';
  /**
   * Phase 9: serialised interaction replay data.
   * Present only when sceneType === 'interaction'.
   * Consumed by RemotionExporter and DemoVideo.tsx.
   */
  interactionReplay?: SerializedInteractionReplay;
}

// ─────────────────────────────────────────────────────────────────────────────

export interface Storyboard {
  id: string;
  /** ID of the DemoJourney this storyboard was built from. */
  journeyId: string;
  /** Display title of the full video / presentation. */
  title: string;
  /**
   * Text shown as the opening title card before scene 1.
   * E.g.: "Streamline your entire operation — end to end."
   */
  openingTitle: string;
  /**
   * Final call-to-action shown on the closing card after the last scene.
   * E.g.: "Schedule a live demo today."
   */
  closingCallToAction: string;
  totalScenes: number;
  totalDurationSec: number;
  scenes: Scene[];
  generatedAt: string;
}
