// ─── Theme ───────────────────────────────────────────────────────────────────

export interface ThemeConfig {
  colors: {
    background: string;
    backgroundSecondary: string;
    backgroundCard: string;
    backgroundCardHover: string;
    blue: {primary:string; light:string; bright:string; glow:string; subtle:string};
    orange: {primary:string; light:string; bright:string; glow:string; subtle:string};
    text: {primary:string; secondary:string; tertiary:string; accent:string};
    border: {subtle:string; normal:string; bright:string; blue:string; orange:string};
  };
  fonts: {heading:string; body:string; mono:string};
  spacing: {xs:number; sm:number; md:number; lg:number; xl:number; xxl:number};
  radius: {sm:number; md:number; lg:number; xl:number; full:number};
}

// ─── Project content ─────────────────────────────────────────────────────────

export interface ProductInfo {
  name:        string;
  tagline:     string;
  subTagline?: string;
  websiteUrl?: string;   // primary CTA URL shown large in outro
  ctaText:     string;
  ctaSubtext?: string;
}

export interface ProblemCard {
  icon: string;
  title: string;
  description: string;
}

export interface FeatureCard {
  icon: string;
  title: string;
  description: string;
  accent: 'blue' | 'orange';
}

export interface MetricCard {
  value: number;
  suffix: string;
  label: string;
  description: string;
  accent: 'blue' | 'orange';
  decimals?: number;
}

export interface JourneyStep {
  step: string;
  title: string;
  description: string;
}

export interface SolutionNode {
  id: string;
  label: string;
  icon: string;
  x: number;
  y: number;
}

export interface SolutionEdge {
  from: string;
  to: string;
}

// ─── Scene system ────────────────────────────────────────────────────────────

export type SceneType =
  | 'intro' | 'problem' | 'solution' | 'productDemo'
  | 'features' | 'metrics' | 'customerJourney' | 'outro';

export interface SceneTiming {
  type: SceneType;
  durationInFrames: number;
}

export interface ProjectContent {
  problems?:       ProblemCard[];
  solutionNodes?:  SolutionNode[];
  solutionEdges?:  SolutionEdge[];
  features?:       FeatureCard[];
  metrics?:        MetricCard[];
  customerJourney?: JourneyStep[];
}

// ─── Project config ───────────────────────────────────────────────────────────

export interface ProjectThemeOverride {
  primaryColor?: string;   // overrides blue.primary
  accentColor?:  string;   // overrides orange.primary
  background?:   string;
}

// Timed caption entry for burned-in subtitles
export interface CaptionEntry {
  startFrame: number;   // global frame in the composition
  endFrame:   number;
  text:       string;
  speaker?:   string;
}

// Display-ready KPI metric for the KPI scene
export interface KPIMetric {
  value:  string;              // pre-formatted: "60%", "3.2x", "99.9%"
  label:  string;
  sub:    string;
  accent: 'blue' | 'orange';
}

export interface ProjectConfig {
  id:      string;
  fps:     number;
  width:   number;
  height:  number;
  product: ProductInfo;
  theme:   ProjectThemeOverride;
  scenes:  SceneTiming[];
  content: ProjectContent;
  recording: {
    appUrl:    string;
    outputDir: string;
  };

  // ── Narrative content (drives generic scenes) ─────────────────────────────
  hook?: {
    line1: string;   // small gray setup   e.g. "Something broke at 2am."
    line2: string;   // large white impact  e.g. "Nobody knew for 11 hours."
    line3: string;   // small orange verdict e.g. "6 sites. Zero visibility."
  };

  kpiMetrics?: KPIMetric[];   // drives KPIScene — if omitted, KPIScene uses its defaults

  // ── Audio / media assets ─────────────────────────────────────────────────
  media?: {
    backgroundMusic?:  string;   // path to mp3/wav (relative to project root)
    voiceover?:        string;   // path to voiceover recording
    musicVolume?:      number;   // 0–1, default 0.25
    voiceoverVolume?:  number;   // 0–1, default 1.0
  };

  // ── Burned-in captions ────────────────────────────────────────────────────
  captions?: CaptionEntry[];
}
