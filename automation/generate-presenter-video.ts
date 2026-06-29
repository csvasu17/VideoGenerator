#!/usr/bin/env node
/**
 * generate-presenter-video.ts — Audio-driven D-ID lip-sync presenter
 *
 * Flow:
 *   1. Read voice-script.json to get all narration segments + timing
 *   2. Build a merged MP3 (silence + each segment at its exact timestamp)
 *   3. Upload presenter JPEG + merged audio to GitHub (temp, auto-deleted)
 *   4. Submit to D-ID Talks API using: source_url=image, script.type=audio
 *      → D-ID syncs the presenter's mouth to OUR TTS audio, not generic TTS
 *   5. Download the lip-synced MP4
 *   6. Encode as VP9+alpha WebM (colorkey removes D-ID's grey background)
 *   7. Update demo-package.json → presenterConfig.videoSrc
 *   8. Clean up GitHub temp files
 *
 * Requires in .env:
 *   D_ID_API_KEY=...
 *   GITHUB_TOKEN=...   (PAT with public_repo scope)
 *   GITHUB_REPO=...    (public repo, e.g. "yourname/VideoGenerator")
 */

import * as fs         from 'fs';
import * as path       from 'path';
import * as https      from 'https';
import { execSync, spawnSync } from 'child_process';
import * as dotenv     from 'dotenv';
import { ROOT, OUT_DIR } from './config';

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

const D_ID_KEY = process.env['D_ID_API_KEY'] ?? '';
const GH_TOKEN = process.env['GITHUB_TOKEN'] ?? '';
const GH_REPO  = process.env['GITHUB_REPO']  ?? '';
const DID_HOST = 'api.d-id.com';
const GH_HOST  = 'api.github.com';

// ── Generic HTTPS helpers ─────────────────────────────────────────────────────

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
    const req = https.request(
      { hostname, path: pathStr, method, headers: body ? { ...headers, 'Content-Length': body.length } : headers },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)); },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function httpsPostJson(hostname: string, pathStr: string, payload: object, extra: Record<string, string> = {}): Promise<any> {
  const buf = Buffer.from(JSON.stringify(payload), 'utf-8');
  return httpsRequest('POST', hostname, pathStr, buf, {
    'Content-Type': 'application/json', 'Accept': 'application/json', ...extra,
  }).then(raw => { if (raw.trimStart().startsWith('<')) throw new Error(`HTML response: ${raw.slice(0, 200)}`); return JSON.parse(raw); });
}

function httpsGetJson(hostname: string, pathStr: string, headers: Record<string, string>): Promise<any> {
  return httpsRequest('GET', hostname, pathStr, null, { 'Accept': 'application/json', ...headers })
    .then(raw => { if (raw.trimStart().startsWith('<')) throw new Error(`HTML response: ${raw.slice(0, 200)}`); return JSON.parse(raw); });
}

function httpsDownload(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    function follow(target: string): void {
      const u = new URL(target);
      https.get({ hostname: u.hostname, path: u.pathname + u.search }, res => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return follow(res.headers.location);
        const chunks: Buffer[] = [];
        res.on('data', c => chunks.push(c));
        res.on('end',  () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    }
    follow(url);
  });
}

// ── GitHub Contents API ───────────────────────────────────────────────────────

function ghHeaders(): Record<string, string> {
  return {
    'Authorization':        `Bearer ${GH_TOKEN}`,
    'Accept':               'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent':           'video-generator-presenter',
  };
}

interface GhUpload { url: string; sha: string; filename: string }

async function ghUpload(localPath: string, repoFilename: string): Promise<GhUpload> {
  const b64     = fs.readFileSync(localPath).toString('base64');
  const apiPath = `/repos/${GH_REPO}/contents/${repoFilename}`;
  console.log(`        → PUT github.com/${GH_REPO}/${repoFilename}`);

  let existingSha: string | undefined;
  try {
    const existing = await httpsGetJson(GH_HOST, apiPath, ghHeaders());
    existingSha = existing.sha;
    console.log(`        → file exists, will overwrite (sha=${existingSha?.slice(0,8)})`);
  } catch { /* new file */ }

  const payload: any = { message: 'chore: temp presenter asset (auto-deleted)', content: b64 };
  if (existingSha) payload.sha = existingSha;

  const raw = await httpsRequest('PUT', GH_HOST, apiPath, Buffer.from(JSON.stringify(payload), 'utf-8'), {
    ...ghHeaders(), 'Content-Type': 'application/json',
  });
  if (raw.trimStart().startsWith('<')) throw new Error(`GitHub returned HTML: ${raw.slice(0, 200)}`);
  const r = JSON.parse(raw);
  const url: string | undefined = r.content?.download_url;
  if (!url) throw new Error(`GitHub upload failed: ${JSON.stringify(r).slice(0, 400)}`);
  return { url, sha: r.content.sha as string, filename: repoFilename };
}

async function ghDelete(upload: GhUpload): Promise<void> {
  const body = Buffer.from(JSON.stringify({ message: 'chore: remove temp presenter asset', sha: upload.sha }), 'utf-8');
  await httpsRequest('DELETE', GH_HOST, `/repos/${GH_REPO}/contents/${upload.filename}`, body, {
    ...ghHeaders(), 'Content-Type': 'application/json',
  });
}

// ── FFmpeg helper ─────────────────────────────────────────────────────────────

function findFfmpeg(): string {
  try { execSync('ffmpeg -version', { stdio: 'ignore' }); return 'ffmpeg'; } catch {}
  for (const c of ['C:/ffmpeg/bin/ffmpeg.exe', 'D:/ffmpeg/bin/ffmpeg.exe']) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('FFmpeg not found — add it to PATH.');
}

// ── D-ID poll ─────────────────────────────────────────────────────────────────

async function pollTalk(talkId: string, maxWaitMs = 600_000): Promise<string> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const talk = await httpsGetJson(DID_HOST, `/talks/${talkId}`, { 'Authorization': didAuth() });
      if (talk.status === 'done')  return talk.result_url as string;
      if (talk.status === 'error') throw new Error(`D-ID error: ${talk.error?.description ?? JSON.stringify(talk.error)}`);
    } catch (err: any) {
      // Network hiccup — log and retry on next tick
      if (err.message?.includes('D-ID error')) throw err;
      process.stdout.write('!'); // mark retry
    }
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, 8000));
  }
  throw new Error(`Timed out waiting for D-ID talk ${talkId}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const SEP = '═'.repeat(63);

  // Allow resuming from a previously-submitted talk: --talk-id=tlk_xxx
  const resumeArg = process.argv.find(a => a.startsWith('--talk-id='));
  const resumeTalkId = resumeArg ? resumeArg.split('=')[1] : null;

  const missing: string[] = [];
  if (!D_ID_KEY) missing.push('D_ID_API_KEY');
  if (!resumeTalkId && !GH_TOKEN) missing.push('GITHUB_TOKEN');
  if (!resumeTalkId && !GH_REPO)  missing.push('GITHUB_REPO');
  if (missing.length) {
    console.log(`\nPresenter lip-sync skipped — missing: ${missing.join(', ')}`);
    process.exit(0);
  }

  // ── Resume mode: skip build/upload/submit, go straight to poll ──────────────
  if (resumeTalkId) {
    const pkgPath = path.join(OUT_DIR, 'demo-package.json');
    const pkg     = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const ffmpeg  = findFfmpeg();
    const tmpVideo = path.join(OUT_DIR, '_presenter-raw.mp4');
    const outWebm  = path.join(OUT_DIR, 'assets', 'presenter', 'presenter-lip-sync.webm');

    console.log(`\n${SEP}`);
    console.log(`  🎭  Presenter Lip-Sync — Resume from Talk ID: ${resumeTalkId}`);
    console.log(SEP);

    console.log(`\n  [Poll] Waiting for D-ID result (up to 10 min)…`);
    process.stdout.write('        ');
    const resultUrl = await pollTalk(resumeTalkId, 600_000);
    console.log(`\n        ✓ ready: ${resultUrl}`);

    console.log('\n  [DL]   Downloading lip-synced video...');
    const videoBuf = await httpsDownload(resultUrl);
    fs.writeFileSync(tmpVideo, videoBuf);
    console.log(`        ✓ ${(videoBuf.length / 1_048_576).toFixed(1)} MB`);

    console.log('\n  [ENC]  Encoding VP9+alpha WebM...');
    fs.mkdirSync(path.dirname(outWebm), { recursive: true });
    const vidFwd = tmpVideo.replace(/\\/g, '/');
    const wbmFwd = outWebm.replace(/\\/g, '/');
    const encResult = spawnSync(ffmpeg, [
      '-y', '-i', vidFwd,
      '-vf', 'scale=320:-2,colorkey=0xEAEAEA:0.35:0.05,format=yuva420p',
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-crf', '20', '-b:v', '0',
      wbmFwd,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    if (encResult.status !== 0) {
      console.error('ffmpeg encode failed:', encResult.stderr?.toString().slice(-500));
      throw new Error('VP9 encoding failed');
    }
    try { fs.unlinkSync(tmpVideo); } catch {}

    const wbmMB = (fs.statSync(outWebm).size / 1_048_576).toFixed(1);
    console.log(`        ✓ presenter-lip-sync.webm — ${wbmMB} MB`);

    pkg.presenterConfig.videoSrc = 'assets/presenter/presenter-lip-sync.webm';
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf-8');

    console.log(`\n${SEP}`);
    console.log('  ✓  Lip-sync presenter ready!');
    console.log('     assets/presenter/presenter-lip-sync.webm');
    console.log('     demo-package.json updated → presenterConfig.videoSrc');
    console.log('     Next: check in Studio, then npm run render:demo:voice');
    console.log(`${SEP}\n`);
    return;
  }

  // ── Load project files ───────────────────────────────────────────────────────
  const pkgPath    = path.join(OUT_DIR, 'demo-package.json');
  const vsPath     = path.join(OUT_DIR, 'voice-script.json');

  if (!fs.existsSync(vsPath)) {
    console.error(`voice-script.json not found at ${vsPath}. Run: npm run voice`);
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const vs  = JSON.parse(fs.readFileSync(vsPath,  'utf-8'));

  const segments: Array<{ id: string; startSec: number; durationSec: number }> = vs.segments ?? [];
  const voiceDir: string = vs.voiceDir ?? 'voice-segments';
  const segDir   = path.join(OUT_DIR, voiceDir);

  // Presenter start = first scene's "from" frame at composition fps
  const fps               = pkg.composition?.fps ?? 30;
  const firstSceneFrom    = pkg.scenes?.[0]?.from ?? 750;
  const presenterOffsetSec = firstSceneFrom / fps;

  // Voice segments that occur during the presenter's on-screen time
  const presenterSegs = segments.filter(s => (s.startSec + s.durationSec) > presenterOffsetSec);

  if (presenterSegs.length === 0) {
    console.error('No voice segments found during presenter time. Check voice-script.json.');
    process.exit(1);
  }

  // Total presenter duration
  const lastSeg      = presenterSegs[presenterSegs.length - 1];
  const totalDurSec  = Math.ceil(lastSeg.startSec + lastSeg.durationSec - presenterOffsetSec) + 1;

  // Presenter image lookup (app-specific first, then global shared fallback)
  const srcPngDefault     = path.join(OUT_DIR, 'assets', 'presenter', 'presenter-default.png');
  const srcPngTransparent = path.join(OUT_DIR, 'assets', 'presenter', 'presenter-transparent.png');
  const srcPngGlobal      = path.join(ROOT, 'assets', 'presenter', 'presenter-default.png');

  const srcPng = fs.existsSync(srcPngDefault)
    ? srcPngDefault
    : fs.existsSync(srcPngTransparent)
    ? srcPngTransparent
    : fs.existsSync(srcPngGlobal)
    ? srcPngGlobal
    : null;

  if (!srcPng) {
    console.error(
      `Presenter image not found. Checked:\n  ${srcPngDefault}\n  ${srcPngTransparent}\n  ${srcPngGlobal}\n\n` +
      `Add a presenter photo to assets/presenter/presenter-default.png (shared) or ${srcPngDefault} (app-specific).`
    );
    process.exit(1);
  }

  const isTransparent = srcPng === srcPngTransparent;
  if (srcPng === srcPngGlobal) {
    console.log(`        ℹ  Using shared presenter image: assets/presenter/presenter-default.png`);
  }

  const tmpJpeg  = path.join(OUT_DIR, '_presenter-input.jpg');
  const tmpAudio = path.join(OUT_DIR, '_presenter-audio.mp3');
  const tmpVideo = path.join(OUT_DIR, '_presenter-raw.mp4');
  const outWebm  = path.join(OUT_DIR, 'assets', 'presenter', 'presenter-lip-sync.webm');

  console.log(`\n${SEP}`);
  console.log('  🎭  Presenter Lip-Sync Generator (D-ID Audio-Driven)');
  console.log(`      Voice dir   : ${voiceDir}`);
  console.log(`      Segments    : ${presenterSegs.length} narration segments`);
  console.log(`      Duration    : ${totalDurSec}s (presenter on-screen time)`);
  console.log(`      Output      : assets/presenter/presenter-lip-sync.webm`);
  console.log(SEP);

  const ffmpeg = findFfmpeg();

  // ── 1. Build merged audio ────────────────────────────────────────────────────
  // One audio file covering the presenter's full on-screen duration.
  // Each voice segment is placed at its exact presenter-relative timestamp.
  // Silence fills the gaps. D-ID will sync the presenter mouth to this audio.

  console.log(`\n  [1/6] Building merged audio (${totalDurSec}s)...`);

  // Collect segments that have an MP3 file
  const validSegs = presenterSegs.filter(s => {
    const mp3 = path.join(segDir, `${s.id}.mp3`);
    if (!fs.existsSync(mp3)) { console.log(`        ⚠  ${s.id}.mp3 not found — skipped`); return false; }
    return true;
  });

  if (validSegs.length === 0) {
    console.error(`No MP3 files found in ${segDir}. Run: npm run voice`);
    process.exit(1);
  }

  // Build ffmpeg filter: silent base + each segment delayed to its presenter-relative offset
  // adelay=Xms|Xms pads with silence before the segment (stereo = both channels)
  const inputs: string[]  = [];
  const filters: string[] = [];
  const mixInputs: string[] = ['[0:a]']; // the silent base is input 0

  validSegs.forEach((seg, i) => {
    const delayMs = Math.round(Math.max(0, seg.startSec - presenterOffsetSec) * 1000);
    const mp3     = path.join(segDir, `${seg.id}.mp3`).replace(/\\/g, '/');
    inputs.push(`-i "${mp3}"`);
    filters.push(`[${i + 1}:a]adelay=${delayMs}|${delayMs}[d${i}]`);
    mixInputs.push(`[d${i}]`);
  });

  const filterGraph = [
    ...filters,
    `${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:normalize=0[out]`,
  ].join('; ');

  const silentBase = path.join(OUT_DIR, '_silence_base.mp3').replace(/\\/g, '/');
  const audioOut   = tmpAudio.replace(/\\/g, '/');
  const jpegFwd    = tmpJpeg.replace(/\\/g, '/');
  const srcFwd     = srcPng.replace(/\\/g, '/');

  // Create silent base track
  const silCmd = `"${ffmpeg}" -y -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -t ${totalDurSec} -ar 44100 -ac 2 "${silentBase}"`;
  execSync(silCmd, { stdio: 'ignore' });

  // Merge voice segments into it
  const mergeCmd = `"${ffmpeg}" -y -i "${silentBase}" ${inputs.join(' ')} -filter_complex "${filterGraph}" -map "[out]" -t ${totalDurSec} -ar 44100 -ac 2 "${audioOut}"`;
  execSync(mergeCmd, { stdio: 'ignore', cwd: ROOT });

  try { fs.unlinkSync(silentBase.replace(/\//g, '\\')); } catch {}
  const audioKB = Math.round(fs.statSync(tmpAudio).size / 1024);
  console.log(`        ✓ merged audio: ${audioKB} KB, ${totalDurSec}s`);

  // ── 2. Convert presenter image to JPEG ───────────────────────────────────────
  console.log(`\n  [2/6] Converting presenter image to JPEG (${isTransparent ? 'transparent → white bg' : 'direct'})...`);
  // If transparent PNG: composite on white background before sending to D-ID
  const jpegCmd = isTransparent
    ? `"${ffmpeg}" -y -f lavfi -i "color=white:size=640x640" -i "${srcFwd}" -filter_complex "[0:v][1:v]overlay=x=(main_w-overlay_w)/2:y=(main_h-overlay_h)/2,format=yuv420p" -vframes 1 -q:v 2 "${jpegFwd}"`
    : `"${ffmpeg}" -y -i "${srcFwd}" -vf "scale=640:-1" -q:v 2 "${jpegFwd}"`;
  execSync(jpegCmd, { stdio: 'ignore' });
  console.log(`        ✓ ${Math.round(fs.statSync(tmpJpeg).size / 1024)} KB`);

  // ── 3. Upload both assets to GitHub ──────────────────────────────────────────
  console.log('\n  [3/6] Uploading assets to GitHub...');
  let imgUpload:   GhUpload | null = null;
  let audioUpload: GhUpload | null = null;

  try {
    imgUpload   = await ghUpload(tmpJpeg,  '_presenter-img-temp.jpg');
    audioUpload = await ghUpload(tmpAudio, '_presenter-audio-temp.mp3');
    console.log(`        ✓ image : ${imgUpload.url}`);
    console.log(`        ✓ audio : ${audioUpload.url}`);
  } catch (err) {
    // Clean up any successful uploads
    if (imgUpload)   { try { await ghDelete(imgUpload);   } catch {} }
    if (audioUpload) { try { await ghDelete(audioUpload); } catch {} }
    throw err;
  } finally {
    try { fs.unlinkSync(tmpJpeg);  } catch {}
    try { fs.unlinkSync(tmpAudio); } catch {}
  }

  // GitHub CDN can take a few seconds to propagate — brief wait
  await new Promise(r => setTimeout(r, 3000));

  // ── 4. Submit to D-ID (audio-driven mode) ────────────────────────────────────
  console.log('\n  [4/6] Submitting to D-ID (audio-driven lip-sync)...');
  let talkId: string;
  try {
    const talkRes = await httpsPostJson(DID_HOST, '/talks', {
      source_url: imgUpload.url,
      script: {
        type:      'audio',
        audio_url: audioUpload.url,
      },
      config: { fluent: false, pad_audio: 0, result_format: 'mp4' },
    }, { 'Authorization': didAuth() });

    if (!talkRes.id) {
      console.error('\n  ✗  D-ID rejected the request:');
      console.error(JSON.stringify(talkRes, null, 2));
      throw new Error('D-ID request failed');
    }
    talkId = talkRes.id;
    console.log(`        Talk ID : ${talkId}`);
    console.log(`        Polling (up to 10 min for a ${totalDurSec}s video)…`);
    process.stdout.write('        ');
  } catch (err) {
    if (imgUpload)   { try { await ghDelete(imgUpload);   } catch {} }
    if (audioUpload) { try { await ghDelete(audioUpload); } catch {} }
    throw err;
  }

  // ── 5. Poll + download result ─────────────────────────────────────────────────
  let resultUrl: string;
  try {
    resultUrl = await pollTalk(talkId!, 600_000);
    console.log(`\n        ✓ ready: ${resultUrl}`);
  } catch (err) {
    if (imgUpload)   { try { await ghDelete(imgUpload);   } catch {} }
    if (audioUpload) { try { await ghDelete(audioUpload); } catch {} }
    throw err;
  }

  console.log('\n  [5/6] Downloading lip-synced video...');
  const videoBuf = await httpsDownload(resultUrl);
  fs.writeFileSync(tmpVideo, videoBuf);
  console.log(`        ✓ ${(videoBuf.length / 1_048_576).toFixed(1)} MB`);

  // ── 6. Encode VP9+alpha WebM ──────────────────────────────────────────────────
  // D-ID outputs on a light-grey (#EAEAEA) background.
  // colorkey removes it; libvpx-vp9 with yuva420p preserves the alpha channel.

  console.log('\n  [6/6] Encoding VP9+alpha WebM (removing D-ID background)...');
  fs.mkdirSync(path.dirname(outWebm), { recursive: true });

  const vidFwd = tmpVideo.replace(/\\/g, '/');
  const wbmFwd = outWebm.replace(/\\/g, '/');

  const encCmd = [
    `"${ffmpeg}" -y`,
    `-i "${vidFwd}"`,
    `-vf "scale=320:-2,colorkey=0xEAEAEA:0.35:0.05,format=yuva420p"`,
    `-c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -crf 20 -b:v 0`,
    `"${wbmFwd}"`,
  ].join(' ');

  const encResult = spawnSync(ffmpeg, [
    '-y', '-i', vidFwd,
    '-vf', 'scale=320:-2,colorkey=0xEAEAEA:0.35:0.05,format=yuva420p',
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-crf', '20', '-b:v', '0',
    wbmFwd,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  if (encResult.status !== 0) {
    console.error('ffmpeg encode failed:', encResult.stderr?.toString().slice(-500));
    throw new Error('VP9 encoding failed');
  }

  const wbmMB = (fs.statSync(outWebm).size / 1_048_576).toFixed(1);
  console.log(`        ✓ presenter-lip-sync.webm — ${wbmMB} MB`);

  // ── Cleanup ───────────────────────────────────────────────────────────────────
  try { fs.unlinkSync(tmpVideo); } catch {}

  process.stdout.write('        Cleaning up GitHub temp files… ');
  await Promise.all([
    ghDelete(imgUpload!).catch(() => {}),
    ghDelete(audioUpload!).catch(() => {}),
  ]);
  console.log('✓');

  // ── Update demo-package.json ──────────────────────────────────────────────────
  pkg.presenterConfig.videoSrc = 'assets/presenter/presenter-lip-sync.webm';
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf-8');

  console.log(`\n${SEP}`);
  console.log('  ✓  Lip-sync presenter ready!');
  console.log('     assets/presenter/presenter-lip-sync.webm');
  console.log('     demo-package.json updated → presenterConfig.videoSrc');
  console.log('     Next: check in Studio, then npm run render:demo:voice');
  console.log(`${SEP}\n`);
}

main().catch(err => {
  console.error('\n  ✗ ', err.message ?? err);
  process.exit(1);
});
