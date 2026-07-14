/**
 * record-appflow-map.ts — Full Application Flow pipeline
 *
 * Crawls the ENTIRE target app (BFS, SPA-router aware, via the shared
 * DiscoveryAgent already used by the modern_saas pipeline), extracts every
 * screen's individual data fields (form inputs + resolved labels, <select>
 * options, <table> column headers), lays out the resulting tree as a sitemap
 * diagram, and writes demo-package.json (+ voice-script.json) for the
 * AppFlowVideo Remotion composition.
 *
 * Unlike record-app-clips.ts / record-teaser-clips.ts, this template is not a
 * screen-recording montage — it's a structural map. DiscoveryAgent and
 * NodeClassifier (shared with the modern_saas pipeline) are used as black
 * boxes and never modified; all new logic lives in this file and in
 * automation/utils/fieldExtractor.ts + automation/utils/treeLayout.ts.
 *
 * Sub-screen hierarchy comes from DiscoveredPage.parentPageId (which page a
 * link was discovered from during the real crawl), NOT from URL path
 * segments — many real apps (including the one currently configured in
 * .env) use flat, single-segment routes, so a URL-hierarchy heuristic would
 * find zero parent-child relationships.
 *
 * All parameters read from .env:
 *   APP_URL, APP_PRODUCT_NAME, LOGIN_TYPE, APP_USERNAME/APP_PASSWORD,
 *   APP_QUICK_ACCESS_INDEX
 *   APP_ROUTE_MAP        — seeds the BFS (DiscoveryOptions.seedUrls) so
 *                          JS-only nav routes aren't missed — DiscoveryAgent
 *                          only follows real <a href>/SPA-router links, it
 *                          does not click nav items with no href.
 *   APP_FLOW_MAX_DEPTH   — BFS depth cap (default 4)
 *   APP_FLOW_MAX_PAGES   — BFS page cap (default 80)
 *   APP_FLOW_MODALS      — optional hand-authored modal/drawer capture list
 *                          (JSON array of AppFlowModalConfig) — click-triggered
 *                          sub-screens are NOT auto-probed (unsafe — see
 *                          project history of consent-modal/destructive-click
 *                          incidents), only captured when explicitly configured.
 *   APP_FLOW_SKIP_AI     — skip per-screen AI description generation
 *   APP_CONTEXT_TEXT, APP_GLOSSARY — feed the AI description prompt
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json automation/record-appflow-map.ts
 *
 * Output:
 *   out/<slug>/demo-package.json          (meta.templateId = 'app_flow')
 *   out/<slug>/voice-script.json
 *   out/<slug>/appflow-captures/<id>.png
 *   out/<slug>/appflow-validation-report.json
 */

import { chromium } from 'playwright';
import type { BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import { AzureOpenAI } from 'openai';
import { OUT_DIR } from './config';
import { createAuthContext, ensureSession } from './utils/session';
import type { SessionState } from './utils/session';
import { extractPrimaryRole } from './utils/roleLabel';
import { extractPageFields } from './utils/fieldExtractor';
import { computeTreeLayout } from './utils/treeLayout';
import { DiscoveryAgent } from '../src/agents/discovery/DiscoveryAgent';
import { NodeClassifier } from '../src/discovery/graph';
import type { DiscoveredPage } from '../src/core/domain/entities/DiscoveredPage';
import type {
  AppFlowNode,
  AppFlowNodeType,
  AppFlowFormGroup,
  AppFlowTable,
  AppFlowIntroData,
  AppFlowTourStopData,
  AppFlowDetailDiveData,
  AppFlowOutroData,
} from '../src/core/domain/entities/RemotionPackage';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

// ─── Config — all values from .env ───────────────────────────────────────────

const APP_URL      = (process.env['APP_URL'] ?? 'http://localhost:3000').replace(/\/$/, '');
const LOGIN_TYPE    = process.env['LOGIN_TYPE'] ?? '1';
const APP_USERNAME  = process.env['APP_USERNAME'] ?? '';
const APP_PASSWORD  = process.env['APP_PASSWORD'] ?? '';
const QUICK_ACCESS_INDEX = Number(process.env['APP_QUICK_ACCESS_INDEX'] ?? '0');
const PRODUCT_NAME  = process.env['APP_PRODUCT_NAME'] || (() => {
  try { return new URL(APP_URL).hostname; } catch { return 'Product'; }
})();

const MAX_DEPTH = Number(process.env['APP_FLOW_MAX_DEPTH'] ?? '4');
const MAX_PAGES = Number(process.env['APP_FLOW_MAX_PAGES'] ?? '80');
const SKIP_AI   = process.env['APP_FLOW_SKIP_AI'] === 'true';

const APP_CONTEXT  = process.env['APP_CONTEXT_TEXT'] ?? '';
const APP_GLOSSARY = process.env['APP_GLOSSARY'] ?? '';

const APP_ROUTE_MAP_RAW = process.env['APP_ROUTE_MAP'] ?? '{}';
let routeMap: Record<string, string> = {};
try { if (APP_ROUTE_MAP_RAW) routeMap = JSON.parse(APP_ROUTE_MAP_RAW); } catch { /* malformed — proceed with no seed routes */ }

const VIEWPORT = { width: 1920, height: 1080 };
const FPS      = 30;

const CAPTURES_DIR    = path.join(OUT_DIR, 'appflow-captures');
const PKG_PATH        = path.join(OUT_DIR, 'demo-package.json');
const VOICE_PATH      = path.join(OUT_DIR, 'voice-script.json');
const VALIDATION_PATH = path.join(OUT_DIR, 'appflow-validation-report.json');

fs.mkdirSync(CAPTURES_DIR, { recursive: true });

// ─── Azure OpenAI ─────────────────────────────────────────────────────────────

const azureClient = new AzureOpenAI({
  apiKey:     process.env['AZURE_OPENAI_API_KEY']    ?? '',
  endpoint:   process.env['AZURE_OPENAI_ENDPOINT']   ?? '',
  deployment: process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
  apiVersion: process.env['OPENAI_API_VERSION']      ?? '2024-12-01-preview',
});

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

// ─── Modal config (APP_FLOW_MODALS) — hand-authored, never auto-probed ───────

interface ClipAction {
  type:         'wait' | 'click' | 'hover' | 'waitFor';
  selector?:    string;
  text?:        string;
  waitAfterMs?: number;
}

interface AppFlowModalConfig {
  id:              string;
  /** Full URL substring or exact pathname of the page where this modal is triggered. */
  parentNodeUrl:   string;
  label:           string;
  triggerActions:  ClipAction[];
  /** Default: press Escape. */
  closeActions?:   ClipAction[];
}

let modalConfigs: AppFlowModalConfig[] = [];
try {
  const raw = process.env['APP_FLOW_MODALS'];
  if (raw) modalConfigs = JSON.parse(raw);
} catch { /* malformed — proceed with no modal captures */ }

async function performAction(page: Page, action: ClipAction): Promise<void> {
  try {
    switch (action.type) {
      case 'wait':
        await page.waitForTimeout(action.waitAfterMs ?? 1000);
        break;
      case 'click':
        if (action.text) {
          await page.locator(`text=${action.text}`).first().click({ timeout: 5000 }).catch(() => {});
        } else if (action.selector) {
          await page.locator(action.selector).first().click({ timeout: 5000 }).catch(() => {});
        }
        if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);
        break;
      case 'hover':
        if (action.selector) await page.locator(action.selector).first().hover({ timeout: 3000 }).catch(() => {});
        if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);
        break;
      case 'waitFor':
        if (action.selector) await page.waitForSelector(action.selector, { timeout: 8000 }).catch(() => {});
        if (action.waitAfterMs) await page.waitForTimeout(action.waitAfterMs);
        break;
    }
  } catch { /* best-effort — a failed action shouldn't abort the whole modal capture */ }
}

async function runActions(page: Page, actions: ClipAction[]): Promise<void> {
  for (const action of actions) await performAction(page, action);
}

const DEFAULT_CLOSE_ACTIONS: ClipAction[] = [{ type: 'wait', waitAfterMs: 300 }];

// ─── Fallback label derivation ───────────────────────────────────────────────
// Many SPAs never update document.title per route (confirmed on the app this
// was tested against — every DiscoveredPage.title came back identical), so
// dp.title is NOT a reliable per-screen label source. Derive a distinguishing
// fallback from APP_ROUTE_MAP's human-authored description (if this URL
// matches an entry) or, failing that, from the URL path itself. This runs at
// crawl time; the AI step below refines it further when available.

function prettifySegment(seg: string): string {
  return seg.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function deriveFallbackLabel(url: string, routeMap: Record<string, string>): string {
  let pathname = '/';
  try { pathname = new URL(url).pathname; } catch { /* keep default */ }

  const routeEntry = Object.entries(routeMap).find(([routePath]) => {
    const pattern = routePath.replace(/:[^/]+/g, '[^/]+').replace(/\/$/, '');
    return new RegExp(`^${pattern}/?$`).test(pathname.replace(/\/$/, '') || '/');
  });

  if (routeEntry) {
    const description = routeEntry[1];
    const afterDash = description.includes('—') ? description.split('—')[1].trim() : description;
    const stopWords = new Set(['showing', 'with', 'for', 'letting', 'listing', 'tracking', 'that', 'and', 'comparing', 'across']);
    const picked: string[] = [];
    for (const w of afterDash.split(/\s+/)) {
      if (stopWords.has(w.toLowerCase())) break;
      picked.push(w.replace(/[.,]$/, ''));
      if (picked.length >= 8) break;
    }
    if (picked.length > 0) return picked.join(' ');
  }

  if (pathname === '/' || pathname === '') return 'Home';
  const segments = pathname.split('/').filter(Boolean).map(prettifySegment);
  return segments.join(' ').slice(0, 60);
}

// ─── AI: per-screen title + description ──────────────────────────────────────

async function generateNodeContent(node: {
  label: string; nodeType: string; fieldLabels: string[];
}): Promise<{ label: string; description: string }> {
  if (SKIP_AI) return { label: node.label, description: '' };
  if (!APP_CONTEXT && !APP_GLOSSARY) return { label: node.label, description: '' };

  try {
    return await retryWithBackoff(async () => {
      const sections: string[] = [
        'You write short display titles and one-sentence descriptions of product screens for a sitemap-style demo video.',
      ];
      if (APP_CONTEXT)  sections.push(`\n\nPRODUCT CONTEXT:\n${APP_CONTEXT.slice(0, 1500)}`);
      if (APP_GLOSSARY) sections.push(`\n\nDOMAIN GLOSSARY:\n${APP_GLOSSARY.slice(0, 800)}`);
      sections.push(
        `\n\nScreen (working name: "${node.label}", classified as ${node.nodeType}). ` +
        `Key fields on this screen: ${node.fieldLabels.slice(0, 8).join(', ') || 'none detected'}.` +
        '\n\nReply with JSON only, no fences: ' +
        '{"label":"2-4 word screen title","description":"one short sentence, max 16 words, describing what this screen is for"}',
      );

      const response = await azureClient.chat.completions.create({
        model:                  process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4.1',
        max_completion_tokens:  400,
        reasoning_effort:       'low',
        messages: [{ role: 'system', content: sections.join('') }],
      });

      const raw = (response.choices[0]?.message?.content ?? '').trim()
        .replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
      const parsed = JSON.parse(raw);
      return {
        label:       String(parsed.label || node.label).slice(0, 40),
        description: String(parsed.description || ''),
      };
    });
  } catch (err) {
    console.warn(`    ⚠️  AI content failed for "${node.label}": ${(err as Error).message?.slice(0, 80)}`);
    return { label: node.label, description: '' };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function urlsResemble(actual: string, expected: string): boolean {
  try {
    const a = new URL(actual);
    const e = new URL(expected);
    return a.pathname.replace(/\/$/, '') === e.pathname.replace(/\/$/, '');
  } catch {
    return actual === expected;
  }
}

/** BFS over parentId to collect a node + all its descendants (used for tour-stop union bboxes). */
function collectSubtree(nodes: AppFlowNode[], rootId: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.parentId) {
      if (!childrenOf.has(n.parentId)) childrenOf.set(n.parentId, []);
      childrenOf.get(n.parentId)!.push(n.id);
    }
  }
  const result: string[] = [rootId];
  const queue = [rootId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const kid of childrenOf.get(cur) ?? []) {
      result.push(kid);
      queue.push(kid);
    }
  }
  return result;
}

/** form/detail/report screens are more interesting to dive into than list/generic ones. */
function detailPriority(nodeType: AppFlowNodeType): number {
  if (nodeType === 'form' || nodeType === 'detail' || nodeType === 'report') return 0;
  if (nodeType === 'dashboard' || nodeType === 'settings' || nodeType === 'modal') return 1;
  return 2; // list, entry, generic
}

/**
 * Seeded routes (from APP_ROUTE_MAP) always start with parentId undefined —
 * DiscoveryAgent gives every seedUrl entry `parentId: undefined` regardless of
 * whether it's also reachable via a real in-app link, since seeding bypasses
 * link-following entirely. Without this, a fully-seeded crawl (the common case
 * for SPAs with non-anchor sidebar nav) collapses into a flat single-row
 * layout even when genuine URL-path nesting exists (e.g. /robots/:id under
 * /robots). Infer a parent from URL path hierarchy for any node the BFS didn't
 * naturally nest, matching only against nodes that actually survived the crawl.
 */
function inferUrlParent(node: AppFlowNode, allNodes: AppFlowNode[]): string | undefined {
  let pathname: string;
  try { pathname = new URL(node.url).pathname; } catch { return undefined; }

  const segments = pathname.split('/').filter(Boolean);
  for (let cut = segments.length - 1; cut >= 1; cut--) {
    const candidatePath = ('/' + segments.slice(0, cut).join('/')).replace(/\/$/, '');
    const match = allNodes.find(n => {
      if (n.id === node.id) return false;
      try { return new URL(n.url).pathname.replace(/\/$/, '') === candidatePath; }
      catch { return false; }
    });
    if (match) return match.id;
  }
  return undefined;
}

/** Recomputes depth by walking each node's real parent chain — dp.depth (BFS
 *  queue depth) is no longer trustworthy once inferUrlParent has re-parented
 *  seeded nodes. */
function recomputeDepths(nodes: AppFlowNode[]): void {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const cache = new Map<string, number>();

  function depthOf(id: string, seen: Set<string>): number {
    if (cache.has(id)) return cache.get(id)!;
    if (seen.has(id)) return 0; // cycle guard
    seen.add(id);
    const node = byId.get(id)!;
    const depth = (!node.parentId || !byId.has(node.parentId))
      ? 0
      : depthOf(node.parentId, seen) + 1;
    cache.set(id, depth);
    return depth;
  }

  for (const n of nodes) n.depth = depthOf(n.id, new Set());
}

// ─── Validation report ────────────────────────────────────────────────────────

interface AppFlowValidationFlag {
  nodeId:  string;
  code:    'NO_FIELDS_ON_FORM_SCREEN' | 'LOW_CONFIDENCE_LABELS' | 'NAV_FAILED';
  message: string;
}

function buildValidationReport(
  nodes:         AppFlowNode[],
  navFailedIds:  Set<string>,
): { flags: AppFlowValidationFlag[]; scanned: number; passed: boolean } {
  const flags: AppFlowValidationFlag[] = [];

  for (const n of nodes) {
    if (navFailedIds.has(n.id)) {
      flags.push({
        nodeId: n.id, code: 'NAV_FAILED',
        message: `Navigation to ${n.url} did not land on the expected page — field data may be inaccurate.`,
      });
    }

    if (n.fields.length === 0 && (n.nodeType === 'form' || n.nodeType === 'detail')) {
      flags.push({
        nodeId: n.id, code: 'NO_FIELDS_ON_FORM_SCREEN',
        message: `"${n.label}" is classified as ${n.nodeType} but no fields were extracted.`,
      });
    }

    const allFields = n.forms.flatMap(f => f.fields);
    if (allFields.length > 0 && allFields.every(f => f.labelSource === 'none' || f.labelSource === 'adjacent-text')) {
      flags.push({
        nodeId: n.id, code: 'LOW_CONFIDENCE_LABELS',
        message: `"${n.label}" — every field label resolved via a low-confidence heuristic; verify manually.`,
      });
    }
  }

  return { flags, scanned: nodes.length, passed: flags.length === 0 };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  🗺️   Full Application Flow — sitemap + field mapper');
  console.log('══════════════════════════════════════════════════════════════\n');

  if (!APP_URL) { console.error('  ✗  APP_URL not set in .env'); process.exit(1); }

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
  });

  const nodes: AppFlowNode[] = [];
  const navFailedIds = new Set<string>();

  try {
    // ── 1. Login ──────────────────────────────────────────────────────────
    const primaryRole = (() => {
      const first = Object.values(routeMap)[0];
      return first ? extractPrimaryRole(String(first)) ?? undefined : undefined;
    })();

    console.log(`  🔐  Establishing session${primaryRole ? ` (role: "${primaryRole}")` : ''}…`);
    const session: SessionState | null = await ensureSession(browser, {
      appUrl:   APP_URL,
      viewport: VIEWPORT,
      credentials: {
        username:            APP_USERNAME,
        password:            APP_PASSWORD,
        loginType:           (LOGIN_TYPE === '2' ? 2 : 1),
        quickAccessIndex:    QUICK_ACCESS_INDEX,
        quickAccessRoleName: primaryRole,
      },
    });

    if (!session) {
      console.error('  ✗  Could not establish an authenticated session — check APP_USERNAME/APP_PASSWORD/LOGIN_TYPE in .env');
      process.exit(1);
    }

    const authCtx: BrowserContext = await createAuthContext(browser, session, { viewport: VIEWPORT });

    // ── 2. BFS discover (DiscoveryAgent used as-is, seeded with APP_ROUTE_MAP) ──
    console.log(`  🕸️   Crawling ${APP_URL} (maxDepth=${MAX_DEPTH}, maxPages=${MAX_PAGES})…`);
    const seedUrls = Object.keys(routeMap);
    const discovered: DiscoveredPage[] = await new DiscoveryAgent().discover(APP_URL, authCtx, {
      maxDepth: MAX_DEPTH,
      maxPages: MAX_PAGES,
      seedUrls,
    });
    console.log(`     Discovered ${discovered.length} page(s)`);

    // ── 3. Classify + field-extraction pass (sequential — one page, reused) ──
    console.log('  🔍  Extracting fields per screen…');
    const classifier = new NodeClassifier();
    const page = await authCtx.newPage();

    // Multiple originally-distinct routes can land on the SAME real screen —
    // typically a route gated to a role the logged-in account doesn't have,
    // silently redirected (client-side, no URL-level navFailed signal) back to
    // a default page. DiscoveredPage.url already reflects the POST-redirect
    // landing URL (DiscoveryAgent resolves this before we ever see it), so a
    // simple final-URL dedup catches every case regardless of which original
    // route(s) fed into it — skip the (wasted) extraction work entirely for
    // duplicates rather than filtering them out after the fact.
    const seenFinalUrls = new Set<string>();

    for (const dp of discovered) {
      const normalizedUrl = dp.url.replace(/\/$/, '');
      if (seenFinalUrls.has(normalizedUrl)) {
        const via = dp.redirectedFrom ? ` (redirected from ${dp.redirectedFrom})` : '';
        console.log(`     ↳ skipping duplicate screen at ${dp.url}${via} — same page already captured`);
        continue;
      }
      seenFinalUrls.add(normalizedUrl);

      const nodeType = classifier.classify(dp) as AppFlowNodeType;
      let forms: AppFlowFormGroup[] = [];
      let tables: AppFlowTable[] = [];

      try {
        await page.goto(dp.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        await page.waitForTimeout(800);

        if (!urlsResemble(page.url(), dp.url)) navFailedIds.add(dp.id);

        const fieldData = await extractPageFields(page, dp.id, page.url());
        forms = fieldData.forms.map(f => ({
          formLabel: f.formLabel,
          fields: f.fields.map(field => ({
            name:             field.name,
            label:            field.label,
            labelSource:      field.labelSource,
            fieldType:        field.tag,
            inputType:        field.inputType,
            required:         field.required,
            options:          field.options,
            optionsTruncated: field.optionsTruncated,
          })),
        }));
        tables = fieldData.tables;
      } catch (err) {
        navFailedIds.add(dp.id);
        console.warn(`     ⚠️  ${dp.url}: ${(err as Error).message?.slice(0, 80)}`);
      }

      const screenshotRelPath = path.join('appflow-captures', `${dp.id}.png`).replace(/\\/g, '/');
      let hasScreenshot = false;
      try {
        await page.screenshot({ path: path.join(OUT_DIR, 'appflow-captures', `${dp.id}.png`), type: 'png' });
        hasScreenshot = true;
      } catch { /* screenshot is best-effort */ }

      const flatFields: AppFlowNode['fields'] = [
        ...forms.flatMap(f => f.fields.map(field => ({
          label:     field.label || field.name || '(unlabeled field)',
          fieldType: field.fieldType,
        }))),
        ...tables.flatMap(t => t.columns.map(col => ({ label: col, fieldType: 'table-column' as const }))),
      ];

      nodes.push({
        id:             dp.id,
        parentId:       dp.parentPageId,
        url:            dp.url,
        label:          deriveFallbackLabel(dp.url, routeMap),
        nodeType,
        depth:          dp.depth,
        screenshotPath: hasScreenshot ? screenshotRelPath : null,
        forms,
        tables,
        fields:         flatFields,
        x: 0, y: 0, width: 0, height: 0, // filled by the layout pass below
      });
    }

    // ── 4. Modal pass (APP_FLOW_MODALS) — hand-authored, never auto-probed ──
    if (modalConfigs.length > 0) {
      console.log(`  🪟  Capturing ${modalConfigs.length} configured modal(s)…`);
    }
    for (const modal of modalConfigs) {
      try {
        const parentNode = nodes.find(n => {
          try { return n.url.includes(modal.parentNodeUrl) || new URL(n.url).pathname === modal.parentNodeUrl; }
          catch { return n.url.includes(modal.parentNodeUrl); }
        });
        if (!parentNode) {
          console.warn(`     ⚠️  APP_FLOW_MODALS: no screen found matching "${modal.parentNodeUrl}" for modal "${modal.id}"`);
          continue;
        }

        await page.goto(parentNode.url, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(800);
        await runActions(page, modal.triggerActions);

        const modalId = `modal-${modal.id}`;
        const fieldData = await extractPageFields(page, modalId, page.url());
        const forms: AppFlowFormGroup[] = fieldData.forms.map(f => ({
          formLabel: f.formLabel,
          fields: f.fields.map(field => ({
            name: field.name, label: field.label, labelSource: field.labelSource,
            fieldType: field.tag, inputType: field.inputType, required: field.required,
            options: field.options, optionsTruncated: field.optionsTruncated,
          })),
        }));
        const tables: AppFlowTable[] = fieldData.tables;
        const flatFields: AppFlowNode['fields'] = [
          ...forms.flatMap(f => f.fields.map(field => ({ label: field.label || field.name || '(unlabeled field)', fieldType: field.fieldType }))),
          ...tables.flatMap(t => t.columns.map(col => ({ label: col, fieldType: 'table-column' as const }))),
        ];

        const screenshotRelPath = path.join('appflow-captures', `${modalId}.png`).replace(/\\/g, '/');
        let hasScreenshot = false;
        try {
          await page.screenshot({ path: path.join(OUT_DIR, 'appflow-captures', `${modalId}.png`), type: 'png' });
          hasScreenshot = true;
        } catch { /* best-effort */ }

        nodes.push({
          id: modalId, parentId: parentNode.id, url: parentNode.url, label: modal.label,
          nodeType: 'modal', depth: parentNode.depth + 1,
          screenshotPath: hasScreenshot ? screenshotRelPath : null,
          forms, tables, fields: flatFields,
          x: 0, y: 0, width: 0, height: 0,
        });

        await runActions(page, modal.closeActions ?? DEFAULT_CLOSE_ACTIONS);
        await page.keyboard.press('Escape').catch(() => {});
      } catch (err) {
        console.warn(`     ⚠️  Modal "${modal.id}" capture failed: ${(err as Error).message?.slice(0, 80)}`);
      }
    }

    await page.close();
    await authCtx.close();
  } finally {
    await browser.close();
  }

  if (nodes.length === 0) {
    console.error('  ✗  No screens discovered.\n');
    process.exit(1);
  }

  // ── 4b. Infer URL-based parents for seeded (naturally parentless) nodes ──
  for (const n of nodes) {
    if (!n.parentId) {
      const inferred = inferUrlParent(n, nodes);
      if (inferred) n.parentId = inferred;
    }
  }
  recomputeDepths(nodes);

  // ── 5. Layout — computed once, baked as fractions ────────────────────────
  console.log('  📐  Computing sitemap layout…');
  const layout = computeTreeLayout(nodes.map(n => ({ id: n.id, parentId: n.parentId })));
  for (const n of nodes) {
    const pos = layout.get(n.id);
    if (pos) { n.x = pos.x; n.y = pos.y; n.width = pos.width; n.height = pos.height; }
  }

  // ── 6. AI titles + descriptions ───────────────────────────────────────────
  if (!SKIP_AI && (APP_CONTEXT || APP_GLOSSARY)) {
    console.log('  🤖  Generating per-screen titles/descriptions…');
    for (const n of nodes) {
      const content = await generateNodeContent({
        label:       n.label,
        nodeType:    n.nodeType,
        fieldLabels: n.fields.map(f => f.label),
      });
      n.label       = content.label;
      n.description = content.description;
    }
  }

  // ── 7. Select tour stops & detail dives ──────────────────────────────────
  // Two possible shapes: a single connected tree from one entry point (tour
  // stops = its depth-1 branches), or a forest of independent top-level
  // modules (common for apps whose routes were mostly seeded rather than
  // organically link-discovered — each root IS its own top-level module, so
  // tour stops = the roots themselves, not a nonexistent shared depth-1 layer).
  const rootNodes = nodes.filter(n => !n.parentId);
  let tourStopNodes: AppFlowNode[];
  if (rootNodes.length === 1) {
    const directChildren = nodes.filter(n => n.parentId === rootNodes[0].id);
    tourStopNodes = directChildren.length > 0 ? directChildren : rootNodes;
  } else {
    tourStopNodes = rootNodes;
  }

  const detailCandidates = [...nodes]
    .sort((a, b) => {
      if (b.fields.length !== a.fields.length) return b.fields.length - a.fields.length;
      const p = detailPriority(a.nodeType) - detailPriority(b.nodeType);
      if (p !== 0) return p;
      return a.depth - b.depth;
    })
    .filter(n => n.fields.length > 0)
    .slice(0, 8);

  // ── 8. Timing — computed here, baked into frames (fps=30) ────────────────
  const maxDepth = Math.max(0, ...nodes.map(n => n.depth));
  const INTRO_SEC       = Math.min(8, 4 + maxDepth * 0.8);
  const TOUR_STOP_SEC   = 7;
  const DETAIL_DIVE_SEC = 9;
  const OUTRO_SEC       = 6;

  let cursor = 0;

  const introFrames = Math.round(INTRO_SEC * FPS);
  const appFlowIntro: AppFlowIntroData = { from: cursor, durationInFrames: introFrames, productName: PRODUCT_NAME };
  cursor += introFrames;

  const appFlowTourStops: AppFlowTourStopData[] = tourStopNodes.map(n => {
    const subtreeNodeIds = collectSubtree(nodes, n.id);
    const durationInFrames = Math.round(TOUR_STOP_SEC * FPS);
    const stop: AppFlowTourStopData = {
      id: `tour-${n.id}`, from: cursor, durationInFrames,
      focusNodeId: n.id, subtreeNodeIds,
      caption: `${n.label} · ${subtreeNodeIds.length} screen${subtreeNodeIds.length === 1 ? '' : 's'}`,
    };
    cursor += durationInFrames;
    return stop;
  });

  const appFlowDetailDives: AppFlowDetailDiveData[] = detailCandidates.map(n => {
    const durationInFrames = Math.round(DETAIL_DIVE_SEC * FPS);
    const dive: AppFlowDetailDiveData = { id: `dive-${n.id}`, from: cursor, durationInFrames, nodeId: n.id };
    cursor += durationInFrames;
    return dive;
  });

  const outroFrames = Math.round(OUTRO_SEC * FPS);
  const totalFields = nodes.reduce((sum, n) => sum + n.fields.length, 0);
  const appFlowOutro: AppFlowOutroData = {
    from: cursor, durationInFrames: outroFrames, productName: PRODUCT_NAME,
    tagline: `${nodes.length} screens · ${totalFields} fields, fully mapped.`,
    screenCount: nodes.length, fieldCount: totalFields,
  };
  cursor += outroFrames;

  const totalFrames = cursor;

  // ── 9. Assemble demo-package.json ─────────────────────────────────────────
  console.log('  📦  Writing demo-package.json…');

  const pkg = {
    schemaVersion: '1.0' as const,
    id:   randomUUID(),
    meta: {
      productName:      PRODUCT_NAME,
      targetAudience:   '',
      primaryBenefit:   '',
      totalDurationSec: Math.round(totalFrames / FPS),
      totalScenes:      nodes.length,
      narrativeArc:     'app-flow-map',
      generatedAt:      new Date().toISOString(),
      journeyId:        '',
      storyboardId:     '',
      templateId:       'app_flow' as const,
    },
    composition: { id: 'AppFlowVideo', fps: FPS, width: 1920, height: 1080, durationInFrames: totalFrames },
    openingCard: { from: 0, durationInFrames: 1, title: PRODUCT_NAME, subtitle: '', backgroundColor: '#0a0f1a' },
    scenes:      [],
    closingCard: { from: Math.max(totalFrames - 1, 0), durationInFrames: 1, callToAction: '', productName: PRODUCT_NAME, backgroundColor: '#0a0f1a' },
    appFlowNodes: nodes,
    appFlowIntro,
    appFlowTourStops,
    appFlowDetailDives,
    appFlowOutro,
  };

  fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2), 'utf-8');

  // ── 10. voice-script.json — deterministic narration from real extracted data ──
  // (No extra AI calls for narration text itself — reuses the per-node AI
  // descriptions already generated in step 6, so cost/latency doesn't scale
  // with phase count on top of node count.)
  console.log('  🎙️   Writing voice-script.json…');

  const segments: { id: string; label: string; startSec: number; durationSec: number; text: string; enabled: boolean }[] = [];

  segments.push({
    id: 'app-flow-intro', label: 'Intro — full map', startSec: appFlowIntro.from / FPS,
    durationSec: Math.max(1, appFlowIntro.durationInFrames / FPS - 1),
    text: `Here's a complete map of ${PRODUCT_NAME} — ${nodes.length} screens with ${totalFields} data fields.`,
    enabled: true,
  });

  for (const stop of appFlowTourStops) {
    const node = nodes.find(n => n.id === stop.focusNodeId);
    if (!node) continue;
    const childCount = stop.subtreeNodeIds.length - 1;
    const text = childCount > 0
      ? `${node.label} branches into ${childCount} screen${childCount === 1 ? '' : 's'}${node.description ? ` — ${node.description}` : '.'}`
      : `${node.label}${node.description ? ` — ${node.description}` : '.'}`;
    segments.push({
      id: stop.id, label: `Tour — ${node.label}`, startSec: stop.from / FPS,
      durationSec: Math.max(1, stop.durationInFrames / FPS - 1), text, enabled: true,
    });
  }

  for (const dive of appFlowDetailDives) {
    const node = nodes.find(n => n.id === dive.nodeId);
    if (!node) continue;
    const topFields = node.fields.slice(0, 5).map(f => f.label).filter(Boolean);
    const text = `${node.label}${node.description ? ` — ${node.description}` : '.'}` +
      (topFields.length > 0 ? ` Key fields: ${topFields.join(', ')}.` : '');
    segments.push({
      id: dive.id, label: `Detail — ${node.label}`, startSec: dive.from / FPS,
      durationSec: Math.max(1, dive.durationInFrames / FPS - 1), text, enabled: true,
    });
  }

  segments.push({
    id: 'app-flow-outro', label: 'Outro — summary', startSec: appFlowOutro.from / FPS,
    durationSec: Math.max(1, appFlowOutro.durationInFrames / FPS - 1),
    text: `That's the complete flow of ${PRODUCT_NAME} — ${nodes.length} screens and ${totalFields} fields, fully mapped.`,
    enabled: true,
  });

  const voiceScript = {
    voice: 'nova',
    model: 'tts-hd',
    speed: 0.95,
    fps:   FPS,
    totalDurationSec: Math.round((totalFrames / FPS) * 10) / 10,
    segments,
  };

  fs.writeFileSync(VOICE_PATH, JSON.stringify(voiceScript, null, 2), 'utf-8');

  // ── 11. Non-blocking validation report ────────────────────────────────────
  const report = buildValidationReport(nodes, navFailedIds);
  fs.writeFileSync(VALIDATION_PATH, JSON.stringify(report, null, 2), 'utf-8');

  console.log('\n══════════════════════════════════════════════════════════════');
  if (report.passed) {
    console.log('  ✅  CONTENT VALIDATION — no issues flagged');
  } else {
    console.log(`  ⚠️   CONTENT VALIDATION — ${report.flags.length} flag(s):`);
    for (const flag of report.flags.slice(0, 20)) console.log(`      [${flag.code}] ${flag.message}`);
    if (report.flags.length > 20) console.log(`      … and ${report.flags.length - 20} more (see ${VALIDATION_PATH})`);
  }
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  ✅  Done!\n`);
  console.log(`     Screens     : ${nodes.length}`);
  console.log(`     Fields      : ${totalFields}`);
  console.log(`     Tour stops  : ${appFlowTourStops.length}`);
  console.log(`     Detail dives: ${appFlowDetailDives.length}`);
  console.log(`     Duration    : ${Math.round(totalFrames / FPS)}s`);
  console.log(`     Package     : ${PKG_PATH}`);
  console.log('\n  Next step: npm run voice:only   (synthesize the narration MP3s)');
  console.log('══════════════════════════════════════════════════════════════\n');
}

main().catch(e => {
  console.error('\n💥 Fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
