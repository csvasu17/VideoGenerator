/**
 * SceneMotionPlanner — orchestrates all motion planning for a single scene.
 *
 * Wires together:
 *   VisualAttentionAnalyzer → AttentionMap
 *   AttentionSequencer      → AttentionBeat[]
 *   MultiPointCameraPlanner → ExtendedCameraTimeline
 *   CalloutComposer         → CalloutTrack
 *
 * Cross-scene concerns (TransitionPlan, MotionContinuityEngine) are handled
 * at the MotionDirectionEngine level, not here.
 *
 * No LLM, no I/O. Pure orchestration of pure functions.
 */

import type { RemotionScene }         from '../core/domain/entities/RemotionPackage';
import type { PageIntelligence }      from '../core/domain/entities/PageIntelligence';
import type { AttentionContext }       from './attention/types';
import type { MotionDirectedScene }   from './types';
import type { GlobalMotionStyle }     from './types';
import { VisualAttentionAnalyzer }    from './attention/VisualAttentionAnalyzer';
import { AttentionSequencer }         from './attention/AttentionSequencer';
import { MultiPointCameraPlanner }    from './camera/MultiPointCameraPlanner';
import { CalloutComposer }            from './callouts/CalloutComposer';
import { REMOTION_FPS }               from '../core/domain/entities/RemotionPackage';

// ─────────────────────────────────────────────────────────────────────────────
// SceneMotionPlanner
// ─────────────────────────────────────────────────────────────────────────────

export class SceneMotionPlanner {
  private readonly analyzer  = new VisualAttentionAnalyzer();
  private readonly sequencer = new AttentionSequencer();
  private readonly camera    = new MultiPointCameraPlanner();
  private readonly callouts  = new CalloutComposer();

  /**
   * Produce a MotionDirectedScene for a single scene.
   *
   * @param scene       The RemotionScene from demo-package.json
   * @param intel       PageIntelligence for this scene's page
   * @param style       Video-level motion style
   * @param context     Optional additional pipeline signals for featureImportance
   * @param fps         Frames per second (default 30)
   */
  plan(
    scene:   RemotionScene,
    intel:   PageIntelligence,
    style:   GlobalMotionStyle,
    context: AttentionContext | undefined,
    fps:     number = REMOTION_FPS,
  ): MotionDirectedScene {
    const duration = scene.durationInFrames;

    // Step 1: Analyze what deserves attention in this scene
    const attentionMap = this.analyzer.analyze(scene, intel, context);

    // Step 2: Sequence the attention beats
    const beats = this.sequencer.sequence(attentionMap, duration, fps);

    // Step 3: Plan the camera path
    const cameraTimeline = this.camera.plan(beats, attentionMap, duration, fps, scene.id);

    // Step 4: Compose callout overlays
    const calloutTrack = this.callouts.compose(beats, attentionMap, scene.id, style);

    return {
      sceneId:         scene.id,
      cameraTimeline,
      attentionMap,
      attentionBeats:  beats,
      calloutTrack,
      enterTransition: null,   // populated by MotionDirectionEngine after all scenes planned
      exitTransition:  null,
    };
  }
}
