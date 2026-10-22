---
governance_doc_id: gov-des-04
layer: docs-content
title: "Standard Screen Patterns P0–P5"
scope: co-newbiz
owner_agent: design-system-agent
version: "1.0.0"
effective_from: "2026-09-05"
lang: en
counterpart: design-screens_ko.md
---
# Why the 12 stage screens are never designed from scratch

The new business review process has 12 stages, S1 through S12, and each stage needs its own screens. If these 12 screens were designed from scratch every time, consistency would suffer and building them would take a long time. Looked at closely, the screens of these 12 stages actually fall into 5 types according to the nature of what they do (basis: 2026-09-01 standard screen patterns design doc §3). So when building a new screen, the first step is to determine which of these 5 types it belongs to, and then reuse the matching pattern.

| Pattern | What kind of screen | Which stages use it |
|---|---|---|
| **P0 Shell** (common skeleton) | The skeleton shared by every screen — top header, left menu, stage progress bar | Common to all screens |
| **P1 Registry** (list · registration) | Screens that list many items and let you pick among them | S6 candidate long list, S7 short list |
| **P2 Report** (report reading) | Screens for reading analysis results only | S1 market analysis, S9 due diligence report |
| **P3 Decision** (decision · scoring) | Screens where a human directly decides to approve or reject, etc. | S3/S4/S7 decisions, S10 investment structure, S11 investment review |
| **P4 Execution** (execution · checklist) | Screens for working through a to-do list item by item | S5, S9 checklist, S11 incorporation execution, S8 pipeline |
| **P5 Monitoring** (monitoring) | Dashboards for watching progress in real time | S12, pipeline status board |

Two additional rules apply. When a single stage needs multiple patterns at once, they are laid out top to bottom in that order, and each boundary where the pattern changes is marked with a subheading-style divider (SectionToolbar). Also, a later stage can never be marked "complete" while an earlier stage is not finished — just as the system itself enforces this rule, it is reflected as-is on the screen; it is not merely a display convention.

**Registered variant (2026-10-22 review)**: S11 composes its patterns behind an internal tab bar instead of top-to-bottom stacking — `투자심의 자료` / `투자심사 절차 단계` / `설립 실행` / `실행 기준선` / `의사결정·승인 기록`, ordered by procedure (decider decision of record 2026-10-21; the internal tablist must still satisfy the tab semantics — `aria-controls`/`id` wiring and `role="tabpanel"`). Stages choosing this variant must register it here.

## 🌐 External Reference — How does the industry classify business screens?

The industry also classifies dashboards into three kinds — **operational** (screens tracking day-to-day work in real time), **analytical** (screens for exploring past data to find trends), and **strategic** (high-level summary screens for executives). And the common advice is that screen design should start from "what decision must the user make on this screen," and that a single screen should carry only one clear conclusion. co-newbiz's P1–P5 classification corresponds to subdividing those three categories into five by adding list-type and report-type screens; P5 is closest to an operational dashboard and P2 to an analytical report. The standard layout for admin tool screens (fixed left menu + top bar) also matches the structure of co-newbiz's P0 common skeleton. For sources and details, see [docs/research/dashboard-screen-patterns.md] (surveyed 2026-09-05).

## Source Mapping

| Claim | Basis |
|---|---|
| Pattern definitions | docs/designs/2026-09-01-standard-screen-patterns-design_ko.md §3–5 |
| S10 addition | flow.spec v2.2.0, ADR-0106 |
| Screen pattern classification practice | docs/research/dashboard-screen-patterns.md |
