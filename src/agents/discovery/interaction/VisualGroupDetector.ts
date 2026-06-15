// ─────────────────────────────────────────────────────────────────────────────
// VisualGroupDetector — passive visual-based tab-group detection
//
// Detects groups of sibling clickable elements where one member appears
// visually "selected" compared to the others — a common pattern in modern
// SaaS applications built with React + Tailwind, Angular Material, or
// proprietary component libraries that ship without ARIA markup.
//
// Architecture:
//   Phase A — findClickableCandidates()    passive DOM scan, single page.evaluate()
//   Phase B — groupBySpatialProximity()    pure geometry, no browser calls
//   Phase C — scoreVisualDifferentiation() pure style analysis via analyzeStyleSignatures()
//
// The detector is entirely PASSIVE — it never clicks anything.
// Validation happens in InPageDiscovery when the exploration loop clicks
// each VISUAL_TAB_CANDIDATE and StateComparator decides if the result is
// meaningful.  False positives are discarded at that point at zero extra cost.
//
// analyzeStyleSignatures() is exported so it can be unit-tested without
// a browser.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'crypto';
import type { Page } from 'playwright';
import type {
  ElementStyleSignature,
  InteractionTarget,
  VisualCandidateGroup,
  Rect,
} from './types';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum visual differentiation score to produce InteractionTargets. */
const DIFFERENTIATION_THRESHOLD = 0.30;

/** Estimated priority scores for visual candidates. */
const PRIORITY_HIGH   = 0.55;   // differentiationScore >= 0.60
const PRIORITY_LOW    = 0.45;   // differentiationScore 0.30–0.59
const PRIORITY_ACTIVE = 0.12;   // the active/reset-only member

/** Computed-style property weights for outlier scoring. */
const PROPERTY_WEIGHTS: Record<keyof Omit<ElementStyleSignature, 'selector'>, number> = {
  backgroundColor:   0.40,
  borderBottomColor: 0.30,
  borderBottomWidth: 0.25,
  color:             0.20,
  fontWeight:        0.18,
  boxShadow:         0.10,
  opacity:           0.05,
};

// ── Exported pure function ────────────────────────────────────────────────────

export interface StyleAnalysisResult {
  /** 0–1 score reflecting how distinctly one member differs from all others. */
  differentiationScore: number;
  /** Index into the signatures array of the "active" / selected member.  null if rejected. */
  activeMemberIndex:    number | null;
}

/**
 * Analyse an array of ElementStyleSignature objects to find the "active" outlier.
 *
 * Pure function — no Playwright, no I/O.
 * Exported so unit tests can exercise the differentiation logic without a browser.
 *
 * Algorithm:
 *   For each style property, if EXACTLY ONE element has a distinct value → that
 *   element scores the property's weight as "outlier" points.
 *   The element with the highest total outlier score is the active member.
 *
 * Edge cases:
 *   • 2+ elements share a unique value → no single outlier → differentiationScore 0
 *   • All elements identical → differentiationScore 0
 *   • Transparent / rgba(0,0,0,0) normalised before comparison
 */
export function analyzeStyleSignatures(
  signatures: ElementStyleSignature[],
): StyleAnalysisResult {
  if (signatures.length < 2) {
    return { differentiationScore: 0, activeMemberIndex: null };
  }

  const outlierScores = new Array<number>(signatures.length).fill(0);
  const properties = Object.keys(PROPERTY_WEIGHTS) as (keyof typeof PROPERTY_WEIGHTS)[];

  for (const prop of properties) {
    const values = signatures.map(s => normalizeColor(s[prop]));

    // Count occurrences of each value
    const valueCounts = new Map<string, number>();
    for (const v of values) {
      valueCounts.set(v, (valueCounts.get(v) ?? 0) + 1);
    }

    // Find indices with a unique value (count === 1)
    const uniqueHolders: number[] = [];
    values.forEach((v, i) => {
      if (valueCounts.get(v) === 1) uniqueHolders.push(i);
    });

    // Only score when EXACTLY ONE element holds the unique value
    if (uniqueHolders.length === 1) {
      outlierScores[uniqueHolders[0]] += PROPERTY_WEIGHTS[prop];
    }
  }

  const maxScore = Math.max(...outlierScores);
  if (maxScore <= 0) {
    return { differentiationScore: 0, activeMemberIndex: null };
  }

  const activeMemberIndex = outlierScores.indexOf(maxScore);
  return {
    differentiationScore: Math.min(1.0, maxScore),
    activeMemberIndex,
  };
}

// ── Class ─────────────────────────────────────────────────────────────────────

export class VisualGroupDetector {

  /**
   * Scan the page for visual tab-like groups and return InteractionTargets
   * for the inactive members of each confirmed group.
   *
   * @param page            Playwright page — must already be loaded.
   * @param excludeGroupIds Group IDs already discovered by ARIA/structural passes.
   * @param maxGroups       Maximum groups to process (performance cap).
   */
  async scan(
    page:            Page,
    excludeGroupIds: ReadonlySet<string>,
    maxGroups        = 5,
  ): Promise<InteractionTarget[]> {

    // Phase A — find clickable candidate elements
    const rawCandidates = await this.findClickableCandidates(page);
    if (rawCandidates.length === 0) return [];

    // Phase B — group by spatial proximity
    const groups = this.groupBySpatialProximity(rawCandidates, excludeGroupIds, maxGroups);
    if (groups.length === 0) return [];

    // Phase C — score visual differentiation for each group
    const confirmed: VisualCandidateGroup[] = [];
    for (const group of groups) {
      const signatures = await this.extractStyleSignatures(page, group.memberSelectors);
      if (signatures.length < 2) continue;

      const { differentiationScore, activeMemberIndex } = analyzeStyleSignatures(signatures);
      if (differentiationScore < DIFFERENTIATION_THRESHOLD || activeMemberIndex === null) continue;

      confirmed.push({
        groupId:                 group.groupId,
        layout:                  group.layout,
        activeMemberSelector:    signatures[activeMemberIndex].selector,
        inactiveMemberSelectors: signatures
          .filter((_, i) => i !== activeMemberIndex)
          .map(s => s.selector),
        differentiationScore,
        memberCount:             signatures.length,
      });
    }

    return this.buildTargets(confirmed);
  }

  // ── Phase A ─────────────────────────────────────────────────────────────────

  private async findClickableCandidates(page: Page): Promise<RawCandidate[]> {
    return page.evaluate((): RawCandidate[] => {
      // Build a stable CSS selector for an element (max 3 ancestor levels)
      function stableSelector(el: Element, depth = 0): string {
        if (depth > 3) return el.tagName.toLowerCase();

        const id = el.getAttribute('id');
        if (id && !/^\d+$/.test(id) && !/\s/.test(id)) {
          return '#' + CSS.escape(id);
        }
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel && ariaLabel.length < 60) {
          return `[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`;
        }
        const parent = el.parentElement;
        if (!parent) return el.tagName.toLowerCase();
        const siblings = Array.from(parent.children);
        const index = siblings.indexOf(el) + 1;
        const parentSel = stableSelector(parent, depth + 1);
        const role = el.getAttribute('role');
        if (role) return `${parentSel} > [role="${role}"]:nth-child(${index})`;
        return `${parentSel} > ${el.tagName.toLowerCase()}:nth-child(${index})`;
      }

      function stableSelectorForParent(el: Element): string {
        return stableSelector(el, 0);
      }

      const all = Array.from(document.querySelectorAll('*'));
      const candidates: RawCandidate[] = [];

      for (const el of all) {
        if (candidates.length >= 200) break;

        // Skip if it has ARIA tab/expanded semantics (handled by ARIA pass)
        if (el.getAttribute('role') === 'tab') continue;
        if (el.getAttribute('role') === 'menuitem') continue;
        if (el.getAttribute('aria-expanded') !== null) continue;

        const tag = el.tagName.toLowerCase();
        const cs  = window.getComputedStyle(el);

        const isButton  = tag === 'button' || el.getAttribute('role') === 'button';
        const isLink    = tag === 'a' && (!(el as HTMLAnchorElement).href || (el as HTMLAnchorElement).href.startsWith('#'));
        const isPointer = cs.cursor === 'pointer';

        if (!isButton && !isLink && !isPointer) continue;

        // Visibility
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if ((el as HTMLElement).offsetParent === null && cs.position !== 'fixed') continue;

        const rect = el.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 15) continue;
        if (rect.width > 500 || rect.height > 100) continue;

        // Leaf-like: at most 2 levels of children
        const childDepth = el.querySelector('* > * > *');
        if (childDepth) continue;

        const parent = el.parentElement;
        if (!parent) continue;

        candidates.push({
          selector:       stableSelector(el),
          parentSelector: stableSelectorForParent(parent),
          rect:           { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          tag,
        });
      }

      return candidates;
    }).catch(() => []);
  }

  // ── Phase B ─────────────────────────────────────────────────────────────────

  private groupBySpatialProximity(
    candidates:      RawCandidate[],
    excludeGroupIds: ReadonlySet<string>,
    maxGroups:       number,
  ): CandidateGroup[] {

    // Group by parentSelector (most reliable grouping signal)
    const byParent = new Map<string, RawCandidate[]>();
    for (const c of candidates) {
      const list = byParent.get(c.parentSelector) ?? [];
      list.push(c);
      byParent.set(c.parentSelector, list);
    }

    const groups: CandidateGroup[] = [];

    for (const [parentSel, members] of byParent) {
      if (groups.length >= maxGroups) break;
      if (members.length < 2 || members.length > 8) continue;

      const groupId = sha256(parentSel);
      if (excludeGroupIds.has(groupId)) continue;

      // Determine layout
      const tops   = members.map(m => m.rect.y);
      const lefts  = members.map(m => m.rect.x);
      const maxTopDiff  = Math.max(...tops)  - Math.min(...tops);
      const maxLeftDiff = Math.max(...lefts) - Math.min(...lefts);

      let layout: 'horizontal' | 'vertical' | null = null;
      if (maxTopDiff < 15) layout = 'horizontal';
      else if (maxLeftDiff < 20) layout = 'vertical';
      if (!layout) continue;

      // Height consistency check
      const heights = members.map(m => m.rect.height);
      const medianH = median(heights);
      if (heights.some(h => h > medianH * 1.5 || h < medianH * 0.5)) continue;

      groups.push({
        groupId,
        layout,
        memberSelectors: members.map(m => m.selector),
      });
    }

    return groups;
  }

  // ── Phase C helper ───────────────────────────────────────────────────────────

  private async extractStyleSignatures(
    page:      Page,
    selectors: string[],
  ): Promise<ElementStyleSignature[]> {
    return page.evaluate(
      (sels: string[]): ElementStyleSignature[] => {

        function normalizeColor(c: string): string {
          if (!c || c === 'transparent') return 'rgba(0,0,0,0)';
          // Collapse rgba(r,g,b,1) → rgb(r,g,b) for normalised comparison
          return c.replace(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*1\)/, 'rgb($1,$2,$3)');
        }

        const results: ElementStyleSignature[] = [];
        for (const sel of sels) {
          const el = document.querySelector(sel);
          if (!el) continue;
          const cs = window.getComputedStyle(el);
          results.push({
            selector:          sel,
            backgroundColor:   normalizeColor(cs.backgroundColor),
            borderBottomColor: normalizeColor(cs.borderBottomColor),
            borderBottomWidth: cs.borderBottomWidth,
            color:             normalizeColor(cs.color),
            fontWeight:        cs.fontWeight,
            boxShadow:         cs.boxShadow,
            opacity:           cs.opacity,
          });
        }
        return results;
      },
      selectors,
    ).catch(() => []);
  }

  // ── Target assembly ──────────────────────────────────────────────────────────

  private buildTargets(groups: VisualCandidateGroup[]): InteractionTarget[] {
    const targets: InteractionTarget[] = [];

    for (const group of groups) {
      const priority = group.differentiationScore >= 0.60 ? PRIORITY_HIGH : PRIORITY_LOW;

      // Inactive members — the ones to explore
      for (let i = 0; i < group.inactiveMemberSelectors.length; i++) {
        const sel = group.inactiveMemberSelectors[i];
        targets.push({
          id:                        sha256(sel),
          cssSelector:               sel,
          ariaRole:                  null,
          ariaExpanded:              null,
          ariaControls:              null,
          boundingRect:              null,   // enriched later if needed
          interactionClass:          'VISUAL_TAB_CANDIDATE',
          detectionMethod:           'visual',
          groupId:                   group.groupId,
          groupActiveMemberSelector: group.activeMemberSelector,
          humanReadableHint:         `visual group member ${i + 2} of ${group.memberCount} (${group.layout})`,
          estimatedPriority:         priority,
        });
      }

      // Active member — kept at low priority for reset purposes only
      targets.push({
        id:                        sha256(group.activeMemberSelector),
        cssSelector:               group.activeMemberSelector,
        ariaRole:                  null,
        ariaExpanded:              null,
        ariaControls:              null,
        boundingRect:              null,
        interactionClass:          'VISUAL_TAB_CANDIDATE',
        detectionMethod:           'visual',
        groupId:                   group.groupId,
        groupActiveMemberSelector: group.activeMemberSelector,
        humanReadableHint:         `visual group active member 1 of ${group.memberCount} (${group.layout})`,
        estimatedPriority:         PRIORITY_ACTIVE,
      });
    }

    return targets;
  }
}

// ── Internal types ────────────────────────────────────────────────────────────

interface RawCandidate {
  selector:       string;
  parentSelector: string;
  rect:           Rect;
  tag:            string;
}

interface CandidateGroup {
  groupId:         string;
  layout:          'horizontal' | 'vertical';
  memberSelectors: string[];
}

// ── Module-level helpers ──────────────────────────────────────────────────────

function normalizeColor(c: string): string {
  if (!c || c === 'transparent') return 'rgba(0,0,0,0)';
  return c.replace(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*1\)/, 'rgb($1,$2,$3)');
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
