/**
 * tts-helper.mjs — Thin ESM wrapper around edge-tts.
 *
 * Called from generate-voice.ts (CommonJS) via child_process.execSync.
 * Runs as a native ES module so it can import edge-tts (which is ESM-only).
 *
 * Usage:
 *   node automation/tts-helper.mjs <input-json-path>
 *
 * Input JSON schema:
 *   { text: string, outFile: string, options: { voice, rate, pitch, volume } }
 *
 * Exits 0 on success, 1 on error.
 */

import { readFileSync } from 'fs';
import { ttsSave } from 'edge-tts/out/index.js';

const [, , inputFile] = process.argv;

if (!inputFile) {
  console.error('tts-helper: missing input JSON path argument');
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(readFileSync(inputFile, 'utf-8'));
} catch (err) {
  console.error(`tts-helper: failed to read input file: ${err.message}`);
  process.exit(1);
}

const { text, outFile, options = {} } = payload;

if (!text || !outFile) {
  console.error('tts-helper: input JSON must have "text" and "outFile" fields');
  process.exit(1);
}

try {
  await ttsSave(text, outFile, options);
} catch (err) {
  console.error(`tts-helper: TTS failed: ${err.message}`);
  process.exit(1);
}
