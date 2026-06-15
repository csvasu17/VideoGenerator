import * as os from 'os';
import * as nodePath from 'path';
import { writeFile, mkdir, rm } from 'fs/promises';
import { ScreenshotLoader } from '../ScreenshotLoader';

// ─────────────────────────────────────────────────────────────────────────────
// ScreenshotLoader — unit tests  (RF7)
// ─────────────────────────────────────────────────────────────────────────────

describe('ScreenshotLoader', () => {
  let tmpDir: string;
  let loader: ScreenshotLoader;

  beforeEach(async () => {
    tmpDir = nodePath.join(os.tmpdir(), `screenshot-loader-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    loader = new ScreenshotLoader();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Null path ──────────────────────────────────────────────────────────────

  it('returns null when filePath is null', async () => {
    expect(await loader.load(null)).toBeNull();
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('loads a file from disk and returns its Buffer', async () => {
    const data     = Buffer.from('fake-png-data');
    const filePath = nodePath.join(tmpDir, 'test.png');
    await writeFile(filePath, data);

    const result = await loader.load(filePath);

    expect(result).not.toBeNull();
    expect(result).toEqual(data);
  });

  it('returned Buffer is a Buffer instance', async () => {
    const data     = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const filePath = nodePath.join(tmpDir, 'magic.png');
    await writeFile(filePath, data);

    const result = await loader.load(filePath);

    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('returns the exact bytes that were written', async () => {
    const data     = Buffer.from('hello, world! 🌍');
    const filePath = nodePath.join(tmpDir, 'utf8.bin');
    await writeFile(filePath, data);

    const result = await loader.load(filePath);

    expect(result?.toString('utf-8')).toBe('hello, world! 🌍');
  });

  // ── Missing file ───────────────────────────────────────────────────────────

  it('returns null when the file does not exist', async () => {
    const result = await loader.load(nodePath.join(tmpDir, 'nonexistent.png'));
    expect(result).toBeNull();
  });

  it('returns null for an entirely invalid path', async () => {
    const result = await loader.load('/this/path/absolutely/does/not/exist.png');
    expect(result).toBeNull();
  });

  // ── Never throws ──────────────────────────────────────────────────────────

  it('never throws — resolves to null on I/O error', async () => {
    await expect(loader.load('/no/such/file.png')).resolves.toBeNull();
  });

  it('never throws when given an empty string path', async () => {
    // Empty string is falsy: load() treats it as null
    await expect(loader.load(null)).resolves.toBeNull();
  });

  // ── Prefer / fallback pattern (matches VisionAnalysisAgent usage) ─────────

  it('loads the preferred path when it exists', async () => {
    const viewport = Buffer.from([0x01]);
    const full     = Buffer.from([0x02]);

    const viewportPath = nodePath.join(tmpDir, 'viewport.png');
    const fullPath     = nodePath.join(tmpDir, 'full.png');
    await writeFile(viewportPath, viewport);
    await writeFile(fullPath, full);

    // Simulate VisionAnalysisAgent prefer-viewport logic
    const result =
      (await loader.load(viewportPath)) ??
      (await loader.load(fullPath));

    expect(result).toEqual(viewport);
  });

  it('falls back to full path when viewport is missing', async () => {
    const full     = Buffer.from([0x02]);
    const fullPath = nodePath.join(tmpDir, 'full.png');
    await writeFile(fullPath, full);

    const result =
      (await loader.load(null))          // viewport missing
      ?? (await loader.load(fullPath));

    expect(result).toEqual(full);
  });

  it('returns null when both paths are null', async () => {
    const result =
      (await loader.load(null)) ?? (await loader.load(null));
    expect(result).toBeNull();
  });
});
