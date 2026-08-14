#!/usr/bin/env node
/**
 * manual-recording-to-enterprise.ts — Re-purposes an already-processed Manual
 * Recording (out/<slug>/manual-recording/scenes.json + voice-script.json +
 * normalized.mp4) into an EnterpriseVideo-shaped package: B-roll problem intro →
 * product demo scenes (playing the user's own real recorded clips, one per
 * detected scene, via EnterpriseProductScene's recordingPath/recordingStartSec)
 * → benefit slide → presenter close.
 *
 * This is deliberately independent of both:
 *   - the plain Manual Recording pipeline (process-manual-recording.ts), which
 *     wraps the same footage in a generic open/close title card instead, and
 *   - the fully-automated Enterprise pipeline (record-app-clips.ts → ... →
 *     EnterpriseRemotionExporter), which drives Playwright itself and writes
 *     its package to out/<slug>/demo-package.json (product root).
 * Everything this script writes lives under manual-recording/ with new,
 * distinctly-named files — it never touches manual-recording/scenes.json,
 * manual-recording/voice-script.json, manual-recording/voice-segments/, or a
 * pre-existing root-level demo-package.json from a prior automated run.
 *
 * Prerequisite: run Manual Recording processing first (Config UI → Manual
 * Recording → Process Recording, or `npm run manual-recording:process`).
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json automation/manual-recording-to-enterprise.ts
 *
 * Output:
 *   out/<slug>/manual-recording/demo-package.json           — EnterpriseVideo package
 *   out/<slug>/manual-recording/enterprise-voice-script.json — matching voice script
 *   out/<slug>/manual-recording/normalized-muted.mp4         — audio-stripped source clip
 *   out/<slug>/manual-recording/voice-segments-enterprise/    — narration MP3s
 *   out/<slug>/manual-recording/enterprise-video.mp4          — final rendered video
 *
 * Preview: open "ManualRecordingEnterpriseVideo" in Remotion Studio.
 */

import * as fs        from 'fs';
import * as path      from 'path';
import * as dotenv    from 'dotenv';
import { execSync }   from 'child_process';
import { randomUUID } from 'crypto';
import { AzureOpenAI } from 'openai';
import { OUT_DIR, ROOT } from './config';
import type { DetectedScene } from './utils/sceneDetection';
import type {
  RemotionPackage,
  EnterpriseBRollSceneData,
  EnterpriseBenefitSlideData,
  EnterpriseBenefitBullet,
  BenefitIconKey,
  EnterprisePresenterCloseData,
  EnterprisePresenterConfig,
  RemotionScene,
} from '../src/core/domain/entities/RemotionPackage';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

// ─── Config ─────────────────────────────────────────────────────────────────

const PRODUCT_NAME = process.env['APP_PRODUCT_NAME'] || 'Product';
const APP_CONTEXT   = process.env['APP_CONTEXT_TEXT'] ?? '';
const LOCALE        = process.env['APP_LANGUAGE'] ?? 'en';

const FPS = 30;
const BROLL_SCENE_SEC      = 6;
const BROLL_SCENE_COUNT    = 3;
const BENEFIT_SLIDE_SEC    = 18;
const PRESENTER_CLOSE_SEC  = 16;
const SYNTHETIC_BUFFER_SEC = 2.0; // headroom added once actual TTS length is known

const MR_DIR             = path.join(OUT_DIR, 'manual-recording');
const SCENES_JSON_PATH   = path.join(MR_DIR, 'scenes.json');
const BASE_VOICE_SCRIPT  = path.join(MR_DIR, 'voice-script.json');
const NORMALIZED_PATH    = path.join(MR_DIR, 'normalized.mp4');
const MUTED_PATH          = path.join(MR_DIR, 'normalized-muted.mp4');
const SCENE_FRAME_DIR     = path.join(MR_DIR, 'scene-frames');
const BASE_VOICE_SEG_DIR  = path.join(MR_DIR, 'voice-segments');

const ENT_PKG_PATH          = path.join(MR_DIR, 'demo-package.json');
const ENT_VOICE_SCRIPT_PATH = path.join(MR_DIR, 'enterprise-voice-script.json');
const ENT_VOICE_DIR_NAME    = 'manual-recording/voice-segments-enterprise'; // relative to OUT_DIR (Studio's public-dir)
const ENT_VOICE_DIR         = path.join(OUT_DIR, ENT_VOICE_DIR_NAME);
const ENT_TMP_SCRIPT_PATH   = path.join(ENT_VOICE_DIR, '_synthetic-voice-script.json');
const ENT_OUTPUT_VIDEO      = path.join(MR_DIR, 'enterprise-video.mp4');

const PRESENTER_SRC_REL = 'assets/presenter/presenter-default.png';

// ─── Types read from disk ───────────────────────────────────────────────────

interface BaseVoiceSegment {
  id: string; label?: string; startSec: number; durationSec: number;
  text: string; enabled?: boolean;
}
interface BaseVoiceScript {
  voice: string; model: string; speed: number; locale?: string;
  segments: BaseVoiceSegment[];
}

// ─── ffmpeg / ffprobe (Remotion's bundled copies) ──────────────────────────

function findBin(name: 'ffmpeg' | 'ffprobe'): string {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const candidates = [
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-win32-x64-msvc', exe),
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-darwin-arm64',   exe),
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-darwin-x64',     exe),
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-linux-x64-gnu',  exe),
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-linux-arm64-gnu', exe),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error(`Could not find Remotion bundled ${name}. Run \`npm install\` then try again.`);
}

function getMp3DurationSec(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0;
  const out = execSync(`"${findBin('ffprobe')}" -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`, { encoding: 'utf-8' });
  const dur = parseFloat(out.trim());
  return isNaN(dur) ? 0 : dur;
}

/** Strips markdown emphasis/bullet characters an LLM sometimes adds despite plain-text instructions. */
function stripMarkdown(text: string): string {
  return text.replace(/\*\*/g, '').replace(/^[-*]\s+/, '').trim();
}

/** Trim a sentence to at most maxWords, stripping a trailing dangling connector. */
function firstWords(sentence: string, maxWords: number): string {
  const words = sentence.trim().split(/\s+/);
  if (words.length <= maxWords) return sentence.trim();
  const clipped = words.slice(0, maxWords).join(' ');
  return clipped.replace(/\s+(and|or|but|for|to|of|in|on|the|a|an)$/i, '');
}

// ─── AI enterprise copy (B-roll subtitles, benefit bullets, closing tagline) ─

interface EnterpriseCopy {
  brollSubtitles: string[];
  benefitBullets: { label: string; description: string }[];
  tagline: string;
}

const ICON_CYCLE: BenefitIconKey[] = ['speed', 'accuracy', 'oversight', 'revenue', 'compliance'];

function fallbackCopy(): EnterpriseCopy {
  return {
    brollSubtitles: [
      `Managing ${PRODUCT_NAME.toLowerCase()} is complex`,
      `Teams need accurate, up-to-date information to act`,
      `Manual processes consume valuable time every day`,
    ],
    benefitBullets: [
      { label: 'Faster Processing',    description: 'Reduces manual effort from hours to minutes.' },
      { label: 'Improved Accuracy',    description: 'Correct data for every record, minimising errors.' },
      { label: 'Human Oversight',      description: 'Critical review points keep your team in control.' },
      { label: 'Revenue Protection',   description: 'Accurate records reduce rejections and delays.' },
      { label: 'Seamless Integration', description: 'Works directly within your existing systems.' },
    ],
    tagline: `See how ${PRODUCT_NAME} simplifies your workflow`,
  };
}

async function generateEnterpriseCopy(narrationExcerpt: string): Promise<EnterpriseCopy> {
  const apiKey   = process.env['AZURE_OPENAI_API_KEY'];
  const endpoint = process.env['AZURE_OPENAI_ENDPOINT'];
  if (!apiKey || !endpoint) {
    console.warn('  ⚠️  No Azure OpenAI credentials — using generic fallback copy.');
    return fallbackCopy();
  }

  const client = new AzureOpenAI({
    apiKey, endpoint,
    deployment: process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
    apiVersion: process.env['OPENAI_API_VERSION'] ?? '2024-12-01-preview',
  });

  const prompt =
    `You are writing B2B marketing copy for an enterprise product demo video for "${PRODUCT_NAME}".\n\n` +
    (APP_CONTEXT ? `PRODUCT CONTEXT:\n${APP_CONTEXT.slice(0, 1000)}\n\n` : '') +
    `TRANSCRIPT EXCERPT (from a real walkthrough recording of the product):\n${narrationExcerpt.slice(0, 2500)}\n\n` +
    `Return ONLY valid JSON with this exact shape:\n` +
    `{\n` +
    `  "brollSubtitles": ["<=12 words each, 3 short cinematic problem-statement lines, no product name>", "...", "..."],\n` +
    `  "benefitBullets": [{"label": "2-4 word label", "description": "one sentence customer-outcome benefit"}, ... 5 items],\n` +
    `  "tagline": "<=10 word closing line, may include the product name"\n` +
    `}\n` +
    `Plain text only in every field — no markdown, no asterisks, no bullet characters.`;

  try {
    const response = await client.chat.completions.create({
      model:                 process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
      max_completion_tokens: 1600,
      reasoning_effort:      'low',
      messages: [{ role: 'user', content: prompt }],
    });

    const choice = response.choices[0];
    const raw = (choice?.message?.content ?? '').trim();
    if (!raw) {
      console.warn(`  ⚠️  Enterprise copy generation returned empty content (finish_reason: ${choice?.finish_reason}) — using fallback copy.`);
      return fallbackCopy();
    }

    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
    const parsed = JSON.parse(cleaned) as EnterpriseCopy;
    if (!Array.isArray(parsed.brollSubtitles) || !Array.isArray(parsed.benefitBullets) || !parsed.tagline) {
      console.warn('  ⚠️  Enterprise copy JSON missing expected fields — using fallback copy.');
      return fallbackCopy();
    }
    return {
      brollSubtitles: parsed.brollSubtitles.map(stripMarkdown),
      benefitBullets: parsed.benefitBullets.map(b => ({ label: stripMarkdown(b.label), description: stripMarkdown(b.description) })),
      tagline: stripMarkdown(parsed.tagline),
    };
  } catch (err) {
    console.warn(`  ⚠️  Enterprise copy generation failed: ${(err as Error).message} — using fallback copy.`);
    return fallbackCopy();
  }
}

// ─── generate-voice.ts invocation for the 5 synthetic segments ─────────────

function synthesizeNewSegments(copy: EnterpriseCopy, voice: string, model: string, speed: number): void {
  fs.mkdirSync(ENT_VOICE_DIR, { recursive: true });

  const benefitSpoken = copy.benefitBullets.map(b => `${b.label}. ${b.description}`).join(' ');

  const segments: BaseVoiceSegment[] = [
    ...copy.brollSubtitles.map((text, i) => ({
      id: `broll-${i}`, label: `B-roll ${i + 1}`, startSec: i * BROLL_SCENE_SEC, durationSec: BROLL_SCENE_SEC, text, enabled: true,
    })),
    { id: 'benefit-slide',   label: 'Benefit slide',   startSec: 0, durationSec: BENEFIT_SLIDE_SEC,   text: benefitSpoken,  enabled: true },
    { id: 'presenter-close', label: 'Presenter close', startSec: 0, durationSec: PRESENTER_CLOSE_SEC, text: copy.tagline,   enabled: true },
  ];

  const tempScript = {
    voice, model, speed, fps: FPS, locale: LOCALE,
    voiceDir: ENT_VOICE_DIR_NAME,
    totalDurationSec: BROLL_SCENE_SEC * BROLL_SCENE_COUNT + BENEFIT_SLIDE_SEC + PRESENTER_CLOSE_SEC,
    segments,
  };
  fs.writeFileSync(ENT_TMP_SCRIPT_PATH, JSON.stringify(tempScript, null, 2), 'utf-8');

  console.log('  🎙️   Synthesizing B-roll / benefit-slide / presenter-close narration…');
  execSync(
    `npx ts-node --project tsconfig.scripts.json automation/generate-voice.ts ` +
    `--script "${ENT_TMP_SCRIPT_PATH}" --output "${path.join(ENT_VOICE_DIR, '_unused.mp4')}" --no-merge --no-sync`,
    { cwd: ROOT, stdio: 'inherit' },
  );

  fs.rmSync(ENT_TMP_SCRIPT_PATH, { force: true });
}

// ─── Scoped public-dir for rendering ────────────────────────────────────────
//
// `remotion render` (unlike Studio's live dev server) copies the entire
// --public-dir into a temp bundle before each invocation. Pointing it at the
// full OUT_DIR (product root) means re-copying every other feature's output
// too (agent-recording, the automated Enterprise run's own demo-video.mp4,
// raw uploads, log files, …) — multiple GB, on every single chunk — and it
// broke outright on a stale leftover file in an unrelated _tmp_rec/ folder.
// Mirroring just the handful of files this composition actually references
// (via hardlink for the large media so it's instant and uses no extra disk)
// avoids both problems.

const RENDER_PUBLIC_DIR = path.join(MR_DIR, '_render-public');

function linkOrCopy(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) return;
  try {
    fs.linkSync(src, dest);
  } catch {
    fs.copyFileSync(src, dest);
  }
}

function buildScopedPublicDir(): string {
  const root = RENDER_PUBLIC_DIR;
  linkOrCopy(MUTED_PATH, path.join(root, 'manual-recording', 'normalized-muted.mp4'));
  linkOrCopy(ENT_PKG_PATH, path.join(root, 'manual-recording', 'demo-package.json'));
  linkOrCopy(ENT_VOICE_SCRIPT_PATH, path.join(root, 'manual-recording', 'enterprise-voice-script.json'));

  if (fs.existsSync(SCENE_FRAME_DIR)) {
    for (const f of fs.readdirSync(SCENE_FRAME_DIR)) {
      linkOrCopy(path.join(SCENE_FRAME_DIR, f), path.join(root, 'manual-recording', 'scene-frames', f));
    }
  }
  if (fs.existsSync(ENT_VOICE_DIR)) {
    for (const f of fs.readdirSync(ENT_VOICE_DIR)) {
      if (!f.endsWith('.mp3')) continue; // skip mix-filter.txt / narration leftovers
      linkOrCopy(path.join(ENT_VOICE_DIR, f), path.join(root, 'manual-recording', 'voice-segments-enterprise', f));
    }
  }

  const globalAssets = path.join(ROOT, 'public', 'assets');
  if (fs.existsSync(globalAssets)) {
    for (const f of fs.readdirSync(globalAssets)) {
      const src = path.join(globalAssets, f);
      if (fs.statSync(src).isFile()) linkOrCopy(src, path.join(root, 'assets', f));
    }
  }
  if (fs.existsSync(path.join(ROOT, 'public', PRESENTER_SRC_REL))) {
    linkOrCopy(path.join(ROOT, 'public', PRESENTER_SRC_REL), path.join(root, PRESENTER_SRC_REL));
  }

  return root;
}

// ─── Chunked render (mirrors render-demo.ts's OOM-avoidance approach) ───────

function renderEnterpriseVideo(totalFrames: number): void {
  const ffmpeg = findBin('ffmpeg');
  const publicDirFwd = buildScopedPublicDir().replace(/\\/g, '/');
  const outputFwd     = ENT_OUTPUT_VIDEO.replace(/\\/g, '/');
  // Wider than render-demo.ts's 150-frame default: that size guards against many
  // rapid-fire Ken-Burns screenshot transitions piling up in memory, which doesn't
  // apply here — each product scene is one long real video clip streamed via
  // OffthreadVideo, so a much bigger chunk is safe and cuts the number of Chrome
  // cold-starts drastically on a recording this long.
  const CHUNK_SIZE = 900; // 30s @ 30fps

  const numChunks = Math.ceil(totalFrames / CHUNK_SIZE);
  console.log(`\n  Rendering ${numChunks} chunk(s) of ≤${CHUNK_SIZE} frames…\n`);

  const segmentPaths: string[] = [];
  for (let i = 0; i < numChunks; i++) {
    const from = i * CHUNK_SIZE;
    const to   = Math.min((i + 1) * CHUNK_SIZE - 1, totalFrames - 1);
    const segFile    = path.join(MR_DIR, `_ent-segment-${String(i).padStart(3, '0')}.mp4`);
    const segFileFwd = segFile.replace(/\\/g, '/');
    segmentPaths.push(segFile);

    if (fs.existsSync(segFile) && fs.statSync(segFile).size > 10_000) {
      console.log(`  ── Chunk ${i + 1}/${numChunks}  frames ${from}–${to}  [SKIPPED — already rendered]`);
      continue;
    }

    console.log(`  ── Chunk ${i + 1}/${numChunks}  frames ${from}–${to} ──`);
    const cmd = [
      `npx remotion render ManualRecordingEnterpriseVideo "${segFileFwd}"`,
      '--codec=h264', '--crf=23',
      `--public-dir="${publicDirFwd}"`,
      '--concurrency=1', '--timeout=120000', '--port=4002',
      `--frames=${from}-${to}`,
    ].join(' ');
    console.log(`  $ ${cmd}\n`);
    try {
      execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
    } catch {
      console.error(`\n  ✗  Chunk ${i + 1} failed — run again to resume (completed chunks are skipped).`);
      process.exit(1);
    }
  }

  console.log('\n  Concatenating chunks with FFmpeg…');
  const concatListPath = path.join(MR_DIR, '_ent-concat.txt');
  fs.writeFileSync(concatListPath, segmentPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'), 'utf-8');
  if (fs.existsSync(ENT_OUTPUT_VIDEO)) fs.unlinkSync(ENT_OUTPUT_VIDEO);
  execSync(
    `"${ffmpeg}" -f concat -safe 0 -i "${concatListPath.replace(/\\/g, '/')}" -c copy -movflags +faststart "${outputFwd}"`,
    { cwd: ROOT, stdio: 'inherit' },
  );

  segmentPaths.forEach(p => { try { fs.unlinkSync(p); } catch { /* ignore */ } });
  fs.rmSync(concatListPath, { force: true });
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  🏢  Manual Recording → Enterprise video');
  console.log('══════════════════════════════════════════════════════════════\n');

  for (const [label, p] of [['scenes.json', SCENES_JSON_PATH], ['voice-script.json', BASE_VOICE_SCRIPT], ['normalized.mp4', NORMALIZED_PATH]] as const) {
    if (!fs.existsSync(p)) {
      console.error(`  ✗  ${label} not found at ${p}`);
      console.error('     Run Manual Recording processing first (Config UI → Manual Recording → Process Recording).');
      process.exit(1);
    }
  }

  const scenes: DetectedScene[] = JSON.parse(fs.readFileSync(SCENES_JSON_PATH, 'utf-8'));
  const baseScript: BaseVoiceScript = JSON.parse(fs.readFileSync(BASE_VOICE_SCRIPT, 'utf-8'));
  const baseSegById = new Map(baseScript.segments.map(s => [s.id, s]));

  // ── Muted copy of the source recording (product scenes never carry the
  //    original mic/system audio — only the synthesized narration should play) ──
  if (!fs.existsSync(MUTED_PATH)) {
    console.log('  🔇  Stripping audio from normalized.mp4 for use as scene footage…');
    execSync(`"${findBin('ffmpeg')}" -y -i "${NORMALIZED_PATH}" -c:v copy -an "${MUTED_PATH}"`, { stdio: 'ignore' });
  }

  // ── AI (or fallback) enterprise copy ─────────────────────────────────────
  const narrationExcerpt = scenes
    .slice(0, 8)
    .map(s => baseSegById.get(`mr-scene-${s.index + 1}`)?.text ?? '')
    .filter(Boolean)
    .join(' ');
  console.log('  🤖  Generating B-roll / benefit / tagline copy…');
  const copy = await generateEnterpriseCopy(narrationExcerpt);

  // ── Timeline: brollScenes → scenes (real footage) → benefitSlide → presenterClose ──
  const brollDurationFrames = BROLL_SCENE_SEC * FPS;
  let brollScenes: EnterpriseBRollSceneData[] = copy.brollSubtitles.slice(0, BROLL_SCENE_COUNT).map((subtitle, i) => ({
    id: `broll-${i}`, from: i * brollDurationFrames, durationInFrames: brollDurationFrames, subtitle,
  }));

  let cursor = brollScenes.length * brollDurationFrames;
  const productScenes: (RemotionScene & { recordingPath: string; recordingStartSec: number })[] = scenes.map((scene, i) => {
    const baseSeg = baseSegById.get(`mr-scene-${scene.index + 1}`);
    const durationInFrames = Math.round(Math.max(2, scene.durationSec) * FPS);
    const from = cursor;
    cursor += durationInFrames;
    const narration = baseSeg?.text ?? '';
    return {
      id: `scene-${i + 1}`, from, durationInFrames,
      pageId: `mr-scene-${scene.index + 1}`,
      title: baseSeg?.label ?? `Scene ${i + 1}`,
      narration,
      salesHook: firstWords(narration, 10),
      description: '',
      screenshotPath:     `manual-recording/scene-frames/scene-${String(scene.index).padStart(2, '0')}.png`,
      fullScreenshotPath: `manual-recording/scene-frames/scene-${String(scene.index).padStart(2, '0')}.png`,
      highlightTarget: { elementType: 'default', region: 'full', description: '' },
      transition: null,
      nodeType: 'page',
      recordingPath: 'manual-recording/normalized-muted.mp4',
      recordingStartSec: scene.startSec,
    };
  });

  let benefitSlide: EnterpriseBenefitSlideData = {
    from: cursor, durationInFrames: BENEFIT_SLIDE_SEC * FPS,
    title: `${PRODUCT_NAME} — Value Adds`,
    bullets: copy.benefitBullets.slice(0, 5).map((b, i): EnterpriseBenefitBullet => ({
      icon: ICON_CYCLE[i % ICON_CYCLE.length] ?? 'default', label: b.label, description: b.description,
    })),
  };
  cursor += benefitSlide.durationInFrames;

  const presenterAvailable = fs.existsSync(path.join(ROOT, 'public', PRESENTER_SRC_REL));
  let presenterClose: EnterprisePresenterCloseData = {
    from: cursor, durationInFrames: PRESENTER_CLOSE_SEC * FPS,
    tagline: copy.tagline,
    presenterSrc: presenterAvailable ? PRESENTER_SRC_REL : '',
  };
  cursor += presenterClose.durationInFrames;

  const presenterConfig: EnterprisePresenterConfig = presenterAvailable
    ? { src: PRESENTER_SRC_REL, widthFraction: 0.15, position: 'bottom-left' }
    : { src: '', widthFraction: 0, position: 'bottom-left' };

  // ── Synthesize the 5 new narration segments, then stretch their scenes to
  //    actually fit the recorded speech (real footage scenes stay fixed) ────
  synthesizeNewSegments(copy, baseScript.voice, baseScript.model, baseScript.speed);

  const brollActual   = brollScenes.map((_, i) => getMp3DurationSec(path.join(ENT_VOICE_DIR, `broll-${i}.mp3`)));
  const benefitActual = getMp3DurationSec(path.join(ENT_VOICE_DIR, 'benefit-slide.mp3'));
  const presenterActual = getMp3DurationSec(path.join(ENT_VOICE_DIR, 'presenter-close.mp3'));

  brollScenes = brollScenes.map((b, i) => {
    const actual = brollActual[i];
    const durationInFrames = actual > 0 ? Math.ceil((actual + SYNTHETIC_BUFFER_SEC) * FPS) : b.durationInFrames;
    return { ...b, durationInFrames };
  });
  let liveCursor = 0;
  brollScenes = brollScenes.map(b => { const from = liveCursor; liveCursor += b.durationInFrames; return { ...b, from }; });

  const shiftedScenes = productScenes.map(s => { const from = liveCursor; liveCursor += s.durationInFrames; return { ...s, from }; });

  const benefitDurationInFrames = benefitActual > 0 ? Math.ceil((benefitActual + SYNTHETIC_BUFFER_SEC) * FPS) : benefitSlide.durationInFrames;
  benefitSlide = { ...benefitSlide, from: liveCursor, durationInFrames: benefitDurationInFrames };
  liveCursor += benefitDurationInFrames;

  const presenterDurationInFrames = presenterActual > 0 ? Math.ceil((presenterActual + SYNTHETIC_BUFFER_SEC) * FPS) : presenterClose.durationInFrames;
  presenterClose = { ...presenterClose, from: liveCursor, durationInFrames: presenterDurationInFrames };
  liveCursor += presenterDurationInFrames;

  const totalFrames = liveCursor;

  // ── Copy the already-synthesized per-scene MP3s into the enterprise voice dir ──
  shiftedScenes.forEach((scene, i) => {
    const src = path.join(BASE_VOICE_SEG_DIR, `mr-scene-${scenes[i].index + 1}.mp3`);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(ENT_VOICE_DIR, `${scene.id}.mp3`));
  });

  // ── Write demo-package.json ──────────────────────────────────────────────
  const pkg: RemotionPackage = {
    schemaVersion: '1.0',
    id: randomUUID(),
    meta: {
      productName: PRODUCT_NAME, targetAudience: '', primaryBenefit: '',
      totalDurationSec: totalFrames / FPS, totalScenes: shiftedScenes.length,
      narrativeArc: '', generatedAt: new Date().toISOString(), journeyId: '', storyboardId: '',
      templateId: 'enterprise',
    },
    composition: { id: 'EnterpriseVideo', fps: FPS, width: 1920, height: 1080, durationInFrames: totalFrames },
    openingCard: { from: 0, durationInFrames: brollScenes[0]?.durationInFrames ?? brollDurationFrames, title: PRODUCT_NAME, subtitle: 'Product Walkthrough', backgroundColor: '#0a0f1a' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    scenes: shiftedScenes as any,
    closingCard: { from: presenterClose.from, durationInFrames: presenterClose.durationInFrames, callToAction: 'Thanks for watching', productName: PRODUCT_NAME, backgroundColor: '#0a0f1a' },
    brollScenes,
    benefitSlide,
    presenterClose,
    presenterConfig,
    screenFit: 'full',
  };
  fs.writeFileSync(ENT_PKG_PATH, JSON.stringify(pkg, null, 2), 'utf-8');
  console.log(`\n  ✓  ${path.relative(ROOT, ENT_PKG_PATH)} written  (${shiftedScenes.length} scenes, ${(totalFrames / FPS).toFixed(1)}s total)`);

  // ── Write enterprise-voice-script.json ───────────────────────────────────
  const voiceSegments: BaseVoiceSegment[] = [
    ...brollScenes.map((b, i) => ({ id: b.id, label: `B-roll ${i + 1}`, startSec: b.from / FPS + 1, durationSec: (brollActual[i] || BROLL_SCENE_SEC), text: copy.brollSubtitles[i] ?? '', enabled: true })),
    ...shiftedScenes.map((s, i) => {
      const baseSeg = baseSegById.get(`mr-scene-${scenes[i].index + 1}`);
      return { id: s.id, label: s.title, startSec: s.from / FPS + 0.3, durationSec: Math.min(s.durationInFrames / FPS, baseSeg?.durationSec ?? s.durationInFrames / FPS), text: s.narration, enabled: true };
    }),
    { id: 'benefit-slide',   label: 'Benefit slide',   startSec: benefitSlide.from / FPS + 1,   durationSec: benefitActual   || BENEFIT_SLIDE_SEC,   text: copy.benefitBullets.map(b => `${b.label}. ${b.description}`).join(' '), enabled: true },
    { id: 'presenter-close', label: 'Presenter close', startSec: presenterClose.from / FPS + 2, durationSec: presenterActual || PRESENTER_CLOSE_SEC, text: copy.tagline, enabled: true },
  ];
  const voiceScript = {
    voice: baseScript.voice, model: baseScript.model, speed: baseScript.speed, fps: FPS, locale: LOCALE,
    voiceDir: ENT_VOICE_DIR_NAME,
    totalDurationSec: totalFrames / FPS,
    segments: voiceSegments,
    voiceReady: true,
  };
  fs.writeFileSync(ENT_VOICE_SCRIPT_PATH, JSON.stringify(voiceScript, null, 2), 'utf-8');
  console.log(`  ✓  ${path.relative(ROOT, ENT_VOICE_SCRIPT_PATH)} written`);

  if (process.argv.includes('--build-only')) {
    console.log('\n  --build-only set — skipping render. Preview via "ManualRecordingEnterpriseVideo" in Studio,');
    console.log('  or run again without --build-only to render the final MP4.\n');
    return;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  renderEnterpriseVideo(totalFrames);

  const stat = fs.statSync(ENT_OUTPUT_VIDEO);
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  ✅  Done!');
  console.log(`     Video  : ${ENT_OUTPUT_VIDEO}  (${(stat.size / 1_048_576).toFixed(1)} MB)`);
  console.log(`     Studio : open "ManualRecordingEnterpriseVideo" in Remotion Studio`);
  console.log('══════════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('\n  ✗  Error:', (err as Error).message ?? err);
  process.exit(1);
});
