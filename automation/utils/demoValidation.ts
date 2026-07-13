/**
 * Post-recording sanity checks for the generated demo video content.
 *
 * These do NOT block the pipeline (see printValidationReport) — they exist so
 * a broken run (e.g. a route silently redirected to the wrong page, or an AI
 * call that fell back to generic boilerplate) is visible in the console and
 * in validation-report.json instead of shipping silently as a "correct" demo.
 */

import * as fs from 'fs';
import { Jimp, compareHashes } from 'jimp';
import { GENERIC_NARRATIONS } from './constants';

export interface ValidationClipInput {
  id:             string;
  title:          string;
  narration:      string;
  screenshotPath: string;
  targetUrl?:     string;
  landedUrl?:     string;
}

export type ValidationCode =
  | 'DUPLICATE_FRAME'
  | 'DUPLICATE_TITLE'
  | 'DUPLICATE_NARRATION'
  | 'GENERIC_NARRATION'
  | 'URL_MISMATCH';

export interface ValidationFlag {
  sceneId:         string;
  relatedSceneId?: string;
  code:            ValidationCode;
  message:         string;
}

export interface ValidationReport {
  flags:           ValidationFlag[];
  passed:          boolean;
  scanned:         number;
  skippedUrlCheck: number;
}

const DEFAULT_FRAME_THRESHOLD = Number(process.env['DEMO_DUPLICATE_FRAME_THRESHOLD'] ?? '0.10');

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

/** Turns an APP_ROUTE_MAP-style path (":id" or "[id]" dynamic segments) into a matcher. */
function pathMatchesTemplate(actualPath: string, template: string): boolean {
  const pattern = template
    .replace(/\[[^\]]+\]/g, '[^/]+')
    .replace(/:[^/]+/g, '[^/]+')
    .replace(/\/$/, '');
  const re = new RegExp(`^${pattern}/?$`);
  return re.test(actualPath.replace(/\/$/, '') || '/');
}

export async function detectDuplicateFrames(
  clips:     ValidationClipInput[],
  threshold: number = DEFAULT_FRAME_THRESHOLD,
): Promise<ValidationFlag[]> {
  const flags: ValidationFlag[] = [];
  const hashes = new Map<string, string>();

  for (const clip of clips) {
    if (!fs.existsSync(clip.screenshotPath)) continue;
    try {
      const img = await Jimp.read(clip.screenshotPath);
      hashes.set(clip.id, img.hash());
    } catch {
      // unreadable image — skip, not a validation failure
    }
  }

  const ids = [...hashes.keys()];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = hashes.get(ids[i])!;
      const b = hashes.get(ids[j])!;
      const distance = compareHashes(a, b);
      if (distance <= threshold) {
        const similarity = (100 * (1 - distance)).toFixed(1);
        flags.push({
          sceneId: ids[j], relatedSceneId: ids[i], code: 'DUPLICATE_FRAME',
          message: `${similarity}% visually identical to "${ids[i]}"`,
        });
      }
    }
  }
  return flags;
}

export function detectDuplicateText(clips: ValidationClipInput[]): ValidationFlag[] {
  const flags: ValidationFlag[] = [];
  const seenTitles     = new Map<string, string>();
  const seenNarrations = new Map<string, string>();

  for (const clip of clips) {
    const titleKey = normalize(clip.title || '');
    if (titleKey) {
      const prior = seenTitles.get(titleKey);
      if (prior) {
        flags.push({
          sceneId: clip.id, relatedSceneId: prior, code: 'DUPLICATE_TITLE',
          message: `title matches "${prior}"`,
        });
      } else {
        seenTitles.set(titleKey, clip.id);
      }
    }

    const narrationKey = normalize(clip.narration || '');
    if (narrationKey) {
      const prior = seenNarrations.get(narrationKey);
      if (prior) {
        flags.push({
          sceneId: clip.id, relatedSceneId: prior, code: 'DUPLICATE_NARRATION',
          message: `narration matches "${prior}"`,
        });
      } else {
        seenNarrations.set(narrationKey, clip.id);
      }
    }
  }
  return flags;
}

export function detectGenericNarration(clips: ValidationClipInput[]): ValidationFlag[] {
  const flags: ValidationFlag[] = [];
  for (const clip of clips) {
    if (GENERIC_NARRATIONS.has(clip.narration) || GENERIC_NARRATIONS.has(clip.title)) {
      flags.push({
        sceneId: clip.id, code: 'GENERIC_NARRATION',
        message: 'narration/title is a fallback template string — AI content generation likely failed',
      });
    }
  }
  return flags;
}

export function detectUrlMismatches(clips: ValidationClipInput[]): ValidationFlag[] {
  const flags: ValidationFlag[] = [];
  for (const clip of clips) {
    if (!clip.targetUrl || !clip.landedUrl) continue;
    try {
      const targetPath = new URL(clip.targetUrl).pathname;
      const landedPath  = new URL(clip.landedUrl).pathname;
      if (!pathMatchesTemplate(landedPath, targetPath)) {
        flags.push({
          sceneId: clip.id, code: 'URL_MISMATCH',
          message: `expected ${targetPath}, landed on ${landedPath}`,
        });
      }
    } catch {
      // unparseable URL — skip
    }
  }
  return flags;
}

export async function validateDemoScenes(clips: ValidationClipInput[]): Promise<ValidationReport> {
  const [frameFlags] = await Promise.all([detectDuplicateFrames(clips)]);
  const textFlags    = detectDuplicateText(clips);
  const genericFlags = detectGenericNarration(clips);
  const urlFlags     = detectUrlMismatches(clips);

  const flags = [...frameFlags, ...textFlags, ...genericFlags, ...urlFlags]
    .sort((a, b) => a.sceneId.localeCompare(b.sceneId));

  const skippedUrlCheck = clips.filter(c => c.targetUrl && !c.landedUrl).length;

  return { flags, passed: flags.length === 0, scanned: clips.length, skippedUrlCheck };
}

export function printValidationReport(report: ValidationReport): void {
  const skippedNote = report.skippedUrlCheck > 0
    ? ` (${report.skippedUrlCheck} skipped from URL check: cached, not re-recorded)`
    : '';
  console.log('\n  ────────────────────────────────────────────────────────────');
  console.log(`   CONTENT VALIDATION REPORT — ${report.scanned} scene(s) scanned${skippedNote}`);
  console.log('  ────────────────────────────────────────────────────────────');

  if (report.passed) {
    console.log('   ✓ No issues found — scenes look unique and product-specific.');
  } else {
    console.log(`   ✗ ${report.flags.length} issue(s) found:\n`);
    for (const flag of report.flags) {
      console.log(`     [${flag.sceneId.padEnd(20)}] ${flag.code.padEnd(20)} ${flag.message}`);
    }
    console.log('\n   Pipeline continuing — demo-package.json will still be written.');
  }
  console.log('  ────────────────────────────────────────────────────────────\n');
}
