/**
 * validate-sales-story.ts
 *
 * Validation report for the Sales Story Director (Phase 8).
 * Reconstructs the real Rheem TotalView corpus from demo-package.json and
 * runs SalesStoryDirectorStage deterministically.
 *
 * Run:
 *   npx ts-node --project tsconfig.scripts.json scripts/validate-sales-story.ts
 */

import { SalesStoryDirectorStage } from '../src/application/pipeline/stages/SalesStoryDirectorStage';
import type { PrioritizedFeature } from '../src/core/domain/entities/PrioritizedFeature';
import type { PageIntelligence } from '../src/core/domain/entities/PageIntelligence';
import type { ReadinessResult } from '../src/core/domain/entities/ReadinessResult';
import type { BusinessValueEnrichmentResult } from '../src/core/domain/entities/BusinessValueOutput';
import type { PipelineContext } from '../src/application/pipeline/PipelineContext';
import type { StoryArc, SceneGoal } from '../src/core/domain/entities/SalesStory';

// ─────────────────────────────────────────────────────────────────────────────
// Corpus — reconstructed from the 9-scene Rheem TotalView demo-package.json
// ─────────────────────────────────────────────────────────────────────────────

interface SceneSpec {
  pageId:       string;
  title:        string;
  featureId:    string;
  featureName:  string;
  tier:         'tier1' | 'tier2' | 'tier3' | 'tier4';
  readiness:    number;
  businessProblem:  string;
  businessBenefit:  string;
  customerOutcome:  string;
  kpiLabel?:    string;
  kpiValue?:    string;
  bboxX:        number;
  bboxY:        number;
  bboxW:        number;
  bboxH:        number;
}

const CORPUS: SceneSpec[] = [
  {
    pageId:      'f9e5448f-b613-4999-839f-dea7be5da24c',
    title:       'Dashboard KPI metric',
    featureId:   'feat-dashboard',
    featureName: 'Dashboard KPI Overview',
    tier:        'tier2',
    readiness:   0.85,
    businessProblem:  'Operations managers have no single view of energy usage and device status across their sites.',
    businessBenefit:  'See every KPI metric and site status on one dashboard — no manual data pulls.',
    customerOutcome:  'Teams resolve issues 40% faster because every metric is always one click away.',
    kpiLabel:    'Total Energy Spend',
    kpiValue:    '$12,400 / mo',
    bboxX: 0.55, bboxY: 0.08, bboxW: 0.4, bboxH: 0.78,
  },
  {
    pageId:      '1f4b3945-8539-4134-ad7a-967eba36eefc',
    title:       'User List',
    featureId:   'feat-users',
    featureName: 'User Management',
    tier:        'tier3',
    readiness:   0.55,
    businessProblem:  'Admins manually manage user access in spreadsheets, creating security gaps.',
    businessBenefit:  'Control who accesses what from a single screen — roles applied instantly.',
    customerOutcome:  'Onboarding new team members takes minutes instead of days.',
    kpiLabel:    'Active Users',
    kpiValue:    '47',
    bboxX: 0.66, bboxY: 0.16, bboxW: 0.32, bboxH: 0.64,
  },
  {
    pageId:      '55b11baa-5a61-4e1e-b6e2-f994d9c4159f',
    title:       'Device-Level Metrics Table',
    featureId:   'feat-insights',
    featureName: 'Device Fleet Analytics',
    tier:        'tier2',
    readiness:   0.78,
    businessProblem:  'Energy costs are rising but teams cannot identify which devices are underperforming.',
    businessBenefit:  'Compare energy spend, runtime, and performance across every device — instantly.',
    customerOutcome:  'Customers identify and fix top-10 energy drains, reducing utility bills by up to 15%.',
    kpiLabel:    'Avg Energy / Device',
    kpiValue:    '4.2 kWh',
    bboxX: 0.62, bboxY: 0.08, bboxW: 0.32, bboxH: 0.84,
  },
  {
    pageId:      'e8011180-f903-474c-af36-bac99f7f9bd2',
    title:       'AI Predictive Maintenance',
    featureId:   'feat-ai-predict',
    featureName: 'AI Predictive Maintenance',
    tier:        'tier1',
    readiness:   0.95,
    businessProblem:  'Unplanned equipment failures cause costly downtime and reactive repair cycles.',
    businessBenefit:  'Prevent failures before they happen — AI detects anomalies 14 days in advance.',
    customerOutcome:  'Teams eliminate 80% of emergency repair callouts and reduce downtime costs by $50K/year.',
    kpiLabel:    'Failure Probability',
    kpiValue:    'High Risk — 14 days',
    bboxX: 0.05, bboxY: 0.08, bboxW: 0.38, bboxH: 0.22,
  },
  {
    pageId:      '3681c358-1c7c-44a3-a151-8ff1686e9217',
    title:       'Add Building Workflow',
    featureId:   'feat-sites',
    featureName: 'Site & Building Management',
    tier:        'tier3',
    readiness:   0.65,
    businessProblem:  'Adding new sites requires IT tickets and weeks of manual configuration.',
    businessBenefit:  'Add new buildings online in minutes — no IT ticket needed.',
    customerOutcome:  'New sites are live and monitored within 10 minutes of physical installation.',
    kpiLabel:    'Sites Online',
    kpiValue:    '12 active',
    bboxX: 0.65, bboxY: 0.08, bboxW: 0.33, bboxH: 0.85,
  },
  {
    pageId:      'fa351125-5cd4-4699-bde0-8202875f1b87',
    title:       'Real-Time Alert Feed',
    featureId:   'feat-alarms',
    featureName: 'Real-Time Alarm Feed',
    tier:        'tier2',
    readiness:   0.82,
    businessProblem:  'Critical equipment alerts get buried in email, causing delayed responses and extended outages.',
    businessBenefit:  'Respond faster to critical issues — alerts appear live the moment they happen.',
    customerOutcome:  'Mean time to acknowledge drops from 4 hours to under 8 minutes.',
    kpiLabel:    'Active Alarms',
    kpiValue:    '3 Critical',
    bboxX: 0.78, bboxY: 0.12, bboxW: 0.21, bboxH: 0.76,
  },
  {
    pageId:      '9aa8f979-0f81-4de7-9275-81557bc1b464',
    title:       'Alarm Center',
    featureId:   'feat-alarm-center',
    featureName: 'Alarm Center Dashboard',
    tier:        'tier2',
    readiness:   0.80,
    businessProblem:  'Alarm triage is manual and time-consuming — engineers waste hours sorting through noise.',
    businessBenefit:  'Triage every alarm by severity, site, and device type from one screen.',
    customerOutcome:  'Critical alarms are resolved 60% faster with clear severity ranking.',
    kpiLabel:    'Critical Alarms Today',
    kpiValue:    '7',
    bboxX: 0.61, bboxY: 0.12, bboxW: 0.34, bboxH: 0.69,
  },
  {
    pageId:      '9dbe7014-47d6-4a0e-b67f-908028df3d7f',
    title:       'Device Fleet',
    featureId:   'feat-fleet',
    featureName: 'Device Fleet Monitor',
    tier:        'tier2',
    readiness:   0.75,
    businessProblem:  'Monitoring hundreds of devices across multiple sites is impossible without automation.',
    businessBenefit:  'Monitor every device in real time — health, status, and energy in one fleet view.',
    customerOutcome:  'Field teams spend 50% less time on manual checks — issues are flagged automatically.',
    kpiLabel:    'Fleet Health',
    kpiValue:    '94% Online',
    bboxX: 0.65, bboxY: 0.05, bboxW: 0.3, bboxH: 0.88,
  },
  {
    pageId:      '06845ca6-7a35-4e55-a94f-d246067144e3',
    title:       'Fault Simulator',
    featureId:   'feat-simulator',
    featureName: 'Fault Simulator',
    tier:        'tier1',
    readiness:   0.92,
    businessProblem:  'Engineers cannot safely test failure scenarios without risking live equipment.',
    businessBenefit:  'Test every fault scenario with zero risk — simulate failures on a digital twin.',
    customerOutcome:  'Teams validate response procedures in simulation before deployment, cutting incident response time by 35%.',
    kpiLabel:    'Simulation Coverage',
    kpiValue:    '24 fault types',
    bboxX: 0.05, bboxY: 0.18, bboxW: 0.52, bboxH: 0.48,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Build pipeline inputs from corpus
// ─────────────────────────────────────────────────────────────────────────────

function buildFeatures(): PrioritizedFeature[] {
  return CORPUS.map((s, i) => ({
    rank: i + 1,
    feature: {
      id:          s.featureId,
      name:        s.featureName,
      description: s.businessBenefit,
      pageIds:     [s.pageId],
      businessValue: s.businessBenefit,
      category:    'analytics' as const,
      visibilityScore: s.readiness,
      interactivityScore: 0.5,
      businessValueScore: s.readiness * 100,
      frequencyScore: 0.5,
    },
    compositeScore: s.readiness * 100,
    businessValueScore: s.readiness * 100,
    tier: s.tier === 'tier1' ? 1 : s.tier === 'tier2' ? 2 : 3,
  })) as unknown as PrioritizedFeature[];
}

function buildIntelligence(): PageIntelligence[] {
  return CORPUS.map(s => ({
    pageId:                    s.pageId,
    pageTitle:                 s.title,
    pageCategory:              'analytics' as const,
    pagePurpose:               s.businessBenefit,
    overallImportanceScore:    Math.round(s.readiness * 100),
    features:                  [],
    kpiWidgets:                s.kpiLabel ? [{ label: s.kpiLabel, value: s.kpiValue ?? '', trend: 'up' as const }] : [],
    importantActions:          [],
    primaryElementBoundingBox: { x: s.bboxX, y: s.bboxY, width: s.bboxW, height: s.bboxH },
  })) as unknown as PageIntelligence[];
}

function buildReadinessResults(): ReadinessResult[] {
  return CORPUS.map(s => ({
    pageId:          s.pageId,
    url:             `http://localhost:5173/${s.featureId}`,
    title:           s.title,
    readinessScore:  s.readiness,
    confidence:      0.9,
    verdict:         s.readiness >= 0.40 ? 'pass' : 'reject' as const,
    category:        s.readiness >= 0.65 ? 'high_value' : 'acceptable' as const,
    demoValueTier:   s.tier,
    rejectionReason: null,
    signals:         [],
  })) as ReadinessResult[];
}

function buildBusinessValueOutputs(): BusinessValueEnrichmentResult {
  return {
    outputs: CORPUS.map(s => ({
      featureId:       s.featureId,
      featureName:     s.featureName,
      businessProblem: s.businessProblem,
      businessBenefit: s.businessBenefit,
      customerOutcome: s.customerOutcome,
      salesNarration:  `With ${s.featureName}, your team can ${s.businessBenefit.toLowerCase()}.`,
      source:          'llm' as const,
    })),
    totalSubmitted: CORPUS.length,
    totalEnriched:  CORPUS.length,
    enrichedAt:     new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown report helpers
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_EMOJI: Record<string, string> = {
  hook:       '🎣',
  problem:    '❗',
  insight:    '💡',
  action:     '⚡',
  outcome:    '✅',
  validation: '🔬',
  scale:      '📡',
};

const PRIORITY_BAR = (p: number): string => {
  const filled = Math.round(p * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled) + ` ${(p * 100).toFixed(0)}%`;
};

function formatSceneTable(scenes: SceneGoal[]): string {
  const rows = scenes.map((sg, i) => {
    const emoji   = ROLE_EMOJI[sg.sceneRole] ?? '•';
    const cam     = sg.cameraIntent.strategy;
    const bbox    = sg.cameraIntent.zoomTarget
      ? `bbox(${sg.cameraIntent.zoomTarget.x.toFixed(2)},${sg.cameraIntent.zoomTarget.y.toFixed(2)})`
      : 'full-page';
    const pop     = sg.cameraIntent.proofPopAtSec != null
      ? `+pop@${sg.cameraIntent.proofPopAtSec}s`
      : '';
    return [
      `${i + 1}`,
      `${emoji} **${sg.sceneRole}**`,
      sg.feature,
      `\`${sg.callout}\``,
      sg.proofElement.type,
      `${PRIORITY_BAR(sg.storyPriority)}`,
      `${sg.minDurationSec}s`,
      `z=${sg.cameraIntent.endZoom.toFixed(2)} ${cam} ${bbox}${pop}`,
    ].join(' | ');
  });

  const header = `# | Role | Feature | Callout | Proof Element | Priority | Min Dur | Camera`;
  const sep    = `--|------|---------|---------|---------------|----------|---------|-------`;
  return [header, sep, ...rows].join('\n');
}

function formatSceneValidations(arc: StoryArc): string {
  return arc.sceneValidations.map(sv => {
    const checks = sv.checks;
    const passed = Object.values(checks).filter(Boolean).length;
    const icon   = sv.passed ? '✅' : '⚠️';
    const failed = Object.entries(checks)
      .filter(([, v]) => !v)
      .map(([k]) => k)
      .join(', ');
    return `${icon} Scene ${sv.sceneId} (${sv.pageId.slice(0, 8)}…) — ${passed}/12 checks  score=${sv.score.toFixed(2)}${failed ? `  ⛔ failed: ${failed}` : ''}`;
  }).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const stage = new SalesStoryDirectorStage();

  // Minimal PipelineContext stub — stage only reads it in _ctx position
  const ctx = {} as PipelineContext;

  console.log('Running Sales Story Director against Rheem TotalView corpus...\n');

  const arc = await stage.run(
    {
      intelligence:    buildIntelligence(),
      features:        buildFeatures(),
      businessOutputs: buildBusinessValueOutputs(),
      readinessResults: buildReadinessResults(),
      captures:        [],
    },
    ctx,
  );

  // ── Markdown report ────────────────────────────────────────────────────────
  const report = `
# Sales Story Director — Validation Report
**Product:** Rheem TotalView
**Run date:** ${new Date().toISOString()}
**Pipeline stage:** Phase 8 — SalesStoryDirectorStage

---

## Arc Selection

| Field | Value |
|-------|-------|
| **Arc Type** | \`${arc.arcType}\` |
| **Title** | ${arc.title} |
| **Premise** | ${arc.premise} |
| **Resolution** | ${arc.resolution} |
| **Opening Hook** | ${arc.openingHook} |
| **Closing CTA** | ${arc.closingCTA} |
| **Arc Narrative** | ${arc.arcNarrative} |
| **Scene Count** | ${arc.scenes.length} |

---

## Arc Validation

| Check | Result |
|-------|--------|
| **Arc Complete** | ${arc.validationSummary.arcComplete ? '✅ Yes' : '❌ No'} |
| **Missing Roles** | ${arc.validationSummary.missingRoles.length === 0 ? 'None' : arc.validationSummary.missingRoles.join(', ')} |
| **Overall Score** | ${(arc.validationSummary.overallScore * 100).toFixed(1)}% |
| **Weak Scenes** | ${arc.validationSummary.weakScenes.length === 0 ? 'None' : arc.validationSummary.weakScenes.join(', ')} |
| **Redundant Scenes** | ${arc.validationSummary.redundantScenes.length === 0 ? 'None' : arc.validationSummary.redundantScenes.join(', ')} |
${arc.validationSummary.recommendedChanges.length > 0
  ? `| **Recommendations** | ${arc.validationSummary.recommendedChanges.join('; ')} |`
  : ''}

---

## Scene Sequence

${formatSceneTable(arc.scenes)}

---

## Per-Scene Detail

${arc.scenes.map((sg, i) => `
### Scene ${i + 1} — ${ROLE_EMOJI[sg.sceneRole] ?? '•'} ${sg.sceneRole.toUpperCase()}: ${sg.feature}

| Field | Value |
|-------|-------|
| **Page ID** | \`${sg.pageId.slice(0, 8)}…\` |
| **Callout** | **${sg.callout}** |
| **Scene Goal** | ${sg.sceneGoal} |
| **Narrative Hook** | ${sg.narrativeHook} |
| **Closing Line** | ${sg.closingLine} |
| **Story Priority** | ${PRIORITY_BAR(sg.storyPriority)} |
| **Min Duration** | ${sg.minDurationSec}s |
| **Value Category** | ${sg.businessOutcome.valueCategory} |
| **Impact Statement** | ${sg.businessOutcome.impactStatement.slice(0, 80)}… |

**Proof Element:**
- Type: \`${sg.proofElement.type}\`
- Label: ${sg.proofElement.label}
- Claim: ${sg.proofElement.evidenceClaim}
- BBox: ${sg.proofElement.boundingBox ? `x=${sg.proofElement.boundingBox.x.toFixed(2)} y=${sg.proofElement.boundingBox.y.toFixed(2)} w=${sg.proofElement.boundingBox.width.toFixed(2)} h=${sg.proofElement.boundingBox.height.toFixed(2)}` : 'none'}
- Visual Weight: ${sg.proofElement.visualWeight.toFixed(2)}

**Camera Intent:**
- Strategy: \`${sg.cameraIntent.strategy}\`
- Motion Style: \`${sg.cameraIntent.motionStyle}\`
- End Zoom: ${sg.cameraIntent.endZoom.toFixed(2)}×
- Proof Pop At: ${sg.cameraIntent.proofPopAtSec != null ? `${sg.cameraIntent.proofPopAtSec}s` : 'none'}
- Zoom Target: ${sg.cameraIntent.zoomTarget ? `bbox(${sg.cameraIntent.zoomTarget.x.toFixed(2)},${sg.cameraIntent.zoomTarget.y.toFixed(2)},${sg.cameraIntent.zoomTarget.width.toFixed(2)},${sg.cameraIntent.zoomTarget.height.toFixed(2)})` : 'full-page'}
`).join('\n')}

---

## Per-Scene Validation Checks

${formatSceneValidations(arc)}

---

## What Changed vs. Phase 7

| Aspect | Before (Phase 7) | After (Phase 8) |
|--------|-----------------|-----------------|
| Journey order | Graph beam-search | Story arc narrative sequence |
| Scene callouts | Generic templates | Benefit-driven headlines |
| Camera target | spotlightTarget elementType | proof_focus on proof element bbox |
| Scene role | None | hook / insight / action / validation |
| Duration | Fixed (7s default) | Role-driven min (7–12s) + storyPriority boost |
| Opening title | "everything your team need" | ${arc.openingHook.slice(0, 60)} |
| Arc type | 'unknown' | \`${arc.arcType}\` |

---

*Report generated by \`scripts/validate-sales-story.ts\`*
`;

  process.stdout.write(report);

  // Write to file
  const { writeFileSync } = await import('fs');
  const { join } = await import('path');
  const outPath = join('out', 'localhost', 'sales-story-validation-report.md');
  writeFileSync(outPath, report, 'utf8');
  console.error(`\n✅  Report written to ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
