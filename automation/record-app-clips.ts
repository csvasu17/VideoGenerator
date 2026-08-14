/**
 * record-priorauth-clips.ts — Generic recording pipeline
 *
 * Records screen-capture clips for any configured app and writes
 * out/<slug>/demo-package.json + out/<slug>/voice-script.json.
 *
 * All parameters are read from .env — NO hardcoded product values:
 *   APP_URL          — target application URL
 *   APP_PRODUCT_NAME — product name (output folder + metadata)
 *   LOGIN_TYPE       — 1 = username/password form, 2 = Quick Access card click
 *   APP_USERNAME     — username (type 1) or card name to click (type 2)
 *   APP_PASSWORD     — password (type 1 only)
 *   APP_ROUTE_MAP    — JSON: { "/path": "Page description", ... }
 *   APP_CONTEXT_TEXT — product description (powers AI narration and content)
 *   APP_GLOSSARY     — KEY=Value domain terms for narration
 *   APP_LANGUAGE     — narration language (default: en)
 */

import { chromium }       from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import * as fs            from 'fs';
import * as path          from 'path';
import * as dotenv        from 'dotenv';
import { AzureOpenAI }   from 'openai';
import { getVideoInfo }  from './utils/ffprobe';
import { execSync }      from 'child_process';
import { OUT_DIR, SCREEN_FIT, toSlug } from './config';
import { createAuthContext, performLogin, isQuickAccessScreenShowing, installAuthRefreshDedupe } from './utils/session';
import type { SessionState, RoleMatchConfidence } from './utils/session';
import { GENERIC_NARRATIONS } from './utils/constants';
import { extractPrimaryRole } from './utils/roleLabel';
import {
  validateDemoScenes, printValidationReport,
  detectUrlMismatches, detectDuplicateFrames,
} from './utils/demoValidation';

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
      const waitMs = retryAfter > 0 ? retryAfter : delay;
      console.warn(`    ⏳ Rate-limited — retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${maxRetries})…`);
      await new Promise(r => setTimeout(r, waitMs));
      delay *= 2;
    }
  }
  throw new Error('retryWithBackoff: unreachable');
}

// ─── Config — all values from .env ───────────────────────────────────────────

const APP_URL      = (process.env['APP_URL'] ?? 'http://localhost:3000').replace(/\/$/, '');
const LOGIN_TYPE   = process.env['LOGIN_TYPE'] ?? '1';
const APP_USERNAME = process.env['APP_USERNAME'] ?? '';
const APP_PASSWORD = process.env['APP_PASSWORD'] ?? '';
// Extra credential sets for LOGIN_TYPE=1 apps that need more than one login to reach
// every route (e.g. an admin section behind a separate account) — set from the Config
// UI's "+ Add User" list, one JSON-array env var mirroring APP_ROUTE_MAP's own
// convention. No manual role naming required: ROLE_CREDENTIALS (built once routeMap is
// parsed below) assigns these positionally to whichever distinct roles APP_ROUTE_MAP
// itself already implies, in the order each is first encountered.
interface AdditionalUser { username: string; password: string }
const ADDITIONAL_USERS: AdditionalUser[] = (() => {
  const raw = process.env['APP_ADDITIONAL_USERS'];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((u): u is AdditionalUser => !!u?.username) : [];
  } catch {
    return [];
  }
})();
// Populated after routeMap is parsed below (ROLE_CREDENTIALS declaration further down)
// — declared as a function here (hoisted) so callers earlier in the file can still
// reference it; it's only ever invoked once the pipeline is actually running, by
// which point the whole module has finished initializing.
function credentialsForRole(roleName?: string): { username: string; password: string } {
  const mapped = roleName ? ROLE_CREDENTIALS.get(roleName) : undefined;
  return mapped ?? { username: APP_USERNAME, password: APP_PASSWORD };
}
const PRODUCT_NAME = process.env['APP_PRODUCT_NAME'] || (() => {
  try { return new URL(APP_URL).hostname; } catch { return 'Product'; }
})();
// APP_LOGIN_PATH lets you override the login page path (default /login).
// Set APP_LOGIN_PATH=/ if the app redirects from root to its login screen.
const APP_LOGIN_PATH = (process.env['APP_LOGIN_PATH'] ?? '/login').replace(/^\//, '');
// Build LOGIN_URL without double-slash: strip trailing slash from APP_URL first.
const LOGIN_URL = APP_LOGIN_PATH
  ? `${APP_URL.replace(/\/$/, '')}/${APP_LOGIN_PATH}`
  : APP_URL.replace(/\/$/, '') + '/';
const REC_DIR      = path.join(OUT_DIR, 'recordings');
const TMP_REC_DIR  = path.join(OUT_DIR, '_tmp_rec');
const PKG_PATH     = path.join(OUT_DIR, 'demo-package.json');
const VOICE_PATH   = path.join(OUT_DIR, 'voice-script.json');

const FPS           = 30;
const VIEWPORT      = { width: 1920, height: 1080 };
const BROLL_FRAMES  = 240;   // 8 s per b-roll
const PRODUCT_SEC   = 14;    // default scene duration
const BENEFIT_SEC   = 18;
const PRESENTER_SEC = 16;
// With session-based auth the browser navigates DIRECTLY to the target page —
// no login form, so content is visible by second 2-3.  A small skip is still
// useful to hide the initial page-load flash / spinner.
const LOGIN_SKIP_SEC = 3;

fs.mkdirSync(REC_DIR, { recursive: true });

// ─── Azure OpenAI ─────────────────────────────────────────────────────────────

const azureClient = new AzureOpenAI({
  apiKey:     process.env['AZURE_OPENAI_API_KEY']    ?? '',
  endpoint:   process.env['AZURE_OPENAI_ENDPOINT']   ?? '',
  deployment: process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
  apiVersion: process.env['OPENAI_API_VERSION']      ?? '2024-12-01-preview',
});

const APP_CONTEXT       = process.env['APP_CONTEXT_TEXT'] ?? '';
const APP_GLOSSARY      = process.env['APP_GLOSSARY']     ?? '';
const APP_ROUTE_MAP_RAW = process.env['APP_ROUTE_MAP']    ?? '{}';
const APP_LANGUAGE      = process.env['APP_LANGUAGE']     ?? 'en';

const LANGUAGE_NAMES: Record<string, string> = {
  fr: 'French', de: 'German', es: 'Spanish', it: 'Italian',
  pt: 'Portuguese', ja: 'Japanese', zh: 'Chinese', ko: 'Korean',
};
const LANGUAGE_NAME = LANGUAGE_NAMES[APP_LANGUAGE.split('-')[0].toLowerCase()] ?? null;

let routeMap: Record<string, string> = {};
try { if (APP_ROUTE_MAP_RAW) routeMap = JSON.parse(APP_ROUTE_MAP_RAW); } catch {}

// Assigns each "Additional User" (username/password only — no role field, so nothing
// to configure by hand) to a distinct role implied by APP_ROUTE_MAP, in the order
// each role is first encountered scanning the route labels. The first distinct role
// found keeps the primary APP_USERNAME/PASSWORD; each one after that gets the next
// unused Additional User; any roles beyond the number of Additional Users configured
// fall back to the primary credentials (same graceful-degradation behavior as before
// this feature existed).
const ROLE_CREDENTIALS = new Map<string, { username: string; password: string }>();
if (LOGIN_TYPE === '1' && ADDITIONAL_USERS.length > 0) {
  const rolesInFirstAppearanceOrder: string[] = [];
  for (const label of Object.values(routeMap)) {
    const role = extractPrimaryRole(String(label));
    if (role && !rolesInFirstAppearanceOrder.includes(role)) rolesInFirstAppearanceOrder.push(role);
  }
  rolesInFirstAppearanceOrder.slice(1).forEach((role, i) => {
    const cred = ADDITIONAL_USERS[i];
    if (cred) ROLE_CREDENTIALS.set(role, cred);
  });
}

// Optional per-app override for specific routes — e.g. a real multi-step `actions`
// sequence for a "hero" workflow (discovered by hand against the live app; no AI
// can invent real selectors), or a hand-tuned workflow/painPoint/ahaMoment wording.
// Unset routes fall back entirely to the AI-generated defaults from
// generateDemoPainPoints() below. Generic — same JSON-in-env-var pattern as
// APP_ROUTE_MAP, works for any app, not specific to this one.
interface DemoPainPointOverride {
  workflow?:    string;
  painPoint?:   string;
  ahaMoment?:   string;
  actions?:     ClipAction[];   // if present, replaces defaultActions during recording
  durationSec?: number;         // recording duration when actions is set (default: HERO_DURATION_SEC)
}
let painPointOverrides: Record<string, DemoPainPointOverride> = {};
try {
  const raw = process.env['DEMO_PAIN_POINTS'];
  if (raw) painPointOverrides = JSON.parse(raw);
} catch {}

// ─── AI: frame analysis ───────────────────────────────────────────────────────

function formatPainPointBlock(painPoint?: DemoPainPointEntry): string {
  if (!painPoint) return '';
  return `\nREAL WORKFLOW ON THIS SCREEN (build narration around this — do not restate generic product framing):\n` +
    `Workflow: ${painPoint.workflow}\nPain point removed: ${painPoint.painPoint}\nAha moment: ${painPoint.ahaMoment}`;
}

/** Routes with a hand-authored multi-step `actions` sequence (see DEMO_PAIN_POINTS)
 *  get a slightly longer narration budget — they have a real click-through to narrate,
 *  not just a static screen. Every other route stays terse: customer-facing demos lose
 *  attention fast when narration runs long over a frozen frame. */
function isHeroRoute(routePath: string): boolean {
  return (painPointOverrides[routePath]?.actions?.length ?? 0) > 0;
}

// Tight budgets, strictly enforced — these are ceilings, not targets, because models
// reliably overshoot a "~N words" suggestion when asked to hit multiple beats.
// Ceilings are calibrated against generate-voice.ts's actual rate (wordCount / (2.5 * speed),
// speed=0.95 ≈ 2.375 words/sec) and real recorded clip lengths: non-hero scenes run ~19.6-20.8s,
// hero scenes ~20-24s (both minus the 2s cross-fade reserve applied in buildVoiceScript). 45 words
// ≈ 19s (fits non-hero); 50 words ≈ 21s (fits the 20s-available hero routes, comfortably fits the
// 24s-available one). Models reliably land AT or slightly under a stated ceiling, never under-shoot
// it by much, so these are set to the tightest real budget rather than an average.
const NARRATION_INSTRUCTION_TIGHT =
  `"narration": "STRICT MAXIMUM 45 words, exactly two sentences: (1) the specific pain point from the REAL WORKFLOW block, stated concretely — never generic phrasing like 'streamlines workflows', (2) what the user does on THIS screen and the aha-moment outcome, combined into one sentence. If you can see the actual screenshot, prefer real numbers/labels/names visible on screen over the REAL WORKFLOW block's wording when they differ — never state a specific number, device ID, or name that isn't actually visible on screen. Every word must earn its place; do not pad."`;
const NARRATION_INSTRUCTION_HERO =
  `"narration": "STRICT MAXIMUM 50 words, exactly two sentences: (1) the specific pain point from the REAL WORKFLOW block plus the exact click-through action happening on this screen, (2) the aha-moment outcome. If you can see the actual screenshot, prefer real numbers/labels/names visible on screen over the REAL WORKFLOW block's wording when they differ — never state a specific number, device ID, or name that isn't actually visible on screen. Every word must earn its place; do not pad."`;
const NARRATION_INSTRUCTION_DEFAULT =
  `"narration": "STRICT MAXIMUM 45 words, exactly two sentences: (1) the specific business pain this screen addresses, (2) what the user does here and the measurable outcome, combined into one sentence. Be concrete and product-specific. Every word must earn its place; do not pad."`;
// The login/intro clip has no route-map match (no pagePurpose) and is recorded much shorter
// (~10-12s available) than any real content scene — the 45-word default still overflows it.
const NARRATION_INSTRUCTION_INTRO =
  `"narration": "STRICT MAXIMUM 25 words, one sentence introducing the product and inviting the viewer to see how it works. Every word must earn its place; do not pad."`;

function pickNarrationInstruction(painPoint: DemoPainPointEntry | undefined, isHero: boolean, pagePurpose?: string): string {
  if (!pagePurpose) return NARRATION_INSTRUCTION_INTRO;
  if (!painPoint) return NARRATION_INSTRUCTION_DEFAULT;
  return isHero ? NARRATION_INSTRUCTION_HERO : NARRATION_INSTRUCTION_TIGHT;
}

async function analyzeFrameTextOnly(
  pagePurpose: string,
  painPoint?:  DemoPainPointEntry,
  isHero:      boolean = false,
): Promise<{ featureTitle: string; salesHook: string; narration: string }> {
  const langInstruction = LANGUAGE_NAME
    ? `\n\nIMPORTANT: Write ALL output text values in ${LANGUAGE_NAME}.`
    : '';

  const prompt = `You are a B2B SaaS demo video script writer.
${APP_CONTEXT ? `\nPRODUCT CONTEXT:\n${APP_CONTEXT}` : ''}
${formatPainPointBlock(painPoint)}
${pagePurpose ? `\nCURRENT PAGE: ${pagePurpose}` : ''}
${APP_GLOSSARY ? `\nDOMAIN GLOSSARY (use these exact terms):\n${APP_GLOSSARY}` : ''}

Based on the product context and the current page description above, output a JSON object (no markdown fences) with exactly:
{
  "featureTitle": "short 2-4 word feature name",
  "salesHook": "compelling 6-10 word hook focusing on business value",
  ${pickNarrationInstruction(painPoint, isHero, pagePurpose)}
}
Be specific to this product page. Use domain glossary terms accurately.${langInstruction}`;

  const response = await retryWithBackoff(() => azureClient.chat.completions.create({
    model:             process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
    max_completion_tokens: 1500,
    reasoning_effort:  'low',
    messages: [{ role: 'user', content: prompt }],
  }));

  const raw = response.choices[0]?.message?.content ?? '{}';
  const p = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, ''));
  return {
    featureTitle: p.featureTitle ?? 'Platform Feature',
    salesHook:    p.salesHook    ?? 'Streamline your workflow instantly.',
    narration:    p.narration    ?? `${pagePurpose || PRODUCT_NAME} — streamline your operations.`,
  };
}

async function analyzeFrame(
  framePath:   string,
  targetUrl?:  string,
  painPoints?: DemoPainPoints,
): Promise<{ featureTitle: string; salesHook: string; narration: string }> {
  const b64 = fs.readFileSync(framePath).toString('base64');

  let pagePurpose = '';
  let painPoint: DemoPainPointEntry | undefined;
  let isHero = false;
  if (targetUrl && Object.keys(routeMap).length > 0) {
    try {
      const urlPath = new URL(targetUrl).pathname;
      const key = Object.keys(routeMap).find(k => urlPath.startsWith(k.replace(/\[.*?\]/g, '')));
      if (key) {
        pagePurpose = routeMap[key];
        painPoint   = painPoints?.[key];
        isHero      = isHeroRoute(key);
      }
    } catch {}
  }

  const sections: string[] = ['You are a B2B SaaS demo video script writer.'];
  if (APP_CONTEXT)  sections.push(`\nPRODUCT CONTEXT:\n${APP_CONTEXT}`);
  sections.push(formatPainPointBlock(painPoint));
  if (pagePurpose)  sections.push(`\nCURRENT PAGE: ${pagePurpose}`);
  if (APP_GLOSSARY) sections.push(`\nDOMAIN GLOSSARY (use these exact terms in narration):\n${APP_GLOSSARY}`);
  const langInstruction = LANGUAGE_NAME
    ? `\n\nIMPORTANT: Write ALL output text values in ${LANGUAGE_NAME}.`
    : '';

  sections.push(`
Given a product screenshot, output a JSON object (no markdown fences) with exactly:
{
  "featureTitle": "short 2-4 word feature name",
  "salesHook": "compelling 6-10 word hook focusing on business value",
  ${pickNarrationInstruction(painPoint, isHero, pagePurpose)}
}
Be specific to what you see. Use domain glossary terms accurately.${langInstruction}`);

  let visionResult: { featureTitle: string; salesHook: string; narration: string } | null = null;
  try {
    const response = await retryWithBackoff(() => azureClient.chat.completions.create({
      model:      process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
      max_completion_tokens: 1500,
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: sections.join('') },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}`, detail: 'low' } },
            { type: 'text', text: 'Analyse this product screenshot and return the JSON.' },
          ],
        },
      ],
    }));

    const raw = response.choices[0]?.message?.content ?? '{}';
    const p = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, ''));
    visionResult = {
      featureTitle: p.featureTitle ?? '',
      salesHook:    p.salesHook    ?? '',
      narration:    p.narration    ?? '',
    };
  } catch {
    // Vision not supported by this model deployment — fall through to text-only
  }

  // If vision succeeded and returned non-generic narration, use it
  if (visionResult && visionResult.narration && !GENERIC_NARRATIONS.has(visionResult.narration)) {
    return visionResult;
  }

  // Fall back to text-only narration using page context
  if (pagePurpose || APP_CONTEXT) {
    try {
      return await analyzeFrameTextOnly(pagePurpose, painPoint, isHero);
    } catch { /* fall through */ }
  }

  return {
    featureTitle: visionResult?.featureTitle || 'Platform Feature',
    salesHook:    visionResult?.salesHook    || 'Streamline your workflow instantly.',
    narration:    visionResult?.narration    || `${pagePurpose || PRODUCT_NAME} — purpose-built to streamline your operations.`,
  };
}

// ─── AI: benefit slide content ────────────────────────────────────────────────

interface BenefitBullet { icon: string; label: string; description: string }
interface BenefitContent { title: string; bullets: BenefitBullet[] }

async function generateBenefitContent(): Promise<BenefitContent> {
  const DEFAULT: BenefitContent = {
    title: `${PRODUCT_NAME} — Key Benefits`,
    bullets: [
      { icon: 'speed',      label: 'Faster Workflows',    description: 'Automate repetitive tasks and cut processing time dramatically.' },
      { icon: 'accuracy',   label: 'AI-Powered Accuracy', description: 'Machine learning validates data in real time, eliminating costly errors.' },
      { icon: 'oversight',  label: 'Full Visibility',     description: 'Real-time dashboards keep every stakeholder informed at all times.' },
      { icon: 'compliance', label: 'Audit Ready',         description: 'Every action is logged for compliance reviews and accountability.' },
      { icon: 'revenue',    label: 'Scales With You',     description: 'Cloud-native architecture grows with your business without friction.' },
    ],
  };

  if (!APP_CONTEXT) return DEFAULT;

  try {
    const resp = await retryWithBackoff(() => azureClient.chat.completions.create({
      model:      process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
      max_completion_tokens: 1800,
      reasoning_effort: 'low',
      messages: [{
        role: 'user',
        content: `Product context: "${APP_CONTEXT}"

Generate a benefit slide for a B2B SaaS demo video for "${PRODUCT_NAME}". Return JSON only (no markdown):
{
  "title": "${PRODUCT_NAME} — Key Benefits",
  "bullets": [
    { "icon": "speed|accuracy|oversight|compliance|revenue", "label": "2-4 word label", "description": "One sentence business value (~15 words)" }
  ]
}
Include exactly 5 bullets. Icons must be one of: speed, accuracy, oversight, compliance, revenue.`,
      }],
    }));
    const text   = resp.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '')) as BenefitContent;
    if (parsed?.title && Array.isArray(parsed?.bullets) && parsed.bullets.length >= 5) return parsed;
  } catch { /* fall through to default */ }

  return DEFAULT;
}

// ─── AI: b-roll problem statements ────────────────────────────────────────────

async function generateBrollSubtitles(): Promise<string[]> {
  const DEFAULT = [
    'Teams lose hours every day to manual processes and fragmented workflows.',
    'Data entry errors cascade into costly rework and compliance risks.',
    'Disconnected systems leave decision-makers without real-time visibility.',
    'Without automation, scaling operations requires unsustainable headcount growth.',
    'Manual processes create audit gaps and expose organizations to regulatory risk.',
  ];

  if (!APP_CONTEXT) return DEFAULT;

  try {
    const resp = await retryWithBackoff(() => azureClient.chat.completions.create({
      model:      process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
      max_completion_tokens: 1200,
      reasoning_effort: 'low',
      messages: [{
        role: 'user',
        content: `Product context: "${APP_CONTEXT}"

Generate 5 punchy B2B problem statements (10-15 words each) describing pain points "${PRODUCT_NAME}" solves. Return a JSON array only (no markdown):
["Pain point 1", "Pain point 2", "Pain point 3", "Pain point 4", "Pain point 5"]`,
      }],
    }));
    const text   = resp.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '')) as string[];
    if (Array.isArray(parsed) && parsed.length >= 5) return parsed.slice(0, 5);
  } catch { /* fall through to default */ }

  return DEFAULT;
}

// ─── AI: per-route workflow & pain point ──────────────────────────────────────
// Generic for any app — derives a real workflow/pain-point/aha-moment per route
// from APP_CONTEXT_TEXT + APP_ROUTE_MAP so narration describes what a user
// actually does on that screen instead of restating the generic product pitch.
// Apps can override/extend individual routes via DEMO_PAIN_POINTS (see routeMap
// parsing above) — this function only supplies the automatic default.

interface DemoPainPointEntry {
  workflow:  string;   // the concrete action a user takes on this screen
  painPoint: string;   // what this removes/solves
  ahaMoment: string;   // the observable outcome
}
type DemoPainPoints = Record<string, DemoPainPointEntry>;

async function generateDemoPainPoints(): Promise<DemoPainPoints> {
  if (!APP_CONTEXT || Object.keys(routeMap).length === 0) return {};

  try {
    const resp = await retryWithBackoff(() => azureClient.chat.completions.create({
      model:      process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
      max_completion_tokens: 4000,
      reasoning_effort: 'low',
      messages: [{
        role: 'user',
        content: `You are a B2B SaaS demo script writer.
PRODUCT CONTEXT:
${APP_CONTEXT}
${APP_GLOSSARY ? `\nDOMAIN GLOSSARY:\n${APP_GLOSSARY}\n` : ''}
ROUTES:
${Object.entries(routeMap).map(([path, label]) => `${path}: ${label}`).join('\n')}

For EACH route above, describe the real workflow a user performs on that screen, the specific
pain point it removes, and an observable "aha moment" outcome. Use domain glossary terms/metric
NAMES where they fit (e.g. "RUL", "VIB RMS", "COST AVOIDANCE"), but do NOT invent specific fake
numbers, device IDs, or names (e.g. no "DV-101" or "motor A") — this text will be layered onto a
real screenshot later and must not contradict it. Describe the general SHAPE of the action and
outcome (e.g. "reviews the AI-ranked list and accepts the top recommendation to create a work
order"), not invented literal specifics. Return ONLY a JSON object keyed by route path (use the
exact route paths above), no markdown fences:
{ "/route": { "workflow": "...", "painPoint": "...", "ahaMoment": "..." }, ... }`,
      }],
    }));
    const text   = resp.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '')) as DemoPainPoints;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch { /* fall through — routes just keep today's plain pagePurpose narration */ }

  return {};
}

// ─── Suppress notification popups ─────────────────────────────────────────────

const SUPPRESS_CSS = `
  [class*="toast"]:not(button),[class*="snackbar"],[class*="notification"]:not(nav),
  [class*="alert"][class*="panel"],[class*="modal-overlay"]:not([class*="content"]) {
    display:none!important;
  }
`;

// First-time-login onboarding/consent gates (e.g. a GDPR "Data Privacy Notice" modal
// shown once per account) block the real dashboard behind an overlay. Dismiss it so
// the recorded frame shows the actual page instead of the consent screen.
const CONSENT_ACCEPT_SELECTOR = [
  'button:has-text("Accept & Continue")', 'button:has-text("Accept and Continue")',
  'button:has-text("Accept All & Continue")', 'button:has-text("I Agree & Continue")',
  'button:has-text("Accept All")', 'button:has-text("I Agree")',
  'button:has-text("I Understand")', 'button:has-text("Got it")',
].join(', ');

async function dismissConsentModal(page: Page): Promise<void> {
  try {
    const acceptBtn = page.locator(CONSENT_ACCEPT_SELECTOR).first();
    const visible = await acceptBtn.isVisible({ timeout: 1000 }).catch(() => false);
    if (!visible) return;

    // Some consent flows disable the button until an "I have read and understood" box is ticked.
    const checkbox = page.locator('input[type="checkbox"]').first();
    if (await checkbox.isVisible({ timeout: 500 }).catch(() => false)) {
      await checkbox.check({ force: true }).catch(() => {});
    }
    await acceptBtn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1000);
  } catch {
    // best-effort only — never fail the recording over a missed consent gate
  }
}

async function suppressPopups(page: Page): Promise<void> {
  await dismissConsentModal(page);
  await page.addStyleTag({ content: SUPPRESS_CSS }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(200);
}

// ─── Session-based login ───────────────────────────────────────────────────────
// Three-layer strategy:
//   1. Reuse cached .tmp/session-state.json if < 8 h old and still valid
//   2. Try headless login with keyboard.type() + anti-bot bypass
//   3. Open a VISIBLE browser — user logs in manually (2-min window)

const TMP_DIR = path.resolve(__dirname, '../.tmp');

// ── Layer 2: headless login ──
async function tryHeadlessLogin(
  browser:          any,
  storageStatePath: string,
  recDir:           string,
  roleName?:        string,
): Promise<(SessionState & { liveCtx: BrowserContext; roleMatchConfidence: RoleMatchConfidence }) | null> {
  const ctx  = await browser.newContext({
    viewport:    VIEWPORT,
    recordVideo: { dir: recDir, size: VIEWPORT },
    ignoreHTTPSErrors: true,
  });
  if (LOGIN_TYPE === '2') await installAuthRefreshDedupe(ctx);
  const page = await ctx.newPage();

  // Hide navigator.webdriver so React apps don't block automated input
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  let success = false;
  let roleMatchConfidence: RoleMatchConfidence = 'not-applicable';
  try {
    let formFound = false;
    for (const loginUrl of [LOGIN_URL, APP_URL]) {
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
      const pwdCount = await page.locator('input[type="password"]').count().catch(() => 0);
      if (pwdCount > 0) { formFound = true; break; }
    }
    if (!formFound) return null;

    if (LOGIN_TYPE === '2') {
      ({ roleMatchConfidence } = await performLogin(page, {
        loginType: 2, username: APP_USERNAME, password: APP_PASSWORD,
        quickAccessIndex: 0, quickAccessRoleName: roleName,
      }));
    } else {
      const { username: loginUsername, password: loginPassword } = credentialsForRole(roleName);
      const emailSel = [
        'input[type="email"]', 'input[name="email"]', 'input[name="username"]',
        'input[placeholder*="email" i]', 'input[placeholder*="user" i]', 'input[type="text"]',
      ].join(', ');

      const emailInput = page.locator(emailSel).first();
      await emailInput.waitFor({ timeout: 5000 }).catch(() => {});
      await emailInput.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Delete');
      await page.keyboard.type(loginUsername, { delay: 50 });

      const pwdInput = page.locator('input[type="password"]').first();
      await pwdInput.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Delete');
      await page.keyboard.type(loginPassword, { delay: 50 });

      const submitSel = 'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign In"), button:has-text("Log In"), button:has-text("Log in")';
      const submitCount = await page.locator(submitSel).count().catch(() => 0);
      if (submitCount > 0) {
        await page.locator(submitSel).first().click();
      } else {
        await pwdInput.press('Enter');
      }

      // Wait for the password form to disappear — works even when the URL doesn't change after login
      await page.locator('input[type="password"]').first()
        .waitFor({ state: 'detached', timeout: 15000 })
        .catch(() => {});
    }

    // Extra settle time for tokens/storage — and for the old login DOM to fully unmount
    // before we check for it below (quick-access login resolves as soon as the URL
    // changes, which can race the React unmount of the login form by a few hundred ms).
    await page.waitForTimeout(3000);

    const stillHasForm = await page.locator('input[type="password"]').count().catch(() => 0);
    if (stillHasForm > 0) {
      console.warn('  ↳ Password form still visible after login attempt — credentials may be wrong.');
      console.warn(`    username=${credentialsForRole(roleName).username}  APP_URL=${APP_URL}`);
      return null;
    }

    const postLoginUrl = page.url();

    // Detect "login redirect loop": the app cleared the form but bounced us back to login.
    const backAtLoginRoot = postLoginUrl.replace(/\/$/, '') === LOGIN_URL.replace(/\/$/, '');
    let isStillLoginPage = postLoginUrl.includes('/login') || postLoginUrl.includes('/signin');
    if (!isStillLoginPage && backAtLoginRoot) {
      // Being back at the bare login URL (APP_LOGIN_PATH=/) doesn't always mean the
      // login failed — some single-page apps (e.g. Streamlit) render the authenticated
      // dashboard at that same root URL instead of navigating away. For quick-access
      // apps, only call it a failure if the role-picker screen is still actually showing.
      isStillLoginPage = LOGIN_TYPE === '2'
        ? await isQuickAccessScreenShowing(page, roleName)
        : true;
    }
    if (isStillLoginPage) {
      console.warn(`  ↳ Post-login URL is still the login page (${postLoginUrl}) — login failed silently.`);
      return null;
    }

    await ctx.storageState({ path: storageStatePath });
    await page.close(); // close login page; keep context alive for clip recording
    success = true;
    return { storageStatePath, postLoginUrl, origin: new URL(APP_URL).origin, liveCtx: ctx, roleMatchConfidence };
  } finally {
    if (!success) await ctx.close();
  }
}

// ── Layer 3: visible browser — user logs in manually ──
// The context created here is handed back as the LIVE recording context, not just
// a storageState snapshot on disk. Some apps (e.g. Streamlit) keep "logged in"
// state entirely server-side, tied to that one live connection/tab — cookies and
// localStorage never contain anything a fresh context could replay, so a new
// headless context built from the saved file loads as a brand-new, unauthenticated
// session no matter how the timing is tuned. Reusing this exact context for every
// route recorded under this role sidesteps that whole class of app, the same way
// the headless login path (tryHeadlessLogin) already reuses its own context.
async function tryInteractiveLogin(
  storageStatePath: string,
  recDir:           string,
  roleName?:        string,
): Promise<(SessionState & { liveCtx: BrowserContext; ownBrowser: Browser }) | null> {
  console.log('\n  ┌──────────────────────────────────────────────────────────────────┐');
  console.log('  │  MANUAL LOGIN REQUIRED                                           │');
  console.log('  │  A browser window will open. Please log in to the app.          │');
  console.log(`  │  URL: ${LOGIN_URL.padEnd(62)}│`);
  if (roleName) {
    console.log(`  │  Log in as role: ${roleName.padEnd(51)}│`);
  }
  console.log('  │  The pipeline continues automatically after you log in.         │');
  console.log('  │  ⚠ DO NOT CLOSE THIS WINDOW after logging in — recording        │');
  console.log('  │    happens right here afterward. It closes itself when done.    │');
  console.log('  │  You have 3 minutes.                                            │');
  console.log('  └──────────────────────────────────────────────────────────────────┘\n');

  const visibleBrowser = await chromium.launch({
    headless: false,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
  });
  let success = false;
  try {
    // Fixed VIEWPORT (not null) + recordVideo so this same context can be reused
    // directly for clip recording afterward — matches the shape recordClip expects
    // from liveCtx. --start-maximized still gives the human a full window; Playwright
    // just constrains the page's content area to VIEWPORT regardless of window chrome.
    const ctx  = await visibleBrowser.newContext({
      viewport: VIEWPORT, ignoreHTTPSErrors: true,
      recordVideo: { dir: recDir, size: VIEWPORT },
    });
    if (LOGIN_TYPE === '2') await installAuthRefreshDedupe(ctx);
    const page = await ctx.newPage();
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    if (LOGIN_TYPE === '2') {
      // Quick-access apps have no password field, and single-page apps (e.g. Streamlit)
      // never navigate to a distinct /login URL either — so neither generic signal below
      // can detect a real login here. Poll for the role-picker screen itself to go away.
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline && await isQuickAccessScreenShowing(page, roleName)) {
        await page.waitForTimeout(1000);
      }
    } else {
      // Wait for the login form to actually appear first — if LOGIN_URL is the app root
      // (APP_LOGIN_PATH=/), the SPA client-side redirects to /login shortly after this
      // goto resolves, so checking "URL moved away from login" before that redirect
      // happens would be trivially true and resolve instantly without any real login.
      await page.waitForSelector('input[type="password"]', { timeout: 20000 }).catch(() => {});

      // Wait up to 3 minutes for the user to complete login
      await Promise.race([
        page.waitForSelector('input[type="password"]', { state: 'detached', timeout: 180000 }),
        page.waitForURL(
          (u: URL) => !u.href.includes('/login') && !u.href.includes('/signin'),
          { timeout: 180000 },
        ),
      ]);
    }

    // Extra settle time for tokens/storage — the login UI can disappear from an
    // optimistic client-side update before the app's async login call actually
    // persists the auth cookie/token server-side. A blind fixed wait guessed
    // wrong often enough to matter (some roles' FIRST post-login route still
    // hit the login screen); actively re-check instead so fast logins don't
    // wait longer than needed and slow ones get up to 15s rather than a hard 3s.
    const settleDeadline = Date.now() + 15000;
    while (Date.now() < settleDeadline) {
      const stillPicker = LOGIN_TYPE === '2' && await isQuickAccessScreenShowing(page, roleName);
      const stillPwd     = await page.locator('input[type="password"]').count().catch(() => 0) > 0;
      if (!stillPicker && !stillPwd) break;
      await page.waitForTimeout(1000);
    }

    const postLoginUrl = page.url();
    await ctx.storageState({ path: storageStatePath });
    console.log(`\n  ✓ Manual login successful — post-login: ${postLoginUrl}`);

    // Visible, hard-to-miss cue in the window itself — a person watching the screen
    // won't necessarily have the terminal in view, and closing this window now (the
    // old habit, back when the browser always auto-closed right after login) would
    // silently kill the live session every route after this one depends on.
    await page.evaluate(() => {
      const banner = document.createElement('div');
      banner.textContent = '🔴 RECORDING IN PROGRESS — do not close this window. It will close itself when finished.';
      Object.assign(banner.style, {
        position: 'fixed', top: '0', left: '0', right: '0', zIndex: '2147483647',
        background: '#dc2626', color: '#fff', font: '600 14px sans-serif',
        padding: '8px 12px', textAlign: 'center', pointerEvents: 'none',
      });
      document.documentElement.appendChild(banner);
    }).catch(() => {});

    success = true;
    return {
      storageStatePath, postLoginUrl, origin: new URL(APP_URL).origin,
      liveCtx: ctx, ownBrowser: visibleBrowser,
    };
  } catch (err) {
    console.error(`  ✗ Interactive login timed out or failed: ${(err as Error).message?.slice(0, 100)}`);
    return null;
  } finally {
    if (!success) await visibleBrowser.close();
  }
}

async function acquireSession(
  browser: any,
  recDir:  string,
  opts?:   { roleName?: string },
): Promise<{ session: SessionState; liveCtx: BrowserContext; roleMatchConfidence?: RoleMatchConfidence; ownBrowser?: Browser } | null> {
  fs.mkdirSync(TMP_DIR,  { recursive: true });
  fs.mkdirSync(REC_DIR,  { recursive: true });
  fs.mkdirSync(recDir,   { recursive: true });
  const roleName = opts?.roleName;
  const storageStatePath = path.join(
    TMP_DIR,
    roleName ? `session-state-${toSlug(roleName)}.json` : 'session-state.json',
  );
  const origin = new URL(APP_URL).origin;

  // ── Layer 1: reuse cached session if < 8 h old and still authenticated ──
  if (fs.existsSync(storageStatePath)) {
    const ageMs = Date.now() - fs.statSync(storageStatePath).mtimeMs;
    if (ageMs < 8 * 60 * 60 * 1000) {
      console.log(`  Cached session found (${Math.round(ageMs / 60000)}m old) — verifying…`);
      try {
        const roleRoute  = roleName
          ? Object.keys(routeMap).find(r => extractPrimaryRole(routeMap[r]) === roleName)
          : undefined;
        const firstRoute = roleRoute ?? Object.keys(routeMap)[0] ?? '/';
        const verCtx  = await browser.newContext({ storageState: storageStatePath, ignoreHTTPSErrors: true });
        if (LOGIN_TYPE === '2') await installAuthRefreshDedupe(verCtx);
        const verPage = await verCtx.newPage();
        await verPage.goto(`${APP_URL}${firstRoute}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await verPage.waitForTimeout(2000);
        const verUrl     = verPage.url();
        const verHasForm = await verPage.locator('input[type="password"]').count().catch(() => 0);
        // Quick-access apps (LOGIN_TYPE=2) often have no password field at all and
        // never navigate to a distinct /login URL (see isQuickAccessScreenShowing's
        // own header comment) — neither signal below can catch a dead session for
        // them, so a storageState file that can never actually be replayed (e.g.
        // Streamlit, whose "logged in" state lives only in the live connection) gets
        // reported valid forever. Check for the picker itself as a third signal.
        const verStillPicker = LOGIN_TYPE === '2'
          ? await isQuickAccessScreenShowing(verPage, roleName)
          : false;
        // None of the three signals above can catch a session that's authenticated
        // but AS THE WRONG ROLE — e.g. this app's own auth-refresh race (two
        // concurrent /auth/refresh calls, one 200/one 409) can corrupt the very
        // first Account-Admin login of a run and leave it silently authenticated
        // as whatever role was previously active. That wrong-but-"valid" session
        // then gets cached and reused unchanged for every later route needing that
        // role. Apps in this family always surface the active role as visible text
        // somewhere in the authenticated shell (seen consistently as a header
        // badge) — if roleName doesn't appear anywhere on the page, treat the
        // cached session as invalid rather than silently recording under the
        // wrong identity.
        const verBodyText  = await verPage.evaluate(() => document.body.innerText).catch(() => '');
        const verWrongRole = !!roleName && !verBodyText.toLowerCase().includes(roleName.toLowerCase());
        await verCtx.close();
        const verIsLogin =
          verUrl.includes('/login') || verUrl.includes('/signin') ||
          verUrl.replace(/\/$/, '') === LOGIN_URL.replace(/\/$/, '');
        if (verWrongRole) {
          console.log(`  ↳ Cached session authenticated as the wrong role (expected "${roleName}") — re-authenticating…`);
        }
        if (!verIsLogin && verHasForm === 0 && !verStillPicker && !verWrongRole) {
          console.log(`  ✓ Cached session valid — skipping login`);
          const liveCtx = await browser.newContext({
            storageState: storageStatePath,
            viewport:     VIEWPORT,
            recordVideo:  { dir: recDir, size: VIEWPORT },
            ignoreHTTPSErrors: true,
          });
          if (LOGIN_TYPE === '2') await installAuthRefreshDedupe(liveCtx);
          return { session: { storageStatePath, postLoginUrl: verUrl, origin }, liveCtx };
        }
        console.log('  ↳ Session expired — re-authenticating…');
      } catch {
        console.log('  ↳ Session verify failed — re-authenticating…');
      }
    }
  }

  // ── Layer 2: try headless login ──
  console.log(`  Attempting headless login${roleName ? ` as "${roleName}"` : ''}…`);
  // performLogin (LOGIN_TYPE=2) throws outright when it can't find ANY Quick Access
  // UI at all (as opposed to finding the section but not this role's card, which
  // degrades gracefully to a default-index click). Left uncaught, that exception
  // would escape acquireSession/getSessionForRole and crash the entire multi-role
  // run over one role's login problem — every app has different login quirks, so
  // this must degrade to "try Layer 3 next" like any other headless-login failure.
  let headlessResult: Awaited<ReturnType<typeof tryHeadlessLogin>> = null;
  try {
    headlessResult = await tryHeadlessLogin(browser, storageStatePath, recDir, roleName);
  } catch (err) {
    console.warn(`  ↳ Headless login threw an error — falling back to manual login… (${(err as Error).message?.slice(0, 150)})`);
  }
  if (headlessResult) {
    const { liveCtx, roleMatchConfidence, ...sessionFields } = headlessResult;
    const session: SessionState = sessionFields;
    console.log(`  ✓ Headless login succeeded — post-login: ${session.postLoginUrl}`);
    return { session, liveCtx, roleMatchConfidence };
  }
  console.log('  ↳ Headless login failed — falling back to manual login…');

  // ── Layer 3: interactive (visible) browser ──
  // Reuse the exact context tryInteractiveLogin just logged in with, instead of
  // replaying storageState into a fresh headless context (see that function's
  // header comment — required for apps whose auth never lands in cookies/localStorage).
  const interactiveResult = await tryInteractiveLogin(storageStatePath, recDir, roleName);
  if (!interactiveResult) return null;
  const { liveCtx, ownBrowser, ...sessionFields } = interactiveResult;
  const session: SessionState = sessionFields;
  return { session, liveCtx, ownBrowser };
}

// ─── Clip action types ─────────────────────────────────────────────────────────

interface ClipAction {
  type:         'wait' | 'navigate' | 'click' | 'scroll' | 'evaluate' | 'hover' | 'waitFor';
  url?:         string;
  selector?:    string;
  text?:        string;
  value?:       string | number;
  waitAfterMs?: number;
}

interface ClipPlan {
  id:               string;
  label:            string;
  targetUrl:        string;
  durationSec:      number;
  loginAs?:         string;    // undefined = no login; string = login before navigating
  recordingStartSec?: number;
  skipInteraction?: boolean;
  actions?:         ClipAction[];
}

// ─── Dynamic recording plan from APP_ROUTE_MAP ────────────────────────────────

function buildRecordingPlan(): ClipPlan[] {
  const loginUser = APP_USERNAME || 'user';
  const routes    = Object.entries(routeMap);

  const defaultActions: ClipAction[] = [
    { type: 'wait',   waitAfterMs: 3000 },
    { type: 'scroll', value: 300, waitAfterMs: 2000 },
    { type: 'scroll', value: 0,   waitAfterMs: 2000 },
    { type: 'wait',   waitAfterMs: 2000 },
  ];
  const HERO_DURATION_SEC = 24; // vs PRODUCT_SEC — extra time for a multi-step interaction

  const plan: ClipPlan[] = [
    // Login page — no auth, always first
    {
      id:          'login',
      label:       'Login Page',
      targetUrl:   LOGIN_URL,
      durationSec: 10,
      loginAs:     undefined,
      actions: [
        { type: 'wait', waitAfterMs: 3000 },
        { type: 'wait', waitAfterMs: 5000 },
      ],
    },
  ];

  if (routes.length === 0) {
    // No route map configured — record the home page only
    plan.push({
      id:               'home',
      label:            'Home',
      targetUrl:        APP_URL,
      durationSec:      PRODUCT_SEC,
      loginAs:          loginUser,
      recordingStartSec: LOGIN_SKIP_SEC,
      actions:          defaultActions,
    });
  } else {
    for (const [routePath, label] of routes) {
      const id = routePath === '/'
        ? 'home'
        : routePath.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
      const override = painPointOverrides[routePath];
      plan.push({
        id,
        label:            String(label),
        targetUrl:        `${APP_URL}${routePath}`,
        durationSec:      override?.actions ? (override.durationSec ?? HERO_DURATION_SEC) : PRODUCT_SEC,
        loginAs:          extractPrimaryRole(String(label)) ?? loginUser,
        recordingStartSec: LOGIN_SKIP_SEC,
        actions:          override?.actions ?? defaultActions,
      });
    }
  }

  return plan;
}

const RECORDING_PLAN = buildRecordingPlan();

// Recording EXECUTION order groups consecutive routes by role so at most one
// extra headed (interactive-login) browser is ever open at a time — recording
// runs through one role's routes, closes that role's browser, then moves to
// the next. Left ungrouped, every distinct role's manual-login window stays
// open simultaneously until the entire run finishes (routes for different
// roles are normally interleaved through APP_ROUTE_MAP), which on a machine
// already under memory pressure can exhaust it and hang/crash Chrome — this
// is purely an execution-order optimization; the FINAL video still assembles
// scenes in RECORDING_PLAN's original (APP_ROUTE_MAP-authored) order, restored
// after recording via planIndex below.
function groupPlanByRole(plan: ClipPlan[]): ClipPlan[] {
  const order = new Map<string, ClipPlan[]>();
  for (const p of plan) {
    const key = p.loginAs ?? '';
    if (!order.has(key)) order.set(key, []);
    order.get(key)!.push(p);
  }
  return [...order.values()].flat();
}
const EXECUTION_ORDER = groupPlanByRole(RECORDING_PLAN);

// ─── Interaction helpers ───────────────────────────────────────────────────────

async function performAction(page: Page, action: ClipAction): Promise<void> {
  switch (action.type) {
    case 'wait':
      await page.waitForTimeout(action.waitAfterMs ?? 1000);
      break;
    case 'navigate':
      await page.goto(action.url!, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);
      break;
    case 'click':
      if (action.text) {
        await page.locator(`text=${action.text}`).first().click({ timeout: 5000 }).catch(() => {
          console.warn(`    click text="${action.text}" failed`);
        });
      } else if (action.selector) {
        await page.locator(action.selector).first().click({ timeout: 5000 }).catch(() => {});
      }
      if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);
      break;
    case 'scroll':
      await page.evaluate(
        (y: number) => window.scrollTo({ top: y, behavior: 'smooth' }),
        action.value as number ?? 500,
      ).catch(() => {});
      if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);
      break;
    case 'evaluate':
      await page.evaluate(action.value as string).catch(() => {});
      if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);
      break;
    case 'hover':
      if (action.selector) {
        await page.locator(action.selector).first().hover({ timeout: 3000, force: true }).catch(() => {});
      } else if (action.text) {
        await page.locator(`text=${action.text}`).first().hover({ timeout: 3000, force: true }).catch(() => {});
      }
      if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);
      break;
    case 'waitFor':
      if (action.selector) {
        await page.waitForSelector(action.selector, { timeout: Number(action.value ?? 8000) }).catch(() => {});
      }
      if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);
      break;
  }
}

async function performFullInteraction(page: Page): Promise<void> {
  await suppressPopups(page);
  try {
    const h = await page.evaluate(() => document.body.scrollHeight);
    const steps = Math.min(Math.ceil(h / 400), 6);
    for (let i = 1; i <= steps; i++) {
      await page.evaluate(
        (y: number) => window.scrollTo({ top: y, behavior: 'smooth' }),
        (i / steps) * h * 0.7,
      );
      await page.waitForTimeout(600);
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await page.waitForTimeout(500);
  } catch {}
  await suppressPopups(page);
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
  // -threads 4 caps libx264's per-thread malloc which fails on high core-count machines
  execSync(
    `"${ffmpeg}" -y -i "${webmPath}" -c:v libx264 -crf 23 -preset veryfast -threads 4 -pix_fmt yuv420p -movflags +faststart -an "${mp4Path}"`,
    { stdio: 'pipe' },
  );
}

// ─── Record one clip ───────────────────────────────────────────────────────────

interface RecordedClip {
  id:               string;
  label:            string;
  targetUrl:        string;
  loginAs?:         string;
  videoPath:        string;
  framePath:        string;
  durationSec:      number;
  recordingStartSec?: number;
  /** page.url() actually landed on after navigation — used to detect
   *  role-permission redirects that don't hit /login (see demoValidation.ts). */
  landedUrl?:       string;
}

// landedUrl is only known right after a fresh recordClip() call — a cache-hit skips
// navigation entirely. Persist it alongside the recording so a scene dropped for
// redirecting to already-shown content (see main()) stays dropped on later cached
// runs instead of silently reappearing once its video file exists on disk.
function landedUrlMetaPath(id: string): string {
  return path.join(REC_DIR, `${id}.meta.json`);
}
function readCachedLandedUrl(id: string): string | undefined {
  try {
    return JSON.parse(fs.readFileSync(landedUrlMetaPath(id), 'utf-8')).landedUrl;
  } catch {
    return undefined;
  }
}
function writeCachedLandedUrl(id: string, landedUrl?: string): void {
  if (!landedUrl) return;
  try { fs.writeFileSync(landedUrlMetaPath(id), JSON.stringify({ landedUrl }), 'utf-8'); } catch {}
}

async function recordClip(
  browser:  ReturnType<typeof chromium.launch> extends Promise<infer T> ? T : never,
  plan:     ClipPlan,
  session:  SessionState | null,
  liveCtx?: BrowserContext,
): Promise<RecordedClip> {
  fs.mkdirSync(TMP_REC_DIR, { recursive: true });

  console.log(`\n  ── Recording: ${plan.label} ──────────────────────────`);

  let ctx: BrowserContext;
  let ownCtx = true; // false when reusing the shared liveCtx — must not close it
  if (plan.loginAs && liveCtx) {
    ctx = liveCtx;
    ownCtx = false;
  } else if (plan.loginAs && session) {
    ctx = await createAuthContext(browser as any, session, {
      viewport: VIEWPORT,
      recordVideo: { dir: TMP_REC_DIR, size: VIEWPORT },
    });
    if (LOGIN_TYPE === '2') await installAuthRefreshDedupe(ctx);
  } else {
    ctx = await (browser as any).newContext({
      viewport: VIEWPORT,
      recordVideo: { dir: TMP_REC_DIR, size: VIEWPORT },
      ignoreHTTPSErrors: true,
    });
    await ctx.addInitScript(({ css }: { css: string }) => {
      const s = document.createElement('style');
      s.textContent = css;
      (document.head || document.documentElement).appendChild(s);
    }, { css: SUPPRESS_CSS });
  }

  const page = await ctx.newPage();
  let landedUrl: string | undefined;

  if (plan.loginAs) {
    if (!session && !liveCtx) {
      if (ownCtx) await ctx.close(); else await page.close();
      throw new Error(`No session — login failed before recording started`);
    }
    let loginRedirect = false;
    let hasLoginForm  = 0;
    let stillOnPicker = false;

    // Navigate directly to the target page — liveCtx keeps auth in memory across clips.
    // The client-side auth guard on some apps can flake independently PER ROUTE (not
    // just right after login — settling once at the login step isn't always enough),
    // so retry a few times before giving up rather than accepting whatever the first
    // attempt showed.
    const maxAttempts = 3;
    // Set after a successful in-place relogin lands us exactly on plan.targetUrl
    // already (common — this app's Quick Access login often lands straight on a
    // role's default route) so the next attempt's page.goto() below is skipped.
    // That goto is not just wasted work if skipped incorrectly — it's actively
    // harmful: this app's session rehydration on a fresh page load is a genuine
    // race (concurrent duplicate POST /api/v1/auth/refresh calls, one 200 one 409)
    // that sometimes never resolves even with a valid refreshToken cookie and a
    // generous poll (empirically reproduced — see conversation). Re-navigating
    // right after a real, fresh, cookie-issuing login re-rolls that same race for
    // no reason when we're already sitting on the correct, authenticated page.
    let skipNextGoto = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (!skipNextGoto) {
        await page.goto(plan.targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      }
      skipNextGoto = false;

      // Poll instead of a single fixed sleep. This app rehydrates its session
      // ASYNCHRONOUSLY on every fresh page load — confirmed via network trace: on
      // every goto it fires POST /api/v1/auth/refresh (using the httpOnly
      // refreshToken cookie, which IS present and valid) then GET /api/v1/auth/me,
      // and only renders the authenticated page once that round trip resolves. In
      // this dev-mode (Vite) deployment that can take 5-10s, well past the old fixed
      // 3s wait — so the picker was being caught mid-flight and misreported as an
      // expired/failed session even though the cookie-based session was completely
      // fine. Poll for up to 12s so a slow-but-valid rehydration has time to finish
      // before we conclude the session is actually gone.
      const pollDeadline = Date.now() + 12000;
      for (;;) {
        await page.waitForTimeout(500);
        landedUrl = page.url();
        loginRedirect =
          landedUrl.includes('/login') || landedUrl.includes('/signin') || landedUrl.includes('/auth') ||
          landedUrl.replace(/\/$/, '') === LOGIN_URL.replace(/\/$/, '');
        hasLoginForm = !loginRedirect
          ? await page.locator('input[type="password"]').count().catch(() => 0)
          : 0;
        // URL string checks and a password-field count both miss apps whose auth guard is
        // purely client-side: the browser stays on the REQUESTED url (no server redirect)
        // and just renders the login/picker UI in place, and quick-access apps often have
        // no password field anywhere — so a route can silently "succeed" (normal duration,
        // no error) while the recorded content is actually still the login screen the whole
        // time. Content-based check catches this regardless of what the URL bar shows.
        stillOnPicker = !loginRedirect && !hasLoginForm && LOGIN_TYPE === '2'
          ? await isQuickAccessScreenShowing(page, plan.loginAs)
          : false;
        if ((!loginRedirect && hasLoginForm === 0 && !stillOnPicker) || Date.now() >= pollDeadline) break;
      }

      if (!loginRedirect && hasLoginForm === 0 && !stillOnPicker) break;
      if (attempt < maxAttempts) {
        if (LOGIN_TYPE === '2' && plan.loginAs) {
          // The 12s poll above already gives the app's own silent-refresh a fair
          // chance — if we're still here, the refresh genuinely failed (e.g. the
          // refresh token itself expired/was revoked), not just "still loading". Only
          // now is it worth spending the time to re-click this role's Quick Access
          // card and do a real interactive login in place.
          console.warn(`    ⚠ Picker/login screen showing for "${plan.id}" (attempt ${attempt}/${maxAttempts}) — re-authenticating in place as "${plan.loginAs}"…`);
          try {
            await performLogin(page, {
              loginType: 2, username: APP_USERNAME, password: APP_PASSWORD,
              quickAccessIndex: 0, quickAccessRoleName: plan.loginAs,
            });
            await page.waitForTimeout(1500);
            const reloginUrl = page.url();
            const stillBad = reloginUrl.includes('/login') || reloginUrl.includes('/signin') ||
              (await page.locator('input[type="password"]').count().catch(() => 0)) > 0;
            if (!stillBad && reloginUrl.replace(/\/$/, '') === plan.targetUrl.replace(/\/$/, '')) {
              skipNextGoto = true;
            }
          } catch (e) {
            console.warn(`    ↳ In-place re-login attempt failed: ${(e as Error).message?.slice(0, 100)}`);
          }
        } else {
          console.warn(`    ⚠ Landed on login/picker screen for "${plan.id}" (attempt ${attempt}/${maxAttempts}) — retrying…`);
          await page.waitForTimeout(3000);
        }
      }
    }
    if (loginRedirect || hasLoginForm > 0 || stillOnPicker) {
      // Don't close liveCtx (shared) — only close the page
      if (ownCtx) await ctx.close(); else await page.close();
      const reason = loginRedirect
        ? `redirected to login URL (${landedUrl})`
        : stillOnPicker
        ? 'quick-access/login screen still showing (client-side auth guard — URL unchanged)'
        : 'login form still visible';
      throw new Error(
        `Route ${plan.targetUrl} ${reason}.\n` +
        `  Check APP_USERNAME / APP_PASSWORD / APP_LOGIN_PATH in .env.\n` +
        `  Current credentials: ${APP_USERNAME} @ ${new URL(APP_URL).origin}`,
      );
    }
  } else {
    await page.goto(plan.targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
    landedUrl = page.url();
  }

  await suppressPopups(page);
  await page.waitForTimeout(500);

  if (plan.actions) {
    for (const action of plan.actions) {
      await performAction(page, action);
    }
    // Hero workflow actions (clicks) can cause a real navigation — re-capture so
    // demoValidation.ts's URL-mismatch check still reflects where we actually ended up.
    landedUrl = page.url();
  }

  if (!plan.skipInteraction) {
    await performFullInteraction(page);
  }

  const elapsed  = plan.actions?.reduce((s, a) => s + (a.waitAfterMs ?? 0), 0) ?? 0;
  const targetMs = (plan.durationSec + (plan.recordingStartSec ?? 0)) * 1000;
  const remaining = targetMs - elapsed - 3000;
  if (remaining > 0) await page.waitForTimeout(remaining);

  // Re-verify right before the screenshot — the check right after navigation only
  // proves the page was correct at THAT moment. Some apps' live session can drop
  // during the ~20-30s of scroll/interaction steps above (e.g. a background rerun,
  // idle check, or dropped connection), reverting to the login/picker screen well
  // after the initial check already passed, so the final screenshot silently
  // captures the reverted state unless checked again right here.
  if (plan.loginAs && LOGIN_TYPE === '2' && await isQuickAccessScreenShowing(page, plan.loginAs)) {
    if (ownCtx) await ctx.close(); else await page.close();
    throw new Error(
      `Route ${plan.targetUrl} reverted to the quick-access/login screen during recording ` +
      `(session dropped mid-interaction).\n` +
      `  Check APP_USERNAME / APP_PASSWORD / APP_LOGIN_PATH in .env.\n` +
      `  Current credentials: ${APP_USERNAME} @ ${new URL(APP_URL).origin}`,
    );
  }

  const framePath = path.join(REC_DIR, `${plan.id}-frame.png`);
  await page.screenshot({ path: framePath, fullPage: false });
  console.log(`    Screenshot saved: ${path.basename(framePath)}`);

  const videoObj = page.video();
  if (ownCtx) {
    await ctx.close(); // owned context: close finalises video
  } else {
    await page.close(); // shared liveCtx: close page only — finalises video without closing context
  }

  const webmPath = await videoObj?.path() ?? '';
  const mp4Path  = path.join(REC_DIR, `${plan.id}.mp4`);
  if (webmPath && fs.existsSync(webmPath)) {
    console.log(`    Converting to MP4…`);
    convertToMp4(webmPath, mp4Path);
    fs.unlinkSync(webmPath);
  } else {
    console.error(`    ✗ WebM not found at ${webmPath}`);
  }

  let actualDuration = plan.durationSec;
  try {
    const info = getVideoInfo(mp4Path);
    actualDuration = info.duration;
    console.log(`    Duration: ${actualDuration.toFixed(1)}s`);
  } catch {}

  return {
    id:               plan.id,
    label:            plan.label,
    targetUrl:        plan.targetUrl,
    loginAs:          plan.loginAs,
    videoPath:        `recordings/${plan.id}.mp4`,
    framePath,
    durationSec:      plan.durationSec,
    recordingStartSec: plan.recordingStartSec,
    landedUrl,
  };
}

// ─── Build demo-package.json ──────────────────────────────────────────────────

interface AnalyzedClip extends RecordedClip {
  featureTitle: string;
  salesHook:    string;
  narration:    string;
}

function buildDemoPackage(
  clips:          AnalyzedClip[],
  benefitContent: BenefitContent,
  brollSubtitles: string[],
): object {
  const BROLL_COUNT = Math.min(brollSubtitles.length, 5);
  const brollFrames = BROLL_COUNT * BROLL_FRAMES;

  let from = brollFrames;
  const scenes = clips.map((clip, idx) => {
    const dur = Math.round(clip.durationSec * FPS);
    const scene = {
      id:               `scene-${idx + 1}`,
      pageId:           clip.id,
      title:            clip.featureTitle,
      salesHook:        clip.salesHook,
      narration:        clip.narration,
      description:      clip.narration,
      screenshotPath:   `recordings/${clip.id}-frame.png`,
      ...(clip.id !== 'login' ? { recordingPath: clip.videoPath } : {}),
      ...(clip.recordingStartSec ? { recordingStartSec: clip.recordingStartSec } : {}),
      from,
      durationInFrames: dur,
      transition: idx < clips.length - 1 ? { type: 'slide-left', durationInFrames: 12 } : null,
      nodeType: '',
    };
    from += dur;
    return scene;
  });

  const benefitFrom   = from;
  const benefitFrames = Math.round(BENEFIT_SEC * FPS);
  from += benefitFrames;

  const presenterFrom   = from;
  const presenterFrames = Math.round(PRESENTER_SEC * FPS);
  const totalFrames     = presenterFrom + presenterFrames;

  const brollScenes = brollSubtitles.slice(0, BROLL_COUNT).map((sub, i) => ({
    id:               `broll-${i}`,
    from:             i * BROLL_FRAMES,
    durationInFrames: BROLL_FRAMES,
    subtitle:         sub,
    category:         'generic',
    videoPath:        `recordings/broll-${i}.mp4`,
  }));

  const targetAudience = APP_CONTEXT
    ? APP_CONTEXT.substring(0, 120).replace(/\.$/, '')
    : `${PRODUCT_NAME} users and decision-makers`;
  const primaryBenefit = APP_CONTEXT
    ? `streamline operations and accelerate workflows with ${PRODUCT_NAME}`
    : 'automate manual processes and improve operational efficiency';

  return {
    composition: {
      id: 'EnterpriseVideo',
      durationInFrames: totalFrames,
      fps:    FPS,
      width:  VIEWPORT.width,
      height: VIEWPORT.height,
    },
    scenes,
    brollScenes,
    benefitSlide: {
      from:             benefitFrom,
      durationInFrames: benefitFrames,
      title:            benefitContent.title,
      bullets:          benefitContent.bullets,
    },
    presenterClose: {
      from:             presenterFrom,
      durationInFrames: presenterFrames,
      tagline:          `${PRODUCT_NAME} — Every workflow, simplified`,
      presenterSrc: '',
    },
    presenterConfig: {
      src: '', videoSrc: '', widthFraction: 0.15, position: 'bottom-left', enabled: false,
    },
    meta: {
      productName:    PRODUCT_NAME,
      targetAudience,
      primaryBenefit,
      templateId:     'enterprise',
    },
    screenFit: SCREEN_FIT,
  };
}

// ─── Build voice-script.json ──────────────────────────────────────────────────

function buildVoiceScript(
  clips:          AnalyzedClip[],
  pkg:            any,
  brollSubtitles: string[],
): object {
  const brollCount = pkg.brollScenes.length;
  const brollSec   = BROLL_FRAMES / FPS;

  const brollSegments = brollSubtitles.slice(0, brollCount).map((text, i) => ({
    id:          `broll-${i}`,
    label:       `B-roll ${i + 1}`,
    startSec:    i * brollSec + 1,
    durationSec: 6.5,
    enabled:     true,
    text,
  }));

  // Always use AI-generated narration — no hardcoded product-specific overrides
  const productSegments = clips.map((clip, idx) => {
    const scene    = pkg.scenes[idx];
    const startSec = scene.from / FPS;
    return {
      id:          `scene-${idx + 1}`,
      label:       `Scene ${idx + 1} — ${clip.label}`,
      startSec,
      durationSec: clip.durationSec - 2,
      enabled:     true,
      text:        clip.narration,
    };
  });

  const benefitStartSec = pkg.benefitSlide.from / FPS;
  const benefitSegment = {
    id:          'benefit-slide',
    label:       'Benefit Slide',
    startSec:    benefitStartSec,
    durationSec: BENEFIT_SEC - 2,
    enabled:     true,
    text:        `${PRODUCT_NAME} brings automation, accuracy, and visibility to every workflow. ` +
                 `AI-powered processing eliminates manual bottlenecks. ` +
                 `Role-based dashboards keep every team informed and in sync. ` +
                 `Full audit trails ensure every decision is traceable and defensible.`,
  };

  const closeStartSec = pkg.presenterClose.from / FPS;
  const closeSegment = {
    id:          'presenter-close',
    label:       'Presenter Close',
    startSec:    closeStartSec,
    durationSec: PRESENTER_SEC - 2,
    enabled:     true,
    text:        `This is ${PRODUCT_NAME}. Powerful, intuitive, and built for the way your team works. ` +
                 `Ready to see it live? Contact us to schedule your personalized demonstration.`,
  };

  return {
    voice: 'nova',
    model: 'tts-hd',
    speed: 0.95,
    fps:   FPS,
    totalDurationSec: Math.round((pkg.composition.durationInFrames / FPS) * 10) / 10,
    segments: [...brollSegments, ...productSegments, benefitSegment, closeSegment],
  };
}

// ─── i18n: batch-translate all generated content ──────────────────────────────

async function translateAllContent(
  pkg:    Record<string, any>,
  voice:  Record<string, any>,
  locale: string,
): Promise<{ pkg: Record<string, any>; voice: Record<string, any> }> {
  const lang         = locale.split('-')[0].toLowerCase();
  const languageName = LANGUAGE_NAMES[lang];
  if (!languageName) return { pkg, voice };

  console.log(`\n  [i18n] Translating all content → ${languageName}…`);

  const brollSegs  = (voice.segments as any[]).filter((s: any) => (s.id as string).startsWith('broll-'));
  const sceneSegs  = (voice.segments as any[]).filter((s: any) => !(s.id as string).startsWith('broll-') && s.id !== 'benefit-slide' && s.id !== 'presenter-close');
  const benefitSeg = (voice.segments as any[]).find((s: any) => s.id === 'benefit-slide');
  const closeSeg   = (voice.segments as any[]).find((s: any) => s.id === 'presenter-close');

  const payload = {
    brollSubtitles:   (pkg.brollScenes as any[]).map((s: any) => s.subtitle as string),
    brollVoice:       brollSegs.map((s: any) => s.text as string),
    benefitTitle:     pkg.benefitSlide.title as string,
    benefitBullets:   (pkg.benefitSlide.bullets as any[]).map((b: any) => ({ label: b.label as string, description: b.description as string })),
    presenterTagline: pkg.presenterClose.tagline as string,
    scenes:           (pkg.scenes as any[]).map((s: any) => ({ title: s.title as string, salesHook: s.salesHook as string, narration: s.narration as string })),
    sceneVoice:       sceneSegs.map((s: any) => s.text as string),
    benefitVoice:     benefitSeg?.text as string ?? '',
    closingVoice:     closeSeg?.text  as string ?? '',
  };

  const prompt = `You are a professional localization specialist for B2B SaaS marketing videos.

Translate the following JSON object into ${languageName}. Rules:
- Translate ONLY the string values — do NOT translate JSON keys.
- Keep product names, technical acronyms, and brand names untranslated.
- Preserve tone: brollSubtitles should be punchy 10-15 word problem statements; narrations should be natural spoken voice-over.
- Return ONLY valid JSON with the exact same structure. No markdown, no code fences.

JSON to translate:
${JSON.stringify(payload, null, 2)}`;

  let responseText = '';
  try {
    const resp = await retryWithBackoff(() => azureClient.chat.completions.create({
      model:      process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
      max_completion_tokens: 8192,
      reasoning_effort: 'low',
      messages:   [{ role: 'user', content: prompt }],
    }));
    responseText = resp.choices[0]?.message?.content ?? '';
  } catch {
    console.warn(`  [i18n] LLM call failed — keeping English`);
    return { pkg, voice };
  }

  const cleaned = responseText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const start   = cleaned.indexOf('{');
  const end     = cleaned.lastIndexOf('}');

  let translated: typeof payload;
  try {
    if (start === -1 || end === -1) throw new Error('no JSON object found');
    translated = JSON.parse(cleaned.slice(start, end + 1)) as typeof payload;
  } catch {
    console.warn(`  [i18n] JSON parse failed — keeping English`);
    return { pkg, voice };
  }

  const newPkg: Record<string, any> = JSON.parse(JSON.stringify(pkg));
  if (Array.isArray(translated.brollSubtitles)) {
    (newPkg.brollScenes as any[]).forEach((s: any, i: number) => {
      if (translated.brollSubtitles[i]) s.subtitle = translated.brollSubtitles[i];
    });
  }
  if (translated.benefitTitle)  newPkg.benefitSlide.title = translated.benefitTitle;
  if (Array.isArray(translated.benefitBullets)) {
    (newPkg.benefitSlide.bullets as any[]).forEach((b: any, i: number) => {
      const t = translated.benefitBullets[i];
      if (t?.label)       b.label       = t.label;
      if (t?.description) b.description = t.description;
    });
  }
  if (translated.presenterTagline) newPkg.presenterClose.tagline = translated.presenterTagline;
  if (Array.isArray(translated.scenes)) {
    (newPkg.scenes as any[]).forEach((s: any, i: number) => {
      const t = translated.scenes[i];
      if (t?.title)     s.title     = t.title;
      if (t?.salesHook) s.salesHook = t.salesHook;
      if (t?.narration) { s.narration = t.narration; s.description = t.narration; }
    });
  }

  const newVoice: Record<string, any> = JSON.parse(JSON.stringify(voice));
  const segs = newVoice.segments as any[];
  if (Array.isArray(translated.brollVoice)) {
    segs.filter((s: any) => (s.id as string).startsWith('broll-'))
        .forEach((s: any, i: number) => { if (translated.brollVoice[i]) s.text = translated.brollVoice[i]; });
  }
  if (Array.isArray(translated.sceneVoice)) {
    segs.filter((s: any) => !(s.id as string).startsWith('broll-') && s.id !== 'benefit-slide' && s.id !== 'presenter-close')
        .forEach((s: any, i: number) => { if (translated.sceneVoice[i]) s.text = translated.sceneVoice[i]; });
  }
  const bSeg = segs.find((s: any) => s.id === 'benefit-slide');
  if (bSeg && translated.benefitVoice) bSeg.text = translated.benefitVoice;
  const cSeg = segs.find((s: any) => s.id === 'presenter-close');
  if (cSeg && translated.closingVoice) cSeg.text = translated.closingVoice;

  console.log(`  [i18n] ✓ Translation complete → ${languageName}`);
  return { pkg: newPkg, voice: newVoice };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`  🎬  ${PRODUCT_NAME} — Recording Pipeline`);
  console.log(`      APP_URL    : ${APP_URL}`);
  console.log(`      LOGIN_TYPE : ${LOGIN_TYPE === '1' ? '1 (username/password)' : '2 (Quick Access card)'}`);
  console.log(`      Output     : ${OUT_DIR}`);
  console.log(`      Routes     : ${RECORDING_PLAN.length - 1} (from APP_ROUTE_MAP)`);
  console.log('════════════════════════════════════════════════════════════\n');

  // Pre-generate AI content in parallel before recording starts
  console.log('  Generating benefit, b-roll, and pain-point content from APP_CONTEXT_TEXT…');
  const [benefitContent, brollSubtitles, generatedPainPoints] = await Promise.all([
    generateBenefitContent(),
    generateBrollSubtitles(),
    generateDemoPainPoints(),
  ]);
  console.log(`  ✓ Benefit title: ${benefitContent.title}`);
  console.log(`  ✓ B-roll problem statements: ${brollSubtitles.length}`);
  console.log(`  ✓ Pain points generated: ${Object.keys(generatedPainPoints).length} route(s)`);

  // Merge AI-generated defaults with any per-route .env override (DEMO_PAIN_POINTS) —
  // override wins field-by-field so a route can supply just `actions` and still
  // inherit the generated workflow/painPoint/ahaMoment wording (actions/durationSec
  // themselves are read directly from painPointOverrides by buildRecordingPlan, not
  // needed here).
  const finalPainPoints: DemoPainPoints = {};
  for (const path of new Set([...Object.keys(generatedPainPoints), ...Object.keys(painPointOverrides)])) {
    const gen = generatedPainPoints[path];
    const ovr = painPointOverrides[path];
    const workflow  = ovr?.workflow  ?? gen?.workflow;
    const painPoint = ovr?.painPoint ?? gen?.painPoint;
    const ahaMoment = ovr?.ahaMoment ?? gen?.ahaMoment;
    if (workflow && painPoint && ahaMoment) finalPainPoints[path] = { workflow, painPoint, ahaMoment };
  }

  const browser  = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
  });

  // Acquire one auth session per role (parsed from each route's APP_ROUTE_MAP label) —
  // keeps an authenticated browser context alive per role so every clip recording for
  // that role inherits the same auth state, even for in-memory-only auth. Sessions are
  // cached so each unique role logs in exactly once regardless of route order.
  // ownBrowser: set only for Layer-3 (manual login) sessions — the standalone
  // headed browser process that must be closed alongside its context, since it's
  // separate from the one shared headless `browser` instance used everywhere else.
  type RoleSession = { session: SessionState; liveCtx: BrowserContext; ownBrowser?: Browser };
  const roleSessionCache = new Map<string, RoleSession>();
  // Roles whose login already failed outright this run — avoids repeating a full
  // (possibly 3-minute manual-login) attempt for every subsequent route needing them.
  const failedRoles = new Set<string>();
  // Surfaced into validation-report.json so a short/incomplete video is traceable to
  // "this role's Quick Access card was never found" instead of looking like an
  // unexplained content gap — generic across every app (keyed by role name only).
  const roleLoginIssues: { role: string; issue: string }[] = [];
  async function getSessionForRole(roleName: string): Promise<RoleSession | null> {
    const cached = roleSessionCache.get(roleName);
    // This app's Quick Access auth has a genuine bug where reusing one browser
    // context/session across several clips accumulates state (repeated relogins on
    // the same context) that makes LATER clips fail even though a completely fresh
    // login + single navigation to that exact same route reliably succeeds every
    // time (confirmed directly — a clean isolated repro hit 5/5, while reusing an
    // already-exercised context on the real run kept failing even with a
    // conflict-free refresh response). So for LOGIN_TYPE=2 apps, never reuse a
    // session across clips — acquire a brand-new one per clip instead. LOGIN_TYPE=1
    // (password) apps keep the original reuse-across-clips behavior; this bug is
    // specific to this app's Quick Access flow.
    if (cached && LOGIN_TYPE !== '2') return cached;
    if (cached) {
      roleSessionCache.delete(roleName);
      await cached.liveCtx?.close().catch(() => {});
      if (cached.ownBrowser) await cached.ownBrowser.close().catch(() => {});
    }
    if (failedRoles.has(roleName)) return null;
    console.log(`\n  Acquiring auth session for role "${roleName}"…`);
    const acquired = await acquireSession(browser as any, TMP_REC_DIR, { roleName });
    if (acquired) {
      if (acquired.roleMatchConfidence === 'fallback-default-card') {
        roleLoginIssues.push({
          role: roleName,
          issue: `No Quick Access card's visible text matched "${roleName}" — logged in using ` +
                 `the default card instead. Routes assigned to this role likely show another ` +
                 `role's content and may get dropped as duplicates.`,
        });
      }
      const { roleMatchConfidence: _drop, ...roleSession } = acquired;
      roleSessionCache.set(roleName, roleSession);
      return roleSession;
    }
    failedRoles.add(roleName);
    roleLoginIssues.push({
      role: roleName,
      issue: `Login failed outright for this role — its routes were recorded under a ` +
             `fallback session (or skipped) and will show the wrong role's content.`,
    });
    return null;
  }

  const forceRerecord = process.env.FORCE_RERECORD === 'true';
  const recorded: RecordedClip[] = [];

  // Last index (in EXECUTION_ORDER) at which each role is still needed — lets the
  // loop below close+evict a role's session immediately after its final route
  // instead of holding every role's browser open until the whole run ends.
  const lastNeededAt = new Map<string, number>();
  EXECUTION_ORDER.forEach((p, i) => { if (p.loginAs) lastNeededAt.set(p.loginAs, i); });
  async function closeRoleSessionIfDone(execIdx: number, roleName?: string): Promise<void> {
    if (!roleName || lastNeededAt.get(roleName) !== execIdx) return;
    const s = roleSessionCache.get(roleName);
    if (!s) return;
    roleSessionCache.delete(roleName);
    await s.liveCtx?.close().catch(() => {});
    if (s.ownBrowser) await s.ownBrowser.close().catch(() => {});
  }

  for (let execIdx = 0; execIdx < EXECUTION_ORDER.length; execIdx++) {
    const plan = EXECUTION_ORDER[execIdx];
    const mp4   = path.join(REC_DIR, `${plan.id}.mp4`);
    const frame = path.join(REC_DIR, `${plan.id}-frame.png`);
    if (!forceRerecord && fs.existsSync(mp4) && fs.existsSync(frame) && fs.statSync(mp4).size > 50_000) {
      console.log(`\n  ── ${plan.label}  [CACHED — skipping] ──────────────────`);
      let dur = plan.durationSec;
      try { dur = getVideoInfo(mp4).duration; } catch {}
      recorded.push({
        id: plan.id, label: plan.label, targetUrl: plan.targetUrl, loginAs: plan.loginAs,
        videoPath: `recordings/${plan.id}.mp4`, framePath: frame,
        durationSec: dur, recordingStartSec: plan.recordingStartSec,
        landedUrl: readCachedLandedUrl(plan.id),
      });
      await closeRoleSessionIfDone(execIdx, plan.loginAs);
      continue;
    }

    let roleSession: RoleSession | null = null;
    if (plan.loginAs) {
      roleSession = await getSessionForRole(plan.loginAs);
      if (!roleSession) {
        // Total login failure for this role (not just "no card matched" — that already
        // degrades gracefully inside acquireSession/clickQuickAccessOption). Fall back
        // to any already-successful role session rather than skipping the route outright.
        roleSession = [...roleSessionCache.values()][0] ?? null;
        if (roleSession) {
          console.warn(`  ⚠ Could not establish a session for role "${plan.loginAs}" — ` +
                       `recording "${plan.id}" under a fallback session instead. ` +
                       `Content for this route may be incorrect.`);
        } else {
          console.error(`  ✗ Could not log in for role "${plan.loginAs}" and no fallback session exists — skipping "${plan.id}".`);
          console.error(`    Check APP_USERNAME / APP_PASSWORD / APP_LOGIN_PATH in .env`);
          await closeRoleSessionIfDone(execIdx, plan.loginAs);
          continue;
        }
      }
    }

    let clipSucceeded = false;
    try {
      const clip = await recordClip(browser as any, plan, roleSession?.session ?? null, roleSession?.liveCtx);
      recorded.push(clip);
      writeCachedLandedUrl(plan.id, clip.landedUrl);
      clipSucceeded = true;
    } catch (clipErr) {
      const message = (clipErr as Error).message ?? '';
      // recordClip already retried the SAME session 3x — if it's still landing on the
      // login/picker screen, the session itself may have genuinely expired mid-group
      // (some apps time out well under a minute), not just a one-off render race.
      // Re-authenticating fresh and retrying once addresses that root cause; simply
      // retrying the same dead session again (as recordClip's own loop does) cannot.
      const looksExpired = !!plan.loginAs && /login|picker/i.test(message);
      if (looksExpired) {
        console.warn(`  ↻ Session for role "${plan.loginAs}" may have expired mid-group — re-authenticating and retrying "${plan.id}" once…`);
        const stale = roleSessionCache.get(plan.loginAs!);
        roleSessionCache.delete(plan.loginAs!);
        await stale?.liveCtx?.close().catch(() => {});
        if (stale?.ownBrowser) await stale.ownBrowser.close().catch(() => {});
        failedRoles.delete(plan.loginAs!);
        const freshSession = await getSessionForRole(plan.loginAs!);
        if (freshSession) {
          try {
            const retryClip = await recordClip(browser as any, plan, freshSession.session, freshSession.liveCtx);
            recorded.push(retryClip);
            writeCachedLandedUrl(plan.id, retryClip.landedUrl);
            clipSucceeded = true;
          } catch (retryErr) {
            console.warn(`\n  ✗ Clip "${plan.id}" failed again after re-authenticating — skipping. (${(retryErr as Error).message?.slice(0, 120)})`);
          }
        }
      } else {
        console.warn(`\n  ✗ Clip "${plan.id}" failed — skipping. (${message.slice(0, 120)})`);
      }

      if (!clipSucceeded && fs.existsSync(mp4) && fs.existsSync(frame) && fs.statSync(mp4).size > 50_000) {
        console.warn(`    ↩ Using existing cached file as fallback.`);
        let dur = plan.durationSec;
        try { dur = getVideoInfo(mp4).duration; } catch {}
        recorded.push({
          id: plan.id, label: plan.label, targetUrl: plan.targetUrl, loginAs: plan.loginAs,
          videoPath: `recordings/${plan.id}.mp4`, framePath: frame,
          durationSec: dur, recordingStartSec: plan.recordingStartSec,
          landedUrl: readCachedLandedUrl(plan.id),
        });
      }
    }

    await closeRoleSessionIfDone(execIdx, plan.loginAs);
  }

  // Recording runs in EXECUTION_ORDER (grouped by role); restore RECORDING_PLAN's
  // original APP_ROUTE_MAP-authored order so scene timing/sequence in the final
  // video is unaffected by that execution-order optimization.
  const planIndex = new Map(RECORDING_PLAN.map((p, i) => [p.id, i]));
  recorded.sort((a, b) => (planIndex.get(a.id) ?? 0) - (planIndex.get(b.id) ?? 0));

  for (const { liveCtx, ownBrowser } of roleSessionCache.values()) {
    await liveCtx?.close();
    if (ownBrowser) await ownBrowser.close().catch(() => {});
  }
  await browser.close();

  // Drop routes that redirected to an unintended page (e.g. no matching login role,
  // so the app's route guard bounced to some other page) where that page's content
  // is already represented by another scene — showing it again would just repeat an
  // existing screen, worse now with narration that no longer even matches it. Routes
  // that redirected somewhere NOT already covered are kept (see landedUrl use below).
  const preCheckInput = recorded.map(c => ({
    id: c.id, title: '', narration: '', screenshotPath: c.framePath,
    targetUrl: c.targetUrl, landedUrl: c.landedUrl,
  }));
  const urlMismatchFlags    = detectUrlMismatches(preCheckInput);
  const duplicateFrameFlags = await detectDuplicateFrames(preCheckInput);
  const mismatchedIds = new Set(urlMismatchFlags.map(f => f.sceneId));

  // Group clips into visual-duplicate clusters (union of all pairwise DUPLICATE_FRAME
  // flags) so that when 3+ routes collapse onto the same page, we recognise them as ONE
  // group rather than only catching consecutive pairs.
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    if (!parent.has(id)) parent.set(id, id);
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const clip of recorded) find(clip.id);
  for (const f of duplicateFrameFlags) {
    if (f.relatedSceneId) union(f.sceneId, f.relatedSceneId);
  }
  const clusters = new Map<string, string[]>();
  for (const clip of recorded) {
    const root = find(clip.id);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(clip.id);
  }

  // Within each cluster of visually-similar scenes, only ever drop a clip that ITSELF
  // redirected somewhere unintended (a URL mismatch) — never a clip that genuinely
  // reached its own target route. Perceptual image hashing compares whole-frame pixel
  // layout, and most dashboard-style apps share the same chrome (sidebar, header,
  // mostly-whitespace background) across every screen, so two completely different,
  // correctly-landed pages routinely hash as "90%+ similar" — dropping them on that
  // basis alone silently deletes real, distinct, correctly-authenticated content.
  // A cluster with no mismatched member is left untouched entirely.
  const dropIds = new Set<string>();
  const droppedScenes: { id: string; reason: string }[] = [];
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const mismatchedMembers = members.filter(id => mismatchedIds.has(id));
    if (mismatchedMembers.length === 0) continue;
    const correct = members.filter(id => !mismatchedIds.has(id));
    const keepId  = correct[0] ?? mismatchedMembers[0];
    for (const id of mismatchedMembers) {
      if (id === keepId) continue;
      dropIds.add(id);
      const mismatch = urlMismatchFlags.find(f => f.sceneId === id);
      droppedScenes.push({
        id,
        reason: `duplicate of "${keepId}"` + (mismatch ? ` (${mismatch.message})` : ''),
      });
    }
  }
  const keptClips = recorded.filter(clip => !dropIds.has(clip.id));
  if (droppedScenes.length > 0) {
    console.log(`\n  Dropping ${droppedScenes.length} scene(s) that duplicate content shown elsewhere:`);
    for (const d of droppedScenes) console.log(`    ✗ ${d.id} — ${d.reason}`);
  }
  if (roleLoginIssues.length > 0) {
    console.log(`\n  ⚠ ${roleLoginIssues.length} role-login issue(s) — check APP_ROUTE_MAP role names against the app's actual Quick Access cards:`);
    for (const r of roleLoginIssues) console.log(`    ⚠ ${r.role} — ${r.issue}`);
  }

  // AI analysis of captured frames
  console.log('\n  Analysing frames with AI vision…\n');
  const analyzed: AnalyzedClip[] = [];
  for (const clip of keptClips) {
    console.log(`  Analysing [${clip.id}]…`);
    try {
      // If this route redirected elsewhere but landed somewhere unique (not dropped
      // above), describe the page actually shown instead of the originally intended one.
      const analysis = await analyzeFrame(clip.framePath, clip.landedUrl ?? clip.targetUrl, finalPainPoints);
      analyzed.push({ ...clip, ...analysis });
      console.log(`    → ${analysis.featureTitle}: ${analysis.salesHook}`);
    } catch (aiErr) {
      console.warn(`    ⚠ AI analysis failed for "${clip.id}" — using defaults. (${(aiErr as Error).message?.slice(0, 80)})`);
      analyzed.push({
        ...clip,
        featureTitle: clip.label,
        salesHook:    `Streamline your ${PRODUCT_NAME} workflow.`,
        narration:    `The ${clip.label} screen gives your team a clear view of the information they need to act fast.`,
      });
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  if (analyzed.length === 0) {
    console.error('\n  ✗ No clips were successfully recorded or cached — demo-package.json NOT updated to avoid losing existing content.');
    process.exit(1);
  }

  // Validate generated content — flags near-duplicate frames/narration and routes that
  // didn't land where expected. Warns loudly but does NOT block: demo-package.json is
  // always written below regardless of the report's outcome.
  const validationReport = await validateDemoScenes(analyzed.map(c => ({
    id:             c.id,
    title:          c.featureTitle,
    narration:      c.narration,
    screenshotPath: c.framePath,
    targetUrl:      c.targetUrl,
    landedUrl:      c.landedUrl,
  })));
  printValidationReport(validationReport);
  fs.writeFileSync(
    path.join(OUT_DIR, 'validation-report.json'),
    JSON.stringify({ ...validationReport, droppedScenes, roleLoginIssues }, null, 2),
    'utf-8',
  );

  // Write outputs
  let pkg   = buildDemoPackage(analyzed, benefitContent, brollSubtitles) as Record<string, any>;
  let voice = buildVoiceScript(analyzed, pkg, brollSubtitles) as Record<string, any>;

  // i18n translation if APP_LANGUAGE != 'en'
  if (APP_LANGUAGE && APP_LANGUAGE !== 'en') {
    const translated = await translateAllContent(pkg, voice, APP_LANGUAGE);
    pkg   = translated.pkg;
    voice = translated.voice;
  }

  fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2), 'utf-8');
  console.log(`\n  ✓  demo-package.json → ${PKG_PATH}`);

  fs.writeFileSync(VOICE_PATH, JSON.stringify(voice, null, 2), 'utf-8');
  console.log(`  ✓  voice-script.json  → ${VOICE_PATH}`);

  // ── B-roll videos ─────────────────────────────────────────────────────────
  // On New Recording (FORCE_RERECORD=true), always clear existing broll files and
  // re-download from Pexels so the footage matches the current product.
  // Scan REC_DIR directly — do NOT rely on scene.videoPath from pkg (may be unset).
  if (forceRerecord && fs.existsSync(REC_DIR)) {
    const stale = fs.readdirSync(REC_DIR).filter(f => f.startsWith('broll-') && f.endsWith('.mp4'));
    for (const f of stale) {
      try { fs.unlinkSync(path.join(REC_DIR, f)); } catch {}
    }
    if (stale.length > 0) console.log(`\n  Cleared ${stale.length} existing broll file(s) — will download fresh stock footage.`);
  }

  const brollCount = ((pkg as any).brollScenes as Array<unknown>).length;
  const needsBrolls = forceRerecord || (() => {
    if (!fs.existsSync(REC_DIR)) return true;
    for (let i = 0; i < brollCount; i++) {
      const p = path.join(REC_DIR, `broll-${i}.mp4`);
      if (!fs.existsSync(p) || fs.statSync(p).size < 5_000_000) return true;
    }
    return false;
  })();

  if (needsBrolls) {
    console.log(`\n  B-roll: downloading stock videos from Pexels for ${PRODUCT_NAME}…`);
    if (process.env['PEXELS_API_KEY']) {
      try {
        execSync('npm run broll:download', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
      } catch {
        console.warn('  ⚠️  Pexels download failed — check PEXELS_API_KEY and network connectivity.');
        console.warn('  ⚠️  B-roll scenes will show subtitle slides only.');
      }
    } else {
      console.warn('  ⚠️  PEXELS_API_KEY not set — skipping b-roll download.');
    }
  }

  const total = (pkg as any).composition.durationInFrames;
  console.log(`\n  Total duration : ${total} frames = ${(total / FPS).toFixed(1)}s`);
  console.log(`  Scenes         : ${(pkg as any).scenes.length}`);
  console.log(`  B-roll scenes  : ${(pkg as any).brollScenes.length}`);

  console.log('\n  🎙️  Generating voice narration…');
  try {
    execSync('npm run voice:only', {
      cwd:   path.resolve(__dirname, '..'),
      stdio: 'inherit',
    });
    // Confirm MP3s were written, then stamp voice-script.json so the
    // composition knows it can safely render <Audio> elements.
    const vs        = JSON.parse(fs.readFileSync(VOICE_PATH, 'utf-8')) as Record<string, unknown>;
    const segDir    = path.join(OUT_DIR, (vs['voiceDir'] as string | undefined) ?? 'voice-segments');
    const mp3Count  = fs.existsSync(segDir)
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

  console.log(`\n  ✅  Done! Open ${PRODUCT_NAME} in Remotion Studio:\n      npm start\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
