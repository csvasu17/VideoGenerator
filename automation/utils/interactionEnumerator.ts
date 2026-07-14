/**
 * interactionEnumerator.ts — exhaustive, Playwright-actionable element discovery
 * for the Agent Recording engine.
 *
 * Neither existing tool covers the full surface needed here:
 *   - DiscoveryAgent.extractInteractiveElements() is page-level, reporting-only, and
 *     has a real bug — it builds a `[data-discovery-index="N"]` selector but never
 *     writes that attribute onto the live DOM, so the selector never actually resolves
 *     to anything if reused for a real page.click(). This module avoids that bug by
 *     stamping the attribute in the SAME synchronous page.evaluate() pass that queries
 *     for the element, guaranteeing the returned selector is real.
 *   - fieldExtractor.ts only covers form fields/tables, not buttons/links/tabs.
 *   - MVID (InteractionDetector) only covers safe reveal-widgets (tabs/accordions) and
 *     already returns real, actionable selectors — this module calls into it and merges
 *     its results rather than reimplementing tab/accordion heuristics.
 */

import type { Page } from 'playwright';
import { InteractionDetector } from '../../src/agents/discovery/interaction/InteractionDetector';
import type { FieldOption } from '../../src/core/domain/entities/PageFieldMap';

export type EnumeratedElementKind =
  | 'button' | 'link' | 'input' | 'select' | 'textarea'
  | 'checkbox' | 'radio' | 'tab' | 'menu-item' | 'toggle';

export interface BoundingRect { x: number; y: number; width: number; height: number; }

export interface EnumeratedElement {
  id:              string;
  selector:        string;
  kind:            EnumeratedElementKind;
  tag:             string;
  text?:           string;
  ariaLabel?:      string;
  title?:          string;
  href?:           string;
  sameOrigin?:     boolean;
  inputType?:      string;
  options?:        FieldOption[];
  optionsTruncated?: boolean;
  required?:       boolean;
  disabled:        boolean;
  visible:         boolean;
  insideForm:      boolean;
  formFieldCount:  number;
  boundingRect?:   BoundingRect;
  provenance:      'dom-scan' | 'mvid';
  interactionClass?: string;
}

const DEFAULT_MAX_ELEMENTS = 150;
const MAX_SELECT_OPTIONS    = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Raw shape returned from the browser context
// ─────────────────────────────────────────────────────────────────────────────

interface RawScanElement {
  index:           number;
  tag:             string;
  role?:           string;
  text?:           string;
  ariaLabel?:      string;
  title?:          string;
  href?:           string;
  sameOrigin?:     boolean;
  inputType?:      string;
  options?:        { value: string; label: string }[];
  optionsTruncated?: boolean;
  required?:       boolean;
  disabled:        boolean;
  visible:         boolean;
  insideForm:      boolean;
  formFieldCount:  number;
  rect?:           BoundingRect;
}

function kindFor(tag: string, role: string | undefined, inputType: string | undefined): EnumeratedElementKind {
  if (tag === 'a') return 'link';
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'textarea';
  if (tag === 'input') {
    if (inputType === 'checkbox') return 'checkbox';
    if (inputType === 'radio') return 'radio';
    if (inputType === 'submit' || inputType === 'button') return 'button';
    return 'input';
  }
  if (role === 'tab') return 'tab';
  if (role === 'menuitem') return 'menu-item';
  return 'button';
}

function mvidClassToKind(cls: string): EnumeratedElementKind {
  if (cls === 'TAB_TRIGGER' || cls === 'VISUAL_TAB_CANDIDATE') return 'tab';
  return 'toggle'; // ACCORDION_HEADER | EXPAND_TOGGLE
}

/** Center-point-inside-rect overlap test — cheap and good enough for cross-pass dedup. */
function rectsOverlap(a: BoundingRect, b: BoundingRect): boolean {
  const aCx = a.x + a.width / 2;
  const aCy = a.y + a.height / 2;
  const bCx = b.x + b.width / 2;
  const bCy = b.y + b.height / 2;
  const insideB = aCx >= b.x && aCx <= b.x + b.width && aCy >= b.y && aCy <= b.y + b.height;
  const insideA = bCx >= a.x && bCx <= a.x + a.width && bCy >= a.y && bCy <= a.y + a.height;
  return insideA || insideB;
}

export interface EnumerateOptions {
  maxElements?: number;
  /** Skip the MVID reveal-widget merge pass (e.g. for a quick re-scan mid-page). */
  skipMvid?: boolean;
}

export async function enumerateInteractiveElements(
  page:   Page,
  opts?:  EnumerateOptions,
): Promise<{ elements: EnumeratedElement[]; truncated: boolean }> {
  const maxElements = opts?.maxElements ?? DEFAULT_MAX_ELEMENTS;

  // ── Pass 1: MVID reveal-widget detection (real, actionable selectors already) ──
  const mvidElements: EnumeratedElement[] = [];
  if (!opts?.skipMvid) {
    try {
      const targets = await new InteractionDetector().detect(page, { visualDetection: true, maxVisualGroups: 5 });
      for (const t of targets) {
        mvidElements.push({
          id:              t.id,
          selector:        t.cssSelector,
          kind:            mvidClassToKind(t.interactionClass),
          tag:             '(mvid)',
          disabled:        false,
          visible:         !!t.boundingRect,
          insideForm:      false,
          formFieldCount:  0,
          boundingRect:    t.boundingRect ?? undefined,
          provenance:      'mvid',
          interactionClass: t.interactionClass,
        });
      }
    } catch { /* MVID is best-effort — a failure here shouldn't block the DOM scan */ }
  }

  // ── Pass 2: exhaustive DOM scan, stamping a REAL selector onto each live node ──
  const raw: RawScanElement[] = await page.evaluate((maxOptions: number): RawScanElement[] => {
    const SELECTOR = [
      'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
      '[role="button"]', '[role="menuitem"]', '[role="tab"]', '[tabindex]',
      'details > summary',
    ].join(', ');

    const origin = window.location.origin;
    const seen = new Set<Element>();
    const els = Array.from(document.querySelectorAll(SELECTOR)).filter(el => {
      if (seen.has(el)) return false;
      seen.add(el);
      return true;
    });

    function isVisible(el: Element): boolean {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    // Same 6-tier label resolution as fieldExtractor.ts, duplicated inline —
    // Playwright evaluate callbacks can't import external modules.
    function resolveText(el: Element): string {
      const direct = (el.textContent ?? '').trim();
      if (direct) return direct.slice(0, 120);

      const id = el.getAttribute('id');
      if (id) {
        try {
          const forLabel = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          const t = forLabel?.textContent?.trim();
          if (t) return t.slice(0, 120);
        } catch { /* invalid id for CSS.escape */ }
      }
      const wrapping = el.closest('label');
      if (wrapping) {
        const clone = wrapping.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('input,select,textarea').forEach(n => n.remove());
        const t = clone.textContent?.trim();
        if (t) return t.slice(0, 120);
      }
      const ariaLabelledBy = el.getAttribute('aria-labelledby');
      if (ariaLabelledBy) {
        const parts = ariaLabelledBy.split(/\s+/)
          .map(refId => document.getElementById(refId)?.textContent?.trim())
          .filter((t): t is string => !!t);
        if (parts.length > 0) return parts.join(' ').slice(0, 120);
      }
      const ariaLabel = el.getAttribute('aria-label')?.trim();
      if (ariaLabel) return ariaLabel.slice(0, 120);
      const placeholder = (el as HTMLInputElement).placeholder?.trim();
      if (placeholder) return placeholder.slice(0, 120);
      return '';
    }

    return els.map((el, i) => {
      el.setAttribute('data-agent-el-id', String(i));

      const tag  = el.tagName.toLowerCase();
      const role = el.getAttribute('role') ?? undefined;
      const text = resolveText(el);
      const ariaLabel = el.getAttribute('aria-label') ?? undefined;
      const title = el.getAttribute('title') ?? undefined;

      let href: string | undefined;
      let sameOrigin: boolean | undefined;
      if (tag === 'a') {
        href = (el as HTMLAnchorElement).href || undefined;
        if (href) {
          try { sameOrigin = new URL(href).origin === origin; } catch { sameOrigin = false; }
        }
      }

      let inputType: string | undefined;
      let options: { value: string; label: string }[] | undefined;
      let optionsTruncated: boolean | undefined;
      let required: boolean | undefined;
      if (tag === 'input') inputType = (el as HTMLInputElement).type || 'text';
      if (tag === 'button') inputType = (el as HTMLButtonElement).type || undefined;
      if (tag === 'select') {
        const opts = Array.from((el as HTMLSelectElement).options);
        options = opts.slice(0, maxOptions).map(o => ({ value: o.value, label: o.textContent?.trim() || o.value }));
        optionsTruncated = opts.length > maxOptions;
      }
      if (tag === 'input' || tag === 'select' || tag === 'textarea') {
        required = (el as HTMLInputElement).required || undefined;
      }

      const form = el.closest('form');
      const insideForm = !!form;
      const formFieldCount = form
        ? form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea').length
        : 0;

      const disabled = (el as HTMLInputElement).disabled === true || el.getAttribute('aria-disabled') === 'true';
      const visible = isVisible(el);
      const r = el.getBoundingClientRect();

      return {
        index: i, tag, role, text: text || undefined, ariaLabel, title, href, sameOrigin,
        inputType, options, optionsTruncated, required, disabled, visible, insideForm, formFieldCount,
        rect: visible ? { x: r.x, y: r.y, width: r.width, height: r.height } : undefined,
      };
    });
  }, MAX_SELECT_OPTIONS);

  // ── Merge: skip DOM-scan elements whose rect overlaps an already-found MVID target ──
  const domElements: EnumeratedElement[] = [];
  for (const r of raw) {
    if (r.rect && mvidElements.some(m => m.boundingRect && rectsOverlap(m.boundingRect, r.rect!))) {
      continue; // already covered by MVID's own actionable selector
    }
    domElements.push({
      id:              `dom-${r.index}`,
      selector:        `[data-agent-el-id="${r.index}"]`,
      kind:            kindFor(r.tag, r.role, r.inputType),
      tag:             r.tag,
      text:            r.text,
      ariaLabel:       r.ariaLabel,
      title:           r.title,
      href:            r.href,
      sameOrigin:      r.sameOrigin,
      inputType:       r.inputType,
      options:         r.options,
      optionsTruncated: r.optionsTruncated,
      required:        r.required,
      disabled:        r.disabled,
      visible:         r.visible,
      insideForm:      r.insideForm,
      formFieldCount:  r.formFieldCount,
      boundingRect:    r.rect,
      provenance:      'dom-scan',
    });
  }

  const merged = [...mvidElements, ...domElements].filter(e => !e.disabled && e.visible !== false);
  const truncated = merged.length > maxElements;
  return { elements: merged.slice(0, maxElements), truncated };
}
