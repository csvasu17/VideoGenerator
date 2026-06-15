import type {
  BusinessOutcome,
  ValueCategory,
  ArcType,
  SceneRole,
} from '../core/domain/entities/SalesStory';
import type { ReadinessResult } from '../core/domain/entities/ReadinessResult';

// ─────────────────────────────────────────────────────────────────────────────
// SelectedScene — output type for StoryArcSelector
// ─────────────────────────────────────────────────────────────────────────────

export interface SelectedScene {
  pageId:        string;
  sceneRole:     SceneRole;
  storyPriority: number;
  outcomeId:     string;   // featureId of the best matching BusinessOutcome
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const REQUIRED_ROLES: Record<ArcType, SceneRole[]> = {
  reactive_to_predictive: ['hook', 'insight', 'action', 'validation'],
  visibility_to_control:  ['hook', 'action', 'scale'],
  data_to_decisions:      ['hook', 'insight', 'outcome'],
  risk_to_resilience:     ['hook', 'insight', 'action', 'outcome'],
};

const CATEGORY_ROLE_AFFINITY: Record<ValueCategory, SceneRole> = {
  risk_prevention:          'insight',
  cost_reduction:           'outcome',
  efficiency_gain:          'action',
  revenue_protection:       'outcome',
  operational_intelligence: 'hook',
  compliance_assurance:     'validation',
  decision_speed:           'insight',
};

const BASE_PRIORITY: Record<ValueCategory, number> = {
  risk_prevention:          0.95,
  cost_reduction:           0.85,
  efficiency_gain:          0.75,
  revenue_protection:       0.80,
  operational_intelligence: 0.70,
  compliance_assurance:     0.65,
  decision_speed:           0.90,
};

// Arc narrative role order (for sorting scenes)
const ARC_ROLE_ORDER: Record<ArcType, SceneRole[]> = {
  reactive_to_predictive: ['hook', 'problem', 'insight', 'action', 'validation', 'outcome', 'scale'],
  visibility_to_control:  ['hook', 'problem', 'insight', 'action', 'outcome', 'scale'],
  data_to_decisions:      ['hook', 'problem', 'insight', 'action', 'outcome', 'scale'],
  risk_to_resilience:     ['hook', 'problem', 'insight', 'action', 'validation', 'outcome', 'scale'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Role override rules applied before CATEGORY_ROLE_AFFINITY
// ─────────────────────────────────────────────────────────────────────────────

function resolveRole(featureName: string, baseRole: SceneRole): SceneRole {
  const lower = featureName.toLowerCase();

  if (/\b(ai|predict|predictive)\b/.test(lower)) return 'insight';
  if (/\b(alarm|alert)\b/.test(lower)) return 'action';
  if (/simulat/i.test(lower) || /\bfault\b/.test(lower)) return 'validation';
  if (/\b(dashboard|kpi|overview)\b/.test(lower)) return 'hook';
  if (/\b(fleet|monitoring)\b/.test(lower)) return 'scale';

  return baseRole;
}

// ─────────────────────────────────────────────────────────────────────────────
// Priority calculation
// ─────────────────────────────────────────────────────────────────────────────

function calcPriority(
  featureName:    string,
  valueCategory:  ValueCategory,
  rr:             ReadinessResult,
): number {
  const lower = featureName.toLowerCase();
  let base = BASE_PRIORITY[valueCategory];

  // Feature name boosts
  if (/\b(ai|predict|predictive)\b/.test(lower)) {
    base = Math.max(base, 0.95);
  }
  if (/\b(simulat|fault)\b/.test(lower)) {
    base = Math.max(base, 0.90);
  }

  // Tier adjustments
  if (rr.demoValueTier === 'tier1') {
    base = Math.max(base, 0.90);
  } else if (rr.demoValueTier === 'tier2') {
    base = Math.max(base, 0.70);
  } else if (rr.demoValueTier === 'tier4') {
    base = Math.min(base, 0.20);
  }

  // Scale slightly with readinessScore (0.1 influence)
  return base * 0.9 + rr.readinessScore * 0.1;
}

// ─────────────────────────────────────────────────────────────────────────────
// StoryArcSelector
// ─────────────────────────────────────────────────────────────────────────────

interface Candidate {
  pageId:        string;
  outcomeId:     string;
  featureName:   string;
  sceneRole:     SceneRole;
  storyPriority: number;
  valueCategory: ValueCategory;
}

export class StoryArcSelector {
  select(
    outcomes:         Map<string, BusinessOutcome>,
    readinessResults: ReadinessResult[],
  ): { arcType: ArcType; scenes: SelectedScene[] } {
    // Build passing readiness lookup by pageId
    const passingByPageId = new Map<string, ReadinessResult>();
    for (const rr of readinessResults) {
      if (rr.verdict === 'pass') {
        // Keep the higher score if duplicates exist
        const existing = passingByPageId.get(rr.pageId);
        if (!existing || rr.readinessScore > existing.readinessScore) {
          passingByPageId.set(rr.pageId, rr);
        }
      }
    }

    const candidates: Candidate[] = [];

    for (const [featureId, outcome] of outcomes) {
      // Find first passing pageId for this feature
      let bestPageId: string | undefined;
      let bestRR: ReadinessResult | undefined;

      for (const pid of outcome.pageIds) {
        const rr = passingByPageId.get(pid);
        if (rr) {
          if (!bestRR || rr.readinessScore > bestRR.readinessScore) {
            bestPageId = pid;
            bestRR = rr;
          }
        }
      }

      // Skip features without any passing page
      if (!bestPageId || !bestRR) continue;

      const baseRole = CATEGORY_ROLE_AFFINITY[outcome.valueCategory];
      const sceneRole = resolveRole(outcome.featureName, baseRole);
      const storyPriority = calcPriority(outcome.featureName, outcome.valueCategory, bestRR);

      candidates.push({
        pageId:        bestPageId,
        outcomeId:     featureId,
        featureName:   outcome.featureName,
        sceneRole,
        storyPriority,
        valueCategory: outcome.valueCategory,
      });
    }

    // Score each arc type by how many required roles are covered
    const arcScores = new Map<ArcType, number>();
    const arcTypes: ArcType[] = [
      'reactive_to_predictive',
      'visibility_to_control',
      'data_to_decisions',
      'risk_to_resilience',
    ];

    for (const arc of arcTypes) {
      const required = REQUIRED_ROLES[arc];
      const coveredRoles = new Set(candidates.map(c => c.sceneRole));
      const covered = required.filter(r => coveredRoles.has(r)).length;
      const avgPriority = candidates.length > 0
        ? candidates.reduce((s, c) => s + c.storyPriority, 0) / candidates.length
        : 0;
      arcScores.set(arc, covered + avgPriority * 0.1);
    }

    // Pick arc with best coverage; tiebreak by score
    let selectedArc: ArcType = 'reactive_to_predictive';
    let bestScore = -1;
    for (const [arc, score] of arcScores) {
      if (score > bestScore) {
        bestScore = score;
        selectedArc = arc;
      }
    }

    // Assign candidates to roles: highest priority wins each required role slot
    const roleOrder = ARC_ROLE_ORDER[selectedArc];
    const assignedRoles = new Map<SceneRole, Candidate>();
    const extraCandidates: Candidate[] = [];

    // Sort candidates by priority desc for greedy assignment
    const sorted = [...candidates].sort((a, b) => b.storyPriority - a.storyPriority);

    for (const candidate of sorted) {
      if (!assignedRoles.has(candidate.sceneRole)) {
        assignedRoles.set(candidate.sceneRole, candidate);
      } else {
        extraCandidates.push(candidate);
      }
    }

    // Fill extra scenes up to 20 total (dynamic — covers all meaningful app sections)
    const MAX_SCENES = 20;
    const sceneList: SelectedScene[] = [];

    for (const role of roleOrder) {
      const candidate = assignedRoles.get(role);
      if (candidate) {
        sceneList.push({
          pageId:        candidate.pageId,
          sceneRole:     candidate.sceneRole,
          storyPriority: candidate.storyPriority,
          outcomeId:     candidate.outcomeId,
        });
      }
    }

    // Add extras as 'scale' or 'outcome' up to max
    for (const extra of extraCandidates) {
      if (sceneList.length >= MAX_SCENES) break;
      const extraRole: SceneRole = extra.valueCategory === 'cost_reduction' ||
        extra.valueCategory === 'revenue_protection' ? 'outcome' : 'scale';
      sceneList.push({
        pageId:        extra.pageId,
        sceneRole:     extraRole,
        storyPriority: extra.storyPriority,
        outcomeId:     extra.outcomeId,
      });
    }

    return { arcType: selectedArc, scenes: sceneList };
  }
}

