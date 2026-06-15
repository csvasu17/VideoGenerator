
# Sales Story Director — Validation Report
**Product:** Rheem TotalView
**Run date:** 2026-06-14T10:12:25.749Z
**Pipeline stage:** Phase 8 — SalesStoryDirectorStage

---

## Arc Selection

| Field | Value |
|-------|-------|
| **Arc Type** | `reactive_to_predictive` |
| **Title** | From Reactive to Predictive Operations |
| **Premise** | Unplanned failures drain budgets and teams |
| **Resolution** | the Platform turns every data point into a prevention strategy |
| **Opening Hook** | Operations managers have no single view of energy usage and device status across their sites. |
| **Closing CTA** | Schedule a live demo today |
| **Arc Narrative** | 7-scene arc: monitor, predict, prevent, validate |
| **Scene Count** | 7 |

---

## Arc Validation

| Check | Result |
|-------|--------|
| **Arc Complete** | ✅ Yes |
| **Missing Roles** | None |
| **Overall Score** | 96.9% |
| **Weak Scenes** | None |
| **Redundant Scenes** | None |


---

## Scene Sequence

# | Role | Feature | Callout | Proof Element | Priority | Min Dur | Camera
--|------|---------|---------|---------------|----------|---------|-------
1 | 🎣 **hook** | Dashboard KPI Overview | `See Everything. Act Faster.` | trend_chart | ████████░░ 76% | 12s | z=1.52 page_overview full-page
2 | 💡 **insight** | AI Predictive Maintenance | `Prevent Failures Before They Happen` | prediction_card | ██████████ 95% | 10s | z=1.62 proof_focus bbox(0.05,0.08)+pop@2.5s
3 | ⚡ **action** | Real-Time Alarm Feed | `Respond Faster To Critical Issues` | alert_severity | ████████░░ 76% | 7s | z=1.52 proof_focus bbox(0.78,0.12)
4 | 🔬 **validation** | Fault Simulator | `Test Every Scenario. Zero Risk.` | prediction_card | █████████░ 95% | 9s | z=1.62 proof_focus bbox(0.05,0.18)+pop@3s
5 | 📡 **scale** | Device Fleet Analytics | `Monitor Every Device In Real Time` | fleet_health_summary | ████████░░ 84% | 7s | z=1.56 data_sweep bbox(0.62,0.08)
6 | ✅ **outcome** | Device Fleet Monitor | `Monitor Every Device In Real Time` | fleet_health_summary | ████████░░ 84% | 8s | z=1.56 proof_focus bbox(0.65,0.05)
7 | 📡 **scale** | Alarm Center Dashboard | `Respond Faster To Critical Issues` | alert_severity | ████████░░ 76% | 7s | z=1.52 data_sweep bbox(0.61,0.12)

---

## Per-Scene Detail


### Scene 1 — 🎣 HOOK: Dashboard KPI Overview

| Field | Value |
|-------|-------|
| **Page ID** | `f9e5448f…` |
| **Callout** | **See Everything. Act Faster.** |
| **Scene Goal** | hook: See Everything. Act Faster. |
| **Narrative Hook** | Operations managers have no single view of energy usage and device status across their sites. |
| **Closing Line** | Teams resolve issues 40% faster because every metric is always one click away. |
| **Story Priority** | ████████░░ 76% |
| **Min Duration** | 12s |
| **Value Category** | efficiency_gain |
| **Impact Statement** | See every KPI metric and site status on one dashboard — no manual data pulls.… |

**Proof Element:**
- Type: `trend_chart`
- Label: Total Energy Spend
- Claim: Total Energy Spend: $12,400 / mo
- BBox: x=0.55 y=0.08 w=0.40 h=0.78
- Visual Weight: 1.00

**Camera Intent:**
- Strategy: `page_overview`
- Motion Style: `ken_burns`
- End Zoom: 1.52×
- Proof Pop At: none
- Zoom Target: full-page


### Scene 2 — 💡 INSIGHT: AI Predictive Maintenance

| Field | Value |
|-------|-------|
| **Page ID** | `e8011180…` |
| **Callout** | **Prevent Failures Before They Happen** |
| **Scene Goal** | insight: Prevent Failures Before They Happen |
| **Narrative Hook** | Unplanned equipment failures cause costly downtime and reactive repair cycles. |
| **Closing Line** | Teams eliminate 80% of emergency repair callouts and reduce downtime costs by $50K/year. |
| **Story Priority** | ██████████ 95% |
| **Min Duration** | 10s |
| **Value Category** | risk_prevention |
| **Impact Statement** | Prevent failures before they happen — AI detects anomalies 14 days in advance.… |

**Proof Element:**
- Type: `prediction_card`
- Label: Failure Probability
- Claim: Failure Probability: High Risk — 14 days
- BBox: x=0.05 y=0.08 w=0.38 h=0.22
- Visual Weight: 1.00

**Camera Intent:**
- Strategy: `proof_focus`
- Motion Style: `zoom_in`
- End Zoom: 1.62×
- Proof Pop At: 2.5s
- Zoom Target: bbox(0.05,0.08,0.38,0.22)


### Scene 3 — ⚡ ACTION: Real-Time Alarm Feed

| Field | Value |
|-------|-------|
| **Page ID** | `fa351125…` |
| **Callout** | **Respond Faster To Critical Issues** |
| **Scene Goal** | action: Respond Faster To Critical Issues |
| **Narrative Hook** | Critical equipment alerts get buried in email, causing delayed responses and extended outages. |
| **Closing Line** | Mean time to acknowledge drops from 4 hours to under 8 minutes. |
| **Story Priority** | ████████░░ 76% |
| **Min Duration** | 7s |
| **Value Category** | efficiency_gain |
| **Impact Statement** | Respond faster to critical issues — alerts appear live the moment they happen.… |

**Proof Element:**
- Type: `alert_severity`
- Label: Active Alarms
- Claim: Active Alarms: 3 Critical
- BBox: x=0.78 y=0.12 w=0.21 h=0.76
- Visual Weight: 0.98

**Camera Intent:**
- Strategy: `proof_focus`
- Motion Style: `zoom_in`
- End Zoom: 1.52×
- Proof Pop At: none
- Zoom Target: bbox(0.78,0.12,0.21,0.76)


### Scene 4 — 🔬 VALIDATION: Fault Simulator

| Field | Value |
|-------|-------|
| **Page ID** | `06845ca6…` |
| **Callout** | **Test Every Scenario. Zero Risk.** |
| **Scene Goal** | validation: Test Every Scenario. Zero Risk. |
| **Narrative Hook** | Engineers cannot safely test failure scenarios without risking live equipment. |
| **Closing Line** | Teams validate response procedures in simulation before deployment, cutting incident response time by 35%. |
| **Story Priority** | █████████░ 95% |
| **Min Duration** | 9s |
| **Value Category** | risk_prevention |
| **Impact Statement** | Test every fault scenario with zero risk — simulate failures on a digital twin.… |

**Proof Element:**
- Type: `prediction_card`
- Label: Simulation Coverage
- Claim: Simulation Coverage: 24 fault types
- BBox: x=0.05 y=0.18 w=0.52 h=0.48
- Visual Weight: 1.00

**Camera Intent:**
- Strategy: `proof_focus`
- Motion Style: `drift_right`
- End Zoom: 1.62×
- Proof Pop At: 3s
- Zoom Target: bbox(0.05,0.18,0.52,0.48)


### Scene 5 — 📡 SCALE: Device Fleet Analytics

| Field | Value |
|-------|-------|
| **Page ID** | `55b11baa…` |
| **Callout** | **Monitor Every Device In Real Time** |
| **Scene Goal** | scale: Monitor Every Device In Real Time |
| **Narrative Hook** | Energy costs are rising but teams cannot identify which devices are underperforming. |
| **Closing Line** | Customers identify and fix top-10 energy drains, reducing utility bills by up to 15%. |
| **Story Priority** | ████████░░ 84% |
| **Min Duration** | 7s |
| **Value Category** | cost_reduction |
| **Impact Statement** | Compare energy spend, runtime, and performance across every device — instantly.… |

**Proof Element:**
- Type: `fleet_health_summary`
- Label: Avg Energy / Device
- Claim: Avg Energy / Device: 4.2 kWh
- BBox: x=0.62 y=0.08 w=0.32 h=0.84
- Visual Weight: 0.94

**Camera Intent:**
- Strategy: `data_sweep`
- Motion Style: `drift_right`
- End Zoom: 1.56×
- Proof Pop At: none
- Zoom Target: bbox(0.62,0.08,0.32,0.84)


### Scene 6 — ✅ OUTCOME: Device Fleet Monitor

| Field | Value |
|-------|-------|
| **Page ID** | `9dbe7014…` |
| **Callout** | **Monitor Every Device In Real Time** |
| **Scene Goal** | outcome: Monitor Every Device In Real Time |
| **Narrative Hook** | Monitoring hundreds of devices across multiple sites is impossible without automation. |
| **Closing Line** | Field teams spend 50% less time on manual checks — issues are flagged automatically. |
| **Story Priority** | ████████░░ 84% |
| **Min Duration** | 8s |
| **Value Category** | cost_reduction |
| **Impact Statement** | Monitor every device in real time — health, status, and energy in one fleet view… |

**Proof Element:**
- Type: `fleet_health_summary`
- Label: Fleet Health
- Claim: Fleet Health: 94% Online
- BBox: x=0.65 y=0.05 w=0.30 h=0.88
- Visual Weight: 0.90

**Camera Intent:**
- Strategy: `proof_focus`
- Motion Style: `zoom_in`
- End Zoom: 1.56×
- Proof Pop At: none
- Zoom Target: bbox(0.65,0.05,0.30,0.88)


### Scene 7 — 📡 SCALE: Alarm Center Dashboard

| Field | Value |
|-------|-------|
| **Page ID** | `9aa8f979…` |
| **Callout** | **Respond Faster To Critical Issues** |
| **Scene Goal** | scale: Respond Faster To Critical Issues |
| **Narrative Hook** | Alarm triage is manual and time-consuming — engineers waste hours sorting through noise. |
| **Closing Line** | Critical alarms are resolved 60% faster with clear severity ranking. |
| **Story Priority** | ████████░░ 76% |
| **Min Duration** | 7s |
| **Value Category** | efficiency_gain |
| **Impact Statement** | Triage every alarm by severity, site, and device type from one screen.… |

**Proof Element:**
- Type: `alert_severity`
- Label: Critical Alarms Today
- Claim: Critical Alarms Today: 7
- BBox: x=0.61 y=0.12 w=0.34 h=0.69
- Visual Weight: 0.96

**Camera Intent:**
- Strategy: `data_sweep`
- Motion Style: `drift_right`
- End Zoom: 1.52×
- Proof Pop At: none
- Zoom Target: bbox(0.61,0.12,0.34,0.69)


---

## Per-Scene Validation Checks

✅ Scene 0 (f9e5448f…) — 12/12 checks  score=1.00
✅ Scene 1 (e8011180…) — 12/12 checks  score=1.00
✅ Scene 2 (fa351125…) — 12/12 checks  score=0.98
✅ Scene 3 (06845ca6…) — 12/12 checks  score=1.00
✅ Scene 4 (55b11baa…) — 12/12 checks  score=0.94
✅ Scene 5 (9dbe7014…) — 12/12 checks  score=0.90
✅ Scene 6 (9aa8f979…) — 12/12 checks  score=0.96

---

## What Changed vs. Phase 7

| Aspect | Before (Phase 7) | After (Phase 8) |
|--------|-----------------|-----------------|
| Journey order | Graph beam-search | Story arc narrative sequence |
| Scene callouts | Generic templates | Benefit-driven headlines |
| Camera target | spotlightTarget elementType | proof_focus on proof element bbox |
| Scene role | None | hook / insight / action / validation |
| Duration | Fixed (7s default) | Role-driven min (7–12s) + storyPriority boost |
| Opening title | "everything your team need" | Operations managers have no single view of energy usage and  |
| Arc type | 'unknown' | `reactive_to_predictive` |

---

*Report generated by `scripts/validate-sales-story.ts`*
