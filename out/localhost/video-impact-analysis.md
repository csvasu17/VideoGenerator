# Video Impact Analysis — Pre vs. Post InPageDiscovery

**Generated:** 2026-06-12  
**Run A:** 2026-06-11 · `http://localhost` · Pre-InPageDiscovery  
**Run B:** 2026-06-12 · `http://localhost:5173` · Post-InPageDiscovery  

---

## ⚠️ Critical Pre-Finding: Run B Was Never Rendered

Before any comparison: the `demo-video-with-voice.mp4` on disk **is from Run A**, not Run B.

| File | Last Written | Source |
|------|-------------|--------|
| `voice-script.json` | 12-06-2026 11:07 | Manually crafted (Run A era) |
| `voice-narration.mp3` | 12-06-2026 11:08 | Generated from voice-script.json |
| `demo-video.mp4` | 12-06-2026 11:16 | Remotion render from Run A demo-package.json |
| `demo-video-with-voice.mp4` | 12-06-2026 11:25 | Merged video — **Run A source** |
| `demo-package.json` | 12-06-2026 **12:34** | Run B pipeline — **69 min AFTER video render** |

Run B wrote a new `demo-package.json` but no `npm run render` was executed afterward. Every improvement from InPageDiscovery is invisible in the current physical video.

---

## 1. Feature Comparison

### Run A — 10 Ranked Features (all 10 assigned to scenes)

| Rank | Feature | Page | Scene |
|------|---------|------|-------|
| 1 | Dashboard KPI (Energy & Cost, Device Health) | /dashboard | scene-1 ✅ |
| 2 | Energy & Cost Analytics | /insights | scene-2 ✅ |
| 3 | Team Assignment & Tagging | /alarms | scene-3 ✅ |
| 4 | Failure Prediction Cards | /ai-predict | scene-4 ✅ |
| 5 | Device Status & Connectivity | /devices | scene-5 ✅ |
| 6 | Filtering and Search | /users | scene-6 ✅ |
| 7 | KPI Summary Widgets | /insights | scene-7 ✅ |
| 8 | Fleet Alarms Dashboard | /alarms | scene-8 ✅ |
| 9 | Simulator Configuration | /simulator | scene-9 ✅ |
| 10 | Site Onboarding / Add Building | /sites | scene-10 ✅ |

**Feature → scene assignment rate: 10/11 scenes (91%)**

---

### Run B — 10 Ranked Features (only 5 assigned to scenes)

| Rank | Feature | Source | Discovered Via | Scene | Assigned? |
|------|---------|--------|---------------|-------|-----------|
| 1 | Add Building Action | /sites | base + state | scene-4 | ✅ |
| 2 | Structured User List Table | /users | base + state | scene-3 | ✅ |
| 3 | Energy and Cost Metrics | /dashboard | base + state | scene-1 | ✅ |
| 4 | Energy & Cost Analytics | /insights | base + state | scene-2 | ✅ |
| 5 | Consumption Metrics (Air/Water/Cooler) | /dashboard | base + state | scene-1 | ✅ (merged with #3) |
| 6 | Real-Time Alert Feed | /alarms | base + state | — | ❌ BOTTLENECK |
| **7** | **Scenario Playback Speed** | **/simulator** | **state only ★** | **scene-5** | **✅ NEW** |
| 8 | Multi-site Device Monitoring | /sites | base + state | — | ❌ BOTTLENECK |
| 9 | Device Health & Offline Tracking | /devices | base + state | scene-1 (secondary) | ⚠️ wrong scene |
| 10 | Search and Quick Filter | /users | base + state | scene-3 (merged) | ✅ (merged with #2) |

**Feature → scene assignment rate: 5/11 scenes (45%)**

### Feature Delta

| Change | Feature |
|--------|---------|
| ★ NEW (InPageDiscovery) | Scenario Playback Speed |
| Lost from Run A | Team Assignment & Tagging |
| Lost from Run A | Failure Prediction Cards |
| Lost from Run A | KPI Summary Widgets |
| Weakened from Run A | Fleet Alarms → Real-Time Alert Feed (not assigned to scene) |
| Weakened from Run A | Device Status → Device Health (assigned to wrong scene) |

> **Net feature gain from InPageDiscovery: 1 new feature reached the video.** The other 9 state features either reinforced existing rankings or were crowded out by dashboard/energy metrics that were boosted by state analysis.

---

## 2. Journey Comparison

### Side-by-Side Journey Paths

| Scene | Run A page | Run B page | Change |
|-------|-----------|-----------|--------|
| 1 | /dashboard | /dashboard | ↔ same |
| 2 | /insights | /insights | ↔ same |
| 3 | /alarms | /users | ↔ different page |
| 4 | /ai-predict | /sites | ↔ different page |
| 5 | /devices | /simulator | ↔ different page |
| 6 | /users | /alarms | ↔ different page |
| 7 | /insights | /devices | ↔ different page |
| 8 | /alarms | /ai | ↔ different page |
| 9 | /simulator | **/ (LOGIN PAGE)** | ❌ degraded |
| 10 | /sites | **/ (LOGIN PAGE AGAIN)** | ❌ degraded |
| 11 | nav panel | /settings | ↔ different |

### Journey Quality Summary

| Metric | Run A | Run B |
|--------|-------|-------|
| Content pages | 11/11 (100%) | 9/11 (82%) |
| Login page appearances | 0 | **2 (scenes 9 + 10)** |
| Duplicate pages | 0 | **2 (same URL, same screenshot)** |
| Frames wasted on login | 0 | **540 frames (18 s, 20% of content)** |
| Specific feature in scene | 11/11 | 5/11 |

### Root Cause: Login Page Appears Twice

BFS reached the root URL `/` via two different crawl paths, generating two `DiscoveredPage` entries with distinct UUIDs (`2ac6c474` and `f39ec4fc`). They have identical base screenshots (same SHA-256 hash). The `JourneyGenerator` TopN supplement appends pages by UUID, not by URL — so both entries enter the journey as valid unique steps.

Both root pages have:
- 0 interaction targets
- 3 features (the lowest in the entire pipeline)
- visually identical screenshots
- `budgetStatus: 'completed'` with 0 states explored

**Fix:** JourneyGenerator TopN supplement must deduplicate candidates by URL and filter out pages where `interactionTargets == 0 AND rankedFeatureCount == 0`.

---

## 3. Storyboard Comparison

### Run A — 0 generic fallback scenes

All 11 scenes had a specific feature, a meaningful narration, and a correctly identified UI element.

| Scene | Title | Element | Feature quality |
|-------|-------|---------|----------------|
| 1 | Dashboard Overview | kpi | ✅ specific |
| 2 | Energy & Cost Tracking | chart | ✅ specific |
| 3 | Team Assignment & Tagging | table | ✅ specific |
| 4 | Failure Prediction Cards | table | ✅ specific |
| 5 | Device Status & Connectivity | kpi | ✅ specific |
| 6 | Filtering and Search | table | ✅ specific |
| 7 | KPI Summary Widgets | kpi | ✅ specific |
| 8 | Fleet Alarms Dashboard | table | ✅ specific |
| 9 | Simulator | form | ✅ specific |
| 10 | Add New Site | form | ✅ specific |
| 11 | Platform Navigation | navigation | ✅ specific |

### Run B — 6 generic fallback scenes

| Scene | Title | Element | Status | Expected feature |
|-------|-------|---------|--------|-----------------|
| 1 | Consumption Metrics (Air/Water/Cooler) | kpi_card | ✅ specific | — |
| 2 | Energy and Cost | kpi_card | ✅ specific | — |
| 3 | Structured User List | table | ✅ specific | — |
| 4 | Add Building Action | button | ✅ specific | — |
| **5** | **Scenario Playback Speed** | table | **✅ specific ★ NEW** | — |
| 6 | ~~Rheem TotalView~~ | table | ❌ generic | Real-Time Alert Feed |
| 7 | ~~Rheem TotalView~~ | table | ❌ generic | Device Health & Offline Tracking |
| 8 | ~~Rheem TotalView~~ | table | ❌ generic | AI prediction feature |
| 9 | ~~Rheem TotalView input~~ | form | ❌ generic | NONE (login page) |
| 10 | ~~Rheem TotalView input~~ | form | ❌ generic | NONE (login page duplicate) |
| 11 | ~~Rheem TotalView navigation~~ | navigation | ❌ generic | Settings/Config feature |

> Scenes 6–7 have the correct top-10 ranked features available but the `StoryboardGenerator` did not assign them. This is a storyboard assembly bug, not a discovery or ranking failure.

---

## 4. Video Comparison

### Narration Analysis

| | Run A (rendered, on disk) | Run B (not rendered) |
|---|---|---|
| Scene narrations | 11 specific | 5 specific, 6 generic |
| Narration source | voice-script.json (manual) | demo-package.json (auto-generated) |
| Narration matches visuals | ✅ Yes | ❌ No (voice-script.json not updated) |
| Scene 5 narration | "Every device's status at a glance" | "With Scenario Playback Speed, your team controls exactly how fast scenarios run" |
| Scene 9 narration | "The built-in simulator lets you test failure scenarios" | "Rheem TotalView: create Rheem TotalView in real time" |

### Screenshots in Video

| | Run A | Run B |
|---|---|---|
| Base page screenshots | 11 | 11 |
| Interaction state screenshots | 0 | 0 |
| States visible in video | 0 | 0 |

> Both runs show only base page screenshots. The 9 meaningful interaction states discovered by InPageDiscovery are architecturally blocked from the video renderer (by design — states never enter `ctx.pageCaptures`). The richer visual content (expanded panels, active configurations) discovered via interaction is never shown to the viewer.

### Which Interaction States Reached the Final Video?

| Page | State | Reached video via feature? | Reached video via screenshot? | Net contribution |
|------|-------|---------------------------|------------------------------|-----------------|
| /simulator | Playback controls state | ✅ Yes — "Scenario Playback Speed" (scene-5) | ❌ No | 1 new specific scene |
| /dashboard | Expanded widget states (×5) | ❌ No — merged into existing features | ❌ No | Reinforced existing |
| /sites | Sites interaction | ❌ No — "Add Building Action" already existed in Run A | ❌ No | No net gain |
| /alarms | Alarm detail state | ❌ No — "Real-Time Alert Feed" not assigned to scene-6 | ❌ No | Storyboard bottleneck |
| /devices | Device list state | ❌ No — "Device Health" in wrong scene | ❌ No | Storyboard bottleneck |
| /insights | Insights state | ❌ No — energy features already covered | ❌ No | Reinforced existing |
| /users | User list state | ❌ No — merged into scene-3 | ❌ No | Reinforced existing |
| /settings | Settings state | ❌ No — no settings feature in top-10 | ❌ No | Feature ranking gap |
| /ai | AI page state | ❌ No — no AI feature in top-10 | ❌ No | Feature ranking gap |

**Summary: 1 of 9 meaningful interaction states produced a net video improvement (11% conversion rate).**

---

## 5. Bottleneck Analysis

### Bottleneck Stack (most critical to least)

```
IMMEDIATE: Video never re-rendered from Run B
  ↓
PRIMARY BOTTLENECK: Journey Generation
  TopN supplement includes duplicate login pages (scenes 9-10)
  → 20% of video wasted; 2 content slots lost
  ↓
SECONDARY BOTTLENECK: Storyboard Generation  
  6 of 11 scenes fall back to generic template
  → Real-Time Alert Feed, Device Health not assigned to their pages' scenes
  ↓
TERTIARY BOTTLENECK: Feature Ranking (deduplication)
  88.9% dedup rate; specific page-level features (AI, Settings) never enter top-10
  → /ai and /settings scenes have no assignable feature regardless
  ↓
QUATERNARY BOTTLENECK: Video Rendering
  Interaction state screenshots architecturally blocked
  → Richer discovered states never shown, even when feature is in top-10
```

### Stage Verdicts

| Stage | Status | Finding |
|-------|--------|---------|
| BFS Discovery | ✅ Not a bottleneck | All 11 pages discovered in both runs |
| Screenshot + Vision | ✅ Not a bottleneck | All captures successful, all vision mode |
| InPageDiscovery | ✅ Working correctly | 17 explored, 9 meaningful, 1 reached video |
| Feature Ranking | ⚠️ Tertiary bottleneck | 88.9% dedup + specific features outranked by broad metrics |
| **Journey Generation** | **❌ Primary bottleneck** | **Login page ×2 in journey; 20% of video wasted** |
| **Storyboard Generation** | **❌ Secondary bottleneck** | **6/11 scenes generic despite matching top-10 features** |
| Video Rendering | ⚠️ Quaternary bottleneck | State screenshots architecturally blocked from all scenes |
| Re-render step | ❌ Immediate action | Run B changes not yet rendered into any physical video |

---

## Prioritised Action Plan

| Priority | Action | Stage | Expected Impact | Effort |
|----------|--------|-------|-----------------|--------|
| **1** | **Re-render video from Run B demo-package.json** | Deployment | Produces a video that actually includes InPageDiscovery improvements | Trivial — `npm run render:demo` |
| **2** | **Fix JourneyGenerator TopN: dedup by URL + filter zero-value pages** | Journey Generation | Removes 2 login scenes; 2 content slots freed for alarms/devices/ai | Low |
| **3** | **Fix StoryboardGenerator: bind ranked feature to its source page's scene** | Storyboard Generation | Eliminates generic fallback for scenes 6-7 (Real-Time Alert Feed, Device Health) | Medium |
| 4 | Update voice-script.json for Run B, regenerate TTS | Narration | Audio matches Run B scene order (Scenario Playback Speed, new ordering) | Low |
| 5 | Increase topN from 10→15-20 + page-diversity constraint | Feature Ranking | Restores /ai and /settings specific features | Low |
| 6 | Pass interactionStatePaths into StoryboardScene assembly | Video Rendering | Scenario Playback Speed scene shows interaction screenshot, not static base | Medium |

---

## Summary

**One feature from InPageDiscovery reached the final video: "Scenario Playback Speed" (scene-5, /simulator).** It was only discoverable via interaction (clicking the simulator's playback controls) — a genuine addition that Run A could not produce.

**However, Run B's pipeline regressed in overall quality.** Run A had 11/11 specific scenes with 0 generic fallback. Run B has 5/11 specific scenes and 6/11 generic fallback — including 2 scenes that show the login screen twice. The video has not been re-rendered from Run B at all.

**The next bottleneck is Journey Generation**, not Feature Ranking, not InPageDiscovery. The feature pipeline produced correct ranked output. The journey routing is what broke the storyboard — once the login page enters twice and content pages lose their slots, the storyboard generator has nothing specific to assign. Fix the journey, and the storyboard quality will recover.

---

*Output files:*
- `out/localhost/video-impact-analysis.json` — machine-readable
- `out/localhost/video-impact-analysis.md` — this document
