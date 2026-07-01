import * as fs from 'fs';
import * as path from 'path';
import { AzureOpenAI } from 'openai';
import * as jsonpatch from 'fast-json-patch';
import { loadPrompt } from '../src/infrastructure/llm/PromptLoader';
import { OUT_DIR } from './config';

export interface ChatOperation {
  op: 'replace' | 'add' | 'remove';
  path: string;
  value?: unknown;
}

export interface ChatResult {
  reply: string;
  changes: ChatOperation[];
  applied: boolean;
  error?: string;
}

let client: AzureOpenAI | null = null;

function getClient(): AzureOpenAI {
  if (!client) {
    client = new AzureOpenAI({
      apiKey:     process.env['AZURE_OPENAI_API_KEY']    ?? '',
      endpoint:   process.env['AZURE_OPENAI_ENDPOINT']   ?? '',
      deployment: process.env['AZURE_OPENAI_DEPLOYMENT'] ?? '',
      apiVersion: process.env['OPENAI_API_VERSION']      ?? '2024-12-01-preview',
    });
  }
  return client;
}

export async function chat(userMessage: string): Promise<ChatResult> {
  const pkgPath = path.join(OUT_DIR, 'demo-package.json');

  let pkg: unknown;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    return {
      reply: 'No demo-package.json found. Run the pipeline first to generate your video, then I can help you edit it.',
      changes: [],
      applied: false,
    };
  }

  let systemPrompt: string;
  try {
    systemPrompt = loadPrompt('chat', 'video-editor.v1');
  } catch {
    return { reply: 'Chat service misconfiguration: prompt file missing.', changes: [], applied: false };
  }

  const userContent = `Current demo-package.json:\n${JSON.stringify(pkg, null, 2)}\n\nUser request: ${userMessage}`;

  let rawText: string;
  try {
    const response = await getClient().chat.completions.create({
      model:       process.env['AZURE_OPENAI_DEPLOYMENT'] ?? '',
      max_tokens:  1024,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userContent  },
      ],
    });
    rawText = response.choices[0]?.message?.content ?? '';
  } catch (err) {
    return { reply: 'AI service error — check your AZURE_OPENAI_* env vars.', changes: [], applied: false, error: String(err) };
  }

  let parsed: { reply: string; changes: ChatOperation[] };
  try {
    const jsonStr = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    parsed = JSON.parse(jsonStr);
  } catch {
    return { reply: rawText || 'Unexpected response from AI.', changes: [], applied: false, error: 'Non-JSON response' };
  }

  if (!Array.isArray(parsed.changes) || parsed.changes.length === 0) {
    return { reply: parsed.reply ?? 'No changes needed.', changes: [], applied: false };
  }

  try {
    const errors = jsonpatch.validate(parsed.changes as jsonpatch.Operation[], pkg);
    if (errors && errors.length > 0) {
      return {
        reply: parsed.reply,
        changes: parsed.changes,
        applied: false,
        error: errors[0]?.message ?? 'Invalid patch path',
      };
    }

    const patched = jsonpatch.applyPatch(
      JSON.parse(JSON.stringify(pkg)),
      parsed.changes as jsonpatch.Operation[],
      true,
      false,
    ).newDocument;

    fs.writeFileSync(pkgPath, JSON.stringify(patched, null, 2), 'utf-8');

    return { reply: parsed.reply, changes: parsed.changes, applied: true };
  } catch (err) {
    return {
      reply: parsed.reply,
      changes: parsed.changes,
      applied: false,
      error: String(err),
    };
  }
}
