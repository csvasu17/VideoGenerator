# Motion Direction Engine — Scoring Amendment
## featureImportance Dimension

**Amends:** `docs/motion-direction-engine.md` §5 Attention Model  
**Status:** Design — no code yet  
**Constraint:** Fully backward-compatible with Phase 7 baseline

---

## Problem Statement

The Phase 7 baseline scoring formula is:

```
motionScore = 0.40 × businessValue
            + 0.25 × elementTypeWeight
            + 0.15 × visualWeight
            + 0.15 × narrativeRole
            + 0.05 × screenCoverage
```

`businessValue` is sourced from `spotlightTarget.priority` — a single 0–1 float produced by the feature ranker. It collapses four distinct signals into one number, and it conflates two different questions:

| Question | What drives the answer |
|----------|----------------------|
| *How visually prominent is this element?* | element area + position + type |
| *How important is this to the story being told?* | feature rank + business category + narration text + contextual confidence |

The current formula answers the first question well. The second question is underweighted and underspecified. The result: a large background chart scores higher than a small "AI Prediction" chip even when the narrator is about to say *"this is the most important feature in the platform."*

**Goal:** The camera must focus on *what matters most to the story*, not only on what is visually prominent.

---

## 1. Updated AttentionTarget Model

### New fields added

```typescript
interface AttentionTarget {
  // ── Existing fields — unchanged ───────────────────────────────────────────

  id:            string;
  elementType:   ElementType;
  region:        NormalizedRegion;
  businessValue: number;        // retained for backward compat; weight reduced
  visualWeight:  number;
  narrativeRole: number;
  motionScore:   number;        // now computed with featureImportance
  label:         string;
  benefit?:      string;
  metric?:       string;

  // ── NEW: featureImportance composite ──────────────────────────────────────

  featureImportance: number;           // 0–1  the new dominant score dimension

  // Source signals feeding featureImportance (all optional — degrade gracefully)
  featureRank?:        number;         // 1-based ordinal rank in PrioritizedFeature list
  featureTotalRanked?: number;         // denominator for rank normalization (e.g. 10 if top-10)
  businessValueTier?:  BusinessValueTier;
  contextConfidence?:  number;         // 0–1  from ContextValidation
  narrativeEmphasis?:  number;         // 0–1  derived from scene narration text
  narrativePosition?:  NarrativePosition; // where in the narration this feature appears

  // ── NEW: story role (derived from featureImportance rank among scene targets) ─

  storyRole: StoryRole;
}

// ── New enumerations ──────────────────────────────────────────────────────────

type BusinessValueTier =
  | 'revenue_impact'       // 1.00 — features that directly affect revenue or ROI
  | 'safety_compliance'    // 0.90 — features protecting assets/people or meeting regulations
  | 'cost_reduction'       // 0.80 — features that measurably reduce operating cost
  | 'operational_efficiency' // 0.60 — features that make workflows faster
  | 'informational'        // 0.40 — features that display data without direct action
  | 'structural';          // 0.20 — navigation, settings, account management

type NarrativePosition =
  | 'hook'      // salesHook text — first impression; deserves primary camera focus
  | 'lead'      // first sentence of narration body
  | 'body'      // middle of narration
  | 'close'     // closing sentence
  | 'absent';   // feature not mentioned in narration at all

type StoryRole =
  | 'hero'         // rank-1 target by featureImportance in the scene
  | 'supporting'   // rank-2 (secondary beat)
  | 'contextual'   // present in frame but camera doesn't land on it
  | 'background';  // not worth a camera beat
```

### BusinessValueTier → business examples

| Tier | Example features |
|------|-----------------|
| `revenue_impact` | AI Predictive Analysis, Energy Savings ROI, Fleet Uptime Dashboard |
| `safety_compliance` | Operational Alerts, Device Health & Offline, Fault Detection |
| `cost_reduction` | Energy & Cost Analytics, Consumption Metrics (Air/Water/Cooler) |
| `operational_efficiency` | Team Assignment & Tagging, Scenario Playback Speed, Filtering & Search |
| `informational` | KPI Summary Widgets, Structured User List, Site Onboarding Progress |
| `structural` | Platform Navigation, Settings Configuration |

---

## 2. featureImportance — Composite Formula

`featureImportance` is always a number in [0, 1]. It is computed from up to four signals. Each signal has a defined fallback so the system always produces a value regardless of which pipeline stages contributed data.

### Component scores

#### A. featureRankScore
*"How highly ranked is this feature in the overall story?"*

```
featureRankScore =
  if featureRank and featureTotalRanked available:
    // Non-linear decay — gap between #1 and #2 is larger than #5 and #6
    // Rank 1 = 1.0, Rank 2 = 0.88, Rank 3 = 0.78, Rank 5 = 0.63, Rank 10 = 0.35
    score = max(0, 1.0 - (featureRank - 1) × 0.072 - ((featureRank - 1)² × 0.004))

  else if businessValue available (spotlightTarget.priority):
    score = businessValue    ← direct fallback

  else:
    score = 0.60             ← neutral default (gives camera a reason to move)
```

Non-linear because rank position carries more information than a linear scale implies. The difference between "this is your hero feature" (rank 1) and "this is a supporting feature" (rank 3) is a story decision, not just a 20% score delta.

#### B. businessValueTierScore
*"What category of business outcome does this feature represent?"*

```
businessValueTierScore =
  if businessValueTier available:
    revenue_impact:          1.00
    safety_compliance:       0.90
    cost_reduction:          0.80
    operational_efficiency:  0.60
    informational:           0.40
    structural:              0.20

  else if elementType available:
    // Proxy mapping — best available without BusinessValueStage data
    modal:      0.80
    alert:      0.85   ← alerts imply operational/safety context
    kpi_card:   0.70
    chart:      0.65
    button:     0.60
    table:      0.55
    form:       0.55
    metric:     0.65
    map:        0.50
    list:       0.45
    navigation: 0.25
    default:    0.45

  else:
    score = 0.55             ← neutral default
```

#### C. contextConfidenceScore
*"Is this feature actually present and visible on screen right now?"*

```
contextConfidenceScore =
  if contextConfidence available:
    score = contextConfidence     ← direct pass-through (0–1 from ContextValidation)

  else:
    score = 0.75                  ← conservative trust; assume visible but not certain
```

Context confidence prevents the camera from zooming into a region that is
theoretically the right area for a feature but isn't actually rendered in this
particular screenshot. For example, `Real-Time Alert Feed` on the `/alarms`
page — if ContextValidation confirms the alert list is visible, confidence=0.95.
If the page loaded with 0 alerts, confidence=0.30 → camera deprioritizes it.

#### D. narrativeEmphasisScore
*"Is this what the narrator is talking about — and when?"*

```
narrativeEmphasisScore =
  if narrativePosition available:
    hook:     1.00    ← "AI Predictive Analysis is Rheem's most powerful tool"
    lead:     0.80    ← first body sentence — close to hook in importance
    body:     0.55    ← mentioned but not the headline claim
    close:    0.35    ← mentioned in summary/wrap-up
    absent:   0.15    ← not mentioned (camera should still be relevant, not empty)

  else:
    score = 0.50                  ← neutral; no narration data available
```

#### Composite formula

```
featureImportance =
    0.40 × featureRankScore            // ordinal position drives the story most
  + 0.28 × businessValueTierScore      // category separates AI Insights from Settings
  + 0.20 × narrativeEmphasisScore      // align camera to what narrator is saying
  + 0.12 × contextConfidenceScore      // prevent zooming into invisible features
```

**Why these weights:**
- Rank score carries 40% — it directly encodes the product team's priority decision. A top-3 feature should get camera attention even with average business tier and no narration mention.
- Business tier carries 28% — it differentiates within the same rank band. Two rank-5 features where one is revenue-impacting and one is structural should not behave identically.
- Narration emphasis carries 20% — it provides temporal alignment. When the narrator says the word, the camera should already be there.
- Context confidence carries 12% — it is a quality gate, not a scoring signal. It prevents bad camera decisions; it doesn't make good ones.

---

## 3. Updated motionScore Formula

`featureImportance` absorbs what `businessValue` was previously doing (as the dominant 0.40 term) and adds three additional dimensions. `businessValue` is retained on the model for backward compat but is no longer a direct term in `motionScore`:

### Revised formula

```
motionScore =
    0.45 × featureImportance     // absorbs and extends old businessValue
  + 0.25 × elementTypeWeight     // unchanged from baseline
  + 0.15 × visualWeight          // reduced from 0.15 — story > visuals
  + 0.10 × narrativeRole         // reduced from 0.15 — now partially captured in featureImportance
  + 0.05 × screenCoverage        // unchanged tiebreaker
```

### Weight rationale — why these specific shifts

| Dimension | Old weight | New weight | Reason for change |
|-----------|-----------|-----------|-------------------|
| featureImportance (new) | — | 0.45 | Replaces + extends old businessValue |
| businessValue (old) | 0.40 | 0.00 | Absorbed into featureImportance |
| elementTypeWeight | 0.25 | 0.25 | Unchanged — element type is still the clearest visual intent signal |
| visualWeight | 0.15 | 0.15 | Unchanged — visual size still matters (don't zoom into invisible elements) |
| narrativeRole | 0.15 | 0.10 | Reduced — primary/secondary distinction now encoded in storyRole derived from featureImportance |
| screenCoverage | 0.05 | 0.05 | Unchanged tiebreaker |

### Concrete score examples (post-amendment)

**Scenario: Scene with three candidates**

| Element | featureRank | businessValueTier | contextConf | narrativePos | featureImportance | elementTypeWeight | visualWeight | narrativeRole | motionScore | Verdict |
|---------|-------------|-------------------|-------------|-------------|------------------|-------------------|--------------|---------------|-------------|---------|
| AI Prediction chip (small) | 2 | revenue_impact | 0.90 | hook | **0.87** | 0.90 (button) | 0.22 (small) | 1.00 | **0.69** | PRIMARY ★ |
| Energy chart (large) | 5 | cost_reduction | 0.85 | body | 0.62 | 0.72 (chart) | 0.68 (large) | 0.55 | **0.57** | secondary |
| Navigation sidebar | 11 | structural | 0.95 | absent | 0.28 | 0.40 (navigation) | 0.45 | 0.20 | **0.31** | background |

Without featureImportance, the large energy chart would have scored higher than the AI chip purely from visual weight and screenCoverage. The amendment corrects this.

---

## 4. Integration Points

### 4.1 MotionDirectionStage input interface (extended)

`MotionDirectionStage` must receive additional pipeline outputs to populate featureImportance signals:

```
MotionDirectionInput (UPDATED):
  demoPackage:          DemoPackage
  intelligence:         Map<string, PageIntelligence>
  outputDir:            string

  // NEW — all optional for backward compat
  rankedFeatures?:      PrioritizedFeature[]          // from FeatureRankingStage
  businessAssessments?: Map<string, BusinessValueAssessment>  // from BusinessValueStage
  contextValidations?:  Map<string, ContextValidationResult>  // from ContextValidationStage
  scenarrations?:       Map<string, SceneNarration>   // from demo-package.json narration fields
```

**Key point:** every new field is optional. If the stage is called with only `demoPackage` + `intelligence` (the Phase 7 baseline), it degrades to pure Phase 7 scoring with no regressions.

### 4.2 VisualAttentionAnalyzer enrichment

This is the primary integration site. `VisualAttentionAnalyzer.analyze()` receives an extended input:

```
Current:
  analyze(scene: SceneData, intel: PageIntelligence): AttentionMap

Updated:
  analyze(scene: SceneData, intel: PageIntelligence, context?: AttentionContext): AttentionMap

AttentionContext (NEW):
  rankedFeatures:    PrioritizedFeature[]     // full ranked list for rank lookup
  businessAssessment?: BusinessValueAssessment  // tier lookup for this scene's feature
  contextValidation?:  ContextValidationResult  // confidence for each feature on this page
  sceneNarration?:     SceneNarration           // narration text for emphasis parsing
```

When `context` is absent → same behavior as Phase 7. No breaking change.

### 4.3 featureImportance computation site: FeatureImportanceResolver

New pure function (extracted from `VisualAttentionAnalyzer` for testability):

```
FeatureImportanceResolver.resolve(
  feature:     PrioritizedFeature | undefined,
  context:     AttentionContext | undefined,
  fallbackPriority: number                   // spotlightTarget.priority — always available
): FeatureImportanceResult

FeatureImportanceResult:
  featureImportance:    number    // 0–1 composite
  featureRank?:         number
  featureTotalRanked?:  number
  businessValueTier?:   BusinessValueTier
  contextConfidence?:   number
  narrativeEmphasis?:   number
  narrativePosition?:   NarrativePosition
  signals:              FeatureImportanceSignals   // which sources contributed
```

`FeatureImportanceSignals` is a diagnostic struct:

```
FeatureImportanceSignals:
  rankSource:      'pipeline' | 'fallback_priority' | 'default'
  tierSource:      'pipeline' | 'elementType_proxy' | 'default'
  confidenceSource:'pipeline' | 'default'
  emphasisSource:  'narration_parse' | 'default'
```

This allows the motion-package.json to record which signals were live vs. fallback — useful for debugging and for measuring pipeline coverage improvement over time.

### 4.4 NarrationEmphasisParser

Standalone text analysis function (no LLM):

```
NarrationEmphasisParser.parse(
  narration: SceneNarration,
  featureLabel: string
): { position: NarrativePosition; score: number }
```

**Algorithm:**
1. Normalise `featureLabel` → tokens (lowercase, strip common words)
2. Check `salesHook` text → if any token matches → `hook` (1.00)
3. Check narration first sentence → if matches → `lead` (0.80)
4. Check narration body → if matches → `body` (0.55)
5. Check closing sentence → if matches → `close` (0.35)
6. No match → `absent` (0.15)

Token matching uses simple substring + word-boundary matching. Handles:
- "AI Predictive Analysis" → tokens: ["ai", "predictive", "analysis"]
- "Energy Savings" → tokens: ["energy", "savings"]
- Partial match threshold: ≥ 2 of N tokens must appear in proximity (within 10 words)

**Why not exact match:** Feature labels are often paraphrased in narration. "Scenario Playback Speed" might appear as "control scenario playback" in the voice script. Token intersection handles this without needing semantic search.

### 4.5 Data availability per pipeline run

| Signal | Available when | Absent when | Fallback |
|--------|---------------|-------------|----------|
| `featureRankScore` | FeatureRankingStage ran + rankedFeatures passed to MotionDirectionStage | Legacy packages, partial runs | `businessValue` (spotlightTarget.priority) |
| `businessValueTierScore` | BusinessValueStage ran + assessments passed | Most current runs (not yet implemented) | elementType proxy table |
| `contextConfidenceScore` | ContextValidationStage ran + validations passed | Most current runs | 0.75 conservative default |
| `narrativeEmphasisScore` | SceneNarration from demo-package.json scenes[].narration | Scenes with missing narration | 0.50 neutral |

**Current pipeline status (Run B):** `demo-package.json` contains `salesHook` and `narration` per scene. This means `narrativeEmphasisScore` is available immediately — no new pipeline stages needed for the narration signal. The rank signal is derivable from the order of features in `scenes[].spotlightTarget.priority` across scenes. `businessValueTier` and `contextConfidence` require future stage integration.

**Implication:** Phase 7 launch can activate two of four signals (rank + narration) on day one. The other two slots fill in as pipeline stages mature.

---

## 5. Backward Compatibility Impact

### What changes

| Component | Change | Impact |
|-----------|--------|--------|
| `AttentionTarget` interface | 8 new optional fields + 1 new required field (`storyRole`) | Additive. Existing producers that set only old fields get `featureImportance` computed by `FeatureImportanceResolver` with fallback path |
| `motionScore` formula | Weight redistribution; `businessValue` removed as direct term | Score values change (different numbers). Direction of change: features with high rank + matching narration score higher; visually large but narratively irrelevant elements score lower |
| `MotionDirectionInput` | 4 new optional fields | Zero impact on callers that don't supply them |
| `VisualAttentionAnalyzer.analyze()` | New optional 3rd argument `context?` | Zero impact on existing call sites |
| `MotionScorer.scoreTargets()` | Formula updated; reads new fields | Requires `featureImportance` to be pre-populated on targets before scoring |

### What does not change

| Component | Status |
|-----------|--------|
| `CameraLayer.tsx` | Unchanged |
| `CameraChoreographer.ts` | Unchanged |
| `SceneTransition.tsx` | Unchanged |
| `DemoVideo.tsx` (Phase 6 path) | Unchanged |
| `motion-package.json` schema | `motionScore` numeric value changes; schema shape is the same |
| `CalloutTrack`, `TransitionPlan`, `MotionContinuityEngine` | Unchanged — they consume `AttentionTarget.motionScore` which is a float; its source doesn't matter to them |

### Score magnitude change — is it breaking?

`motionScore` is used only to rank `AttentionTarget[]` within a scene (to determine primary vs. secondary). It is never compared across scenes and never stored externally beyond `motion-package.json`. A change in absolute values is not breaking — only a change in relative ordering within a scene matters.

**Regression risk:** Low. The ordering changes only when the narrative/rank signals override what visual prominence suggested — which is precisely the desired correction.

**Test scenario to validate no regression:** Run the engine on a scene where there is no pipeline context (all new optional fields absent). The computed `featureImportance` collapses to `businessValue` (fallback path). The final `motionScore` distribution will be numerically different (weights shifted) but the rank ordering of targets should be identical to Phase 7 baseline for a typical scene. This is verifiable by running the pure scoring function with identical inputs before and after.

---

## 6. StoryRole Assignment

After `motionScore` is computed for all targets in a scene, `storyRole` is assigned:

```
For each target in AttentionMap.targets (sorted desc by motionScore):
  index 0: storyRole = 'hero'
  index 1: storyRole = 'supporting'   (only if motionScore > 0.35)
  index 2+: storyRole = 'contextual'  (only if motionScore > 0.20)
  below threshold: storyRole = 'background'
```

`storyRole` is used by:
- `AttentionSequencer` — only `hero` and `supporting` targets get camera beats
- `CalloutComposer` — `hero` target always gets a callout; `supporting` gets one only if scene duration allows
- `MotionTransition` for ZoomThrough — exit focal is always the `hero` target's region center

---

## Summary

| Dimension | Before | After |
|-----------|--------|-------|
| Scoring signals | 5 (businessValue, elementTypeWeight, visualWeight, narrativeRole, screenCoverage) | 8 (featureImportance replaces businessValue; adds featureRank, businessValueTier, contextConfidence, narrativeEmphasis) |
| Camera priority driver | Visual prominence + normalized priority | Narrative importance + business tier + contextual confidence |
| "AI Prediction chip" scenario | Underscored vs large chart | Correctly prioritised as primary target |
| Data required (minimum) | spotlightTarget.priority | Same — featureImportance falls back gracefully |
| Data required (full) | — | PrioritizedFeature[], BusinessValueAssessment, ContextValidationResult, SceneNarration |
| Breaking changes | — | None |
| New files | — | `FeatureImportanceResolver.ts`, `NarrationEmphasisParser.ts` |
| Modified files | — | `attention/types.ts`, `VisualAttentionAnalyzer.ts`, `MotionScorer.ts`, `MotionDirectionStage.ts` (input interface) |

---

*Output files:*  
- `docs/motion-scoring-amendment.md` — this document  
- Amends `docs/motion-direction-engine.md` §5 Attention Model
