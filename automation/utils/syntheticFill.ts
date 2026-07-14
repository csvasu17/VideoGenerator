/**
 * syntheticFill.ts — deterministic, rule-based synthetic form-field values for
 * exhaustive Agent Recording.
 *
 * Rule-based, NOT per-field AI, deliberately:
 *   1. Scale — fields × pages × roles would dwarf every other AI-call site in this
 *      codebase (which are all one-per-scene, not one-per-field).
 *   2. Determinism — the same page yields the same synthetic data on every run,
 *      keeping repeated runs diffable/auditable.
 *   3. Safety — asking a model to "invent something plausible" for a field labeled
 *      "SSN" or "Routing Number" is exactly the failure mode to avoid; a deterministic
 *      keyword-skip is safer and auditable than trusting model judgment per field.
 *
 * v2 escape hatch: AGENT_SYNTHETIC_FILL_MODE=llm would batch one AI call per PAGE
 * (not per field), reusing the existing max_completion_tokens+reasoning_effort:'low'
 * pattern already proven in generateDemoPainPoints() — not implemented in v1.
 */

import type { FieldOption } from '../../src/core/domain/entities/PageFieldMap';

export interface FillValueContext {
  label:        string;
  inputType?:   string;
  tag:          'input' | 'textarea' | 'select';
  options?:     FieldOption[];
  placeholder?: string;
  required?:    boolean;
}

export interface FillValueResult {
  action: 'fill' | 'select' | 'check' | 'skip';
  value?: string;
  reason: string;
}

/** Never filled — password fields disproportionately trigger real validation/security side effects. */
const ALWAYS_SKIP_INPUT_TYPES = new Set(['password', 'file']);

/** PII/financial keywords — skipped regardless of inputType (most likely to hit real fraud/validation systems). */
const PII_FINANCIAL_KEYWORDS = [
  'ssn', 'social security', 'tax id', 'credit card', 'card number', 'cvv', 'cvc',
  'routing number', 'account number', 'iban', 'swift',
];

/** Consent-style checkboxes/radios — left untouched rather than auto-checked. */
const CONSENT_KEYWORDS = ['agree', 'consent', 'terms', 'subscribe', 'marketing'];

/** Placeholder-looking <select> option labels/values to skip when picking the first real option. */
const SELECT_STOPLIST = new Set(['', 'select...', 'select', 'choose one', 'choose', '--', 'n/a', '-select-']);

function containsKeyword(text: string, keywords: string[]): string | undefined {
  const lower = text.toLowerCase();
  return keywords.find(k => lower.includes(k));
}

function slugForEmail(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'field';
}

export function generateFillValue(ctx: FillValueContext): FillValueResult {
  const label = ctx.label || ctx.placeholder || '';
  const lowerLabel = label.toLowerCase();

  // ── select: always a REAL listed option, never invented ──────────────────────
  if (ctx.tag === 'select') {
    const real = (ctx.options ?? []).find(o => !SELECT_STOPLIST.has(o.label.trim().toLowerCase()) && !SELECT_STOPLIST.has(o.value.trim().toLowerCase()));
    if (!real) return { action: 'skip', reason: 'no non-placeholder option available' };
    return { action: 'select', value: real.value, reason: `picked real option "${real.label}"` };
  }

  // ── never-fill input types ────────────────────────────────────────────────────
  if (ctx.inputType && ALWAYS_SKIP_INPUT_TYPES.has(ctx.inputType)) {
    return { action: 'skip', reason: `${ctx.inputType} fields are never filled` };
  }

  // ── PII / financial keyword stoplist — regardless of inputType ────────────────
  const piiHit = containsKeyword(lowerLabel, PII_FINANCIAL_KEYWORDS);
  if (piiHit) {
    return { action: 'skip', reason: `label matches PII/financial keyword "${piiHit}"` };
  }

  // ── checkbox / radio ───────────────────────────────────────────────────────────
  if (ctx.inputType === 'checkbox' || ctx.inputType === 'radio') {
    const consentHit = containsKeyword(lowerLabel, CONSENT_KEYWORDS);
    if (consentHit) {
      return { action: 'skip', reason: `consent-style field ("${consentHit}") left untouched` };
    }
    return { action: 'check', reason: 'deterministic checkbox/radio selection' };
  }

  // ── keyword/type-driven text values ───────────────────────────────────────────
  if (ctx.inputType === 'email' || lowerLabel.includes('email')) {
    return { action: 'fill', value: `agent.demo+${slugForEmail(label)}@example.com`, reason: 'synthetic email (example.com is IANA-reserved, can never reach a real inbox)' };
  }
  if (ctx.inputType === 'tel' || lowerLabel.includes('phone') || lowerLabel.includes('tel')) {
    return { action: 'fill', value: '555-0100', reason: 'synthetic phone (555-01xx is NANP-reserved for fiction)' };
  }
  if (ctx.inputType === 'url' || lowerLabel.includes('website') || lowerLabel.includes('url')) {
    return { action: 'fill', value: 'https://example.com/demo-agent', reason: 'synthetic URL' };
  }
  if (ctx.inputType === 'date' || lowerLabel.includes('date')) {
    const today = new Date();
    if (lowerLabel.includes('birth') || lowerLabel.includes('dob')) {
      today.setFullYear(today.getFullYear() - 30);
    } else if (lowerLabel.includes('expir') || lowerLabel.includes('due') || lowerLabel.includes('deadline')) {
      today.setDate(today.getDate() + 7);
    }
    return { action: 'fill', value: today.toISOString().slice(0, 10), reason: 'keyword-driven synthetic date' };
  }
  if (ctx.inputType === 'number') {
    return { action: 'fill', value: '1', reason: 'synthetic number default' };
  }

  // ── generic text/textarea — intentionally, visibly synthetic ──────────────────
  const nameHit = lowerLabel.includes('name') && !lowerLabel.includes('username') && !lowerLabel.includes('filename');
  if (nameHit) {
    return { action: 'fill', value: 'Alex Demo', reason: 'name-like field' };
  }
  return {
    action: 'fill',
    value: `Sample ${label || 'value'} entered by automated demo agent.`,
    reason: 'generic text field — intentionally self-announcing as synthetic',
  };
}
