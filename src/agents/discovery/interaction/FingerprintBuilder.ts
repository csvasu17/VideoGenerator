// ─────────────────────────────────────────────────────────────────────────────
// FingerprintBuilder — pure fingerprint construction
//
// Converts a DomSummary into a FunctionalFingerprint.
// No Playwright.  No I/O.  Fully unit-testable without a browser.
//
// Design goals:
//   • Insensitive to dynamic values: IDs, live counts, timestamps, prices
//   • Insensitive to token order within the same semantic region
//   • Sensitive to structural changes: new headings, new widget types
//   • Deterministic: identical inputs always produce identical output
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'crypto';
import type { DomSummary, FunctionalFingerprint, WidgetType } from './types';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a FunctionalFingerprint from a lean DOM summary.
 *
 * All five fields are computed deterministically from the input.
 * Call twice with the same DomSummary → identical FunctionalFingerprint.
 */
export function buildFingerprint(summary: DomSummary): FunctionalFingerprint {
  const stableTextHash       = computeStableTextHash(summary.visibleTextTokens);
  const headingStructureHash = computeHeadingStructureHash(summary.headings);
  const widgetCounts         = computeWidgetCounts(summary);
  const interactiveCount     = computeInteractiveCount(summary);
  const compositeHash        = computeCompositeHash(
    stableTextHash,
    headingStructureHash,
    widgetCounts,
    interactiveCount,
  );

  return {
    stableTextHash,
    headingStructureHash,
    widgetCounts,
    interactiveCount,
    compositeHash,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * SHA256 of sorted, digit-stripped, deduplicated visible text tokens.
 *
 * Stripping digits ensures "47 alerts" and "52 alerts" produce the same hash.
 * Sorting ensures the same tokens in different order produce the same hash.
 * Deduplication prevents repeated tokens from inflating similarity.
 */
function computeStableTextHash(tokens: string[]): string {
  const normalised = tokens
    .map(t => t.replace(/\d+/g, '').toLowerCase().trim())
    .filter(t => t.length > 0);

  const unique = Array.from(new Set(normalised)).sort();
  return sha256(unique.join(' '));
}

/**
 * SHA256 of heading tag hierarchy in document order.
 *
 * Order is preserved — H1=Dashboard / H2=Devices differs from H1=Devices / H2=Dashboard.
 * Digit values are stripped so "7 Active Devices" == "Active Devices".
 */
function computeHeadingStructureHash(
  headings: { level: number; text: string }[],
): string {
  const lines = headings.map(h => {
    const cleanText = h.text.replace(/\d+/g, '').toLowerCase().trim();
    return `h${h.level}:${cleanText}`;
  });
  return sha256(lines.join('\n'));
}

/**
 * Map element counts to typed widget categories.
 *
 * TABLE  — HTML <table> elements
 * CHART  — <canvas> and non-decorative <svg> elements
 * FORM   — <form> elements
 * LIST   — <ul> and <ol> elements
 * UNKNOWN — ARIA roles not covered above (e.g. grid, treegrid, figure)
 */
function computeWidgetCounts(summary: DomSummary): Record<WidgetType, number> {
  const { elementCounts, ariaRoleCounts } = summary;

  const unknownRoles = Object.entries(ariaRoleCounts)
    .filter(([role]) => !KNOWN_ARIA_ROLES.has(role))
    .reduce((sum, [, count]) => sum + count, 0);

  return {
    TABLE:   elementCounts.tables,
    CHART:   elementCounts.canvases + elementCounts.svgs,
    FORM:    elementCounts.forms,
    LIST:    elementCounts.lists,
    UNKNOWN: unknownRoles,
  };
}

/** ARIA roles that are NOT counted as UNKNOWN widgets. */
const KNOWN_ARIA_ROLES = new Set([
  'tab', 'tablist', 'tabpanel',
  'dialog', 'alertdialog',
  'navigation', 'main', 'banner', 'contentinfo', 'complementary', 'search', 'region',
  'button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'checkbox', 'radio', 'textbox', 'combobox', 'listbox', 'option',
  'progressbar', 'status', 'alert', 'log', 'marquee', 'timer',
  'tooltip', 'presentation', 'none', 'img', 'separator',
]);

/**
 * Total count of interactive elements.
 * Used to detect when new controls (forms, toolbars) appear after an interaction.
 */
function computeInteractiveCount(summary: DomSummary): number {
  const { elementCounts, ariaRoleCounts } = summary;
  const ariaButtons  = ariaRoleCounts['button'] ?? 0;
  const ariaTabs     = ariaRoleCounts['tab']    ?? 0;
  const ariaMenuItems = ariaRoleCounts['menuitem'] ?? 0;
  return elementCounts.buttons + elementCounts.inputs + ariaButtons + ariaTabs + ariaMenuItems;
}

/**
 * Deterministic composite identity hash for a full FunctionalFingerprint.
 *
 * Uses sorted JSON keys so object property insertion order cannot affect
 * the output hash.
 */
function computeCompositeHash(
  stableTextHash:       string,
  headingStructureHash: string,
  widgetCounts:         Record<WidgetType, number>,
  interactiveCount:     number,
): string {
  // Sort keys so insertion order never affects the hash
  const widgetStr = JSON.stringify(widgetCounts, Object.keys(widgetCounts).sort() as WidgetType[]);
  const parts = [stableTextHash, headingStructureHash, widgetStr, String(interactiveCount)];
  return sha256(parts.join('|'));
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
