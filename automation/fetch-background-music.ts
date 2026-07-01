#!/usr/bin/env node
/**
 * fetch-background-music.ts — Auto-select and download background music from Pixabay.
 *
 * Usage:
 *   npm run music:fetch                    — fetch music based on APP_CONTEXT_TEXT (cached)
 *   npm run music:fetch -- --force         — re-fetch even if a cached file exists
 *   npm run music:fetch -- --genre ambient — override genre selection
 *
 * How it works:
 *   1. Reads APP_CONTEXT_TEXT from .env
 *   2. Calls Azure OpenAI / OpenAI to pick the best Pixabay genre for this product
 *   3. Fetches top tracks from Pixabay Music API (pixabay.com/api/music/)
 *   4. Downloads the highest-rated track to assets/music/background.mp3
 *
 * Caching:
 *   The downloaded MP3 is cached at assets/music/background.mp3.
 *   Subsequent runs reuse the cache; pass --force to refresh.
 *
 * Requires:
 *   PIXABAY_API_KEY in .env  (free at https://pixabay.com/api/)
 */

import * as path  from 'path';
import * as fs    from 'fs';
import * as https from 'https';
import * as http  from 'http';
import * as dotenv from 'dotenv';
import { ROOT } from './config';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const MUSIC_DIR  = path.join(ROOT, 'assets', 'music');
export const MUSIC_FILE = path.join(MUSIC_DIR, 'background.mp3');

const PIXABAY_GENRES = [
  'ambient', 'corporate', 'electronic', 'jazz', 'orchestral', 'lounge',
  'classical', 'pop', 'folk',
] as const;
type PixabayGenre = typeof PIXABAY_GENRES[number];

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface FetchMusicOpts {
  force?: boolean;
  genre?: string;
}

/**
 * Fetch background music for the current product.
 * Resolution order:
 *   1. BACKGROUND_MUSIC_URL env var — direct download from any URL (works even when
 *      music APIs are blocked; great for GitHub raw content, SharePoint, OneDrive, etc.)
 *   2. Pixabay API  — auto-select genre via LLM, search, download
 *   3. Nothing      — returns null; generate-voice.ts proceeds without music
 *
 * Returns the local MP3 path on success, null otherwise.
 * Exported so generate-voice.ts can call it inline.
 */
export async function fetchBackgroundMusic(opts: FetchMusicOpts = {}): Promise<string | null> {
  if (!opts.force && fs.existsSync(MUSIC_FILE)) {
    console.log(`  ♪  Background music: using cached  ${path.relative(ROOT, MUSIC_FILE)}`);
    return MUSIC_FILE;
  }

  fs.mkdirSync(MUSIC_DIR, { recursive: true });

  // ── Option 1: Direct URL (BACKGROUND_MUSIC_URL) ────────────────────────────
  const directUrl = (process.env['BACKGROUND_MUSIC_URL'] ?? '').trim();
  if (directUrl) {
    console.log(`  ♪  Downloading from BACKGROUND_MUSIC_URL …`);
    console.log(`     ${directUrl}`);
    try {
      await downloadFile(directUrl, MUSIC_FILE);
      const stat = fs.statSync(MUSIC_FILE);
      console.log(`  ✓  Saved : ${path.relative(ROOT, MUSIC_FILE)}  (${(stat.size / (1024 * 1024)).toFixed(2)} MB)`);
      return MUSIC_FILE;
    } catch (err) {
      console.warn(`  ⚠️  Download failed: ${(err as Error).message}`);
      return null;
    }
  }

  // ── Option 2: Pixabay API ──────────────────────────────────────────────────
  const apiKey = process.env['PIXABAY_API_KEY'];
  if (!apiKey) {
    printManualInstructions();
    return null;
  }

  // ── Genre selection ────────────────────────────────────────────────────────
  let genre =
    (opts.genre ?? '').trim() ||
    (process.env['BACKGROUND_MUSIC_GENRE'] ?? '').trim();

  if (genre && !PIXABAY_GENRES.includes(genre as PixabayGenre)) {
    console.warn(`  ⚠️  Unknown genre "${genre}" — will auto-select.`);
    genre = '';
  }

  if (!genre) {
    genre = await selectGenreWithLLM();
  }

  console.log(`  ♪  Genre selected : ${genre}`);
  process.stdout.write('  ♪  Searching Pixabay Music … ');

  const track = await searchPixabay(apiKey, genre);
  if (!track) {
    console.warn(`\n  ⚠️  Pixabay unreachable or no tracks found.`);
    printManualInstructions();
    return null;
  }

  console.log(`found\n  ♪  Track : "${track.title}"`);
  process.stdout.write('  ♪  Downloading … ');

  await downloadFile(track.audio, MUSIC_FILE);
  const stat = fs.statSync(MUSIC_FILE);
  console.log(`done  (${(stat.size / (1024 * 1024)).toFixed(2)} MB)`);
  console.log(`  ✓  Saved : ${path.relative(ROOT, MUSIC_FILE)}`);

  return MUSIC_FILE;
}

function printManualInstructions(): void {
  console.log('\n  ────────────────────────────────────────────────────────────');
  console.log('  ♪  To add background music manually:');
  console.log('');
  console.log('  Option A — Download from your browser:');
  console.log('    1. Open  https://pixabay.com/music/  in your browser');
  console.log('    2. Search "corporate" or "ambient" → Download any free track');
  console.log('    3. Save the MP3 to:');
  console.log(`       ${MUSIC_FILE}`);
  console.log('    4. Re-run:  npm run voice');
  console.log('');
  console.log('  Option B — Set a direct download URL in .env:');
  console.log('    BACKGROUND_MUSIC_URL=https://raw.githubusercontent.com/...');
  console.log('    (GitHub raw URLs work on most corporate networks)');
  console.log('  ────────────────────────────────────────────────────────────\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Genre selection via LLM
// ─────────────────────────────────────────────────────────────────────────────

async function selectGenreWithLLM(): Promise<string> {
  const contextText = (process.env['APP_CONTEXT_TEXT'] ?? '').trim();
  if (!contextText) {
    console.log('  ♪  No APP_CONTEXT_TEXT — defaulting genre to "corporate"');
    return 'corporate';
  }

  const azureKey   = process.env['AZURE_OPENAI_API_KEY'];
  const azureEndpt = process.env['AZURE_OPENAI_ENDPOINT'];
  const openaiKey  = process.env['OPENAI_API_KEY'];

  if (!azureKey && !openaiKey) {
    console.log('  ♪  No LLM key — defaulting genre to "corporate"');
    return 'corporate';
  }

  const systemPrompt =
    `You pick background music genres for product demo videos. ` +
    `Choose the single best genre from this list: ${PIXABAY_GENRES.join(', ')}. ` +
    `Reply with ONLY the genre name — no explanation.`;

  const userPrompt =
    `Product description:\n${contextText.slice(0, 1000)}\n\nBest music genre?`;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AzureOpenAI } = require('openai');

    let content: string;

    if (azureKey && azureEndpt) {
      const deployment = process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1';
      const client = new AzureOpenAI({
        endpoint:   azureEndpt.replace(/\/$/, ''),
        apiKey:     azureKey,
        apiVersion: process.env['OPENAI_API_VERSION'] ?? '2024-12-01-preview',
        deployment,
      });
      const res = await client.chat.completions.create({
        model:      deployment,
        messages:   [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
        max_tokens:  10,
        temperature: 0,
      });
      content = res.choices[0]?.message?.content?.trim().toLowerCase() ?? '';
    } else {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const OpenAI = require('openai').default ?? require('openai');
      const client = new OpenAI({ apiKey: openaiKey });
      const res = await client.chat.completions.create({
        model:      'gpt-4o-mini',
        messages:   [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
        max_tokens:  10,
        temperature: 0,
      });
      content = res.choices[0]?.message?.content?.trim().toLowerCase() ?? '';
    }

    const matched = PIXABAY_GENRES.find(g => content.includes(g));
    if (matched) {
      return matched;
    }
    console.log(`  ♪  LLM replied "${content}" (unrecognised) — defaulting to "corporate"`);
    return 'corporate';
  } catch (err) {
    console.warn(`  ⚠️  LLM genre selection failed: ${(err as Error).message} — defaulting to "corporate"`);
    return 'corporate';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pixabay Music API
// ─────────────────────────────────────────────────────────────────────────────

interface PixabayTrack {
  title: string;
  audio: string;
}

async function searchPixabay(apiKey: string, genre: string): Promise<PixabayTrack | null> {
  const url =
    `https://pixabay.com/api/music/` +
    `?key=${encodeURIComponent(apiKey)}` +
    `&genre=${encodeURIComponent(genre)}` +
    `&per_page=5&order=popular`;

  let body: string;
  try {
    body = await httpGet(url);
  } catch (err) {
    console.warn(`\n  ⚠️  Pixabay request failed: ${(err as Error).message}`);
    return null;
  }

  let data: { hits?: { title?: string; audio?: string }[] };
  try {
    data = JSON.parse(body);
  } catch {
    console.warn('\n  ⚠️  Pixabay returned non-JSON response (check API key).');
    return null;
  }

  const hit = data.hits?.find(h => h.audio && h.title);
  if (!hit || !hit.audio || !hit.title) return null;
  return { title: hit.title, audio: hit.audio };
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────

// Corporate networks often use SSL inspection with self-signed certs.
// We disable strict verification only for external music API calls.
const TLS_OPTS = { rejectUnauthorized: false };

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib  = url.startsWith('https') ? https : http;
    const opts = url.startsWith('https') ? { ...TLS_OPTS } : {};
    lib.get(url, opts, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(httpGet(res.headers.location));
        return;
      }
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end',  () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function downloadFile(url: string, dest: string, depth = 0): Promise<void> {
  if (depth > 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    const lib  = url.startsWith('https') ? https : http;
    const opts = url.startsWith('https') ? { ...TLS_OPTS } : {};
    lib.get(url, opts, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(downloadFile(res.headers.location, dest, depth + 1));
        return;
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error',  err => { fs.unlink(dest, () => {}); reject(err); });
    }).on('error', reject);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Standalone CLI entry
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const SEP = '═'.repeat(63);
  console.log(`\n${SEP}`);
  console.log('  ♪  Background Music Fetcher  (Pixabay)');
  console.log(`${SEP}\n`);

  const force    = process.argv.includes('--force');
  const genreIdx = process.argv.indexOf('--genre');
  const genre    = genreIdx !== -1 ? (process.argv[genreIdx + 1] ?? '') : '';

  const result = await fetchBackgroundMusic({ force, genre });

  if (result) {
    console.log(`\n${SEP}`);
    console.log('  ✅  Background music ready!');
    console.log(`      ${result}`);
    console.log(`${SEP}\n`);
  } else {
    console.log(`\n${SEP}`);
    console.log('  ℹ️  No music fetched.');
    console.log('      Set PIXABAY_API_KEY in .env to enable auto-fetch.');
    console.log(`${SEP}\n`);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('\n  ✗  Error:', (err as Error).message ?? err);
    process.exit(1);
  });
}
