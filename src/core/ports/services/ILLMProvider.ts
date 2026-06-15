export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  data: Buffer;
  mimeType: 'image/png' | 'image/jpeg';
}

export type MessageContent = TextContent | ImageContent;

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: MessageContent[];
}

export interface LLMCompletionOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface ILLMProvider {
  readonly modelId: string;
  readonly supportsVision: boolean;
  complete(messages: LLMMessage[], options?: LLMCompletionOptions): Promise<string>;
}
