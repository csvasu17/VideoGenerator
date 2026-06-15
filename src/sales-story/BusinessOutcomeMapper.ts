import type {
  BusinessOutcome,
  ProofElement,
  ProofElementType,
  ValueCategory,
  NormalisedBox,
} from '../core/domain/entities/SalesStory';
import type { PageIntelligence } from '../core/domain/entities/PageIntelligence';
import type { PrioritizedFeature } from '../core/domain/entities/PrioritizedFeature';
import type { BusinessValueOutput, BusinessValueEnrichmentResult } from '../core/domain/entities/BusinessValueOutput';
import type { ReadinessResult } from '../core/domain/entities/ReadinessResult';
import { extractCallout } from './CalloutExtractor';

// ─────────────────────────────────────────────────────────────────────────────
// Value category assignment
// ─────────────────────────────────────────────────────────────────────────────

function assignValueCategory(featureName: string, businessBenefit: string): ValueCategory {
  const text = `${featureName} ${businessBenefit}`;

  if (/\b(predict|ai|failure|breakdown|fault|incident|prevent|simulation|simulat)\b/i.test(text)) {
    return 'risk_prevention';
  }
  if (/\b(cost|energy|save|saving|reduce|reduction|bill|utility|spend|wasted)\b/i.test(text)) {
    return 'cost_reduction';
  }
  if (/\b(alert|alarm|respond|response|resolve|faster|quick|time|manual)\b/i.test(text)) {
    return 'efficiency_gain';
  }
  if (/\b(uptime|downtime|availability|outage|reliabilit)\b/i.test(text)) {
    return 'revenue_protection';
  }
  if (/\b(decision|decide|real.time|instant|immediate)\b/i.test(text)) {
    return 'decision_speed';
  }
  if (/\b(comply|compliance|regulation|regulatory|audit)\b/i.test(text)) {
    return 'compliance_assurance';
  }
  return 'operational_intelligence';
}

// ─────────────────────────────────────────────────────────────────────────────
// Proof type resolution
// ─────────────────────────────────────────────────────────────────────────────

function resolveProofType(
  featureName: string,
  pageCategory: string,
  valueCategory: ValueCategory,
  hasKpiWidgets: boolean,
): ProofElementType {
  const lowerName = featureName.toLowerCase();

  if (valueCategory === 'risk_prevention' || /\bai\b/.test(lowerName)) {
    return 'prediction_card';
  }
  if (/\b(alarm|alert)\b/.test(lowerName)) {
    return 'alert_severity';
  }
  if (/\b(energy|consumption)\b/.test(lowerName)) {
    return 'kpi_metric';
  }
  if (/\b(fleet|device)\b/.test(lowerName)) {
    return 'fleet_health_summary';
  }
  if (/\bsimulat/.test(lowerName)) {
    return 'simulation_result';
  }
  if (pageCategory === 'analytics') {
    return 'trend_chart';
  }
  if (hasKpiWidgets) {
    return 'kpi_metric';
  }
  return 'kpi_metric';
}

// ─────────────────────────────────────────────────────────────────────────────
// Text utilities
// ─────────────────────────────────────────────────────────────────────────────

function truncateToWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  return words.slice(0, maxWords).join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Proof signal builder
// ─────────────────────────────────────────────────────────────────────────────

function buildProofSignals(
  feature: PrioritizedFeature,
  intelByPageId: Map<string, PageIntelligence>,
  readinessResults: ReadinessResult[],
): ProofElement[] {
  const signals: ProofElement[] = [];

  for (const pageId of feature.feature.pageIds) {
    const intel = intelByPageId.get(pageId);
    if (!intel) continue;

    const valueCategory = assignValueCategory(feature.feature.name, '');
    const proofType = resolveProofType(
      feature.feature.name,
      intel.pageCategory,
      valueCategory,
      intel.kpiWidgets.length > 0,
    );

    const firstWidget = intel.kpiWidgets[0];
    const label = firstWidget?.label ?? feature.feature.name;
    const evidenceClaim = firstWidget?.value
      ? `${firstWidget.label}: ${firstWidget.value}`
      : feature.feature.name;

    let boundingBox: NormalisedBox | null = null;
    if (intel.primaryElementBoundingBox) {
      const peb = intel.primaryElementBoundingBox;
      boundingBox = { x: peb.x, y: peb.y, width: peb.width, height: peb.height };
    }

    const rr = readinessResults.find(r => r.pageId === pageId);
    const rawScore = rr?.readinessScore ?? 0.5;
    const visualWeight = Math.min(1.0, rawScore * 1.2);

    signals.push({ type: proofType, label, evidenceClaim, boundingBox, visualWeight });

    if (signals.length >= 3) break;
  }

  return signals;
}

// ─────────────────────────────────────────────────────────────────────────────
// BusinessOutcomeMapper
// ─────────────────────────────────────────────────────────────────────────────

export class BusinessOutcomeMapper {
  static build(
    features:         PrioritizedFeature[],
    businessOutputs:  BusinessValueEnrichmentResult | undefined,
    intelligence:     PageIntelligence[],
    readinessResults: ReadinessResult[],
  ): Map<string, BusinessOutcome> {
    const result = new Map<string, BusinessOutcome>();

    if (!features || features.length === 0) {
      return result;
    }

    // Build lookup maps
    const bvByFeatureId = new Map<string, BusinessValueOutput>();
    if (businessOutputs?.outputs) {
      for (const output of businessOutputs.outputs) {
        bvByFeatureId.set(output.featureId, output);
      }
    }

    const intelByPageId = new Map<string, PageIntelligence>();
    for (const intel of intelligence) {
      intelByPageId.set(intel.pageId, intel);
    }

    for (const pf of features) {
      const bv = bvByFeatureId.get(pf.feature.id);
      const benefitText = bv?.businessBenefit ?? pf.feature.name;

      const callout       = extractCallout(pf.feature.name, benefitText);
      const valueCategory = assignValueCategory(pf.feature.name, benefitText);
      const narrativeHook = truncateToWords(bv?.businessProblem ?? '', 15);
      const impactStatement = bv?.businessBenefit ?? '';
      const outcome         = bv?.customerOutcome ?? '';
      const proofSignals    = buildProofSignals(pf, intelByPageId, readinessResults);

      const businessOutcome: BusinessOutcome = {
        featureId:       pf.feature.id,
        featureName:     pf.feature.name,
        callout,
        outcome,
        valueCategory,
        narrativeHook,
        impactStatement,
        proofSignals,
        pageIds:         pf.feature.pageIds,
      };

      result.set(pf.feature.id, businessOutcome);
    }

    return result;
  }
}
