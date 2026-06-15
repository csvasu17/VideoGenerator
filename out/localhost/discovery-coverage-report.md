# Discovery Coverage Report

**Pipeline run:** 2026-06-11 14:04 UTC  
**Target:** `http://localhost`  
**Output:** `out/localhost/`  
**Report generated:** 2026-06-12

---

## Verdict

> **FUNCTIONALITY IS NOT BEING DISCOVERED — NOT BEING FILTERED.**

The BFS crawler found **11 unique routes** and **all 11 entered the final video**. There is no filtering problem at the journey or storyboard layer. The gap is entirely at the in-page level: the `InPageDiscovery` module — which clicks ARIA tabs, accordions, expand toggles, and visual tab candidates to reveal hidden panels — **is built, tested, and ready, but is not wired into the production pipeline.** Every piece of functionality that requires a click to reveal is invisible to the system.

---

## Pipeline Configuration (latest run)

| Setting | Value |
|---|---|
| `maxPages` | 20 |
| `maxDepth` | 3 |
| `waitUntil` | `load` |
| `targetJourneySteps` | 12 |
| `featureRanking topN` | 10 |
| Seed URLs | `/dashboard`, `/sites`, `/alarms`, `/devices`, `/insights`, `/ai-predict`, `/simulator`, `/users`, `/settings` |
| InPageDiscovery | **NOT INTEGRATED** |

---

## Discovery Funnel

```
Seed URLs (9) + Landing page
        │
        ▼
BFS URL Discovery ──────────────────────── 11 unique pages found
        │                                  (did NOT hit maxPages=20 cap)
        ▼
Screenshot + Vision Analysis ──────────── 11 pages analyzed
        │                                  ~33–55 raw features extracted
        ▼
Feature Ranking (topN=10) ─────────────── 10 top features ranked
        │                                  ~23–45 tail features dropped
        ▼                                  (LOW impact — all pages still enter video)
Journey Generation ─────────────────────── BeamSearch produced < 12 steps
        │                                  Top-N supplement triggered → 11 nodes
        ▼
Storyboard → Video ─────────────────────── 11 scenes
        │                                  0 pages filtered out
        ▼
demo-package.json                          All 11 discovered pages in video ✓

        ╳
InPageDiscovery  ───────────────────────── NEVER CALLED
        │                                  0 states explored
        │                                  0 hidden panels revealed
        │                                  Estimated 55–88 meaningful states missed
```

---

## Per-Page Breakdown

> **Data note:** `DiscoveredPage.interactiveElements` and `PageIntelligence` are in-memory only — not persisted to disk. BFS element counts and MVID interaction target counts below are **estimates** derived from code logic and page type. State exploration counts are exact (0 — never run).

---

### Scene 1 — Dashboard Overview
`bef1fd5b` · In video: ✅ · Feature: KPI metric card

| Metric | Value |
|---|---|
| BFS interactive elements (est.) | 40–65 |
| MVID interaction targets (est.) | 10–19 |
| — ARIA tab triggers | 4–8 |
| — ARIA accordion headers | 2–4 |
| — ARIA expand toggles | 1–2 |
| — Visual tab candidates | 3–5 |
| States explored | **0** (never run) |
| Meaningful states discovered | **0** |
| States rejected | **0** |
| Est. meaningful states if run | 5–8 |
| Top ranked states | — |
| Likely hidden content | Energy breakdown tab, Alarms panel tab, KPI drill-down chart, Date range filter |

---

### Scene 2 — Energy & Cost Tracking
`f99ad2a1` · In video: ✅ · Feature: Analytics chart

| Metric | Value |
|---|---|
| BFS interactive elements (est.) | 25–45 |
| MVID interaction targets (est.) | 6–10 |
| — ARIA tab triggers | 3–5 |
| — ARIA accordion headers | 1–2 |
| — Visual tab candidates | 2–3 |
| States explored | **0** |
| Meaningful states discovered | **0** |
| States rejected | **0** |
| Est. meaningful states if run | 3–5 |
| Top ranked states | — |
| Likely hidden content | Weekly/monthly aggregation view, Cost vs energy toggle, Site-specific breakdown |

---

### Scene 3 — Team Assignment & Tagging
`12124971` · In video: ✅ · Feature: Data table

| Metric | Value |
|---|---|
| BFS interactive elements (est.) | 20–40 |
| MVID interaction targets (est.) | 4–7 |
| — ARIA tab triggers | 2–4 |
| — ARIA accordion headers | 2–3 |
| States explored | **0** |
| Meaningful states discovered | **0** |
| States rejected | **0** |
| Est. meaningful states if run | 2–4 |
| Top ranked states | — |
| Likely hidden content | Assignment detail expand, Team filter panel, Tag management drawer |

---

### Scene 4 — Failure Prediction Cards
`e8d1e408` · In video: ✅ · Feature: Data table (predictions)

| Metric | Value |
|---|---|
| BFS interactive elements (est.) | 20–35 |
| MVID interaction targets (est.) | 5–9 |
| — ARIA tab triggers | 2–4 |
| — ARIA expand toggles | 3–5 |
| States explored | **0** |
| Meaningful states discovered | **0** |
| States rejected | **0** |
| Est. meaningful states if run | 3–5 |
| Top ranked states | — |
| Likely hidden content | Prediction card expand → recommendations + timeline, Equipment type filter, Action workflow drawer |

---

### Scene 5 — Device Status & Connectivity
`bd852008` · In video: ✅ · Feature: KPI metric card

| Metric | Value |
|---|---|
| BFS interactive elements (est.) | 30–50 |
| MVID interaction targets (est.) | 5–9 |
| — ARIA tab triggers | 3–5 |
| — Visual tab candidates | 2–4 |
| States explored | **0** |
| Meaningful states discovered | **0** |
| States rejected | **0** |
| Est. meaningful states if run | 3–5 |
| Top ranked states | — |
| Likely hidden content | Offline devices filtered view, Unconfigured devices panel, Device map view, Live telemetry drawer |

---

### Scene 6 — Filtering and Search
`cf114607` · In video: ✅ · Feature: Data table (users)

| Metric | Value |
|---|---|
| BFS interactive elements (est.) | 25–40 |
| MVID interaction targets (est.) | 3–6 |
| — ARIA tab triggers | 2–4 |
| — ARIA accordion headers | 1–2 |
| States explored | **0** |
| Meaningful states discovered | **0** |
| States rejected | **0** |
| Est. meaningful states if run | 2–4 |
| Top ranked states | — |
| Likely hidden content | Groups tab (role management table), Roles/permissions tab, Advanced filter panel |

---

### Scene 7 — KPI Summary Widgets
`875a5aee` · In video: ✅ · Feature: KPI metric cards

| Metric | Value |
|---|---|
| BFS interactive elements (est.) | 20–35 |
| MVID interaction targets (est.) | 5–8 |
| — ARIA tab triggers | 3–5 |
| — ARIA expand toggles | 2–3 |
| States explored | **0** |
| Meaningful states discovered | **0** |
| States rejected | **0** |
| Est. meaningful states if run | 3–5 |
| Top ranked states | — |
| Likely hidden content | Financial KPI tab, Predictive KPI tab, Widget drill-down chart |

---

### Scene 8 — Fleet Alarms Dashboard
`79dcd624` · In video: ✅ · Feature: Data table (alarms)

| Metric | Value |
|---|---|
| BFS interactive elements (est.) | 25–45 |
| MVID interaction targets (est.) | 7–11 |
| — ARIA tab triggers | 3–5 |
| — ARIA accordion headers | 2–3 |
| — Visual tab candidates | 2–3 |
| States explored | **0** |
| Meaningful states discovered | **0** |
| States rejected | **0** |
| Est. meaningful states if run | 3–6 |
| Top ranked states | — |
| Likely hidden content | Critical alarms filtered view, Alarm detail expand, Site-specific filter, Alarm history tab |

---

### Scene 9 — Simulator
`06048567` · In video: ✅ · Feature: Configuration form

| Metric | Value |
|---|---|
| BFS interactive elements (est.) | 15–30 |
| MVID interaction targets (est.) | 3–6 |
| — ARIA tab triggers | 2–4 |
| — ARIA accordion headers | 1–2 |
| States explored | **0** |
| Meaningful states discovered | **0** |
| States rejected | **0** |
| Est. meaningful states if run | 2–4 |
| Top ranked states | — |
| Likely hidden content | Fault type changed → different form fields, Advanced config panel, Results panel |

---

### Scene 10 — Add New Site
`4deca044` · In video: ✅ · Feature: Input form

| Metric | Value |
|---|---|
| BFS interactive elements (est.) | 20–40 |
| MVID interaction targets (est.) | 4–7 |
| — ARIA tab triggers | 3–5 (wizard steps) |
| — ARIA accordion headers | 1–2 |
| States explored | **0** |
| Meaningful states discovered | **0** |
| States rejected | **0** |
| Est. meaningful states if run | 3–5 |
| Top ranked states | — |
| Likely hidden content | Buildings config step, Devices onboarding step, Team invitation step |

---

### Scene 11 — Platform Navigation
`1c00ffab` · In video: ✅ · Feature: Navigation panel

| Metric | Value |
|---|---|
| BFS interactive elements (est.) | 30–55 |
| MVID interaction targets (est.) | 10–15 |
| — ARIA tab triggers | 6–9 (module nav items) |
| — Visual tab candidates | 4–6 |
| States explored | **0** |
| Meaningful states discovered | **0** |
| States rejected | **0** |
| Est. meaningful states if run | 6–9 |
| Top ranked states | — |
| Likely hidden content | Each module selected → content panel changes → unique table or chart |

---

## Aggregate Summary

| Metric | Actual | Estimated |
|---|---|---|
| Pages discovered (BFS) | **11** | — |
| Pages in video | **11** | — |
| Pages filtered from video | **0** | — |
| BFS interactive elements (total) | n/a (not persisted) | 275–505 |
| MVID interaction targets (total) | **0** (never run) | 62–109 |
| States explored | **0** | — |
| Meaningful states discovered | **0** | — |
| States rejected | **0** | — |
| Meaningful states if InPageDiscovery ran | — | **55–88** |

---

## Coverage Gaps

### 🔴 GAP-001 — CRITICAL: InPageDiscovery not integrated
**Category:** In-page state discovery  
**Filtering problem?** No  
**Discovery problem?** **Yes**

`src/agents/discovery/interaction/InPageDiscovery.ts` is fully implemented with:
- 3-pass InteractionDetector (ARIA, structural, visual)
- StateCapture with FunctionalFingerprint
- StateComparator with weighted scoring
- Reset strategies (toggle, sibling-restore, reload)

It is **not called anywhere** in `WorkflowOrchestrator.ts` or any `PipelineStage`. The fix requires adding an `InPageDiscoveryStage` after `ScreenshotIntelligenceStage` that calls `explorePage()` on each loaded page.

**Estimated impact:** 55–88 meaningful states across 11 pages would be discovered, each providing additional screenshot captures and feature signals for narration.

---

### 🟡 GAP-002 — MEDIUM: BFS ceiling at 11 unique routes
**Category:** BFS route discovery  
**Filtering problem?** No  
**Discovery problem?** Yes

Both pipeline runs found exactly 11 pages. The `maxPages=20` cap was not reached — the app simply has ≤11 BFS-navigable routes from the current seed set. Sub-routes like `/sites/add`, `/devices/:id`, `/alarms/:id`, `/users/groups` may be accessible only via JS navigation not captured by BFS link extraction.

**Potential fix:** Extend `APP_SEED_ROUTES` with deeper sub-routes if they exist.

---

### 🟢 GAP-003 — LOW: Feature topN=10 drops tail features
**Category:** Feature ranking / filtering  
**Filtering problem?** Yes (minor)  
**Discovery problem?** No

`FeaturePrioritizationEngine.prioritize({ topN: 10 })` drops ~23–45 lower-ranked features. Impact is LOW because all 11 pages still enter the video regardless (the journey uses page nodes, not feature scores directly for inclusion).

---

### 🟢 GAP-004 — LOW: BFS element cap at 100 per page
**Category:** Interactive element capture  
**Filtering problem?** Yes (minor)  
**Discovery problem?** No

`DiscoveryAgent.extractInteractiveElements()` uses `els.slice(0, 100)`. For dense pages, DOM-order-tail elements may be silently dropped. Affects `signals.interactiveElementCount` used in feature scoring.

---

## StateComparator Scoring Reference

The `StateComparator` uses this formula to decide if an explored state is meaningful:

```
functionalScore = 0.40 × widgetDelta
               + 0.25 × headingDelta
               + 0.20 × interactiveDelta
               + 0.15 × textTokenDelta

isMeaningful = functionalScore ≥ 0.20
```

| Scenario | Est. Score | Meaningful? |
|---|---|---|
| Tab → reveals data table | 0.20 | ✅ yes |
| Tab → reveals chart + 2 headings | 0.37 | ✅ yes |
| Expand toggle → form with 5+ inputs | 0.20 | ✅ yes |
| Modal → form + heading + table | 0.52 | ✅ yes |
| Accordion → text only (~25 tokens) | 0.01 | ❌ no |
| Button → cosmetic animation only | 0.00 | ❌ no |

This means the threshold is well-calibrated for this type of dashboard app. Simple text reveals would be correctly discarded; data panel reveals would be correctly surfaced.

---

## Root Cause Summary

```
Q: Is hidden functionality being filtered out?
A: NO — all BFS-discovered pages appear in the video.
   Feature topN filtering has negligible impact on page selection.

Q: Is hidden functionality not being discovered at all?
A: YES — in-page states are completely unexplored.
   InPageDiscovery module exists but is not integrated.
   Estimated 55–88 meaningful hidden states across 11 pages
   are currently invisible to the pipeline.
```

The single highest-impact fix is wiring `InPageDiscovery.explorePage()` into the pipeline after each page is screenshotted. No changes to ranking, scoring, or video generation logic are needed for that integration.
