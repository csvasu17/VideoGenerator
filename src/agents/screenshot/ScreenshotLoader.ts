// ─────────────────────────────────────────────────────────────────────────────
// ScreenshotLoader  (RF7 — on-demand disk read)
//
// VisionAnalysisAgent injects this instead of carrying Buffers between the
// capture stage and the analysis stage.  The Buffer exists only for the
// duration of a single page analysis call, keeping resident memory O(1).
// ─────────────────────────────────────────────────────────────────────────────

import { readFile } from 'fs/promises';

export class ScreenshotLoader {
  /**
   * Read a screenshot Buffer from disk on demand.
   *
   * @param filePath  Absolute path stored in `ScreenshotData.fullPath` or
   *                  `viewportPath`, or null when capture failed.
   * @returns         The raw image Buffer, or null when `filePath` is null or
   *                  the file cannot be read for any reason.
   *
   * Never throws — a missing or unreadable file is treated as "no screenshot".
   */
  async load(filePath: string | null): Promise<Buffer | null> {
    if (!filePath) return null;
    try {
      return await readFile(filePath);
    } catch {
      return null;
    }
  }
}
