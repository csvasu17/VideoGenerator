// ─────────────────────────────────────────────────────────────────────────────
// BusinessValueFallback
//
// When the LLM is unavailable or returns an unparseable response for a feature,
// this module produces a well-formed BusinessValueOutput derived deterministically
// from the feature's existing metadata.
//
// The fallback preserves whatever copy was already extracted during vision
// analysis (Feature.businessValue.*) and shapes it into the four required fields.
// This guarantees the pipeline never produces empty narration.
// ─────────────────────────────────────────────────────────────────────────────

import type { PrioritizedFeature } from '../../core/domain/entities/PrioritizedFeature';
import type { BusinessValueOutput } from '../../core/domain/entities/BusinessValueOutput';
import type { FeatureCategory, OutcomeType } from '../../core/domain/entities/Feature';

// ─────────────────────────────────────────────────────────────────────────────
// Keyword → template mappings
//
// Order matters: first pattern that matches wins.
// Each entry provides template strings with a single `{name}` placeholder
// for the feature name.
// ─────────────────────────────────────────────────────────────────────────────

interface FallbackTemplate {
  pattern:         RegExp;
  businessProblem: string;
  businessBenefit: (name: string) => string;
  customerOutcome: (name: string) => string;
  narration:       (name: string) => string;
}

const KEYWORD_TEMPLATES: FallbackTemplate[] = [
  {
    pattern:         /export|csv|download|report|share|extract/i,
    businessProblem: 'Sharing operational data with stakeholders requires manual extraction — hours of work with a high risk of errors.',
    businessBenefit: (n) => `Export any dataset in seconds — no platform login required for recipients.`,
    customerOutcome: (n) => `Reports reach stakeholders in seconds instead of hours, with zero transcription risk.`,
    narration:       (n) => `With ${n}, your team can share operational data with anyone in the organisation instantly. No more manual data pulls or back-and-forth email chains.`,
  },
  {
    pattern:         /dashboard|overview|summary|home|monitor/i,
    businessProblem: 'Teams lack a single live view of operations, forcing them to check multiple systems before making any decision.',
    businessBenefit: (n) => `Every critical metric in one live view — no tab switching, no manual refresh.`,
    customerOutcome: (n) => `Operational decisions are made in real time instead of waiting for the next status meeting.`,
    narration:       (n) => `With the ${n}, your team gets a single live picture of operations — everything that matters, right now. Decision-makers stop waiting for updates and start acting on what's happening.`,
  },
  {
    pattern:         /alarm|alert|notif|warning|incident|fault/i,
    businessProblem: 'Critical faults often go undetected until they cause outages, triggering expensive emergency responses.',
    businessBenefit: (n) => `Every alarm surfaced instantly — with full device context, no hunting required.`,
    customerOutcome: (n) => `Response times drop from hours of manual investigation to minutes of informed action.`,
    narration:       (n) => `With ${n}, your team sees every fault the moment it occurs — with all the context needed to act. Fewer emergency callouts, faster resolution, and no surprises.`,
  },
  {
    pattern:         /analytic|chart|graph|trend|insight|intelligence|visuali/i,
    businessProblem: 'Without live analytics, cost-saving opportunities are identified weeks after the fact — too late to act.',
    businessBenefit: (n) => `Turn raw operational data into clear, actionable trends — automatically.`,
    customerOutcome: (n) => `Decisions that relied on weekly reports can now be made in real time.`,
    narration:       (n) => `With ${n}, your team can spot trends, identify inefficiencies, and act on real data — without waiting for the next report cycle. Analytics that used to take days now surface in seconds.`,
  },
  {
    pattern:         /temperature|energy|consumption|power|kwh|watt|volt/i,
    businessProblem: 'Energy waste and thermal drift go undetected until they cause outages or appear on a quarterly bill.',
    businessBenefit: (n) => `See exactly which devices are consuming above their baseline — before it becomes a problem.`,
    customerOutcome: (n) => `Early detection reduces emergency maintenance costs and helps hit energy reduction targets.`,
    narration:       (n) => `With ${n}, your team can spot energy waste and thermal anomalies before they escalate. That means lower utility bills, fewer emergency callouts, and equipment that lasts longer.`,
  },
  {
    pattern:         /device|fleet|asset|equipment|hardware/i,
    businessProblem: 'Managing a fleet of devices across multiple sites is difficult when status information is scattered across systems.',
    businessBenefit: (n) => `Every device, every site, every status — tracked in one place without manual check-ins.`,
    customerOutcome: (n) => `Asset downtime drops as issues are caught and resolved before they escalate.`,
    narration:       (n) => `With ${n}, your team has complete visibility across every device in the fleet — live status, history, and health metrics in one place. Fewer surprises, faster response, and lower maintenance costs.`,
  },
  {
    pattern:         /telemetry|sensor|reading|live|real.?time/i,
    businessProblem: 'Without live telemetry, field teams waste hours on-site gathering data that should be available remotely.',
    businessBenefit: (n) => `Live readings from every sensor — no site visit required to check device health.`,
    customerOutcome: (n) => `Field teams resolve more issues remotely, cutting site visit costs by eliminating preventable callouts.`,
    narration:       (n) => `With ${n}, your team can read live data from any sensor without stepping on-site. Diagnose issues remotely, dispatch only when necessary, and stop paying for visits you don't need.`,
  },
  {
    pattern:         /user|role|permission|access|admin|setting|config/i,
    businessProblem: 'Poorly managed access controls lead to compliance risk and users seeing data they shouldn\'t.',
    businessBenefit: (n) => `Grant the right access to the right people — instantly, with a full audit trail.`,
    customerOutcome: (n) => `Compliance audits are completed in minutes; access disputes are resolved the same day.`,
    narration:       (n) => `With ${n}, administrators can manage who sees what in seconds — no support tickets, no waiting. Complete control, complete audit trail.`,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Category-level fallback (used when no keyword pattern matches)
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_TEMPLATES: Record<FeatureCategory, Omit<FallbackTemplate, 'pattern'>> = {
  analytics: {
    businessProblem: 'Operational insight requires hours of manual data gathering and cross-referencing.',
    businessBenefit: (n) => `Instant access to ${n} — no manual effort required.`,
    customerOutcome: (n) => `Teams respond to operational changes in minutes instead of hours.`,
    narration:       (n) => `With ${n}, your team gets the answers they need without digging through spreadsheets. Faster insight, better decisions, less manual work.`,
  },
  reporting: {
    businessProblem: 'Creating and distributing reports is a time-consuming manual process prone to version errors.',
    businessBenefit: (n) => `Automated ${n} delivered on demand — always current, always accurate.`,
    customerOutcome: (n) => `Report preparation time drops from hours to seconds.`,
    narration:       (n) => `With ${n}, your team generates and shares any report in moments. No more manual compilation — just the right data, in the right format, for the right people.`,
  },
  workflow: {
    businessProblem: 'Multi-step processes that span teams or systems create bottlenecks and missed handoffs.',
    businessBenefit: (n) => `Automate ${n} end-to-end — no manual handoffs, no process gaps.`,
    customerOutcome: (n) => `Process cycle time is cut and handoff errors are eliminated.`,
    narration:       (n) => `With ${n}, your team moves through the workflow without friction — every step tracked, every handoff automatic. Less time on process, more time on outcomes.`,
  },
  core: {
    businessProblem: 'Core platform functions require multiple systems and manual steps to complete.',
    businessBenefit: (n) => `${n} consolidates the work your team does every day into one streamlined flow.`,
    customerOutcome: (n) => `Daily operational tasks complete faster with fewer errors.`,
    narration:       (n) => `With ${n}, your team handles day-to-day operations from a single place. No system switching, no duplicated effort — just the work that matters.`,
  },
  integration: {
    businessProblem: 'Data silos force teams to manually copy information between systems, creating delays and errors.',
    businessBenefit: (n) => `${n} keeps all your systems in sync — automatically, in the background.`,
    customerOutcome: (n) => `Data is always current across every system your team depends on.`,
    narration:       (n) => `With ${n}, your data flows automatically between systems — no manual exports, no sync delays. Your team always works with the most current information.`,
  },
  notification: {
    businessProblem: 'Critical events are missed because teams rely on manual checks or delayed batch reports.',
    businessBenefit: (n) => `${n} surfaces what matters the moment it happens — no checking required.`,
    customerOutcome: (n) => `Response times drop as the right people are informed instantly, every time.`,
    narration:       (n) => `With ${n}, your team is notified the instant something needs their attention. No more missed alerts or delayed responses — just timely, targeted information.`,
  },
  admin: {
    businessProblem: 'Configuration and access management create support bottlenecks and slow down onboarding.',
    businessBenefit: (n) => `Manage ${n} in seconds from a central screen — no ticket required.`,
    customerOutcome: (n) => `Admin tasks complete in minutes; the team spends more time on value-adding work.`,
    narration:       (n) => `With ${n}, administrators handle configuration and access management instantly. Fewer support requests, faster onboarding, and a team that stays focused on the work that matters.`,
  },
  generic: {
    businessProblem: 'Teams spend time on manual overhead that should be automated by the platform.',
    businessBenefit: (n) => `${n} automates the routine so your team can focus on decisions.`,
    customerOutcome: (n) => `Teams reclaim hours per week previously spent on manual effort.`,
    narration:       (n) => `With ${n}, your team spends less time on manual work and more time on what actually moves the business. It handles the routine — your team handles the important.`,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a BusinessValueOutput from the feature's existing metadata.
 * Used when the LLM is unavailable or its response cannot be parsed.
 *
 * Priority:
 * 1. Keyword match on feature name (most specific)
 * 2. Category-level template (moderate specificity)
 * (No third level — category defaults cover all FeatureCategory values)
 */
export function buildFallback(pf: PrioritizedFeature): BusinessValueOutput {
  const { feature } = pf;
  const name        = feature.name;
  const lower       = name.toLowerCase();

  // ── 1. Keyword match ──────────────────────────────────────────────────────
  const kw = KEYWORD_TEMPLATES.find(t => t.pattern.test(lower));

  if (kw) {
    return {
      featureId:       feature.id,
      featureName:     name,
      businessProblem: kw.businessProblem,
      businessBenefit: kw.businessBenefit(name),
      customerOutcome: kw.customerOutcome(name),
      salesNarration:  kw.narration(name),
      source:          'fallback',
    };
  }

  // ── 2. Category template ──────────────────────────────────────────────────
  const cat = CATEGORY_TEMPLATES[feature.category] ?? CATEGORY_TEMPLATES['generic'];

  // Prefer existing vision-analysis copy when it exists and is meaningful
  const existingPain    = feature.businessValue.painSolved?.trim()        || cat.businessProblem;
  const existingBenefit = feature.businessValue.headline?.trim()           || cat.businessBenefit(name);
  const existingImpact  = feature.businessValue.quantifiedImpact?.trim()   || cat.customerOutcome(name);

  return {
    featureId:       feature.id,
    featureName:     name,
    businessProblem: existingPain,
    businessBenefit: existingBenefit,
    customerOutcome: existingImpact,
    salesNarration:  cat.narration(name),
    source:          'fallback',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported for test access
// ─────────────────────────────────────────────────────────────────────────────

export { KEYWORD_TEMPLATES, CATEGORY_TEMPLATES };
