// ─────────────────────────────────────────────────────────────────────────────
// InteractionSequenceBuilder
//
// Converts raw ExplorationResult objects (from ctx.interactionExplorations)
// into typed InteractionSequence objects ready for business scoring.
//
// Pure computation — no Playwright, no LLM, no filesystem reads.
// All data comes from the already-captured PageInteractionState objects.
//
// One sequence per depth-1 discovered state (single click from base).
// Deeper states are skipped to avoid multi-step compound replay complexity.
//
// Phase 9b quality changes:
//   - Signal detection splits tokens into value-bearing vs narrative
//   - Permitted signal matrix gates signals by InteractionClass
//   - transitionKey computed from (startHash:endHash) for deduplication
//   - classPenaltyMultiplier stored for use by BusinessInteractionScorer
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'crypto';
import type {
  ExplorationResult,
  InteractionClass,
  InteractionStep,
  Rect,
  WidgetType,
} from '../agents/discovery/interaction/types';
import { compare } from '../agents/discovery/interaction/StateComparator';
import type {
  BusinessSignalType,
  InteractionEventType,
  InteractionSequence,
  InteractionStateRef,
  InteractionTrigger,
  NormalisedBox,
  ReplayVisualDelta,
  ValueChange,
} from '../core/domain/entities/InteractionReplay';
import type { SceneRole } from '../core/domain/entities/SalesStory';

// ── Constants ──────────────────────────────────────────────────────────────────

const VIEWPORT_W = 1920;
const VIEWPORT_H = 1080;
const MEANINGFUL_THRESHOLD = 0.20;

// ── Interaction class → event type ────────────────────────────────────────────

const CLASS_TO_EVENT: Record<InteractionClass, InteractionEventType> = {
  TAB_TRIGGER:           'tab_switch',
  VISUAL_TAB_CANDIDATE:  'tab_switch',
  ACCORDION_HEADER:      'accordion_expand',
  EXPAND_TOGGLE:         'toggle_expand',
};

// ── Class penalty multipliers ─────────────────────────────────────────────────
//
// Applied to the final businessScore in BusinessInteractionScorer.
// Lower value = harder bar for promotion. Accordion/toggle interactions must
// produce genuinely high-value content to reach the 0.60 threshold.

const CLASS_PENALTY: Record<InteractionEventType, number> = {
  tab_switch:       0.90,
  click:            1.00,
  scenario_execute: 1.10,   // bonus — direct simulation execution
  filter_change:    0.95,
  accordion_expand: 0.50,   // structural reveal, low intrinsic value
  toggle_expand:    0.50,   // same
};

// ── Permitted signals per event type ─────────────────────────────────────────
//
// Signals must be compatible with what the interaction can plausibly accomplish.
// Prevents end-state content contamination: an accordion that opens an alarms
// panel cannot be credited with 'alarm_generated' — the alarm already existed,
// the user just scrolled to it.
//
// Rules:
//   accordion_expand / toggle_expand  → only KPI/outcome values permitted
//   tab_switch                        → KPI, outcome, simulation, AI OK; alarm/fault blocked
//   filter_change                     → KPI/cost/outcome only
//   scenario_execute                  → simulation + fault + KPI
//   click                             → all signals permitted

const PERMITTED_SIGNALS: Record<InteractionEventType, ReadonlySet<BusinessSignalType>> = {
  accordion_expand: new Set<BusinessSignalType>([
    'kpi_revealed', 'kpi_changed', 'outcome_metric', 'cost_metric_revealed',
  ]),
  toggle_expand: new Set<BusinessSignalType>([
    'kpi_revealed', 'kpi_changed', 'outcome_metric', 'cost_metric_revealed',
  ]),
  tab_switch: new Set<BusinessSignalType>([
    'kpi_revealed', 'kpi_changed', 'outcome_metric', 'cost_metric_revealed',
    'simulation_result', 'simulation_started', 'simulation_completed',
    'ai_prediction', 'risk_score_change', 'risk_score_changed',
    'workflow_completed',
  ]),
  filter_change: new Set<BusinessSignalType>([
    'kpi_revealed', 'kpi_changed', 'outcome_metric', 'cost_metric_revealed',
    'risk_score_change', 'risk_score_changed',
  ]),
  scenario_execute: new Set<BusinessSignalType>([
    'simulation_result', 'simulation_started', 'simulation_completed',
    'fault_injected', 'kpi_revealed', 'kpi_changed', 'outcome_metric',
    'risk_score_change', 'risk_score_changed',
  ]),
  click: new Set<BusinessSignalType>([
    'ai_prediction', 'risk_score_change', 'risk_score_changed',
    'alarm_generated', 'fault_injected', 'kpi_revealed', 'kpi_changed',
    'cost_metric_revealed', 'workflow_completed',
    'simulation_result', 'simulation_started', 'simulation_completed', 'outcome_metric',
  ]),
};

// ── Documentation / help panel rejection keywords ─────────────────────────────
//
// If any of these appear in the humanReadableHint, the interaction is flagged
// as a documentation/navigation interaction in the validation report.
// The ReplayValidator hard gate uses this same list.

export const DOCUMENTATION_KEYWORDS = [
  'guide', 'help', 'getting started', 'tutorial', 'documentation',
  'learn more', 'about', 'overview', 'introduction', 'faq', 'tips',
  'how to', 'instructions',
];

// ── Business signal keyword patterns ─────────────────────────────────────────
//
// Applied to VALUE TOKENS ONLY (tokens containing digits or explicit metric
// suffixes) + the trigger hint.  Narrative/paragraph text is excluded to
// prevent false positives from end-state documentation content.

const RX_AI       = /\b(predict|ai|ml|anomaly|classif|likelihood|probability|forecast|model)\b/i;
const RX_RISK     = /\b(risk|likelihood|probability|hazard|criticality|score)\b/i;
const RX_ALARM    = /\b(alarm|alert|warning|critical|fault|error|issue|incident)\b/i;
const RX_SIM      = /\b(simulat|twin|virtual|scenario|inject|test|playback|fault)\b/i;
const RX_KPI      = /\b(kpi|metric|rate|savings?|efficiency|target|actual|trend|benchmark)\b/i;
const RX_COST     = /\b(cost|energy|consumption|kwh|dollar|saving|expense|utility)\b/i;
const RX_WORKFLOW = /\b(approv|workflow|submit|complet|assign|execut|trigger|dispatch)\b/i;
const RX_OUTCOME  = /\b(result|outcome|output|report|summary|total|count)\b/i;

// Matches tokens that carry a numeric value — these are the only tokens
// used for most signals (prevents documentation text from triggering signals).
const RX_VALUE_TOKEN = /\d/;

// Tokens longer than this are treated as narrative/paragraph text and excluded.
const MAX_SIGNAL_TOKEN_LEN = 40;

// ─────────────────────────────────────────────────────────────────────────────
// detectSignals
//
// Two-pass detection:
//   Pass 1 — value corpus: numeric tokens + trigger hint → all signals
//   Pass 2 — label corpus: short non-numeric tokens + hint → only AI/sim
//
// Signals that pass detection are then filtered through PERMITTED_SIGNALS
// for the given eventType before being stored as permittedSignals.
// ─────────────────────────────────────────────────────────────────────────────

function detectSignals(
  addedTokens:  string[],
  addedWidgets: WidgetType[],
  hint:         string,
  eventType:    InteractionEventType,
): { raw: BusinessSignalType[]; permitted: BusinessSignalType[] } {
  // Split tokens into value-bearing and label/narrative
  const valueTokens = addedTokens.filter(
    t => RX_VALUE_TOKEN.test(t) && t.length <= MAX_SIGNAL_TOKEN_LEN,
  );
  const labelTokens = addedTokens.filter(
    t => !RX_VALUE_TOKEN.test(t) && t.length <= 30,
  );

  // Value corpus drives most signals
  const valueCorpus = [...valueTokens, hint].join(' ');
  // Label corpus only used for AI/simulation (these can appear as labels without numbers)
  const labelCorpus = [...labelTokens, hint].join(' ');

  const seen = new Set<BusinessSignalType>();
  const push = (s: BusinessSignalType) => seen.add(s);

  // Signals from value corpus (require numeric/metric content or hint match)
  if (RX_AI.test(valueCorpus))       push('ai_prediction');
  if (RX_RISK.test(valueCorpus))     push('risk_score_change');
  if (RX_ALARM.test(valueCorpus))    push('alarm_generated');
  if (RX_KPI.test(valueCorpus))      push('kpi_revealed');
  if (RX_COST.test(valueCorpus))     push('cost_metric_revealed');
  if (RX_WORKFLOW.test(valueCorpus)) push('workflow_completed');
  if (RX_OUTCOME.test(valueCorpus) || addedWidgets.includes('CHART') || addedWidgets.includes('TABLE'))
                                     push('outcome_metric');

  // Simulation signals — also check label corpus (simulator UI has labels without numbers)
  if (RX_SIM.test(valueCorpus) || RX_SIM.test(labelCorpus)) {
    push('simulation_result');
    if (addedWidgets.includes('FORM') || /inject|fault/i.test(hint)) push('fault_injected');
  }

  // KPI changed — numeric value tokens appeared that look like a dashboard metric
  if (valueTokens.some(t => /^(\d{1,3}(,\d{3})*(\.\d+)?(%|kWh|°F|°C|\$|pts|ms)?|[A-Z]{1,6}\s+\d)/.test(t))) {
    push('kpi_revealed');
  }

  const raw = [...seen];

  // Apply class-permission filter
  const permittedSet = PERMITTED_SIGNALS[eventType];
  const permitted = raw.filter(s => permittedSet.has(s));

  return { raw, permitted };
}

// ── Story role from PERMITTED signals (not raw) ───────────────────────────────

function permittedSignalsToRole(permitted: BusinessSignalType[]): SceneRole {
  if (permitted.includes('ai_prediction') || permitted.includes('simulation_result') ||
      permitted.includes('simulation_completed') || permitted.includes('simulation_started'))
    return 'insight';
  if (permitted.includes('alarm_generated') || permitted.includes('risk_score_change') ||
      permitted.includes('risk_score_changed') || permitted.includes('fault_injected'))
    return 'problem';
  if (permitted.includes('kpi_revealed') || permitted.includes('kpi_changed') ||
      permitted.includes('outcome_metric') || permitted.includes('cost_metric_revealed'))
    return 'outcome';
  if (permitted.includes('workflow_completed'))
    return 'action';
  // No permitted signals → neutral
  return 'insight';
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

function normaliseRect(rect: Rect | null | undefined): NormalisedBox | null {
  if (!rect) return null;
  return {
    x:      rect.x      / VIEWPORT_W,
    y:      rect.y      / VIEWPORT_H,
    width:  rect.width  / VIEWPORT_W,
    height: rect.height / VIEWPORT_H,
  };
}

// ── Main builder ───────────────────────────────────────────────────────────────

export class InteractionSequenceBuilder {

  /**
   * Convert a map of ExplorationResults into a flat list of InteractionSequence
   * objects ready for business scoring.
   *
   * Only depth-1 states (single click from base) are processed.
   */
  build(explorations: Map<string, ExplorationResult>): InteractionSequence[] {
    const sequences: InteractionSequence[] = [];

    for (const [pageId, exploration] of explorations) {
      for (const state of exploration.discoveredStates) {
        if (state.depth !== 1) continue;

        const triggerStep = state.interactionPath[state.interactionPath.length - 1];
        if (!triggerStep) continue;

        // Re-run StateComparator (deterministic — same PageInteractionState inputs)
        const delta = compare(exploration.baseState, state, MEANINGFUL_THRESHOLD);

        const eventType  = CLASS_TO_EVENT[triggerStep.interactionClass] ?? 'click';
        const trigger    = this.buildTrigger(triggerStep, eventType);
        const startState = this.buildStateRef(exploration.baseState, pageId);
        const endState   = this.buildStateRef(state, pageId);

        const baseTokenSet = new Set(exploration.baseState.domSummary.visibleTextTokens);
        const addedTokens  = state.domSummary.visibleTextTokens.filter(t => !baseTokenSet.has(t));

        const visualDelta = this.buildVisualDelta(delta, triggerStep, addedTokens);

        const { raw: businessSignals, permitted: permittedSignals } = detectSignals(
          addedTokens,
          delta.addedWidgetTypes,
          triggerStep.humanReadableHint,
          eventType,
        );

        const storyRoleAffinity = permittedSignalsToRole(permittedSignals);

        // Stable transition identity — used for deduplication in the bridge
        const transitionKey = createHash('sha256')
          .update(`${startState.screenshotHash}:${endState.screenshotHash}`)
          .digest('hex')
          .slice(0, 16);

        const sequenceId = createHash('sha256')
          .update(`${pageId}:${triggerStep.targetSelector}:${state.screenshotHash}`)
          .digest('hex')
          .slice(0, 16);

        const classPenaltyMultiplier = CLASS_PENALTY[eventType] ?? 1.00;

        sequences.push({
          sequenceId,
          pageId,
          pageUrl:              exploration.baseState.pageUrl,
          trigger,
          startState,
          endState,
          visualDelta,
          structuralDeltaScore: delta.functionalScore,
          businessSignals,
          permittedSignals,
          transitionKey,
          classPenaltyMultiplier,
          businessScore:        0,   // filled by BusinessInteractionScorer
          storyRoleAffinity,
        });
      }
    }

    return sequences;
  }

  // ── Private ────────────────────────────────────────────────────────────────────

  private buildTrigger(step: InteractionStep, eventType: InteractionEventType): InteractionTrigger {
    return {
      eventType,
      cssSelector:       step.targetSelector,
      elementBBox:       normaliseRect(step.elementBoundingRect),
      humanReadableHint: step.humanReadableHint,
      triggerPurpose:    this.inferTriggerPurpose(step),
    };
  }

  private inferTriggerPurpose(step: InteractionStep): string {
    const h = step.humanReadableHint.toLowerCase();
    if (/tab|panel|section/.test(h))      return `Switch to ${step.humanReadableHint} view`;
    if (/expand|show|more|detail/.test(h))return `Expand ${step.humanReadableHint}`;
    if (/accord|collapse/.test(h))        return `Toggle ${step.humanReadableHint}`;
    return `Interact with ${step.humanReadableHint}`;
  }

  private buildStateRef(
    state:  Pick<{ screenshotPath: string; screenshotHash: string; pageUrl: string }, 'screenshotPath' | 'screenshotHash' | 'pageUrl'>,
    pageId: string,
  ): InteractionStateRef {
    return {
      screenshotPath: state.screenshotPath,
      screenshotHash: state.screenshotHash,
      pageId,
      pageUrl:        state.pageUrl,
    };
  }

  private buildVisualDelta(
    delta:       ReturnType<typeof compare>,
    triggerStep: InteractionStep,
    addedTokens: string[],
  ): ReplayVisualDelta {
    // Only value-bearing tokens become callout candidates
    const valueTokens = addedTokens.filter(
      t => RX_VALUE_TOKEN.test(t) && t.length >= 2 && t.length <= 20,
    );

    const valueChanges: ValueChange[] = valueTokens
      .slice(0, 5)
      .map(val => ({
        label:           val,
        before:          '',
        after:           val,
        changeType:      'appear' as const,
        businessMeaning: null,
      }));

    return {
      primaryChangeRegion:  normaliseRect(triggerStep.elementBoundingRect),
      appearedElements:     addedTokens.slice(0, 10),
      disappearedElements:  [],
      valueChanges,
      changeIntensity:      delta.functionalScore,
      newWidgetTypes:       delta.addedWidgetTypes.map(w => w.toLowerCase()),
    };
  }
}
