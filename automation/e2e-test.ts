#!/usr/bin/env node
/**
 * e2e-test.ts  —  Full end-to-end pipeline test against a live SaaS application.
 *
 * Runs all 8 pipeline stages:
 *   Auth → Discovery → Graph → Screenshot+Vision → Feature Ranking
 *   → Journey → Storyboard → Remotion Export → demo-package.json
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json automation/e2e-test.ts
 *
 * Required env vars (loaded from .env):
 *   AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT,
 *   OPENAI_API_VERSION
 */

import * as path   from 'path';
import * as dotenv from 'dotenv';

// Load .env BEFORE any other import that reads process.env
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

// ── Pipeline wiring ──────────────────────────────────────────────────────────
import { WorkflowOrchestrator }    from '../src/application/pipeline/WorkflowOrchestrator';
import { createScreenshotAgent }   from '../src/agents/screenshot';
import { createVisionAnalysisAgent } from '../src/agents/vision-analysis';
import { createBusinessValueAgent } from '../src/agents/business-value';
import { ContextExpansionAgent }   from '../src/agents/context';
import { AzureOpenAIProvider }     from '../src/infrastructure/llm/AzureOpenAIProvider';
import { loadPrompt }              from '../src/infrastructure/llm/PromptLoader';
import type { ProgressEvent }      from '../src/application/pipeline/PipelineStage';
import type { RunInput }           from '../src/application/pipeline/PipelineContext';

// ── Target  (read from .env — fall back to OrangeHRM demo for testing) ───────

const TARGET_URL  = process.env['APP_URL']      ?? 'https://opensource-demo.orangehrmlive.com';
const USERNAME    = process.env['APP_USERNAME'] ?? 'Admin';
const PASSWORD    = process.env['APP_PASSWORD'] ?? 'admin123';

/** True when TARGET_URL points at a loopback / local dev server. */
function isLocalUrl(u: string): boolean {
  try {
    const { hostname } = new URL(u);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}
const ALLOW_LOCAL = isLocalUrl(TARGET_URL);

// ── Demo video metadata (optional — set in .env to customise the narration) ──

const PRODUCT_NAME    = process.env['APP_PRODUCT_NAME']    ?? 'the Platform';
const TARGET_AUDIENCE = process.env['APP_TARGET_AUDIENCE'] ?? 'your team';
const PRIMARY_BENEFIT = process.env['APP_PRIMARY_BENEFIT'] ?? 'save time and make better decisions';
const CALL_TO_ACTION  = process.env['APP_CALL_TO_ACTION']  ?? 'Schedule a live demo today';

// ── Video Template (enterprise | modern_saas) — read from .env VIDEO_TEMPLATE
const _videoTemplateRaw = process.env['VIDEO_TEMPLATE'];
const VIDEO_TEMPLATE: 'modern_saas' | 'enterprise' | undefined =
  _videoTemplateRaw === 'enterprise' || _videoTemplateRaw === 'modern_saas'
    ? _videoTemplateRaw
    : undefined;

// ── Application context (optional — 1-5 sentences about the app and audience)
// When provided, expands into structured business context that boosts feature
// ranking and personalises narration.  Leave blank / unset to skip entirely.
const APP_CONTEXT_TEXT = process.env['APP_CONTEXT_TEXT']?.trim() ?? '';

// ── Seed URLs — explicit SPA routes to add to the discovery BFS queue ────────
// Read from APP_SEED_ROUTES (comma-separated relative paths), OR auto-detect
// from APP_URL if it matches known local dev patterns.  These ensure every
// major section of the app is captured even when the sidebar uses JS-driven
// navigation that the BFS crawler cannot extract as <a href> links.
function buildSeedUrls(baseUrl: string): string[] {
  const raw = process.env['APP_SEED_ROUTES']?.trim();
  if (raw) {
    return raw.split(',').map(r => r.trim()).filter(Boolean);
  }
  // Auto-seed known routes when targeting the local app
  if (isLocalUrl(baseUrl)) {
    return [
      '/dashboard',
      '/sites',
      '/alarms',
      '/devices',
      '/insights',
      '/ai-predict',
      '/simulator',
      '/users',
      '/settings',
    ];
  }
  return [];
}
const SEED_URLS = buildSeedUrls(TARGET_URL);

// Output lives alongside existing runs; name is derived from the host so
// re-running the same target always overwrites the previous artefacts.
const _host      = new URL(TARGET_URL).hostname.replace(/[^a-zA-Z0-9]/g, '-');
const OUTPUT_DIR = path.resolve(__dirname, `../out/${_host}`);

// ── Display helpers ───────────────────────────────────────────────────────────

const BAR_WIDTH = 30;
const SEP = '═'.repeat(63);

function bar(pct: number): string {
  const filled = Math.min(BAR_WIDTH, Math.round(pct / 100 * BAR_WIDTH));
  return `[${'█'.repeat(filled)}${' '.repeat(BAR_WIDTH - filled)}]`;
}

function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function printEvent(ev: ProgressEvent): void {
  const pct  = String(Math.round(ev.progress)).padStart(3);
  const tag  = ev.stageName.padEnd(28);
  const msg  = ev.message ?? '';
  const icon = ev.type === 'stage:complete' ? '✓'
             : ev.type === 'stage:error'    ? '✗'
             : ev.type === 'stage:start'    ? '▶'
             : ev.type === 'pipeline:complete' ? '🎉'
             : '·';
  console.log(`  ${icon}  ${pct}% ${bar(ev.progress)} ${tag}  ${msg}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n${SEP}`);
  console.log('  🚀  End-to-End Pipeline  →  Demo Video Generator');
  console.log(`      Target   : ${TARGET_URL}`);
  console.log(`      Product  : ${PRODUCT_NAME}`);
  console.log(`      Audience : ${TARGET_AUDIENCE}`);
  console.log(`      Benefit  : ${PRIMARY_BENEFIT}`);
  if (APP_CONTEXT_TEXT) {
    console.log(`      Context  : ${APP_CONTEXT_TEXT.slice(0, 80)}${APP_CONTEXT_TEXT.length > 80 ? '…' : ''}`);
  }
  console.log(`      Template : ${VIDEO_TEMPLATE ?? 'modern_saas (default)'}`);
  console.log(`      Out      : ${OUTPUT_DIR}`);
  console.log(SEP);

  // ── LLM ────────────────────────────────────────────────────────────────────
  let llmProvider: AzureOpenAIProvider;
  try {
    llmProvider = new AzureOpenAIProvider();
  } catch (err) {
    console.error('\n  ✗  Azure OpenAI credentials missing from .env');
    console.error(`     ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  console.log(`\n  LLM  : ${llmProvider.modelId}  (Azure OpenAI)`);
  console.log(`  Pages: max 10, depth 2\n`);

  // ── Agents ─────────────────────────────────────────────────────────────────
  // RF7: screenshotAgent writes PNGs directly to outputDir — no Buffers held.
  const screenshotAgent     = createScreenshotAgent({ outputDir: OUTPUT_DIR });
  const visionAgent         = createVisionAnalysisAgent(llmProvider);
  const businessValueAgent  = createBusinessValueAgent(llmProvider, {
    productName:    PRODUCT_NAME,
    targetAudience: TARGET_AUDIENCE,
  });

  // Context expansion agent — only instantiated when contextText is present;
  // otherwise the orchestrator's 4th arg is undefined and context is skipped.
  const contextAgent = APP_CONTEXT_TEXT
    ? new ContextExpansionAgent(llmProvider, loadPrompt('context', 'expand-context.v1'))
    : undefined;

  const orchestrator = new WorkflowOrchestrator(
    screenshotAgent, visionAgent, businessValueAgent, contextAgent,
  );

  // ── Run input ───────────────────────────────────────────────────────────────
  const input: RunInput = {
    url:         TARGET_URL,
    username:    USERNAME,
    password:    PASSWORD,
    outputDir:   OUTPUT_DIR,
    contextText: APP_CONTEXT_TEXT || undefined,   // omit empty string → isPresent() stays false
    options: {
      maxDepth:             3,
      maxPages:             20,
      targetJourneySteps:   12,
      headless:             true,
      productName:          PRODUCT_NAME,
      targetAudience:       TARGET_AUDIENCE,
      primaryBenefit:       PRIMARY_BENEFIT,
      callToAction:         CALL_TO_ACTION,
      allowLocalUrls:       ALLOW_LOCAL,
      seedUrls:             SEED_URLS,
      // 2× device pixel ratio → 3840×2160 physical screenshots.
      // Keeps product window crisp at camera zoom ≤2× (Phase 2+).
      // Set to 1 to halve disk usage when zoom is not needed.
      screenshotScale: 2,
      // Explicit template — also resolved via VIDEO_TEMPLATE env var in each stage,
      // but passing it here makes the choice visible in logs and pipeline context.
      ...(VIDEO_TEMPLATE ? { videoTemplate: VIDEO_TEMPLATE } : {}),
    },
  };

  // ── Execute ─────────────────────────────────────────────────────────────────

  // Intercept business value agent to log enrichment stats.
  const originalEnrich = businessValueAgent.enrich.bind(businessValueAgent);
  (businessValueAgent as any).enrich = async (features: any[]) => {
    const result = await originalEnrich(features);
    console.log(
      `\n  [debug] businessValue: enriched ${result.totalEnriched}/${result.totalSubmitted} ` +
      `(${result.totalSubmitted - result.totalEnriched} fallback)`,
    );
    for (const out of result.outputs) {
      const icon = out.source === 'llm' ? '✓' : '·';
      console.log(`    ${icon}  ${out.featureName.slice(0, 40).padEnd(40)}  ${out.source}`);
    }
    console.log('');
    return result;
  };

  // Intercept captureAll to log per-page capture status and any errors.
  const originalCaptureAll = screenshotAgent.captureAll.bind(screenshotAgent);
  (screenshotAgent as any).captureAll = async (pages: any[], context: any) => {
    const captures = await originalCaptureAll(pages, context);
    console.log(`\n  [debug] captureAll returned ${captures.length} PageCapture records:`);
    for (const c of captures) {
      const vp = c.screenshot.viewportPath ? '✓viewport' : '✗viewport';
      const fp = c.screenshot.fullPath     ? '✓full'     : '✗full';
      const errs = c.metadata.errors.map((e: any) => `${e.type}: ${e.message.slice(0, 60)}`).join(' | ');
      console.log(`    ${c.pageId.slice(0, 8)}…  status=${c.metadata.status}  ${vp}  ${fp}${errs ? '  ERR: ' + errs : ''}`);
    }
    console.log('');
    return captures;
  };

  // Intercept analyzeAll to log per-page feature counts and analysis mode.
  const originalAnalyzeAll = visionAgent.analyzeAll.bind(visionAgent);
  (visionAgent as any).analyzeAll = async (captures: any[]) => {
    const results = await originalAnalyzeAll(captures);
    console.log(`  [debug] analyzeAll returned ${results.length} PageIntelligence records:`);
    let totalFeatures = 0;
    for (const pi of results) {
      console.log(`    ${pi.features.length > 0 ? '✓' : '✗'}  ${pi.pageId.slice(0, 8)}…  mode=${pi.analysisMode}  features=${pi.features.length}`);
      totalFeatures += pi.features.length;
    }
    console.log(`    Total features: ${totalFeatures}\n`);
    return results;
  };

  const wallStart = Date.now();
  const run = await orchestrator.run(input, printEvent);
  const wallMs = Date.now() - wallStart;

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n${SEP}`);
  console.log('  Pipeline Summary');
  console.log(SEP);
  const statusIcon = run.status === 'completed' ? '✓' : '✗';
  console.log(`  ${statusIcon}  Status           ${run.status}`);
  console.log(`     Wall time        ${fmtMs(wallMs)}`);
  console.log(`     Pages found      ${run.pagesDiscovered ?? 0}`);
  console.log(`     Features ranked  ${run.featuresRanked  ?? 0}`);
  console.log(`     Scenes           ${run.sceneCount      ?? 0}`);
  if (run.outputPath) {
    console.log(`     Output           ${run.outputPath}`);
  }

  if (run.stages.length > 0) {
    console.log('\n  Stage timings:');
    for (const s of run.stages) {
      const tick = s.status === 'success' ? '✓' : '✗';
      const dur  = s.durationMs != null ? fmtMs(s.durationMs) : '—';
      const err  = s.error ? `  ← ${s.error.slice(0, 80)}` : '';
      console.log(`    ${tick}  ${s.stageName.padEnd(28)}  ${dur}${err}`);
    }
  }

  console.log(`\n${SEP}\n`);
  process.exit(run.status === 'completed' ? 0 : 1);
}

main().catch(err => {
  console.error('\n  Fatal error:', err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) {
    console.error(err.stack.split('\n').slice(1).join('\n'));
  }
  process.exit(1);
});
