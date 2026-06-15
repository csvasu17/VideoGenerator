import OpenAI from 'openai';
import type { ILLMProvider, LLMCompletionOptions, LLMMessage } from '../../core/ports/services/ILLMProvider';

export interface OpenAIProviderConfig {
  apiKey?:   string;
  model?:    string;
  maxTokens?: number;
}

const DEFAULTS = {
  model:     'gpt-4o',
  maxTokens: 4096,
};

export class OpenAIProvider implements ILLMProvider {
  readonly supportsVision = true;
  readonly modelId: string;

  private readonly client:           OpenAI;
  private readonly defaultMaxTokens: number;

  constructor(config: OpenAIProviderConfig = {}) {
    this.client           = new OpenAI({ apiKey: config.apiKey ?? process.env['OPENAI_API_KEY'] });
    this.modelId          = config.model ?? DEFAULTS.model;
    this.defaultMaxTokens = config.maxTokens ?? DEFAULTS.maxTokens;
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

// ── Shared helper (same pattern as AzureOpenAIProvider) ──────────────────────

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
            detail: 'high' as const,
          },
        };
      });
      result.push({ role: 'user', content: parts });
    } else {
      const text = m.content
        .filter(c => c.type === 'text')
        .map(c => (c.type === 'text' ? c.text : ''))
        .join('');
      result.push({ role: 'assistant', content: text });
    }
  }

  return result;
}
