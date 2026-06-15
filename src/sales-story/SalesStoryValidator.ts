import type {
  SceneGoal,
  SceneRole,
  ArcType,
  ArcValidation,
  SceneValidation,
} from '../core/domain/entities/SalesStory';
import { isBenefitDriven } from './CalloutExtractor';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const REQUIRED_ROLES: Record<ArcType, SceneRole[]> = {
  reactive_to_predictive: ['hook', 'insight', 'action', 'validation'],
  visibility_to_control:  ['hook', 'action', 'scale'],
  data_to_decisions:      ['hook', 'insight', 'outcome'],
  risk_to_resilience:     ['hook', 'insight', 'action', 'outcome'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Narrative description builder
// ─────────────────────────────────────────────────────────────────────────────

function buildNarrativeDescription(arcType: ArcType, scenes: SceneGoal[]): string {
  switch (arcType) {
    case 'reactive_to_predictive':
      return `${scenes.length}-scene arc: monitor, predict, prevent, validate`;
    case 'visibility_to_control':
      return `${scenes.length}-scene arc: see, understand, act, scale`;
    case 'data_to_decisions':
      return `${scenes.length}-scene arc: collect, analyse, respond, improve`;
    case 'risk_to_resilience':
      return `${scenes.length}-scene arc: detect risk, build confidence, show ROI`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SalesStoryValidator
// ─────────────────────────────────────────────────────────────────────────────

export class SalesStoryValidator {
  validate(
    scenes:  SceneGoal[],
    arcType: ArcType,
  ): { arcValidation: ArcValidation; sceneValidations: SceneValidation[] } {
    const requiredRoles = REQUIRED_ROLES[arcType];
    const sceneValidations: SceneValidation[] = [];

    for (const scene of scenes) {
      const sv = this.validateScene(scene, arcType, requiredRoles);
      sceneValidations.push(sv);
    }

    // Arc completeness
    const arcComplete = requiredRoles.every(r => scenes.some(s => s.sceneRole === r));
    const missingRoles = requiredRoles.filter(r => !scenes.some(s => s.sceneRole === r));

    // Weak scenes (score < 0.50)
    const weakScenes = sceneValidations
      .filter(sv => sv.score < 0.50)
      .map(sv => sv.sceneId);

    // Redundant scenes — same role + same callout, keep the lower-priority one
    const redundantScenes: string[] = [];
    const roleGroups = new Map<SceneRole, SceneGoal[]>();
    for (const scene of scenes) {
      const group = roleGroups.get(scene.sceneRole) ?? [];
      group.push(scene);
      roleGroups.set(scene.sceneRole, group);
    }
    for (const [, group] of roleGroups) {
      if (group.length < 2) continue;
      // Find scenes with identical callouts
      const seen = new Map<string, SceneGoal>();
      for (const scene of group) {
        const existing = seen.get(scene.callout);
        if (existing) {
          // Add the lower-priority scene's pageId as redundant
          const loser = scene.storyPriority < existing.storyPriority ? scene : existing;
          if (!redundantScenes.includes(loser.pageId)) {
            redundantScenes.push(loser.pageId);
          }
        } else {
          seen.set(scene.callout, scene);
        }
      }
    }

    // Overall score
    const overallScore = sceneValidations.length > 0
      ? sceneValidations.reduce((s, sv) => s + sv.score, 0) / sceneValidations.length
      : 0;

    const narrative = buildNarrativeDescription(arcType, scenes);

    // Recommended changes
    const recommendedChanges: string[] = missingRoles.map(r => `Add a ${r} scene`);

    const arcValidation: ArcValidation = {
      arcComplete,
      missingRoles,
      weakScenes,
      redundantScenes,
      overallScore,
      narrative,
      recommendedChanges,
    };

    return { arcValidation, sceneValidations };
  }

  private validateScene(
    scene:         SceneGoal,
    arcType:       ArcType,
    requiredRoles: SceneRole[],
  ): SceneValidation {
    const checks = {
      hasBusinessOutcome:     scene.businessOutcome.featureId.length > 0,
      hasProofElement:        scene.proofElement.type !== undefined,
      proofElementHasBBox:    scene.proofElement.boundingBox !== null,
      calloutIsBenefitDriven: isBenefitDriven(scene.callout),
      sceneRoleAssigned:      scene.sceneRole !== undefined,
      notNavigation:          !scene.callout.toLowerCase().includes('navigation'),
      notEmptyState:          scene.proofElement.label.length > 0,
      notForm:                !scene.sceneGoal.toLowerCase().includes('form'),
      notSettings:            !scene.sceneGoal.toLowerCase().includes('settings') &&
                              !scene.feature.toLowerCase().includes('settings'),
      contributesToArc:       requiredRoles.includes(scene.sceneRole) ||
                              (['scale', 'problem', 'outcome'] as SceneRole[]).includes(scene.sceneRole),
      narrativeHookPresent:   scene.narrativeHook.length > 10,
      closingLinePresent:     scene.closingLine.length > 10,
    };

    const passedCount = Object.values(checks).filter(Boolean).length;
    const totalChecks = 12;
    const score = (passedCount / totalChecks) * scene.proofElement.visualWeight;
    const passed = score >= 0.4;

    const warnings: string[] = [];
    if (!checks.proofElementHasBBox) {
      warnings.push('No bounding box for proof element — camera will use page overview');
    }
    if (!checks.calloutIsBenefitDriven) {
      warnings.push(`Callout "${scene.callout}" is not benefit-driven`);
    }
    if (!checks.narrativeHookPresent) {
      warnings.push('Narrative hook is too short or missing');
    }
    if (!checks.closingLinePresent) {
      warnings.push('Closing line is too short or missing');
    }

    const rejectionReason = !passed
      ? `Score ${score.toFixed(2)} below threshold 0.40 (${passedCount}/${totalChecks} checks passed)`
      : null;

    return {
      sceneId:  String(scene.sceneIndex),
      pageId:   scene.pageId,
      passed,
      score,
      checks,
      warnings,
      rejectionReason,
    };
  }
}
