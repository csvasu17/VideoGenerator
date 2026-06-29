#!/usr/bin/env node
/**
 * generate-broll-videos.ts
 *
 * Generates a D-ID talking-head video for every broll scene in demo-package.json.
 * The result replaces the SVG `animationType` with a real `videoPath`.
 *
 * Flow per broll:
 *   1. Fetch available D-ID stock presenters → pick first professional one
 *   2. POST /talks (text mode) with broll subtitle
 *   3. Poll until done, download MP4
 *   4. Strip audio track (Remotion plays narration separately)
 *   5. Save → recordings/broll-{i}.mp4
 *   6. Patch demo-package.json: add videoPath, remove animationType
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json automation/generate-broll-videos.ts
 *   npx ts-node --project tsconfig.scripts.json automation/generate-broll-videos.ts --input out/priorauth/demo-package.json
 */

import * as fs        from 'fs';
import * as path      from 'path';
import * as https     from 'https';
import { execSync }   from 'child_process';
import * as dotenv    from 'dotenv';
import { ROOT, OUT_DIR } from './config';

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

// ─── Config ──────────────────────────────────────────────────────────────────

function getArg(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const INPUT_PATH = getArg('--input', path.join(OUT_DIR, 'demo-package.json'));

const D_ID_KEY  = process.env['D_ID_API_KEY'] ?? '';
const DID_HOST  = 'api.d-id.com';

if (!D_ID_KEY) {
  console.error('\n  ✗  D_ID_API_KEY not set in .env');
  process.exit(1);
}

// ─── HTTPS helpers ────────────────────────────────────────────────────────────

function didAuth(): string {
  return `Basic ${Buffer.from(D_ID_KEY).toString('base64')}`;
}

function httpsRequest(
  method: string,
  hostname: string,
  pathStr: string,
  body: Buffer | null,
  headers: Record<string, string | number>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname,
      path: pathStr,
      method,
      headers: body ? { ...headers, 'Content-Length': body.length } : headers,
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end',  () => resolve(data));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function didGet(pathStr: string): Promise<any> {
  return httpsRequest('GET', DID_HOST, pathStr, null, {
    'Accept': 'application/json',
    'Authorization': didAuth(),
  }).then(raw => {
    if (raw.trimStart().startsWith('<')) throw new Error(`D-ID returned HTML: ${raw.slice(0, 200)}`);
    return JSON.parse(raw);
  });
}

function didPost(pathStr: string, payload: object): Promise<any> {
  const buf = Buffer.from(JSON.stringify(payload), 'utf-8');
  return httpsRequest('POST', DID_HOST, pathStr, buf, {
    'Content-Type':  'application/json',
    'Accept':        'application/json',
    'Authorization': didAuth(),
  }).then(raw => {
    if (raw.trimStart().startsWith('<')) throw new Error(`D-ID returned HTML: ${raw.slice(0, 200)}`);
    return JSON.parse(raw);
  });
}

function httpsDownload(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    function follow(target: string): void {
      const u = new URL(target);
      https.get({ hostname: u.hostname, path: u.pathname + u.search }, res => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location);
        }
        const chunks: Buffer[] = [];
        res.on('data',  c => chunks.push(c));
        res.on('end',   () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    }
    follow(url);
  });
}

// ─── FFmpeg ───────────────────────────────────────────────────────────────────

function findFfmpeg(): string {
  try { execSync('ffmpeg -version', { stdio: 'ignore' }); return 'ffmpeg'; } catch {}
  for (const c of ['C:/ffmpeg/bin/ffmpeg.exe', 'D:/ffmpeg/bin/ffmpeg.exe']) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('FFmpeg not found in PATH.');
}

// ─── D-ID helpers ─────────────────────────────────────────────────────────────

async function getPresenterImageUrl(): Promise<string> {
  // Try to fetch D-ID stock presenters and pick a professional-looking one.
  // Fall back to a known-good public presenter image URL.
  try {
    const res = await didGet('/presenters');
    const list: any[] = res.presenters ?? res ?? [];
    // Prefer a female presenter first, then any
    const pick =
      list.find((p: any) => p.gender === 'female' && p.image_url) ??
      list.find((p: any) => p.image_url);
    if (pick?.image_url) {
      console.log(`  Presenter: ${pick.name ?? pick.id} (${pick.gender ?? 'n/a'})`);
      return pick.image_url as string;
    }
  } catch (err: any) {
    console.log(`  Note: presenters list unavailable (${err.message?.slice(0, 60) ?? err}) — using fallback`);
  }
  // Public fallback: a well-known D-ID demo presenter used in their own docs
  return 'https://create-images-results.d-id.com/DefaultPresenters/Noelle_f/v1_image.jpeg';
}

async function pollTalk(talkId: string, maxWaitMs = 300_000): Promise<string> {
  const deadline = Date.now() + maxWaitMs;
  process.stdout.write('    Polling ');
  while (Date.now() < deadline) {
    try {
      const talk = await didGet(`/talks/${talkId}`);
      if (talk.status === 'done')  { process.stdout.write(' ✓\n'); return talk.result_url as string; }
      if (talk.status === 'error') throw new Error(`D-ID error: ${talk.error?.description ?? JSON.stringify(talk.error)}`);
    } catch (err: any) {
      if ((err.message as string)?.includes('D-ID error')) throw err;
      process.stdout.write('!');
    }
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, 8000));
  }
  throw new Error(`D-ID talk ${talkId} timed out after ${maxWaitMs / 1000}s`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const SEP = '═'.repeat(63);

  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`\n  ✗  demo-package.json not found: ${INPUT_PATH}`);
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf-8'));
  const brolls: any[] = pkg.brollScenes ?? [];

  if (brolls.length === 0) {
    console.log('\n  No broll scenes found in demo-package.json — nothing to do.');
    return;
  }

  const productDir  = path.resolve(path.dirname(INPUT_PATH));
  const recordingDir = path.join(productDir, 'recordings');
  fs.mkdirSync(recordingDir, { recursive: true });

  const ffmpeg = findFfmpeg();

  console.log(`\n${SEP}`);
  console.log('  🎬  D-ID Broll Video Generator');
  console.log(`      Input   : ${INPUT_PATH}`);
  console.log(`      Brolls  : ${brolls.length}`);
  console.log(`      Output  : ${recordingDir}`);
  console.log(SEP);

  // Get a D-ID stock presenter image URL once
  const presenterUrl = await getPresenterImageUrl();
  console.log(`  Image URL: ${presenterUrl.slice(0, 80)}\n`);

  let updatedAny = false;

  for (let i = 0; i < brolls.length; i++) {
    const broll      = brolls[i];
    const brollId    = broll.id ?? `broll-${i}`;
    const subtitle   = broll.subtitle ?? '';
    const outMp4     = path.join(recordingDir, `${brollId}.mp4`);
    const relVideoPath = `recordings/${brollId}.mp4`;

    console.log(`\n  ── Broll ${i + 1}/${brolls.length}  [${brollId}] ──────────────────────────`);
    console.log(`     "${subtitle.slice(0, 70)}"`);

    // Skip if already generated
    if (fs.existsSync(outMp4) && fs.statSync(outMp4).size > 50_000) {
      console.log('     [CACHED — skipping D-ID call]');
      // Still patch the package.json entry
      broll.videoPath = relVideoPath;
      delete broll.animationType;
      updatedAny = true;
      continue;
    }

    // ── Submit D-ID talk (text mode) ─────────────────────────────────────────
    console.log('     Submitting to D-ID (text mode)...');

    let talkId: string;
    try {
      const res = await didPost('/talks', {
        source_url: presenterUrl,
        script: {
          type:     'text',
          input:    subtitle,
          provider: {
            type:     'microsoft',
            voice_id: 'en-US-JennyNeural',
          },
        },
        config: {
          fluent:        true,
          pad_audio:     0.5,
          result_format: 'mp4',
        },
      });

      if (!res.id) {
        console.error('     ✗  D-ID rejected request:', JSON.stringify(res).slice(0, 300));
        continue;
      }
      talkId = res.id as string;
      console.log(`     Talk ID: ${talkId}`);
    } catch (err: any) {
      console.error(`     ✗  D-ID submit failed: ${err.message ?? err}`);
      continue;
    }

    // ── Poll ─────────────────────────────────────────────────────────────────
    let resultUrl: string;
    try {
      resultUrl = await pollTalk(talkId, 600_000);
    } catch (err: any) {
      console.error(`     ✗  Poll failed: ${err.message ?? err}`);
      continue;
    }

    // ── Download ──────────────────────────────────────────────────────────────
    console.log('     Downloading...');
    let rawBuf: Buffer;
    try {
      rawBuf = await httpsDownload(resultUrl);
    } catch (err: any) {
      console.error(`     ✗  Download failed: ${err.message ?? err}`);
      continue;
    }

    // Write raw (with audio)
    const rawPath = path.join(productDir, `_broll-${i}-raw.mp4`);
    fs.writeFileSync(rawPath, rawBuf);
    console.log(`     Raw: ${(rawBuf.length / 1_048_576).toFixed(1)} MB`);

    // ── Strip audio + encode ─────────────────────────────────────────────────
    // Remotion plays narration from voice-narration.mp3 — the broll video is
    // visual-only. Stripping audio prevents double-audio in the final render.
    console.log('     Encoding (strip audio, scale to 1920×1080)...');
    try {
      execSync(
        `"${ffmpeg}" -y -i "${rawPath}" -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black" -an -c:v libx264 -crf 20 -preset fast "${outMp4}"`,
        { stdio: 'pipe' },
      );
    } catch (err: any) {
      // Fallback: just strip audio without scaling (in case the scale filter fails)
      try {
        execSync(
          `"${ffmpeg}" -y -i "${rawPath}" -an -c:v copy "${outMp4}"`,
          { stdio: 'pipe' },
        );
      } catch (err2: any) {
        console.error(`     ✗  FFmpeg encode failed: ${err2.message?.slice(0, 120) ?? err2}`);
        try { fs.unlinkSync(rawPath); } catch {}
        continue;
      }
    }

    try { fs.unlinkSync(rawPath); } catch {}

    const sizeMB = (fs.statSync(outMp4).size / 1_048_576).toFixed(1);
    console.log(`     ✓  ${outMp4}  (${sizeMB} MB)`);

    // ── Patch broll entry ─────────────────────────────────────────────────────
    broll.videoPath = relVideoPath;
    delete broll.animationType;
    updatedAny = true;
  }

  // ── Write patched demo-package.json ──────────────────────────────────────────
  if (updatedAny) {
    fs.writeFileSync(INPUT_PATH, JSON.stringify(pkg, null, 2), 'utf-8');
    console.log(`\n  ✓  demo-package.json updated — all brolls now use videoPath`);
  }

  console.log(`\n${SEP}`);
  console.log('  ✅  Done! Reload Remotion Studio to preview the broll videos.');
  console.log(`      When satisfied: npm run render:demo -- --input ${path.relative(ROOT, INPUT_PATH)}`);
  console.log(`${SEP}\n`);
}

main().catch(err => {
  console.error('\n  ✗ ', err.message ?? err);
  process.exit(1);
});
