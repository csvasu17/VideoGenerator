# Motion Direction Engine — Architecture & Implementation Plan

**Phase:** 7 — Premium SaaS Motion  
**Objective:** Transform a screenshot slideshow into a Stripe / Linear / Notion quality product demo  
**Constraint:** Discovery, ranking, journey, context systems are frozen. All changes are post-storyboard.

---

## Reference quality bar

| Studio | Signature technique |
|--------|---------------------|
| Stripe | Camera dollies into payment UI; floating metric callouts; glowing CTA spotlight |
| Linear | Fast precise cuts; keyboard shortcut overlays; tight crop + zoom on states |
| Notion | Block-reveal animation; collaborative cursor effects; zoom into specific content regions |
| Vercel | Deploy animation; terminal scrolls; count-up metrics; minimal text overlays |

What they share:
- The camera **always has purpose** — every movement is motivated by the narrative
- **One hero moment per scene** — one element receives maximum attention
- **Callouts are minimal** — 1–4 words floating near the element, never a sentence
- **Transitions are spatially coherent** — the camera's end state connects to the next scene's start
- **Hold beats** — after zooming to a key element, pause 2–3 seconds before moving

---

## 1. Architecture

### System overview

```
demo-package.json  (existing pipeline output)
        │
        ▼
 MotionDirectionStage          ← new PipelineStage
        │
        ├── SceneMotionPlanner × N     (per-scene, parallel)
        │       ├── VisualAttentionAnalyzer  → AttentionMap
        │       ├── MotionScorer             → scored AttentionTarget[]
        │       ├── AttentionSequencer       → AttentionBeat[]
        │       ├── MultiPointCameraPlanner  → ExtendedCameraTimeline
        │       └── CalloutComposer          → CalloutTrack
        │
        ├── TransitionPlanner              (cross-scene, sequential)
        │       ├── SharedElementMatcher    → SharedElementSpec?
        │       ├── TransitionSelector      → TransitionType per boundary
        │       └── MotionContinuityEngine  → adjusted camera endpoints
        │
        └── MotionPackageWriter  →  motion-package.json
                                        │
                                        ▼
                               Remotion renderer
                                        │
                               DemoVideo.tsx (updated)
                                        │
                               MotionScene.tsx × N
                                        ├── MotionTransition (wrap)
                                        ├── CameraLayer      (existing, unchanged)
                                        ├── CalloutLayer     (new)
                                        └── AttentionRingLayer (new)
```

### Data flow invariants

1. **MotionDirectionStage is post-storyboard, pre-render.** It reads `demo-package.json` and writes `motion-package.json`. No pipeline stages above it are modified.
2. **Remotion backward compatibility.** If `motionPlan` is absent from the package, `DemoVideo` falls back to Phase 6 behavior. The new `motionPlan` field is additive.
3. **All motion decisions are deterministic and LLM-free.** No async, no I/O within the planning functions. Given the same input, the engine always produces the same motion timeline.
4. **The product window remains the canvas.** Camera movement is simulated via CSS transform on the screenshot element. No 3D transforms, no WebGL. The existing `CameraLayer` contract (scale + translate) is preserved.
5. **Callouts render inside the product window boundary.** They are layered between the screenshot and the vignette overlay. They never overlap the narration bar.

---

## 2. Domain Model

### 2.1 Core value types

```typescript
// ── Normalized 2D types ────────────────────────────────────────────────────────

/** Normalized point, both axes in [0, 1] relative to product window. */
interface Vec2 {
  x: number;
  y: number;
}

/** Normalized region. All values in [0, 1] relative to product window. */
interface NormalizedRegion {
  x:      number;   // left edge
  y:      number;   // top edge
  width:  number;
  height: number;
}

// Derived helpers (not persisted — computed at use site)
//   centerX = region.x + region.width  / 2
//   centerY = region.y + region.height / 2
//   area    = region.width * region.height
```

### 2.2 Attention model

```typescript
// ── Element classification (extends existing ElementType) ─────────────────────

type ElementType =
  // existing
  | 'kpi_card'
  | 'chart'
  | 'button'
  | 'table'
  | 'navigation'
  | 'form'
  | 'default'
  // NEW in Phase 7
  | 'alert'     // notification, alarm feed, status badge
  | 'metric'    // standalone number/stat (looser than kpi_card)
  | 'modal'     // overlay dialog (highest visual weight)
  | 'map'       // geographic or floor-plan visualisation
  | 'list';     // unstructured list (lower weight than table)

// ── Attention target ───────────────────────────────────────────────────────────

/**
 * One identifiable UI element that deserves camera attention.
 * Produced by VisualAttentionAnalyzer, scored by MotionScorer.
 */
interface AttentionTarget {
  id:            string;         // stable ID within a scene, e.g. "primary", "secondary-0"
  elementType:   ElementType;
  region:        NormalizedRegion;

  // ── Scores (0–1) ──────────────────────────────────────────────────────────
  businessValue: number;   // from PageIntelligence feature score
  visualWeight:  number;   // inferred from region area + elementType
  narrativeRole: number;   // 1.0 if this is the primary spotlight, 0.5 if secondary
  motionScore:   number;   // computed by MotionScorer (see §5)

  // ── Content ───────────────────────────────────────────────────────────────
  label:         string;   // short label for callout headline
  benefit?:      string;   // optional benefit statement, ≤ 6 words
  metric?:       string;   // optional metric overlay, e.g. "↓ 34%"
}

/**
 * Scored map of attention targets for one scene.
 * Sorted descending by motionScore.
 */
interface AttentionMap {
  sceneId:  string;
  targets:  AttentionTarget[];   // [0] = primary, [1] = secondary (if any)
}

// ── Attention beat ────────────────────────────────────────────────────────────

/**
 * A timed window within a scene where the camera focuses on one target.
 * The full scene's AttentionBeat[] is the "focus sequence."
 */
interface AttentionBeat {
  id:           string;          // matches AttentionTarget.id
  phase:        AttentionPhase;
  startFrame:   number;          // scene-relative
  endFrame:     number;
  targetId:     string;          // points into AttentionMap.targets
  motionType:   BeatMotionType;
}

type AttentionPhase =
  | 'context'          // wide shot — establish full layout
  | 'approach'         // camera moving toward primary target
  | 'hold-primary'     // camera settled on primary target
  | 'pan-to-secondary' // camera moving to secondary target (optional)
  | 'hold-secondary'   // camera settled on secondary target (optional)
  | 'return';          // soft pull-back before scene ends / transition begins

type BeatMotionType =
  | 'dolly-in'         // zoom toward element (main approach)
  | 'pan'              // lateral movement between elements
  | 'orbit'            // slow arc around element (for large charts/maps)
  | 'drift'            // imperceptibly slow continuous movement (hold phases)
  | 'pull-back'        // zoom out (return phase)
  | 'static';          // no movement
```

### 2.3 Camera path model (extends existing)

```typescript
// Extends existing CameraKeyframe — no breaking change.
// The existing CameraChoreographer output is compatible.

/**
 * Extended camera timeline that supports named beats and multi-target paths.
 * Backward-compatible with the existing CameraTimeline contract:
 *   sceneId, durationInFrames, keyframes, spotlightTarget are unchanged.
 */
interface ExtendedCameraTimeline extends CameraTimeline {
  // NEW — named beat segments for debugging / callout timing
  beats: CameraBeatRange[];
}

interface CameraBeatRange {
  beatId:     string;        // matches AttentionBeat.id
  phase:      AttentionPhase;
  startFrame: number;
  endFrame:   number;
}
```

> **Design note:** The existing `CameraChoreographer` handles single-spotlight paths perfectly. The new `MultiPointCameraPlanner` calls it twice (once per attention target) and merges the keyframe sequences, inserting a pan segment between them. The existing `CameraLayer` renders both — no changes needed to the renderer.

### 2.4 Callout model

```typescript
// ── Callout content ───────────────────────────────────────────────────────────

interface CalloutContent {
  headline:  string;    // 1–4 words, bold. e.g. "Live monitoring"
  subline?:  string;    // optional, ≤ 6 words. e.g. "Updates every 30s"
  metric?:   string;    // optional stat overlay. e.g. "↓ 23% energy waste"
}

// ── Visual style ──────────────────────────────────────────────────────────────

type CalloutVariant =
  | 'glass-light'   // frosted glass, white text — for dark UI backgrounds
  | 'glass-dark'    // dark glass — for light UI backgrounds
  | 'neon-outline'; // colored outline + glow — for high-energy scenes

interface CalloutStyle {
  variant:       CalloutVariant;
  accentColor:   string;         // hex, matches scene accent
  backdropBlur:  number;         // px, typically 16–24
  borderOpacity: number;         // 0–1, typically 0.15–0.25
  panelOpacity:  number;         // 0–1, typically 0.12–0.20 (glass) or 0.88 (dark)
  cornerRadius:  number;         // px
}

// ── Connector ─────────────────────────────────────────────────────────────────

interface CalloutConnector {
  type:         'line' | 'arrow' | 'none';
  anchorPoint:  Vec2;  // where the line touches the UI element (normalized)
  strokeColor:  string;
  strokeWidth:  number;
  drawDuration: number; // frames — line draws in from callout to anchor
}

// ── Animation ─────────────────────────────────────────────────────────────────

type CalloutEnterAnimation = 'fade-slide-up' | 'scale-pop' | 'draw-line-then-fade';
type CalloutExitAnimation  = 'fade-down' | 'scale-shrink' | 'dissolve';

// ── Animated callout ──────────────────────────────────────────────────────────

/**
 * One callout overlay — appears over the product window, timed to an attention beat.
 */
interface AnimatedCallout {
  id:             string;
  beatId:         string;         // the AttentionBeat this callout is anchored to

  // Scene-relative timing
  startFrame:     number;         // when callout begins enter animation
  holdStart:      number;         // when callout reaches full opacity
  holdEnd:        number;         // when callout begins exit animation
  endFrame:       number;         // when callout is fully gone

  // Spatial
  anchor:         Vec2;           // point on the UI element (connector terminus)
  panelPosition:  Vec2;           // center of the callout panel (normalized)
  panelSize:      { width: number; height: number }; // normalized

  // Content + appearance
  content:        CalloutContent;
  style:          CalloutStyle;
  connector:      CalloutConnector;

  // Animation
  enter:          CalloutEnterAnimation;
  exit:           CalloutExitAnimation;
}

/**
 * All callouts for one scene, in temporal order.
 * Never more than 2 callouts visible simultaneously.
 */
interface CalloutTrack {
  sceneId:   string;
  callouts:  AnimatedCallout[];
}
```

### 2.5 Transition model

```typescript
// ── Transition types ──────────────────────────────────────────────────────────

type MotionTransitionType =
  | 'zoom-through'       // zoom into focal region of A until fill → emerge from B
  | 'shared-element'     // hold on common region (sidebar/header) while content swaps
  | 'match-cut'          // spatial match cut with motion blur
  | 'dolly-reveal'       // A pulls back to full frame; B opens from full frame and dollies in
  | 'slide-parallax'     // 3-layer parallax slide
  | 'cut-and-land';      // hard cut + fast landing movement in B

/**
 * When two adjacent scenes share a structural element (navigation sidebar,
 * header bar), the camera can hold on it while the rest of the content changes.
 */
interface SharedElementSpec {
  region:      NormalizedRegion; // coordinates in SCENE A's screenshot space
  regionB:     NormalizedRegion; // same element in SCENE B's screenshot space
  elementType: ElementType;
}

/**
 * Full transition specification between scene[i] and scene[i+1].
 */
interface TransitionPlan {
  fromSceneId:    string;
  toSceneId:      string;
  type:           MotionTransitionType;
  durationFrames: number;

  // ZoomThrough / MatchCut — focal points in normalized scene coordinates
  exitFocal?:     Vec2;       // where A's camera is pointing at exit
  entryFocal?:    Vec2;       // where B's camera should start

  // SharedElement
  sharedElement?: SharedElementSpec;

  // SlideParallax
  direction?:     'left' | 'right' | 'up';

  // CutAndLand
  landingTarget?: AttentionTarget; // B's primary target (for fast landing move)
}
```

### 2.6 Scene choreography model

```typescript
/**
 * Complete motion plan for one scene.
 * This is what gets persisted to motion-package.json per scene.
 */
interface MotionDirectedScene {
  sceneId:         string;

  // Camera
  cameraTimeline:  ExtendedCameraTimeline;

  // Attention
  attentionMap:    AttentionMap;
  attentionBeats:  AttentionBeat[];

  // Callouts
  calloutTrack:    CalloutTrack;

  // Transition INTO this scene (from previous)
  enterTransition: TransitionPlan | null;

  // Transition OUT of this scene (to next)
  exitTransition:  TransitionPlan | null;
}
```

### 2.7 Global motion style

```typescript
/**
 * Video-level motion personality.
 * Controls the overall energy, pacing, and visual language.
 */
interface GlobalMotionStyle {
  // Energy level — scales hold durations, approach speeds, transition lengths
  intensity: 'subtle' | 'moderate' | 'dynamic';

  // Callout personality
  calloutVariant:     CalloutVariant;
  calloutAccentColor: string;   // hex

  // Transition personality
  preferredTransition: MotionTransitionType;   // fallback when nothing better matches

  // Camera personality
  maxZoom:    number;   // hard ceiling, default 1.8 (never exceed existing 2.0 budget)
  holdPctMin: number;   // minimum fraction of scene in hold phase, default 0.50
}
```

---

## 3. Motion Timeline Schema

### 3.1 Extended package format

`motion-package.json` extends `demo-package.json` with one top-level field:

```typescript
interface MotionPackage {
  // All existing demo-package.json fields — unchanged
  schemaVersion: string;
  id:            string;
  meta:          DemoMeta;
  composition:   CompositionSpec;
  openingCard:   OpeningCard;
  scenes:        SceneData[];       // unchanged
  closingCard:   ClosingCard;

  // NEW — added by MotionDirectionStage
  motionPlan: MotionPlan;
}

interface MotionPlan {
  version:     string;            // semver, "1.0.0"
  generatedAt: string;            // ISO timestamp
  globalStyle: GlobalMotionStyle;
  scenes:      MotionDirectedScene[];    // parallel array to demo-package scenes[]
  transitions: TransitionPlan[];         // N-1 plans for N scenes
}
```

> **Invariant:** `motionPlan.scenes[i].sceneId === demo-package.scenes[i].id` for all i.

### 3.2 Motion timeline visual representation

```
Scene: 210 frames (7s at 30fps)
═══════════════════════════════════════════════════════════

Attention phases:
  [0────12]  context      zoom=1.0 centred
  [12───42]  approach     zoom 1.0→1.6, pan to primary target
  [42───150] hold-primary zoom=1.6, slow drift
  [150──180] pan-to-sec   zoom 1.6→1.3, pan to secondary target (optional)
  [180──195] hold-sec     zoom=1.3, static
  [195──210] return       zoom 1.3→1.2, re-centre

Camera keyframes:
  KF(0,    zoom=1.00, fx=0.50, fy=0.50)  ← context open
  KF(12,   zoom=1.00, fx=0.50, fy=0.50)  ← context hold
  KF(42,   zoom=1.60, fx=0.72, fy=0.15)  ← approach complete / hold start
  KF(96,   zoom=1.60, fx=0.73, fy=0.15)  ← drift mid
  KF(150,  zoom=1.60, fx=0.74, fy=0.16)  ← hold end / pan start
  KF(180,  zoom=1.30, fx=0.45, fy=0.40)  ← secondary hold start
  KF(195,  zoom=1.30, fx=0.45, fy=0.40)  ← secondary hold end
  KF(209,  zoom=1.20, fx=0.58, fy=0.32)  ← return (soft)

Callout 1 (primary):
  [30─────────────────────165]
   enter fade-slide-up (15f) | hold (120f) | exit fade-down (15f)

Callout 2 (secondary — optional):
                         [160──────────────────────200]
                          enter scale-pop (10f) | hold (25f) | exit dissolve (5f)

Transition OUT (zoom-through, 30 frames — overlaps start of next scene):
                                              [180──────────────────209]
                                               camera at exit focal, zoom-through begins
```

---

## 4. Camera Path Model

### 4.1 Coordinate system

```
Product window (1808 × 813 px in the 1920×1080 composition):
  (0,0) ─────────────────── (1,0)
    │                          │
    │   screenshot content      │
    │                          │
  (0,1) ─────────────────── (1,1)

Camera state at any frame:
  zoom:   scale factor applied to the screenshot
          1.0 = full screenshot fills the product window exactly
          1.5 = 67% of the screenshot is visible (center crop)
          1.8 = 56% visible (maximum practical zoom for SaaS UI)
          2.0 = hard ceiling (existing contract)

  focusX, focusY: the point in screenshot space pulled to the window center
          at zoom=1.0: focus has no visual effect (full view)
          at zoom=1.6 with focus=(0.72, 0.15): camera is showing the
          top-right quadrant of the screenshot, zoomed 1.6×

CSS transform applied by CameraLayer (existing, unchanged):
  scale(zoom) translate((0.5-focusX)*100%, (0.5-focusY)*100%)
```

### 4.2 Motion profiles — extended

Adds `alert`, `metric`, `modal`, `map`, `list` to the existing `CAMERA_PROFILES` table:

```typescript
const CAMERA_PROFILES_EXTENDED: Record<ElementType, MotionProfile> = {
  // existing profiles (unchanged)
  kpi_card:   { zoomMin: 1.40, zoomMax: 1.60, approachFrames: 25, holdPct: 0.70, driftX:  0.00, driftY:  0.00 },
  chart:      { zoomMin: 1.30, zoomMax: 1.50, approachFrames: 30, holdPct: 0.65, driftX:  0.02, driftY:  0.00 },
  button:     { zoomMin: 1.50, zoomMax: 1.70, approachFrames: 20, holdPct: 0.60, driftX:  0.00, driftY:  0.00 },
  table:      { zoomMin: 1.20, zoomMax: 1.40, approachFrames: 30, holdPct: 0.70, driftX:  0.00, driftY:  0.03 },
  navigation: { zoomMin: 1.20, zoomMax: 1.30, approachFrames: 25, holdPct: 0.75, driftX:  0.02, driftY:  0.00 },
  form:       { zoomMin: 1.30, zoomMax: 1.50, approachFrames: 25, holdPct: 0.65, driftX:  0.00, driftY:  0.00 },
  default:    { zoomMin: 1.00, zoomMax: 1.10, approachFrames:  0, holdPct: 1.00, driftX:  0.00, driftY:  0.00 },

  // NEW Phase 7
  alert:      { zoomMin: 1.45, zoomMax: 1.65, approachFrames: 20, holdPct: 0.60, driftX:  0.00, driftY:  0.00 },
  // Alert zooms fast and tight — urgency aesthetic
  metric:     { zoomMin: 1.50, zoomMax: 1.70, approachFrames: 22, holdPct: 0.65, driftX:  0.00, driftY:  0.00 },
  // Standalone metrics get slightly more zoom than kpi_card
  modal:      { zoomMin: 1.30, zoomMax: 1.55, approachFrames: 28, holdPct: 0.70, driftX:  0.00, driftY:  0.00 },
  // Modal fills much of the screen — moderate zoom to keep context
  map:        { zoomMin: 1.10, zoomMax: 1.30, approachFrames: 40, holdPct: 0.70, driftX:  0.03, driftY:  0.01 },
  // Map gets a slow orbital drift instead of centering drift
  list:       { zoomMin: 1.15, zoomMax: 1.30, approachFrames: 25, holdPct: 0.70, driftX:  0.00, driftY:  0.02 },
  // List scrolls down gently (driftY positive)
};

// Extended canonical regions
const CANONICAL_REGIONS_EXTENDED: Record<ElementType, { focusX: number; focusY: number }> = {
  kpi_card:   { focusX: 0.25, focusY: 0.20 },
  chart:      { focusX: 0.50, focusY: 0.45 },
  button:     { focusX: 0.50, focusY: 0.80 },
  table:      { focusX: 0.50, focusY: 0.40 },
  navigation: { focusX: 0.15, focusY: 0.50 },
  form:       { focusX: 0.50, focusY: 0.35 },
  default:    { focusX: 0.50, focusY: 0.50 },
  alert:      { focusX: 0.50, focusY: 0.25 },   // alerts typically top-center
  metric:     { focusX: 0.75, focusY: 0.20 },   // metrics often top-right
  modal:      { focusX: 0.50, focusY: 0.45 },   // modal centered
  map:        { focusX: 0.50, focusY: 0.55 },   // map slightly below center
  list:       { focusX: 0.50, focusY: 0.35 },   // list near top
};
```

### 4.3 Multi-point camera planner

`MultiPointCameraPlanner` extends the existing single-spotlight `CameraChoreographer`:

```
Phase A  Context (0 → contextEnd):
  zoom=1.0, focus=(0.5, 0.5) — full layout visible
  Duration: max(10, fps × 0.4) frames

Phase B  Approach-primary (contextEnd → approachPrimaryEnd):
  zoom: 1.0 → targetZoom1, focus: centre → primaryFocus
  Duration: profile1.approachFrames
  Easing: spring {damping:20, stiffness:90}

Phase C  Hold-primary (approachPrimaryEnd → holdPrimaryEnd):
  zoom: locked at targetZoom1, slow drift per profile1.driftX/Y
  Duration: durationInFrames × holdPct1 (scaled by secondaryExists flag)
  If no secondary: holdPct1 = profile.holdPct
  If secondary:    holdPct1 = profile.holdPct × 0.65 (shorter hold to make room)
  Easing: linear (slow drift)

Phase D  Pan-to-secondary (holdPrimaryEnd → approachSecondaryEnd) [optional]:
  zoom: targetZoom1 → targetZoom2, focus: primaryFocus → secondaryFocus
  Duration: max(25, fps × 0.8) frames
  Easing: spring {damping:22, stiffness:70}

Phase E  Hold-secondary (approachSecondaryEnd → holdSecondaryEnd) [optional]:
  zoom: locked at targetZoom2, slow drift per profile2.driftX/Y
  Duration: remaining × 0.55
  Easing: linear

Phase F  Return (holdSecondaryEnd/holdPrimaryEnd → last frame):
  zoom: targetZoomN × 0.85, focus: partial re-centre
  Duration: max(12, fps × 0.4) frames
  Easing: spring {damping:22, stiffness:60}
```

---

## 5. Attention Model

### 5.1 VisualAttentionAnalyzer

**Input:**
- `StoryboardScene` (spotlightTarget, highlightTarget, title, description)
- `PageIntelligence` (features[], featureScores)

**Output:** `AttentionMap` with 1–3 scored `AttentionTarget` objects

**Algorithm:**

```
Step 1 — Primary target
  Source:  scene.spotlightTarget (already derived by StoryboardGenerator)
  Region:  spotlightTarget.boundingBox (if present) OR canonical region
  Label:   deriveDisplayTitle(highlightTarget.description, scene.title)
  BusinessValue: normalise spotlightTarget.priority to [0,1]

Step 2 — Secondary target (optional)
  Condition: scene.durationInFrames ≥ 210 (7s) AND scene contains multiple features
  Source:  Look for a second feature in PageIntelligence.features[] whose
           elementType ≠ primary AND whose featureScore > 0.60
           AND whose canonical region does not overlap primary by > 40%
  If found: create AttentionTarget for secondary
  If none:  no secondary — camera stays on primary for full hold phase

Step 3 — Contextual targets (future: vision-detected, Phase 8+)
  Phase 7: contextual targets are not generated.
  They are reserved for when a vision pass detects specific UI regions
  (charts, data tables, status indicators) from the screenshot itself.
```

### 5.2 MotionScorer

Computes `motionScore` for each `AttentionTarget`:

```
motionScore =
    0.40 × businessValue          // drives the story — most important
  + 0.25 × elementTypeWeight[elementType]  // see table below
  + 0.15 × visualWeight           // proxy: min(area × 4, 1.0) + positionBonus
  + 0.15 × narrativeRole          // 1.0 primary / 0.55 secondary / 0.20 contextual
  + 0.05 × screenCoverage         // normalized area, slight boost for large elements
```

**elementTypeWeight lookup:**

| ElementType | Weight | Rationale |
|------------|--------|-----------|
| modal | 0.95 | Highest visual intrusion — always has story content |
| button (CTA) | 0.90 | Action drives business value |
| alert | 0.85 | Urgency reads immediately |
| kpi_card | 0.85 | Metric is the message |
| metric | 0.80 | Solo number — sharp, readable |
| chart | 0.72 | Requires time to read — secondary hold |
| table | 0.65 | Context-dense — approach carefully |
| form | 0.65 | Interaction affordance — moderate weight |
| map | 0.55 | Spatial orientation — context role |
| list | 0.55 | Low visual weight |
| navigation | 0.40 | Structural, not content |
| default | 0.30 | Unknown — Ken Burns fallback |

**visualWeight computation:**

```
area          = region.width × region.height
positionBonus = 0.1 if region is in top 40% of screen (reading-order priority)
              + 0.1 if region is in centre 50% horizontally
visualWeight  = min(area × 4.0, 0.80) + positionBonus
```

### 5.3 AttentionSequencer

Given an `AttentionMap` (sorted by motionScore desc) and scene duration, produces `AttentionBeat[]`:

```typescript
function sequence(map: AttentionMap, duration: number, fps: number): AttentionBeat[] {
  const primary   = map.targets[0];
  const secondary = map.targets[1] ?? null;

  // Timing constants
  const contextDur   = Math.max(10, Math.round(fps * 0.4));  // ~12f
  const approachDur  = CAMERA_PROFILES[primary.elementType].approachFrames;
  const holdFraction = secondary
    ? CAMERA_PROFILES[primary.elementType].holdPct * 0.65
    : CAMERA_PROFILES[primary.elementType].holdPct;

  const contextEnd   = contextDur;
  const approachEnd  = contextEnd + approachDur;
  const holdPrimEnd  = Math.round(duration * holdFraction);

  const beats: AttentionBeat[] = [
    { id:'context',      phase:'context',       startFrame:0,           endFrame:contextEnd,  targetId:primary.id,   motionType:'static'   },
    { id:'approach',     phase:'approach',       startFrame:contextEnd,  endFrame:approachEnd, targetId:primary.id,   motionType:'dolly-in' },
    { id:'hold-primary', phase:'hold-primary',   startFrame:approachEnd, endFrame:holdPrimEnd, targetId:primary.id,   motionType:'drift'    },
  ];

  if (secondary && holdPrimEnd < duration - 60) {
    const panDur   = Math.max(25, Math.round(fps * 0.9));   // ~27f
    const panEnd   = holdPrimEnd + panDur;
    const holdS2nd = Math.min(panEnd + 45, duration - 15);

    beats.push({ id:'pan-secondary',  phase:'pan-to-secondary', startFrame:holdPrimEnd, endFrame:panEnd,    targetId:secondary.id, motionType:'pan'    });
    beats.push({ id:'hold-secondary', phase:'hold-secondary',   startFrame:panEnd,      endFrame:holdS2nd,  targetId:secondary.id, motionType:'drift'  });
    beats.push({ id:'return',         phase:'return',           startFrame:holdS2nd,    endFrame:duration-1,targetId:primary.id,   motionType:'pull-back' });
  } else {
    beats.push({ id:'return', phase:'return', startFrame:holdPrimEnd, endFrame:duration-1, targetId:primary.id, motionType:'pull-back' });
  }

  return beats;
}
```

---

## 6. Scene Choreography Model

### 6.1 CalloutComposer

Maps `AttentionBeat[]` → `CalloutTrack`.

**Timing rules:**
- Callout appears 15 frames after camera ARRIVES at the target (after approach completes)
- Callout disappears 15 frames before camera LEAVES the target (before pan-to-secondary / return)
- Enter animation: 12 frames
- Exit animation: 10 frames
- Minimum visible duration: 30 frames. If not achievable, callout is suppressed.

**Spatial placement rules:**
- Primary callout: placed to the LEFT of the target if target.region.x > 0.55; otherwise RIGHT
- Secondary callout: opposite quadrant from primary
- Callout panel is always inside the product window (region clipped to `[0.04, 0.04, 0.92, 0.88]`)
- Anchor point is the nearest edge of the target's bounding box to the callout panel

**Callout content derivation:**
- `headline`: from `AttentionTarget.label` (1–4 words — derived by `deriveDisplayTitle`)
- `subline`: from `AttentionTarget.benefit` (optional, ≤ 6 words)
- `metric`: from `AttentionTarget.metric` (optional — only set when businessValue > 0.75)

### 6.2 TransitionPlanner

Plans the `TransitionPlan` between scene[i] and scene[i+1].

**Selection algorithm:**

```
Input:
  sceneA: MotionDirectedScene (exit state)
  sceneB: MotionDirectedScene (entry state)

Step 1 — Try SharedElement
  If sceneA.attentionMap contains a 'navigation' target AND
     sceneB.attentionMap contains a 'navigation' target AND
     both have regions with similar x-position (|Δx| < 0.1):
     → SharedElement transition. Lock on nav region. Duration: 20–25 frames.

Step 2 — Try ZoomThrough
  If primary targets exist in both scenes AND
     sceneA exit zoom ≥ 1.4 AND
     sceneB primary motionScore ≥ 0.70:
     → ZoomThrough. Exit focal = sceneA primary region center.
                    Entry focal = sceneB primary region center.
     Duration: 30–45 frames.

Step 3 — Try MatchCut
  If sceneA primary elementType == sceneB primary elementType:
     → MatchCut. Both cameras at same relative position.
     Duration: 10–15 frames.

Step 4 — Try DollyReveal
  If sceneA primary priority > 0.85 AND sceneB primary elementType == 'table':
     → DollyReveal (pull back to full frame, reveal table).
     Duration: 40–50 frames.

Step 5 — Default
  → SlideParallax (left). Duration: 25 frames.
  This replaces the existing hard slide-left in a premium way.
```

### 6.3 MotionContinuityEngine

Post-processes the camera timeline of every scene to ensure the entry camera state is consistent with the preceding transition.

**Rules:**

1. **ZoomThrough continuity:** Scene B's first camera keyframe must start at `exitFocal` of the transition, not at (0.5, 0.5). The `MultiPointCameraPlanner` normally starts at (0.5, 0.5) for context — the continuity engine inserts an extra KF(0) at the transition's entry focal point, and shifts the context phase to be a zoom-out from the entry focal point to (0.5, 0.5). This makes the transition feel like a continuous camera move rather than a cut.

2. **SharedElement continuity:** Scene B's context phase is shortened. The camera starts at the shared element's position rather than centre, already oriented at the shared element zoom level.

3. **Return zoom alignment:** Scene A's final keyframe zoom is adjusted to be within 0.1 of the transition's expected exit zoom. This prevents a visible "jump" when the transition starts.

4. **CutAndLand override:** Scene B's context phase is replaced entirely. Frame 0 starts at the primary target's position, and the approach phase is accelerated (approachFrames × 0.6) to simulate landing rather than approaching from wide.

---

## 7. File-by-File Implementation Plan

### Layer 0 — Prerequisites (no new files, minor changes)

| File | Change | Reason |
|------|--------|--------|
| `src/motion/camera/types.ts` | Add `alert`, `metric`, `modal`, `map`, `list` to `ElementType`; add `ExtendedCameraTimeline` interface | Extended element types for Phase 7 |
| `src/motion/camera/CameraProfiles.ts` | Add 5 new entries to `CAMERA_PROFILES` and `CANONICAL_REGIONS` | Profile-driven behaviour for new element types |

### Layer 1 — Domain types (new files, no business logic)

| # | File | Contents |
|---|------|----------|
| 1 | `src/motion/attention/types.ts` | `AttentionTarget`, `AttentionMap`, `AttentionBeat`, `AttentionPhase`, `BeatMotionType`, `Vec2`, `NormalizedRegion` |
| 2 | `src/motion/callouts/types.ts` | `CalloutContent`, `CalloutStyle`, `CalloutVariant`, `CalloutConnector`, `AnimatedCallout`, `CalloutTrack`, `CalloutEnterAnimation`, `CalloutExitAnimation` |
| 3 | `src/motion/transitions/types.ts` | `MotionTransitionType`, `SharedElementSpec`, `TransitionPlan` |
| 4 | `src/motion/types.ts` | `MotionDirectedScene`, `MotionPlan`, `MotionPackage`, `GlobalMotionStyle`, `CameraBeatRange` |

### Layer 2 — Scoring and analysis (pure functions, deterministic)

| # | File | Exports | Depends on |
|---|------|---------|-----------|
| 5 | `src/motion/attention/MotionScorer.ts` | `scoreTargets(targets: AttentionTarget[]): AttentionTarget[]` | Layer 1 types |
| 6 | `src/motion/attention/VisualAttentionAnalyzer.ts` | `analyze(scene: SceneData, intel: PageIntelligence): AttentionMap` | Layer 1 types, MotionScorer |
| 7 | `src/motion/attention/AttentionSequencer.ts` | `sequence(map: AttentionMap, duration: number, fps: number): AttentionBeat[]` | Layer 1 types |

### Layer 3 — Camera planning

| # | File | Exports | Depends on |
|---|------|---------|-----------|
| 8 | `src/motion/camera/MultiPointCameraPlanner.ts` | `plan(beats: AttentionBeat[], map: AttentionMap, duration: number, fps: number): ExtendedCameraTimeline` | Layers 1–2, existing CameraChoreographer, CameraProfiles |

> **Key design:** `MultiPointCameraPlanner` calls `CameraChoreographer.choreograph()` once for each attention target in the sequence, then merges the resulting keyframe arrays. It inserts pan-segment keyframes between them. The existing `CameraLayer` renders the merged timeline unchanged.

### Layer 4 — Callout composition

| # | File | Exports | Depends on |
|---|------|---------|-----------|
| 9 | `src/motion/callouts/CalloutComposer.ts` | `compose(beats: AttentionBeat[], map: AttentionMap, duration: number, style: GlobalMotionStyle): CalloutTrack` | Layers 1–2 |

### Layer 5 — Transition planning and continuity

| # | File | Exports | Depends on |
|---|------|---------|-----------|
| 10 | `src/motion/transitions/TransitionPlanner.ts` | `plan(scenes: MotionDirectedScene[]): TransitionPlan[]` | Layers 1–4 |
| 11 | `src/motion/transitions/MotionContinuityEngine.ts` | `applyContinity(scenes: MotionDirectedScene[], transitions: TransitionPlan[]): MotionDirectedScene[]` | Layers 1–4, TransitionPlanner |

### Layer 6 — Scene orchestrator

| # | File | Exports | Depends on |
|---|------|---------|-----------|
| 12 | `src/motion/SceneMotionPlanner.ts` | `planScene(scene: SceneData, intel: PageIntelligence, style: GlobalMotionStyle): MotionDirectedScene` | Layers 1–5 |
| 13 | `src/motion/MotionDirectionEngine.ts` | `class MotionDirectionEngine { plan(pkg: DemoPackage, intelligence: Map<string, PageIntelligence>): MotionPlan }` | All layers |
| 14 | `src/motion/index.ts` | Barrel re-export of all public types and classes | All |

### Layer 7 — Pipeline stage

| # | File | Exports | Depends on |
|---|------|---------|-----------|
| 15 | `src/application/pipeline/stages/MotionDirectionStage.ts` | `class MotionDirectionStage implements PipelineStage<MotionDirectionInput, MotionDirectionOutput>` | Layer 6, existing pipeline types |

**Stage I/O:**
```typescript
interface MotionDirectionInput {
  demoPackage:   DemoPackage;           // from RemotionExporter output
  intelligence:  Map<string, PageIntelligence>; // from ctx.pageIntelligence
  outputDir:     string;
}

interface MotionDirectionOutput {
  motionPackagePath: string;   // absolute path to motion-package.json
  motionPlan:        MotionPlan;
  durationMs:        number;
}
```

### Layer 8 — Remotion rendering components

| # | File | Type | Depends on |
|---|------|------|-----------|
| 16 | `src/compositions/layers/CalloutLayer.tsx` | React component | Layer 1 callout types |
| 17 | `src/compositions/layers/AttentionRingLayer.tsx` | React component | Layer 1 attention types |
| 18 | `src/compositions/transitions/MotionTransition.tsx` | React component | Layer 3 transition types, existing SceneTransition |
| 19 | `src/compositions/scenes/MotionScene.tsx` | React component | Layers 16–18, existing CameraLayer, DemoScene internals |
| 20 | `src/compositions/DemoVideo.tsx` | MODIFY existing | Layer 19, reads `motionPlan` from props, falls back to Phase 6 if absent |

---

## Layer 8 component specifications

### 16. `CalloutLayer.tsx`

Renders `CalloutTrack.callouts[]` as glassmorphism panels over the product window.

**Key rendering details:**
- Positioned absolutely within the product window's coordinate space
- Uses `position: absolute; left: {panel.x*100}%; top: {panel.y*100}%` on the panel div
- `backdropFilter: blur(20px)` — requires the parent to have `overflow: hidden` (already the case in `DemoScene`)
- Connector drawn as SVG `<line>` with animated `stroke-dashoffset` → `stroke-dasharray` animation for the draw-in effect
- Enter/exit timing driven by `useCurrentFrame()` and the callout's `startFrame/endFrame`
- `willChange: transform, opacity` on every animated callout

**CSS for glassmorphism panel (glass-light variant):**
```css
background:       rgba(255, 255, 255, 0.10);
backdropFilter:   blur(20px);
border:           1px solid rgba(255, 255, 255, 0.18);
borderRadius:     10px;
boxShadow:        0 8px 32px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255,255,255,0.12);
padding:          12px 18px;
```

### 17. `AttentionRingLayer.tsx`

Renders a soft animated ring/pulse around the primary attention target when the camera is in the `hold-primary` beat.

**Appearance:**
- Outer ring: `border: 1.5px solid rgba(accentColor, 0.45)`, `borderRadius: {elementRadius}px`
- Inner glow: `boxShadow: 0 0 24px rgba(accentColor, 0.20)`
- Pulse animation: ring scales from 1.0 to 1.04 and back over 60 frames (2s cycle), `opacity: 0.4–0.8`
- Ring only visible during `hold-primary` beat; fades in over 15 frames, fades out over 10 frames

### 18. `MotionTransition.tsx`

Replaces `SceneTransition` for Phase 7 scenes. Supports all existing transition types plus:

**zoom-through:**
```
During transition:
  - Scene A: CameraLayer zoom continues to accelerate (zoom → 2.4+ → white fill)
  - Scene B: starts invisible; when Scene A hits white, cross-dissolves in from Scene B
             Scene B camera starts at transition.entryFocal, zooms OUT to normal
  - Implementation: two AbsoluteFill layers with synchronized opacity crossfade
                    CameraLayer timeline overrides passed via props
```

**shared-element:**
```
During transition:
  - Scene A content (excluding shared element region): slides out
  - Scene B content (excluding shared element region): slides in
  - Shared element region: remains visually locked (no transform applied to it)
  - Implementation: CSS clip-path or absolute div masking the shared region
                    separate AnimatableContent and LockedContent layers
```

**slide-parallax:**
```
Three layers (z-index order):
  1. Background (slowest): translateX at 0.5× of main slide speed
  2. Midground (normal):   translateX at 1.0× (standard slide)
  3. Foreground (fastest): translateX at 1.5× (foreground content)
  Background = dark gradient/ambient
  Midground  = screenshot (product window)
  Foreground = narration bar + feature badge
```

### 19. `MotionScene.tsx`

Replaces the inner `DemoScene` component in `DemoVideo.tsx`.

**Layer order (bottom to top):**
```
1. AbsoluteFill background (DARK_BG)
2. Ambient glow div (existing — unchanged)
3. Product window div (existing container)
   3a. CameraLayer (existing — unchanged)
       └── Img screenshot
   3b. AttentionRingLayer (NEW — inside product window, above screenshot)
   3c. CalloutLayer       (NEW — inside product window, above ring)
   3d. Vignette overlay   (existing — above callouts, darkens edges)
   3e. Top edge highlight (existing)
   3f. Feature badge      (existing — above vignette)
4. Narration bar          (existing — below product window)
```

### 20. `DemoVideo.tsx` modifications

Two changes only:

1. **New `motionPlan?` prop** on `DemoVideoProps`:
   ```typescript
   export interface DemoVideoProps {
     openingCard: OpeningCard;
     scenes:      SceneData[];
     closingCard: ClosingCard;
     motionPlan?: MotionPlan;   // optional — falls back to Phase 6 if absent
   }
   ```

2. **Scene rendering**: if `motionPlan` is present, use `MotionScene` with the matching `MotionDirectedScene` and `MotionTransition` wrapper. If absent, use existing `DemoScene` + `SceneTransition` path. The fallback preserves all Phase 6 functionality.

---

## Implementation order

```
Day 1 — Types and profiles
  Layer 0: Extend camera types + profiles (§4.2)
  Layer 1: All domain type files (#1–4)

Day 2 — Pure logic
  Layer 2: MotionScorer, VisualAttentionAnalyzer, AttentionSequencer (#5–7)
  Layer 3: MultiPointCameraPlanner (#8)

Day 3 — Composition and transitions
  Layer 4: CalloutComposer (#9)
  Layer 5: TransitionPlanner + MotionContinuityEngine (#10–11)
  Layer 6: SceneMotionPlanner + MotionDirectionEngine + index (#12–14)

Day 4 — Pipeline wiring
  Layer 7: MotionDirectionStage (#15)
  Integrate into WorkflowOrchestrator (after MotionDirectionStage runs, write motion-package.json)

Day 5 — Remotion rendering
  Layer 8: CalloutLayer (#16)
  Layer 8: AttentionRingLayer (#17)

Day 6 — Premium transitions
  Layer 8: MotionTransition (#18) — all 6 transition types
  Layer 8: MotionScene (#19)
  Layer 8: DemoVideo.tsx modification (#20)

Day 7 — Render + review
  Full pipeline run → motion-package.json
  Remotion render → demo-video-motion.mp4
  Review against quality bar (Stripe / Linear benchmark)
```

---

## Quality checklist (post-implementation)

| Check | Criterion |
|-------|-----------|
| Camera never snaps | All keyframe transitions use spring or linear easing — no instant jumps |
| Callout timing | Callout appears after camera settles (frame arrive + 15) and disappears before camera leaves (frame depart - 15) |
| Two callouts max | `CalloutLayer` enforces maximum 2 callouts visible simultaneously |
| No callout overlap | Panel positions are adjusted if two callouts would overlap by > 30% |
| Transition motivated | Every transition type is selected by the algorithm, not hardcoded |
| Return zoom | Every scene's last keyframe is at returnZoom (≥ 1.0, ≤ targetZoom × 0.90) |
| Continuity | Scene B's entry focal point matches the preceding transition's entryFocal |
| Backward compat | Phase 6 video renders identically when `motionPlan` is absent from props |
| No layout shift | All overlay layers use `position: absolute; pointerEvents: none` — no DOM reflow |
| Performance | All `AnimatedCallout`, `AttentionRing`, and `MotionTransition` components declare `willChange` |

---

*Output files:*
- `docs/motion-direction-engine.md` — this document
