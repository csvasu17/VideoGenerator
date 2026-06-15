// ─────────────────────────────────────────────────────────────────────────────
// SettingsDetector
//
// Detects settings, administration, preferences, and configuration screens —
// pages that exist for operators / IT administrators, not for sales demos.
//
// Evidence hierarchy:
//   1. URL path segment matches settings pattern list    (confidence 0.90)
//   2. Page title matches settings title pattern         (confidence 0.85)
//   3. pageCategory === 'settings' from vision analysis  (confidence 0.80)
//   4. Graph nodeType === 'settings'                     (confidence 0.80)
//   5. Form-dominant composition with no data content    (confidence 0.60)
//
// Pure function — no I/O, no LLM, no state.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReadinessSignal, ScoringContext } from '../../core/domain/entities/ReadinessResult';

// ── Pattern lists ─────────────────────────────────────────────────────────────

const SETTINGS_URL_SEGMENTS = new Set([
  'settings', 'setting',
  'admin', 'administration', 'administrator',
  'config', 'configuration', 'configure',
  'preferences', 'preference',
  'system', 'sys-settings',
  'setup', 'initial-setup',
  'maintenance',
  'developer', 'dev-tools', 'debug',
]);

const SETTINGS_TITLE_PATTERNS: RegExp[] = [
  /\bsettings\b/i,
  /\badmin\b/i,
  /\badministration\b/i,
  /\bconfigur/i,
  /\bpreferences?\b/i,
  /\bsystem\s+settings?\b/i,
  /\bsetup\b/i,
  /\bdebug\b/i,
  /\bdatabase\b/i,
  /\brestore\s+demo\b/i,
  /\bbackup\b/i,
  /\bdata\s+source\b/i,
  /\blight\s+mode\b/i,
  /\bdark\s+mode\b/i,
];

// Element types from PageIntelligence that are form-like
// (used to detect form-dominant composition)
const FORM_FEATURE_PATTERNS: RegExp[] = [
  /\btoggle\b/i,
  /\bswitch\b/i,
  /\bcheckbox\b/i,
  /\bdropdown\b/i,
  /\bselect\b/i,
  /\binput\b/i,
  /\bsave\s+(settings|changes|config)\b/i,
  /\bapply\s+(settings|changes)\b/i,
  /\bpreference\b/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractPathSegments(url: string): string[] {
  try {
    return new URL(url).pathname.split('/').map(s => s.toLowerCase()).filter(Boolean);
  } catch {
    return url.split(/[/?]/).map(s => s.toLowerCase()).filter(Boolean);
  }
}

function isFormDominant(ctx: ScoringContext): boolean {
  if (ctx.features.length === 0) return false;
  const formFeatures = ctx.features.filter(f =>
    FORM_FEATURE_PATTERNS.some(re => re.test(f.featureName)),
  ).length;
  const hasDataContent =
    ctx.kpiWidgets.length > 0 ||
    ctx.features.some(f => /chart|graph|kpi|metric|alert|alarm|trend/i.test(f.featureName));
  return formFeatures / ctx.features.length > 0.70 && !hasDataContent;
}

// ─────────────────────────────────────────────────────────────────────────────
// SettingsDetector
// ─────────────────────────────────────────────────────────────────────────────

export const SettingsDetector = {
  detect(ctx: ScoringContext): ReadinessSignal[] {
    const signals: ReadinessSignal[] = [];

    // ── 1. URL path segment ──────────────────────────────────────────────────
    const segments = extractPathSegments(ctx.url);
    const urlMatch = segments.find(s => SETTINGS_URL_SEGMENTS.has(s));
    if (urlMatch) {
      signals.push({
        type:       'settings_screen',
        weight:     -0.45,
        confidence: 0.90,
        evidence:   `URL segment '/${urlMatch}' matches settings/admin pattern`,
        source:     'url',
      });
    }

    // ── 2. Page title ────────────────────────────────────────────────────────
    const titleMatch = SETTINGS_TITLE_PATTERNS.find(re => re.test(ctx.title));
    if (titleMatch) {
      signals.push({
        type:       'settings_screen',
        weight:     -0.40,
        confidence: 0.85,
        evidence:   `Title "${ctx.title}" matches settings/admin title pattern`,
        source:     'title',
      });
    }

    // ── 3. pageCategory from vision analysis ─────────────────────────────────
    if (ctx.pageCategory === 'settings') {
      signals.push({
        type:       'settings_screen',
        weight:     -0.40,
        confidence: 0.80,
        evidence:   `Vision analysis classified page as category='settings'`,
        source:     'element_type',
      });
    }

    // ── 4. Graph nodeType ────────────────────────────────────────────────────
    if (ctx.nodeType === 'settings') {
      signals.push({
        type:       'settings_screen',
        weight:     -0.40,
        confidence: 0.80,
        evidence:   `Application graph classified this node as nodeType='settings'`,
        source:     'graph',
      });
    }

    // ── 5. Form-dominant without data content ────────────────────────────────
    if (isFormDominant(ctx)) {
      signals.push({
        type:       'settings_screen',
        weight:     -0.30,
        confidence: 0.60,
        evidence:   `Page is form-dominant (>70% toggle/select/input features) with no charts or KPIs`,
        source:     'element_type',
      });
    }

    // ── 6. DOM form structure — input-heavy page with no KPI data ────────────
    // Catches interaction-state captures of create/add forms where the vision
    // model extracted generic feature names (e.g. "Rheem TotalView") that don't
    // match FORM_FEATURE_PATTERNS, but the DOM clearly shows a data-entry page.
    if (ctx.formCount >= 1 && ctx.inputCount >= 3 && ctx.kpiWidgets.length === 0) {
      signals.push({
        type:       'settings_screen',
        weight:     -0.30,
        confidence: 0.65,
        evidence:   `DOM: ${ctx.formCount} form(s) with ${ctx.inputCount} inputs and no KPI widgets — data-entry page`,
        source:     'dom',
      });
    }

    return signals;
  },
};
