/**
 * rebuild-enterprise-package.ts
 *
 * Rebuilds demo-package.json from ALL unique captures in the out/localhost/captures/
 * directory.  Uses Azure OpenAI GPT-4 vision to analyse screenshots that are not
 * already in the current demo-package.json, so every app section gets a scene with
 * proper AI-generated sales narration.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json automation/rebuild-enterprise-package.ts
 *
 * Output:
 *   out/localhost/demo-package.json  (overwritten with expanded scene list)
 */

import * as fs   from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { AzureOpenAI } from 'openai';
import 'dotenv/config';
import { OUT_DIR } from './config';

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const CAPTURES_DIR   = path.join(OUT_DIR, 'captures');
const PKG_PATH       = path.join(OUT_DIR, 'demo-package.json');
const PROPS_PATH     = path.join(OUT_DIR, 'demo-props.json');

const TARGET_SCENES  = 15;   // desired number of product scenes
const MIN_SIZE_KB    = 200;  // skip near-empty captures below this threshold
const MAX_SIZE_KB    = 3000; // skip clearly-identical large captures above this threshold

const BROLL_SEC      = 6;
const PRODUCT_MAX_SEC = 10;
const BENEFIT_SEC    = 18;
const PRESENTER_SEC  = 16;
const FPS            = 30;

// ─────────────────────────────────────────────────────────────────────────────
// Azure OpenAI client
// ─────────────────────────────────────────────────────────────────────────────

const azureClient = new AzureOpenAI({
  apiKey:     process.env['AZURE_OPENAI_API_KEY']    ?? '',
  endpoint:   process.env['AZURE_OPENAI_ENDPOINT']   ?? '',
  deployment: process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
  apiVersion: process.env['OPENAI_API_VERSION']      ?? '2024-12-01-preview',
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function log(msg: string) { console.log(`  ${msg}`); }

interface CaptureInfo {
  id:       string;
  sizeKB:   number;
  vpPath:   string;  // relative path for JSON output
  absPath:  string;  // absolute path for reading
}

function loadCaptures(): CaptureInfo[] {
  return fs.readdirSync(CAPTURES_DIR)
    .filter(name => fs.statSync(path.join(CAPTURES_DIR, name)).isDirectory())
    .map(id => {
      const absPath = path.join(CAPTURES_DIR, id, 'viewport.png');
      if (!fs.existsSync(absPath)) return null;
      const sizeKB = Math.round(fs.statSync(absPath).size / 1024);
      return { id, sizeKB, vpPath: `captures/${id}/viewport.png`, absPath };
    })
    .filter((c): c is CaptureInfo => c !== null);
}

/** Pick one representative per content-size bucket to avoid showing identical pages */
function deduplicateBySize(captures: CaptureInfo[]): CaptureInfo[] {
  const seenSizes = new Map<number, CaptureInfo>();
  for (const c of captures) {
    const bucket = Math.round(c.sizeKB / 5) * 5; // 5 KB buckets
    if (!seenSizes.has(bucket)) seenSizes.set(bucket, c);
  }
  return Array.from(seenSizes.values());
}

/** Keep only captures in the interesting size range (not blank, not all-same-mega-page) */
function filterBySize(captures: CaptureInfo[]): CaptureInfo[] {
  return captures.filter(c => c.sizeKB >= MIN_SIZE_KB && c.sizeKB <= MAX_SIZE_KB);
}

async function analyzeScreenshot(absPath: string): Promise<{
  featureTitle: string;
  salesHook:    string;
  narration:    string;
  elementType:  string;
}> {
  const imgData  = fs.readFileSync(absPath);
  const b64      = imgData.toString('base64');
  const mimeType = 'image/png';

  const response = await azureClient.chat.completions.create({
    model:      process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
    max_tokens: 400,
    messages: [
      {
        role:    'system',
        content: `You are a B2B SaaS demo video script writer. Given a product screenshot,
output a JSON object (no markdown fences) with exactly these fields:
{
  "featureTitle": "short 2-4 word feature name",
  "salesHook": "compelling 6-10 word hook focusing on the business value visible in the screenshot",
  "narration": "one paragraph (2-3 sentences, ~25 words) that explains what this feature does and why it matters for the business",
  "elementType": "dashboard|table|chart|map|form|list|kpi|settings|other"
}
Be specific to the UI shown. No generic statements.`,
      },
      {
        role:    'user',
        content: [
          {
            type:      'image_url',
            image_url: { url: `data:${mimeType};base64,${b64}`, detail: 'low' },
          },
          { type: 'text', text: 'Analyse this product screenshot and return the JSON.' },
        ],
      },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? '{}';
  try {
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, ''));
    return {
      featureTitle: parsed.featureTitle ?? 'Platform Feature',
      salesHook:    parsed.salesHook    ?? 'Streamline your workflow instantly.',
      narration:    parsed.narration    ?? 'This feature improves operational efficiency across your team.',
      elementType:  parsed.elementType  ?? 'dashboard',
    };
  } catch {
    return {
      featureTitle: 'Platform Feature',
      salesHook:    'Streamline your workflow instantly.',
      narration:    'This feature improves operational efficiency across your team.',
      elementType:  'dashboard',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Enterprise Package Rebuild — AI Vision Analysis');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load existing packages to reuse already-good AI content
  const existingPkg   = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
  const existingProps = fs.existsSync(PROPS_PATH)
    ? JSON.parse(fs.readFileSync(PROPS_PATH, 'utf-8'))
    : null;

  // Build a map of screenshotPath → existing scene data (preserves AI narration)
  const existingMap = new Map<string, any>();
  for (const scene of (existingPkg.scenes ?? [])) {
    if (scene.screenshotPath) existingMap.set(scene.screenshotPath, scene);
  }
  if (existingProps) {
    for (const scene of (existingProps.scenes ?? [])) {
      if (scene.screenshotPath) existingMap.set(scene.screenshotPath, scene);
    }
  }
  log(`Existing scenes with AI content: ${existingMap.size}`);

  // Discover and filter captures
  const allCaptures  = loadCaptures();
  log(`Total captures on disk: ${allCaptures.length}`);

  const filtered     = filterBySize(allCaptures);
  log(`After size filter (${MIN_SIZE_KB}-${MAX_SIZE_KB} KB): ${filtered.length}`);

  const deduped      = deduplicateBySize(filtered);
  log(`After near-duplicate removal: ${deduped.length}`);

  // Sort by size desc (richer pages first), then take target count
  const sorted = [...deduped].sort((a, b) => b.sizeKB - a.sizeKB);
  const selected = sorted.slice(0, TARGET_SCENES);
  log(`Selected ${selected.length} captures for video\n`);

  // For each selected capture: reuse existing AI content or call vision API
  const scenes: any[] = [];
  let sceneIndex = 1;

  for (const capture of selected) {
    const existing = existingMap.get(capture.vpPath);
    if (existing) {
      log(`[scene-${sceneIndex}]  ♻  Reusing existing AI content for ${capture.id.substring(0, 8)} (${capture.sizeKB} KB)`);
      scenes.push({ ...existing, id: `scene-${sceneIndex}`, screenshotPath: capture.vpPath });
    } else {
      log(`[scene-${sceneIndex}]  🔍  Analysing ${capture.id.substring(0, 8)} (${capture.sizeKB} KB) via GPT-4 vision...`);
      const analysis = await analyzeScreenshot(capture.absPath);
      log(`       → "${analysis.featureTitle}" | "${analysis.salesHook.substring(0, 40)}..."`);
      scenes.push({
        id:               `scene-${sceneIndex}`,
        pageId:           capture.id,
        title:            analysis.featureTitle,
        narration:        analysis.narration,
        salesHook:        analysis.salesHook,
        description:      analysis.narration,
        screenshotPath:   capture.vpPath,
        fullScreenshotPath: `captures/${capture.id}/full.png`,
        highlightTarget:  { elementType: analysis.elementType, region: 'center', description: analysis.featureTitle },
        transition:       sceneIndex < selected.length ? { type: 'slide-left', durationInFrames: 12 } : null,
        nodeType:         '',
      });
    }
    sceneIndex++;
  }

  console.log(`\n  Building enterprise package with ${scenes.length} scenes...`);

  // Re-calculate frame positions
  const brollScenes: any[]  = existingPkg.brollScenes   ?? [];
  const benefitSlide: any   = existingPkg.benefitSlide  ?? {};
  const presenterClose: any = existingPkg.presenterClose ?? {};
  const presenterConfig: any = existingPkg.presenterConfig ?? {};

  const brollTotalFrames = (brollScenes.length || 3) * BROLL_SEC * FPS;
  let cursor = brollTotalFrames;

  const positionedScenes = scenes.map(scene => {
    const dur  = PRODUCT_MAX_SEC * FPS;
    const from = cursor;
    cursor += dur;
    return { ...scene, from, durationInFrames: dur };
  });

  const benefitSlideFrom     = cursor;
  const presenterCloseFrom   = benefitSlideFrom + BENEFIT_SEC * FPS;
  const totalFrames          = presenterCloseFrom + PRESENTER_SEC * FPS;

  const newPkg = {
    ...existingPkg,
    composition: {
      ...existingPkg.composition,
      id:               'EnterpriseVideo',
      durationInFrames: totalFrames,
    },
    scenes: positionedScenes,
    brollScenes,
    benefitSlide:   { ...benefitSlide,   from: benefitSlideFrom,   durationInFrames: BENEFIT_SEC * FPS },
    presenterClose: { ...presenterClose, from: presenterCloseFrom, durationInFrames: PRESENTER_SEC * FPS },
    presenterConfig,
    meta:           { ...existingPkg.meta, templateId: 'enterprise' },
  };

  fs.writeFileSync(PKG_PATH, JSON.stringify(newPkg, null, 2), 'utf-8');

  const totalSec = Math.round(totalFrames / FPS);
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  ✅  Done!');
  console.log(`\n     Scenes    : ${positionedScenes.length}`);
  console.log(`     Duration  : ${totalSec}s  (${Math.round(totalSec / 60)}m ${totalSec % 60}s)`);
  console.log(`     Output    : ${PKG_PATH}`);
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(err => { console.error(err); process.exit(1); });
