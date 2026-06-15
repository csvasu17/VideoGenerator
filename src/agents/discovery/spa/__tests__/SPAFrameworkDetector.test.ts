import { SPAFrameworkDetector } from '../SPAFrameworkDetector';
import type { SPADetectionResult } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makePage(result: Partial<SPADetectionResult> & { framework?: string }) {
  return {
    evaluate: jest.fn().mockResolvedValue({
      framework:     result.framework ?? 'unknown',
      isHashBased:   result.isHashBased ?? false,
      confidence:    result.confidence  ?? 'low',
      routerVersion: result.routerVersion,
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SPAFrameworkDetector
// ─────────────────────────────────────────────────────────────────────────────

describe('SPAFrameworkDetector', () => {
  let detector: SPAFrameworkDetector;

  beforeEach(() => { detector = new SPAFrameworkDetector(); });

  // ── Next.js ────────────────────────────────────────────────────────────────

  describe('Next.js detection', () => {
    it('returns next.js with high confidence when __NEXT_DATA__ is present', async () => {
      const page = makePage({ framework: 'next.js', confidence: 'high', isHashBased: false });
      const result = await detector.detect(page as never);
      expect(result.framework).toBe('next.js');
      expect(result.confidence).toBe('high');
      expect(result.isHashBased).toBe(false);
    });

    it('includes routerVersion when provided by the page', async () => {
      const page = makePage({ framework: 'next.js', confidence: 'high', routerVersion: '13.5.0' });
      const result = await detector.detect(page as never);
      expect(result.routerVersion).toBe('13.5.0');
    });

    it('returns medium confidence from secondary signals (script src)', async () => {
      const page = makePage({ framework: 'next.js', confidence: 'medium' });
      const result = await detector.detect(page as never);
      expect(result.confidence).toBe('medium');
    });
  });

  // ── React Router ───────────────────────────────────────────────────────────

  describe('React Router detection', () => {
    it('returns react-router with high confidence', async () => {
      const page = makePage({ framework: 'react-router', confidence: 'high' });
      const result = await detector.detect(page as never);
      expect(result.framework).toBe('react-router');
      expect(result.confidence).toBe('high');
    });

    it('returns react-router with medium confidence for heuristic signals', async () => {
      const page = makePage({ framework: 'react-router', confidence: 'medium' });
      const result = await detector.detect(page as never);
      expect(result.framework).toBe('react-router');
      expect(result.confidence).toBe('medium');
    });
  });

  // ── Vue Router ─────────────────────────────────────────────────────────────

  describe('Vue Router detection', () => {
    it('returns vue-router with high confidence when __vue_router__ is present', async () => {
      const page = makePage({ framework: 'vue-router', confidence: 'high' });
      const result = await detector.detect(page as never);
      expect(result.framework).toBe('vue-router');
      expect(result.confidence).toBe('high');
    });

    it('returns vue-router version when available', async () => {
      const page = makePage({ framework: 'vue-router', confidence: 'high', routerVersion: '4.2.0' });
      const result = await detector.detect(page as never);
      expect(result.routerVersion).toBe('4.2.0');
    });
  });

  // ── Angular Router ─────────────────────────────────────────────────────────

  describe('Angular Router detection', () => {
    it('returns angular-router with high confidence', async () => {
      const page = makePage({ framework: 'angular-router', confidence: 'high', isHashBased: false });
      const result = await detector.detect(page as never);
      expect(result.framework).toBe('angular-router');
      expect(result.confidence).toBe('high');
    });

    it('sets isHashBased true when Angular hash-location strategy is active', async () => {
      const page = makePage({ framework: 'angular-router', confidence: 'high', isHashBased: true });
      const result = await detector.detect(page as never);
      expect(result.isHashBased).toBe(true);
    });

    it('includes ng-version when available', async () => {
      const page = makePage({ framework: 'angular-router', confidence: 'high', routerVersion: '16.0.0' });
      const result = await detector.detect(page as never);
      expect(result.routerVersion).toBe('16.0.0');
    });
  });

  // ── Unknown / fallback ─────────────────────────────────────────────────────

  describe('unknown framework', () => {
    it('returns unknown with low confidence for a plain server-rendered page', async () => {
      const page = makePage({ framework: 'unknown', confidence: 'low' });
      const result = await detector.detect(page as never);
      expect(result.framework).toBe('unknown');
      expect(result.confidence).toBe('low');
    });

    it('never throws when page.evaluate() rejects', async () => {
      const page = { evaluate: jest.fn().mockRejectedValue(new Error('page crashed')) };
      const result = await detector.detect(page as never);
      expect(result.framework).toBe('unknown');
      expect(result.confidence).toBe('low');
      expect(result.isHashBased).toBe(false);
    });
  });

  // ── Invalid / unrecognised framework values ────────────────────────────────

  describe('sanitisation', () => {
    it('maps unrecognised framework strings to "unknown"', async () => {
      const page = { evaluate: jest.fn().mockResolvedValue({ framework: 'svelte', confidence: 'high', isHashBased: false }) };
      const result = await detector.detect(page as never);
      expect(result.framework).toBe('unknown');
    });

    it('maps unrecognised confidence strings to "low"', async () => {
      const page = { evaluate: jest.fn().mockResolvedValue({ framework: 'next.js', confidence: 'super-high', isHashBased: false }) };
      const result = await detector.detect(page as never);
      expect(result.confidence).toBe('low');
    });
  });
});
