import { buildFingerprint } from '../FingerprintBuilder';
import type { DomSummary } from '../types';

// ── Factory helper ────────────────────────────────────────────────────────────

function makeSummary(overrides: Partial<DomSummary> = {}): DomSummary {
  return {
    headings:          [],
    visibleTextTokens: [],
    elementCounts: {
      tables:   0,
      canvases: 0,
      svgs:     0,
      forms:    0,
      lists:    0,
      buttons:  0,
      inputs:   0,
    },
    ariaRoleCounts: {},
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FingerprintBuilder', () => {

  // ── Test 1: Token sort order independence ─────────────────────────────────
  it('produces the same stableTextHash regardless of token order', () => {
    const summaryA = makeSummary({ visibleTextTokens: ['Overview', 'Analytics', 'Settings'] });
    const summaryB = makeSummary({ visibleTextTokens: ['Settings', 'Overview', 'Analytics'] });

    const fpA = buildFingerprint(summaryA);
    const fpB = buildFingerprint(summaryB);

    expect(fpA.stableTextHash).toBe(fpB.stableTextHash);
    expect(fpA.compositeHash).toBe(fpB.compositeHash);
  });

  // ── Test 2: Dynamic value (digit) stripping ───────────────────────────────
  it('produces the same stableTextHash when only digit values differ', () => {
    const summaryA = makeSummary({ visibleTextTokens: ['47', 'alerts', 'detected'] });
    const summaryB = makeSummary({ visibleTextTokens: ['52', 'alerts', 'detected'] });

    const fpA = buildFingerprint(summaryA);
    const fpB = buildFingerprint(summaryB);

    // "47" and "52" both strip to "" and are filtered out
    // "alerts detected" → identical normalised token sets
    expect(fpA.stableTextHash).toBe(fpB.stableTextHash);
  });

  // ── Test 3: Widget count propagation ─────────────────────────────────────
  it('reflects table count in widgetCounts.TABLE and affects compositeHash', () => {
    const summaryWith = makeSummary({ elementCounts: { tables: 2, canvases: 0, svgs: 0, forms: 0, lists: 0, buttons: 0, inputs: 0 } });
    const summaryWithout = makeSummary();

    const fpWith    = buildFingerprint(summaryWith);
    const fpWithout = buildFingerprint(summaryWithout);

    expect(fpWith.widgetCounts.TABLE).toBe(2);
    expect(fpWithout.widgetCounts.TABLE).toBe(0);
    expect(fpWith.compositeHash).not.toBe(fpWithout.compositeHash);
  });

  // ── Test 4: Heading structure order matters ────────────────────────────────
  it('produces different headingStructureHash when heading order differs', () => {
    const summaryA = makeSummary({
      headings: [{ level: 1, text: 'Dashboard' }, { level: 2, text: 'Devices' }],
    });
    const summaryB = makeSummary({
      headings: [{ level: 1, text: 'Devices' }, { level: 2, text: 'Dashboard' }],
    });

    const fpA = buildFingerprint(summaryA);
    const fpB = buildFingerprint(summaryB);

    expect(fpA.headingStructureHash).not.toBe(fpB.headingStructureHash);
    expect(fpA.compositeHash).not.toBe(fpB.compositeHash);
  });

  // ── Test 5: Empty summary ─────────────────────────────────────────────────
  it('handles empty DomSummary without throwing', () => {
    const fp = buildFingerprint(makeSummary());

    expect(fp.stableTextHash).toBeTruthy();       // SHA256 of empty string — not zero
    expect(fp.headingStructureHash).toBeTruthy();
    expect(fp.widgetCounts.TABLE).toBe(0);
    expect(fp.widgetCounts.CHART).toBe(0);
    expect(fp.interactiveCount).toBe(0);
    expect(fp.compositeHash).toBeTruthy();
  });

  // ── Test 6: Repeatability ─────────────────────────────────────────────────
  it('produces identical compositeHash when called twice with the same input', () => {
    const summary = makeSummary({
      headings:          [{ level: 1, text: 'Hello World' }],
      visibleTextTokens: ['foo', 'bar', 'baz'],
      elementCounts: {
        tables: 1, canvases: 1, svgs: 0, forms: 1,
        lists: 2, buttons: 3, inputs: 2,
      },
      ariaRoleCounts: { tab: 3, button: 2 },
    });

    const fp1 = buildFingerprint(summary);
    const fp2 = buildFingerprint(summary);

    expect(fp1.compositeHash).toBe(fp2.compositeHash);
    expect(fp1.stableTextHash).toBe(fp2.stableTextHash);
    expect(fp1.headingStructureHash).toBe(fp2.headingStructureHash);
  });

  // ── Extra: CHART counts canvases + non-hidden SVGs ─────────────────────────
  it('adds canvases and svgs into CHART widget count', () => {
    const summary = makeSummary({
      elementCounts: {
        tables: 0, canvases: 2, svgs: 1, forms: 0, lists: 0, buttons: 0, inputs: 0,
      },
    });
    const fp = buildFingerprint(summary);
    expect(fp.widgetCounts.CHART).toBe(3); // 2 canvases + 1 svg
  });

  // ── Extra: interactiveCount aggregates buttons + inputs + aria roles ───────
  it('aggregates buttons, inputs, and ARIA button/tab/menuitem counts into interactiveCount', () => {
    const summary = makeSummary({
      elementCounts: {
        tables: 0, canvases: 0, svgs: 0, forms: 0, lists: 0,
        buttons: 4,  // 4 <button> elements
        inputs:  2,  // 2 <input> elements
      },
      ariaRoleCounts: {
        button:   3,   // 3 [role="button"]
        tab:      2,   // 2 [role="tab"]
        menuitem: 1,   // 1 [role="menuitem"]
      },
    });
    const fp = buildFingerprint(summary);
    // 4 + 2 + 3 + 2 + 1 = 12
    expect(fp.interactiveCount).toBe(12);
  });
});
