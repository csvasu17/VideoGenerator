// ─────────────────────────────────────────────────────────────────────────────
// InteractionSalesStoryBridge
//
// Matches validated InteractionReplay objects to StoryArc SceneGoals and
// enforces the coverage guard:
//   - soft minimum 30% of scenes upgraded to interaction mode
//     (may fall below if insufficient quality replays exist)
//   - maximum 60% of scenes upgraded to interaction mode
//
// Phase 9b quality changes:
//   1. Transition-identity deduplication — only one replay per unique
//      (startScreenshotHash:endScreenshotHash) transition before assignment.
//   2. Story role compatibility gate — a replay is only assigned to a scene
//      if its storyRole is compatible with the scene's sceneRole.
//   3. Coverage fill uses compatible replays only — quality over coverage.
//      The 30% minimum is a soft goal; it will not be met by forcing
//      incompatible or duplicate replays.
//
// Algorithm:
//   1. Dedup promoted replays by transitionKey (keep highest priority per key)
//   2. Build pageId → sceneIndex[] map from StoryArc.scenes
//   3. Build pageId → deduped-replay[] map (sorted by replayPriority desc)
//   4. For each scene, find best replay for its page that is role-compatible
//   5. Deduplicate by sceneIndex (highest priority wins across pages)
//   6. Apply coverage guard (soft minimum — no incompatible fill):
//      a. Sort by replayPriority desc
//      b. Cap at maxInteract (floor(totalScenes × 0.60))
//      c. If below minInteract (round(totalScenes × 0.30)), fill from
//         compatible promoted replays only — never incompatible or demoted
//   7. Build sceneToReplayMap and return InteractionReplayPlan
// ─────────────────────────────────────────────────────────────────────────────

import type {
  InteractionReplay,
  InteractionReplayPlan,
  ReplayValidationReport,
  ReplayValidationResult,
} from '../core/domain/entities/InteractionReplay';
import type { SceneRole, StoryArc } from '../core/domain/entities/SalesStory';

// ── Role compatibility matrix ─────────────────────────────────────────────────
//
// A replay with storyRole X can be assigned to a scene with sceneRole Y only
// if Y appears in the compatible list for X.

const ROLE_COMPATIBILITY: Record<string, ReadonlySet<string>> = {
  insight:    new Set(['insight', 'hook', 'validation']),
  outcome:    new Set(['outcome', 'validation', 'scale']),
  action:     new Set(['action', 'insight']),
  problem:    new Set(['problem', 'hook']),
  hook:       new Set(['hook']),
  validation: new Set(['validation', 'outcome']),
  scale:      new Set(['scale', 'outcome']),
};

function isRoleCompatible(replayRole: SceneRole | string, sceneRole: SceneRole | string): boolean {
  const compatible = ROLE_COMPATIBILITY[replayRole];
  if (!compatible) return true;   // unknown role — allow assignment
  return compatible.has(sceneRole);
}

// ─────────────────────────────────────────────────────────────────────────────

export class InteractionSalesStoryBridge {

  /**
   * Match replays to story arc scenes and produce an InteractionReplayPlan.
   *
   * @param promotedReplays  Replays that passed ReplayValidator (score ≥ 0.60)
   * @param allReplays       All replays — kept for report completeness only
   * @param storyArc         The StoryArc from SalesStoryDirectorStage
   * @param validationReport Validation report from ReplayValidator
   */
  bridge(
    promotedReplays:   InteractionReplay[],
    allReplays:        InteractionReplay[],
    storyArc:          StoryArc,
    validationReport:  ReplayValidationReport,
  ): InteractionReplayPlan {
    const totalScenes = storyArc.scenes.length;
    const minInteract = Math.max(1, Math.round(totalScenes * 0.30));
    const maxInteract = Math.min(totalScenes, Math.floor(totalScenes * 0.60));

    // ── Step 1: Transition-identity deduplication ─────────────────────────────
    // Keep only the highest-priority replay per unique (startHash:endHash) pair.
    // This prevents the same underlying state transition from occupying multiple
    // scenes, even when InPageDiscovery found it via different paths.

    const seenTransitions = new Map<string, InteractionReplay>();
    // Sort descending by priority so the first one seen is the best
    const sortedPromoted = [...promotedReplays].sort((a, b) => b.replayPriority - a.replayPriority);

    for (const replay of sortedPromoted) {
      // transitionKey comes from InteractionSequence; replays carry it via ReplayBuilder
      // Fall back to interactionId-based key when not set
      const key = replay.transitionKey ?? replay.interactionId;
      if (!seenTransitions.has(key)) {
        seenTransitions.set(key, replay);
      }
    }
    const dedupedPromoted = [...seenTransitions.values()];

    // Update dedupeStatus in validationReport for report output
    this.updateDedupeStatus(validationReport, seenTransitions, promotedReplays);

    // ── Step 2: pageId → scene indices ────────────────────────────────────────
    const pageToSceneIndices = new Map<string, number[]>();
    storyArc.scenes.forEach((scene, idx) => {
      const list = pageToSceneIndices.get(scene.pageId) ?? [];
      list.push(idx);
      pageToSceneIndices.set(scene.pageId, list);
    });

    // Build sceneRole lookup
    const sceneRoles = new Map<number, SceneRole>(
      storyArc.scenes.map((s, idx) => [idx, s.sceneRole]),
    );

    // ── Step 3: pageId → deduped replays sorted by priority ───────────────────
    const replaysByPage = new Map<string, InteractionReplay[]>();
    for (const replay of dedupedPromoted) {
      const list = replaysByPage.get(replay.pageId) ?? [];
      list.push(replay);
      replaysByPage.set(replay.pageId, list);
    }
    for (const list of replaysByPage.values()) {
      list.sort((a, b) => b.replayPriority - a.replayPriority);
    }

    // ── Step 4: candidate assignments with role compatibility check ───────────
    type Assignment = { sceneIdx: number; replay: InteractionReplay };
    const candidatesRaw: Assignment[] = [];

    for (const [pageId, sceneIndices] of pageToSceneIndices) {
      const pageReplays = replaysByPage.get(pageId);
      if (!pageReplays?.length) continue;

      for (const sceneIdx of sceneIndices) {
        const sceneRole = sceneRoles.get(sceneIdx) ?? 'insight';
        // Find best replay that is role-compatible with this scene
        const compatible = pageReplays.find(r =>
          isRoleCompatible(r.storyRole ?? 'insight', sceneRole),
        );
        if (compatible) {
          candidatesRaw.push({ sceneIdx, replay: compatible });
        }
        // If no compatible replay found for this scene, it stays as screenshot
      }
    }

    // ── Step 5: deduplicate by sceneIndex — highest priority wins ─────────────
    candidatesRaw.sort((a, b) => b.replay.replayPriority - a.replay.replayPriority);
    const seenScenes = new Set<number>();
    const deduped: Assignment[] = [];
    for (const a of candidatesRaw) {
      if (!seenScenes.has(a.sceneIdx)) {
        seenScenes.add(a.sceneIdx);
        deduped.push(a);
      }
    }

    // ── Step 6: apply coverage guard (quality-first) ──────────────────────────
    let qualified = [...deduped];

    // Cap at maxInteract
    if (qualified.length > maxInteract) {
      qualified = qualified.slice(0, maxInteract);
    }

    // Soft minimum — fill only with compatible promoted replays, never demoted
    if (qualified.length < minInteract) {
      const qualifiedScenes = new Set(qualified.map(a => a.sceneIdx));

      // Find additional scenes that have no assignment yet
      // Only consider promoted replays (dedupedPromoted) — never demoted
      const fillerCandidates: Assignment[] = [];
      for (const [pageId, sceneIndices] of pageToSceneIndices) {
        const pageReplays = replaysByPage.get(pageId);
        if (!pageReplays?.length) continue;
        for (const sceneIdx of sceneIndices) {
          if (qualifiedScenes.has(sceneIdx)) continue;
          const sceneRole = sceneRoles.get(sceneIdx) ?? 'insight';
          const compatible = pageReplays.find(r =>
            isRoleCompatible(r.storyRole ?? 'insight', sceneRole),
          );
          if (compatible) {
            fillerCandidates.push({ sceneIdx, replay: compatible });
          }
        }
      }

      fillerCandidates.sort((a, b) => b.replay.replayPriority - a.replay.replayPriority);
      const needed = minInteract - qualified.length;
      qualified    = [...qualified, ...fillerCandidates.slice(0, needed)];
    }

    // ── Step 7: build output ───────────────────────────────────────────────────
    const sceneToReplayMap = new Map<number, string>(
      qualified.map(a => [a.sceneIdx, a.replay.interactionId]),
    );
    const usedIds     = new Set(qualified.map(a => a.replay.interactionId));
    const usedReplays = allReplays.filter(r => usedIds.has(r.interactionId));
    const coverageRate = totalScenes > 0 ? qualified.length / totalScenes : 0;

    return {
      replays:          usedReplays,
      sceneToReplayMap,
      coverageRate,
      validationReport,
    };
  }

  // ── Private ────────────────────────────────────────────────────────────────────

  private updateDedupeStatus(
    report:          ReplayValidationReport,
    seenTransitions: Map<string, InteractionReplay>,
    allPromoted:     InteractionReplay[],
  ): void {
    // Build reverse map: interactionId → transitionKey
    const idToKey = new Map<string, string>();
    for (const replay of allPromoted) {
      const key = replay.transitionKey ?? replay.interactionId;
      idToKey.set(replay.interactionId, key);
    }

    // Build set of kept IDs
    const keptIds = new Set([...seenTransitions.values()].map(r => r.interactionId));

    for (const result of report.replayResults) {
      const key = idToKey.get(result.interactionId);
      if (!key) continue;
      if (!keptIds.has(result.interactionId)) {
        // Find which replay this is a duplicate of
        const kept = seenTransitions.get(key);
        if (kept) {
          (result as ReplayValidationResult).dedupeStatus =
            `duplicate_of:${kept.interactionId.slice(0, 8)}` as any;
        }
      }
      // else stays 'unique'
    }
  }
}
