// ─────────────────────────────────────────────────────────────────────────────
// InteractionDetector — three-pass target detection orchestrator
//
// Produces a sorted, deduplicated InteractionTarget[] for any loaded page.
//
// Pass 1 — ARIA detection     (high confidence, passive, no clicks)
//   Tabs:      [role="tab"] inside [role="tablist"]
//   Accordions: button[aria-expanded], <details>/<summary>
//   Toggles:   elements with aria-controls pointing to a hidden panel
//
// Pass 2 — Structural detection  (medium confidence, passive, no clicks)
//   <details>/<summary> elements not already caught by Pass 1
//   (Currently minimal — further structural patterns added in Phase 2)
//
// Pass 3 — Visual detection  (lower confidence, passive, no clicks)
//   Delegates to VisualGroupDetector.
//   Skips groups already detected in Passes 1+2.
//
// Deduplication: if a target selector appears in multiple passes, the
// highest-confidence version is kept (aria > structural > visual).
//
// Sorting: by estimatedPriority DESC.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'crypto';
import type { Page } from 'playwright';
import type { InteractionTarget } from './types';
import { VisualGroupDetector } from './VisualGroupDetector';

// ── Public API ────────────────────────────────────────────────────────────────

export interface DetectionOptions {
  /** Run Pass 3 visual detection.  Default: true. */
  visualDetection?:  boolean;
  /** Maximum visual candidate groups per page.  Default: 5. */
  maxVisualGroups?:  number;
}

export class InteractionDetector {
  private readonly visualDetector = new VisualGroupDetector();

  async detect(page: Page, options: DetectionOptions = {}): Promise<InteractionTarget[]> {
    const { visualDetection = true, maxVisualGroups = 5 } = options;

    // Pass 1 — ARIA
    const ariaTargets = await this.detectAria(page);

    // Pass 2 — Structural
    const structuralTargets = await this.detectStructural(page);

    // Pass 3 — Visual (skip groups already found by Passes 1+2)
    let visualTargets: InteractionTarget[] = [];
    if (visualDetection) {
      const knownGroupIds = new Set(
        [...ariaTargets, ...structuralTargets]
          .map(t => t.groupId)
          .filter((id): id is string => id !== null),
      );
      visualTargets = await this.visualDetector.scan(page, knownGroupIds, maxVisualGroups);
    }

    // Merge, deduplicate, sort
    return this.mergeAndSort([...ariaTargets, ...structuralTargets, ...visualTargets]);
  }

  // ── Pass 1 — ARIA ───────────────────────────────────────────────────────────

  private async detectAria(page: Page): Promise<InteractionTarget[]> {
    const raw = await page.evaluate((): RawTarget[] => {

      // ── Stable selector builder ─────────────────────────────────────────────
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
        const idx = siblings.indexOf(el) + 1;
        const parentSel = stableSelector(parent, depth + 1);
        const role = el.getAttribute('role');
        if (role) return `${parentSel} > [role="${role}"]:nth-child(${idx})`;
        return `${parentSel} > ${el.tagName.toLowerCase()}:nth-child(${idx})`;
      }

      function parentSelector(el: Element): string {
        const p = el.parentElement;
        return p ? stableSelector(p) : 'body';
      }

      function sha256simple(s: string): string {
        // Simple deterministic hash for groupId (not cryptographic, just stable)
        let hash = 0;
        for (let i = 0; i < s.length; i++) {
          hash = ((hash << 5) - hash) + s.charCodeAt(i);
          hash |= 0;
        }
        return 'grp-' + Math.abs(hash).toString(16).padStart(8, '0');
      }

      const targets: RawTarget[] = [];

      // ── Sub-routine A: Tab triggers ─────────────────────────────────────────
      const tablists = Array.from(document.querySelectorAll('[role="tablist"]'));
      for (const tablist of tablists) {
        const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
        const groupId = sha256simple(stableSelector(tablist));
        for (const tab of tabs) {
          const isSelected = tab.getAttribute('aria-selected') === 'true';
          const text = (tab.textContent ?? '').trim().slice(0, 80);
          targets.push({
            cssSelector:      stableSelector(tab),
            parentSelector:   parentSelector(tab),
            interactionClass: 'TAB_TRIGGER',
            ariaRole:         'tab',
            ariaExpanded:     null,
            ariaControls:     tab.getAttribute('aria-controls'),
            groupId,
            isActiveInGroup:  isSelected,
            humanReadableHint: text || `tab ${tabs.indexOf(tab) + 1} of ${tabs.length}`,
            estimatedPriority: isSelected ? 0.12 : 0.90,
          });
        }
      }

      // ── Sub-routine B: Accordion headers ───────────────────────────────────
      const expandBtns = Array.from(
        document.querySelectorAll('button[aria-expanded], [role="button"][aria-expanded]'),
      );
      for (const btn of expandBtns) {
        const isExpanded = btn.getAttribute('aria-expanded') === 'true';
        const text = (btn.textContent ?? '').trim().slice(0, 80);
        targets.push({
          cssSelector:      stableSelector(btn),
          parentSelector:   parentSelector(btn),
          interactionClass: 'ACCORDION_HEADER',
          ariaRole:         btn.getAttribute('role') ?? btn.tagName.toLowerCase(),
          ariaExpanded:     isExpanded,
          ariaControls:     btn.getAttribute('aria-controls'),
          groupId:          sha256simple(parentSelector(btn)),
          isActiveInGroup:  false,
          humanReadableHint: text || 'accordion header',
          estimatedPriority: isExpanded ? 0.40 : 0.75,
        });
      }

      // ── Sub-routine C: <details>/<summary> ─────────────────────────────────
      const summaries = Array.from(document.querySelectorAll('details > summary'));
      for (const summary of summaries) {
        const details = summary.parentElement as HTMLDetailsElement;
        const isOpen  = details?.open ?? false;
        const text    = (summary.textContent ?? '').trim().slice(0, 80);
        targets.push({
          cssSelector:       stableSelector(summary),
          parentSelector:    parentSelector(summary),
          interactionClass:  'ACCORDION_HEADER',
          ariaRole:          'summary',
          ariaExpanded:      isOpen,
          ariaControls:      null,
          groupId:           sha256simple(parentSelector(summary)),
          isActiveInGroup:   false,
          humanReadableHint: text || 'collapsible section',
          estimatedPriority: isOpen ? 0.40 : 0.75,
        });
      }

      // ── Sub-routine D: Expand toggles (aria-controls + hidden panel) ────────
      const allWithControls = Array.from(
        document.querySelectorAll('[aria-controls]:not([aria-expanded])'),
      );
      for (const el of allWithControls) {
        const controlledId = el.getAttribute('aria-controls');
        if (!controlledId) continue;
        const controlled = document.getElementById(controlledId);
        if (!controlled) continue;

        const isHidden =
          controlled.hidden ||
          (controlled as HTMLElement).offsetHeight === 0 ||
          window.getComputedStyle(controlled).display === 'none';

        if (!isHidden) continue;

        const text = (el.textContent ?? '').trim().slice(0, 80);
        targets.push({
          cssSelector:       stableSelector(el),
          parentSelector:    parentSelector(el),
          interactionClass:  'EXPAND_TOGGLE',
          ariaRole:          el.getAttribute('role'),
          ariaExpanded:      false,
          ariaControls:      controlledId,
          groupId:           sha256simple(parentSelector(el)),
          isActiveInGroup:   false,
          humanReadableHint: text || 'expandable section',
          estimatedPriority: 0.65,
        });
      }

      return targets;
    }).catch(() => [] as RawTarget[]);

    return this.enrichAriaTargets(raw);
  }

  /**
   * Post-process raw ARIA targets:
   * Set groupActiveMemberSelector for each TAB_TRIGGER group.
   */
  private enrichAriaTargets(raw: RawTarget[]): InteractionTarget[] {
    // Build a map from groupId → active member selector
    const activeByGroup = new Map<string, string>();
    for (const t of raw) {
      if (t.interactionClass === 'TAB_TRIGGER' && t.isActiveInGroup && t.groupId) {
        activeByGroup.set(t.groupId, t.cssSelector);
      }
    }

    return raw.map(t => ({
      id:                        sha256(t.cssSelector),
      cssSelector:               t.cssSelector,
      ariaRole:                  t.ariaRole,
      ariaExpanded:              t.ariaExpanded,
      ariaControls:              t.ariaControls,
      boundingRect:              null,
      interactionClass:          t.interactionClass,
      detectionMethod:           'aria' as const,
      groupId:                   t.groupId,
      groupActiveMemberSelector: t.groupId
        ? (activeByGroup.get(t.groupId) ?? null)
        : null,
      humanReadableHint:         t.humanReadableHint,
      estimatedPriority:         t.estimatedPriority,
    }));
  }

  // ── Pass 2 — Structural ─────────────────────────────────────────────────────

  private async detectStructural(page: Page): Promise<InteractionTarget[]> {
    // For the MVID, <details>/<summary> is handled in Pass 1.
    // Pass 2 is reserved for future structural patterns (Phase 2 of the full engine).
    // Return empty array to keep the architecture extensible without dead code.
    void page;
    return [];
  }

  // ── Merge + sort ─────────────────────────────────────────────────────────────

  private mergeAndSort(all: InteractionTarget[]): InteractionTarget[] {
    const CONFIDENCE_RANK: Record<string, number> = {
      aria:       3,
      structural: 2,
      visual:     1,
    };

    // Deduplicate by cssSelector — keep highest-confidence version
    const bySelector = new Map<string, InteractionTarget>();
    for (const t of all) {
      const existing = bySelector.get(t.cssSelector);
      if (!existing) {
        bySelector.set(t.cssSelector, t);
      } else {
        const existingRank = CONFIDENCE_RANK[existing.detectionMethod] ?? 0;
        const newRank      = CONFIDENCE_RANK[t.detectionMethod]       ?? 0;
        if (newRank > existingRank) {
          bySelector.set(t.cssSelector, t);
        }
      }
    }

    return [...bySelector.values()].sort((a, b) => b.estimatedPriority - a.estimatedPriority);
  }
}

// ── Internal types ────────────────────────────────────────────────────────────

interface RawTarget {
  cssSelector:       string;
  parentSelector:    string;
  interactionClass:  InteractionTarget['interactionClass'];
  ariaRole:          string | null;
  ariaExpanded:      boolean | null;
  ariaControls:      string | null;
  groupId:           string | null;
  isActiveInGroup:   boolean;
  humanReadableHint: string;
  estimatedPriority: number;
}

// ── Module-level helpers ──────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
