import Anthropic from '@anthropic-ai/sdk';
import type { ILLMProvider, LLMCompletionOptions, LLMMessage } from '../../core/ports/services/ILLMProvider';

export interface ClaudeProviderConfig {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

const DEFAULTS = {
  model: 'claude-opus-4-5',
  maxTokens: 4096,
};

export class ClaudeProvider implements ILLMProvider {
  readonly supportsVision = true;
  readonly modelId: string;

  private readonly client: Anthropic;
  private readonly defaultMaxTokens: number;

  constructor(config: ClaudeProviderConfig = {}) {
    this.client = new Anthropic({ apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY });
    this.modelId = config.model ?? DEFAULTS.model;
    this.defaultMaxTokens = config.maxTokens ?? DEFAULTS.maxTokens;
  }

  async complete(messages: LLMMessage[], options: LLMCompletionOptions = {}): Promise<string> {
    const response = await this.client.messages.create({
      model: this.modelId,
      max_tokens: options.maxTokens ?? this.defaultMaxTokens,
      ...(options.systemPrompt ? { system: options.systemPrompt } : {}),
      messages: messages.map(m => ({
        role: m.role,
        content: m.content.map(c => {
          if (c.type === 'text') return { type: 'text' as const, text: c.text };
          return {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: c.mimeType,
              data: c.data.toString('base64'),
            },
          };
        }),
      })),
    });

    const block = response.content.find(b => b.type === 'text');
    return block?.type === 'text' ? block.text : '';
  }
}
