// ─────────────────────────────────────────────────────────────────────────────
// DomSummaryAdapter
//
// Pure function — zero side-effects, zero I/O.
//
// MVID captures page state as DomSummary (lean structural summary).
// VisionAnalysisAgent expects PageCapture.dom: DOMSnapshot (richer DOM type).
//
// This adapter bridges the two shapes so InPageDiscoveryStage can hand
// discovered interaction states to VisionAnalysisAgent without modifying
// either agent.
//
// Mapping notes:
//   html         → '' (not available in DomSummary; VisionAnalysisAgent
//                       falls back to headings + textContent, which are set)
//   links        → [] (not tracked in DomSummary)
//   imageCount   → 0  (not tracked in DomSummary)
//   ariaLandmarks → landmark roles extracted from DomSummary.ariaRoleCounts
// ─────────────────────────────────────────────────────────────────────────────

import type { DomSummary }    from './types';
import type { DOMSnapshot }  from '../../../core/domain/entities/PageCapture';

// ── ARIA landmark role set ────────────────────────────────────────────────────

/**
 * Standard ARIA landmark roles defined in WAI-ARIA 1.2.
 * Used to extract landmark regions from DomSummary.ariaRoleCounts.
 */
const ARIA_LANDMARK_ROLES = new Set<string>([
  'banner',
  'complementary',
  'contentinfo',
  'form',
  'main',
  'navigation',
  'region',
  'search',
  // Common implicit landmarks via element type (included for broader coverage)
  'aside',
  'footer',
  'header',
  'nav',
]);

// ── Adapter ───────────────────────────────────────────────────────────────────

/**
 * Convert a MVID DomSummary into a DOMSnapshot suitable for VisionAnalysisAgent.
 *
 * @param summary  DomSummary captured by StateCapture during in-page exploration.
 * @param url      The page URL at the time of capture (state.pageUrl).
 * @param title    The base page's title (from DiscoveredPage.title).
 */
export function adaptDomSummaryToDOMSnapshot(
  summary: DomSummary,
  url:     string,
  title:   string,
): DOMSnapshot {
  return {
    // ── Not available in DomSummary ─────────────────────────────────────────
    html:        '',     // VisionAnalysisAgent trims DOM: headings first, text second, html last
    links:       [],
    imageCount:  0,

    // ── Direct mappings ──────────────────────────────────────────────────────
    title,
    url,
    textContent: summary.visibleTextTokens.join(' '),
    headings:    summary.headings.map(h => h.text),
    formCount:   summary.elementCounts.forms,
    inputCount:  summary.elementCounts.inputs,
    buttonCount: summary.elementCounts.buttons,

    // ── Landmark extraction ──────────────────────────────────────────────────
    ariaLandmarks: Object.keys(summary.ariaRoleCounts)
      .filter(role => ARIA_LANDMARK_ROLES.has(role)),
  };
}
