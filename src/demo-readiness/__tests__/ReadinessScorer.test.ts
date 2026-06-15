// ─────────────────────────────────────────────────────────────────────────────
// ReadinessScorer test suite
//
// Covers:
//   §1  AuthScreenDetector  — URL patterns, title patterns, form composition
//   §2  EmptyStateDetector  — zero features, empty text patterns
//   §3  SettingsDetector    — URL/title/category patterns
//   §4  PlaceholderDetector — filler text, repeated labels, low priority
//   §5  ValueScreenClassifier — KPI, analytics, AI, simulation, alerts, tiers
//   §6  DuplicateDetector   — similarity computation and penalty application
//   §7  ReadinessScorer     — end-to-end; Rheem Phase 6 scenario pages
//   §8  Minimum scene guarantee — borderline promotion logic
// ─────────────────────────────────────────────────────────────────────────────

import { AuthScreenDetector }    from '../signals/AuthScreenDetector';
import { EmptyStateDetector }    from '../signals/EmptyStateDetector';
import { SettingsDetector }      from '../signals/SettingsDetector';
import { PlaceholderDetector }   from '../signals/PlaceholderDetector';
import { ValueScreenClassifier } from '../signals/ValueScreenClassifier';
import { DuplicateDetector }     from '../DuplicateDetector';
import { ReadinessScorer }       from '../ReadinessScorer';
import type {
  ScoringContext,
  ReadinessResult,
} from '../../core/domain/entities/ReadinessResult';
import type { VisualFeature, KPIWidget, ActionSignal } from '../../core/domain/entities/PageIntelligence';
import type { NodeType } from '../../discovery/graph/types';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeFeature(featureName: string, importanceScore = 65, businessValue = 'Improves operations'): VisualFeature {
  return { featureName, businessValue, importanceScore, recommendations: [] };
}

function makeKPI(label: string, value = '42'): KPIWidget {
  return { label, value, trend: 'up' };
}

function makeAction(label: string, impactLevel: ActionSignal['impactLevel'] = 'medium'): ActionSignal {
  return { label, intent: 'Navigate', impactLevel };
}

function makeContext(overrides: Partial<ScoringContext> = {}): ScoringContext {
  return {
    pageId:                 'page-1',
    url:                    'http://localhost:3000/dashboard',
    title:                  'Dashboard',
    pageCategory:           'dashboard',
    pagePurpose:            'Main application dashboard showing operational KPIs',
    overallImportanceScore: 70,
    features:               [],
    kpiWidgets:             [],
    importantActions:       [],
    formCount:              0,
    inputCount:             0,
    buttonCount:            1,
    headings:               [],
    nodeType:               'dashboard',
    pageDepth:              1,
    topFeatureComposite:    65,
    pageFeatureCount:       3,
    businessBenefits:       [],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §1  AuthScreenDetector
// ─────────────────────────────────────────────────────────────────────────────

describe('AuthScreenDetector', () => {
  it('detects /login URL segment with confidence 0.95', () => {
    const ctx = makeContext({ url: 'http://localhost:3000/login' });
    const signals = AuthScreenDetector.detect(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('auth_screen');
    expect(signals[0].source).toBe('url');
    expect(signals[0].confidence).toBe(0.95);
  });

  it('detects /signin URL segment', () => {
    const ctx = makeContext({ url: 'http://localhost:3000/signin' });
    const signals = AuthScreenDetector.detect(ctx);
    expect(signals.some(s => s.type === 'auth_screen')).toBe(true);
  });

  it('detects /auth path', () => {
    const ctx = makeContext({ url: 'http://localhost:3000/auth/callback' });
    const signals = AuthScreenDetector.detect(ctx);
    expect(signals.some(s => s.source === 'url')).toBe(true);
  });

  it('detects "Login" page title', () => {
    const ctx = makeContext({ title: 'Login — MyApp' });
    const signals = AuthScreenDetector.detect(ctx);
    expect(signals.some(s => s.type === 'auth_screen' && s.source === 'title')).toBe(true);
  });

  it('detects Rheem "Early Access" title pattern', () => {
    const ctx = makeContext({ title: 'TotalView Early Access' });
    const signals = AuthScreenDetector.detect(ctx);
    expect(signals.some(s => s.type === 'auth_screen')).toBe(true);
  });

  it('detects nodeType=entry with form composition', () => {
    const ctx = makeContext({ nodeType: 'entry', formCount: 1, inputCount: 3 });
    const signals = AuthScreenDetector.detect(ctx);
    expect(signals.some(s => s.source === 'graph')).toBe(true);
  });

  it('emits no signals for a normal dashboard URL', () => {
    const ctx = makeContext({ url: 'http://localhost:3000/dashboard', title: 'Dashboard' });
    const signals = AuthScreenDetector.detect(ctx);
    expect(signals).toHaveLength(0);
  });

  it('emits no signals for an analytics page', () => {
    const ctx = makeContext({ url: 'http://localhost:3000/analytics', title: 'Energy Analytics' });
    const signals = AuthScreenDetector.detect(ctx);
    expect(signals).toHaveLength(0);
  });

  it('detects /forgot-password URL', () => {
    const ctx = makeContext({ url: 'http://localhost:3000/forgot-password' });
    const signals = AuthScreenDetector.detect(ctx);
    expect(signals.some(s => s.type === 'auth_screen')).toBe(true);
  });

  it('detects /mfa URL', () => {
    const ctx = makeContext({ url: 'http://localhost:3000/mfa' });
    const signals = AuthScreenDetector.detect(ctx);
    expect(signals.some(s => s.type === 'auth_screen')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2  EmptyStateDetector
// ─────────────────────────────────────────────────────────────────────────────

describe('EmptyStateDetector', () => {
  it('emits zero-features signal when features array is empty', () => {
    const ctx = makeContext({ features: [], kpiWidgets: [] });
    const signals = EmptyStateDetector.detect(ctx);
    expect(signals.some(s => s.evidence.includes('zero features'))).toBe(true);
  });

  it('emits zero-KPI signal when both features and kpiWidgets are empty', () => {
    const ctx = makeContext({ features: [], kpiWidgets: [] });
    const signals = EmptyStateDetector.detect(ctx);
    expect(signals.some(s => s.evidence.includes('zero KPI'))).toBe(true);
  });

  it('detects "No device selected" in pagePurpose', () => {
    const ctx = makeContext({ pagePurpose: 'No device selected. No devices match current filter.' });
    const signals = EmptyStateDetector.detect(ctx);
    expect(signals.some(s => s.evidence.includes('pagePurpose'))).toBe(true);
  });

  it('detects "no data" in headings', () => {
    const ctx = makeContext({ headings: ['No data available'] });
    const signals = EmptyStateDetector.detect(ctx);
    expect(signals.some(s => s.evidence.includes('Heading'))).toBe(true);
  });

  it('detects empty-state in feature names', () => {
    const ctx = makeContext({
      features: [makeFeature('No results found', 5)],
    });
    const signals = EmptyStateDetector.detect(ctx);
    expect(signals.some(s => s.evidence.includes('Feature name'))).toBe(true);
  });

  it('emits no signals for a well-populated dashboard', () => {
    const ctx = makeContext({
      features:  [makeFeature('Energy KPI Card', 80), makeFeature('Site Overview Chart', 75)],
      kpiWidgets: [makeKPI('Energy Cost'), makeKPI('Active Sites')],
      overallImportanceScore: 75,
    });
    const signals = EmptyStateDetector.detect(ctx);
    // Only importance signal might fire if other conditions met — but should be empty for rich page
    const negatives = signals.filter(s => s.weight < -0.50);
    expect(negatives).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3  SettingsDetector
// ─────────────────────────────────────────────────────────────────────────────

describe('SettingsDetector', () => {
  it('detects /settings URL', () => {
    const ctx = makeContext({ url: 'http://localhost:3000/settings' });
    const signals = SettingsDetector.detect(ctx);
    expect(signals.some(s => s.type === 'settings_screen' && s.source === 'url')).toBe(true);
    expect(signals[0].confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('detects /admin URL', () => {
    const ctx = makeContext({ url: 'http://localhost:3000/admin' });
    const signals = SettingsDetector.detect(ctx);
    expect(signals.some(s => s.source === 'url')).toBe(true);
  });

  it('detects "Settings" title', () => {
    const ctx = makeContext({ title: 'Settings — TotalView' });
    const signals = SettingsDetector.detect(ctx);
    expect(signals.some(s => s.source === 'title')).toBe(true);
  });

  it('detects "Restore Demo DB" title (Rheem specific)', () => {
    const ctx = makeContext({ title: 'Restore Demo DB' });
    const signals = SettingsDetector.detect(ctx);
    expect(signals.some(s => s.type === 'settings_screen')).toBe(true);
  });

  it('detects pageCategory=settings', () => {
    const ctx = makeContext({ pageCategory: 'settings' });
    const signals = SettingsDetector.detect(ctx);
    expect(signals.some(s => s.evidence.includes("category='settings'"))).toBe(true);
  });

  it('detects nodeType=settings', () => {
    const ctx = makeContext({ nodeType: 'settings' as NodeType });
    const signals = SettingsDetector.detect(ctx);
    expect(signals.some(s => s.source === 'graph')).toBe(true);
  });

  it('emits no signals for a dashboard page', () => {
    const ctx = makeContext({
      url: 'http://localhost:3000/dashboard',
      title: 'Energy Dashboard',
      pageCategory: 'dashboard',
      nodeType: 'dashboard',
    });
    const signals = SettingsDetector.detect(ctx);
    expect(signals).toHaveLength(0);
  });

  it('emits no signals for an analytics page', () => {
    const ctx = makeContext({
      url: 'http://localhost:3000/analytics/energy',
      title: 'Energy Analytics',
      pageCategory: 'analytics',
    });
    const signals = SettingsDetector.detect(ctx);
    expect(signals).toHaveLength(0);
  });

  it('detects DOM form-heavy page with no KPI widgets (Evidence 6)', () => {
    // Interaction-state capture of a create/add form where vision extracted
    // generic feature names — DOM data identifies it as a data-entry page.
    const ctx = makeContext({
      url:        'http://localhost:5173/simulator/create',
      title:      'Create Simulation',
      pageCategory: 'form',
      formCount:  1,
      inputCount: 4,
      kpiWidgets: [],
      features:   [makeFeature('Rheem TotalView', 40)],
    });
    const signals = SettingsDetector.detect(ctx);
    const domSig = signals.find(s => s.source === 'dom' && s.type === 'settings_screen');
    expect(domSig).toBeDefined();
    expect(domSig?.weight).toBe(-0.30);
    expect(domSig?.confidence).toBe(0.65);
    expect(domSig?.evidence).toContain('1 form(s) with 4 inputs');
  });

  it('does NOT flag a form page that also has KPI widgets', () => {
    // A device-add form alongside live KPIs — not a pure data-entry page.
    const ctx = makeContext({
      url:        'http://localhost:5173/devices/add',
      title:      'Add Device',
      formCount:  1,
      inputCount: 4,
      kpiWidgets: [makeKPI('Active Devices', '42')],
      features:   [makeFeature('Device Config', 50)],
    });
    const signals = SettingsDetector.detect(ctx);
    expect(signals.some(s => s.source === 'dom' && s.type === 'settings_screen')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4  PlaceholderDetector
// ─────────────────────────────────────────────────────────────────────────────

describe('PlaceholderDetector', () => {
  it('detects "Lorem ipsum" in feature name', () => {
    const ctx = makeContext({ features: [makeFeature('Lorem ipsum dolor')] });
    const signals = PlaceholderDetector.detect(ctx);
    expect(signals.some(s => s.type === 'placeholder_content')).toBe(true);
    expect(signals[0].confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('detects "Coming Soon" in feature name', () => {
    const ctx = makeContext({ features: [makeFeature('Coming Soon')] });
    const signals = PlaceholderDetector.detect(ctx);
    expect(signals.some(s => s.type === 'placeholder_content')).toBe(true);
  });

  it('detects "TBD" in pagePurpose', () => {
    const ctx = makeContext({ pagePurpose: 'This section is TBD' });
    const signals = PlaceholderDetector.detect(ctx);
    expect(signals.some(s => s.type === 'placeholder_content')).toBe(true);
  });

  it('detects repeated generic labels (>60% same name)', () => {
    const ctx = makeContext({
      features: [
        makeFeature('button'), makeFeature('button'), makeFeature('button'),
        makeFeature('label'),
      ],
    });
    const signals = PlaceholderDetector.detect(ctx);
    expect(signals.some(s => s.evidence.includes('share label'))).toBe(true);
  });

  it('detects universally low priority', () => {
    const ctx = makeContext({
      pageFeatureCount: 3,
      topFeatureComposite: 18,  // below 25 threshold
      features: [makeFeature('Generic Widget', 10)],
    });
    const signals = PlaceholderDetector.detect(ctx);
    expect(signals.some(s => s.evidence.includes('composite score'))).toBe(true);
  });

  it('emits no signals for real feature names', () => {
    const ctx = makeContext({
      features: [
        makeFeature('Energy Cost Overview', 80),
        makeFeature('Fault Injection Panel', 85),
        makeFeature('Active Alarm Count', 75),
      ],
      pagePurpose: 'Dashboard showing energy KPIs and alarm status',
      topFeatureComposite: 78,
      pageFeatureCount: 3,
    });
    const signals = PlaceholderDetector.detect(ctx);
    expect(signals).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5  ValueScreenClassifier
// ─────────────────────────────────────────────────────────────────────────────

describe('ValueScreenClassifier', () => {
  describe('KPI Dashboard', () => {
    it('emits kpi_dashboard signal for 2+ KPI widgets', () => {
      const ctx = makeContext({
        kpiWidgets: [makeKPI('Energy Cost'), makeKPI('Active Alarms')],
      });
      const signals = ValueScreenClassifier.classify(ctx);
      expect(signals.some(s => s.type === 'kpi_dashboard')).toBe(true);
    });

    it('emits kpi_dashboard signal for 2+ kpi/metric features', () => {
      const ctx = makeContext({
        features: [makeFeature('KPI Card — Energy'), makeFeature('KPI Card — Cost')],
      });
      const signals = ValueScreenClassifier.classify(ctx);
      expect(signals.some(s => s.type === 'kpi_dashboard')).toBe(true);
    });

    it('emits weaker kpi signal for single KPI', () => {
      const ctx = makeContext({ kpiWidgets: [makeKPI('Energy Cost')] });
      const signals = ValueScreenClassifier.classify(ctx);
      const kpiSig = signals.find(s => s.type === 'kpi_dashboard');
      expect(kpiSig).toBeDefined();
      expect(kpiSig!.weight).toBeLessThan(0.35);
    });
  });

  describe('Analytics Chart', () => {
    it('emits analytics_chart signal for chart feature', () => {
      const ctx = makeContext({ features: [makeFeature('Energy Trend Chart', 80)] });
      const signals = ValueScreenClassifier.classify(ctx);
      expect(signals.some(s => s.type === 'analytics_chart')).toBe(true);
    });

    it('emits analytics signal for analytics URL', () => {
      const ctx = makeContext({ url: 'http://localhost:3000/analytics/energy' });
      const signals = ValueScreenClassifier.classify(ctx);
      expect(signals.some(s => s.type === 'analytics_chart' || s.type === 'demo_value_tier')).toBe(true);
    });
  });

  describe('AI Insight', () => {
    it('emits ai_insight signal for AI prediction feature', () => {
      const ctx = makeContext({
        features: [makeFeature('AI Equipment Failure Prediction', 90)],
      });
      const signals = ValueScreenClassifier.classify(ctx);
      expect(signals.some(s => s.type === 'ai_insight')).toBe(true);
    });

    it('emits ai_insight for anomaly detection feature', () => {
      const ctx = makeContext({ features: [makeFeature('Anomaly Detection Alert')] });
      const signals = ValueScreenClassifier.classify(ctx);
      expect(signals.some(s => s.type === 'ai_insight')).toBe(true);
    });

    it('emits ai_insight for "at-risk equipment" feature', () => {
      const ctx = makeContext({ features: [makeFeature('At-Risk Equipment List')] });
      const signals = ValueScreenClassifier.classify(ctx);
      expect(signals.some(s => s.type === 'ai_insight')).toBe(true);
    });
  });

  describe('Simulation', () => {
    it('emits simulation signal for "fault injection" feature', () => {
      const ctx = makeContext({
        features: [makeFeature('Fault Injection Button', 85)],
      });
      const signals = ValueScreenClassifier.classify(ctx);
      expect(signals.some(s => s.type === 'simulation')).toBe(true);
    });

    it('emits simulation signal for cockpit URL', () => {
      const ctx = makeContext({ url: 'http://localhost:3000/totalview/cockpit' });
      const signals = ValueScreenClassifier.classify(ctx);
      expect(signals.some(s => s.type === 'simulation')).toBe(true);
    });

    it('emits simulation signal for "scenario" feature', () => {
      const ctx = makeContext({ features: [makeFeature('Comm Loss Scenario')] });
      const signals = ValueScreenClassifier.classify(ctx);
      expect(signals.some(s => s.type === 'simulation')).toBe(true);
    });
  });

  describe('Alert Feed', () => {
    it('emits alert_feed signal for alarm feature', () => {
      const ctx = makeContext({ features: [makeFeature('Critical Alarm List', 80)] });
      const signals = ValueScreenClassifier.classify(ctx);
      expect(signals.some(s => s.type === 'alert_feed')).toBe(true);
    });

    it('emits alert_feed signal for 2+ alarm KPI widgets', () => {
      const ctx = makeContext({
        kpiWidgets: [makeKPI('Active Alarms'), makeKPI('Critical Faults')],
      });
      const signals = ValueScreenClassifier.classify(ctx);
      expect(signals.some(s => s.type === 'alert_feed')).toBe(true);
    });
  });

  describe('Demo Value Tier', () => {
    it('classifies Digital Twin / Simulator as Tier 1', () => {
      const ctx = makeContext({
        url:      'http://localhost:3000/totalview/cockpit',
        features: [makeFeature('Fault Injection Button', 90)],
      });
      const signals = ValueScreenClassifier.classify(ctx);
      const tier = signals.find(s => s.type === 'demo_value_tier');
      expect(tier).toBeDefined();
      expect(tier!.weight).toBeCloseTo(0.30);
    });

    it('classifies KPI Dashboard as Tier 2', () => {
      const ctx = makeContext({
        url:        'http://localhost:3000/dashboard',
        kpiWidgets: [makeKPI('Energy'), makeKPI('Cost'), makeKPI('Savings')],
      });
      const signals = ValueScreenClassifier.classify(ctx);
      const tier = signals.find(s => s.type === 'demo_value_tier');
      expect(tier).toBeDefined();
      expect(tier!.weight).toBeCloseTo(0.20);
    });

    it('classifies Sites list as Tier 3', () => {
      const ctx = makeContext({
        url:          'http://localhost:3000/sites',
        title:        'Sites Directory',    // avoid 'Dashboard' default triggering Tier 2
        pageCategory: 'list',
        nodeType:     'list',
      });
      const signals = ValueScreenClassifier.classify(ctx);
      const tier = signals.find(s => s.type === 'demo_value_tier');
      expect(tier).toBeDefined();
      expect(tier!.weight).toBeCloseTo(0.05);
    });

    it('emits no tier signal for a neutral generic page', () => {
      const ctx = makeContext({
        url:          'http://localhost:3000/contact',
        title:        'Contact',
        pageCategory: 'generic',
        features:     [],
        kpiWidgets:   [],
      });
      const signals = ValueScreenClassifier.classify(ctx);
      const tier = signals.find(s => s.type === 'demo_value_tier');
      expect(tier).toBeUndefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6  DuplicateDetector
// ─────────────────────────────────────────────────────────────────────────────

describe('DuplicateDetector', () => {
  function makeResult(
    overrides: Partial<ReadinessResult> & { pageId: string },
  ): ReadinessResult {
    return {
      url:             'http://localhost:3000/alarms',
      title:           'Alarms',
      readinessScore:  0.80,
      confidence:      0.75,
      verdict:         'pass',
      category:        'high_value',
      demoValueTier:   'tier2',
      rejectionReason: null,
      signals:         [],
      ...overrides,
    };
  }

  it('penalises the lower-scoring near-duplicate (similarity > 0.85)', () => {
    const alarmPage1 = makeResult({ pageId: 'alarm-1', readinessScore: 0.85 });
    const alarmPage2 = makeResult({ pageId: 'alarm-2', readinessScore: 0.80 });

    const ctx1 = makeContext({
      pageId: 'alarm-1',
      url:    'http://localhost:3000/totalview/alarms',
      features: [makeFeature('Active Alarm Grid'), makeFeature('Critical Alarm Count')],
      kpiWidgets: [makeKPI('Active Alarms')],
      pageCategory: 'list',
    });
    const ctx2 = makeContext({
      pageId: 'alarm-2',
      url:    'http://localhost:3000/totalview/alarms',  // same URL
      features: [makeFeature('Active Alarm Grid'), makeFeature('Critical Alarm Count')],
      kpiWidgets: [makeKPI('Active Alarms')],
      pageCategory: 'list',
    });

    const results = [alarmPage1, alarmPage2];
    DuplicateDetector.applyDuplicatePenalties(results, [ctx1, ctx2]);

    // The lower-scorer (alarm-2) should be penalised
    const penalised = results.find(r => r.pageId === 'alarm-2')!;
    expect(penalised.readinessScore).toBeLessThan(0.80);
    expect(penalised.signals.some(s => s.type === 'duplicate_screen')).toBe(true);
  });

  it('does not penalise the highest-scoring page in a group', () => {
    const alarmPage1 = makeResult({ pageId: 'alarm-1', readinessScore: 0.85 });
    const alarmPage2 = makeResult({ pageId: 'alarm-2', readinessScore: 0.80 });

    const ctx1 = makeContext({ pageId: 'alarm-1', url: 'http://localhost:3000/alarms' });
    const ctx2 = makeContext({ pageId: 'alarm-2', url: 'http://localhost:3000/alarms' });

    DuplicateDetector.applyDuplicatePenalties([alarmPage1, alarmPage2], [ctx1, ctx2]);

    // Highest scorer keeps its original score
    expect(alarmPage1.readinessScore).toBe(0.85);
  });

  it('does not penalise genuinely different pages', () => {
    const dashboard = makeResult({
      pageId: 'dash-1',
      readinessScore: 0.90,
      url: 'http://localhost:3000/dashboard',
    });
    const alarms = makeResult({
      pageId: 'alarm-1',
      readinessScore: 0.85,
      url: 'http://localhost:3000/alarms',
    });

    const ctxDash = makeContext({
      pageId: 'dash-1',
      url: 'http://localhost:3000/dashboard',
      features: [makeFeature('Energy KPI Card'), makeFeature('Site Map')],
      kpiWidgets: [makeKPI('Energy'), makeKPI('Sites')],
      pageCategory: 'dashboard',
    });
    const ctxAlarm = makeContext({
      pageId: 'alarm-1',
      url: 'http://localhost:3000/alarms',
      features: [makeFeature('Active Alarm Grid')],
      kpiWidgets: [makeKPI('Active Alarms')],
      pageCategory: 'list',
    });

    DuplicateDetector.applyDuplicatePenalties([dashboard, alarms], [ctxDash, ctxAlarm]);

    expect(dashboard.readinessScore).toBe(0.90);
    expect(alarms.readinessScore).toBe(0.85);
  });

  it('handles empty results array without throwing', () => {
    expect(() => DuplicateDetector.applyDuplicatePenalties([], [])).not.toThrow();
  });

  it('handles single-item array without throwing', () => {
    const r = makeResult({ pageId: 'only' });
    const ctx = makeContext({ pageId: 'only' });
    DuplicateDetector.applyDuplicatePenalties([r], [ctx]);
    expect(r.readinessScore).toBe(0.80);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7  ReadinessScorer — end-to-end Rheem Phase 6 scenarios
// ─────────────────────────────────────────────────────────────────────────────

describe('ReadinessScorer — Rheem Phase 6 scenarios', () => {
  const loginCtx = makeContext({
    pageId:    'scene-9-login',
    url:       'http://localhost:3000/totalview',
    title:     'TotalView Early Access',
    pageCategory: 'entry',
    pagePurpose: 'Login form for TotalView platform access',
    overallImportanceScore: 20,
    features:  [makeFeature('Email Input'), makeFeature('Password Input'), makeFeature('Login Button')],
    kpiWidgets: [],
    formCount:  1,
    inputCount: 2,
    buttonCount: 1,
    nodeType:  'entry',
    pageFeatureCount: 0,
    topFeatureComposite: 0,
  });

  const dashboardCtx = makeContext({
    pageId:    'scene-1-dashboard',
    url:       'http://localhost:3000/dashboard',
    title:     'Energy Dashboard',
    pageCategory: 'dashboard',
    pagePurpose: 'Main dashboard showing energy KPIs, site map, and alarm summary',
    overallImportanceScore: 85,
    features:  [
      makeFeature('Energy KPI Cards', 90),
      makeFeature('Site 3D Map', 80),
      makeFeature('Active Alarm Table', 85),
      makeFeature('Donut Chart — Energy by Type', 75),
      makeFeature('Site Directory Link', 60),
    ],
    kpiWidgets: [
      makeKPI('Energy Cost', '$1.2M'),
      makeKPI('Active Alarms', '12'),
      makeKPI('Energy Savings', '18%'),
    ],
    topFeatureComposite: 87,
    pageFeatureCount: 5,
  });

  const digitalTwinCtx = makeContext({
    pageId:    'scene-5-twin',
    url:       'http://localhost:3000/totalview/cockpit',
    title:     'Digital Twin Cockpit',
    pageCategory: 'detail',
    pagePurpose: 'Digital Twin simulation panel with fault injection scenarios',
    overallImportanceScore: 80,
    features:  [
      makeFeature('Fault Injection Button', 90),
      makeFeature('Comm Loss Scenario', 88),
      makeFeature('Compressor Failure Test', 85),
      makeFeature('Playback Speed Control', 75),
    ],
    kpiWidgets: [],
    topFeatureComposite: 82,
    pageFeatureCount: 4,
  });

  const settingsCtx = makeContext({
    pageId:    'scene-11-settings',
    url:       'http://localhost:3000/settings',
    title:     'Settings',
    pageCategory: 'settings',
    pagePurpose: 'Application settings: light/dark mode, database source, restore demo',
    overallImportanceScore: 20,
    features:  [
      makeFeature('Light/Dark Mode Toggle'),
      makeFeature('Database Source Selector'),
      makeFeature('Restore Demo Database Button'),
    ],
    kpiWidgets: [],
    nodeType:  'settings',
    topFeatureComposite: 15,
    pageFeatureCount: 1,
  });

  const alarmsCtx1 = makeContext({
    pageId:    'scene-6-alarms',
    url:       'http://localhost:3000/totalview/alarms',
    title:     'Alarms — TotalView',
    pageCategory: 'list',
    pagePurpose: 'Active alarms grid showing 12 alarm cards with severity indicators',
    overallImportanceScore: 75,
    features:  [
      makeFeature('Alarm Grid (12 items)', 80),
      makeFeature('Critical Alarm Card', 85),
      makeFeature('Warning Alarm Card', 75),
    ],
    kpiWidgets: [makeKPI('Active Alarms', '12'), makeKPI('Critical', '3')],
    topFeatureComposite: 72,
    pageFeatureCount: 3,
  });

  const alarmsCtx2 = makeContext({
    pageId:    'scene-7-alarms-dup',
    url:       'http://localhost:3000/totalview/alarms',  // same URL
    title:     'Alarms — TotalView',
    pageCategory: 'list',
    pagePurpose: 'Active alarms grid showing 12 alarm cards with severity indicators',
    overallImportanceScore: 73,
    features:  [
      makeFeature('Alarm Grid (12 items)', 80),
      makeFeature('Critical Alarm Card', 85),
      makeFeature('Warning Alarm Card', 75),
    ],
    kpiWidgets: [makeKPI('Active Alarms', '12'), makeKPI('Critical', '3')],
    topFeatureComposite: 70,
    pageFeatureCount: 3,
  });

  it('LOGIN: rejects the login page (hard reject or score ≈ 0)', () => {
    const [result] = ReadinessScorer.score([loginCtx]);
    expect(result.verdict).toBe('reject');
    expect(result.readinessScore).toBeLessThanOrEqual(0.05);
    expect(result.rejectionReason).toBeTruthy();
  });

  it('DASHBOARD: passes with high_value category', () => {
    const [result] = ReadinessScorer.score([dashboardCtx]);
    expect(result.verdict).toBe('pass');
    expect(result.category).toBe('high_value');
    expect(result.readinessScore).toBeGreaterThanOrEqual(0.65);
    expect(result.demoValueTier).toBe('tier2');
  });

  it('DIGITAL TWIN: passes as high_value with tier1 classification', () => {
    const [result] = ReadinessScorer.score([digitalTwinCtx]);
    expect(result.verdict).toBe('pass');
    expect(result.readinessScore).toBeGreaterThanOrEqual(0.60);
    expect(result.demoValueTier).toBe('tier1');
  });

  it('SETTINGS: rejects the settings page', () => {
    const [result] = ReadinessScorer.score([settingsCtx]);
    expect(result.verdict).toBe('reject');
    expect(result.readinessScore).toBeLessThan(0.25);
    expect(result.demoValueTier).toBe('tier4');
  });

  it('ALARMS: first alarms page passes; near-duplicate second page is penalised', () => {
    const results = ReadinessScorer.score([alarmsCtx1, alarmsCtx2]);
    const alarm1  = results.find(r => r.pageId === 'scene-6-alarms')!;
    const alarm2  = results.find(r => r.pageId === 'scene-7-alarms-dup')!;

    expect(alarm1.verdict).toBe('pass');
    // Second page gets duplicate penalty — must be meaningfully lower than first
    expect(alarm2.readinessScore).toBeLessThan(alarm1.readinessScore);
    expect(alarm2.signals.some(s => s.type === 'duplicate_screen')).toBe(true);
  });

  it('CORPUS: login and settings are both rejected; dashboard and twin pass', () => {
    const corpus = [loginCtx, dashboardCtx, digitalTwinCtx, settingsCtx, alarmsCtx1];
    const results = ReadinessScorer.score(corpus);

    const login    = results.find(r => r.pageId === loginCtx.pageId)!;
    const dash     = results.find(r => r.pageId === dashboardCtx.pageId)!;
    const twin     = results.find(r => r.pageId === digitalTwinCtx.pageId)!;
    const settings = results.find(r => r.pageId === settingsCtx.pageId)!;

    expect(login.verdict).toBe('reject');
    expect(dash.verdict).toBe('pass');
    expect(twin.verdict).toBe('pass');
    expect(settings.verdict).toBe('reject');
  });

  it('outputs are sorted strongest influence first in signals array', () => {
    const [result] = ReadinessScorer.score([dashboardCtx]);
    const influences = result.signals.map(s => Math.abs(s.weight * s.confidence));
    for (let i = 1; i < influences.length; i++) {
      expect(influences[i]).toBeLessThanOrEqual(influences[i - 1]);
    }
  });

  it('neutral page with minimal content scores in borderline-to-acceptable range', () => {
    // A real page with some content but no special demo signals.
    // Zero-feature pages hard-reject; this page has features but no demo patterns.
    const neutral = makeContext({
      pageId:    'neutral',
      url:       'http://localhost:3000/about',
      title:     'About',
      pageCategory: 'generic',
      features:  [makeFeature('Company Overview', 40), makeFeature('Product Description', 35)],
      kpiWidgets: [],
      importantActions: [],
      nodeType:  'generic',
      topFeatureComposite: 30,
      pageFeatureCount:    2,
    });
    const [result] = ReadinessScorer.score([neutral]);
    // Small positive signals from feature_density/priority push score slightly above base (0.35).
    // No strong negative or positive demo signals — lands in borderline-to-acceptable range.
    expect(result.readinessScore).toBeGreaterThan(0.30);
    expect(result.readinessScore).toBeLessThan(0.60);
    expect(result.verdict).not.toBe('reject');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8  Minimum scene guarantee
// ─────────────────────────────────────────────────────────────────────────────

describe('ReadinessScorer — minimum scene guarantee behaviour', () => {
  it('returns empty array for empty input', () => {
    expect(ReadinessScorer.score([])).toEqual([]);
  });

  it('returns all results including rejected pages in audit trail', () => {
    // Score login page — should appear in results even though rejected
    const loginCtx = makeContext({
      pageId: 'login',
      url:    'http://localhost:3000/login',
      title:  'Login',
    });
    const results = ReadinessScorer.score([loginCtx]);
    expect(results).toHaveLength(1);
    expect(results[0].verdict).toBe('reject');
  });

  it('all results have non-negative readinessScore', () => {
    const ctxs = [
      makeContext({ pageId: 'a', url: 'http://localhost:3000/login', title: 'Login' }),
      makeContext({ pageId: 'b', url: 'http://localhost:3000/settings', title: 'Settings' }),
      makeContext({ pageId: 'c', url: 'http://localhost:3000/dashboard', title: 'Dashboard',
        features: [makeFeature('KPI metric A'), makeFeature('KPI metric B')],
        kpiWidgets: [makeKPI('Energy'), makeKPI('Cost')],
      }),
    ];
    const results = ReadinessScorer.score(ctxs);
    results.forEach(r => {
      expect(r.readinessScore).toBeGreaterThanOrEqual(0);
      expect(r.readinessScore).toBeLessThanOrEqual(1);
    });
  });

  it('confidence is always in [0, 1]', () => {
    const ctxs = [
      makeContext({ pageId: 'a', url: 'http://localhost:3000/login' }),
      makeContext({ pageId: 'b', url: 'http://localhost:3000/dashboard',
        kpiWidgets: [makeKPI('Energy'), makeKPI('Cost')],
      }),
    ];
    ReadinessScorer.score(ctxs).forEach(r => {
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    });
  });

  it('each result has a non-null pageId matching its context', () => {
    const ctxs = [
      makeContext({ pageId: 'page-alpha' }),
      makeContext({ pageId: 'page-beta', url: 'http://localhost:3000/alarms' }),
    ];
    const results = ReadinessScorer.score(ctxs);
    expect(results[0].pageId).toBe('page-alpha');
    expect(results[1].pageId).toBe('page-beta');
  });
});
