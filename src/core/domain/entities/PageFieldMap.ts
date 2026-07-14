// ─────────────────────────────────────────────────────────────────────────────
// PageFieldMap — internal domain types for the app_flow template's field
// extraction pass (automation/utils/fieldExtractor.ts).
//
// This is the crawler's raw per-page extraction result, distinct from the
// AppFlow* wire-format types in RemotionPackage.ts (same domain-entity vs.
// wire-format separation already used elsewhere in this codebase, e.g.
// DiscoveredPage vs. RemotionScene). automation/record-appflow-map.ts maps
// PageFieldData into AppFlowFormGroup/AppFlowTable/AppFlowField when it
// assembles demo-package.json.
// ─────────────────────────────────────────────────────────────────────────────

export type FieldLabelSource =
  | 'label-for'
  | 'label-wrap'
  | 'aria-labelledby'
  | 'aria-label'
  | 'placeholder'
  | 'adjacent-text'
  | 'none';

export interface FieldOption {
  value: string;
  label: string;
}

export interface FormFieldData {
  name?:             string;
  id?:               string;
  tag:               'input' | 'textarea' | 'select';
  inputType?:        string;
  label:             string;
  labelSource:       FieldLabelSource;
  placeholder?:      string;
  required?:         boolean;
  /** Capped at 50 — see optionsTruncated. */
  options?:          FieldOption[];
  optionsTruncated?: boolean;
}

export interface TableColumnData {
  caption?:          string;
  columns:           string[];
  /** Row count read from a capped sample — never the actual cell/row values. */
  rowCountSampled:   number;
  rowCountTruncated: boolean;
}

export interface PageFieldData {
  pageId:  string;
  url:     string;
  forms:   { formLabel?: string; fields: FormFieldData[] }[];
  tables:  TableColumnData[];
  /** True when page.url() after goto() no longer resembles the node's URL (e.g. a click-only detail view that doesn't independently re-navigate). */
  navFailed?: boolean;
}
