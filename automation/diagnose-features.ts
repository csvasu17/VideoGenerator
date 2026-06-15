#!/usr/bin/env node
/**
 * diagnose-features.ts
 *
 * Re-runs VisionAnalysisAgent.analyzeAll on all 10 existing E2E screenshots
 * and prints per-page feature counts + any errors.
 * This tells us whether features are coming back from the LLM AND whether
 * extractFeatures() in FeatureRankingStage would produce anything.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json automation/diagnose-features.ts
 */

import * as path   from 'path';
import * as dotenv from 'dotenv';
import * as fs     from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

import { AzureOpenAIProvider }    from '../src/infrastructure/llm/AzureOpenAIProvider';
import { createVisionAnalysisAgent } from '../src/agents/vision-analysis';
import { FeatureRankingStage }    from '../src/application/pipeline/stages/FeatureRankingStage';
import type { PageCapture }       from '../src/core/domain/entities/PageCapture';

// ── Build fake PageCaptures from the existing E2E screenshots ─────────────────

const E2E_DIR = path.resolve(__dirname, '../out/e2e-test/screenshots');

if (!fs.existsSync(E2E_DIR)) {
  console.error('No screenshots found. Run automation/e2e-test.ts first.');
  process.exit(1);
}

const pageIds = fs.readdirSync(E2E_DIR).filter(d =>
  fs.statSync(path.join(E2E_DIR, d)).isDirectory()
);

if (pageIds.length === 0) {
  console.error('No page subdirectories found under', E2E_DIR);
  process.exit(1);
}

function makeCapture(pageId: string): PageCapture {
  const dir          = path.join(E2E_DIR, pageId);
  const viewportPath = path.join(dir, 'viewport.png');
  const fullPath     = path.join(dir, 'full.png');
  return {
    pageId,
    screenshot: {
      viewportPath: fs.existsSync(viewportPath) ? viewportPath : null,
      fullPath:     fs.existsSync(fullPath)     ? fullPath     : null,
      encoding:     'png',
    },
    dom: {
      html:          '',
      title:         'OrangeHRM',
      url:           'https://opensource-demo.orangehrmlive.com',
      textContent:   'OrangeHRM HR management system dashboard employee management',
      headings:      ['Dashboard', 'Employee Management', 'Leave', 'Performance'],
      links:         [],
      formCount:     0,
      inputCount:    2,
      buttonCount:   4,
      imageCount:    1,
      ariaLandmarks: ['navigation', 'main'],
    },
    metadata: {
      capturedAt:              new Date().toISOString(),
      durationMs:              0,
      status:                  'success',
      errors:                  [],
      viewportWidth:           1280,
      viewportHeight:          720,
      pageTitle:               'OrangeHRM',
      finalUrl:                'https://opensource-demo.orangehrmlive.com',
      htmlSizeBytes:           100,
      fullScreenshotBytes:     100_000,
      viewportScreenshotBytes: 50_000,
    },
  };
}

const SEP = '─'.repeat(60);

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Feature Extraction Diagnostic (all', pageIds.length, 'pages)');
  console.log('═══════════════════════════════════════════════════════════\n');

  const llm         = new AzureOpenAIProvider();
  const visionAgent = createVisionAnalysisAgent(llm);
  const captures    = pageIds.map(makeCapture);

  console.log('  Running analyzeAll() — this will call the LLM for each page...\n');
  const intelligences = await visionAgent.analyzeAll(captures);

  let totalFeatures = 0;

  console.log(SEP);
  for (let i = 0; i < intelligences.length; i++) {
    const pi = intelligences[i];
    totalFeatures += pi.features.length;
    const icon = pi.features.length > 0 ? '✓' : '✗';
    console.log(`${icon}  Page ${String(i + 1).padStart(2)}  ${pi.pageId.slice(0, 8)}…`);
    console.log(`       mode     : ${pi.analysisMode}`);
    console.log(`       purpose  : ${pi.pagePurpose.slice(0, 80)}`);
    console.log(`       category : ${pi.pageCategory}`);
    console.log(`       features : ${pi.features.length}`);
    for (const f of pi.features) {
      console.log(`         · ${f.featureName}  (score: ${f.importanceScore})`);
    }
    if (pi.features.length === 0 && pi.pagePurpose.startsWith('Analysis failed')) {
      console.log(`       ⚠  FALLBACK — LLM error: ${pi.pagePurpose}`);
    }
    console.log(SEP);
  }

  console.log(`\n  Total features extracted : ${totalFeatures}`);

  // ── Now run FeatureRankingStage on the same data ──────────────────────────
  console.log('\n  Running FeatureRankingStage...');
  const stage   = new FeatureRankingStage();
  const ranked  = await stage.run(intelligences, {} as any);

  console.log(`  Prioritized features     : ${ranked.length}`);
  for (const pf of ranked.slice(0, 5)) {
    console.log(`    ${pf.rank}. ${pf.feature.name.padEnd(35)} composite: ${pf.composite}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch(err => {
  console.error('\n  Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
