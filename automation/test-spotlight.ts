/**
 * Smoke-test for Phase 3: spotlight target wiring.
 * Exercises the RemotionExporter's buildSpotlightTarget logic by calling it
 * through the public export() API with mocked inputs.
 *
 * Run: npx ts-node --project tsconfig.scripts.json automation/test-spotlight.ts
 */

import { RemotionExporter } from '../src/agents/remotion/RemotionExporter';
import type { Storyboard, Scene } from '../src/core/domain/entities/Storyboard';
import type { PageCapture }       from '../src/core/domain/entities/PageCapture';
import type { PageIntelligence }  from '../src/core/domain/entities/PageIntelligence';

// ── Minimal mock helpers ──────────────────────────────────────────────────────

function makeScene(
  pageId: string,
  elementType: Scene['highlightTarget']['elementType'],
  region:      Scene['highlightTarget']['region'],
): Scene {
  return {
    sceneNumber:     1,
    pageId,
    title:           'Test Page',
    description:     'desc',
    narration:       'narration',
    salesHook:       'hook',
    highlightTarget: { elementType, region, description: `${elementType} on ${region}` },
    durationSec:     11,
  };
}

function makeCapture(pageId: string): PageCapture {
  return {
    pageId,
    screenshot: { viewportPath: null, fullPath: null, encoding: 'png' },
    dom: {
      html: '', title: '', url: '', textContent: '', headings: [],
      links: [], formCount: 0, inputCount: 0, buttonCount: 0,
      imageCount: 0, ariaLandmarks: [],
    },
    metadata: {
      capturedAt: new Date().toISOString(), durationMs: 0, status: 'success',
      errors: [], viewportWidth: 1920, viewportHeight: 1080, pageTitle: '',
      finalUrl: '', htmlSizeBytes: 0, fullScreenshotBytes: 0, viewportScreenshotBytes: 0,
    },
  };
}

function makeIntelligence(
  pageId: string,
  overallScore: number,
  bbox?: { x: number; y: number; width: number; height: number },
): PageIntelligence {
  return {
    pageId,
    analysedAt:             new Date().toISOString(),
    pagePurpose:            'Test',
    pageCategory:           'dashboard',
    features:               [],
    importantActions:       [],
    businessContext:        '',
    kpiWidgets:             [],
    overallImportanceScore: overallScore,
    analysisMode:           'vision',
    ...(bbox ? { primaryElementBoundingBox: bbox } : {}),
  };
}

// ── Build a minimal storyboard ────────────────────────────────────────────────

function makeStoryboard(scenes: Scene[]): Storyboard {
  return {
    id:                  'sb-test',
    journeyId:           'jrn-test',
    title:               'Test',
    openingTitle:        'Opening',
    closingCallToAction: 'CTA',
    totalScenes:         scenes.length,
    totalDurationSec:    scenes.reduce((s, c) => s + c.durationSec, 0),
    scenes,
    generatedAt:         new Date().toISOString(),
  };
}

// ── Export helper (write to temp dir) ────────────────────────────────────────

import * as os from 'os';
import * as path from 'path';

async function runExport(
  scenes:      Scene[],
  captures:    PageCapture[],
  intelligence?: PageIntelligence[],
) {
  const exporter = new RemotionExporter();
  const storyboard = makeStoryboard(scenes);
  const outputDir  = path.join(os.tmpdir(), `test-spotlight-${Date.now()}`);

  const result = await exporter.export({
    storyboard,
    captures,
    outputDir,
    meta: { productName: 'Test', targetAudience: 'QA', primaryBenefit: 'speed' },
    intelligence,
  });

  return result.package.scenes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test cases
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  let pass = 0;
  let fail = 0;

  function check(label: string, ok: boolean, detail?: string) {
    if (ok) {
      console.log(`  ✓ PASS  ${label}`);
      pass++;
    } else {
      console.log(`  ✗ FAIL  ${label}${detail ? `  (${detail})` : ''}`);
      fail++;
    }
  }

  // ── (a) full-page highlight → no spotlightTarget (Ken-Burns) ─────────────
  console.log('\n=== (a) full-page → no spotlight (Ken-Burns expected) ===');
  {
    const scenes = [makeScene('pg-a', 'full-page', 'full')];
    const pkgScenes = await runExport(scenes, [makeCapture('pg-a')]);
    check(
      'spotlightTarget is undefined',
      pkgScenes[0].spotlightTarget === undefined,
    );
  }

  // ── (b) kpi + no intelligence → elementType='kpi_card', region bbox ──────
  console.log('\n=== (b) kpi, top-right, no intelligence → region bbox ===');
  {
    const scenes = [makeScene('pg-b', 'kpi', 'top-right')];
    const pkgScenes = await runExport(scenes, [makeCapture('pg-b')]);
    const st = pkgScenes[0].spotlightTarget;
    check('elementType = kpi_card',    st?.elementType === 'kpi_card');
    check('priority = 0.5 (fallback)', st?.priority    === 0.5);
    check('bbox.x ≈ 0.60 (top-right)', Math.abs((st?.boundingBox?.x ?? -1) - 0.60) < 0.01);
    check('label present',             typeof st?.label === 'string' && st.label.length > 0);
  }

  // ── (c) chart + intelligence bbox → LLM bbox wins ────────────────────────
  console.log('\n=== (c) chart, LLM bbox from intelligence (expected to win) ===');
  {
    const scenes      = [makeScene('pg-c', 'chart', 'center')];
    const captures    = [makeCapture('pg-c')];
    const intelligence = [makeIntelligence('pg-c', 82, { x: 0.10, y: 0.18, width: 0.55, height: 0.40 })];
    const pkgScenes   = await runExport(scenes, captures, intelligence);
    const st = pkgScenes[0].spotlightTarget;
    check('elementType = chart',       st?.elementType   === 'chart');
    check('priority = 0.82',           Math.abs((st?.priority ?? 0) - 0.82) < 0.01);
    check('bbox.x = 0.10 (LLM wins)',  st?.boundingBox?.x === 0.10);
    check('bbox.y = 0.18 (LLM wins)',  st?.boundingBox?.y === 0.18);
    check('bbox.width = 0.55',         st?.boundingBox?.width  === 0.55);
    check('bbox.height = 0.40',        st?.boundingBox?.height === 0.40);
  }

  // ── (d) navigation + no bbox in intelligence → falls back to region ───────
  console.log('\n=== (d) navigation, top-left, intelligence but no bbox ===');
  {
    const scenes       = [makeScene('pg-d', 'navigation', 'top-left')];
    const captures     = [makeCapture('pg-d')];
    const intelligence = [makeIntelligence('pg-d', 55)]; // no bbox
    const pkgScenes    = await runExport(scenes, captures, intelligence);
    const st = pkgScenes[0].spotlightTarget;
    check('elementType = navigation',  st?.elementType === 'navigation');
    check('priority = 0.55',           Math.abs((st?.priority ?? 0) - 0.55) < 0.01);
    check('bbox.x ≈ 0.02 (top-left)',  Math.abs((st?.boundingBox?.x ?? -1) - 0.02) < 0.01);
  }

  // ── (e) button + bottom region ────────────────────────────────────────────
  console.log('\n=== (e) button, bottom, high importance ===');
  {
    const scenes       = [makeScene('pg-e', 'button', 'bottom')];
    const intelligence = [makeIntelligence('pg-e', 100)];
    const pkgScenes    = await runExport(scenes, [makeCapture('pg-e')], intelligence);
    const st = pkgScenes[0].spotlightTarget;
    check('elementType = button',      st?.elementType === 'button');
    check('priority = 1.0',            st?.priority    === 1.0);
    check('bbox.y ≈ 0.62 (bottom)',    Math.abs((st?.boundingBox?.y ?? -1) - 0.62) < 0.01);
  }

  // ── (f) modal → default → no spotlight ───────────────────────────────────
  console.log('\n=== (f) modal → mapped to default → no spotlight ===');
  {
    const scenes   = [makeScene('pg-f', 'modal', 'center')];
    const pkgScenes = await runExport(scenes, [makeCapture('pg-f')]);
    check('spotlightTarget is undefined (modal→default)', pkgScenes[0].spotlightTarget === undefined);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(52)}`);
  console.log(`  ${pass}/${pass + fail} tests passed`);
  if (fail > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
