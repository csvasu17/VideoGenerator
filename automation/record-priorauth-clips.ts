/**
 * record-priorauth-clips.ts
 *
 * Records screen-capture clips for the PAYERCORE Prior Auth app and writes
 * out/priorauth/demo-package.json + out/priorauth/voice-script.json.
 *
 * Login: Demo Quick Login cards (LOGIN_TYPE=2) — clicks "Nancy" (nurse reviewer)
 * for all authenticated clips. The login page clip is recorded unauthenticated.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json automation/record-priorauth-clips.ts
 */

import { chromium }           from 'playwright';
import type { BrowserContext, Page } from 'playwright';
import * as fs                from 'fs';
import * as path              from 'path';
import * as dotenv            from 'dotenv';
import { AzureOpenAI }        from 'openai';
import { getVideoInfo }       from './utils/ffprobe';
import { execSync }           from 'child_process';
import { OUT_DIR, SCREEN_FIT } from './config';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

// ─── Config ──────────────────────────────────────────────────────────────────

const APP_URL       = (process.env['APP_URL'] ?? 'http://10.1.9.23:3013').replace(/\/$/, '');
const LOGIN_URL     = `${APP_URL}/login`;
const REC_DIR       = path.join(OUT_DIR, 'recordings');
const PKG_PATH      = path.join(OUT_DIR, 'demo-package.json');
const VOICE_PATH    = path.join(OUT_DIR, 'voice-script.json');

const FPS           = 30;
const VIEWPORT      = { width: 1920, height: 1080 };
const BROLL_FRAMES  = 240;   // 8 s per broll — enough room for 13-15 word narrations
const PRODUCT_SEC   = 14;    // default scene duration
const BENEFIT_SEC   = 18;
const PRESENTER_SEC = 16;

// Seconds into non-login recordings to seek past the login/nav overhead
const LOGIN_SKIP_SEC = 8;

fs.mkdirSync(REC_DIR, { recursive: true });

// ─── Azure OpenAI (GPT-4.1 vision) ───────────────────────────────────────────

const azureClient = new AzureOpenAI({
  apiKey:     process.env['AZURE_OPENAI_API_KEY']    ?? '',
  endpoint:   process.env['AZURE_OPENAI_ENDPOINT']   ?? '',
  deployment: process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
  apiVersion: process.env['OPENAI_API_VERSION']      ?? '2024-12-01-preview',
});

const APP_CONTEXT   = process.env['APP_CONTEXT_TEXT'] ?? '';
const APP_GLOSSARY  = process.env['APP_GLOSSARY']     ?? '';
const APP_ROUTE_MAP = process.env['APP_ROUTE_MAP']    ?? '';

// Pre-parse route map once so we can look up page purpose by URL at analysis time
let routeMap: Record<string, string> = {};
try { if (APP_ROUTE_MAP) routeMap = JSON.parse(APP_ROUTE_MAP); } catch {}

async function analyzeFrame(
  framePath:  string,
  userRole?:  string,   // e.g. "Nancy" — from clip.loginAs
  targetUrl?: string,   // e.g. "http://host/authorization-queue"
): Promise<{
  featureTitle: string;
  salesHook:    string;
  narration:    string;
}> {
  const b64 = fs.readFileSync(framePath).toString('base64');

  // Resolve page purpose from route map (match URL path against keys)
  let pagePurpose = '';
  if (targetUrl && Object.keys(routeMap).length > 0) {
    try {
      const urlPath = new URL(targetUrl).pathname;
      const key = Object.keys(routeMap).find(k => urlPath.startsWith(k.replace(/\[.*?\]/g, '')));
      if (key) pagePurpose = routeMap[key];
    } catch {}
  }

  // Build enriched system prompt
  const sections: string[] = [
    'You are a B2B SaaS demo video script writer for healthcare technology.',
  ];

  if (APP_CONTEXT) {
    sections.push(`\nPRODUCT CONTEXT:\n${APP_CONTEXT}`);
  }
  if (userRole) {
    sections.push(`\nACTIVE USER ROLE: The logged-in user is "${userRole}". Frame all narration from this persona's goals and pain points as described in the ROLES section above.`);
  }
  if (pagePurpose) {
    sections.push(`\nCURRENT PAGE: ${pagePurpose}`);
  }
  if (APP_GLOSSARY) {
    sections.push(`\nDOMAIN GLOSSARY (use these exact terms in narration):\n${APP_GLOSSARY}`);
  }

  sections.push(`
Given a product screenshot, output a JSON object (no markdown fences) with exactly:
{
  "featureTitle": "short 2-4 word feature name",
  "salesHook": "compelling 6-10 word hook focusing on business value for the active user role",
  "narration": "one paragraph (2-3 sentences, ~25 words) — address the active user role by name, explain what this screen lets them do, and state the specific pain it eliminates"
}
Be specific to what you see. Use domain glossary terms accurately.`);

  const response = await azureClient.chat.completions.create({
    model:      process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
    max_tokens: 500,
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
  });

  const raw = response.choices[0]?.message?.content ?? '{}';
  try {
    const p = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, ''));
    return {
      featureTitle: p.featureTitle ?? 'Platform Feature',
      salesHook:    p.salesHook    ?? 'Streamline prior authorization instantly.',
      narration:    p.narration    ?? 'This feature accelerates the prior authorization workflow.',
    };
  } catch {
    return {
      featureTitle: 'Platform Feature',
      salesHook:    'Streamline prior authorization instantly.',
      narration:    'This feature accelerates the prior authorization workflow.',
    };
  }
}

// ─── Suppress notification popups ────────────────────────────────────────────

const SUPPRESS_CSS = `
  [class*="toast"]:not(button),[class*="snackbar"],[class*="notification"]:not(nav),
  [class*="alert"][class*="panel"],[class*="modal-overlay"]:not([class*="content"]) {
    display:none!important;
  }
`;

async function suppressPopups(page: Page): Promise<void> {
  await page.addStyleTag({ content: SUPPRESS_CSS }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(200);
}

// ─── Login helper ─────────────────────────────────────────────────────────────

/**
 * Navigate to /login and click the Demo Quick Login card by the given name.
 * Returns true if navigation succeeded (URL changed away from /login).
 */
async function loginAs(page: Page, name: string): Promise<boolean> {
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);

  // Try clicking the card that contains the name text
  try {
    await page.locator(`text=${name}`).first().click({ timeout: 5000 });
    await page.waitForTimeout(3000);
  } catch {
    console.warn(`  Warning: could not click card for "${name}" — trying Sign In fallback`);
  }

  // If still on login, try clicking Sign In button (some cards pre-fill credentials)
  if (page.url().includes('login') || page.url().includes('signin')) {
    await page.locator('button[type="submit"], button:has-text("Sign In"), button:has-text("Login")').first()
      .click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(3000);
  }

  const success = !page.url().includes('login') && !page.url().includes('signin');
  if (success) {
    console.log(`  ✓ Logged in as ${name} → ${page.url()}`);
  } else {
    console.warn(`  ⚠ Still on login page after clicking "${name}"`);
  }
  return success;
}

// ─── Clip action types ────────────────────────────────────────────────────────

interface ClipAction {
  type:        'wait' | 'navigate' | 'click' | 'scroll' | 'evaluate';
  url?:        string;
  selector?:   string;
  text?:       string;
  value?:      string | number;
  waitAfterMs?: number;
}

interface ClipPlan {
  id:               string;
  label:            string;
  targetUrl:        string;      // URL to navigate to AFTER login
  durationSec:      number;
  loginAs?:         string;      // Quick Access card name to use (undefined = no login needed)
  recordingStartSec?: number;    // seek offset into recording for Remotion
  skipInteraction?: boolean;
  actions?:         ClipAction[];
}

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
      await page.evaluate((y: number) => window.scrollTo({ top: y, behavior: 'smooth' }), action.value as number ?? 500).catch(() => {});
      if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);
      break;
    case 'evaluate':
      await page.evaluate(action.value as string).catch(() => {});
      if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);
      break;
  }
}

// ─── Recording Plan ───────────────────────────────────────────────────────────
// Story arc: one PA case followed from arrival to decision, across all 4 roles.

const RECORDING_PLAN: ClipPlan[] = [

  // ── Opening — set the stage ───────────────────────────────────────────────────

  {
    id: 'login',
    label: 'Login Page',
    targetUrl: LOGIN_URL,
    durationSec: 10,
    loginAs: undefined,
    actions: [
      { type: 'wait', waitAfterMs: 3000 },
      { type: 'evaluate', value: `(() => {
          const e = document.createEvent('MouseEvent');
          e.initMouseEvent('mousemove',true,true,window,0,0,0,728,520,false,false,false,false,0,null);
          document.elementFromPoint(728,520)?.dispatchEvent(e);
        })()`, waitAfterMs: 1000 },
      { type: 'wait', waitAfterMs: 4000 },
    ],
  },

  // ── Alice — Intake Coordinator ────────────────────────────────────────────────

  // Dashboard: live pipeline KPIs — Alice's morning view
  {
    id: 'dashboard',
    label: 'Operational Dashboard',
    targetUrl: `${APP_URL}/`,
    durationSec: 16,
    loginAs: 'Alice',
    recordingStartSec: LOGIN_SKIP_SEC,
    actions: [
      { type: 'wait', waitAfterMs: 2000 },
      { type: 'scroll', value: 300, waitAfterMs: 2000 },
      { type: 'scroll', value: 0, waitAfterMs: 2000 },
      { type: 'wait', waitAfterMs: 3000 },
    ],
  },

  // Intake Queue: incoming requests pre-scored, filterable by status and LOB
  {
    id: 'intake-queue',
    label: 'PA Intake Queue',
    targetUrl: `${APP_URL}/intake`,
    durationSec: 14,
    loginAs: 'Alice',
    recordingStartSec: LOGIN_SKIP_SEC,
    actions: [
      { type: 'wait', waitAfterMs: 3000 },
      { type: 'scroll', value: 250, waitAfterMs: 2000 },
      { type: 'scroll', value: 0, waitAfterMs: 2000 },
      { type: 'wait', waitAfterMs: 2000 },
    ],
  },

  // Submit New PA: AI extracts ICD-10, CPT, flags missing info gaps instantly
  {
    id: 'intake-new',
    label: 'Submit New PA',
    targetUrl: `${APP_URL}/intake/new`,
    durationSec: 16,
    loginAs: 'Alice',
    recordingStartSec: LOGIN_SKIP_SEC,
    actions: [
      { type: 'wait', waitAfterMs: 2000 },
      { type: 'click', text: 'Paste Text', waitAfterMs: 2000 },
      { type: 'click', text: 'Bulk Upload', waitAfterMs: 2000 },
      { type: 'wait', waitAfterMs: 4000 },
    ],
  },

  // Intake Review: Alice confirms the case is complete before routing to UM
  {
    id: 'intake-review',
    label: 'Intake Review',
    targetUrl: `${APP_URL}/intake/review`,
    durationSec: 14,
    loginAs: 'Alice',
    recordingStartSec: LOGIN_SKIP_SEC,
    actions: [
      { type: 'wait', waitAfterMs: 3000 },
      { type: 'scroll', value: 250, waitAfterMs: 2000 },
      { type: 'scroll', value: 0, waitAfterMs: 2000 },
      { type: 'wait', waitAfterMs: 2000 },
    ],
  },

  // ── Nancy — Nurse Reviewer (UM) ───────────────────────────────────────────────

  // Authorization Queue: policy-ready cases with Readiness Scores, ready for decision
  {
    id: 'auth-queue',
    label: 'Authorization Queue',
    targetUrl: `${APP_URL}/authorization-queue`,
    durationSec: 18,
    loginAs: 'Nancy',
    recordingStartSec: LOGIN_SKIP_SEC,
    actions: [
      { type: 'wait', waitAfterMs: 3000 },
      { type: 'scroll', value: 200, waitAfterMs: 2000 },
      { type: 'scroll', value: 0, waitAfterMs: 2000 },
      { type: 'wait', waitAfterMs: 4000 },
    ],
  },

  // Case Detail: 5 AI agent cards — Nancy's "aha moment", one-click decision
  {
    id: 'case-detail',
    label: 'Case Detail — AI Review',
    targetUrl: `${APP_URL}/authorization-queue`,
    durationSec: 20,
    loginAs: 'Nancy',
    recordingStartSec: 14,
    actions: [
      { type: 'wait', waitAfterMs: 2000 },
      { type: 'click', selector: 'tbody tr:first-child', waitAfterMs: 3000 },
      { type: 'scroll', value: 300, waitAfterMs: 2000 },
      { type: 'scroll', value: 0, waitAfterMs: 2000 },
      { type: 'wait', waitAfterMs: 3000 },
    ],
  },

  // Outreach Queue: provider obligations tracked — documentation, P2P, denial notices
  {
    id: 'outreach-queue',
    label: 'Outreach Queue',
    targetUrl: `${APP_URL}/outreach-queue`,
    durationSec: 14,
    loginAs: 'Nancy',
    recordingStartSec: LOGIN_SKIP_SEC,
    actions: [
      { type: 'wait', waitAfterMs: 3000 },
      { type: 'scroll', value: 200, waitAfterMs: 2000 },
      { type: 'scroll', value: 0, waitAfterMs: 2000 },
    ],
  },

  // ── Michael — Medical Director ────────────────────────────────────────────────

  // Appeals Workbench: denial management, P2P scheduling and resolution
  {
    id: 'appeals',
    label: 'Appeals Workbench',
    targetUrl: `${APP_URL}/appeals-workbench`,
    durationSec: 14,
    loginAs: 'Michael',
    recordingStartSec: LOGIN_SKIP_SEC,
    actions: [
      { type: 'wait', waitAfterMs: 3000 },
      { type: 'scroll', value: 200, waitAfterMs: 2000 },
      { type: 'scroll', value: 0, waitAfterMs: 2000 },
    ],
  },

  // ── Sam — Admin / Policy Manager ──────────────────────────────────────────────

  // Policy Library: full clinical policy registry with version history
  {
    id: 'policy-library',
    label: 'Policy Library',
    targetUrl: `${APP_URL}/policy-library`,
    durationSec: 14,
    loginAs: 'Sam',
    recordingStartSec: LOGIN_SKIP_SEC,
    actions: [
      { type: 'wait', waitAfterMs: 3000 },
      { type: 'scroll', value: 250, waitAfterMs: 2000 },
      { type: 'scroll', value: 0, waitAfterMs: 2000 },
      { type: 'wait', waitAfterMs: 2000 },
    ],
  },

  // Policy Studio: upload new payer policy, AI extracts and flags conflicts
  {
    id: 'policy-studio',
    label: 'Policy Studio',
    targetUrl: `${APP_URL}/policy-studio`,
    durationSec: 16,
    loginAs: 'Sam',
    recordingStartSec: LOGIN_SKIP_SEC,
    actions: [
      { type: 'wait', waitAfterMs: 3000 },
      { type: 'scroll', value: 200, waitAfterMs: 2000 },
      { type: 'scroll', value: 0, waitAfterMs: 2000 },
      { type: 'wait', waitAfterMs: 3000 },
    ],
  },

  // Rule Engine: auto-approve/deny/pend based on payer-specific conditions
  {
    id: 'rules',
    label: 'Rule Engine',
    targetUrl: `${APP_URL}/rules`,
    durationSec: 14,
    loginAs: 'Sam',
    recordingStartSec: LOGIN_SKIP_SEC,
    actions: [
      { type: 'wait', waitAfterMs: 3000 },
      { type: 'scroll', value: 200, waitAfterMs: 2000 },
      { type: 'scroll', value: 0, waitAfterMs: 2000 },
    ],
  },

  // Agent Audit Trail: every AI decision logged — compliance, appeals, governance
  {
    id: 'audit-trail',
    label: 'Agent Audit Trail',
    targetUrl: `${APP_URL}/audit-trail`,
    durationSec: 14,
    loginAs: 'Sam',
    recordingStartSec: LOGIN_SKIP_SEC,
    actions: [
      { type: 'wait', waitAfterMs: 3000 },
      { type: 'scroll', value: 200, waitAfterMs: 2000 },
      { type: 'scroll', value: 0, waitAfterMs: 2000 },
    ],
  },
];

// ─── Interaction ──────────────────────────────────────────────────────────────

async function performFullInteraction(page: Page): Promise<void> {
  await suppressPopups(page);
  try {
    const h = await page.evaluate(() => document.body.scrollHeight);
    const steps = Math.min(Math.ceil(h / 400), 6);
    for (let i = 1; i <= steps; i++) {
      await page.evaluate((y: number) => window.scrollTo({ top: y, behavior: 'smooth' }), (i / steps) * h * 0.7);
      await page.waitForTimeout(600);
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await page.waitForTimeout(500);
  } catch {}
  await suppressPopups(page);
}

// ─── FFmpeg helper ────────────────────────────────────────────────────────────

function findFfmpeg(): string {
  try { execSync('ffmpeg -version', { stdio: 'ignore' }); return 'ffmpeg'; } catch {}
  for (const c of ['C:/ffmpeg/bin/ffmpeg.exe', 'D:/ffmpeg/bin/ffmpeg.exe']) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('FFmpeg not found in PATH');
}

function convertToMp4(webmPath: string, mp4Path: string): void {
  const ffmpeg = findFfmpeg();
  execSync(`"${ffmpeg}" -y -i "${webmPath}" -c:v libx264 -crf 23 -preset fast -pix_fmt yuv420p -movflags +faststart -an "${mp4Path}"`, { stdio: 'pipe' });
}

// ─── Record one clip ──────────────────────────────────────────────────────────

interface RecordedClip {
  id:               string;
  label:            string;
  targetUrl:        string;
  loginAs?:         string;
  videoPath:        string;
  framePath:        string;
  durationSec:      number;
  recordingStartSec?: number;
}

async function recordClip(
  browser: ReturnType<typeof chromium.launch> extends Promise<infer T> ? T : never,
  plan: ClipPlan,
): Promise<RecordedClip> {
  const recDir = path.join(OUT_DIR, '_tmp_rec');
  fs.mkdirSync(recDir, { recursive: true });

  console.log(`\n  ── Recording: ${plan.label} ──────────────────────────`);

  const ctx: BrowserContext = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: recDir, size: VIEWPORT },
    ignoreHTTPSErrors: true,
  });
  await ctx.addInitScript(({ css }: { css: string }) => {
    const s = document.createElement('style');
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }, { css: SUPPRESS_CSS });

  const page = await ctx.newPage();

  // Navigate and login
  if (plan.loginAs) {
    console.log(`    Logging in as "${plan.loginAs}"...`);
    await loginAs(page, plan.loginAs);
    // Navigate to target after login
    if (page.url() !== plan.targetUrl) {
      await page.goto(plan.targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
    }
  } else {
    // No login — navigate directly
    await page.goto(plan.targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
  }

  await suppressPopups(page);
  await page.waitForTimeout(500);

  // Run custom actions
  if (plan.actions) {
    for (const action of plan.actions) {
      await performAction(page, action);
    }
  }

  // Generic interaction unless skipped
  if (!plan.skipInteraction) {
    await performFullInteraction(page);
  }

  // Wait for remaining clip time
  const elapsed = plan.actions?.reduce((s, a) => s + (a.waitAfterMs ?? 0), 0) ?? 0;
  const targetMs = (plan.durationSec + (plan.recordingStartSec ?? 0)) * 1000;
  const remaining = targetMs - elapsed - 3000;
  if (remaining > 0) await page.waitForTimeout(remaining);

  // Capture final screenshot for AI analysis
  const framePath = path.join(REC_DIR, `${plan.id}-frame.png`);
  await page.screenshot({ path: framePath, fullPage: false });
  console.log(`    Screenshot saved: ${path.basename(framePath)}`);

  // Stop recording
  const videoObj = page.video();
  await ctx.close();

  // Convert WebM → MP4
  const webmPath = await videoObj?.path() ?? '';
  const mp4Path = path.join(REC_DIR, `${plan.id}.mp4`);
  if (webmPath && fs.existsSync(webmPath)) {
    console.log(`    Converting to MP4...`);
    convertToMp4(webmPath, mp4Path);
    fs.unlinkSync(webmPath);
  } else {
    console.error(`    ✗ WebM not found at ${webmPath}`);
  }

  // Get actual duration
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
  };
}

// ─── Build demo-package.json ─────────────────────────────────────────────────

interface AnalyzedClip extends RecordedClip {
  featureTitle: string;
  salesHook:    string;
  narration:    string;
}

function buildDemoPackage(clips: AnalyzedClip[]): object {
  const BROLL_COUNT  = 5;
  const brollFrames  = BROLL_COUNT * BROLL_FRAMES;

  // ── Scenes ──────────────────────────────────────────────────────────────────
  let from = brollFrames;
  const scenes = clips.map((clip, idx) => {
    const dur = Math.round(clip.durationSec * FPS);
    const scene = {
      id:             `scene-${idx + 1}`,
      pageId:         clip.id,
      title:          clip.featureTitle,
      salesHook:      clip.salesHook,
      narration:      clip.narration,
      description:    clip.narration,
      screenshotPath: `recordings/${clip.id}-frame.png`,
      // Login uses screenshot fallback (Ken-Burns) — no video needed for a static login page
      ...(clip.id !== 'login' ? { recordingPath: clip.videoPath } : {}),
      ...(clip.recordingStartSec ? { recordingStartSec: clip.recordingStartSec } : {}),
      from,
      durationInFrames: dur,
      transition: idx < clips.length - 1
        ? { type: 'slide-left', durationInFrames: 12 }
        : null,
      nodeType: '',
    };
    from += dur;
    return scene;
  });

  // ── Benefit slide ────────────────────────────────────────────────────────────
  const benefitFrom = from;
  const benefitFrames = Math.round(BENEFIT_SEC * FPS);
  from += benefitFrames;

  // ── Presenter close ──────────────────────────────────────────────────────────
  const presenterFrom = from;
  const presenterFrames = Math.round(PRESENTER_SEC * FPS);
  const totalFrames = presenterFrom + presenterFrames;

  // ── B-roll problem scenes (Pexels stock video) ─────────────────────────────
  const brollDefs = [
    'Manual PA reviews drown clinical staff in paperwork and phone calls.',
    'Incomplete submissions mean one in three PA requests is returned for more information.',
    'Payer policy mismatches spike denial rates and delay patient care by days or weeks.',
    'Critical clinical evidence buried in unstructured PDFs is routinely missed by manual reviewers.',
    'No pipeline visibility leaves revenue cycle teams unable to predict outcomes or prevent denials.',
  ];

  const brollScenes = brollDefs.map((sub, i) => ({
    id:               `broll-${i}`,
    from:             i * BROLL_FRAMES,
    durationInFrames: BROLL_FRAMES,
    subtitle:         sub,
    category:         'healthcare',
    videoPath:        `recordings/broll-${i}.mp4`,
  }));

  return {
    composition: {
      id: 'EnterpriseVideo',
      durationInFrames: totalFrames,
      fps: FPS,
      width:  VIEWPORT.width,
      height: VIEWPORT.height,
    },
    scenes,
    brollScenes,
    benefitSlide: {
      from: benefitFrom,
      durationInFrames: benefitFrames,
      title: 'PriorCore — Built for Every Role',
      bullets: [
        {
          icon: 'accuracy',
          label: 'AI Clinical Extraction',
          description: 'NLP agents read unstructured clinical documents and extract ICD-10 codes, CPT codes, diagnoses, and lab results — eliminating manual data entry.',
        },
        {
          icon: 'speed',
          label: 'Readiness Score Engine',
          description: 'Every PA request receives a 0–100 Readiness Score before it reaches a reviewer — only Policy-Ready cases enter the Authorization Queue.',
        },
        {
          icon: 'oversight',
          label: 'Multi-Role Workflow',
          description: 'Alice submits, Nancy reviews, Michael decides, Sam governs — each role sees exactly the information they need, nothing more.',
        },
        {
          icon: 'compliance',
          label: 'Policy Studio',
          description: 'Sam uploads payer policy amendments and the Rule Engine instantly flags conflicts with existing clinical rules before any case is affected.',
        },
        {
          icon: 'revenue',
          label: 'Full Audit Transparency',
          description: 'Every AI agent decision is logged in real time — supporting compliance reviews, denial appeals, and regulatory audits.',
        },
      ],
    },
    presenterClose: {
      from: presenterFrom,
      durationInFrames: presenterFrames,
      tagline: 'every PA — submitted complete, reviewed fast, decided with confidence',
      presenterSrc: '',
    },
    presenterConfig: {
      src: '',
      videoSrc: '',
      widthFraction: 0.15,
      position: 'bottom-left',
      enabled: false,
    },
    meta: {
      productName:     'PriorCore',
      targetAudience:  'healthcare payers, utilization management teams, and revenue cycle managers',
      primaryBenefit:  'automate prior authorization across all roles — from intake to policy governance',
      templateId:      'enterprise',
    },
    screenFit: SCREEN_FIT,
  };
}

// ─── Build voice-script.json ──────────────────────────────────────────────────

// ─── Voice narrations — one story, one case, four roles ───────────────────────
// Each line is a chapter in the same PA case journey: arrival → decision → governance.
// Role titles used throughout — not person names. No repeated sentence openers.
const SCENE_NARRATIONS: Record<string, string> = {
  'login':
    'Four teams. One platform. A prior authorization just arrived — and it\'s about to move through every one of them.',

  'dashboard':
    'The intake coordinator opens to a live view of the pipeline — readiness scores, case volumes, and weekly authorization trends. She sees exactly where every PA stands before her first call of the day.',

  'intake-queue':
    'A new request is waiting in the intake queue, already scored for readiness. She filters by status and line of business — no spreadsheets, no shared inboxes, no guesswork.',

  'intake-new':
    'She pastes the clinical referral notes. The AI immediately extracts the ICD-10 diagnosis code, the CPT procedure code, and lists every missing documentation gap. Thirty seconds in, the case knows exactly what it still needs.',

  'intake-review':
    'Before routing to the UM team, she reviews the submission. The case is complete — Readiness Score confirmed, all clinical evidence attached. She routes it forward.',

  'auth-queue':
    'The case is routed to clinical review. The nurse reviewer\'s queue shows it — already policy-ready, already pre-scored. No charts to pull, no binders to check. A Readiness Score, a ranked policy match, a recommendation — and she acts.',

  'case-detail':
    'She opens the case. Five AI agents have completed their review — eligibility, medical coding, policy alignment, clinical evidence, and appeal risk — all surfaced in one view. What once took thirty minutes of manual preparation is already done. One click. Approved.',

  'outreach-queue':
    'Unresolved payer requests land in the Outreach Queue — each tracked with a status, owner, and due date. No chasing providers by phone.',

  'appeals':
    'When a payer denies, Michael — the medical director — manages the appeal from one workbench. Peer-to-peer review consultations are scheduled, tracked, and resolved without leaving the platform.',

  'policy-library':
    'The decisions Nancy and Michael make are grounded in this — the clinical policy registry. Every payer policy, every version, every expiry date — searchable, auditable, and always current.',

  'policy-studio':
    'When a new payer policy arrives, Sam uploads it directly into Policy Studio. The AI extracts coverage criteria and prior therapy requirements, then flags every conflict with existing rules — before a single case is affected.',

  'rules':
    'Low-complexity cases never reach a human reviewer. The Rule Engine evaluates every case against payer-specific conditions and automatically approves, denies, or pends — keeping turnaround time short and the autonomy rate high.',

  'audit-trail':
    'Every step of that case\'s journey is logged here — every AI agent decision, every approval, every override — in real time. Complete transparency for compliance reviews, regulatory audits, and denial appeals.',
};

function buildVoiceScript(clips: AnalyzedClip[], pkg: any): object {
  const brollCount = pkg.brollScenes.length;

  // Broll voice segments — one per broll, 8s slot, voice starts at 1s and runs 6.5s
  const brollSec = BROLL_FRAMES / FPS;   // 8s per broll
  const brollSegments = [
    { id: 'broll-0', text: 'Prior auth teams lose hours every day to manual reviews, phone calls, and fax queues.' },
    { id: 'broll-1', text: 'One in three PA requests bounces back — reviewers discover missing documentation days later.' },
    { id: 'broll-2', text: 'Payer policy mismatches go undetected until denial — costing days of patient care and revenue.' },
    { id: 'broll-3', text: 'Critical clinical evidence buried in unstructured PDFs is routinely missed by manual reviewers.' },
    { id: 'broll-4', text: 'Without pipeline visibility, revenue cycle teams cannot stop revenue leakage before it happens.' },
  ].map((b, i) => ({
    id:          b.id,
    label:       `B-roll ${i + 1}`,
    startSec:    i * brollSec + 1,
    durationSec: 6.5,
    enabled:     true,
    text:        b.text,
  }));

  // Product scene segments — use handcrafted narration if available, AI fallback otherwise
  const productSegments = clips.map((clip, idx) => {
    const scene   = pkg.scenes[idx];
    const startSec = scene.from / FPS;
    const text    = SCENE_NARRATIONS[clip.id] ?? clip.narration;
    return {
      id:          `scene-${idx + 1}`,
      label:       `Scene ${idx + 1} — ${clip.label}`,
      startSec,
      durationSec: clip.durationSec - 2,
      enabled:     true,
      text,
    };
  });

  // Benefit slide
  const benefitStartSec = pkg.benefitSlide.from / FPS;
  const benefitSegment = {
    id:          'benefit-slide',
    label:       'Benefit Slide — Value Adds',
    startSec:    benefitStartSec,
    durationSec: BENEFIT_SEC - 2,
    enabled:     true,
    text:        'PriorCore automates prior authorization from intake to governance. ' +
                 'Readiness scoring eliminates incomplete submissions. ' +
                 'Role-based workflows keep intake, review, medical direction, and admin in sync. ' +
                 'Full audit trails ensure every decision is defensible.',
  };

  // Presenter close
  const closeStartSec = pkg.presenterClose.from / FPS;
  const closeSegment = {
    id:          'presenter-close',
    label:       'Presenter Close',
    startSec:    closeStartSec,
    durationSec: PRESENTER_SEC - 2,
    enabled:     true,
    text:        'One case. Four teams. Zero manual bottlenecks. That\'s PriorCore — prior authorization done right, from first submission to final decision. Contact us to arrange your live demonstration.',
  };

  return {
    voice: 'nova',
    model: 'tts-hd',
    speed: 0.95,
    fps: FPS,
    totalDurationSec: Math.round((pkg.composition.durationInFrames / FPS) * 10) / 10,
    segments: [...brollSegments, ...productSegments, benefitSegment, closeSegment],
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  🎬  Prior Auth — Recording Pipeline');
  console.log(`      APP_URL : ${APP_URL}`);
  console.log(`      Output  : ${OUT_DIR}`);
  console.log(`      Clips   : ${RECORDING_PLAN.length}`);
  console.log('════════════════════════════════════════════════════════════\n');

  const browser = await chromium.launch({ headless: true });

  const recorded: RecordedClip[] = [];

  for (const plan of RECORDING_PLAN) {
    // Skip if already recorded
    const mp4 = path.join(REC_DIR, `${plan.id}.mp4`);
    const frame = path.join(REC_DIR, `${plan.id}-frame.png`);
    if (fs.existsSync(mp4) && fs.existsSync(frame) && fs.statSync(mp4).size > 50_000) {
      console.log(`\n  ── ${plan.label}  [CACHED — skipping] ──────────────────`);
      let dur = plan.durationSec;
      try { dur = getVideoInfo(mp4).duration; } catch {}
      recorded.push({
        id: plan.id, label: plan.label, targetUrl: plan.targetUrl, loginAs: plan.loginAs,
        videoPath: `recordings/${plan.id}.mp4`, framePath: frame,
        durationSec: plan.durationSec, recordingStartSec: plan.recordingStartSec,
      });
      continue;
    }

    const clip = await recordClip(browser as any, plan);
    recorded.push(clip);
  }

  await browser.close();

  // ── AI analysis ─────────────────────────────────────────────────────────────
  console.log('\n  Analysing frames with GPT-4.1 vision...\n');

  const analyzed: AnalyzedClip[] = [];
  for (const clip of recorded) {
    console.log(`  Analysing [${clip.id}] as "${clip.loginAs ?? 'guest'}"...`);
    const analysis = await analyzeFrame(clip.framePath, clip.loginAs, clip.targetUrl);
    analyzed.push({ ...clip, ...analysis });
    console.log(`    → ${analysis.featureTitle}: ${analysis.salesHook}`);
  }

  // ── Write outputs ────────────────────────────────────────────────────────────
  const pkg = buildDemoPackage(analyzed);
  fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2), 'utf-8');
  console.log(`\n  ✓  demo-package.json → ${PKG_PATH}`);

  const voice = buildVoiceScript(analyzed, pkg);
  fs.writeFileSync(VOICE_PATH, JSON.stringify(voice, null, 2), 'utf-8');
  console.log(`  ✓  voice-script.json  → ${VOICE_PATH}`);

  const total = (pkg as any).composition.durationInFrames;
  console.log(`\n  Total duration : ${total} frames = ${(total / FPS).toFixed(1)}s`);
  console.log(`  Scenes         : ${(pkg as any).scenes.length}`);
  console.log(`  B-roll scenes  : ${(pkg as any).brollScenes.length}`);
  console.log('\n  ✅  Done! Check in Remotion Studio:');
  console.log('      npm start   (with APP_PRODUCT_NAME=PriorAuth in .env)\n');
}

main().catch(e => { console.error(e); process.exit(1); });
