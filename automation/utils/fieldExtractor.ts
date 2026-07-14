/**
 * fieldExtractor — DOM field/table extraction for the app_flow template.
 *
 * Walks the currently-loaded page for form fields (inputs/selects/textareas
 * with a resolved human-readable label) and <table> column headers. Runs
 * entirely inside the page context via page.evaluate — no Node-side DOM
 * parsing, no dependency on DiscoveryAgent internals.
 *
 * Never serializes actual table row/cell values or select option lists
 * beyond a small cap — only structural metadata (labels, types, column
 * headers, a sampled row count).
 */

import type { Page } from 'playwright';
import type {
  PageFieldData,
  FormFieldData,
  FieldLabelSource,
  FieldOption,
  TableColumnData,
} from '../../src/core/domain/entities/PageFieldMap';

const MAX_SELECT_OPTIONS   = 50;
const MAX_TABLE_ROWS_READ  = 500; // cap for row COUNTING only — cell values are never read

// ─────────────────────────────────────────────────────────────────────────────
// Raw shapes returned from the browser context (page.evaluate)
// ─────────────────────────────────────────────────────────────────────────────

interface RawField {
  name?:             string;
  id?:               string;
  tag:               string;
  inputType?:        string;
  label:             string;
  labelSource:       string;
  placeholder?:      string;
  required?:         boolean;
  options?:          { value: string; label: string }[];
  optionsTruncated?: boolean;
}

interface RawForm {
  formLabel?: string;
  fields:     RawField[];
}

interface RawTable {
  caption?:          string;
  columns:           string[];
  rowCountSampled:   number;
  rowCountTruncated: boolean;
}

interface RawPage {
  forms:  RawForm[];
  tables: RawTable[];
}

/**
 * Extract field/table structure from the page currently loaded in `page`.
 * Caller is responsible for navigation (page.goto) and for stamping
 * `navFailed` by comparing page.url() against the intended target URL.
 */
export async function extractPageFields(
  page:   Page,
  pageId: string,
  url:    string,
): Promise<PageFieldData> {
  let raw: RawPage;

  try {
    raw = await page.evaluate((args: { maxOptions: number; maxRows: number }): RawPage => {
      const { maxOptions, maxRows } = args;
      // ── label resolution, in confidence order ──────────────────────────
      function resolveLabel(el: Element): { label: string; source: string } {
        const id = el.getAttribute('id');

        // 1. label[for=id]
        if (id) {
          try {
            const forLabel = document.querySelector(`label[for="${CSS.escape(id)}"]`);
            const text = forLabel?.textContent?.trim();
            if (text) return { label: text, source: 'label-for' };
          } catch { /* invalid id for CSS.escape — skip */ }
        }

        // 2. wrapping <label>...</label>
        const wrappingLabel = el.closest('label');
        if (wrappingLabel) {
          const clone = wrappingLabel.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('input,select,textarea').forEach(n => n.remove());
          const text = clone.textContent?.trim();
          if (text) return { label: text, source: 'label-wrap' };
        }

        // 3. aria-labelledby (space-separated id refs)
        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
          const parts = labelledBy
            .split(/\s+/)
            .map(refId => document.getElementById(refId)?.textContent?.trim())
            .filter((t): t is string => !!t);
          if (parts.length > 0) return { label: parts.join(' '), source: 'aria-labelledby' };
        }

        // 4. aria-label
        const ariaLabel = el.getAttribute('aria-label')?.trim();
        if (ariaLabel) return { label: ariaLabel, source: 'aria-label' };

        // 5. placeholder
        const placeholder = (el as HTMLInputElement).placeholder?.trim();
        if (placeholder) return { label: placeholder, source: 'placeholder' };

        // 6. nearest text inside a form-group/field-like container
        const container = el.closest('[class*="form-group" i],[class*="field" i],[class*="form-row" i]');
        if (container) {
          const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          while ((node = walker.nextNode())) {
            const t = node.textContent?.trim();
            if (t) return { label: t.slice(0, 80), source: 'adjacent-text' };
          }
        }

        return { label: '', source: 'none' };
      }

      function extractField(el: Element): RawField {
        const tag = el.tagName.toLowerCase();
        const { label, source } = resolveLabel(el);

        const field: RawField = {
          name:        el.getAttribute('name') || undefined,
          id:          el.getAttribute('id') || undefined,
          tag,
          label,
          labelSource: source,
          placeholder: (el as HTMLInputElement).placeholder || undefined,
          required:    (el as HTMLInputElement).required || undefined,
        };

        if (tag === 'input') {
          field.inputType = (el as HTMLInputElement).type || 'text';
        }
        if (tag === 'select') {
          const opts = Array.from((el as HTMLSelectElement).options);
          field.options = opts
            .slice(0, maxOptions)
            .map(o => ({ value: o.value, label: o.textContent?.trim() || o.value }));
          field.optionsTruncated = opts.length > maxOptions;
        }

        return field;
      }

      const FIELD_SELECTOR =
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea';

      // ── forms ──────────────────────────────────────────────────────────
      const forms: RawForm[] = [];
      const seen  = new Set<Element>();

      document.querySelectorAll('form').forEach(form => {
        const fieldEls = Array.from(form.querySelectorAll(FIELD_SELECTOR));
        if (fieldEls.length === 0) return;
        fieldEls.forEach(el => seen.add(el));

        const formLabel =
          form.getAttribute('aria-label') ||
          form.querySelector('h1,h2,h3,legend')?.textContent?.trim() ||
          undefined;

        forms.push({ formLabel, fields: fieldEls.map(extractField) });
      });

      // Implicit group: SPA "forms" built from plain divs (no <form> wrapper)
      // still have real fields worth capturing — group them together.
      const looseFields = Array.from(document.querySelectorAll(FIELD_SELECTOR))
        .filter(el => !seen.has(el));
      if (looseFields.length > 0) {
        forms.push({ formLabel: undefined, fields: looseFields.map(extractField) });
      }

      // ── tables ─────────────────────────────────────────────────────────
      const tables: RawTable[] = [];

      document.querySelectorAll('table').forEach(table => {
        const headerCells = table.querySelectorAll('thead th, thead td');
        let columns: string[];

        if (headerCells.length > 0) {
          columns = Array.from(headerCells).map(c => c.textContent?.trim() || '');
        } else {
          const firstRow = table.querySelector('tr');
          columns = firstRow ? Array.from(firstRow.children).map(c => c.textContent?.trim() || '') : [];
        }
        if (columns.length === 0) return;

        const bodyRows = table.querySelectorAll('tbody tr');
        tables.push({
          caption:           table.querySelector('caption')?.textContent?.trim() || undefined,
          columns,
          rowCountSampled:   Math.min(bodyRows.length, maxRows),
          rowCountTruncated: bodyRows.length > maxRows,
        });
      });

      return { forms, tables };
    }, { maxOptions: MAX_SELECT_OPTIONS, maxRows: MAX_TABLE_ROWS_READ });
  } catch {
    raw = { forms: [], tables: [] };
  }

  return {
    pageId,
    url,
    forms: raw.forms.map(f => ({
      formLabel: f.formLabel,
      fields: f.fields.map((field): FormFieldData => ({
        name:             field.name,
        id:               field.id,
        tag:              field.tag as FormFieldData['tag'],
        inputType:        field.inputType,
        label:            field.label,
        labelSource:      field.labelSource as FieldLabelSource,
        placeholder:      field.placeholder,
        required:         field.required,
        options:          field.options as FieldOption[] | undefined,
        optionsTruncated: field.optionsTruncated,
      })),
    })),
    tables: raw.tables as TableColumnData[],
  };
}
