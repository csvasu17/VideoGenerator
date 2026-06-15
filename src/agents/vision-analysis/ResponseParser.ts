import type {
  ActionSignal,
  KPIWidget,
  PageCategory,
  PageIntelligence,
  PrimaryElementBox,
  VisualFeature,
} from '../../core/domain/entities/PageIntelligence';

/** Raw shape returned by the LLM — all fields optional for graceful fallback. */
interface RawLLMResponse {
  pagePurpose?: unknown;
  pageCategory?: unknown;
  features?: unknown;
  importantActions?: unknown;
  businessContext?: unknown;
  kpiWidgets?: unknown;
  overallImportanceScore?: unknown;
  primaryElementBoundingBox?: unknown;
}

const VALID_CATEGORIES = new Set<PageCategory>([
  'dashboard', 'analytics', 'form', 'list', 'detail',
  'workflow', 'settings', 'entry', 'generic',
]);

const VALID_IMPACT = new Set(['high', 'medium', 'low']);
const VALID_TREND  = new Set(['up', 'down', 'neutral', 'unknown']);

export class ResponseParser {
  /**
   * Parse the LLM text response into a PageIntelligence payload.
   * Handles: plain JSON, JSON in code fences, extra leading/trailing text.
   * Falls back to empty defaults for any missing or invalid field.
   */
  parse(
    rawText: string,
    pageId: string,
    mode: PageIntelligence['analysisMode'],
  ): PageIntelligence {
    const json = this.extractJSON(rawText);
    const raw: RawLLMResponse = json ?? {};

    const boundingBox = asBoundingBox(raw.primaryElementBoundingBox);

    return {
      pageId,
      analysedAt: new Date().toISOString(),
      pagePurpose:           asString(raw.pagePurpose,  'Purpose not determined'),
      pageCategory:          asCategory(raw.pageCategory),
      features:              asFeatures(raw.features),
      importantActions:      asActions(raw.importantActions),
      businessContext:       asString(raw.businessContext, ''),
      kpiWidgets:            asKPIs(raw.kpiWidgets),
      overallImportanceScore: asScore(raw.overallImportanceScore),
      analysisMode:          mode,
      ...(boundingBox ? { primaryElementBoundingBox: boundingBox } : {}),
    };
  }

  // ── JSON extraction ─────────────────────────────────────────────────────────

  private extractJSON(text: string): RawLLMResponse | null {
    // 1. Try the full text as-is
    const direct = tryParse(text.trim());
    if (direct) return direct;

    // 2. Strip code fences: ```json ... ``` or ``` ... ```
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      const parsed = tryParse(fenced[1].trim());
      if (parsed) return parsed;
    }

    // 3. Extract the outermost { } block
    const start = text.indexOf('{');
    const end   = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      const parsed = tryParse(text.slice(start, end + 1));
      if (parsed) return parsed;
    }

    return null;
  }
}

// ── Field coercers ────────────────────────────────────────────────────────────

function tryParse(text: string): RawLLMResponse | null {
  try {
    const v = JSON.parse(text);
    return typeof v === 'object' && v !== null ? (v as RawLLMResponse) : null;
  } catch {
    return null;
  }
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asCategory(value: unknown): PageCategory {
  return VALID_CATEGORIES.has(value as PageCategory) ? (value as PageCategory) : 'generic';
}

function asScore(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 0;
}

function asFeatures(value: unknown): VisualFeature[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): VisualFeature[] => {
    if (typeof item !== 'object' || item === null) return [];
    const f = item as Record<string, unknown>;
    return [{
      featureName:     asString(f['featureName'],   'Unnamed Feature'),
      businessValue:   asString(f['businessValue'],  ''),
      importanceScore: asScore(f['importanceScore']),
      recommendations: asStringArray(f['recommendations']),
    }];
  });
}

function asActions(value: unknown): ActionSignal[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ActionSignal[] => {
    if (typeof item !== 'object' || item === null) return [];
    const a = item as Record<string, unknown>;
    const impactLevel = VALID_IMPACT.has(a['impactLevel'] as string)
      ? (a['impactLevel'] as ActionSignal['impactLevel'])
      : 'medium';
    return [{
      label:       asString(a['label'],  'Action'),
      intent:      asString(a['intent'], ''),
      impactLevel,
    }];
  });
}

function asKPIs(value: unknown): KPIWidget[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): KPIWidget[] => {
    if (typeof item !== 'object' || item === null) return [];
    const k = item as Record<string, unknown>;
    const trend = VALID_TREND.has(k['trend'] as string)
      ? (k['trend'] as KPIWidget['trend'])
      : 'unknown';
    return [{
      label: asString(k['label'], 'Metric'),
      value: asString(k['value'], '—'),
      trend,
      ...(typeof k['unit'] === 'string' && k['unit'] ? { unit: k['unit'] } : {}),
    }];
  });
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

/**
 * Parse and validate a raw LLM bounding-box object.
 * All four coordinates must be finite numbers in [0, 1].
 * Width and height must be positive.
 * Returns undefined for any invalid / absent input.
 */
function asBoundingBox(value: unknown): PrimaryElementBox | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const b = value as Record<string, unknown>;
  const x = Number(b['x']);
  const y = Number(b['y']);
  const w = Number(b['width']);
  const h = Number(b['height']);
  // Reject NaN, Infinity, or out-of-range values
  if ([x, y, w, h].some(n => !Number.isFinite(n) || n < 0 || n > 1)) return undefined;
  // Zero-size box is not useful
  if (w <= 0 || h <= 0) return undefined;
  return { x, y, width: w, height: h };
}
