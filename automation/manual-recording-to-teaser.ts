#!/usr/bin/env node
/**
 * manual-recording-to-teaser.ts — Re-purposes an already-built
 * "Manual Recording → Enterprise" package (out/<slug>/manual-recording/
 * demo-package.json, produced by manual-recording-to-enterprise.ts) into a
 * short (~35-45s) TeaserVideo-shaped cut: cold-open B-roll hook → breathing
 * B-roll beat → 2-3 short real-footage feature glimpses (last held longest
 * as the "hero" payoff) → mid-teaser B-roll benefit card → outro.
 *
 * Deliberately sits ONE LEVEL ABOVE manual-recording-to-enterprise.ts rather
 * than re-deriving from scenes.json/voice-script.json itself: the Enterprise
 * bridge has already done the hard work of curating real scenes (with any
 * per-slug RECORDING_FIXES offset/exclusion corrections already baked in),
 * fetching on-theme B-roll stock footage, and writing AI benefit-bullet /
 * tagline copy — this script reuses all of that as-is and just re-cuts a
 * short, punchy teaser arc from it, with its own fresh (much shorter)
 * teaser-specific narration.
 *
 * Prerequisite: run the Enterprise bridge first (Config UI, or
 * `npm run manual-recording:enterprise -- --build-only` is enough — a render
 * of enterprise-video.mp4 itself isn't required, only its demo-package.json).
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json automation/manual-recording-to-teaser.ts [options]
 *
 * Options:
 *   --build-only     Write demo-package-teaser.json / teaser-voice-script.json
 *                     and synthesize narration, but skip the final render —
 *                     preview via "ManualRecordingTeaserVideo" in Remotion
 *                     Studio and render from there instead.
 *   --render-only    Skip AI copy/scene-selection entirely and render the
 *                     demo-package-teaser.json already on disk exactly as it
 *                     is (use after reviewing/approving a --build-only run).
 *
 * Output:
 *   out/<slug>/manual-recording/demo-package-teaser.json   — TeaserVideo package
 *   out/<slug>/manual-recording/teaser-voice-script.json   — matching voice script
 *   out/<slug>/manual-recording/voice-segments-teaser/     — narration MP3s
 *   out/<slug>/manual-recording/music/background.mp3       — background music (best-effort)
 *   out/<slug>/manual-recording/teaser-video.mp4           — final rendered video (unless --build-only)
 *
 * Preview: open "ManualRecordingTeaserVideo" in Remotion Studio.
 */

import * as fs        from 'fs';
import * as path      from 'path';
import * as dotenv    from 'dotenv';
import { execSync }   from 'child_process';
import { AzureOpenAI } from 'openai';
import { OUT_DIR, ROOT, APP_SLUG } from './config';
import { fetchBackgroundMusic } from './fetch-background-music';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

// ─── Config ─────────────────────────────────────────────────────────────────

const FPS = 30;
const BROLL_HOOK_SEC    = 4;
const BROLL_PLAIN_SEC   = 4;
const BROLL_BENEFIT_SEC = 4;
const FEATURE_SEC       = 9;   // regular feature glimpse (initial estimate; stretched to narration, capped by real footage available)
const HERO_FEATURE_SEC  = 14;  // last feature clip — held longest as the payoff
const OUTRO_SEC         = 4;
// Matches generate-voice.ts's syncTeaserTimings() TEASER_BUFFER_SEC — kept in
// sync deliberately since this script reimplements that same stretch-by-
// actual-audio logic locally (can't call the real one without touching
// whatever demo-package.json the live .env's OUT_DIR happens to resolve to —
// see the --no-sync note on synthesizeNarration() below).
const TEASER_BUFFER_SEC = 0.8;
const MIN_FEATURE_SEC   = 4;

const MUSIC_VOLUME   = parseFloat(process.env['BACKGROUND_MUSIC_VOLUME']       ?? '0.08');
const MUSIC_FADE_SEC = parseFloat(process.env['BACKGROUND_MUSIC_FADE_OUT_SEC'] ?? '3');

const MR_DIR              = path.join(OUT_DIR, 'manual-recording');
const ENT_PKG_PATH        = path.join(MR_DIR, 'demo-package.json');
const CROPPED_MUTED_PATH  = path.join(MR_DIR, 'normalized-muted-cropped.mp4');

const TEASER_PKG_PATH          = path.join(MR_DIR, 'demo-package-teaser.json');
const TEASER_VOICE_SCRIPT_PATH = path.join(MR_DIR, 'teaser-voice-script.json');
const TEASER_VOICE_DIR_NAME    = 'manual-recording/voice-segments-teaser'; // relative to OUT_DIR (Studio's public-dir)
const TEASER_VOICE_DIR         = path.join(OUT_DIR, TEASER_VOICE_DIR_NAME);
const TEASER_TMP_SCRIPT_PATH   = path.join(TEASER_VOICE_DIR, '_synthetic-voice-script.json');
const TEASER_OUTPUT_VIDEO      = path.join(MR_DIR, 'teaser-video.mp4');
const MUSIC_REL_PATH           = 'manual-recording/music/background.mp3';

const RENDER_ONLY = process.argv.includes('--render-only');
const BUILD_ONLY  = process.argv.includes('--build-only');

// ── Per-slug hero-scene overrides ───────────────────────────────────────────
// The default pickHeroScenes() heuristic (dedupe by title, pick early/mid/late
// across the deduped list) is a reasonable product-agnostic default, but a
// human glance at the real narration usually finds a stronger trio. Same
// override-table convention as manual-recording-to-enterprise.ts's
// RECORDING_FIXES — empty for a product until someone reviews it.
const TEASER_HERO_OVERRIDES: Record<string, string[]> = {
  // Chosen by reading the real per-scene narration in
  // manual-recording/demo-package.json: scene-1 is the AI-assistant's own
  // one-line pitch ("raw regulatory material to scored risk reports and AI
  // analysis in one workflow") — a strong opener; scene-7 shows the
  // Questionnaire Builder's interactive grouping prompt — engaging mid-arc
  // UI; scene-13 is the risk Heatmap ("color-coded severity from low to
  // critical") — the most visually striking payoff shot, held as the hero.
  'healthcare-grc': ['scene-1', 'scene-7', 'scene-13'],
};

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

function stripMarkdown(text: string): string {
  return text.replace(/\*\*/g, '').replace(/^[-*]\s+/, '').trim();
}

async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 4): Promise<T> {
  let delay = 2000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt === maxRetries) throw err;
      const is429 = err?.status === 429 || String(err?.message).includes('429');
      if (!is429) throw err;
      const retryAfter = Number(err?.headers?.['retry-after'] ?? 0) * 1000;
      await new Promise(r => setTimeout(r, retryAfter > 0 ? retryAfter : delay));
      delay *= 2;
    }
  }
  throw new Error('retryWithBackoff: unreachable');
}

// ─── Types read from the already-built Enterprise bridge package ──────────

interface EntScene {
  id: string;
  pageId: string;
  title: string;
  narration: string;
  from: number;
  durationInFrames: number;
  recordingPath: string;
  recordingStartSec: number;
}
interface EntBrollScene { id: string; videoPath?: string; subtitle: string }
interface EntBenefitBullet { icon: string; label: string; description: string }
interface EnterprisePackage {
  meta: { productName: string };
  scenes: EntScene[];
  brollScenes: EntBrollScene[];
  benefitSlide: { bullets: EntBenefitBullet[] };
  presenterClose: { tagline: string };
}

function loadEnterprisePackage(): EnterprisePackage {
  if (!fs.existsSync(ENT_PKG_PATH)) {
    console.error(`  ✗  ${path.relative(ROOT, ENT_PKG_PATH)} not found.`);
    console.error('     Run the Enterprise bridge first: npm run manual-recording:enterprise -- --build-only');
    process.exit(1);
  }
  if (!fs.existsSync(CROPPED_MUTED_PATH)) {
    console.error(`  ✗  ${path.relative(ROOT, CROPPED_MUTED_PATH)} not found.`);
    console.error('     Run the Enterprise bridge first (it produces this cropped source clip).');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(ENT_PKG_PATH, 'utf-8'));
}

// ─── Hero scene selection ───────────────────────────────────────────────────
//
// Picks 3 short, visually-distinct real-footage moments to stand in for the
// teaser's feature montage. Default heuristic: dedupe consecutive scenes by
// title (a manual recording often lingers back on a screen it already showed,
// e.g. "Compliance Library" appearing 3 times), then take one from early,
// middle, and late in the deduped, chronological list — a product-agnostic
// spread across the whole walkthrough. TEASER_HERO_OVERRIDES lets a reviewed
// product override this with hand-picked scene ids.

function pickHeroScenes(scenes: EntScene[]): EntScene[] {
  const override = TEASER_HERO_OVERRIDES[APP_SLUG];
  if (override) {
    const byId = new Map(scenes.map(s => [s.id, s]));
    const picked = override.map(id => byId.get(id)).filter((s): s is EntScene => !!s);
    if (picked.length === override.length) return picked;
    console.warn(`  ⚠️  TEASER_HERO_OVERRIDES for "${APP_SLUG}" referenced a scene id not present in the current package — falling back to the automatic picker.`);
  }

  const seenTitles = new Set<string>();
  const distinct = scenes.filter(s => {
    if (seenTitles.has(s.title)) return false;
    seenTitles.add(s.title);
    return true;
  });
  if (distinct.length <= 3) return distinct;

  const at = (frac: number) => distinct[Math.min(distinct.length - 1, Math.round(frac * (distinct.length - 1)))];
  const early = distinct[0];
  const mid   = at(0.5);
  const late  = distinct[distinct.length - 1];
  // Guard against collisions on small distinct-lists.
  const result = [early, mid, late].filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i);
  return result.length === 3 ? result : distinct.slice(0, 3);
}

/** How much real footage is available after this scene's recordingStartSec
 *  before the NEXT scene (by chronological recordingStartSec) begins — used
 *  to cap narration-driven duration stretching so a feature glimpse never
 *  bleeds into unrelated footage from a different real scene. */
function availableFootageSec(scene: EntScene, allScenesByStart: EntScene[]): number {
  const idx = allScenesByStart.findIndex(s => s.id === scene.id);
  const next = allScenesByStart[idx + 1];
  return next ? Math.max(MIN_FEATURE_SEC, next.recordingStartSec - scene.recordingStartSec) : Infinity;
}

// ─── AI: short teaser copy + narration, grounded in the picked scenes' real
//     narration plus the Enterprise bridge's already-approved benefit/tagline ─

interface TeaserBridgeContent {
  hookHeadline:    string;
  benefitHeadline: string;
  benefitWords:    string[];
  featureCaptions: Record<string, string>; // by scene id
  outroTagline:    string;
  narration: {
    hook:    string;
    plain:   string;
    feature: Record<string, string>; // by scene id
    benefit: string;
    outro:   string;
  };
}

function fallbackContent(productName: string, picked: EntScene[], tagline: string): TeaserBridgeContent {
  return {
    hookHeadline:    `${productName}, Simplified`,
    benefitHeadline: 'Built for Clarity',
    benefitWords:    ['PRECISE', 'ACTIONABLE', 'RELIABLE'],
    featureCaptions: Object.fromEntries(picked.map(s => [s.id, s.title])),
    outroTagline:    tagline || `See ${productName} in action`,
    narration: {
      hook:    `Your team loses hours every day to scattered tools and manual work.`,
      plain:   `That time adds up fast — and it's time you can't get back.`,
      feature: Object.fromEntries(picked.map(s => [s.id, `${productName} brings ${s.title.toLowerCase()} into one connected workspace.`])),
      benefit: `You were losing time — now you're not.`,
      outro:   tagline || `See what your team gets back with ${productName}.`,
    },
  };
}

async function generateTeaserBridgeContent(
  productName: string,
  picked:      EntScene[],
  benefitBullets: EntBenefitBullet[],
  tagline:     string,
): Promise<TeaserBridgeContent> {
  const DEFAULT = fallbackContent(productName, picked, tagline);
  const apiKey   = process.env['AZURE_OPENAI_API_KEY'];
  const endpoint = process.env['AZURE_OPENAI_ENDPOINT'];
  if (!apiKey || !endpoint) {
    console.warn('  ⚠️  No Azure OpenAI credentials — using generic fallback copy.');
    return DEFAULT;
  }

  const client = new AzureOpenAI({
    apiKey, endpoint,
    deployment: process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
    apiVersion: process.env['OPENAI_API_VERSION'] ?? '2024-12-01-preview',
  });

  const sceneList = picked.map(s => `[${s.id}] ${s.title}: ${s.narration}`).join('\n\n');
  const benefitText = benefitBullets.map(b => `${b.label} — ${b.description}`).join('\n');

  const prompt = `You are writing the VOICEOVER SCRIPT for a ~35-second product TEASER — one continuous story read aloud by a single narrator, not a list of independent screen descriptions. Every line must connect to the one before it; a viewer should feel a beginning, middle, and end, not a spec sheet.

PRODUCT: ${productName}

REAL SCREENS SHOWN (in order, with their full walkthrough narration for context — your teaser lines must be MUCH shorter than these, just the punchy essence):
${sceneList}

ALREADY-APPROVED PRODUCT BENEFITS (for tone/message consistency with this product's other marketing video):
${benefitText}

ALREADY-APPROVED CLOSING TAGLINE (for tone consistency — you may reuse or closely riff on this):
"${tagline}"

STORY ARC — write the "narration" fields below as ONE connected script following this exact shape:
1. HOOK (spoken over the cold-open B-roll): name the real, specific pain/cost implied by the product context above — concretely, not abstractly ("you" language). This sets up a tension the rest of the script resolves.
2. PLAIN (second B-roll beat): a second sentence still on the problem/stakes side, OR the pivot into the promise — different angle than the hook, same throughline, still second-person.
3. FEATURE lines (one per real screen above, in the SAME order): each one is a STEP in a progression, not a standalone fact — use connective language ("First...", "From there...", "And when it matters most...") so they read as one walkthrough, phrased around the OUTCOME for "you"/"your team", not just what the screen displays.
4. BENEFIT: this line must ECHO the hook's specific language/theme — same idea, resolved ("you were losing X — now you don't"). It is the payoff of the tension set up in step 1, not a fresh unrelated claim.
5. OUTRO: closing line that calls back to the opening tension for a resolved arc (not a generic "request a demo") — end on the transformation, then invite action. May riff on the already-approved tagline above.

Write in second person ("you"/"your team") throughout — never third-person ("users", "teams", "the platform lets them..."). Every narration line must sound natural read aloud, not like a bullet point.

Output a JSON object (no markdown fences) with exactly:
{
  "hookHeadline": "bold 3-5 word cold-open on-screen headline — the promise side of the hook's tension",
  "benefitHeadline": "3-5 word mid-video on-screen headline that visibly ECHOES hookHeadline (same theme/wording family, different angle) — this is the callback",
  "benefitWords": ["exactly 3 short uppercase value words tailored to this product"],
  "featureCaptions": { ${picked.map(s => `"${s.id}": "3-5 word on-screen caption naming what this screen does"`).join(', ')} },
  "outroTagline": "short 5-9 word closing on-screen tagline that echoes the resolved tension, not a generic CTA",
  "narration": {
    "hook": "ONE spoken sentence (9-13 words) — the specific pain/tension, second person",
    "plain": "ONE spoken sentence (9-13 words) — continues the problem or pivots to the promise, second person",
    "feature": { ${picked.map(s => `"${s.id}": "ONE spoken sentence (11-16 words), second person, using a connective opener so it reads as the next step in a walkthrough"`).join(', ')} },
    "benefit": "ONE spoken sentence (9-13 words) that explicitly echoes the hook's language/theme — the resolved payoff, second person",
    "outro": "ONE short spoken closing sentence (7-10 words) that calls back to the opening tension before the call to action"
  }
}
Be specific to this product — no generic SaaS boilerplate. Keep every narration line tight and short enough to read aloud comfortably over a 9-14 second clip. Plain text only in every field — no markdown, no asterisks, no bullet characters.`;

  try {
    const response = await retryWithBackoff(() => client.chat.completions.create({
      model:                  process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
      max_completion_tokens:  3000,
      reasoning_effort:       'low',
      messages: [{ role: 'user', content: prompt }],
    }));
    const choice = response.choices[0];
    const raw = (choice?.message?.content ?? '').trim();
    if (!raw) {
      console.warn(`  ⚠️  Teaser copy generation returned empty content (finish_reason: ${choice?.finish_reason}) — using fallback copy.`);
      return DEFAULT;
    }
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
    const p = JSON.parse(cleaned);
    const n = p.narration ?? {};
    return {
      hookHeadline:    stripMarkdown(p.hookHeadline    || DEFAULT.hookHeadline),
      benefitHeadline: stripMarkdown(p.benefitHeadline || DEFAULT.benefitHeadline),
      benefitWords:    Array.isArray(p.benefitWords) && p.benefitWords.length > 0
        ? p.benefitWords.slice(0, 3).map(stripMarkdown) : DEFAULT.benefitWords,
      featureCaptions: (p.featureCaptions && typeof p.featureCaptions === 'object')
        ? Object.fromEntries(Object.entries(p.featureCaptions).map(([k, v]) => [k, stripMarkdown(String(v))]))
        : DEFAULT.featureCaptions,
      outroTagline: stripMarkdown(p.outroTagline || DEFAULT.outroTagline),
      narration: {
        hook:    stripMarkdown(n.hook    || DEFAULT.narration.hook),
        plain:   stripMarkdown(n.plain   || DEFAULT.narration.plain),
        feature: (n.feature && typeof n.feature === 'object')
          ? Object.fromEntries(Object.entries(n.feature).map(([k, v]) => [k, stripMarkdown(String(v))]))
          : DEFAULT.narration.feature,
        benefit: stripMarkdown(n.benefit || DEFAULT.narration.benefit),
        outro:   stripMarkdown(n.outro   || DEFAULT.narration.outro),
      },
    };
  } catch (err) {
    console.warn(`  ⚠️  Teaser copy generation failed: ${(err as Error).message} — using fallback copy.`);
    return DEFAULT;
  }
}

// ─── Background music (best-effort, reuses fetch-background-music.ts as-is) ─

async function fetchMusic(): Promise<string | null> {
  try {
    const musicPath = await fetchBackgroundMusic();
    if (!musicPath) return null;
    const dest = path.join(MR_DIR, 'music', 'background.mp3');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(musicPath, dest);
    return MUSIC_REL_PATH;
  } catch (err) {
    console.warn(`  ⚠️  Background music fetch failed: ${(err as Error).message}`);
    return null;
  }
}

// ─── Build demo-package-teaser.json (initial estimate; durations get
//     re-stretched against actual TTS length once narration is synthesized) ──

interface Beat { id: string; from: number; durationInFrames: number; [k: string]: unknown }

function buildInitialPackage(
  productName: string,
  picked:      EntScene[],
  content:     TeaserBridgeContent,
  brollScenes: EntBrollScene[],
  musicRelPath: string | null,
): Record<string, unknown> {
  const hook    = brollScenes[0];
  const plain   = brollScenes[1] ?? brollScenes[0];
  const benefit = brollScenes[2] ?? brollScenes[1] ?? brollScenes[0];

  let from = 0;
  const teaserBroll:    Beat[] = [];
  const teaserFeatures: Beat[] = [];

  const pushBroll = (id: string, mode: string, durSec: number, extra: Record<string, unknown>) => {
    const dur = Math.round(durSec * FPS);
    teaserBroll.push({ id, from, durationInFrames: dur, mode, ...extra });
    from += dur;
  };
  const pushFeature = (scene: EntScene, durSec: number) => {
    const dur = Math.round(durSec * FPS);
    teaserFeatures.push({
      id: `feature-${scene.id}`, from, durationInFrames: dur,
      screenshotPath:    `manual-recording/scene-frames/scene-${String(picked.indexOf(scene)).padStart(2, '0')}.png`,
      recordingPath:     'manual-recording/normalized-muted-cropped.mp4',
      recordingStartSec: scene.recordingStartSec,
      caption:           content.featureCaptions[scene.id],
      sourceSceneId:      scene.id,
    });
    from += dur;
  };

  pushBroll('broll-hook',  'hook',  BROLL_HOOK_SEC,  { videoPath: hook?.videoPath,    headline: content.hookHeadline });
  pushBroll('broll-plain', 'plain', BROLL_PLAIN_SEC, { videoPath: plain?.videoPath });

  const midpoint = Math.max(1, Math.ceil(picked.length / 2));
  picked.forEach((scene, i) => {
    if (i === midpoint && picked.length > 1) {
      pushBroll('broll-benefit', 'benefit', BROLL_BENEFIT_SEC, {
        videoPath: benefit?.videoPath, benefitHeadline: content.benefitHeadline, benefitWords: content.benefitWords,
      });
    }
    const isHero = i === picked.length - 1;
    pushFeature(scene, isHero ? HERO_FEATURE_SEC : FEATURE_SEC);
  });
  if (picked.length <= 1) {
    pushBroll('broll-benefit', 'benefit', BROLL_BENEFIT_SEC, {
      videoPath: benefit?.videoPath, benefitHeadline: content.benefitHeadline, benefitWords: content.benefitWords,
    });
  }

  const outroFrom = from;
  const outroDur  = Math.round(OUTRO_SEC * FPS);
  from += outroDur;

  return {
    composition: { id: 'TeaserVideo', durationInFrames: from, fps: FPS, width: 1920, height: 1080 },
    teaserBroll,
    teaserFeatures,
    teaserOutro: { from: outroFrom, durationInFrames: outroDur, productName, tagline: content.outroTagline },
    ...(musicRelPath ? { teaserMusic: { path: musicRelPath, volume: MUSIC_VOLUME, fadeOutSec: MUSIC_FADE_SEC } } : {}),
    meta: { productName, templateId: 'teaser' },
  };
}

function buildInitialVoiceScript(pkg: Record<string, unknown>, picked: EntScene[], content: TeaserBridgeContent): Record<string, unknown> {
  const teaserBroll    = pkg['teaserBroll']    as Beat[];
  const teaserFeatures = pkg['teaserFeatures'] as Beat[];
  const teaserOutro    = pkg['teaserOutro']    as Beat & { productName: string; tagline: string };

  const brollNarration: Record<string, string> = {
    'broll-hook':    content.narration.hook,
    'broll-plain':   content.narration.plain,
    'broll-benefit': content.narration.benefit,
  };
  const brollSegments = teaserBroll
    .filter(b => brollNarration[b.id])
    .map(b => ({ id: b.id, label: b.id, startSec: b.from / FPS, durationSec: Math.max(2, b.durationInFrames / FPS - 0.5), enabled: true, text: brollNarration[b.id] }));

  const featureSegments = teaserFeatures.map(f => {
    const sceneId = f['sourceSceneId'] as string;
    return {
      id: f.id, label: f.id, startSec: f.from / FPS, durationSec: Math.max(2, f.durationInFrames / FPS - 1),
      enabled: true, text: content.narration.feature[sceneId] ?? `See how ${teaserOutro.productName} brings this workflow together.`,
    };
  });

  const outroSegment = {
    id: 'outro', label: 'Outro', startSec: teaserOutro.from / FPS, durationSec: Math.max(2, teaserOutro.durationInFrames / FPS - 1),
    enabled: true, text: content.narration.outro,
  };

  const compDuration = (pkg['composition'] as { durationInFrames: number }).durationInFrames;
  return {
    voice: 'nova', model: 'tts-hd', speed: 0.95, fps: FPS, locale: process.env['APP_LANGUAGE'] ?? 'en',
    voiceDir: TEASER_VOICE_DIR_NAME,
    totalDurationSec: Math.round((compDuration / FPS) * 10) / 10,
    segments: [...brollSegments, ...featureSegments, outroSegment],
  };
}

// ─── Synthesize narration MP3s (--no-sync: this script does its own resync
//     below rather than letting generate-voice.ts's syncTeaserTimings() touch
//     whatever demo-package.json the live .env's OUT_DIR happens to resolve
//     to — same reasoning as manual-recording-to-enterprise.ts's
//     synthesizeNewSegments(), which this mirrors) ──────────────────────────

function synthesizeNarration(voiceScript: Record<string, unknown>): void {
  fs.mkdirSync(TEASER_VOICE_DIR, { recursive: true });
  fs.writeFileSync(TEASER_TMP_SCRIPT_PATH, JSON.stringify(voiceScript, null, 2), 'utf-8');

  console.log('  🎙️   Synthesizing teaser narration…');
  execSync(
    `npx ts-node --project tsconfig.scripts.json automation/generate-voice.ts ` +
    `--script "${TEASER_TMP_SCRIPT_PATH}" --output "${path.join(TEASER_VOICE_DIR, '_unused.mp4')}" --no-merge --no-sync`,
    { cwd: ROOT, stdio: 'inherit' },
  );

  fs.rmSync(TEASER_TMP_SCRIPT_PATH, { force: true });
}

/** Re-stretches every beat's duration to its actual measured narration
 *  length + TEASER_BUFFER_SEC (mirrors generate-voice.ts's syncTeaserTimings,
 *  which this script cannot safely call directly — see synthesizeNarration).
 *  Feature beats are additionally capped by how much real footage is actually
 *  available before the next real scene begins, so a long narration line
 *  can never bleed into unrelated footage. */
function resyncToActualDurations(
  pkg:            Record<string, unknown>,
  voiceScript:    Record<string, unknown>,
  allScenesByStart: EntScene[],
  sceneById:      Map<string, EntScene>,
): void {
  const broll    = pkg['teaserBroll']    as Beat[];
  const features = pkg['teaserFeatures'] as Beat[];
  const outro    = pkg['teaserOutro']    as Beat;

  const actualDur = (id: string): number => getMp3DurationSec(path.join(TEASER_VOICE_DIR, `${id}.mp3`));

  const beats = [...broll, ...features].sort((a, b) => a.from - b.from);
  let cursor = beats[0]?.from ?? 0;
  for (const beat of beats) {
    beat.from = cursor;
    const dur = actualDur(beat.id);
    if (dur > 0) {
      let target = dur + TEASER_BUFFER_SEC;
      const sourceSceneId = beat['sourceSceneId'] as string | undefined;
      if (sourceSceneId) {
        const scene = sceneById.get(sourceSceneId);
        if (scene) target = Math.max(MIN_FEATURE_SEC, Math.min(target, availableFootageSec(scene, allScenesByStart)));
      }
      beat.durationInFrames = Math.ceil(target * FPS);
    }
    cursor += beat.durationInFrames;
  }

  const outroDur = actualDur('outro');
  outro.from = cursor;
  if (outroDur > 0) outro.durationInFrames = Math.ceil((outroDur + TEASER_BUFFER_SEC) * FPS);
  cursor += outro.durationInFrames;

  (pkg['composition'] as { durationInFrames: number }).durationInFrames = cursor;

  const positionById = new Map<string, Beat>();
  for (const b of beats) positionById.set(b.id, b);
  positionById.set('outro', outro);

  const segments = voiceScript['segments'] as Array<{ id: string; startSec: number; durationSec: number }>;
  for (const seg of segments) {
    const pos = positionById.get(seg.id);
    if (!pos) continue;
    seg.startSec = parseFloat((pos.from / FPS + 0.3).toFixed(3));
    const dur = actualDur(seg.id);
    if (dur > 0) seg.durationSec = dur;
  }
  voiceScript['totalDurationSec'] = parseFloat((cursor / FPS).toFixed(1));
  voiceScript['voiceReady'] = true;
}

// ─── Scoped public-dir + chunked render (same rationale as
//     manual-recording-to-enterprise.ts's renderEnterpriseVideo: `remotion
//     render` copies the ENTIRE --public-dir on every invocation, so this
//     mirrors just the handful of files "TeaserVideo" actually needs — and
//     places demo-package-teaser.json/teaser-voice-script.json at the SCOPED
//     DIR'S ROOT as plain demo-package.json/voice-script.json, letting the
//     existing unmodified "TeaserVideo" composition render this package
//     without any Root.tsx changes for the render path itself; Studio preview
//     uses the separate "ManualRecordingTeaserVideo" composition instead,
//     which points directly at the real manual-recording/ file names). ──────

const RENDER_PUBLIC_DIR = path.join(MR_DIR, '_render-public-teaser');

function linkOrCopy(src: string, dest: string, force = false): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    if (!force) return;
    fs.rmSync(dest, { force: true });
  }
  try { fs.linkSync(src, dest); } catch { fs.copyFileSync(src, dest); }
}

function buildScopedPublicDir(musicRelPath: string | null): string {
  const root = RENDER_PUBLIC_DIR;
  linkOrCopy(CROPPED_MUTED_PATH, path.join(root, 'manual-recording', 'normalized-muted-cropped.mp4'));
  linkOrCopy(TEASER_PKG_PATH, path.join(root, 'demo-package.json'), true);
  linkOrCopy(TEASER_VOICE_SCRIPT_PATH, path.join(root, 'voice-script.json'), true);

  const sceneFrameDir = path.join(MR_DIR, 'scene-frames');
  if (fs.existsSync(sceneFrameDir)) {
    for (const f of fs.readdirSync(sceneFrameDir)) {
      linkOrCopy(path.join(sceneFrameDir, f), path.join(root, 'manual-recording', 'scene-frames', f), true);
    }
  }
  for (const f of fs.existsSync(MR_DIR) ? fs.readdirSync(MR_DIR) : []) {
    if (/^broll-\d+\.mp4$/.test(f)) linkOrCopy(path.join(MR_DIR, f), path.join(root, 'manual-recording', f));
  }
  if (fs.existsSync(TEASER_VOICE_DIR)) {
    for (const f of fs.readdirSync(TEASER_VOICE_DIR)) {
      if (!f.endsWith('.mp3')) continue;
      linkOrCopy(path.join(TEASER_VOICE_DIR, f), path.join(root, TEASER_VOICE_DIR_NAME, f), true);
    }
  }
  if (musicRelPath) {
    const musicSrc = path.join(MR_DIR, 'music', 'background.mp3');
    if (fs.existsSync(musicSrc)) linkOrCopy(musicSrc, path.join(root, musicRelPath));
  }

  const globalAssets = path.join(ROOT, 'public', 'assets');
  if (fs.existsSync(globalAssets)) {
    for (const f of fs.readdirSync(globalAssets)) {
      const src = path.join(globalAssets, f);
      if (fs.statSync(src).isFile()) linkOrCopy(src, path.join(root, 'assets', f));
    }
  }

  return root;
}

function renderTeaserVideo(totalFrames: number, musicRelPath: string | null): void {
  const ffmpeg = findBin('ffmpeg');
  const publicDirFwd = buildScopedPublicDir(musicRelPath).replace(/\\/g, '/');
  const outputFwd     = TEASER_OUTPUT_VIDEO.replace(/\\/g, '/');
  const CHUNK_SIZE = 900; // 30s @ 30fps — real-video OffthreadVideo scenes, same headroom as the Enterprise bridge

  const numChunks = Math.ceil(totalFrames / CHUNK_SIZE);
  console.log(`\n  Rendering ${numChunks} chunk(s) of ≤${CHUNK_SIZE} frames…\n`);

  const segmentPaths: string[] = [];
  for (let i = 0; i < numChunks; i++) {
    const from = i * CHUNK_SIZE;
    const to   = Math.min((i + 1) * CHUNK_SIZE - 1, totalFrames - 1);
    const segFile    = path.join(MR_DIR, `_teaser-segment-${String(i).padStart(3, '0')}.mp4`);
    const segFileFwd = segFile.replace(/\\/g, '/');
    segmentPaths.push(segFile);

    if (fs.existsSync(segFile) && fs.statSync(segFile).size > 10_000) {
      console.log(`  ── Chunk ${i + 1}/${numChunks}  frames ${from}–${to}  [SKIPPED — already rendered]`);
      continue;
    }

    console.log(`  ── Chunk ${i + 1}/${numChunks}  frames ${from}–${to} ──`);
    const cmd = [
      `npx remotion render TeaserVideo "${segFileFwd}"`,
      '--codec=h264', '--crf=23',
      `--public-dir="${publicDirFwd}"`,
      '--concurrency=1', '--timeout=120000', '--port=4003',
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
  const concatListPath = path.join(MR_DIR, '_teaser-concat.txt');
  fs.writeFileSync(concatListPath, segmentPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'), 'utf-8');
  if (fs.existsSync(TEASER_OUTPUT_VIDEO)) fs.unlinkSync(TEASER_OUTPUT_VIDEO);
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
  console.log('  🎬  Manual Recording → Teaser video');
  console.log('══════════════════════════════════════════════════════════════\n');

  if (RENDER_ONLY) {
    for (const [label, p] of [['demo-package-teaser.json', TEASER_PKG_PATH], ['teaser-voice-script.json', TEASER_VOICE_SCRIPT_PATH]] as const) {
      if (!fs.existsSync(p)) {
        console.error(`  ✗  ${label} not found at ${p} — nothing to render.`);
        console.error('     Run without --render-only first to build the package.');
        process.exit(1);
      }
    }
    const existingPkg = JSON.parse(fs.readFileSync(TEASER_PKG_PATH, 'utf-8'));
    const totalFrames = existingPkg.composition.durationInFrames;
    const musicRelPath = existingPkg.teaserMusic?.path ?? null;
    console.log(`  ▶️   Rendering existing package as-is: ${(totalFrames / FPS).toFixed(1)}s\n`);
    renderTeaserVideo(totalFrames, musicRelPath);
    const stat = fs.statSync(TEASER_OUTPUT_VIDEO);
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('  ✅  Done!');
    console.log(`     Video  : ${TEASER_OUTPUT_VIDEO}  (${(stat.size / 1_048_576).toFixed(1)} MB)`);
    console.log('══════════════════════════════════════════════════════════════\n');
    return;
  }

  const entPkg = loadEnterprisePackage();
  const productName = entPkg.meta.productName;
  console.log(`  Product: ${productName}  |  ${entPkg.scenes.length} real scenes available`);

  const picked = pickHeroScenes(entPkg.scenes);
  console.log(`  ✓  Picked ${picked.length} hero scene(s): ${picked.map(s => `${s.id} (${s.title})`).join(', ')}`);

  console.log('  🤖  Generating teaser copy + narration…');
  const content = await generateTeaserBridgeContent(productName, picked, entPkg.benefitSlide.bullets, entPkg.presenterClose.tagline);
  console.log(`  ✓  Hook: "${content.hookHeadline}"  |  Benefit: "${content.benefitHeadline}"`);

  console.log('\n  Fetching background music (best-effort)…');
  const musicRelPath = await fetchMusic();
  console.log(musicRelPath ? `  ✓  Music ready: ${musicRelPath}` : '  ⚠️  No background music available — teaser will render silently.');

  const pkg = buildInitialPackage(productName, picked, content, entPkg.brollScenes, musicRelPath);
  const voiceScript = buildInitialVoiceScript(pkg, picked, content);

  synthesizeNarration(voiceScript);

  const allScenesByStart = [...entPkg.scenes].sort((a, b) => a.recordingStartSec - b.recordingStartSec);
  const sceneById = new Map(entPkg.scenes.map(s => [s.id, s]));
  resyncToActualDurations(pkg, voiceScript, allScenesByStart, sceneById);

  fs.writeFileSync(TEASER_PKG_PATH, JSON.stringify(pkg, null, 2), 'utf-8');
  console.log(`\n  ✓  ${path.relative(ROOT, TEASER_PKG_PATH)} written`);
  fs.writeFileSync(TEASER_VOICE_SCRIPT_PATH, JSON.stringify(voiceScript, null, 2), 'utf-8');
  console.log(`  ✓  ${path.relative(ROOT, TEASER_VOICE_SCRIPT_PATH)} written`);

  const totalFrames = (pkg['composition'] as { durationInFrames: number }).durationInFrames;
  console.log(`\n  Total duration : ${totalFrames} frames = ${(totalFrames / FPS).toFixed(1)}s`);

  if (BUILD_ONLY) {
    console.log('\n  --build-only set — skipping render. Preview via "ManualRecordingTeaserVideo" in Studio,');
    console.log('  or run again without --build-only to render the final MP4.\n');
    return;
  }

  renderTeaserVideo(totalFrames, musicRelPath);

  const stat = fs.statSync(TEASER_OUTPUT_VIDEO);
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  ✅  Done!');
  console.log(`     Video  : ${TEASER_OUTPUT_VIDEO}  (${(stat.size / 1_048_576).toFixed(1)} MB)`);
  console.log(`     Studio : open "ManualRecordingTeaserVideo" in Remotion Studio`);
  console.log('══════════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('\n  ✗  Error:', (err as Error).message ?? err);
  process.exit(1);
});
