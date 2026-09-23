import * as fs from 'fs';

/**
 * Azure OpenAI TTS (premium quality). Requires AZURE_OPENAI_API_KEY +
 * AZURE_OPENAI_ENDPOINT in .env (or the AZURE_OPENAI_TTS_* dedicated-resource
 * variants). Voices: onyx, echo, alloy, fable, nova, shimmer.
 *
 * Shared by generate-voice.ts (bulk narration generation) and chat-service.ts
 * (single-segment regeneration after a chat-driven narration edit) — extracted
 * here because generate-voice.ts runs its whole CLI at import time (no
 * `require.main` guard), so importing it directly from the long-lived
 * config-server process would trigger a full voice regen + ffmpeg merge.
 */
export async function generateWithAzureOpenAI(
  text:    string,
  outMp3:  string,
  voice:   string,
  model:   string,
  speed:   number,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { AzureOpenAI } = require('openai');

  // Prefer dedicated TTS resource vars; fall back to main Azure vars
  const endpoint    = (process.env['AZURE_OPENAI_TTS_ENDPOINT'] ?? process.env['AZURE_OPENAI_ENDPOINT']!).replace(/\/$/, '');
  const apiKey      = process.env['AZURE_OPENAI_TTS_KEY'] ?? process.env['AZURE_OPENAI_API_KEY']!;
  const apiVersion  = process.env['OPENAI_API_VERSION'] ?? '2025-01-01-preview';
  // model param = the TTS deployment name (e.g. "tts-hd", "tts-1-hd")
  const deployment  = model;

  const client = new AzureOpenAI({ endpoint, apiKey, apiVersion, deployment });

  const response = await client.audio.speech.create({
    model:           deployment,   // Azure uses the deployment name here
    voice:           voice as 'onyx' | 'echo' | 'alloy' | 'fable' | 'nova' | 'shimmer',
    input:           text,
    response_format: 'mp3',
    speed:           speed,
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outMp3, buffer);
}
