#!/usr/bin/env node
/**
 * record-teaser-clips.ts — Recording pipeline for the Teaser Video template.
 *
 * Records a short (~45-50s) montage — a cold-open B-roll hook, a breathing
 * B-roll beat, a login/brand-reveal clip, up to 3 real product screen-recording
 * feature clips (the last held longest as the "hero" payoff), and a mid-teaser
 * B-roll benefit-statement card — then writes out/<slug>/demo-package.json with
 * meta.templateId = 'teaser'.
 *
 * Like record-app-clips.ts (enterprise), this also writes voice-script.json and
 * runs `npm run voice:only` — a short "quick overview" marketing voiceover reads
 * over the B-roll/feature beats, no presenter/talking-head. Unlike enterprise,
 * there's no separate benefit-slide/presenter-close narration budget: one line
 * per beat, kept terse. B-roll and music reuse the already-generic
 * download-broll-videos.ts / fetch-background-music.ts scripts as-is.
 *
 * All parameters read from .env — same variables the other templates use:
 *   APP_URL, APP_PRODUCT_NAME, LOGIN_TYPE, APP_USERNAME/APP_PASSWORD,
 *   APP_QUICK_ACCESS_INDEX, APP_LOGIN_PATH, APP_ROUTE_MAP, APP_CONTEXT_TEXT,
 *   BACKGROUND_MUSIC_VOLUME, BACKGROUND_MUSIC_FADE_OUT_SEC.
 */

import { chromium } from 'playwright';
import type { BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { execSync } from 'child_process';
import { AzureOpenAI } from 'openai';
import { OUT_DIR } from './config';
import { createAuthContext, ensureSession } from './utils/session';
import type { SessionState } from './utils/session';
import { extractPrimaryRole } from './utils/roleLabel';
import { fetchBackgroundMusic } from './fetch-background-music';
import { resolveLanguageName } from './utils/i18n';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

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

// ─── Config — all values from .env ───────────────────────────────────────────

const APP_URL       = (process.env['APP_URL'] ?? 'http://localhost:3000').replace(/\/$/, '');
const LOGIN_TYPE    = process.env['LOGIN_TYPE'] ?? '1';
const APP_USERNAME  = process.env['APP_USERNAME'] ?? '';
const APP_PASSWORD  = process.env['APP_PASSWORD'] ?? '';
const QUICK_ACCESS_INDEX = parseInt(process.env['APP_QUICK_ACCESS_INDEX'] ?? '0', 10);
const PRODUCT_NAME  = process.env['APP_PRODUCT_NAME'] || (() => {
  try { return new URL(APP_URL).hostname; } catch { return 'Product'; }
})();
const APP_LOGIN_PATH = (process.env['APP_LOGIN_PATH'] ?? '/login').replace(/^\//, '');
const LOGIN_URL = APP_LOGIN_PATH
  ? `${APP_URL}/${APP_LOGIN_PATH}`
  : `${APP_URL}/`;
// Optional path (absolute, or relative to the repo root) to the client's own
// logo image. When set and the file exists, it's copied into this product's
// Remotion public-dir so the outro can show the real logo instead of falling
// back to a styled text wordmark.
const APP_LOGO_PATH = (process.env['APP_LOGO_PATH'] ?? '').trim();

const REC_DIR     = path.join(OUT_DIR, 'recordings');
const TMP_REC_DIR = path.join(OUT_DIR, '_tmp_rec_teaser');
const PKG_PATH    = path.join(OUT_DIR, 'demo-package.json');
const VOICE_PATH  = path.join(OUT_DIR, 'voice-script.json');

const FPS      = 30;
const VIEWPORT = { width: 1920, height: 1080 };

// Timing constants — hardcoded module constants, same convention as the
// BROLL_FRAMES/BENEFIT_SEC/PRESENTER_SEC constants in record-app-clips.ts.
const MAX_FEATURES      = 3;   // route-driven feature clips (excludes the login clip)
const BROLL_HOOK_SEC    = 4;   // cold-open B-roll + headline
const BROLL_PLAIN_SEC   = 4;   // breathing beat, no text
const BROLL_BENEFIT_SEC = 4;   // mid-teaser benefit statement card
const LOGIN_SEC         = 7;   // login/brand-reveal clip (recorded length; see RECORDING_SKIP_SEC)
const FEATURE_SEC       = 9;   // regular feature clip (recorded length; see RECORDING_SKIP_SEC)
const HERO_FEATURE_SEC  = 14;  // last feature clip — held longest as the payoff
const OUTRO_SEC         = 4;   // client app logo/tagline reveal
// Every recorded clip opens on a brief page-load flash/skeleton (white flash,
// then a loading-state frame) before the real UI settles — same issue
// record-app-clips.ts solves with its own LOGIN_SKIP_SEC. Seeking playback
// this many seconds into each recording skips past that and starts on the
// settled screen. Recording durations above are padded by roughly this much
// so there's still enough real footage left after the skip.
const RECORDING_SKIP_SEC = 3;

fs.mkdirSync(REC_DIR, { recursive: true });

const MUSIC_VOLUME   = parseFloat(process.env['BACKGROUND_MUSIC_VOLUME']       ?? '0.08');
const MUSIC_FADE_SEC = parseFloat(process.env['BACKGROUND_MUSIC_FADE_OUT_SEC'] ?? '3');

// ─── Azure OpenAI ─────────────────────────────────────────────────────────────

const azureClient = new AzureOpenAI({
  apiKey:     process.env['AZURE_OPENAI_API_KEY']    ?? '',
  endpoint:   process.env['AZURE_OPENAI_ENDPOINT']   ?? '',
  deployment: process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
  apiVersion: process.env['OPENAI_API_VERSION']      ?? '2024-12-01-preview',
});

const APP_CONTEXT = process.env['APP_CONTEXT_TEXT'] ?? '';
const LANGUAGE_NAME = resolveLanguageName(process.env['APP_LANGUAGE']);
let routeMap: Record<string, string> = {};
try {
  const raw = process.env['APP_ROUTE_MAP'] ?? '{}';
  if (raw) routeMap = JSON.parse(raw);
} catch { /* leave routeMap empty */ }

// ─── AI: short on-screen copy + a "quick overview" voiceover script ───────────

interface TeaserNarration {
  hook:    string;
  plain:   string;
  login:   string;
  feature: Record<string, string>;
  benefit: string;
  outro:   string;
}

interface TeaserContent {
  hookHeadline:    string;
  benefitHeadline: string;
  benefitWords:    string[];
  featureCaptions: Record<string, string>;
  outroTagline:    string;
  narration:       TeaserNarration;
}

function defaultTeaserContent(): TeaserContent {
  return {
    hookHeadline:    `${PRODUCT_NAME}, Simplified`,
    benefitHeadline: 'Built for Clarity',
    benefitWords:    ['PRECISE', 'ACTIONABLE', 'RELIABLE'],
    featureCaptions: {},
    outroTagline:    `${PRODUCT_NAME} — see it in action`,
    narration: {
      hook:    `Your team loses hours every day to scattered tools and busywork.`,
      plain:   `That's time you can't get back — and it adds up fast.`,
      login:   `This is ${PRODUCT_NAME}.`,
      feature: {},
      benefit: `You were losing time — now you're not.`,
      outro:   `See what your team gets back with ${PRODUCT_NAME}.`,
    },
  };
}

async function generateTeaserContent(routePaths: string[]): Promise<TeaserContent> {
  const DEFAULT = defaultTeaserContent();
  if (!APP_CONTEXT) return DEFAULT;

  const featureList = routePaths.map(p => `${p}: ${routeMap[p]}`).join('\n');
  const prompt = `You are writing the VOICEOVER SCRIPT for a ~45-second product teaser — one continuous story read aloud by a single narrator, not a list of independent screen descriptions. Every line must connect to the one before it; a viewer should feel a beginning, middle, and end, not a spec sheet.

PRODUCT: ${PRODUCT_NAME}
PRODUCT CONTEXT:
${APP_CONTEXT}
${featureList ? `\nFEATURE SCREENS SHOWN (in order):\n${featureList}` : ''}

STORY ARC — write the "narration" fields below as ONE connected script following this exact shape:
1. HOOK (spoken over the cold-open B-roll): name the real, specific pain/cost from the product context above — concretely, not abstractly ("you" language: "Your team loses hours..." / "Every missed X costs..."). This sets up a tension the rest of the script resolves.
2. PLAIN (second B-roll beat): a second sentence still on the problem/stakes side, OR the pivot into the promise — different angle than the hook, same throughline, still second-person.
3. LOGIN: introduce the product by name only, as the answer to what was just set up — brief, no feature detail (that's next).
4. FEATURE lines: each one is a STEP in a progression, not a standalone fact — use connective language ("First...", "From there...", "And when it matters most...") so they read as one walkthrough, and phrase each around the OUTCOME for "you"/"your team", not just what the screen displays.
5. BENEFIT: this line must ECHO the hook's specific language/theme — same idea, resolved ("you were losing X — now you don't"). It is the payoff of the tension set up in step 1, not a fresh unrelated claim.
6. OUTRO: closing line that calls back to the opening tension for a resolved arc (not a generic "request a demo") — end on the transformation, then invite action.

Write in second person ("you"/"your team") throughout the narration — never third-person ("users", "teams", "the platform lets them..."). Every narration line must sound natural read aloud, not like a bullet point.

Output a JSON object (no markdown fences) with exactly:
{
  "hookHeadline": "bold 3-5 word cold-open on-screen headline — the promise side of the hook's tension",
  "benefitHeadline": "3-5 word mid-video on-screen headline that visibly ECHOES hookHeadline (same theme/wording family, different angle) — this is the callback",
  "benefitWords": ["exactly 3 short uppercase value words tailored to this product, e.g. PRECISE, ACTIONABLE, RELIABLE"],
  "featureCaptions": { ${routePaths.map(p => `"${p}": "3-5 word on-screen caption naming what this screen does"`).join(', ') || '"/example": "..."'} },
  "outroTagline": "short 5-9 word closing on-screen tagline that echoes the resolved tension, not a generic CTA",
  "narration": {
    "hook": "ONE spoken sentence (9-13 words) — the specific pain/tension, second person",
    "plain": "ONE spoken sentence (9-13 words) — continues the problem or pivots to the promise, second person",
    "login": "ONE short spoken sentence (6-9 words) — introduces the product by name as the answer. Do NOT name or hint at any specific screen/feature (those come next) — keep it generic so it doesn't repeat the very next line",
    "feature": { ${routePaths.map(p => `"${p}": "ONE spoken sentence (13-19 words), second person, using a connective opener (First/From there/And when it matters most/etc.) so it reads as the next step in a walkthrough, not an isolated fact"`).join(', ') || '"/example": "..."'} },
    "benefit": "ONE spoken sentence (9-13 words) that explicitly echoes the hook's language/theme — the resolved payoff, second person",
    "outro": "ONE short spoken closing sentence (7-10 words) that calls back to the opening tension before the call to action"
  }
}
Be specific to this product — no generic SaaS boilerplate. Keep every narration line tight; it will be read aloud at a natural pace over a short video clip and must not run long.${
  LANGUAGE_NAME ? `\n\nWrite ALL string values (headlines, captions, narration) in ${LANGUAGE_NAME} — natural, native-sounding ${LANGUAGE_NAME}, not a literal translation. Keep JSON keys in English exactly as specified above; only the string VALUES change language.` : ''
}`;

  try {
    const response = await retryWithBackoff(() => azureClient.chat.completions.create({
      model:                  process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
      // Reasoning models (e.g. gpt-5-mini) spend part of this budget on hidden
      // chain-of-thought before writing the actual JSON — this call asks for a
      // larger structured object (captions + a per-beat narration script) than
      // the single-purpose calls elsewhere in this codebase, so it needs a much
      // bigger ceiling or reasoning alone can exhaust the budget and leave an
      // empty response (see memory: gpt-5-mini reasoning-tokens bug).
      max_completion_tokens:  3000,
      reasoning_effort:       'low',
      messages: [{ role: 'user', content: prompt }],
    }));
    const raw = response.choices[0]?.message?.content ?? '';
    if (!raw.trim()) {
      throw new Error(`empty response content (finish_reason: ${response.choices[0]?.finish_reason ?? 'unknown'})`);
    }
    const p = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, ''));
    const n = p.narration ?? {};
    return {
      hookHeadline:    p.hookHeadline    || DEFAULT.hookHeadline,
      benefitHeadline: p.benefitHeadline || DEFAULT.benefitHeadline,
      benefitWords:    Array.isArray(p.benefitWords) && p.benefitWords.length > 0 ? p.benefitWords.slice(0, 3) : DEFAULT.benefitWords,
      featureCaptions: (p.featureCaptions && typeof p.featureCaptions === 'object') ? p.featureCaptions : {},
      outroTagline:    p.outroTagline    || DEFAULT.outroTagline,
      narration: {
        hook:    n.hook    || DEFAULT.narration.hook,
        plain:   n.plain   || DEFAULT.narration.plain,
        login:   n.login   || DEFAULT.narration.login,
        feature: (n.feature && typeof n.feature === 'object') ? n.feature : {},
        benefit: n.benefit || DEFAULT.narration.benefit,
        outro:   n.outro   || DEFAULT.narration.outro,
      },
    };
  } catch (err) {
    // Never fail silently here — a swallowed error is exactly how this pipeline
    // has previously shipped 100% generic boilerplate copy while logging success.
    console.warn(`  ⚠️  AI narration/copy generation failed — using generic fallback text. (${(err as Error).message?.slice(0, 200)})`);
    return DEFAULT;
  }
}

// ─── Suppress notification popups / first-login consent gates ────────────────

const SUPPRESS_CSS = `
  [class*="toast"]:not(button),[class*="snackbar"],[class*="notification"]:not(nav),
  [class*="alert"][class*="panel"],[class*="modal-overlay"]:not([class*="content"]) {
    display:none!important;
  }
`;

const CONSENT_ACCEPT_SELECTOR = [
  'button:has-text("Accept & Continue")', 'button:has-text("Accept and Continue")',
  'button:has-text("Accept All & Continue")', 'button:has-text("I Agree & Continue")',
  'button:has-text("Accept All")', 'button:has-text("I Agree")',
  'button:has-text("I Understand")', 'button:has-text("Got it")',
].join(', ');

async function suppressPopups(page: Page): Promise<void> {
  try {
    const acceptBtn = page.locator(CONSENT_ACCEPT_SELECTOR).first();
    if (await acceptBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      const checkbox = page.locator('input[type="checkbox"]').first();
      if (await checkbox.isVisible({ timeout: 500 }).catch(() => false)) {
        await checkbox.check({ force: true }).catch(() => {});
      }
      await acceptBtn.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1000);
    }
  } catch { /* best-effort only */ }
  await page.addStyleTag({ content: SUPPRESS_CSS }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(200);
}

// ─── Generic on-screen motion during recording ────────────────────────────────
// A passively-loaded static screen reads as "frozen" next to the reference
// video's visibly-interactive product shots. This is app-agnostic (no
// selectors, no app-specific knowledge) — same technique record-app-clips.ts
// already uses for every enterprise clip via its own performFullInteraction.
async function performScrollInteraction(page: Page): Promise<void> {
  try {
    const h = await page.evaluate(() => document.body.scrollHeight);
    const steps = Math.min(Math.ceil(h / 400), 5);
    for (let i = 1; i <= steps; i++) {
      await page.evaluate(
        (y: number) => window.scrollTo({ top: y, behavior: 'smooth' }),
        (i / steps) * h * 0.6,
      );
      await page.waitForTimeout(550);
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await page.waitForTimeout(400);
  } catch { /* best-effort only — a scroll failure should never fail the recording */ }
}

// ─── FFmpeg helper ─────────────────────────────────────────────────────────────

function findFfmpeg(): string {
  try { execSync('ffmpeg -version', { stdio: 'ignore' }); return 'ffmpeg'; } catch {}
  for (const c of ['C:/ffmpeg/bin/ffmpeg.exe', 'D:/ffmpeg/bin/ffmpeg.exe']) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('FFmpeg not found in PATH');
}

function convertToMp4(webmPath: string, mp4Path: string): void {
  const ffmpeg = findFfmpeg();
  execSync(
    `"${ffmpeg}" -y -i "${webmPath}" -c:v libx264 -crf 23 -preset veryfast -threads 4 -pix_fmt yuv420p -movflags +faststart -an "${mp4Path}"`,
    { stdio: 'pipe' },
  );
}

// ─── Recording plan ────────────────────────────────────────────────────────────

interface TeaserClipPlan {
  id:         string;
  label:      string;
  targetUrl:  string;
  durationSec: number;
  routePath?: string;   // undefined for the login clip
  needsAuth:  boolean;
}

/**
 * Picks up to `max` feature routes for the teaser, favoring both role
 * consistency and visual variety over raw APP_ROUTE_MAP order.
 *
 * Teaser authenticates once, as a single role, then navigates directly to
 * each picked route's URL — so routes must all be reachable by the SAME
 * role, or role-gated pages silently redirect back to that role's own
 * default landing page (the app doing so once is expected; every picked
 * "feature" bouncing to that same fallback page is the bug this avoids).
 * We group routes by their APP_ROUTE_MAP role prefix and pick the largest
 * group — the richest persona is also the one most likely to be a real,
 * loggable-in demo account. Within that group we then prefer one route per
 * distinct top-level path segment, so three picks don't all land on
 * sub-pages of the same section (e.g. /field-service, /field-service/
 * firmware, /field-service/actions all being effectively the same screen).
 */
function selectDiverseFeatureRoutes(
  allRoutes: [string, string][],
  max: number,
): [string, string][] {
  const groups: Map<string, [string, string][]> = new Map();
  const firstSeenIndex: Map<string, number> = new Map();
  allRoutes.forEach(([routePath, label], i) => {
    const role = extractPrimaryRole(label) ?? '';
    if (!groups.has(role)) {
      groups.set(role, []);
      firstSeenIndex.set(role, i);
    }
    groups.get(role)!.push([routePath, label]);
  });

  const namedRoleGroups = [...groups.entries()].filter(([role]) => role !== '');
  const pool = namedRoleGroups.length > 0
    ? namedRoleGroups.sort((a, b) =>
        b[1].length - a[1].length || firstSeenIndex.get(a[0])! - firstSeenIndex.get(b[0])!,
      )[0][1]
    : allRoutes;

  const bySegment: Map<string, [string, string]> = new Map();
  const leftovers: [string, string][] = [];
  for (const entry of pool) {
    const segment = entry[0].replace(/^\//, '').split('/')[0] || '/';
    if (!bySegment.has(segment)) bySegment.set(segment, entry);
    else leftovers.push(entry);
  }

  const diverse = [...bySegment.values()];
  return diverse.length >= max ? diverse.slice(0, max) : [...diverse, ...leftovers].slice(0, max);
}

function buildRecordingPlan(): TeaserClipPlan[] {
  const routes = selectDiverseFeatureRoutes(Object.entries(routeMap), MAX_FEATURES);
  const plan: TeaserClipPlan[] = LOGIN_TYPE === '0' ? [] : [
    { id: 'login', label: 'Login', targetUrl: LOGIN_URL, durationSec: LOGIN_SEC, needsAuth: false },
  ];

  if (routes.length === 0) {
    plan.push({ id: 'home', label: 'Home', targetUrl: APP_URL, durationSec: HERO_FEATURE_SEC, needsAuth: true });
    return plan;
  }

  routes.forEach(([routePath, label], i) => {
    const isHero = i === routes.length - 1;
    const id = routePath === '/'
      ? 'home'
      : routePath.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
    plan.push({
      id,
      label:       String(label),
      targetUrl:   `${APP_URL}${routePath}`,
      durationSec: isHero ? HERO_FEATURE_SEC : FEATURE_SEC,
      routePath,
      needsAuth:   true,
    });
  });
  return plan;
}

const RECORDING_PLAN = buildRecordingPlan();

// ─── Record one clip on an already-open context ───────────────────────────────

interface RecordedClip {
  id:                string;
  label:             string;
  routePath?:        string;
  videoPath:         string;
  framePath:         string;
  /** Measured seconds until the page settled — see recordOnCtx for how this is derived. */
  recordingStartSec: number;
}

// Real page-load time varies run to run with a live external app (network,
// server load, cold caches) — a fixed skip-into-the-recording constant isn't
// reliable (confirmed: one recording settled by ~2.5s, another took ~6s on the
// same route). Persisted alongside each cached recording so a cache-hit reuses
// the measured value instead of falling back to a guess.
function recordingStartSecMetaPath(id: string): string {
  return path.join(REC_DIR, `${id}.meta.json`);
}
function readCachedRecordingStartSec(id: string): number {
  try {
    const v = JSON.parse(fs.readFileSync(recordingStartSecMetaPath(id), 'utf-8')).recordingStartSec;
    return typeof v === 'number' ? v : RECORDING_SKIP_SEC;
  } catch {
    return RECORDING_SKIP_SEC; // older cached recording, predates per-clip measurement
  }
}
function writeCachedRecordingStartSec(id: string, recordingStartSec: number): void {
  try { fs.writeFileSync(recordingStartSecMetaPath(id), JSON.stringify({ recordingStartSec }), 'utf-8'); } catch {}
}

async function recordOnCtx(ctx: BrowserContext, plan: TeaserClipPlan, interact: boolean = true): Promise<RecordedClip> {
  console.log(`\n  ── Recording: ${plan.label} ──────────────────────────`);
  const page = await ctx.newPage();
  let navStart = Date.now();
  await page.goto(plan.targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // This app's client-side auth-refresh race (two concurrent /auth/refresh calls,
  // one 200/one 409 — see project_account_intelligence_login_race memory) can bounce
  // ANY fresh navigation back to /login, not just the first one in a context's
  // lifetime — a one-time warm-up before the loop isn't enough on its own. The
  // session itself is fine (proven by other clips in the same run succeeding), so
  // simply re-navigating settles it; retry a couple of times before giving up.
  if (plan.needsAuth) {
    const landedOnLogin = async () => {
      await page.waitForTimeout(800); // the client-side revert to the login form can lag domcontentloaded
      if (/\/login\b/.test(page.url())) return true;
      // Some failures re-render the login form client-side without an actual URL
      // redirect — a plain URL check misses those, so also probe for the password
      // field (same signal record-app-clips.ts's acquireSession relies on).
      return (await page.locator('input[type="password"]').count().catch(() => 0)) > 0;
    };
    for (let attempt = 0; attempt < 3 && (await landedOnLogin()); attempt++) {
      console.log(`    ⚠ Landed on login for "${plan.id}" (attempt ${attempt + 1}/3) — retrying navigation…`);
      navStart = Date.now();
      await page.goto(plan.targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    }
  }
  // Wait for network activity to settle — a generic, app-agnostic proxy for
  // "the page has loaded its data", instead of guessing a fixed number of
  // seconds that may not hold for every run. NOT sufficient on its own though:
  // confirmed by direct frame inspection that this app keeps showing a
  // skeleton-placeholder UI for ~1.5-2s *after* networkidle fires (a client-side
  // reveal animation untied to network activity) — recordingStartSec below adds
  // a deliberately generous fixed margin on top to cover that gap.
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  const settledSec = (Date.now() - navStart) / 1000;
  await suppressPopups(page);
  await page.waitForTimeout(500);

  // Real on-screen motion (scroll down then back up) instead of sitting on a
  // frozen frame for the rest of the clip — skipped for the login/brand card,
  // which is a fixed-height screen with nothing to scroll.
  if (interact) await performScrollInteraction(page);

  const elapsed   = Date.now() - navStart;
  const remaining = plan.durationSec * 1000 - elapsed;
  if (remaining > 0) await page.waitForTimeout(remaining);

  const framePath = path.join(REC_DIR, `${plan.id}-frame.png`);
  await page.screenshot({ path: framePath, fullPage: false });

  const videoObj = page.video();
  await page.close();
  // Generous margin past the measured networkidle point (see comment above —
  // visual settle lags network idle here), while always leaving at least 2s
  // of real footage even on a slow-loading run.
  const recordingStartSec = Math.min(settledSec + 2.0, Math.max(0, plan.durationSec - 2));

  const webmPath = await videoObj?.path() ?? '';
  const mp4Path  = path.join(REC_DIR, `${plan.id}.mp4`);
  if (webmPath && fs.existsSync(webmPath)) {
    convertToMp4(webmPath, mp4Path);
    fs.unlinkSync(webmPath);
  } else {
    console.error(`    ✗ WebM not found for "${plan.id}"`);
  }

  writeCachedRecordingStartSec(plan.id, recordingStartSec);
  return { id: plan.id, label: plan.label, routePath: plan.routePath, videoPath: `recordings/${plan.id}.mp4`, framePath, recordingStartSec };
}

// ─── Build demo-package.json ──────────────────────────────────────────────────

function buildTeaserPackage(
  clips:        RecordedClip[],
  content:      TeaserContent,
  brollFiles:   string[],
  musicRelPath: string | null,
  logoRelPath:  string | null,
): Record<string, unknown> {
  const loginClip    = clips.find(c => c.id === 'login');
  const featureClips = clips.filter(c => c.id !== 'login');
  const midpoint      = Math.max(1, Math.ceil(featureClips.length / 2));

  const brollHookPath    = brollFiles[0] ? `recordings/${brollFiles[0]}` : undefined;
  const brollPlainPath   = brollFiles[1] ? `recordings/${brollFiles[1]}` : brollHookPath;
  const brollBenefitPath = brollFiles[2] ? `recordings/${brollFiles[2]}` : brollPlainPath;

  let from = 0;
  const teaserBroll:    Record<string, unknown>[] = [];
  const teaserFeatures: Record<string, unknown>[] = [];

  const pushBroll = (id: string, mode: string, durSec: number, extra: Record<string, unknown>) => {
    const dur = Math.round(durSec * FPS);
    teaserBroll.push({ id, from, durationInFrames: dur, mode, ...extra });
    from += dur;
  };
  const pushFeature = (clip: RecordedClip, durSec: number, caption?: string) => {
    const dur = Math.round(durSec * FPS);
    teaserFeatures.push({
      id:                 `scene-${clip.id}`,
      from,
      durationInFrames:   dur,
      screenshotPath:     `recordings/${clip.id}-frame.png`,
      recordingPath:      clip.videoPath,
      recordingStartSec:  clip.recordingStartSec,
      ...(caption ? { caption } : {}),
    });
    from += dur;
  };

  pushBroll('broll-hook',  'hook',  BROLL_HOOK_SEC,  { videoPath: brollHookPath, headline: content.hookHeadline });
  pushBroll('broll-plain', 'plain', BROLL_PLAIN_SEC, { videoPath: brollPlainPath });
  if (loginClip) pushFeature(loginClip, LOGIN_SEC);

  featureClips.forEach((clip, i) => {
    if (i === midpoint && featureClips.length > 1) {
      pushBroll('broll-benefit', 'benefit', BROLL_BENEFIT_SEC, {
        videoPath: brollBenefitPath, benefitHeadline: content.benefitHeadline, benefitWords: content.benefitWords,
      });
    }
    const isHero = i === featureClips.length - 1;
    const caption = clip.routePath ? content.featureCaptions[clip.routePath] : undefined;
    pushFeature(clip, isHero ? HERO_FEATURE_SEC : FEATURE_SEC, caption);
  });

  if (featureClips.length <= 1) {
    pushBroll('broll-benefit', 'benefit', BROLL_BENEFIT_SEC, {
      videoPath: brollBenefitPath, benefitHeadline: content.benefitHeadline, benefitWords: content.benefitWords,
    });
  }

  const outroFrom = from;
  const outroDur  = Math.round(OUTRO_SEC * FPS);
  from += outroDur;

  return {
    composition: { id: 'TeaserVideo', durationInFrames: from, fps: FPS, width: VIEWPORT.width, height: VIEWPORT.height },
    teaserBroll,
    teaserFeatures,
    teaserOutro: {
      from: outroFrom, durationInFrames: outroDur, productName: PRODUCT_NAME, tagline: content.outroTagline,
      ...(logoRelPath ? { logoPath: logoRelPath } : {}),
    },
    ...(musicRelPath ? { teaserMusic: { path: musicRelPath, volume: MUSIC_VOLUME, fadeOutSec: MUSIC_FADE_SEC } } : {}),
    meta: { productName: PRODUCT_NAME, templateId: 'teaser' },
  };
}

// ─── Build voice-script.json — one narration segment per beat ────────────────

const FALLBACK_NARRATION = `Discover what ${PRODUCT_NAME} can do for your team.`;

function buildTeaserVoiceScript(
  pkg:     Record<string, unknown>,
  clips:   RecordedClip[],
  content: TeaserContent,
): Record<string, unknown> {
  const teaserBroll    = pkg.teaserBroll    as Array<{ id: string; from: number; durationInFrames: number }>;
  const teaserFeatures = pkg.teaserFeatures as Array<{ id: string; from: number; durationInFrames: number }>;
  const teaserOutro    = pkg.teaserOutro    as { from: number; durationInFrames: number };

  const brollNarration: Record<string, string> = {
    'broll-hook':    content.narration.hook,
    'broll-plain':   content.narration.plain,
    'broll-benefit': content.narration.benefit,
  };

  const brollSegments = teaserBroll
    .filter(b => brollNarration[b.id])
    .map(b => ({
      id:          b.id,
      label:       b.id,
      startSec:    b.from / FPS,
      durationSec: Math.max(2, b.durationInFrames / FPS - 0.5),
      enabled:     true,
      text:        brollNarration[b.id],
    }));

  const clipById = new Map(clips.map(c => [c.id, c]));
  const featureSegments = teaserFeatures.map(f => {
    const clipId = f.id.replace(/^scene-/, '');
    const clip   = clipById.get(clipId);
    const text   = clipId === 'login'
      ? content.narration.login
      : (clip?.routePath ? content.narration.feature[clip.routePath] : undefined) ?? FALLBACK_NARRATION;
    return {
      id:          f.id,
      label:       f.id,
      startSec:    f.from / FPS,
      durationSec: Math.max(2, f.durationInFrames / FPS - 1),
      enabled:     true,
      text,
    };
  });

  const outroSegment = {
    id:          'outro',
    label:       'Outro',
    startSec:    teaserOutro.from / FPS,
    durationSec: Math.max(2, teaserOutro.durationInFrames / FPS - 1),
    enabled:     true,
    text:        content.narration.outro,
  };

  const compDuration = (pkg.composition as { durationInFrames: number }).durationInFrames;

  return {
    voice:            'nova',
    model:            'tts-hd',
    speed:            0.95,
    fps:              FPS,
    totalDurationSec: Math.round((compDuration / FPS) * 10) / 10,
    segments:         [...brollSegments, ...featureSegments, outroSegment],
  };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`  🎬  ${PRODUCT_NAME} — Teaser Recording Pipeline`);
  console.log(`      APP_URL    : ${APP_URL}`);
  console.log(`      Output     : ${OUT_DIR}`);
  console.log(`      Features   : ${RECORDING_PLAN.length - 1} route(s) (from APP_ROUTE_MAP, capped at ${MAX_FEATURES})`);
  console.log('════════════════════════════════════════════════════════════\n');

  const forceRerecord = process.env['FORCE_RERECORD'] === 'true';
  const routePaths = RECORDING_PLAN.filter(p => p.routePath).map(p => p.routePath!);

  console.log('  Generating on-screen copy from APP_CONTEXT_TEXT…');
  const content = await generateTeaserContent(routePaths);
  console.log(`  ✓ Hook: "${content.hookHeadline}"  |  Benefit: "${content.benefitHeadline}"`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
  });

  const recorded: RecordedClip[] = [];

  for (const plan of RECORDING_PLAN) {
    const mp4   = path.join(REC_DIR, `${plan.id}.mp4`);
    const frame = path.join(REC_DIR, `${plan.id}-frame.png`);
    if (!forceRerecord && fs.existsSync(mp4) && fs.existsSync(frame) && fs.statSync(mp4).size > 50_000) {
      console.log(`\n  ── ${plan.label}  [CACHED — skipping] ──────────────────`);
      recorded.push({
        id: plan.id, label: plan.label, routePath: plan.routePath, videoPath: `recordings/${plan.id}.mp4`, framePath: frame,
        recordingStartSec: readCachedRecordingStartSec(plan.id),
      });
    }
  }

  const remainingPlans = RECORDING_PLAN.filter(p => !recorded.some(r => r.id === p.id));
  const loginPlan = remainingPlans.find(p => !p.needsAuth);
  const authPlans = remainingPlans.filter(p => p.needsAuth);

  try {
    if (loginPlan) {
      fs.mkdirSync(TMP_REC_DIR, { recursive: true });
      const unauthCtx = await browser.newContext({
        viewport: VIEWPORT, recordVideo: { dir: TMP_REC_DIR, size: VIEWPORT }, ignoreHTTPSErrors: true,
      });
      try {
        recorded.push(await recordOnCtx(unauthCtx, loginPlan, false));
      } catch (err) {
        console.warn(`  ✗ Login clip failed — skipping. (${(err as Error).message?.slice(0, 120)})`);
      } finally {
        await unauthCtx.close();
      }
    }

    if (authPlans.length > 0) {
      const primaryRole = (() => {
        const first = authPlans[0];
        return first ? extractPrimaryRole(first.label) ?? undefined : undefined;
      })();

      console.log(`\n  Acquiring auth session${primaryRole ? ` (role: "${primaryRole}")` : ''}…`);
      // ensureSession/performLogin throws outright when LOGIN_TYPE=2 and no Quick
      // Access UI can be found at all (as opposed to finding the section but not
      // this role's card, which already degrades gracefully). Left uncaught, that
      // exception escapes to main()'s top-level catch and aborts the whole teaser
      // run — the same crash class fixed in record-app-clips.ts's acquireSession;
      // this script has its own separate (simpler) login path that never got that
      // fix. Treat a thrown login error the same as ensureSession returning null —
      // the code below already handles that gracefully.
      let session: SessionState | null = null;
      try {
        session = await ensureSession(browser, {
          appUrl:   APP_URL,
          viewport: VIEWPORT,
          credentials: {
            username:            APP_USERNAME,
            password:            APP_PASSWORD,
            loginType:           (LOGIN_TYPE === '2' ? 2 : LOGIN_TYPE === '0' ? 0 : 1),
            quickAccessIndex:    QUICK_ACCESS_INDEX,
            quickAccessRoleName: primaryRole,
          },
        });
      } catch (err) {
        console.warn(`  ↳ Login threw an error — skipping authenticated clips. (${(err as Error).message?.slice(0, 150)})`);
      }

      if (!session) {
        console.error('  ✗ Could not establish an authenticated session — check APP_USERNAME/APP_PASSWORD/LOGIN_TYPE in .env');
      } else {
        fs.mkdirSync(TMP_REC_DIR, { recursive: true });
        const authCtx = await createAuthContext(browser, session, {
          viewport: VIEWPORT, recordVideo: { dir: TMP_REC_DIR, size: VIEWPORT },
        });
        // A context hydrated from storageState has never actually loaded the app —
        // going straight from here to a deep protected route consistently loses this
        // app's client-side auth-refresh race (two concurrent /auth/refresh calls,
        // one 200/one 409) and lands back on /login for the ENTIRE clip. Warming the
        // context up on a safe landing route first (same as a real browser session
        // that's already past its initial auth check) settles that race before any
        // recording starts — confirmed reliable across repeated manual checks of the
        // exact same deep routes, where only the very first navigation ever failed.
        const warmupPage = await authCtx.newPage();
        await warmupPage.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await warmupPage.waitForTimeout(2500);
        await warmupPage.close();
        try {
          for (const plan of authPlans) {
            try {
              recorded.push(await recordOnCtx(authCtx, plan));
            } catch (err) {
              console.warn(`  ✗ Clip "${plan.id}" failed — skipping. (${(err as Error).message?.slice(0, 120)})`);
            }
          }
        } finally {
          await authCtx.close();
        }
      }
    }
  } finally {
    await browser.close();
  }

  if (recorded.length === 0) {
    console.error('\n  ✗ No clips were recorded or cached — demo-package.json NOT written.');
    process.exit(1);
  }

  // ── B-roll — reuse the already-generic download-broll-videos.ts as-is ──────
  if (forceRerecord && fs.existsSync(REC_DIR)) {
    for (const f of fs.readdirSync(REC_DIR).filter(f => f.startsWith('broll-') && f.endsWith('.mp4'))) {
      try { fs.unlinkSync(path.join(REC_DIR, f)); } catch {}
    }
  }
  const needsBrolls = forceRerecord || !fs.existsSync(REC_DIR) ||
    !['broll-0.mp4', 'broll-1.mp4'].every(f => {
      const p = path.join(REC_DIR, f);
      return fs.existsSync(p) && fs.statSync(p).size > 5_000_000;
    });
  if (needsBrolls) {
    console.log(`\n  B-roll: downloading stock videos from Pexels for ${PRODUCT_NAME}…`);
    if (process.env['PEXELS_API_KEY']) {
      try {
        execSync('npm run broll:download', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
      } catch {
        console.warn('  ⚠️  Pexels download failed — check PEXELS_API_KEY and network connectivity.');
        console.warn('  ⚠️  B-roll cards will render without video (headline/benefit text only).');
      }
    } else {
      console.warn('  ⚠️  PEXELS_API_KEY not set — skipping b-roll download.');
    }
  }
  const brollFiles = fs.existsSync(REC_DIR)
    ? fs.readdirSync(REC_DIR).filter(f => /^broll-\d+\.mp4$/.test(f)).sort()
    : [];

  // ── Background music — reuse fetch-background-music.ts, copy into public-dir ──
  console.log('\n  Fetching background music…');
  let musicRelPath: string | null = null;
  try {
    const musicPath = await fetchBackgroundMusic();
    if (musicPath) {
      const musicDir = path.join(OUT_DIR, 'music');
      fs.mkdirSync(musicDir, { recursive: true });
      const dest = path.join(musicDir, 'background.mp3');
      fs.copyFileSync(musicPath, dest);
      musicRelPath = 'music/background.mp3';
      console.log(`  ✓ Music ready: ${musicRelPath}`);
    } else {
      console.warn('  ⚠️  No background music available — teaser will render silently.');
    }
  } catch (err) {
    console.warn(`  ⚠️  Background music fetch failed: ${(err as Error).message}`);
  }

  // ── Client logo — optional, copied into public-dir so the outro can use it ──
  let logoRelPath: string | null = null;
  if (APP_LOGO_PATH) {
    const srcLogo = path.isAbsolute(APP_LOGO_PATH) ? APP_LOGO_PATH : path.resolve(__dirname, '..', APP_LOGO_PATH);
    if (fs.existsSync(srcLogo)) {
      const assetsDir = path.join(OUT_DIR, 'assets');
      fs.mkdirSync(assetsDir, { recursive: true });
      const ext = path.extname(srcLogo) || '.png';
      const dest = path.join(assetsDir, `client-logo${ext}`);
      fs.copyFileSync(srcLogo, dest);
      logoRelPath = `assets/client-logo${ext}`;
      console.log(`  ✓ Client logo ready: ${logoRelPath}`);
    } else {
      console.warn(`  ⚠️  APP_LOGO_PATH set but not found: ${srcLogo} — outro will use a text wordmark instead.`);
    }
  }

  const pkg = buildTeaserPackage(recorded, content, brollFiles, musicRelPath, logoRelPath);
  fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2), 'utf-8');
  console.log(`\n  ✓  demo-package.json → ${PKG_PATH}`);

  const voiceScript = buildTeaserVoiceScript(pkg, recorded, content);
  fs.writeFileSync(VOICE_PATH, JSON.stringify(voiceScript, null, 2), 'utf-8');
  console.log(`  ✓  voice-script.json  → ${VOICE_PATH}`);

  const total = (pkg.composition as { durationInFrames: number }).durationInFrames;
  console.log(`\n  Total duration : ${total} frames = ${(total / FPS).toFixed(1)}s`);
  console.log(`  Feature clips  : ${(pkg.teaserFeatures as unknown[]).length}`);
  console.log(`  B-roll cards   : ${(pkg.teaserBroll as unknown[]).length}`);

  // ── Voice narration — synthesize MP3s, resync scene timings to actual length ──
  console.log('\n  🎙️  Generating voice narration…');
  try {
    execSync('npm run voice:only', {
      cwd:   path.resolve(__dirname, '..'),
      stdio: 'inherit',
    });
    const vs       = JSON.parse(fs.readFileSync(VOICE_PATH, 'utf-8')) as Record<string, unknown>;
    const segDir   = path.join(OUT_DIR, (vs['voiceDir'] as string | undefined) ?? 'voice-segments');
    const mp3Count = fs.existsSync(segDir)
      ? fs.readdirSync(segDir).filter(f => f.endsWith('.mp3')).length
      : 0;
    if (mp3Count > 0) {
      vs['voiceReady'] = true;
      fs.writeFileSync(VOICE_PATH, JSON.stringify(vs, null, 2), 'utf-8');
      console.log(`  ✓  Voice ready: ${mp3Count} segments generated`);
    } else {
      console.warn('  ⚠️  voice:only ran but no MP3s found — composition will render silently.');
    }
  } catch (err) {
    console.warn(`  ⚠️  Voice generation failed: ${(err as Error).message}`);
    console.warn('      Run  npm run voice:only  manually to retry.');
  }

  console.log(`\n  ✅  Done! Open TeaserVideo in Remotion Studio:\n      npm start\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
