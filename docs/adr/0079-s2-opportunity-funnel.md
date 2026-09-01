# ADR-0079: S2 opportunity funnel — agentic discovery, factor-based evaluation, list registry

**Status**: Accepted — implemented in the same change (pipeline, APIs, UI, migrations 0050–0051)
**Date**: 2026-09-01
**Deciders**: user (standing directive), market-intelligence-agent + greenfield-agent (activity owners), frontend-engineer (execution)
**Design of record**: `app/web-next/app/opportunities/page.tsx`, `app/api/opportunities/discover/route.ts`, `app/api/opportunities/[id]/{sketch,factors}/route.ts`, `lib/opportunity-factors.ts`, migrations 0050/0051

## Context

After ADR-0076/0078, the website implemented only S1–S3, and S2 (기회 발굴) was reduced to a
manual registration form plus a 4-column kanban board. Three gaps surfaced:

1. **No discovery activity** — opportunities were typed by hand even though S1 market analyses
   (anchor, CAGR, segments, opportunity/risk factors, external-forecast gap with new/strengthened
   drivers, competitive structure) already contained the evidence a discovery agent needs
   (spec activity: opportunity-discovery / insight-synthesis).
2. **No business-model-sketch activity** (spec activity: business-model-sketch /
   greenfield-agent, scenario-planning) — selected opportunities carried no qualitative shape.
3. **Evaluation lacked risk factors** — only opportunity factors existed at evaluation time, and
   everything had to be found by hand.

Terminology also drifted: the spec's output "기회 레지스트리" and the UI's "기회 퍼널" named the
same thing. The funnel is the user-facing concept; "registry" is dropped from S1–S2 surfaces
(the S1 driver registry — 산업 드라이버 레지스트리 — is a different concept and keeps its name).

## Decision

1. **Discovery is agentic and evidence-bound.** `POST /api/opportunities/discover` takes one
   analyzed industry, assembles the latest completed matrix's evidence (anchor total, chain
   direction + related industries, competitive structure, opportunity factors, external-forecast
   gap analysis + new drivers), and asks the LLM for 2–3 opportunity candidates
   (name, value-chain node, rationale, suggested attractiveness). The prompt forbids inventing
   demand sides not present in the evidence. LLM-unconfigured environments fall back to a
   deterministic synthesis built from the recorded factors/new drivers; provenance
   (`llm` | `synthesis`) is returned and stamped on `created_by`/rationale.
2. **Both factor kinds are first-class and auto-derived.** Each opportunity carries
   `factors_json` = `{opportunity[], risk[]}` (migration 0051). Factors are derived
   automatically right after discovery (one derivation per candidate) and can be re-derived per
   opportunity (`POST /[id]/factors`), added manually (`PUT`), or removed (`DELETE`).
   Derivation is bound to the same S1 evidence, with a "검증 필요" honesty rule instead of
   invention.
3. **Business model sketch is persisted, provenance-stamped.** `POST /[id]/sketch` generates a
   one-page sketch (customer, value proposition, revenue model, required capabilities, key
   risks, 3-scenario assumptions) and persists it on the opportunity
   (`sketch_json/sketch_source/sketch_at`, migration 0050). Regeneration (`force`) overwrites.
4. **Attractiveness gates progression.** The funnel (identified → assessed → selected/dropped)
   remains, but "평가로 이동" is disabled until 매력도 is evaluated — enforcing the spec
   completion criterion "최소 1개 기회가 등록되고 매력도가 평가되었다" in the UI.
5. **The registry renders as a sortable list, not a kanban.** One row per opportunity
   (status chip, name + scope/node, attractiveness, synergy, factor counts, next-step action);
   the row expands into the evaluation panel (factors, attractiveness input, actions, sketch).
   Sorting: attractiveness desc (default) / newest. Status distribution lives in the clickable
   KPI strip. Rationale: the pipeline is sequential — a list makes current state + next action
   one-line readable, scales linearly with volume, and matches the app's `data-table` visual
   language. The kanban board was removed.
6. **Terminology**: UI and spec wording use 기회 퍼널 (not 기회 레지스트리) for S2's output.

## Consequences

- **Positive**: S2's two spec activities exist end-to-end with provenance; evaluation has both
  factor kinds with human override; the funnel enforces the spec completion criterion; the
  list scales with volume.
- **Accepted**: LLM proposals (opportunities, factors, sketches) are estimates until an analyst
  confirms them — every generated artifact carries provenance and the honesty note; migration
  0050/0051 are additive-only (ADR-0014).
- **S4+ linkage preserved**: promotion stays out of scope until the S4+ rebuild (ADR-0078);
  selected opportunities show a pending-rebuild note.
