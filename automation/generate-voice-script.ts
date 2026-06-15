#!/usr/bin/env node
/**
 * generate-voice-script.ts
 *
 * Reads the enterprise demo-package.json produced by the pipeline and writes
 * out/localhost/voice-script.json ready for generate-voice.ts to consume.
 *
 * Enterprise segment order (matches EnterpriseVideo.tsx structure):
 *   1. B-roll scenes  — dramatic, short pause between sentences
 *   2. Product scenes — full narration from scenes[].narration
 *   3. Benefit slide  — narrates all bullets sequentially
 *   4. Presenter close — tagline read as a closing statement
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json automation/generate-voice-script.ts
 *   npx ts-node --project tsconfig.scripts.json automation/generate-voice-script.ts --input out/myrun/demo-package.json
 */

import * as path from 'path';
import * as fs   from 'fs';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

// ─────────────────────────────────────────────────────────────────────────────
// CLI args
// ─────────────────────────────────────────────────────────────────────────────

function getArg(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const ROOT         = path.resolve(__dirname, '..');
const OUT_DIR      = path.join(ROOT, 'out', 'localhost');
const INPUT_PATH   = getArg('--input',  path.join(OUT_DIR, 'demo-package.json'));
const OUTPUT_PATH  = getArg('--output', path.join(OUT_DIR, 'voice-script.json'));

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirrors generate-voice.ts VoiceScript)
// ─────────────────────────────────────────────────────────────────────────────

interface VoiceSegment {
  id:          string;
  label:       string;
  startSec:    number;
  durationSec: number;
  enabled:     boolean;
  text:        string;
}

interface VoiceScript {
  voice:            string;
  model:            string;
  speed:            number;
  fps:              number;
  totalDurationSec: number;
  segments:         VoiceSegment[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Convert frame number to seconds, given fps. */
function toSec(frames: number, fps: number): number {
  return Math.round((frames / fps) * 10) / 10;
}

/** First sentence only — prevents TTS from running too long for a short scene. */
function firstSentence(text: string): string {
  const dot = text.indexOf('. ');
  return dot > 0 ? text.slice(0, dot + 1) : text;
}

/** Narration for a B-roll problem scene — short, punchy, dramatic pause framing. */
function brollNarration(subtitle: string): string {
  // Keep it short: just read the subtitle as a declarative statement.
  // TTS timing: ~3–5 seconds (subtitle is ≤ 12 words).
  const clean = subtitle.endsWith('.') || subtitle.endsWith('?') ? subtitle : `${subtitle}.`;
  return clean;
}

/** Narration for the benefit slide — reads each bullet label + description. */
function benefitSlideNarration(bullets: Array<{ label: string; description: string }>): string {
  if (!bullets?.length) return 'These capabilities deliver measurable value across your organisation.';
  const lines = bullets.map(b => `${b.label}: ${b.description}`);
  return lines.join(' ');
}

/** Closing narration — wraps the tagline in a formal closing sentence. */
function closingNarration(tagline: string, productName: string): string {
  if (!tagline) return `${productName} — built for enterprise, ready today.`;
  return `${tagline} ${productName} — contact us to arrange your live demonstration.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function main(): void {
  const SEP = '═'.repeat(63);
  console.log(`\n${SEP}`);
  console.log('  📝  Enterprise Voice-Script Generator');
  console.log(`      Input  : ${INPUT_PATH}`);
  console.log(`      Output : ${OUTPUT_PATH}`);
  console.log(SEP);

  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`\n  ✗  demo-package.json not found: ${INPUT_PATH}`);
    console.error('     Run the e2e pipeline first.');
    process.exit(1);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pkg = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf-8')) as any;

  if (pkg?.meta?.templateId !== 'enterprise') {
    console.error(`\n  ✗  demo-package.json is not an enterprise package (templateId=${pkg?.meta?.templateId ?? 'absent'})`);
    console.error('     Re-run the pipeline with VIDEO_TEMPLATE=enterprise.');
    process.exit(1);
  }

  const fps         = pkg.composition?.fps      ?? 30;
  const productName = pkg.meta?.productName      ?? 'the Platform';
  const brollScenes = pkg.brollScenes            ?? [];
  const scenes      = pkg.scenes                 ?? [];
  const benefitSlide= pkg.benefitSlide;
  const presenterClose = pkg.presenterClose;

  const segments: VoiceSegment[] = [];

  // ── 1. B-roll scenes ────────────────────────────────────────────────────────
  // Each B-roll is cinematic and short. Read the subtitle with a brief intro line.
  // Narration starts 1.5 s into the scene (let the dark background breathe first).
  for (let i = 0; i < brollScenes.length; i++) {
    const broll   = brollScenes[i];
    const startSec = toSec(broll.from, fps) + 1.5;
    const durSec   = toSec(broll.durationInFrames, fps) - 1.5;

    const text = i === 0
      ? brollNarration(broll.subtitle)
      : brollNarration(broll.subtitle);

    segments.push({
      id:          `broll-${i}`,
      label:       `B-roll ${i + 1} — ${broll.subtitle.slice(0, 40)}`,
      startSec,
      durationSec: Math.max(durSec, 3),
      enabled:     true,
      text,
    });
  }

  // ── 2. Product demo scenes ────────────────────────────────────────────────
  // Full narration from the storyboard (EnterpriseNarrationEngine output).
  // Starts 1s after the scene begins (subtitle bar has settled).
  for (let i = 0; i < scenes.length; i++) {
    const scene   = scenes[i];
    const startSec = toSec(scene.from, fps) + 1.0;
    const durSec   = toSec(scene.durationInFrames, fps) - 1.0;

    // For shorter scenes use first sentence only to avoid overflow.
    const narration = durSec < 12
      ? firstSentence(scene.narration ?? scene.salesHook ?? scene.title)
      : (scene.narration ?? scene.salesHook ?? scene.title);

    segments.push({
      id:          `scene-${i + 1}`,
      label:       `Scene ${i + 1} — ${scene.title}`,
      startSec,
      durationSec: Math.max(durSec, 4),
      enabled:     true,
      text:        narration,
    });
  }

  // ── 3. Benefit slide ─────────────────────────────────────────────────────
  if (benefitSlide) {
    const startSec = toSec(benefitSlide.from, fps) + 1.0;
    const durSec   = toSec(benefitSlide.durationInFrames, fps) - 1.0;

    segments.push({
      id:          'benefit-slide',
      label:       'Benefit Slide — Value Adds',
      startSec,
      durationSec: Math.max(durSec, 8),
      enabled:     true,
      text:        benefitSlideNarration(benefitSlide.bullets ?? []),
    });
  }

  // ── 4. Presenter close ───────────────────────────────────────────────────
  if (presenterClose) {
    const startSec = toSec(presenterClose.from, fps) + 2.0;
    const durSec   = toSec(presenterClose.durationInFrames, fps) - 2.0;

    segments.push({
      id:          'presenter-close',
      label:       'Presenter Close',
      startSec,
      durationSec: Math.max(durSec, 6),
      enabled:     true,
      text:        closingNarration(presenterClose.tagline ?? '', productName),
    });
  }

  // ── Compute total duration ────────────────────────────────────────────────
  const totalFrames =
    presenterClose
      ? presenterClose.from + presenterClose.durationInFrames
      : (scenes.at(-1) ? scenes.at(-1).from + scenes.at(-1).durationInFrames : 300);
  const totalDurationSec = toSec(totalFrames, fps);

  // ── Voice config ─────────────────────────────────────────────────────────
  // Enterprise voice: "onyx" (deep, authoritative) at 0.95× speed (measured, formal).
  // Model uses the TTS deployment name from .env.
  const script: VoiceScript = {
    voice:            'onyx',
    model:            process.env['AZURE_OPENAI_TTS_DEPLOYMENT'] ?? 'tts-hd',
    speed:            0.95,
    fps,
    totalDurationSec,
    segments,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(script, null, 2), 'utf-8');

  console.log(`\n  ✓  ${segments.length} segments written`);
  console.log(`     B-roll    : ${brollScenes.length}`);
  console.log(`     Scenes    : ${scenes.length}`);
  console.log(`     Benefit   : ${benefitSlide ? 1 : 0}`);
  console.log(`     Close     : ${presenterClose ? 1 : 0}`);
  console.log(`     Total dur : ${totalDurationSec}s`);
  console.log(`\n  ${OUTPUT_PATH}`);
  console.log(`\n  Edit voice-script.json to tweak any segment text, then run:`);
  console.log(`    npm run voice\n`);
  console.log(`${SEP}\n`);
}

main();
