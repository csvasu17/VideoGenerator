import { compare } from '../StateComparator';
import type { PageInteractionState } from '../types';

// ── Factory helpers ───────────────────────────────────────────────────────────

function makeState(overrides: Partial<{
  screenshotHash:   string;
  compositeHash:    string;
  tables:           number;
  canvases:         number;
  svgs:             number;
  forms:            number;
  lists:            number;
  headingCount:     number;
  buttons:          number;
  inputs:           number;
  tokens:           string[];
}>  = {}): PageInteractionState {

  const tables   = overrides.tables   ?? 0;
  const canvases = overrides.canvases ?? 0;
  const svgs     = overrides.svgs     ?? 0;
  const forms    = overrides.forms    ?? 0;
  const lists    = overrides.lists    ?? 0;
  const buttons  = overrides.buttons  ?? 0;
  const inputs   = overrides.inputs   ?? 0;

  const widgetCounts = {
    TABLE:   tables,
    CHART:   canvases + svgs,
    FORM:    forms,
    LIST:    lists,
    UNKNOWN: 0,
  };

  const headings = Array.from({ length: overrides.headingCount ?? 0 }, (_, i) => ({
    level: 2,
    text:  `Heading ${i + 1}`,
  }));

  return {
    id:              'state-test',
    pageUrl:         'https://app.test/page',
    interactionPath: [],
    depth:           0,
    screenshotPath:  '/tmp/test.png',
    screenshotHash:  overrides.screenshotHash   ?? 'hash-base',
    domSummary: {
      headings,
      visibleTextTokens: overrides.tokens ?? [],
      elementCounts: { tables, canvases, svgs, forms, lists, buttons, inputs },
      ariaRoleCounts: {},
    },
    fingerprint: {
      stableTextHash:       'text-hash',
      headingStructureHash: 'heading-hash',
      widgetCounts,
      interactiveCount:     buttons + inputs,
      compositeHash:        overrides.compositeHash ?? 'composite-base',
    },
    capturedAt: Date.now(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('StateComparator', () => {

  // ── Test 1: Identical screenshot → not meaningful ─────────────────────────
  it('returns isMeaningful:false when screenshotHash is identical', () => {
    const base      = makeState({ screenshotHash: 'same-hash' });
    const candidate = makeState({ screenshotHash: 'same-hash' });
    const delta = compare(base, candidate);

    expect(delta.isMeaningful).toBe(false);
    expect(delta.screenshotIdentical).toBe(true);
    expect(delta.functionalScore).toBe(0);
    expect(delta.reason).toMatch(/identical/i);
  });

  // ── Test 2: Different screenshot, identical fingerprint → not meaningful ──
  it('returns isMeaningful:false when compositeHash is identical but screenshot differs', () => {
    const base      = makeState({ screenshotHash: 'hash-a', compositeHash: 'fp-same' });
    const candidate = makeState({ screenshotHash: 'hash-b', compositeHash: 'fp-same' });
    const delta = compare(base, candidate);

    expect(delta.isMeaningful).toBe(false);
    expect(delta.screenshotIdentical).toBe(false);
    expect(delta.fingerprintIdentical).toBe(true);
    expect(delta.functionalScore).toBe(0);
  });

  // ── Test 3: Candidate adds one TABLE widget → meaningful ─────────────────
  it('detects an added TABLE widget and scores it as meaningful', () => {
    const base      = makeState({ tables: 0 });
    const candidate = makeState({ tables: 1, screenshotHash: 'hash-candidate', compositeHash: 'fp-candidate' });
    const delta = compare(base, candidate);

    expect(delta.addedWidgetTypes).toContain('TABLE');
    expect(delta.functionalScore).toBeGreaterThanOrEqual(0.20);
    expect(delta.isMeaningful).toBe(true);
    // widget score = min(1, 1/2) = 0.5 → 0.5 * 0.40 = 0.20 exactly
    expect(delta.functionalScore).toBeCloseTo(0.20, 2);
  });

  // ── Test 4: Candidate adds 4 new headings → meaningful ───────────────────
  it('detects 4 new headings and scores appropriately', () => {
    const base      = makeState({ headingCount: 1 });
    const candidate = makeState({
      headingCount:  5,
      screenshotHash: 'hash-c',
      compositeHash:  'fp-c',
    });
    const delta = compare(base, candidate);

    expect(delta.newHeadingCount).toBe(4);
    // headingScore = min(1, 4/3) = 1.0 → 1.0 * 0.25 = 0.25
    expect(delta.functionalScore).toBeCloseTo(0.25, 2);
    expect(delta.isMeaningful).toBe(true);
  });

  // ── Test 5: 60 new text tokens only → NOT meaningful (text alone < 0.20) ──
  it('does not mark as meaningful when only text tokens are added (score < threshold)', () => {
    const baseTokens = Array.from({ length: 10 }, (_, i) => `word${i}`);
    const newTokens  = Array.from({ length: 60 }, (_, i) => `unique${i}`);
    const base      = makeState({ tokens: baseTokens });
    const candidate = makeState({
      tokens:         [...baseTokens, ...newTokens],
      screenshotHash: 'hash-d',
      compositeHash:  'fp-d',
    });
    const delta = compare(base, candidate);

    // textScore = min(1, 60/50) = 1.0 → 1.0 * 0.15 = 0.15 → below 0.20
    expect(delta.textTokenAddedCount).toBeGreaterThanOrEqual(60);
    expect(delta.functionalScore).toBeCloseTo(0.15, 2);
    expect(delta.isMeaningful).toBe(false);
  });

  // ── Test 6: TABLE + 3 headings → meaningful with high score ───────────────
  it('combines widget and heading signals for a high composite score', () => {
    const base      = makeState({ headingCount: 1 });
    const candidate = makeState({
      tables:        1,
      headingCount:  4,
      screenshotHash: 'hash-e',
      compositeHash:  'fp-e',
    });
    const delta = compare(base, candidate);

    // widgetScore = 0.5 → 0.40 * 0.5 = 0.20
    // headingScore = min(1, 3/3) = 1.0 → 0.25 * 1.0 = 0.25
    // total ≈ 0.45
    expect(delta.functionalScore).toBeGreaterThan(0.40);
    expect(delta.isMeaningful).toBe(true);
    expect(delta.addedWidgetTypes).toContain('TABLE');
    expect(delta.newHeadingCount).toBe(3);
  });

  // ── Test 7: Custom threshold respected ────────────────────────────────────
  it('respects a custom threshold — same inputs, threshold 0.50 → not meaningful', () => {
    const base      = makeState({ tables: 0 });
    const candidate = makeState({ tables: 1, screenshotHash: 'hash-f', compositeHash: 'fp-f' });

    const delta020 = compare(base, candidate, 0.20);
    const delta050 = compare(base, candidate, 0.50);

    expect(delta020.isMeaningful).toBe(true);   // 0.20 score >= 0.20
    expect(delta050.isMeaningful).toBe(false);  // 0.20 score < 0.50
  });

  // ── Test 8: Fewer widgets in candidate → no negative scores ───────────────
  it('does not produce negative functionalScore when candidate has fewer widgets', () => {
    const base      = makeState({ tables: 3, canvases: 2 });
    const candidate = makeState({
      tables:        0,
      canvases:      0,
      screenshotHash: 'hash-g',
      compositeHash:  'fp-g',
    });
    const delta = compare(base, candidate);

    expect(delta.addedWidgetTypes).toHaveLength(0);
    expect(delta.functionalScore).toBeGreaterThanOrEqual(0);
    // With no added widgets or headings, functional score should be very low
    expect(delta.functionalScore).toBeLessThan(0.20);
  });

  // ── Extra: reason string is populated ────────────────────────────────────
  it('populates a non-empty reason string for every delta', () => {
    const base      = makeState();
    const candidate = makeState({ tables: 1, screenshotHash: 'h-h', compositeHash: 'fp-h' });
    const delta = compare(base, candidate);
    expect(typeof delta.reason).toBe('string');
    expect(delta.reason.length).toBeGreaterThan(0);
  });
});
