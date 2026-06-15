// ─── Clip / Manifest ─────────────────────────────────────────────────────────

export interface ClipInfo {
  id: string;
  file: string;            // relative to public/  e.g. "assets/recordings/login.mp4"
  duration: number;        // seconds
  durationInFrames: number;
  width: number;
  height: number;
  source: 'auto' | 'manual';
  capturedAt: string;
}

export interface ZoomRegion {
  startFrame: number;      // segment-local (0-indexed from segment start)
  endFrame: number;
  x: number; y: number;
  width: number; height: number;
  label?: string;
}

export interface ClickHighlight {
  frame: number;           // segment-local
  x: number; y: number;
  label?: string;
}

export interface SegmentDef {
  id: string;
  sceneId: string;
  label: string;
  subtitle: string;
  manualOverride?: string;  // path relative to public/ — always preferred
  keywords?: string[];      // for auto-matching recorded clips
  accent?: 'blue' | 'orange';
  zoomRegions?: ZoomRegion[];
  clickHighlights?: ClickHighlight[];
}

export interface ResolvedSegment extends SegmentDef {
  resolvedClip?: ClipInfo;
  startFrame: number;       // scene-local absolute offset
  durationInFrames: number;
}

export interface ClipManifest {
  generatedAt: string;
  fps: number;
  clips: ClipInfo[];
  segments: ResolvedSegment[];
}

// ─── Recording ────────────────────────────────────────────────────────────────

export interface RecordingStep {
  action: 'goto' | 'click' | 'fill' | 'wait' | 'waitForSelector' | 'scroll' | 'key' | 'hover';
  url?: string;
  selector?: string;
  value?: string;
  ms?: number;
  timeout?: number;
  y?: number;
  key?: string;
  optional?: boolean;
}

export interface WorkflowDef {
  id: string;
  label: string;
  subtitle: string;
  sceneId: string;
  steps: RecordingStep[];
  accent?: 'blue' | 'orange';
}

export interface RecordingConfig {
  appUrl: string;
  viewport?: { width: number; height: number };
  autoExplore?: boolean;
  maxNavDepth?: number;
  credentials?: {
    username: string;
    password: string;
    usernameSelector?: string;
    passwordSelector?: string;
    submitSelector?: string;
    successIndicator?: string;
  };
  workflows?: WorkflowDef[];
}
