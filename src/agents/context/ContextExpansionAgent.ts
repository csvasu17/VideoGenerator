import type { IContextExpansionAgent, ContextExpansionInput } from '../../core/ports/agents/IContextExpansionAgent';
import type { ILLMProvider } from '../../core/ports/services/ILLMProvider';
import type { ExpandedApplicationContext } from '../../core/domain/entities/context/ExpandedApplicationContext';
import type { ConfidenceField, FieldProvenance } from '../../core/domain/entities/context/ConfidenceField';
import {
  buildConfidenceField,
} from '../../core/domain/entities/context/ConfidenceField';
import {
  classifyExpansionQuality,
  computeOverallConfidence,
} from '../../core/domain/entities/context/ExpandedApplicationContext';
import { RetryPolicy, DEFAULT_RETRY_OPTIONS } from '../screenshot/RetryPolicy';
import type { RetryOptions } from '../screenshot/RetryPolicy';
import { fillTemplate } from '../../infrastructure/llm/PromptLoader';

// ── Configuration ─────────────────────────────────────────────────────────────

export interface ContextExpansionConfig {
  retry:     RetryOptions;
  /** Maximum tokens for the LLM response. Default: 1024. */
  maxTokens: number;
  /**
   * Maximum length (chars) of the raw input text forwarded to the LLM.
   * Input beyond this limit is silently trimmed to avoid prompt bloat.
   * Default: 800.
   */
  maxInputChars: number;
}

const DEFAULT_CONFIG: Readonly<ContextExpansionConfig> = {
  retry:        { ...DEFAULT_RETRY_OPTIONS, maxAttempts: 3 },
  maxTokens:    1024,
  maxInputChars: 800,
};

// ── Raw LLM response shape ────────────────────────────────────────────────────

interface RawField {
  value:      unknown;
  confidence: unknown;
  provenance: unknown;
}

interface RawExpansionResponse {
  domain?:           RawField;
  targetAudience?:   RawField;
  businessGoals?:    RawField[];
  businessOutcomes?: RawField[];
  demoPriorities?:   RawField[];
}

// ── Agent ─────────────────────────────────────────────────────────────────────

/**
 * Expands 1–5 sentences of natural language business description into a
 * structured ExpandedApplicationContext using an LLM.
 *
 * Never throws — returns null on any failure so the caller can fall back to
 * ContextEnvelope.empty() without modifying pipeline behaviour.
 */
export class ContextExpansionAgent implements IContextExpansionAgent {
  private readonly config: ContextExpansionConfig;
  private readonly retry:  RetryPolicy;

  constructor(
    private readonly llmProvider:    ILLMProvider,
    private readonly promptTemplate: string,
    config: Partial<ContextExpansionConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.retry  = new RetryPolicy();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async expand(input: ContextExpansionInput): Promise<ExpandedApplicationContext | null> {
    const rawText = (input.rawText ?? '').trim();

    // Early exit — no LLM call for empty input.
    if (!rawText) {
      return null;
    }

    try {
      return await this.retry.execute(
        () => this.runExpansion(rawText),
        this.config.retry,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[ContextExpansionAgent] All retries failed — returning null. ` +
        `Error: ${msg.slice(0, 200)}`,
      );
      return null;
    }
  }

  // ── Core expansion ──────────────────────────────────────────────────────────

  private async runExpansion(rawText: string): Promise<ExpandedApplicationContext> {
    const trimmedInput = rawText.slice(0, this.config.maxInputChars);
    const prompt = fillTemplate(this.promptTemplate, { RAW_CONTEXT: trimmedInput });

    const responseText = await this.llmProvider.complete(
      [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      { maxTokens: this.config.maxTokens },
    );

    return this.parseResponse(responseText, rawText);
  }

  // ── Parsing ─────────────────────────────────────────────────────────────────

  private parseResponse(
    responseText: string,
    rawInput:     string,
  ): ExpandedApplicationContext {
    const json = this.extractJson(responseText);

    if (!json) {
      throw new Error(`LLM response did not contain parseable JSON. Raw: "${responseText.slice(0, 150)}"`);
    }

    let parsed: RawExpansionResponse;
    try {
      parsed = JSON.parse(json) as RawExpansionResponse;
    } catch (err) {
      throw new Error(`JSON.parse failed: ${(err as Error).message}. Input: "${json.slice(0, 150)}"`);
    }

    // Validate and build typed fields.
    const domain         = this.requireField(parsed.domain, 'domain');
    const targetAudience = this.requireField(parsed.targetAudience, 'targetAudience');

    const businessGoals = this.parseFieldArray(parsed.businessGoals, 'businessGoals', 5);
    if (businessGoals.length === 0) {
      throw new Error('businessGoals must contain at least one item.');
    }

    const businessOutcomes = this.parseFieldArray(parsed.businessOutcomes, 'businessOutcomes', 5);
    const demoPriorities   = this.parseFieldArray(parsed.demoPriorities,   'demoPriorities',   3);
    if (demoPriorities.length === 0) {
      throw new Error('demoPriorities must contain at least one item.');
    }

    const overallConfidence = computeOverallConfidence(
      domain,
      targetAudience,
      businessGoals,
      businessOutcomes,
      demoPriorities,
    );

    return {
      domain,
      targetAudience,
      businessGoals,
      businessOutcomes,
      demoPriorities,
      overallConfidence,
      expansionQuality: classifyExpansionQuality(overallConfidence),
      rawInput,
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Extract a JSON object from LLM output.
   * Handles plain JSON, markdown-fenced JSON, and JSON embedded in surrounding prose.
   */
  private extractJson(text: string): string | null {
    // Try stripping markdown fences first.
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      return fenceMatch[1].trim();
    }

    // Try to find the first { … } block.
    const firstBrace = text.indexOf('{');
    const lastBrace  = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return text.slice(firstBrace, lastBrace + 1);
    }

    return null;
  }

  private requireField(raw: RawField | undefined, name: string): ConfidenceField<string> {
    if (!raw || typeof raw.value !== 'string' || !raw.value.trim()) {
      throw new Error(`Missing or empty required field: "${name}".`);
    }
    return buildConfidenceField(
      raw.value.trim(),
      this.coerceConfidence(raw.confidence),
      this.coerceProvenance(raw.provenance),
    );
  }

  private parseFieldArray(
    raw:     RawField[] | undefined,
    name:    string,
    maxItems: number,
  ): ReadonlyArray<ConfidenceField<string>> {
    if (!Array.isArray(raw)) return [];

    return raw
      .slice(0, maxItems)
      .filter((item): item is RawField => !!item && typeof item.value === 'string' && !!String(item.value).trim())
      .map(item =>
        buildConfidenceField(
          String(item.value).trim(),
          this.coerceConfidence(item.confidence),
          this.coerceProvenance(item.provenance),
        ),
      );
  }

  private coerceConfidence(raw: unknown): number {
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
    if (isNaN(n)) return 0.60; // safe default in INFERRED range
    return Math.min(1.0, Math.max(0.0, n));
  }

  private coerceProvenance(raw: unknown): FieldProvenance {
    if (raw === 'STATED' || raw === 'INFERRED' || raw === 'EXPANDED') {
      return raw;
    }
    return 'EXPANDED'; // conservatively treat unknown provenance as EXPANDED
  }
}
