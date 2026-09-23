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
 *   npx ts-node --project tsconfig.scripts.json automation/manual-recording-to-enterprise.ts [options]
 *
 * Options:
 *   --minutes=<N>    Cap the TOTAL video length to ~N minutes by having AI select
 *                     the most important, non-redundant subset of real-footage
 *                     scenes (scored from their existing narration text against
 *                     APP_CONTEXT_TEXT/APP_GLOSSARY/APP_ROUTE_MAP/DEMO_PAIN_POINTS)
 *                     instead of including every detected scene. Omit for the
 *                     full, uncut recording.
 *   --build-only     Write demo-package.json / enterprise-voice-script.json and
 *                     synthesize narration, but skip the final render — preview
 *                     via "ManualRecordingEnterpriseVideo" in Remotion Studio and
 *                     render from there instead.
 *
 * Output:
 *   out/<slug>/manual-recording/demo-package.json           — EnterpriseVideo package
 *   out/<slug>/manual-recording/enterprise-voice-script.json — matching voice script
 *   out/<slug>/manual-recording/normalized-muted.mp4         — audio-stripped source clip
 *   out/<slug>/manual-recording/normalized-muted-cropped.mp4 — above, with the OS taskbar cropped out (used for scene footage; normalized(-muted).mp4 are never modified)
 *   out/<slug>/manual-recording/broll-N.mp4                  — B-roll stock footage (Pexels/Pixabay; requires PEXELS_API_KEY/PIXABAY_API_KEY, else the B-roll scenes fall back to text-only slides)
 *   out/<slug>/manual-recording/voice-segments-enterprise/    — narration MP3s
 *   out/<slug>/manual-recording/enterprise-video.mp4          — final rendered video (unless --build-only)
 *
 * Preview: open "ManualRecordingEnterpriseVideo" in Remotion Studio.
 */

import * as fs        from 'fs';
import * as path      from 'path';
import * as https     from 'https';
import * as http      from 'http';
import * as dotenv    from 'dotenv';
import { execSync }   from 'child_process';
import { randomUUID } from 'crypto';
import { AzureOpenAI } from 'openai';
import { OUT_DIR, ROOT, APP_SLUG } from './config';
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
const APP_GLOSSARY  = process.env['APP_GLOSSARY'] ?? '';
const LOCALE        = process.env['APP_LANGUAGE'] ?? 'en';

// ── Route map / pain points — same JSON-in-env-var convention as record-app-clips.ts.
// A manual recording's scenes aren't tied to specific routes, so these are only used
// as general "what matters in this product" context for the scene-curation prompt below.
const APP_ROUTE_MAP: Record<string, string> = (() => {
  try { return JSON.parse(process.env['APP_ROUTE_MAP'] ?? '{}'); } catch { return {}; }
})();
interface DemoPainPointEntry { workflow?: string; painPoint?: string; ahaMoment?: string }
const DEMO_PAIN_POINTS: Record<string, DemoPainPointEntry> = (() => {
  try { return JSON.parse(process.env['DEMO_PAIN_POINTS'] ?? '{}'); } catch { return {}; }
})();

// ── Optional highlight-reel curation: `--minutes=5` caps the TOTAL video length by
// having AI select the most important, non-redundant subset of real-footage scenes
// instead of including all of them. Omit for the full, uncut recording (default).
const MINUTES_ARG    = process.argv.find(a => a.startsWith('--minutes='));
const TARGET_MINUTES = MINUTES_ARG ? parseFloat(MINUTES_ARG.split('=')[1]) : undefined;

// `--render-only`: skip AI copy/curation/B-roll entirely and render the
// demo-package.json + enterprise-voice-script.json already on disk exactly as
// they are. Use this to render a package you've already previewed and approved
// in Studio — re-running the full pipeline would call the AI curation step
// again, which isn't deterministic and could pick a different scene selection
// than the one you reviewed.
const RENDER_ONLY = process.argv.includes('--render-only');

// ── Verified voice/screen mismatches in this specific recording ─────────────
// Found by extracting real frames at each candidate scene's recordingStartSec
// and comparing them against the narration text — the base per-scene vision
// pass sometimes samples a frame from AFTER a quick multi-click transition
// (so the narration describes where the user ends up, not where the scene's
// timestamp starts), or occasionally mislabels a scene entirely.
//
// Scene index numbers are coincidental to each recording's own cut points —
// applying one product's corrections to a different product's manual
// recording would shift or drop unrelated, unverified scenes. Keyed by
// APP_SLUG so a fresh recording for any other product runs with no
// corrections until it gets its own verification pass.
interface RecordingFixSet {
  /** Nudges recordingStartSec forward (seconds) past a verified-bad lead-in,
   *  for scene indexes (0-based, mr-scene-N -> N-1) where the correct content
   *  only appears partway through the detected scene. */
  startOffsetSec?: Record<number, number>;
  /** Scenes where no offset finds matching content anywhere in the accessible
   *  window — narration doesn't match any real footage. Dropped entirely. */
  excludedIndexes?: number[];
  /** Caps how much of the recorded clip a scene can use, for scenes whose
   *  matching content sits in a narrow window before the recording moves on
   *  to unrelated (or sensitive) content. */
  maxDurationOverrideSec?: Record<number, number>;
  /** Expands ONE detected scene index into several consecutive product scenes,
   *  for a scene whose recorded window actually spans multiple distinct real
   *  pages (rather than one page shown too long). Each entry is a base
   *  voice-script.json segment id (NOT necessarily `mr-scene-N` — a scene that
   *  was split post-hoc into per-page sub-segments, e.g. `mr-scene-19c`, is
   *  looked up directly by that id) with its own real startSec/text already
   *  correct in the base script; recordingStartSec and narration are read
   *  straight from it, so there's nothing else to configure per sub-segment. */
  subSegments?: Record<number, string[]>;
}

const RECORDING_FIXES: Record<string, RecordingFixSet> = {
  'acl-ai-gateway': {
    startOffsetSec: {
      9:  6, // mr-scene-10 "Models catalog"        — starts on Capabilities page for ~6s, then Models Catalog
      15: 9, // mr-scene-16 "Register Application"  — starts on Routing Overrides for ~9s+; offset lands on the Applications list (Register button visible) just before the modal opens
      58: 9, // mr-scene-59 "Cost Optimization"     — starts on Quality Metrics for ~9s, then Cost Optimization
    },
    excludedIndexes: [
      63, // mr-scene-64 "User Management" — narration describes a page never actually shown; real footage at this timestamp is WORM Storage -> Developer Docs -> the recording ending (OBS UI reappears)
    ],
    maxDurationOverrideSec: {
      15: 15, // extending past the offset start runs into an unrelated app's detail page — cap instead of using the full scene.durationSec
    },
  },
  'sdlc-playground': {
    startOffsetSec: {
      1:  23,  // mr-scene-2 "Edit workflow tasks"   — nominal start lingers on Home, then Projects, then a Task-Board detour + back-navigation; offset lands right as the Edit-Fleet360 wizard (Details step) opens
      10: 16,  // mr-scene-11 "Task pipeline view" — starts on the plain task-detail form for ~16s; offset lands on the "AI Orchestration Review" node diagram the narration describes
      16: 8,   // mr-scene-17 "Agent Workspace"    — starts on an empty "Start a conversation" state for ~8s; offset lands once the real chat thread + file panel are populated
    },
    // Every index except {0,1,3,10,16,18} excluded. Two reasons this list is
    // this broad (not just the originally-identified indexes 11-15):
    //  - Indexes 11-15 are a cluster of short (4-30s) near-duplicate glimpses
    //    of the same Task 4 detail page as index 10 (once offset, index 10
    //    shows the AI Orchestration Review diagram — the one genuinely
    //    distinctive moment in this span). The AI curation step is supposed
    //    to catch this kind of redundancy itself but isn't reliable
    //    run-to-run — exclude outright rather than risk a repetitive pick.
    //  - The remaining indexes are excluded so curation has nothing left to
    //    choose from except the 6 verified-good scenes above: --minutes
    //    curation calls an LLM to score/select scenes, which is NOT
    //    deterministic (confirmed: identical input produced a different
    //    scene subset across runs during this recording's verification,
    //    including once reintroducing an already-excluded redundant scene).
    //    With only these 6 candidates left, curation's own "already fits
    //    budget, keep all" short-circuit applies with no AI call needed.
    excludedIndexes: [2, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 17, 19, 20, 21],
    // Index 18 ("Controls: Sanitization" by its original single-block label)
    // is really a multi-page, 266s-long governance/compliance tour — a
    // separate concurrent audit of the base ManualRecordingVideo pipeline
    // first split this into per-page sub-segments (out/sdlc-playground/
    // manual-recording/voice-script.json's mr-scene-19a..h) with estimated
    // boundaries. Re-verified those boundaries directly against the cropped
    // video for this bridge and found the estimates drifted 15-50s in
    // several places (e.g. claimed "Data Flow 410-460s" — the real Data Flow
    // page only appears for ~12s, at 463-475s; the 410-463s gap is actually
    // Governance Overview continuing, then an entire additional page, AI
    // Activity, that the original audit missed). Corrected startSec values
    // directly in voice-script.json, shortened Data Flow's and Policies'
    // narration to fit their real (much narrower) windows, and added a new
    // mr-scene-19c2 segment for AI Activity — a live filterable call ledger
    // with sanitization drill-down, compelling governance content in its own
    // right. Real sequence now: Governance Overview (390-415s) -> AI
    // Activity (415-463s) -> Data Flow (463-475s) -> Controls/Policies
    // (475-493s) -> Controls/Sanitization (493-505s) -> Controls/Budgets
    // (505-544s) -> Reports/compliance mapping (544-615s, HIPAA/NIST/
    // ISO42001/EU AI Act mapping). Originally this bridge only showed a
    // single 13s slice of the Sanitization sub-page — nowhere near enough to
    // represent this product's actual governance depth for a customer-facing
    // demo. Expanded to 7 consecutive scenes covering everything under the
    // app's own "GOVERNANCE" nav section; MCP Tools/Settings are skipped as
    // "PLATFORM" nav items, not governance content.
    subSegments: {
      18: [
        'mr-scene-19c',  // Governance Overview
        'mr-scene-19c2', // AI Activity
        'mr-scene-19d',  // Data Flow
        'mr-scene-19e',  // Controls: Policies
        'mr-scene-19f',  // Controls: Sanitization
        'mr-scene-19g',  // Controls: Budgets
        'mr-scene-19h',  // Reports (compliance mapping)
      ],
    },
  },
  'clinivox': {
    startOffsetSec: {
      0: 12, // mr-scene-1 "OpenEMR Login" — starts on Clinivox's own Gateway/EHR-picker page
             // (and a ~1.5s launch-transition) for ~12s before OpenEMR's actual login page
             // appears; the scene's narration opens with "starts with a familiar login —
             // OpenEMR", so offset lands directly on the OpenEMR login form instead.
    },
    // mr-scene-5 "Visit Details" is a single 106s real-footage window (new-visit form ->
    // encounter saved -> dashboard reload with overdue reminders -> "SMART Enabled Apps"
    // section -> Launch, Clinivox SMART App V2 -> "Connecting to EHR" handoff). The base
    // narration (184 words, ~71s audio) was written to describe the WHOLE sequence
    // including the Launch button and EHR handoff, but at that length + the pipeline's
    // 3s buffer it only reached ~74s into the window — cutting the clip off in the middle
    // of the new-encounter form, well before the SMART launch it narrates ever appears on
    // screen. Rather than an offset (there's no dead time to skip — every beat the
    // narration describes is real, sequential content), the fix was to rewrite
    // mr-scene-5's narration in voice-script.json to be long enough (256 words, ~100.4s
    // audio) that duration = min(106, audio+3) reaches ~103.4s, landing past the Launch
    // button and into the "Connecting to EHR" transition. No RECORDING_FIXES field
    // exists for "narration must be long enough to reach a payoff" — this is a content
    // fix in voice-script.json itself, not a config value here. Noted for future re-runs:
    // if mr-scene-5's narration is ever rewritten again, re-verify against real frames at
    // recordingStartSec+~96s (the Launch button) and +~101s (EHR connecting) before
    // trusting a shorter draft.
  },
};

const ACTIVE_FIXES: RecordingFixSet = RECORDING_FIXES[APP_SLUG] ?? {};
const SCENE_START_OFFSET_SEC: Record<number, number> = ACTIVE_FIXES.startOffsetSec ?? {};
const EXCLUDED_SCENE_INDEXES = new Set<number>(ACTIVE_FIXES.excludedIndexes ?? []);

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
// Crops the OS taskbar baked into the bottom of the raw recording, then scales
// back up to fill the frame. A NEW file, never overwriting normalized(-muted).mp4,
// so the original capture is always still available if this crop ever needs to
// be redone with different values.
const CROPPED_MUTED_PATH = path.join(MR_DIR, 'normalized-muted-cropped.mp4');
// Measured directly off this recording's raw bottom-strip pixels (binary-searched
// crop heights against the actual taskbar edge, not assumed) — the taskbar's real
// height is ~56-58px on this 1920x1080 capture, not the round-number 40px value
// used (and under-measured) for a previous recording. A too-small value here
// leaves a visible sliver of taskbar baked into the video. If reusing this
// script for a new recording, re-measure rather than trusting this constant —
// taskbar height can vary with Windows DPI/scale settings between captures.
const TASKBAR_CROP_PX    = 60;
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
  /** Short (2-5 word) Pexels/Pixabay search phrases, one per brollSubtitle — used to find real stock footage. */
  brollSearchQueries: string[];
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
    brollSearchQueries: [
      'server room data center technology',
      'software engineer reviewing code screens',
      'software team collaborating office monitors',
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
    `  "brollSearchQueries": ["2-5 word Pexels/Pixabay stock-video search phrase visually matching brollSubtitles[0]", "...matching [1]", "...matching [2]"],\n` +
    `  "benefitBullets": [{"label": "2-4 word label", "description": "one sentence customer-outcome benefit"}, ... 5 items],\n` +
    `  "tagline": "<=10 word closing line, may include the product name"\n` +
    `}\n` +
    `brollSearchQueries must be concrete, real-world, filmable scenes (e.g. "team analyzing data screens", not abstract concepts) — they drive an actual stock-footage search, not narration.\n` +
    `brollSearchQueries must read as premium, modern enterprise/technology footage: server rooms and data centers, engineers reviewing code or dashboards on large monitors, sleek corporate offices with screens visible, software teams collaborating around a monitor. ` +
    `Do NOT use queries likely to return: face masks or pandemic-era imagery, casual/lifestyle settings (cafes, lounges, colorful furniture), stock-photo cliches like "business people smiling at camera", or anything unrelated to software/technology work. ` +
    `Do NOT use queries likely to return "hacker"/cybercrime imagery — dark hoodie silhouettes, red-lit rooms, "encrypting"/"password cracking" overlay graphics, or anything implying malicious/illegal activity; this product PREVENTS that, it doesn't depict it. ` +
    `Do NOT use queries likely to return generic CCTV/surveillance-camera-wall footage (traffic cameras, security guard monitoring a bank of screens) — irrelevant to AI software governance. ` +
    `Do NOT use queries likely to return footage with a visible real-world brand name, logo, or watermark (e.g. a named stock ticker app, a specific company's dashboard) — must be generic/unbranded screens only.\n` +
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
    const fallbackQueries = fallbackCopy().brollSearchQueries;
    return {
      brollSubtitles: parsed.brollSubtitles.map(stripMarkdown),
      brollSearchQueries: Array.isArray(parsed.brollSearchQueries) && parsed.brollSearchQueries.length > 0
        ? parsed.brollSearchQueries.map(stripMarkdown)
        : fallbackQueries,
      benefitBullets: parsed.benefitBullets.map(b => ({ label: stripMarkdown(b.label), description: stripMarkdown(b.description) })),
      tagline: stripMarkdown(parsed.tagline),
    };
  } catch (err) {
    console.warn(`  ⚠️  Enterprise copy generation failed: ${(err as Error).message} — using fallback copy.`);
    return fallbackCopy();
  }
}

// ─── B-roll stock video download (Pexels → Pixabay fallback) ───────────────
//
// Without this, brollScenes have no videoPath and EnterpriseVideo.tsx falls
// back to EnterpriseBRollScene — a plain dark-gradient title card with just
// the subtitle text, no footage. This mirrors download-broll-videos.ts's core
// Pexels/Pixabay logic (same env vars: PEXELS_API_KEY, PIXABAY_API_KEY), but
// writes into manual-recording/ instead of the product-root recordings/ dir,
// since that script hardcodes paths this bridge doesn't share.

interface PexelsVideoFile { link: string; width: number; quality: string }
interface PexelsVideo     { id: number; video_files: PexelsVideoFile[] }
interface PixabayVideoHit { videos: { large?: { url: string }; medium?: { url: string } } }

function fetchJson(url: string, headers: Record<string, string> = {}, timeoutMs = 30000): Promise<any> {
  return new Promise((resolve, reject) => {
    const agent  = new https.Agent({ rejectUnauthorized: false });
    const parsed = new URL(url);
    const req = https.get({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers: { 'User-Agent': 'VideoGenerator/1.0', ...headers }, agent }, res => {
      let data = '';
      res.on('data', (c: Buffer) => { data += c.toString(); });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
  });
}

function downloadViaHttps(url: string, destPath: string, timeoutMs = 120000): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const agent = new https.Agent({ rejectUnauthorized: false });
    function get(currentUrl: string): void {
      const parsed  = new URL(currentUrl);
      const client  = currentUrl.startsWith('https') ? https : http;
      const req = client.get({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers: { 'User-Agent': 'VideoGenerator/1.0' }, agent: currentUrl.startsWith('https') ? agent : undefined }, res => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) { res.resume(); return get(res.headers.location); }
        if (status !== 200) { res.resume(); return reject(new Error(`HTTP ${status}`)); }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', err => { try { fs.unlinkSync(destPath); } catch {} reject(err); });
      });
      req.setTimeout(timeoutMs, () => req.destroy(new Error('Download timeout')));
      req.on('error', reject);
    }
    get(url);
  });
}

function pickBestFile(files: PexelsVideoFile[]): PexelsVideoFile | null {
  return files.find(f => f.quality === 'hd' && f.width >= 1280) ?? files.find(f => f.width >= 854) ?? files[0] ?? null;
}

async function pexelsSearch(query: string, usedIds: Set<number>): Promise<PexelsVideo | null> {
  const apiKey = process.env['PEXELS_API_KEY'];
  if (!apiKey) return null;
  try {
    const url  = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape&size=medium`;
    const data = await fetchJson(url, { Authorization: apiKey }) as { videos: PexelsVideo[] };
    const videos = data.videos ?? [];
    return videos.find(v => !usedIds.has(v.id)) ?? videos[0] ?? null;
  } catch { return null; }
}

async function pixabaySearch(query: string, usedUrls: Set<string>): Promise<string | null> {
  const apiKey = process.env['PIXABAY_API_KEY'];
  if (!apiKey) return null;
  try {
    const url  = `https://pixabay.com/api/videos/?key=${apiKey}&q=${encodeURIComponent(query)}&per_page=5&video_type=film`;
    const data = await fetchJson(url) as { hits: PixabayVideoHit[] };
    const urlOf = (h: PixabayVideoHit) => h.videos.large?.url ?? h.videos.medium?.url ?? null;
    for (const hit of data.hits ?? []) {
      const u = urlOf(hit);
      if (u && !usedUrls.has(u)) return u;
    }
    return data.hits?.[0] ? urlOf(data.hits[0]) : null;
  } catch { return null; }
}

/** Downloads one stock video per query into MR_DIR; returns a relative videoPath
 *  (for demo-package.json, relative to OUT_DIR) per index, or undefined on failure —
 *  callers fall back to the plain text-only B-roll slide for that scene. */
async function downloadBrollVideos(queries: string[]): Promise<(string | undefined)[]> {
  if (!process.env['PEXELS_API_KEY'] && !process.env['PIXABAY_API_KEY']) {
    console.warn('  ⚠️  No PEXELS_API_KEY/PIXABAY_API_KEY — B-roll scenes will show subtitle slides only.');
    return queries.map(() => undefined);
  }

  const usedPexelsIds   = new Set<number>();
  const usedPixabayUrls = new Set<string>();
  const results: (string | undefined)[] = [];

  console.log('  🎥  Fetching B-roll stock footage…');
  for (let i = 0; i < queries.length; i++) {
    const id       = `broll-${i}`;
    const destFile = path.join(MR_DIR, `${id}.mp4`);
    const relPath  = `manual-recording/${id}.mp4`;

    if (fs.existsSync(destFile) && fs.statSync(destFile).size > 100_000) {
      console.log(`    [${id}] already downloaded — skipping`);
      results.push(relPath);
      continue;
    }

    process.stdout.write(`    [${id}] "${queries[i]}" … `);
    let ok = false;

    const pexelsVideo = await pexelsSearch(queries[i], usedPexelsIds);
    const pexelsFile  = pexelsVideo ? pickBestFile(pexelsVideo.video_files) : null;
    if (pexelsFile) {
      try {
        await downloadViaHttps(pexelsFile.link, destFile);
        if (fs.statSync(destFile).size < 100_000) throw new Error('too small');
        console.log(`✓ Pexels (${(fs.statSync(destFile).size / 1_000_000).toFixed(1)} MB)`);
        usedPexelsIds.add(pexelsVideo!.id);
        ok = true;
      } catch { /* fall through to Pixabay */ }
    }

    if (!ok) {
      const pixUrl = await pixabaySearch(queries[i], usedPixabayUrls);
      if (pixUrl) {
        try {
          await downloadViaHttps(pixUrl, destFile);
          if (fs.statSync(destFile).size < 100_000) throw new Error('too small');
          console.log(`✓ Pixabay (${(fs.statSync(destFile).size / 1_000_000).toFixed(1)} MB)`);
          usedPixabayUrls.add(pixUrl);
          ok = true;
        } catch { /* leave unset */ }
      }
    }

    if (!ok) { console.log('not available — will show subtitle slide only'); }
    results.push(ok ? relPath : undefined);
  }

  return results;
}

// ─── Highlight-reel curation (--minutes) ────────────────────────────────────
//
// Sends every detected scene's already-generated narration (no re-analysis —
// the base Manual Recording run's per-scene vision pass already produced this
// text) to Azure OpenAI in a single batched call, asking it to score each
// scene's importance and flag near-duplicates, using the same product context/
// glossary/route-map/pain-point config the rest of the pipeline reads from
// .env. Selection itself is deterministic (greedy by score against a real-
// footage second budget), not left to the model's arithmetic.

interface SceneScoreResult {
  index: number;
  importanceScore: number;        // 0-100
  redundantWithIndex: number | null; // an earlier scene index this one repeats, or null
}

async function selectHighlightScenes(
  allScenes: DetectedScene[],
  baseSegById: Map<string, BaseVoiceSegment>,
  targetRealFootageSec: number,
): Promise<DetectedScene[]> {
  // Always open with the app's own sign-in/login moment (if the recording has
  // one) — orients first-time viewers before the detailed feature walkthrough,
  // and in practice its own narration usually already reads as a quick product
  // overview rather than a literal login-flow demo. Exempt from AI scoring
  // entirely so it can't get cut for scoring low as a "feature".
  //
  // Require >= 8s: the very first seconds of a raw screen recording are
  // commonly a setup artifact (e.g. the recording software's own UI still on
  // screen before the app is even focused) that a text-only vision pass can
  // mislabel using surrounding context — confirmed by inspecting actual source
  // frames, where a short leading "Sign In Screen" scene turned out to be the
  // OBS Studio scene-list UI, not the app. A short scene like that isn't
  // trustworthy as a forced intro; a substantial one (the real sign-in page,
  // reliably 15s+ in practice) is.
  const isLoginLabel = (s: DetectedScene) => s.durationSec >= 8 && /sign.?in|log.?in/i.test(baseSegById.get(`mr-scene-${s.index + 1}`)?.label ?? '');
  const forcedScenes = allScenes.filter(isLoginLabel);
  const forcedSec    = forcedScenes.reduce((a, s) => a + s.durationSec, 0);
  const scenes        = allScenes.filter(s => !isLoginLabel(s));
  const targetForRest = Math.max(0, targetRealFootageSec - forcedSec);

  const totalSec = scenes.reduce((a, s) => a + s.durationSec, 0);
  if (totalSec <= targetForRest) {
    console.log(`  ℹ️  Recording (${totalSec.toFixed(0)}s) already fits the ${targetForRest.toFixed(0)}s budget — keeping all ${scenes.length} scene(s) plus the sign-in intro.`);
    return [...forcedScenes, ...scenes].sort((a, b) => a.index - b.index);
  }

  const candidates = scenes.map(s => ({
    index: s.index,
    label: baseSegById.get(`mr-scene-${s.index + 1}`)?.label ?? `Scene ${s.index + 1}`,
    narration: baseSegById.get(`mr-scene-${s.index + 1}`)?.text ?? '',
    durationSec: s.durationSec,
  }));

  let scored: SceneScoreResult[] | null = null;
  const apiKey   = process.env['AZURE_OPENAI_API_KEY'];
  const endpoint = process.env['AZURE_OPENAI_ENDPOINT'];

  if (apiKey && endpoint) {
    try {
      const client = new AzureOpenAI({
        apiKey, endpoint,
        deployment: process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
        apiVersion: process.env['OPENAI_API_VERSION'] ?? '2024-12-01-preview',
      });

      const routeText = Object.entries(APP_ROUTE_MAP).map(([p, d]) => `${p}: ${d}`).join('\n');
      const painPointText = Object.values(DEMO_PAIN_POINTS)
        .filter(p => p.workflow || p.painPoint)
        .map(p => `- ${p.workflow ?? ''} — ${p.painPoint ?? ''} (${p.ahaMoment ?? ''})`)
        .join('\n');
      const sceneList = candidates.map(c => `[${c.index}] (${c.durationSec}s) ${c.label}: ${c.narration}`).join('\n');

      const prompt =
        `You are curating a ${Math.round(targetForRest)}-second highlight reel from a ${Math.round(totalSec)}-second real screen-recording walkthrough of "${PRODUCT_NAME}".\n\n` +
        (APP_CONTEXT ? `PRODUCT CONTEXT:\n${APP_CONTEXT.slice(0, 1200)}\n\n` : '') +
        (APP_GLOSSARY ? `DOMAIN GLOSSARY:\n${APP_GLOSSARY.slice(0, 800)}\n\n` : '') +
        (routeText ? `KEY PLATFORM CAPABILITIES:\n${routeText.slice(0, 1500)}\n\n` : '') +
        (painPointText ? `KNOWN HIGH-VALUE WORKFLOWS TO PRIORITISE IF PRESENT:\n${painPointText.slice(0, 1500)}\n\n` : '') +
        `SCENES (index, duration, label, narration — chronological order):\n${sceneList}\n\n` +
        `Return ONLY valid JSON: {"scenes": [{"index": <number>, "importanceScore": <0-100>, "redundantWithIndex": <earlier index this repeats, or null>}, ...]} — one entry per scene index above, no omissions.\n` +
        `Favor scenes that are visually and functionally distinct and cover core value/workflows matching the context above. Mark a scene as redundant only if it shows essentially the same screen/content as an earlier one.`;

      const response = await client.chat.completions.create({
        model: process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
        max_completion_tokens: 4000,
        reasoning_effort: 'low',
        messages: [{ role: 'user', content: prompt }],
      });

      const raw = (response.choices[0]?.message?.content ?? '').trim();
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
      const parsed = JSON.parse(cleaned) as { scenes: SceneScoreResult[] };
      if (Array.isArray(parsed.scenes) && parsed.scenes.length > 0) scored = parsed.scenes;
    } catch (err) {
      console.warn(`  ⚠️  Scene curation AI call failed: ${(err as Error).message} — falling back to chronological trim.`);
    }
  } else {
    console.warn('  ⚠️  No Azure OpenAI credentials — falling back to chronological trim.');
  }

  let keptIndexes: Set<number>;
  if (scored) {
    const scoreByIndex = new Map(scored.map(s => [s.index, s]));
    // Within each redundant pair, only the higher-scored member stays a candidate.
    const excluded = new Set<number>();
    for (const s of scored) {
      if (s.redundantWithIndex == null) continue;
      const other = scoreByIndex.get(s.redundantWithIndex);
      if (!other) continue;
      excluded.add(s.importanceScore <= other.importanceScore ? s.index : other.index);
    }
    const ranked = candidates
      .filter(c => !excluded.has(c.index))
      .sort((a, b) => (scoreByIndex.get(b.index)?.importanceScore ?? 0) - (scoreByIndex.get(a.index)?.importanceScore ?? 0));

    keptIndexes = new Set();
    let acc = 0;
    for (const c of ranked) {
      if (acc >= targetForRest && keptIndexes.size >= 6) break;
      keptIndexes.add(c.index);
      acc += c.durationSec;
    }
  } else {
    keptIndexes = new Set();
    let acc = 0;
    for (const c of candidates) {
      if (acc >= targetForRest) break;
      keptIndexes.add(c.index);
      acc += c.durationSec;
    }
  }

  const kept = [...forcedScenes, ...scenes.filter(s => keptIndexes.has(s.index))].sort((a, b) => a.index - b.index);
  const keptSec = kept.reduce((a, s) => a + s.durationSec, 0);
  const introNote = forcedScenes.length > 0 ? ` (incl. ${forcedSec.toFixed(0)}s sign-in intro)` : '';
  console.log(`  ✓  Curated ${kept.length}/${allScenes.length} scenes (${keptSec.toFixed(0)}s of real footage${introNote}, target ${targetRealFootageSec.toFixed(0)}s)`);
  return kept;
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

// `force: true` always refreshes the destination (delete + relink), for
// files that can change content across builds while keeping the same name —
// demo-package.json, enterprise-voice-script.json, per-scene voice mp3s,
// scene-frame thumbnails. Without this, a rebuild that changes the package
// (more scenes, different narration, longer total duration) silently renders
// against a STALE copy left over from a previous run — confirmed as a real
// bug: `--render-only` failed with a duration mismatch (Composition
// evaluated to the OLD ~3:21 length while the chunk plan assumed the NEW
// ~6:05 length) because demo-package.json's hardlink in `_render-public` had
// never been refreshed since an earlier, shorter build.
// Default (force: false, skip-if-exists) stays for genuinely large, stable-
// once-fetched media (the cropped source recording, B-roll clips) where
// skipping is a real performance win and the content doesn't change without
// also deleting the file first (which callers already do when it does).
function linkOrCopy(src: string, dest: string, force = false): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    if (!force) return;
    fs.rmSync(dest, { force: true });
  }
  try {
    fs.linkSync(src, dest);
  } catch {
    fs.copyFileSync(src, dest);
  }
}

function buildScopedPublicDir(): string {
  const root = RENDER_PUBLIC_DIR;
  linkOrCopy(CROPPED_MUTED_PATH, path.join(root, 'manual-recording', 'normalized-muted-cropped.mp4'));
  linkOrCopy(ENT_PKG_PATH, path.join(root, 'manual-recording', 'demo-package.json'), true);
  linkOrCopy(ENT_VOICE_SCRIPT_PATH, path.join(root, 'manual-recording', 'enterprise-voice-script.json'), true);

  if (fs.existsSync(SCENE_FRAME_DIR)) {
    for (const f of fs.readdirSync(SCENE_FRAME_DIR)) {
      linkOrCopy(path.join(SCENE_FRAME_DIR, f), path.join(root, 'manual-recording', 'scene-frames', f), true);
    }
  }
  for (const f of fs.existsSync(MR_DIR) ? fs.readdirSync(MR_DIR) : []) {
    if (/^broll-\d+\.mp4$/.test(f)) linkOrCopy(path.join(MR_DIR, f), path.join(root, 'manual-recording', f));
  }
  if (fs.existsSync(ENT_VOICE_DIR)) {
    for (const f of fs.readdirSync(ENT_VOICE_DIR)) {
      if (!f.endsWith('.mp3')) continue; // skip mix-filter.txt / narration leftovers
      linkOrCopy(path.join(ENT_VOICE_DIR, f), path.join(root, 'manual-recording', 'voice-segments-enterprise', f), true);
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

  if (RENDER_ONLY) {
    for (const [label, p] of [['demo-package.json', ENT_PKG_PATH], ['enterprise-voice-script.json', ENT_VOICE_SCRIPT_PATH]] as const) {
      if (!fs.existsSync(p)) {
        console.error(`  ✗  ${label} not found at ${p} — nothing to render.`);
        console.error('     Run without --render-only first to build the package.');
        process.exit(1);
      }
    }
    const existingPkg = JSON.parse(fs.readFileSync(ENT_PKG_PATH, 'utf-8'));
    const totalFrames = existingPkg.composition.durationInFrames;
    console.log(`  ▶️   Rendering existing package as-is: ${existingPkg.scenes.length} scenes, ${(totalFrames / FPS).toFixed(1)}s\n`);
    renderEnterpriseVideo(totalFrames);
    const stat = fs.statSync(ENT_OUTPUT_VIDEO);
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('  ✅  Done!');
    console.log(`     Video  : ${ENT_OUTPUT_VIDEO}  (${(stat.size / 1_048_576).toFixed(1)} MB)`);
    console.log(`     Studio : open "ManualRecordingEnterpriseVideo" in Remotion Studio`);
    console.log('══════════════════════════════════════════════════════════════\n');
    return;
  }

  let scenes: DetectedScene[] = JSON.parse(fs.readFileSync(SCENES_JSON_PATH, 'utf-8'));
  const baseScript: BaseVoiceScript = JSON.parse(fs.readFileSync(BASE_VOICE_SCRIPT, 'utf-8'));
  const baseSegById = new Map(baseScript.segments.map(s => [s.id, s]));

  if (EXCLUDED_SCENE_INDEXES.size > 0) {
    const before = scenes.length;
    scenes = scenes.filter(s => !EXCLUDED_SCENE_INDEXES.has(s.index));
    if (scenes.length < before) {
      console.log(`  ⚠️   Excluded ${before - scenes.length} scene(s) with verified voice/screen mismatches (see SCENE_START_OFFSET_SEC / EXCLUDED_SCENE_INDEXES).`);
    }
  }

  // ── Optional highlight-reel curation to hit a total-duration target ──────
  if (TARGET_MINUTES) {
    const overheadSec = BROLL_SCENE_SEC * BROLL_SCENE_COUNT + BENEFIT_SLIDE_SEC + PRESENTER_CLOSE_SEC;
    const budgetSec = Math.max(30, TARGET_MINUTES * 60 - overheadSec);
    console.log(`  🎯  Target: ${TARGET_MINUTES} min total → curating real-footage scenes to fit ~${budgetSec.toFixed(0)}s…`);
    scenes = await selectHighlightScenes(scenes, baseSegById, budgetSec);
  }

  // ── Muted copy of the source recording (product scenes never carry the
  //    original mic/system audio — only the synthesized narration should play) ──
  if (!fs.existsSync(MUTED_PATH)) {
    console.log('  🔇  Stripping audio from normalized.mp4 for use as scene footage…');
    execSync(`"${findBin('ffmpeg')}" -y -i "${NORMALIZED_PATH}" -c:v copy -an "${MUTED_PATH}"`, { stdio: 'ignore' });
  }

  // ── Crop the OS taskbar out of the bottom of the recording, then force-scale
  //    (non-uniform, ignoring aspect ratio) straight back to 1920x1080 — a
  //    small vertical-only stretch. A new file — normalized(-muted).mp4 are
  //    never touched.
  //
  //    Previously this scaled the cropped 1920x1040 frame back up to fill
  //    height WHILE PRESERVING aspect ratio (landing at ~1994x1080) and then
  //    center-cropped back down to 1920 width — which silently cut ~37px off
  //    BOTH the left and right edges of the actual app UI (confirmed: it
  //    truncated the sidebar nav section labels, "GLOBAL"/"PLATFORM"/
  //    "GOVERNANCE" rendering as "OBAL"/"ATFORM"/"OVERNANCE"). Forcing the
  //    scale filter's output to exactly 1920x1080 (instead of an aspect-
  //    preserving width followed by a center-crop) guarantees zero horizontal
  //    content loss regardless of TASKBAR_CROP_PX's value, at the cost of a
  //    ~4% vertical stretch — imperceptible on screen-recorded UI, and a much
  //    smaller defect than losing real content off both edges. (A black-pad
  //    alternative was tried first but the Remotion-bundled ffmpeg's `pad`
  //    filter isn't available in this build — confirmed via a parse error.)
  //
  //    Forcing the output's display aspect ratio back to 16:9 is required:
  //    without it, ffmpeg tags the stretched output with a non-square sample
  //    aspect ratio (observed: SAR 27:26, DAR 24:13 — exactly the 1080/1040
  //    stretch factor) instead of literally resampling to square pixels.
  //    EnterpriseProductScene's `screenFit: 'full'` renders this clip with
  //    `object-fit: cover; object-position: top left`, and a video whose DAR
  //    (1.846) is wider than its 16:9 (1.778) container gets scaled-to-cover
  //    by height, overflowing (and clipping) its right edge — confirmed as
  //    the cause of a real "View Projects button cut off on the right" bug
  //    report. The `setsar`/`pad` filters that would normally fix this aren't
  //    available in this Remotion-bundled ffmpeg build (both fail with a
  //    filter-parse error) — `-aspect 16:9` is a muxer-level output option
  //    rather than a filter, so it isn't affected by that restriction, and
  //    makes the file's declared aspect ratio match its container exactly, so
  //    `cover` has nothing to crop in either dimension. ──
  if (!fs.existsSync(CROPPED_MUTED_PATH)) {
    console.log('  ✂️   Cropping OS taskbar from scene footage…');
    const cropH = 1080 - TASKBAR_CROP_PX;
    execSync(
      `"${findBin('ffmpeg')}" -y -i "${MUTED_PATH}" ` +
      `-vf "crop=1920:${cropH}:0:0,scale=1920:1080" -aspect 16:9 ` +
      `-c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p "${CROPPED_MUTED_PATH}"`,
      { stdio: 'ignore' },
    );
  }

  // Resolves the real narration text for a detected scene, accounting for
  // scenes expanded via subSegments (whose text lives under different ids —
  // `mr-scene-${index+1}` no longer exists in the base script for those).
  const baseTextForScene = (scene: DetectedScene): string => {
    const subIds = ACTIVE_FIXES.subSegments?.[scene.index];
    if (subIds?.length) return subIds.map(id => baseSegById.get(id)?.text ?? '').filter(Boolean).join(' ');
    return baseSegById.get(`mr-scene-${scene.index + 1}`)?.text ?? '';
  };

  // ── AI (or fallback) enterprise copy ─────────────────────────────────────
  const narrationExcerpt = scenes
    .slice(0, 8)
    .map(baseTextForScene)
    .filter(Boolean)
    .join(' ');
  console.log('  🤖  Generating B-roll / benefit / tagline copy…');
  const copy = await generateEnterpriseCopy(narrationExcerpt);

  // ── B-roll stock footage (falls back to text-only slides per-scene on failure) ──
  const brollVideoPaths = await downloadBrollVideos(copy.brollSearchQueries.slice(0, BROLL_SCENE_COUNT));

  // ── Timeline: brollScenes → scenes (real footage) → benefitSlide → presenterClose ──
  const brollDurationFrames = BROLL_SCENE_SEC * FPS;
  let brollScenes: EnterpriseBRollSceneData[] = copy.brollSubtitles.slice(0, BROLL_SCENE_COUNT).map((subtitle, i) => ({
    id: `broll-${i}`, from: i * brollDurationFrames, durationInFrames: brollDurationFrames, subtitle,
    ...(brollVideoPaths[i] ? { videoPath: brollVideoPaths[i] } : {}),
  }));

  // Trim scenes where the raw recorded shot ran much longer than its narration
  // needs — the original cut length is only how long the person happened to
  // linger on that screen, not a target for the final video. Long silent
  // stretches (measured against the base recording's own mr-scene-*.mp3,
  // already generated during Manual Recording processing) read as dead air in
  // a marketing cut. Never trim below narration + a short buffer, and never
  // extend past the original recorded length (there's no extra footage beyond it).
  const SCENE_AUDIO_BUFFER_SEC = 3;
  const MIN_SCENE_SEC = 4;
  // Per-recording duration caps (see RECORDING_FIXES above) — for scenes whose
  // matching content sits in a narrow window before the recording moves on to
  // unrelated (or, in one case, sensitive) content.
  const SCENE_MAX_DURATION_OVERRIDE_SEC: Record<number, number> = ACTIVE_FIXES.maxDurationOverrideSec ?? {};

  let cursor = brollScenes.length * brollDurationFrames;
  const productScenes: (RemotionScene & { recordingPath: string; recordingStartSec: number })[] = scenes.flatMap((scene, i) => {
    const frameThumb = `manual-recording/scene-frames/scene-${String(scene.index).padStart(2, '0')}.png`;

    // Expanded scenes: one detected scene whose recorded window actually spans
    // several distinct real pages, split into consecutive product scenes —
    // one per base-script sub-segment id, each with its own real startSec
    // (already correct in voice-script.json) and own narration.
    const subIds = ACTIVE_FIXES.subSegments?.[scene.index];
    if (subIds?.length) {
      return subIds.map((segId, j) => {
        const baseSeg = baseSegById.get(segId);
        const audioSec = getMp3DurationSec(path.join(BASE_VOICE_SEG_DIR, `${segId}.mp3`));
        // Cap against the NEXT sub-segment's own real startSec (not just this
        // segment's nominal durationSec) — without this, a segment whose
        // audio slightly overruns its real on-screen window bleeds into the
        // next sub-segment's page for a second or two, the same class of
        // mismatch this whole subSegments feature exists to eliminate.
        const nextSeg = j + 1 < subIds.length ? baseSegById.get(subIds[j + 1]) : undefined;
        const availableSec = nextSeg ? nextSeg.startSec - (baseSeg?.startSec ?? nextSeg.startSec) : Infinity;
        const targetSec = audioSec > 0
          ? Math.max(MIN_SCENE_SEC, Math.min(availableSec, audioSec + SCENE_AUDIO_BUFFER_SEC))
          : Math.max(MIN_SCENE_SEC, Math.min(availableSec, baseSeg?.durationSec ?? MIN_SCENE_SEC));
        const durationInFrames = Math.round(Math.max(2, targetSec) * FPS);
        const from = cursor;
        cursor += durationInFrames;
        const narration = baseSeg?.text ?? '';
        return {
          id: `scene-${i + 1}-${j + 1}`, from, durationInFrames,
          pageId: segId,
          title: baseSeg?.label ?? segId,
          narration,
          salesHook: firstWords(narration, 10),
          description: '',
          screenshotPath: frameThumb,
          fullScreenshotPath: frameThumb,
          highlightTarget: { elementType: 'default', region: 'full', description: '' },
          transition: null,
          nodeType: 'page',
          recordingPath: 'manual-recording/normalized-muted-cropped.mp4',
          recordingStartSec: baseSeg?.startSec ?? scene.startSec,
        };
      });
    }

    const baseSeg = baseSegById.get(`mr-scene-${scene.index + 1}`);
    const audioSec = getMp3DurationSec(path.join(BASE_VOICE_SEG_DIR, `mr-scene-${scene.index + 1}.mp3`));
    const startOffsetSec = SCENE_START_OFFSET_SEC[scene.index] ?? 0;
    const recordingStartSec = scene.startSec + startOffsetSec;
    const durationCapSec = SCENE_MAX_DURATION_OVERRIDE_SEC[scene.index] ?? scene.durationSec;
    const targetSec = audioSec > 0
      ? Math.max(MIN_SCENE_SEC, Math.min(durationCapSec, audioSec + SCENE_AUDIO_BUFFER_SEC))
      : durationCapSec;
    const durationInFrames = Math.round(Math.max(2, targetSec) * FPS);
    const from = cursor;
    cursor += durationInFrames;
    const narration = baseSeg?.text ?? '';
    return [{
      id: `scene-${i + 1}`, from, durationInFrames,
      pageId: `mr-scene-${scene.index + 1}`,
      title: baseSeg?.label ?? `Scene ${i + 1}`,
      narration,
      salesHook: firstWords(narration, 10),
      description: '',
      screenshotPath: frameThumb,
      fullScreenshotPath: frameThumb,
      highlightTarget: { elementType: 'default', region: 'full', description: '' },
      transition: null,
      nodeType: 'page',
      recordingPath: 'manual-recording/normalized-muted-cropped.mp4',
      recordingStartSec,
    }];
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
  // Uses each scene's own pageId (the base voice-script.json segment id it was
  // built from) rather than reconstructing `mr-scene-${scenes[i].index+1}` —
  // that reconstruction assumed a 1:1 index alignment between `scenes` and
  // `shiftedScenes`, which subSegments-expanded scenes break (one detected
  // scene can produce several product scenes, e.g. index 18 -> 6 of them).
  shiftedScenes.forEach((scene) => {
    const src = path.join(BASE_VOICE_SEG_DIR, `${scene.pageId}.mp3`);
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
    ...shiftedScenes.map((s) => {
      const baseSeg = baseSegById.get(s.pageId);
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
