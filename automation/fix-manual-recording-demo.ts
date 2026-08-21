/**
 * fix-manual-recording-demo.ts — Regenerates out/<slug>/manual-recording/final-demo-video.mp4
 * (the plain Manual Recording pipeline's output, produced by process-manual-recording.ts)
 * with three fixes, found the same way as the equivalent fixes already applied to the
 * separate Enterprise-bridge pipeline (manual-recording-to-enterprise.ts):
 *
 *   1. The raw recording's first ~4s is OBS Studio's own UI (a setup artifact, not the
 *      app) — trimmed from the front instead of playing before the real content.
 *   2. A handful of scenes' narration was written for content that only appears a few
 *      seconds into the detected scene (a quick multi-click transition got bucketed into
 *      one scene) — verified by extracting real frames and comparing against narration
 *      text, same corrections as the Enterprise bridge's SCENE_START_OFFSET_SEC.
 *   3. The OS taskbar baked into the bottom of the recording is cropped out (reusing the
 *      already-produced normalized-muted-cropped.mp4 from the Enterprise bridge — same
 *      source footage, crop is content-identical regardless of which pipeline uses it).
 *
 * Deliberately does NOT touch normalized(-muted(-cropped)).mp4, scenes.json, or
 * voice-script.json — those are shared with manual-recording-to-enterprise.ts, whose own
 * corrections are expressed as offsets into those files' existing (untrimmed) timeline.
 * Everything this script writes is new or is this pipeline's own already-regenerable
 * output (demo-video-with-voice.mp4, final-demo-video.mp4).
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json automation/fix-manual-recording-demo.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { execSync } from 'child_process';
import { OUT_DIR, ROOT } from './config';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

const MR_DIR                = path.join(OUT_DIR, 'manual-recording');
const BASE_VOICE_SCRIPT      = path.join(MR_DIR, 'voice-script.json');
const CROPPED_MUTED_PATH     = path.join(MR_DIR, 'normalized-muted-cropped.mp4');
const BOOKEND_OPEN_PATH      = path.join(MR_DIR, 'bookend-open.mp4');
const BOOKEND_CLOSE_PATH     = path.join(MR_DIR, 'bookend-close.mp4');

const TRIMMED_VIDEO_PATH     = path.join(MR_DIR, 'normalized-trimmed-for-demo.mp4');
const FIXED_VOICE_SCRIPT     = path.join(MR_DIR, 'voice-script-demo-fixed.json');
const FIXED_VOICE_DIR_NAME   = 'manual-recording/voice-segments-demo-fixed';
const NARRATED_PATH          = path.join(MR_DIR, 'demo-video-with-voice.mp4');
const FINAL_PATH             = path.join(MR_DIR, 'final-demo-video.mp4');

// Verified by extracting real frames at each timestamp and comparing against the
// narration text (same investigation as manual-recording-to-enterprise.ts's
// SCENE_START_OFFSET_SEC/EXCLUDED_SCENE_INDEXES — see that file's comments for the
// full reasoning). All values are in the ORIGINAL (untrimmed) recording's timeline.
const TRIM_START_SEC = 4;    // OBS Studio's own UI — not the app
const TRIM_END_SEC   = 680;  // just before OBS Studio's UI reappears at ~683s (recording end)

const EXCLUDED_INDEXES = new Set<number>([0]); // mr-scene-1 — the OBS intro itself
const SCENE_START_OFFSET_SEC: Record<number, number> = {
  9:  6, // mr-scene-10 "Models catalog"       — starts on Capabilities for ~6s first
  15: 9, // mr-scene-16 "Register Application" — starts on Routing Overrides; offset lands on the Applications list just before the modal opens
  58: 9, // mr-scene-59 "Cost Optimization"    — starts on Quality Metrics for ~9s first
};
// mr-scene-64 "User Management": narration never matches any real footage in this
// recording (real content there is WORM Storage -> Developer Docs -> recording end).
// Rewritten to describe what's actually shown instead of excluded, since it's the
// last scene before the closing bookend and dropping it silently would leave the
// ending feeling unfinished.
const REWRITTEN_TEXT: Record<number, string> = {
  63: 'Every action is locked in an immutable audit trail, and complete developer documentation means your team can integrate in minutes — that’s ACL AI Gateway: governed AI, built to last.',
};

function findFfmpegBin(): string {
  const candidates = [
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-win32-x64-msvc', 'ffmpeg.exe'),
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-darwin-arm64',   'ffmpeg'),
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-darwin-x64',     'ffmpeg'),
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-linux-x64-gnu',  'ffmpeg'),
    path.join(ROOT, 'node_modules', '@remotion', 'compositor-linux-arm64-gnu', 'ffmpeg'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('Could not find Remotion bundled ffmpeg. Run `npm install` then try again.');
}

interface BaseVoiceSegment {
  id: string; label?: string; startSec: number; durationSec: number;
  text: string; enabled?: boolean;
}
interface BaseVoiceScript {
  voice: string; model: string; speed: number; locale?: string;
  totalDurationSec: number; segments: BaseVoiceSegment[];
}

async function main(): Promise<void> {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  🛠️   Fixing Manual Recording demo (OBS intro, mismatches, taskbar)');
  console.log('══════════════════════════════════════════════════════════════\n');

  for (const [label, p] of [
    ['voice-script.json', BASE_VOICE_SCRIPT],
    ['normalized-muted-cropped.mp4 (run manual-recording-to-enterprise.ts once first)', CROPPED_MUTED_PATH],
    ['bookend-open.mp4', BOOKEND_OPEN_PATH],
    ['bookend-close.mp4', BOOKEND_CLOSE_PATH],
  ] as const) {
    if (!fs.existsSync(p)) {
      console.error(`  ✗  ${label} not found at ${p}`);
      process.exit(1);
    }
  }

  // ── Trim the OBS intro/outro from the already-cropped video ─────────────────
  console.log(`  ✂️   Trimming video to ${TRIM_START_SEC}s–${TRIM_END_SEC}s (removes OBS Studio UI at both ends)…`);
  const ffmpeg = findFfmpegBin();
  execSync(
    `"${ffmpeg}" -y -i "${CROPPED_MUTED_PATH}" -ss ${TRIM_START_SEC} -to ${TRIM_END_SEC} ` +
    `-c:v libx264 -crf 18 -pix_fmt yuv420p -an "${TRIMMED_VIDEO_PATH}"`,
    { stdio: 'ignore' },
  );

  // ── Build the corrected voice script ─────────────────────────────────────────
  const base: BaseVoiceScript = JSON.parse(fs.readFileSync(BASE_VOICE_SCRIPT, 'utf-8'));
  const fixedSegments: BaseVoiceSegment[] = [];
  for (const seg of base.segments) {
    const m = /^mr-scene-(\d+)$/.exec(seg.id);
    if (!m) continue;
    const index = parseInt(m[1], 10) - 1;
    if (EXCLUDED_INDEXES.has(index)) continue;

    const offset = SCENE_START_OFFSET_SEC[index] ?? 0;
    const originalSpaceStart = seg.startSec + offset;
    if (originalSpaceStart >= TRIM_END_SEC) continue; // falls in the trimmed tail

    const text = REWRITTEN_TEXT[index] ?? seg.text;
    const newStartSec = Math.max(0, originalSpaceStart - TRIM_START_SEC);
    const maxDurationSec = TRIM_END_SEC - TRIM_START_SEC - newStartSec;
    fixedSegments.push({
      ...seg,
      text,
      startSec: newStartSec,
      durationSec: Math.min(seg.durationSec, Math.max(2, maxDurationSec)),
    });
  }

  const fixedScript = {
    voice: base.voice, model: base.model, speed: base.speed, fps: 30,
    voiceDir: FIXED_VOICE_DIR_NAME,
    totalDurationSec: TRIM_END_SEC - TRIM_START_SEC,
    segments: fixedSegments,
  };
  fs.writeFileSync(FIXED_VOICE_SCRIPT, JSON.stringify(fixedScript, null, 2), 'utf-8');
  console.log(`  ✓  ${path.relative(ROOT, FIXED_VOICE_SCRIPT)} written (${fixedSegments.length} segments, dropped ${base.segments.length - fixedSegments.length})`);

  // ── Regenerate narration + merge with the trimmed video ──────────────────────
  console.log('\n  🎙️   Synthesizing corrected narration + merging with trimmed footage…');
  execSync(
    `npx ts-node --project tsconfig.scripts.json automation/generate-voice.ts ` +
    `--script "${FIXED_VOICE_SCRIPT.replace(/\\/g, '/')}" ` +
    `--video "${TRIMMED_VIDEO_PATH.replace(/\\/g, '/')}" ` +
    `--output "${NARRATED_PATH.replace(/\\/g, '/')}" --no-sync`,
    { cwd: ROOT, stdio: 'inherit' },
  );

  // ── Reassemble with the existing (unchanged) bookends ────────────────────────
  console.log('\n  🎬  Assembling final video…');
  const cmd = [
    `"${ffmpeg}" -y`,
    `-i "${BOOKEND_OPEN_PATH.replace(/\\/g, '/')}"`,
    `-i "${NARRATED_PATH.replace(/\\/g, '/')}"`,
    `-i "${BOOKEND_CLOSE_PATH.replace(/\\/g, '/')}"`,
    `-filter_complex "[0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1[outv][outa]"`,
    `-map "[outv]" -map "[outa]"`,
    `-c:v libx264 -crf 18 -preset veryfast -c:a aac -b:a 192k`,
    `"${FINAL_PATH.replace(/\\/g, '/')}"`,
  ].join(' ');
  execSync(cmd, { stdio: 'inherit' });

  const stat = fs.statSync(FINAL_PATH);
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  ✅  Done!');
  console.log(`     Video : ${FINAL_PATH}  (${(stat.size / 1_048_576).toFixed(1)} MB)`);
  console.log('══════════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('\n  ✗  Error:', (err as Error).message ?? err);
  process.exit(1);
});
