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

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

// ─── Config ──────────────────────────────────────────────────────────────────

const APP_URL       = (process.env['APP_URL'] ?? 'http://10.1.9.23:3013').replace(/\/$/, '');
const LOGIN_URL     = `${APP_URL}/login`;
const OUT_DIR       = path.resolve(__dirname, '../out/priorauth');
const REC_DIR       = path.join(OUT_DIR, 'recordings');
const PKG_PATH      = path.join(OUT_DIR, 'demo-package.json');
const VOICE_PATH    = path.join(OUT_DIR, 'voice-script.json');

const FPS           = 30;
const VIEWPORT      = { width: 1920, height: 1080 };
const BROLL_FRAMES  = 180;   // 6 s per broll
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

const APP_CONTEXT = process.env['APP_CONTEXT_TEXT'] ?? '';

async function analyzeFrame(framePath: string): Promise<{
  featureTitle: string;
  salesHook:    string;
  narration:    string;
}> {
  const b64 = fs.readFileSync(framePath).toString('base64');
  const ctxNote = APP_CONTEXT
    ? `\nApp context: ${APP_CONTEXT.slice(0, 400)}`
    : '';

  const response = await azureClient.chat.completions.create({
    model:      process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
    max_tokens: 400,
    messages: [
      {
        role: 'system',
        content: `You are a B2B SaaS demo video script writer for healthcare technology.${ctxNote}
Given a product screenshot, output a JSON object (no markdown fences) with exactly:
{
  "featureTitle": "short 2-4 word feature name",
  "salesHook": "compelling 6-10 word hook focusing on business value",
  "narration": "one paragraph (2-3 sentences, ~25 words) explaining what this feature does and why it matters for healthcare revenue cycle teams"
}
Be specific to what you see. Focus on prior authorization, RCM, clinical workflow value.`,
      },
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
      await page.goto(action.url!, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
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

const RECORDING_PLAN: ClipPlan[] = [

  // 0. Login page — shows PAYERCORE branding + Demo Quick Login cards
  {
    id: 'login',
    label: 'Login Page',
    targetUrl: LOGIN_URL,          // stays on login — no auth needed
    durationSec: 10,
    loginAs: undefined,            // do NOT login — just show the page
    actions: [
      { type: 'wait', waitAfterMs: 3000 },
      // Slow mouse sweep over the Quick Login cards to show them
      { type: 'evaluate', value: `(() => {
          const e = document.createEvent('MouseEvent');
          e.initMouseEvent('mousemove',true,true,window,0,0,0,728,520,false,false,false,false,0,null);
          document.elementFromPoint(728,520)?.dispatchEvent(e);
        })()`, waitAfterMs: 1000 },
      { type: 'wait', waitAfterMs: 4000 },
    ],
  },

  // 1. Operational Dashboard — AI Intelligence Hub with KPI metrics
  {
    id: 'dashboard',
    label: 'Operational Dashboard',
    targetUrl: `${APP_URL}/dashboard`,
    durationSec: 18,
    loginAs: 'Nancy',
    recordingStartSec: LOGIN_SKIP_SEC,
    actions: [
      { type: 'wait', waitAfterMs: 2000 },
      { type: 'scroll', value: 300, waitAfterMs: 2000 },
      { type: 'scroll', value: 0, waitAfterMs: 2000 },
      { type: 'wait', waitAfterMs: 3000 },
    ],
  },

  // 2. Submit New PA — Mission Documentation / AI clinical extraction intake
  {
    id: 'intake-new',
    label: 'Submit New PA',
    targetUrl: `${APP_URL}/intake/new`,
    durationSec: 15,
    loginAs: 'Nancy',
    recordingStartSec: LOGIN_SKIP_SEC,
    actions: [
      { type: 'wait', waitAfterMs: 2000 },
      // Show "Paste Text" tab
      { type: 'click', text: 'Paste Text', waitAfterMs: 2000 },
      // Show "Bulk Upload" tab
      { type: 'click', text: 'Bulk Upload', waitAfterMs: 2000 },
      { type: 'wait', waitAfterMs: 3000 },
    ],
  },

  // 3. Authorization Queue — AI-scored policy-ready cases for UM review
  {
    id: 'auth-queue',
    label: 'Authorization Queue',
    targetUrl: `${APP_URL}/authorization-queue`,
    durationSec: 20,
    loginAs: 'Nancy',
    recordingStartSec: LOGIN_SKIP_SEC,
    actions: [
      { type: 'wait', waitAfterMs: 3000 },
      { type: 'scroll', value: 200, waitAfterMs: 2000 },
      { type: 'scroll', value: 0, waitAfterMs: 2000 },
      { type: 'wait', waitAfterMs: 4000 },
    ],
  },

  // 4. Outreach Queue — cases needing additional documentation from providers
  {
    id: 'outreach-queue',
    label: 'Outreach Queue',
    targetUrl: `${APP_URL}/outreach-queue`,
    durationSec: 12,
    loginAs: 'Nancy',
    recordingStartSec: LOGIN_SKIP_SEC,
    actions: [
      { type: 'wait', waitAfterMs: 3000 },
      { type: 'scroll', value: 200, waitAfterMs: 2000 },
      { type: 'scroll', value: 0, waitAfterMs: 2000 },
    ],
  },

  // 5. Governance — Policy Library → Rule Engine → Agent Audit Trail (single continuous clip)
  {
    id: 'governance',
    label: 'Governance',
    targetUrl: `${APP_URL}/policy-library`,
    durationSec: 35,
    loginAs: 'Nancy',
    recordingStartSec: LOGIN_SKIP_SEC,
    skipInteraction: true,
    actions: [
      { type: 'wait', waitAfterMs: 5000 },                          // Policy Library visible
      { type: 'click', text: 'Rule Engine', waitAfterMs: 8000 },    // Medical Policy Enforcement Layer
      { type: 'click', text: 'Agent Audit Trail', waitAfterMs: 8000 },// Live AI Pipeline Control
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
  execSync(`"${ffmpeg}" -y -i "${webmPath}" -c:v libx264 -crf 23 -preset fast -an "${mp4Path}"`, { stdio: 'pipe' });
}

// ─── Record one clip ──────────────────────────────────────────────────────────

interface RecordedClip {
  id:               string;
  label:            string;
  targetUrl:        string;
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
      await page.goto(plan.targetUrl, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(2000);
    }
  } else {
    // No login — navigate directly
    await page.goto(plan.targetUrl, { waitUntil: 'networkidle', timeout: 20000 });
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
      recordingPath:  clip.videoPath,
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

  // ── B-roll problem scenes ───────────────────────────────────────────────────
  const brollDefs = [
    { sub: 'Manual PA reviews drown clinical staff in paperwork and phone calls.',         anim: 'data-stream'   },
    { sub: 'Incomplete submissions mean one in three PA requests is returned for more information.', anim: 'ticket-flood' },
    { sub: 'Payer policy mismatches spike denial rates and delay reimbursements.',         anim: 'alert-cascade' },
    { sub: 'Clinical evidence buried in PDFs and faxes is missed by manual reviewers.',   anim: 'multi-channel' },
    { sub: 'No pipeline visibility leaves revenue cycle teams unable to predict outcomes.',anim: 'kpi-metrics'   },
  ];

  const brollScenes = brollDefs.map((b, i) => ({
    id:              `broll-${i}`,
    from:            i * BROLL_FRAMES,
    durationInFrames: BROLL_FRAMES,
    subtitle:        b.sub,
    category:        'healthcare',
    animationType:   b.anim,
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
      title: 'Prior Auth AI — Value Adds',
      bullets: [
        {
          icon: 'accuracy',
          label: 'AI Clinical Extraction',
          description: 'NLP agents read unstructured clinical documents and extract diagnosis codes, procedures, symptoms, and lab results automatically.',
        },
        {
          icon: 'speed',
          label: 'Policy Matching Engine',
          description: 'Maps extracted clinical data against payer-specific policies and scores each case for completeness before submission.',
        },
        {
          icon: 'oversight',
          label: 'Authorization Queue',
          description: 'Only policy-ready cases reach the UM team — eliminating incomplete submissions and reducing payer denials.',
        },
        {
          icon: 'compliance',
          label: 'Role-Based Workflows',
          description: 'PA intake, UR nurses, medical reviewers, and compliance teams all work in one HIPAA-compliant platform with full audit trails.',
        },
        {
          icon: 'revenue',
          label: 'Agent Audit Trail',
          description: 'Full transparency into every AI decision supports compliance, governance, and appeals workflows.',
        },
      ],
    },
    presenterClose: {
      from: presenterFrom,
      durationInFrames: presenterFrames,
      tagline: 'every PA submission — complete, compliant, on time',
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
      productName:     'Prior Auth AI',
      targetAudience:  'healthcare payers, hospital billing teams, and revenue cycle managers',
      primaryBenefit:  'automate prior authorization from clinical intake to policy-ready submission',
      templateId:      'enterprise',
    },
  };
}

// ─── Build voice-script.json ──────────────────────────────────────────────────

function buildVoiceScript(clips: AnalyzedClip[], pkg: any): object {
  const brollCount = pkg.brollScenes.length;
  const brollSec   = (brollCount * BROLL_FRAMES) / FPS;

  // Broll voice segments (one per broll, starts 1.5s into each 6s broll)
  const brollSegments = [
    { id: 'broll-0', text: 'Prior auth teams are buried — manual reviews, fax queues, and phone calls consume hours every day.' },
    { id: 'broll-1', text: 'Incomplete submissions mean resubmissions. One in three PA requests bounces back for missing documentation.' },
    { id: 'broll-2', text: 'Payer policy mismatches drive denial rates up and delay patient care by days or even weeks.' },
    { id: 'broll-3', text: 'Critical clinical evidence — buried in unstructured PDFs — is routinely missed by manual reviewers.' },
    { id: 'broll-4', text: 'With no pipeline visibility, revenue cycle teams cannot predict outcomes or prevent revenue leakage.' },
  ].map((b, i) => ({
    id:          b.id,
    label:       `B-roll ${i + 1}`,
    startSec:    i * (BROLL_FRAMES / FPS) + 1.5,
    durationSec: 4.5,
    enabled:     true,
    text:        b.text,
  }));

  // Product scene segments
  const productSegments = clips.map((clip, idx) => {
    const scene = pkg.scenes[idx];
    const startSec = scene.from / FPS;
    return {
      id:          `scene-${idx + 1}`,
      label:       `Scene ${idx + 1} — ${clip.label}`,
      startSec,
      durationSec: clip.durationSec - 2,  // leave 2s tail silent
      enabled:     true,
      text:        clip.narration,
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
    text:        'Prior Auth AI delivers AI-powered clinical extraction — no more manual document review. ' +
                 'A policy matching engine eliminates incomplete submissions. ' +
                 'Role-based workflows keep PA intake, UR nursing, and medical review all in one platform. ' +
                 'And full agent audit trails support compliance, governance, and appeals.',
  };

  // Presenter close
  const closeStartSec = pkg.presenterClose.from / FPS;
  const closeSegment = {
    id:          'presenter-close',
    label:       'Presenter Close',
    startSec:    closeStartSec,
    durationSec: PRESENTER_SEC - 2,
    enabled:     true,
    text:        'every PA submission — complete, compliant, on time — Prior Auth AI. Contact us to arrange your live demonstration.',
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
        id: plan.id, label: plan.label, targetUrl: plan.targetUrl,
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
    // Hardcode the governance clip to avoid GPT seeing only the last section
    if (clip.id === 'governance') {
      analyzed.push({
        ...clip,
        featureTitle: 'Governance & Compliance',
        salesHook:    'Full policy control — from clinical rules to AI audit trails',
        narration:    'The Governance layer gives administrators complete control over clinical policy enforcement. ' +
                      'The Policy Library manages payer-specific coverage criteria. The Rule Engine defines deterministic clinical rules for auto-approvals and denials. ' +
                      'The Agent Audit Trail provides complete transparency into every AI decision — supporting compliance, appeals, and regulatory review.',
      });
      console.log(`  [${clip.id}]  hardcoded (governance multi-section)`);
      continue;
    }

    console.log(`  Analysing [${clip.id}]...`);
    const analysis = await analyzeFrame(clip.framePath);
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
