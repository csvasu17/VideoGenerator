// ─────────────────────────────────────────────────────────────────────────────
// ValueScreenClassifier
//
// Detects and rewards high-demo-value content patterns.  Emits positive
// ReadinessSignals for: KPI dashboards, analytics charts, AI insights,
// active workflows, simulations, alert feeds, business outcomes, feature
// density, and top-feature priority.
//
// Also classifies each page into a DemoValueTier (1–3) by emitting a
// 'demo_value_tier' signal whose weight encodes the tier:
//   Tier 1 (+0.30) — AI Insights, Predictive Analytics, Digital Twin, Simulator
//   Tier 2 (+0.20) — KPI Dashboards, Alerts, Device Health, Operational Monitoring
//   Tier 3 (+0.05) — Sites, Users, Asset Lists, Inventory Views
//   (Tier 4 is handled by SettingsDetector with negative weight.)
//
// Pure function — no I/O, no LLM, no state.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReadinessSignal, ScoringContext } from '../../core/domain/entities/ReadinessResult';

// ─────────────────────────────────────────────────────────────────────────────
// Pattern libraries
// ─────────────────────────────────────────────────────────────────────────────

// ── Tier 1: AI / Predictive / Digital Twin / Simulator ──────────────────────
const TIER1_URL_PATTERN = /ai|predict|twin|simulator|simulat|anomaly|forecast|intelligent|cockpit|playback/i;
const TIER1_TITLE_PATTERNS: RegExp[] = [
  /digital[\s-]twin/i, /simulator/i, /simulation/i, /cockpit/i,
  /\bai\b/i, /predict/i, /anomaly/i, /forecast/i, /intelligence/i, /playback/i,
];
const TIER1_FEATURE_PATTERNS: RegExp[] = [
  /\bai\b/i, /predict/i, /forecast/i, /anomaly/i,
  /at[\s-]risk/i, /risk\s+score/i,
  /fault\s+inject/i, /comm\s+loss/i, /compressor\s+fail/i,
  /scenario/i, /playback/i, /digital[\s-]twin/i,
  /machine\s+learn/i, /smart\s+alert/i, /intelligent/i,
];

// ── Tier 2: KPI Dashboards / Alerts / Device Health / Operational ────────────
const TIER2_URL_PATTERN = /dashboard|monitoring|alarm|alert|health|status|energy|consumption|analytics|insights?|reporting|comfort|overview/i;
const TIER2_TITLE_PATTERNS: RegExp[] = [
  /dashboard/i, /monitoring/i, /alarm/i, /alert/i, /health/i,
  /energy/i, /analytics/i, /insights?/i, /reporting/i, /comfort/i,
  /overview/i, /summary/i, /performance/i, /operational/i,
];
const TIER2_FEATURE_PATTERNS: RegExp[] = [
  /alarm/i, /alert/i, /\bkpi\b/i, /metric/i,
  /device\s+health/i, /operational/i, /energy\s+(cost|usage|saving)/i,
  /fault/i, /temperature/i, /humidity/i,
];

// ── Tier 3: Sites / Users / Assets / Inventory ──────────────────────────────
const TIER3_URL_PATTERN = /sites?|users?|assets?|inventory|devices?|buildings?|directory|fleet|locations?/i;
const TIER3_TITLE_PATTERNS: RegExp[] = [
  /sites?\b/i, /users?\b/i, /assets?\b/i, /inventory/i,
  /devices?\b/i, /buildings?\b/i, /directory/i, /fleet/i,
];

// ── Analytics / Charts ───────────────────────────────────────────────────────
const ANALYTICS_URL_PATTERN = /analytics|insights?|trends?|reports?|performance|usage|metrics?|telemetry|monitoring|comfort/i;
const CHART_FEATURE_PATTERNS: RegExp[] = [
  /chart/i, /graph/i, /trend/i, /time[\s-]series/i,
  /line\s+chart/i, /bar\s+chart/i, /histogram/i,
  /visualiz/i, /plot/i,
];

// ── AI Insights ───────────────────────────────────────────────────────────────
const AI_FEATURE_PATTERNS: RegExp[] = [
  /\bai\b/i, /prediction/i, /predicted/i, /forecast/i, /anomaly/i,
  /at[\s-]risk/i, /recommendation/i, /intelligent/i, /detect/i,
  /machine\s+learn/i, /risk\s+score/i, /smart/i,
];
const AI_BUSINESS_PATTERNS: RegExp[] = [
  /predict/i, /anomaly/i, /at[\s-]risk/i, /intelligent/i, /failure/i, /forecast/i,
];

// ── Active Workflow ───────────────────────────────────────────────────────────
const WORKFLOW_URL_PATTERN = /create|new|add|wizard|workflow|onboard|setup|configure|deploy|launch|assign|schedule/i;
const WORKFLOW_TITLE_PATTERNS: RegExp[] = [
  /create/i, /add\s+new/i, /wizard/i, /onboard/i, /workflow/i, /new\s+site/i,
];

// ── Simulation ────────────────────────────────────────────────────────────────
const SIMULATION_URL_PATTERN = /simulator|simulation|twin|digital[\s-]twin|cockpit|playback|fault|inject|scenario/i;
const SIMULATION_FEATURE_PATTERNS: RegExp[] = [
  /scenario/i, /fault\s+inject/i, /playback\s+speed/i, /comm\s+loss/i,
  /compressor\s+fail/i, /inject/i, /simulator/i, /digital[\s-]twin/i,
  /test\s+failure/i, /failure\s+scenario/i,
];

// ── Alert Feed ───────────────────────────────────────────────────────────────
const ALERT_URL_PATTERN = /alarm|alert|incident|fault|events?/i;
const ALERT_FEATURE_PATTERNS: RegExp[] = [
  /\balarms?\b/i, /\balerts?\b/i, /\bcritical\b/i, /\bwarning\b/i,
  /\bfaults?\b/i, /\bfailure\b/i, /\bescalation\b/i, /\bincident\b/i,
  /\bseverity\b/i, /\bnotification\b/i,
];

// ── Business Outcome ─────────────────────────────────────────────────────────
const BUSINESS_OUTCOME_PATTERNS: RegExp[] = [
  /\$[\d,.]+/,
  /[\d.]+\s*%/,
  /\bsaving/i, /\bsavings\b/i, /\bcost/i, /\brevenue\b/i,
  /\broi\b/i, /\befficienc/i, /\bkwh\b/i, /\benergy\s+rate\b/i,
  /\benergy\s+cost\b/i, /\bbudget\b/i, /\boptimiz/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function testUrl(url: string, pattern: RegExp): boolean {
  try { return pattern.test(new URL(url).pathname); }
  catch { return pattern.test(url); }
}

function anyFeatureMatches(
  features: ScoringContext['features'],
  patterns: RegExp[],
): string | null {
  for (const f of features) {
    for (const re of patterns) {
      if (re.test(f.featureName)) return f.featureName;
    }
  }
  return null;
}

function anyBenefitMatches(benefits: string[], patterns: RegExp[]): boolean {
  return benefits.some(b => patterns.some(re => re.test(b)));
}

// ─────────────────────────────────────────────────────────────────────────────
// ValueScreenClassifier
// ─────────────────────────────────────────────────────────────────────────────

export const ValueScreenClassifier = {
  classify(ctx: ScoringContext): ReadinessSignal[] {
    const signals: ReadinessSignal[] = [];

    // ── KPI Dashboard ─────────────────────────────────────────────────────────
    const kpiCount =
      ctx.kpiWidgets.length +
      ctx.features.filter(f => /kpi|metric\b/i.test(f.featureName)).length;
    if (kpiCount >= 2) {
      signals.push({
        type:       'kpi_dashboard',
        weight:     0.35,
        confidence: 0.85,
        evidence:   `${kpiCount} KPI / metric element(s) detected`,
        source:     'element_type',
      });
    } else if (kpiCount === 1) {
      signals.push({
        type:       'kpi_dashboard',
        weight:     0.18,
        confidence: 0.70,
        evidence:   `1 KPI / metric element detected`,
        source:     'element_type',
      });
    }

    // Mixed KPI + chart on same page
    const hasChart = ctx.features.some(f => CHART_FEATURE_PATTERNS.some(re => re.test(f.featureName)));
    if (kpiCount >= 1 && hasChart) {
      signals.push({
        type:       'kpi_dashboard',
        weight:     0.15,
        confidence: 0.75,
        evidence:   'KPI metrics and chart visualisations present on the same page',
        source:     'element_type',
      });
    }

    // Spotlight on a KPI element
    if (ctx.primaryElementBoundingBox && ctx.overallImportanceScore >= 60 && kpiCount >= 1) {
      signals.push({
        type:       'kpi_dashboard',
        weight:     0.10,
        confidence: 0.80,
        evidence:   'Primary demo element is a KPI/metric with known bounding box',
        source:     'element_type',
      });
    }

    // ── Analytics Chart ───────────────────────────────────────────────────────
    const chartFeature = anyFeatureMatches(ctx.features, CHART_FEATURE_PATTERNS);
    if (chartFeature) {
      signals.push({
        type:       'analytics_chart',
        weight:     0.25,
        confidence: 0.85,
        evidence:   `Chart/graph feature detected: "${chartFeature}"`,
        source:     'feature_label',
      });
    }
    if (
      testUrl(ctx.url, ANALYTICS_URL_PATTERN) ||
      TIER2_TITLE_PATTERNS.some(re => re.test(ctx.title))
    ) {
      if (!chartFeature) {
        signals.push({
          type:       'analytics_chart',
          weight:     0.12,
          confidence: 0.70,
          evidence:   `URL/title suggests analytics/insights content`,
          source:     ctx.url ? 'url' : 'title',
        });
      }
    }

    // ── AI Insight ────────────────────────────────────────────────────────────
    const aiFeature = anyFeatureMatches(ctx.features, AI_FEATURE_PATTERNS);
    if (aiFeature) {
      signals.push({
        type:       'ai_insight',
        weight:     0.25,
        confidence: 0.80,
        evidence:   `AI/predictive feature detected: "${aiFeature}"`,
        source:     'feature_label',
      });
    }
    if (anyBenefitMatches(ctx.businessBenefits, AI_BUSINESS_PATTERNS)) {
      signals.push({
        type:       'ai_insight',
        weight:     0.20,
        confidence: 0.85,
        evidence:   'Business value output references predictive/AI outcomes',
        source:     'feature_label',
      });
    }

    // ── Active Workflow ───────────────────────────────────────────────────────
    const hasHighPriorityAction =
      ctx.importantActions.some(a => a.impactLevel === 'high') ||
      (ctx.buttonCount >= 1 && ctx.topFeatureComposite >= 65);
    const workflowUrl   = testUrl(ctx.url, WORKFLOW_URL_PATTERN);
    const workflowTitle = WORKFLOW_TITLE_PATTERNS.some(re => re.test(ctx.title));
    if (hasHighPriorityAction && (workflowUrl || workflowTitle)) {
      signals.push({
        type:       'active_workflow',
        weight:     0.20,
        confidence: 0.70,
        evidence:   `High-impact CTA with action-oriented URL/title — workflow screen`,
        source:     workflowUrl ? 'url' : 'title',
      });
    } else if (workflowUrl || workflowTitle) {
      signals.push({
        type:       'active_workflow',
        weight:     0.10,
        confidence: 0.60,
        evidence:   `Action-oriented URL/title suggests workflow screen`,
        source:     workflowUrl ? 'url' : 'title',
      });
    }

    // ── Simulation ────────────────────────────────────────────────────────────
    const simulationUrl     = testUrl(ctx.url, SIMULATION_URL_PATTERN);
    const simulationTitle   = /simulator|simulation|digital[\s-]twin|cockpit|playback/i.test(ctx.title);
    const simulationFeature = anyFeatureMatches(ctx.features, SIMULATION_FEATURE_PATTERNS);
    if (simulationUrl || simulationTitle) {
      signals.push({
        type:       'simulation',
        weight:     0.30,
        confidence: 0.85,
        evidence:   `URL/title identifies simulation or digital-twin screen`,
        source:     simulationUrl ? 'url' : 'title',
      });
    }
    if (simulationFeature) {
      signals.push({
        type:       'simulation',
        weight:     0.25,
        confidence: 0.80,
        evidence:   `Simulation feature detected: "${simulationFeature}"`,
        source:     'feature_label',
      });
    }

    // ── Alert Feed ────────────────────────────────────────────────────────────
    const alertKpi     = ctx.kpiWidgets.filter(w => ALERT_FEATURE_PATTERNS.some(re => re.test(w.label)));
    const alertFeature = anyFeatureMatches(ctx.features, ALERT_FEATURE_PATTERNS);
    const alertUrl     = testUrl(ctx.url, ALERT_URL_PATTERN);
    if (alertKpi.length >= 2 || (alertFeature && alertKpi.length >= 1)) {
      signals.push({
        type:       'alert_feed',
        weight:     0.25,
        confidence: 0.85,
        evidence:   `${alertKpi.length} alert/alarm KPI widget(s) detected`,
        source:     'element_type',
      });
    }
    if (alertFeature) {
      signals.push({
        type:       'alert_feed',
        weight:     0.20,
        confidence: 0.80,
        evidence:   `Alert/alarm feature detected: "${alertFeature}"`,
        source:     'feature_label',
      });
    }
    if (alertUrl && !alertFeature) {
      signals.push({
        type:       'alert_feed',
        weight:     0.12,
        confidence: 0.70,
        evidence:   `URL pattern identifies alarm/alert/incident screen`,
        source:     'url',
      });
    }

    // ── Business Outcome ──────────────────────────────────────────────────────
    const outcomeFeature = ctx.features.find(f =>
      BUSINESS_OUTCOME_PATTERNS.some(re => re.test(f.featureName) || re.test(f.businessValue)),
    );
    if (outcomeFeature) {
      signals.push({
        type:       'business_outcome',
        weight:     0.15,
        confidence: 0.70,
        evidence:   `Business outcome indicator in feature: "${outcomeFeature.featureName}"`,
        source:     'feature_label',
      });
    }
    const outcomeBenefit = ctx.businessBenefits.find(b =>
      BUSINESS_OUTCOME_PATTERNS.some(re => re.test(b)),
    );
    if (outcomeBenefit && !outcomeFeature) {
      signals.push({
        type:       'business_outcome',
        weight:     0.15,
        confidence: 0.80,
        evidence:   `Business outcome in enriched narration: "${outcomeBenefit.slice(0, 60)}"`,
        source:     'feature_label',
      });
    }

    // ── Feature Density ───────────────────────────────────────────────────────
    // Scales from 0 to +0.15 for 0–6+ ranked features on this page.
    if (ctx.pageFeatureCount > 0) {
      const densityWeight = Math.min(ctx.pageFeatureCount / 6, 1) * 0.15;
      signals.push({
        type:       'feature_density',
        weight:     densityWeight,
        confidence: 0.65,
        evidence:   `${ctx.pageFeatureCount} prioritized feature(s) linked to this page`,
        source:     'ranking',
      });
    }

    // ── Top Feature Priority ──────────────────────────────────────────────────
    if (ctx.topFeatureComposite > 0) {
      const priorityWeight = (ctx.topFeatureComposite / 100) * 0.15;
      signals.push({
        type:       'top_feature_priority',
        weight:     priorityWeight,
        confidence: 0.70,
        evidence:   `Top feature composite score=${ctx.topFeatureComposite}/100`,
        source:     'ranking',
      });
    }

    // ── Demo Value Tier ───────────────────────────────────────────────────────
    // Classify into Tier 1, 2, or 3 and emit a single tier signal.
    // Tier assignment: most specific match wins (Tier 1 > Tier 2 > Tier 3).
    const isTier1 =
      testUrl(ctx.url, TIER1_URL_PATTERN) ||
      TIER1_TITLE_PATTERNS.some(re => re.test(ctx.title)) ||
      anyFeatureMatches(ctx.features, TIER1_FEATURE_PATTERNS) !== null;

    const isTier2 =
      ctx.pageCategory === 'dashboard' ||
      ctx.pageCategory === 'analytics' ||
      testUrl(ctx.url, TIER2_URL_PATTERN) ||
      TIER2_TITLE_PATTERNS.some(re => re.test(ctx.title)) ||
      ctx.kpiWidgets.length >= 2 ||
      anyFeatureMatches(ctx.features, TIER2_FEATURE_PATTERNS) !== null;

    const isTier3 =
      ctx.pageCategory === 'list' ||
      testUrl(ctx.url, TIER3_URL_PATTERN) ||
      TIER3_TITLE_PATTERNS.some(re => re.test(ctx.title));

    if (isTier1) {
      signals.push({
        type:       'demo_value_tier',
        weight:     0.30,
        confidence: 0.80,
        evidence:   'Tier 1: AI Insights / Predictive Analytics / Digital Twin / Simulator',
        source:     'element_type',
      });
    } else if (isTier2) {
      signals.push({
        type:       'demo_value_tier',
        weight:     0.20,
        confidence: 0.80,
        evidence:   'Tier 2: KPI Dashboard / Alerts / Device Health / Operational Monitoring',
        source:     'element_type',
      });
    } else if (isTier3) {
      signals.push({
        type:       'demo_value_tier',
        weight:     0.05,
        confidence: 0.70,
        evidence:   'Tier 3: Sites / Users / Assets / Inventory',
        source:     'element_type',
      });
    }

    return signals;
  },
};
