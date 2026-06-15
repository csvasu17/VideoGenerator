// ─────────────────────────────────────────────────────────────────────────────
// AzureOpenAIProvider
//
// Wraps the openai SDK's AzureOpenAI client so the rest of the pipeline
// (VisionAnalysisAgent, etc.) uses your Azure Cognitive Services deployment
// instead of the public OpenAI API.
//
// Required environment variables (set in .env):
//   AZURE_OPENAI_API_KEY       — resource key from Azure portal
//   AZURE_OPENAI_ENDPOINT      — https://<resource>.cognitiveservices.azure.com/
//   AZURE_OPENAI_DEPLOYMENT    — deployment name (e.g. "gpt-4.1")
//   OPENAI_API_VERSION         — e.g. "2024-12-01-preview"
// ─────────────────────────────────────────────────────────────────────────────

import { AzureOpenAI } from 'openai';
import type OpenAI from 'openai';
import type { ILLMProvider, LLMCompletionOptions, LLMMessage } from '../../core/ports/services/ILLMProvider';

export interface AzureOpenAIProviderConfig {
  apiKey?:     string;
  endpoint?:   string;
  deployment?: string;
  apiVersion?: string;
  maxTokens?:  number;
}

export class AzureOpenAIProvider implements ILLMProvider {
  readonly supportsVision = true;
  readonly modelId: string;

  private readonly client:           AzureOpenAI;
  private readonly defaultMaxTokens: number;

  constructor(config: AzureOpenAIProviderConfig = {}) {
    const apiKey     = config.apiKey     ?? process.env['AZURE_OPENAI_API_KEY']    ?? '';
    const endpoint   = config.endpoint   ?? process.env['AZURE_OPENAI_ENDPOINT']   ?? '';
    const deployment = config.deployment ?? process.env['AZURE_OPENAI_DEPLOYMENT'] ?? '';
    const apiVersion = config.apiVersion ?? process.env['OPENAI_API_VERSION']      ?? '2024-12-01-preview';

    if (!apiKey)     throw new Error('AzureOpenAIProvider: AZURE_OPENAI_API_KEY is required');
    if (!endpoint)   throw new Error('AzureOpenAIProvider: AZURE_OPENAI_ENDPOINT is required');
    if (!deployment) throw new Error('AzureOpenAIProvider: AZURE_OPENAI_DEPLOYMENT is required');

    this.client           = new AzureOpenAI({ apiKey, endpoint, deployment, apiVersion });
    this.modelId          = deployment;
    this.defaultMaxTokens = config.maxTokens ?? 4096;
  }

  async complete(messages: LLMMessage[], options: LLMCompletionOptions = {}): Promise<string> {
    const response = await this.client.chat.completions.create({
      model:      this.modelId,
      max_tokens: options.maxTokens ?? this.defaultMaxTokens,
      messages:   buildSdkMessages(messages, options.systemPrompt),
    });

    return response.choices[0]?.message?.content ?? '';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper — convert domain LLMMessage[] to the SDK's strict message union type.
//
// openai SDK v6 distinguishes user messages (can contain images) from
// assistant messages (text only).  We branch on role so TypeScript picks the
// correct ChatCompletionMessageParam overload.
// ─────────────────────────────────────────────────────────────────────────────

function buildSdkMessages(
  messages:     LLMMessage[],
  systemPrompt?: string,
): OpenAI.ChatCompletionMessageParam[] {
  const result: OpenAI.ChatCompletionMessageParam[] = [];

  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }

  for (const m of messages) {
    if (m.role === 'user') {
      const parts: OpenAI.ChatCompletionContentPart[] = m.content.map(c => {
        if (c.type === 'text') {
          return { type: 'text' as const, text: c.text };
        }
        return {
          type:      'image_url' as const,
          image_url: {
            url:    `data:${c.mimeType};base64,${c.data.toString('base64')}`,
            // 'low' detail (512×512 tiles) keeps UI structure visible for
            // feature identification while reducing the chance of content-filter
            // hits from employee photos or other PII present in HR dashboards.
            detail: 'low' as const,
          },
        };
      });
      result.push({ role: 'user', content: parts });
    } else {
      // Assistant messages are always plain text in our domain
      const text = m.content
        .filter(c => c.type === 'text')
        .map(c => (c.type === 'text' ? c.text : ''))
        .join('');
      result.push({ role: 'assistant', content: text });
    }
  }

  return result;
}
