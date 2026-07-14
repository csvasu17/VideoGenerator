/**
 * sceneDetection.ts — scene-boundary detection for Manual Recording ingestion.
 *
 * Reuses Jimp perceptual hashing, already a proven dependency in this codebase
 * (automation/utils/demoValidation.ts already does Jimp.read().hash() +
 * compareHashes() for near-duplicate-frame detection — confirmed by reading Jimp's
 * own phash.ts source that this is a true normalized [0,1] Hamming distance over a
 * 64-bit DCT hash). No ffmpeg scene-filter, no new dependency.
 */

import { Jimp, compareHashes } from 'jimp';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface DetectedScene {
  index:              number;
  startSec:           number;
  endSec:             number;
  durationSec:        number;
  /** 'low' when the triggering distance was within ~25% of the threshold, or the
   *  scene was created by merging sub-floor fragments — worth a human glance. */
  boundaryConfidence: 'high' | 'low';
}

export interface SceneDetectionOptions {
  /** Seconds between coarse samples. Real screen-recording pacing (a narrated
   *  walkthrough settles on each screen for several seconds) makes 2s a reliable
   *  grid; denser sampling mostly just costs more compute for no real gain. */
  sampleIntervalSec?:   number;
  /** Hamming-distance cutoff (0-1) for "this is a different screen." Deliberately
   *  double demoValidation.ts's proven 0.10 "same frame" cutoff — biased toward
   *  under- rather than over-fragmenting (a missed boundary just yields one longer
   *  coherent segment; a spurious one costs an extra vision call downstream). */
  threshold?:           number;
  /** Any scene shorter than this gets merged into a neighbor — the backstop against
   *  a continuously-animating chart/spinner clearing the threshold every sample. */
  minSceneDurationSec?: number;
}

const DEFAULTS: Required<SceneDetectionOptions> = {
  sampleIntervalSec:   2,
  threshold:           0.20,
  minSceneDurationSec: 4,
};

function findFfmpegBin(root: string): string {
  const candidates = [
    path.join(root, 'node_modules', '@remotion', 'compositor-win32-x64-msvc', 'ffmpeg.exe'),
    path.join(root, 'node_modules', '@remotion', 'compositor-darwin-arm64',   'ffmpeg'),
    path.join(root, 'node_modules', '@remotion', 'compositor-darwin-x64',     'ffmpeg'),
    path.join(root, 'node_modules', '@remotion', 'compositor-linux-x64-gnu',  'ffmpeg'),
    path.join(root, 'node_modules', '@remotion', 'compositor-linux-arm64-gnu', 'ffmpeg'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return 'ffmpeg';
}

/**
 * Detects scene boundaries in a video by coarse-interval frame sampling + perceptual
 * hashing. Returns scenes covering [0, videoDurationSec] with no gaps.
 */
export async function detectScenes(
  videoPath:      string,
  sampleDir:      string,
  videoDurationSec: number,
  root:           string,
  opts?:          SceneDetectionOptions,
): Promise<DetectedScene[]> {
  const { sampleIntervalSec, threshold, minSceneDurationSec } = { ...DEFAULTS, ...opts };

  fs.mkdirSync(sampleDir, { recursive: true });
  const ffmpeg = findFfmpegBin(root);
  const pattern = path.join(sampleDir, 'sample-%05d.jpg');
  // Remotion's bundled ffmpeg has the `fps` filter disabled (minimal build with a
  // curated --enable-filter allowlist — confirmed by a real failure, see the same
  // note in process-manual-recording.ts's normalize()). `-r` as an OUTPUT option
  // achieves identical frame-sampling (muxer-level frame drop to the target rate)
  // without needing the `fps` filter at all.
  execSync(
    `"${ffmpeg}" -y -i "${videoPath}" -vf "scale=320:-1" -r ${1 / sampleIntervalSec} -qscale:v 5 "${pattern}"`,
    { stdio: 'ignore' },
  );

  const files = fs.readdirSync(sampleDir).filter(f => f.startsWith('sample-')).sort();
  if (files.length === 0) {
    return [{ index: 0, startSec: 0, endSec: videoDurationSec, durationSec: videoDurationSec, boundaryConfidence: 'low' }];
  }

  const hashes: string[] = [];
  for (const f of files) {
    const img = await Jimp.read(path.join(sampleDir, f));
    hashes.push(img.hash());
  }

  const distances: number[] = [];
  for (let i = 0; i < hashes.length - 1; i++) {
    distances.push(compareHashes(hashes[i], hashes[i + 1]));
  }

  // ── Confirm-then-commit: only cut when the change also persists into the next
  //    interval (rejects one-sample anomalies like a modal flash or spinner frame). ──
  const boundaryIndices: number[] = []; // sample index where a NEW scene starts
  const lowConfidenceBoundary = new Set<number>();
  for (let i = 0; i < distances.length; i++) {
    if (distances[i] > threshold) {
      const isLast = i === distances.length - 1;
      const settled = isLast || distances[i + 1] <= threshold;
      if (settled) {
        boundaryIndices.push(i + 1);
        if (distances[i] < threshold * 1.25) lowConfidenceBoundary.add(i + 1);
      }
      // else: still changing — don't commit yet, keep scanning forward.
    }
  }

  // ── Build raw scenes from boundaries ──────────────────────────────────────────
  const cutPoints = [0, ...boundaryIndices, hashes.length - 1];
  const uniqueCuts = [...new Set(cutPoints)].sort((a, b) => a - b);

  interface RawScene { startIdx: number; endIdx: number; lowConfidence: boolean; }
  const rawScenes: RawScene[] = [];
  for (let i = 0; i < uniqueCuts.length - 1; i++) {
    rawScenes.push({
      startIdx: uniqueCuts[i],
      endIdx: uniqueCuts[i + 1],
      lowConfidence: lowConfidenceBoundary.has(uniqueCuts[i]),
    });
  }
  if (rawScenes.length === 0) {
    rawScenes.push({ startIdx: 0, endIdx: hashes.length - 1, lowConfidence: false });
  }

  const idxToSec = (idx: number) => Math.min(idx * sampleIntervalSec, videoDurationSec);

  // ── Merge any scene shorter than the floor into a neighbor ────────────────────
  const merged: RawScene[] = [];
  for (const scene of rawScenes) {
    const durationSec = idxToSec(scene.endIdx) - idxToSec(scene.startIdx);
    if (durationSec < minSceneDurationSec && merged.length > 0) {
      const prev = merged[merged.length - 1];
      prev.endIdx = scene.endIdx;
      prev.lowConfidence = true; // flag the merge for human review
    } else {
      merged.push({ ...scene });
    }
  }
  // If the very first scene is sub-floor (no predecessor to merge into), fold it
  // into the second scene instead.
  if (merged.length > 1) {
    const first = merged[0];
    const firstDuration = idxToSec(first.endIdx) - idxToSec(first.startIdx);
    if (firstDuration < minSceneDurationSec) {
      merged[1].startIdx = first.startIdx;
      merged[1].lowConfidence = true;
      merged.shift();
    }
  }

  return merged.map((s, i) => ({
    index: i,
    startSec: idxToSec(s.startIdx),
    endSec: i === merged.length - 1 ? videoDurationSec : idxToSec(s.endIdx),
    durationSec: (i === merged.length - 1 ? videoDurationSec : idxToSec(s.endIdx)) - idxToSec(s.startIdx),
    boundaryConfidence: s.lowConfidence ? 'low' : 'high',
  }));
}
