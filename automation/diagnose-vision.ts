#!/usr/bin/env node
/**
 * diagnose-vision.ts
 *
 * Fires ONE screenshot from the last E2E run through VisionAnalysisAgent and
 * prints the raw LLM response plus the parsed PageIntelligence.  Tells us
 * definitively whether the LLM is returning features or not.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json automation/diagnose-vision.ts
 */

import * as path   from 'path';
import * as dotenv from 'dotenv';
import * as fs     from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

import { AzureOpenAIProvider }    from '../src/infrastructure/llm/AzureOpenAIProvider';
import { VisionAnalysisAgent }    from '../src/agents/vision-analysis/VisionAnalysisAgent';
import { ScreenshotEncoder }      from '../src/agents/vision-analysis/ScreenshotEncoder';
import { ResponseParser }         from '../src/agents/vision-analysis/ResponseParser';
import { ScreenshotLoader }       from '../src/agents/screenshot/ScreenshotLoader';
import { loadPrompt }             from '../src/infrastructure/llm/PromptLoader';
import type { PageCapture }       from '../src/core/domain/entities/PageCapture';

// ── Pick the first screenshot available from the last E2E run ────────────────
const E2E_DIR    = path.resolve(__dirname, '../out/e2e-test/screenshots');
const pageIds    = fs.existsSync(E2E_DIR)
  ? fs.readdirSync(E2E_DIR).filter(d =>
      fs.statSync(path.join(E2E_DIR, d)).isDirectory()
    )
  : [];

if (pageIds.length === 0) {
  console.error('No screenshot directories found under out/e2e-test/screenshots.');
  console.error('Run the E2E pipeline first: npx ts-node --project tsconfig.scripts.json automation/e2e-test.ts');
  process.exit(1);
}

const pageId      = pageIds[0];
const viewportPath = path.join(E2E_DIR, pageId, 'viewport.png');
const fullPath     = path.join(E2E_DIR, pageId, 'full.png');

// ── Intercepting LLM wrapper ──────────────────────────────────────────────────
// We sub-class AzureOpenAIProvider so we can capture the raw text response
// before it reaches the ResponseParser.

let capturedResponse = '(no response yet)';

class LoggingProvider extends AzureOpenAIProvider {
  override async complete(
    messages: Parameters<AzureOpenAIProvider['complete']>[0],
    options:  Parameters<AzureOpenAIProvider['complete']>[1],
  ): Promise<string> {
    const raw = await super.complete(messages, options);
    capturedResponse = raw;
    return raw;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Vision Analysis Diagnostic');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Page ID       : ${pageId}`);
  console.log(`  Viewport path : ${viewportPath}`);
  console.log(`  Exists?       : ${fs.existsSync(viewportPath)}`);
  console.log('');

  const llm   = new LoggingProvider();
  const agent = new VisionAnalysisAgent(
    llm,
    loadPrompt('vision', 'analyze-page.v1'),
    loadPrompt('vision', 'analyze-dom-only.v1'),
    new ScreenshotEncoder(),
    new ResponseParser(),
    { concurrency: 1, retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0, jitter: false } },
    new ScreenshotLoader(),
  );

  // Build a minimal PageCapture pointing at the real screenshot files
  const capture: PageCapture = {
    pageId,
    screenshot: {
      fullPath:     fs.existsSync(fullPath)     ? fullPath     : null,
      viewportPath: fs.existsSync(viewportPath) ? viewportPath : null,
      encoding:     'png',
    },
    dom: {
      html:          '<html><body><h1>Test</h1></body></html>',
      title:         'OrangeHRM',
      url:           'https://opensource-demo.orangehrmlive.com',
      textContent:   'Dashboard HR Management',
      headings:      ['Dashboard', 'My Actions', 'Employee Distribution'],
      links:         [],
      formCount:     0,
      inputCount:    0,
      buttonCount:   2,
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
      htmlSizeBytes:           500,
      fullScreenshotBytes:     0,
      viewportScreenshotBytes: 0,
    },
  };

  console.log('  Calling VisionAnalysisAgent.analyzePage()...\n');
  const result = await agent.analyzePage(capture);

  // ── Print raw LLM response ────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════');
  console.log('  RAW LLM RESPONSE');
  console.log('═══════════════════════════════════════════════════════');
  console.log(capturedResponse);

  // ── Print parsed result ───────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  PARSED PageIntelligence');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  analysisMode  : ${result.analysisMode}`);
  console.log(`  pagePurpose   : ${result.pagePurpose}`);
  console.log(`  pageCategory  : ${result.pageCategory}`);
  console.log(`  features count: ${result.features.length}`);
  if (result.features.length > 0) {
    for (const f of result.features) {
      console.log(`    - ${f.featureName}  (score: ${f.importanceScore})`);
      console.log(`      ${f.businessValue}`);
    }
  } else {
    console.log('    ⚠  NO FEATURES — LLM returned an empty array or parsing failed.');
  }
  console.log(`  kpiWidgets    : ${result.kpiWidgets.length}`);
  console.log(`  importScore   : ${result.overallImportanceScore}`);
  console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
