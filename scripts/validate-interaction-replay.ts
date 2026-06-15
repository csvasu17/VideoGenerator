/**
 * validate-interaction-replay.ts
 *
 * Validation report for the Interaction Replay Director (Phase 9).
 *
 * Reads the existing demo-package.json to reconstruct Rheem TotalView scene
 * data, then builds synthetic ExplorationResult objects that simulate what
 * InPageDiscoveryStage would produce for each scene's page.
 *
 * Runs the full Phase 9 pipeline deterministically:
 *   InteractionSequenceBuilder → BusinessInteractionScorer → ReplayBuilder
 *   → ReplayValidator → InteractionSalesStoryBridge
 *
 * Produces a structured Rheem validation report to stdout.
 *
 * Run:
 *   npx ts-node --project tsconfig.scripts.json scripts/validate-interaction-replay.ts
 */

import * as fs   from 'fs';
import * as path from 'path';

import { InteractionSequenceBuilder  } from '../src/interaction-replay/InteractionSequenceBuilder';
import { BusinessInteractionScorer   } from '../src/interaction-replay/BusinessInteractionScorer';
import { ReplayBuilder               } from '../src/interaction-replay/ReplayBuilder';
import { ReplayValidator             } from '../src/interaction-replay/ReplayValidator';
import { InteractionSalesStoryBridge } from '../src/interaction-replay/InteractionSalesStoryBridge';

import type { ExplorationResult }       from '../src/agents/discovery/interaction/types';
import type { StoryArc, SceneGoal, SceneRole } from '../src/core/domain/entities/SalesStory';
import type { InteractionReplay }             from '../src/core/domain/entities/InteractionReplay';

// ─────────────────────────────────────────────────────────────────────────────
// Demo-package location
// ─────────────────────────────────────────────────────────────────────────────

const PACKAGE_PATH = path.resolve(__dirname, '../out/localhost/demo-package.json');

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic corpus — simulates InPageDiscovery output for Rheem TotalView
//
// Each scene gets one synthetic discovered state whose tokens are derived from
// known Rheem page content, approximating what the browser would surface.
// ─────────────────────────────────────────────────────────────────────────────

interface SyntheticInteraction {
  pageId:      string;
  title:       string;
  selector:    string;
  hint:        string;
  addedTokens: string[];
  interactionClass: 'TAB_TRIGGER' | 'ACCORDION_HEADER' | 'EXPAND_TOGGLE' | 'VISUAL_TAB_CANDIDATE';
  boundingRect: { x: number; y: number; width: number; height: number } | null;
}

const SYNTHETIC_INTERACTIONS: SyntheticInteraction[] = [
  {
    pageId:       'scene-1',
    title:        'Prediction Likelihood Classification',
    selector:     '.prediction-tab',
    hint:         'Prediction Likelihood Tab',
    addedTokens:  ['Prediction Likelihood', 'AI model', '87%', 'Classification', 'Risk Score'],
    interactionClass: 'TAB_TRIGGER',
    boundingRect: { x: 200, y: 120, width: 220, height: 44 },
  },
  {
    pageId:       'scene-2',
    title:        'Approval and Alarm Workflow',
    selector:     '.approve-button',
    hint:         'Approve Alarm Workflow',
    addedTokens:  ['Alarm generated', 'Critical fault', 'Approval workflow triggered', 'Status: Active'],
    interactionClass: 'EXPAND_TOGGLE',
    boundingRect: { x: 800, y: 450, width: 180, height: 48 },
  },
  {
    pageId:       'scene-3',
    title:        'Digital Twin Simulation Control',
    selector:     '.simulate-btn',
    hint:         'Run Simulation',
    addedTokens:  ['Simulation result', 'Twin virtual model', 'Fault injected', 'Scenario output', 'Energy savings 24%'],
    interactionClass: 'EXPAND_TOGGLE',
    boundingRect: { x: 960, y: 540, width: 200, height: 52 },
  },
  {
    pageId:       'scene-4',
    title:        'Device Health & Status',
    selector:     '.device-health-tab',
    hint:         'Device Health Summary Tab',
    addedTokens:  ['Device KPI metric', 'Runtime hours', 'Cost per device', 'Abnormal energy use', 'Fleet health summary'],
    interactionClass: 'TAB_TRIGGER',
    boundingRect: { x: 300, y: 130, width: 260, height: 44 },
  },
  {
    pageId:       'scene-5',
    title:        'Device Consumption',
    selector:     '.consumption-chart',
    hint:         'Device Consumption Chart',
    addedTokens:  ['Energy consumption', 'kWh per device', 'Cost metric', 'High usage device', 'Utility expense'],
    interactionClass: 'VISUAL_TAB_CANDIDATE',
    boundingRect: { x: 450, y: 200, width: 800, height: 400 },
  },
  {
    pageId:       'scene-6',
    title:        'Alarm Status Categorization',
    selector:     '.alarm-filter',
    hint:         'Filter Critical Alarms',
    addedTokens:  ['Critical alarm', 'Warning alert', 'Risk score change', 'Alarm generated', 'Incident count'],
    interactionClass: 'EXPAND_TOGGLE',
    boundingRect: { x: 100, y: 350, width: 160, height: 40 },
  },
  {
    pageId:       'scene-7',
    title:        'User Role and Status Visibility',
    selector:     '.role-accordion',
    hint:         'Expand User Role Details',
    addedTokens:  ['User workflow', 'Role assignment', 'Workflow completed', 'Access status', 'Admin permissions'],
    interactionClass: 'ACCORDION_HEADER',
    boundingRect: { x: 200, y: 400, width: 600, height: 48 },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Build synthetic ExplorationResult objects
// ─────────────────────────────────────────────────────────────────────────────

function buildExplorations(): Map<string, ExplorationResult> {
  const map = new Map<string, ExplorationResult>();

  for (const si of SYNTHETIC_INTERACTIONS) {
    const baseState = {
      id:               `base-${si.pageId}`,
      pageUrl:          `https://rheem.example.com/${si.pageId}`,
      interactionPath:  [],
      depth:            0,
      screenshotPath:   `out/localhost/captures/${si.pageId}/viewport.png`,
      screenshotHash:   `hash-base-${si.pageId}`,
      domSummary: {
        headings:          [{ level: 1, text: si.title }],
        visibleTextTokens: ['Dashboard', 'Rheem TotalView', si.title],
        elementCounts:     { tables: 1, canvases: 0, svgs: 0, forms: 0, lists: 0, buttons: 3, inputs: 0 },
        ariaRoleCounts:    { tab: 3 },
      },
      fingerprint: {
        stableTextHash:       `stable-base-${si.pageId}`,
        headingStructureHash: `heading-base-${si.pageId}`,
        widgetCounts:         { TABLE: 1, CHART: 0, FORM: 0, LIST: 0, UNKNOWN: 0 },
        interactiveCount:     3,
        compositeHash:        `composite-base-${si.pageId}`,
      },
      capturedAt: 1_700_000_000_000,
    };

    const discState = {
      id:              `disc-${si.pageId}`,
      pageUrl:         `https://rheem.example.com/${si.pageId}`,
      interactionPath: [{
        targetSelector:      si.selector,
        interactionClass:    si.interactionClass,
        detectionMethod:     'aria' as const,
        humanReadableHint:   si.hint,
        elementBoundingRect: si.boundingRect,
      }],
      depth:           1,
      screenshotPath:  `out/localhost/interactions/${si.pageId}/disc-0.png`,
      screenshotHash:  `hash-disc-${si.pageId}`,
      domSummary: {
        headings:          [{ level: 1, text: si.title }, { level: 2, text: si.hint }],
        visibleTextTokens: ['Dashboard', 'Rheem TotalView', si.title, ...si.addedTokens],
        elementCounts:     { tables: 1, canvases: 1, svgs: 1, forms: 1, lists: 0, buttons: 4, inputs: 1 },
        ariaRoleCounts:    { tab: 3, region: 1 },
      },
      fingerprint: {
        stableTextHash:       `stable-disc-${si.pageId}`,
        headingStructureHash: `heading-disc-${si.pageId}`,
        widgetCounts:         { TABLE: 1, CHART: 1, FORM: 1, LIST: 0, UNKNOWN: 0 },
        interactiveCount:     6,
        compositeHash:        `composite-disc-${si.pageId}`,
      },
      capturedAt: 1_700_000_001_000,
    };

    map.set(si.pageId, {
      baseState,
      discoveredStates: [discState],
      totalAttempts:    1,
      totalMeaningful:  1,
      budgetStatus:     'completed',
    });
  }

  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build synthetic StoryArc from demo-package.json scene list
// ─────────────────────────────────────────────────────────────────────────────

function buildStoryArc(scenes: { id: string; title: string }[]): StoryArc {
  const roleSeq: SceneRole[] = ['hook', 'problem', 'insight', 'action', 'outcome', 'validation', 'scale'];

  const sceneGoals: SceneGoal[] = scenes.map((s, idx) => {
    const role: SceneRole = roleSeq[idx % roleSeq.length];
    return {
      sceneIndex:    idx,
      pageId:        s.id,
      sceneRole:     role,
      feature:       s.title,
      businessOutcome: {
        featureId:       s.id,
        featureName:     s.title,
        callout:         s.title,
        outcome:         `${s.title} delivers measurable efficiency gains.`,
        valueCategory:   'operational_intelligence',
        narrativeHook:   `${s.title} drives operational efficiency.`,
        impactStatement: 'Up to 50% reduction in maintenance response time.',
        proofSignals:    [],
        pageIds:         [s.id],
      },
      callout:       s.title,
      proofElement: {
        type:          'kpi_metric',
        label:          s.title,
        evidenceClaim: `${s.title} visible on screen`,
        boundingBox:    null,
        visualWeight:   0.75,
      },
      sceneGoal:     `${role}: ${s.title}`,
      narrativeHook: `${s.title} drives operational efficiency.`,
      closingLine:   'See immediate results with Rheem TotalView.',
      cameraIntent: {
        strategy:     'page_overview',
        zoomTarget:    null,
        endZoom:       1.1,
        motionStyle:  'ken_burns',
        proofPopAtSec: null,
      },
      minDurationSec: 20,
      storyPriority:  0.7,
    };
  });

  return {
    arcType:      'reactive_to_predictive',
    title:        'Rheem TotalView — Operational Intelligence',
    premise:      'Manual monitoring leaves teams reacting too late.',
    resolution:   'AI-powered visibility enables proactive, data-driven decisions.',
    scenes:       sceneGoals,
    arcNarrative: 'From reactive maintenance to predictive intelligence.',
    openingHook:  'Rheem TotalView — where AI meets operational excellence.',
    closingCTA:   'Schedule a live demo today.',
    validationSummary: {
      arcComplete:        true,
      missingRoles:       [],
      weakScenes:         [],
      redundantScenes:    [],
      overallScore:       0.85,
      narrative:          'Validation corpus built for Phase 9 report.',
      recommendedChanges: [],
    },
    sceneValidations: sceneGoals.map(sg => ({
      sceneId:  sg.pageId,
      pageId:   sg.pageId,
      passed:   true,
      score:    0.85,
      checks: {
        hasBusinessOutcome:     true,
        hasProofElement:        true,
        proofElementHasBBox:    false,
        calloutIsBenefitDriven: true,
        sceneRoleAssigned:      true,
        notNavigation:          true,
        notEmptyState:          true,
        notForm:                true,
        notSettings:            true,
        contributesToArc:       true,
        narrativeHookPresent:   true,
        closingLinePresent:     true,
      },
      warnings:        [],
      rejectionReason: null,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Print helpers
// ─────────────────────────────────────────────────────────────────────────────

function hr(char = '─', width = 80): string {
  return char.repeat(width);
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function bar(score: number, width = 20): string {
  const filled = Math.round(score * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n' + hr('═'));
  console.log('  Rheem TotalView — Phase 9 Interaction Replay Validation Report');
  console.log('  Generated: ' + new Date().toISOString());
  console.log(hr('═') + '\n');

  // ── Load demo-package.json ─────────────────────────────────────────────────
  let demoScenes: { id: string; title: string }[] = [];
  if (fs.existsSync(PACKAGE_PATH)) {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf-8'));
    demoScenes = (pkg.scenes ?? []).map((s: { id: string; title: string }) => ({
      id:    s.id,
      title: s.title,
    }));
    console.log(`✓ Loaded demo-package.json: ${demoScenes.length} scenes`);
  } else {
    // Use synthetic scene list
    demoScenes = SYNTHETIC_INTERACTIONS.map(si => ({ id: si.pageId, title: si.title }));
    console.log(`⚠ demo-package.json not found — using synthetic scene list (${demoScenes.length} scenes)`);
  }

  // ── Step 1: Build explorations ─────────────────────────────────────────────
  const explorations = buildExplorations();
  console.log(`\n[Step 1] Built ${explorations.size} synthetic ExplorationResult objects`);

  // ── Step 2: Build sequences ────────────────────────────────────────────────
  const sequences = new InteractionSequenceBuilder().build(explorations);
  console.log(`[Step 2] InteractionSequenceBuilder → ${sequences.length} sequences`);

  // ── Step 3: Score sequences ────────────────────────────────────────────────
  new BusinessInteractionScorer().score(sequences);
  console.log(`[Step 3] BusinessInteractionScorer applied`);

  // ── Step 4: Build replays ──────────────────────────────────────────────────
  const replays = new ReplayBuilder().build(sequences);
  console.log(`[Step 4] ReplayBuilder → ${replays.length} replays`);

  // ── Step 5: Validate ───────────────────────────────────────────────────────
  const { promoted, demoted, report } = new ReplayValidator().validate(replays);
  console.log(`[Step 5] ReplayValidator → ${promoted.length} promoted, ${demoted.length} demoted`);

  // ── Step 6: Bridge to story arc ────────────────────────────────────────────
  const storyArc = buildStoryArc(demoScenes);
  const plan     = new InteractionSalesStoryBridge().bridge(promoted, replays, storyArc, report);
  console.log(`[Step 6] InteractionSalesStoryBridge → ${plan.sceneToReplayMap.size}/${storyArc.scenes.length} scenes upgraded`);

  // ─────────────────────────────────────────────────────────────────────────
  // REPORT
  // ─────────────────────────────────────────────────────────────────────────

  console.log('\n' + hr());
  console.log('  SEQUENCE SCORES');
  console.log(hr());
  for (const seq of sequences) {
    const promoted = report.replayResults.find(r => {
      const replayForSeq = replays.find(rp => rp.sequenceId === seq.sequenceId);
      return replayForSeq && r.interactionId === replayForSeq.interactionId;
    });
    const promotedStr = promoted?.promoted ? '✓ PROMOTED' : '✗ demoted ';
    const si = SYNTHETIC_INTERACTIONS.find(s => s.pageId === seq.pageId);
    console.log(`  ${promotedStr}  pageId=${seq.pageId.padEnd(12)} bizScore=${seq.businessScore.toFixed(3)}  signals=[${seq.businessSignals.join(', ')}]`);
    if (si) {
      console.log(`            hint="${si.hint}"`);
    }
  }

  console.log('\n' + hr());
  console.log('  REPLAY VALIDATION DETAILS');
  console.log(hr());
  for (const result of report.replayResults) {
    const replay = replays.find(r => r.interactionId === result.interactionId);
    const label  = replay ? replay.trigger.humanReadableHint : result.interactionId;
    const status = result.promoted ? '✓ PASS' : '✗ FAIL';
    console.log(`\n  ${status} [score=${pct(result.score)}] ${label}`);
    console.log(`  ${bar(result.score)}  priority=${replay?.replayPriority.toFixed(3) ?? 'n/a'}  duration=${replay?.replayDurationSec.toFixed(1) ?? 'n/a'}s`);
    for (const check of result.checks) {
      const icon = check.passed ? '  ✓' : '  ✗';
      console.log(`${icon}  ${check.name.padEnd(26)} weight=${check.weight.toFixed(2)}  ${check.detail ?? ''}`);
    }
  }

  console.log('\n' + hr());
  console.log('  SCENE COVERAGE SUMMARY');
  console.log(hr());
  console.log(`  Total scenes:            ${storyArc.scenes.length}`);
  console.log(`  Promoted to interaction: ${plan.sceneToReplayMap.size}`);
  console.log(`  Coverage rate:           ${pct(plan.coverageRate)}`);
  console.log(`  Min guard (30%):         ${Math.max(1, Math.round(storyArc.scenes.length * 0.30))}`);
  console.log(`  Max guard (60%):         ${Math.min(storyArc.scenes.length, Math.floor(storyArc.scenes.length * 0.60))}`);
  console.log(`  Guard satisfied:         ${plan.coverageRate >= 0.30 && plan.coverageRate <= 0.60 ? '✓ YES' : '✗ NO (check guard logic)'}`);

  console.log('\n  Scene assignments:');
  for (const [sceneIdx, interactionId] of plan.sceneToReplayMap) {
    const scene  = storyArc.scenes[sceneIdx];
    const replay = plan.replays.find(r => r.interactionId === interactionId);
    console.log(`    Scene ${(sceneIdx + 1).toString().padStart(2)} (${scene?.pageId ?? '?'}) → ${interactionId}  [${replay?.trigger.humanReadableHint ?? 'unknown'}]`);
  }

  console.log('\n' + hr());
  console.log('  RECOMMENDATIONS');
  console.log(hr());
  if (report.recommendations.length === 0) {
    console.log('  ✓ No recommendations — all checks passed within acceptable thresholds.');
  } else {
    for (const rec of report.recommendations) {
      console.log(`  ⚠  ${rec}`);
    }
  }

  console.log('\n' + hr());
  console.log(`  RESULT: ${promoted.length}/${replays.length} replays promoted  |  Coverage: ${pct(plan.coverageRate)}  |  ${plan.coverageRate >= 0.30 ? '✓ Guard satisfied' : '✗ Guard not satisfied'}`);
  console.log(hr('═') + '\n');
}

main().catch(err => {
  console.error('Validation script error:', err);
  process.exit(1);
});
