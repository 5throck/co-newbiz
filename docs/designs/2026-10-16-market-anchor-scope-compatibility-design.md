---
title: Market-anchor scope compatibility — structured target scope, anchor scope check, sourced market share, segment-scoped sizing, plausibility guards
status: accepted
date: 2026-10-16
owner: platform-lead
lang: ko
lang_reason: proper-noun
---

# Market-anchor scope compatibility — structured target scope, anchor scope check, sourced market share, segment-scoped sizing, plausibility guards

Korean appears only as UI labels/product terms in backticks. All prose is English. Code paths are relative to `app/web-next/` unless stated.

- Status: Accepted (2026-10-16, decider chat "그렇게 해줘" — approved as summarised with the recommended open decisions; ADR-0179 Acceptance record). Drafted by platform-lead; not implemented.
- Motivating incident (2026-10-16, verified by the team lead): Green Field opportunity `01M1MVCQ2T8R32JDNM1ZTP0668` (`유압식 브레이커 — 유럽 Stage V 시장 공략`) anchors S8 revenue on `opportunity.market_size_krw_m = 3,580,000` with `market_scope = '유압식 브레이커'` — a scope string with no region — and a bare-default capture rate 0.5%. Year-1 revenue lands near 17,900 KRW-M against a ~100 KRW-M capex plan, pushing IRR into the thousands of percent. The anchor's implicit scope (worldwide breaker market) does not match the opportunity's target scope (Europe, Stage V emissions tier). Nothing in the pipeline compares the two; the mismatch surfaces only late and indirectly, as an implausible IRR.
- ADR: [ADR-0179](../adr/0179-market-anchor-scope-compatibility.md) (Accepted 2026-10-16, DEC-20261016-02).
- Builds on: ADR-0170 (`재평가 필요` staleness pattern), ADR-0176 (S5 simulation, visible degradation labels), ADR-0178 (pinned S5 reference; run-note provenance fields), the project non-negotiables (#4 data confidence caps the RAG grade; outputs are decision support, never gate blocks), and the proxy-chain discipline of the value-chain designs.

## 1. Problem statement

1. **The target scope is free text.** `opportunity.market_scope` is a plain string (migration 0042), set at S1/S2 as part of the opportunity title-level description. It is not machine-comparable to anything.
2. **The anchor is scopeless.** `caseInputsBaseForProject` (`lib/business-case-generator.ts:1182`) reads `o.market_size_krw_m` and `o.growth_rate` straight off the opportunity row (fallbacks 50,000 / 5% when null, brownfield path) with no notion of what geography or segment the number covers. Nothing records whether the 3,580,000 figure is worldwide or Europe-only.
3. **No compatibility check anywhere.** The systematic market-sizing analyses (`market_sizing_analysis`, migration 0046) are keyed by `industry_id` only; neither the analysis nor its version payload declares a region/segment scope. Even if they did, no consumer compares the sizing's scope to the opportunity's target scope before using an anchor.
4. **The share default is silent.** `CAPTURE_RATE = 0.005` (`lib/business-case-generator.ts:222`) applies whenever a person has not confirmed `bc.capture_rate`. `captureSource` already records `"기본값"` vs `"사용자 확정 (bc.capture_rate)"` and the run note carries `capture_rate=`/`capture_source=`, but nothing labels the default as *unsourced*, and the label does not reach every surface where the anchor is shown.
5. **No plausibility guard.** A year-1 revenue of ~180× the capex plan passes through generation, display and the gate brief with no warning; the reviewer's only signal is that IRR "looks absurd."

The failure mode is structural: scope information exists only in prose, so every downstream consumer (generator, gate brief, IC package, AI reviewers) treats a worldwide number as if it described the target market.

## 2. Verified current state (code, 2026-10-16)

- `db/migrations/0042_opportunity_and_gate_decision.sql`: `opportunity` carries `market_scope TEXT`, `market_size_krw_m INTEGER`, `growth_rate REAL`. No region, no unit basis, no structured scope.
- `lib/business-case-generator.ts:1182` `caseInputsBaseForProject`: `SELECT o.market_size_krw_m, o.growth_rate ... FROM md_project p LEFT JOIN opportunity o` — the anchor enters S8 with no scope metadata. Fallbacks `marketSizeKrwM ?? 50000`, `anchorGrowth ?? 0.05`.
- `lib/business-case-generator.ts:222` `CAPTURE_RATE = 0.005`; `:736/:856` `captureSource` is `"사용자 확정 (bc.capture_rate)"` or `"기본값"`; `:906` year-1 revenue source string `시장규모 × 시장점유율 X% (source)`; `:1610` run note `capture_rate=...; capture_source=...`.
- `db/migrations/0046_market_sizing_analysis.sql`: `market_sizing_analysis(id, industry_id, status, methodology_version, ...)` and `market_sizing_version(id, analysis_id, version_no, payload TEXT, ...)` — industry-keyed, no scope column; scope would have to live inside the version `payload` JSON or as a new column.
- Anchor display surfaces: `components/stages/BusinessCaseStage.tsx`, `components/business-case/ValuationMethodology.tsx`, `components/stages/market/SizingMarketTabs.tsx` / `SizingGrowthTabs.tsx`.
- `market_scope` is edited/displayed via the opportunity API (`app/api/opportunities/[id]/route.ts`) and opportunity pages; free text, unconstrained.
- Not verified: exact payload JSON shape produced by the systematic-market-sizing skill run (whether a scope-like field already exists informally inside `payload`); the MCP `generate_market_sizing_draft` call failed with ECONNREFUSED on 2026-10-16 (see §6.4).

## 3. Decision summary (all proposed, opt-in by data)

| Axis | Today | Proposed |
|---|---|---|
| Target scope | free-text `market_scope` | structured `opportunity.target_scope_json` (`{regions[], segments[], unit_basis}`, person-set, null on legacy) beside the free text |
| Anchor scope | nothing | the sizing version carries a declared `scope` (and the opportunity anchor row optionally carries a `scope_hint`); consumers compare anchor scope vs target scope |
| Mismatch handling | nothing | `재평가 필요`-style visible flag `시장 범위 불일치` (mismatch) / `시장 범위 미확인` (scope unknown); never blocks, recorded as confidence-lowering |
| Capture default | `0.005` labelled `"기본값"` | same value, relabelled `근거 없는 기본 점유율`; generation with a bare default on a linked valuation emits a run-note warning |
| Sizing pipeline | industry-only | region/segment-scoped analyses with an explicit sourced region-derivation step; proxy chain as a sanctioned scoped method |
| Plausibility | none | deterministic warning guards (Y1 revenue vs capex ratio, IRR display ceiling) surfaced as labels |

Nothing changes numerically for any project until a person sets the structured scope or a scoped sizing exists. All flags are display/evidence only — no gate block, no grade cap by the flag alone; per non-negotiable #4 an unresolved mismatch is recorded as confidence-lowering evidence for the human RAG judgement.

## 4. Element 1 — structured target scope

### 4.1 Shape

New nullable JSON column `opportunity.target_scope_json`:

```json
{
  "regions": ["eu"],
  "segments": ["hydraulic breaker, Stage V compliant construction/demolition"],
  "unit_basis": "krw_m_year",
  "set_by": "<user id>",
  "set_at": "<iso>"
}
```

- `regions`: recommended taxonomy is the **fixed region enum already used by region-profiles** (`kr`, `eu`, `us`, `cn`, ...; OPEN-1). Free tags rejected for regions because the compatibility check must be able to say "worldwide vs eu" deterministically; a special value `worldwide` is allowed.
- `segments`: free tags (short phrases). Segments are not enum-able without a taxonomy project; the check treats segments as advisory text (OPEN-1).
- `unit_basis`: fixed enum (`krw_m_year`, `units_year`, `usd_m_year`) so the sizing pipeline and the anchor agree on what the number denominates.
- The free-text `market_scope` stays untouched and remains the human-readable label; the structured scope is additive.

### 4.2 Who sets it

A person sets it on the opportunity (S1/S2 surface — the opportunity edit form), analyst or above, human-only write (no MCP write tool; consistent with ADR-0178 §4A.5 permission discipline). AI support may propose values in text only.

### 4.3 Legacy migration

- Migration is **additive only** (ADR-0014 discipline): the column defaults to NULL. Legacy opportunities keep exactly today's behavior; a NULL structured scope means "scope unknown" and drives the `시장 범위 미확인` flag when an anchor is consumed (§5), never a silent OK.
- No backfill from the free text: deriving `regions` from `'유압식 브레이커'` would be an LLM guess presented as data. The pilot opportunity gets its scope when a person sets it (OPEN-4).

### 4.4 Relation to the sizing analyses and S8 consumption

- `market_sizing_version` gains the declared scope (§6.1). The opportunity's structured scope is the *target*; the sizing's declared scope is the *anchor's coverage*; the check (§5) compares them.
- `caseInputsBaseForProject` is extended to read `o.target_scope_json` (nullable) and pass it through `CaseInputs` as `targetScope`. The anchor numbers themselves (`market_size_krw_m`, `growth_rate`) and all fallbacks are untouched — generation stays bit-identical while scope is NULL. When non-NULL, the scope only feeds the compatibility flag and labels, never the arithmetic.

## 5. Element 2 — anchor scope-compatibility check

### 5.1 Where the sizing's declared scope lives

Decision (recommended): **on the `market_sizing_version` payload** as a required-in-new-versions `scope` object with the same shape as `target_scope_json` (`regions[]`, `segments[]`, `unit_basis`), surfaced as a first-class field on read (the read model extracts it from the payload; no schema migration needed for the payload-only path — OPEN-2 offers an additive `scope_json` column instead). Rationale: the scope belongs to *what was measured*, and versions are append-only, so scope history comes free with version history. The opportunity anchor fields (`market_size_krw_m` on the opportunity row) do NOT gain a scope — the anchor should eventually point at a sizing version (OPEN-3), at which point the version's scope is the anchor's scope by construction.

### 5.2 The check

A pure function `compareAnchorScope(anchorScope, targetScope)` returning one of:

| Anchor scope | Target scope | Result |
|---|---|---|
| declares scope | compatible (target region subset of anchor, or anchor `worldwide` with a region-derivation factor noted) | `ok` |
| declares scope | incompatible (e.g. anchor `worldwide`, target `eu`, no derivation step) | `mismatch` → flag `시장 범위 불일치` |
| scope unknown (legacy payload, no declared scope) | anything | `unknown` → flag `시장 범위 미확인` (scope unknown is flagged as such, never silently OK) |
| anything | NULL (legacy opportunity) | `unknown` → same `시장 범위 미확인` flag |

Semantics:

- The flag is a data-confidence-style marker (`재평가 필요` pattern, ADR-0170): visible next to the anchor wherever the anchor is shown (params table, ValuationMethodology, gate brief text), carrying a one-line reason.
- **Never a gate block. Never a grade cap by itself.** Per non-negotiable #4, an unresolved `mismatch`/`unknown` at gate time is recorded as confidence-lowering evidence the human reviewer weighs when setting the RAG grade; the flag text states this explicitly.
- The check runs wherever an anchor is consumed: (a) in the generator at case generation — result and reason appended to the run note (`anchor_scope=mismatch|unknown|ok; anchor_scope_reason=...`); (b) in the read model for display — recomputed live so the flag updates when a person sets the scope or a scoped sizing lands, without regenerating. Both (OPEN-5 recommendation: generator is the record of what a run *used*; read model is the live truth; they can legitimately disagree right after a fix, and the display says so).

### 5.3 Legacy anchors

An anchor with no linked sizing and no scope hint is `unknown`, flagged `시장 범위 미확인 (근거 범위 미기재)` — the flag is honest about not knowing rather than assuming the anchor matches. A `worldwide` anchor against a regional target without a documented derivation factor is `mismatch` even though "worldwide ⊇ Europe" — coverage is not compatibility; the number is the wrong magnitude for the target by construction.

## 6. Element 3..4 — sourced market share, segment-scoped sizing

### 6.1 Sourced market-share rule

- Wherever `captureRate` is shown, a bare default renders as `근거 없는 기본 점유율 (0.5%)` instead of `기본값` — surfaces: params table row, `ValuationMethodology` year-1 revenue source line (`:906` string gains the label when `captureSource === "기본값"`), gate brief text.
- A person-confirmed `bc.capture_rate` already requires the existing confirmation path; recommended: the confirmation UI prompts for a `basis` note (source or reasoning), stored alongside, rendered as `사용자 확정 (근거: ...)` — a prompt, not a validation block (an empty basis is allowed but itself labelled `근거 미기재`).
- **Recommended (decided in this design as a proposal):** a linked-valuation generation that uses the bare default emits a warning into the run note: `share_unsourced=1` plus the existing `capture_source=기본값` — visible in the generation result and the case notes (OPEN-6: also mirror it as a business-case-level warning row; recommended yes, cheap and read-only).
- The default value 0.5% itself stays. Removing the default would break the documented deterministic-fallback contract (`caseInputsBaseForProject` comments); the fix is labelling, not removal.

### 6.2 Segment-scoped sizing pipeline

- The systematic-market-sizing pipeline gains scope-aware analyses: `market_sizing_analysis` (or the version payload) declares `regions`/`segments`/`unit_basis`, and a scoped analysis is produced for a named scope rather than only the industry total.
- **Region derivation is an explicit, sourced step**: global value × Europe share, where the share carries its own source and is recorded in the payload as a derivation lineage entry (`{step: "region_derivation", input_scope: "worldwide", factor: 0.18, factor_source: "..."}`). An unsourced derivation factor is allowed but flagged with the same `근거 없는` label discipline as §6.1.
- **Proxy chain as a sanctioned scoped method** (quant-methodologist owns methodology): European construction-equipment fleet → breaker attach rate → segment value, with unit conversion and attach-rate sources recorded per step in the payload lineage, following the existing proxy-chain discipline (unit-conversion-calibration, value-chain designs). The method document update belongs to quant-methodologist; this design only reserves the payload lineage shape for it.
- Backward compatibility: existing payloads without `scope` are `unknown` (flagged per §5.2); the pipeline never rewrites old versions.

### 6.3 Ownership

| Piece | Owner |
|---|---|
| Structured scope taxonomy (region enum, unit basis) | platform-lead, with region-lead confirming the region list |
| Compatibility-check semantics | platform-lead, with process-governance-manager confirming it never becomes a gate rule |
| Share-labelling wording (`근거 없는 기본 점유율`) | process-governance-manager (governance vocabulary) |
| Segment-scoped sizing methodology, region derivation, proxy-chain-as-method | quant-methodologist |
| Optimism-bias framing of the plausibility guards | risk-officer |

### 6.4 Operational note — pipeline/API availability

The co-newbiz MCP market-sizing draft call (`generate_market_sizing_draft`) failed with ECONNREFUSED on 2026-10-16. Consequences designed in:

- Sizing-pipeline work (§6.2) depends on the sizing service/API being reachable; every slice below is scoped so that the **flagging and labelling slices (1-2) work entirely offline** against stored data.
- When the pipeline is unreachable, scoped analyses simply cannot be produced; the system's behavior is the honest `시장 범위 미확인` flag on unscoped anchors — degradation is visible, never fabricated. No slice blocks on the pipeline being fixed, but Slice 3 cannot be exercised end-to-end until it is (limit, stated).

## 7. Element 5 — plausibility guards

Cheap deterministic checks, evaluated at generation (recorded in the run note) and recomputed in the read model for display; always warnings, never blocks:

1. **Y1 revenue vs plan investment ratio**: `y1Revenue / (capex plan total, or initial investment)`. Above a display threshold (recommended: >20×, OPEN-7) the case shows `매출 대비 투자비 과소 가능 — 시장 앵커 점검 필요` linking to the anchor scope flag if present. Threshold is a display heuristic, not a financial assertion; risk-officer owns the framing, and the wording says "check the anchor," never "the case is wrong."
2. **IRR ceiling review guard** (decider-requested instance, chat 2026-10-16). Concretely:
   - **Display/review flag only**: never a gate block, never a grade cap; the IRR value itself stays fully visible and reportable — the guard changes how it is *presented*, not the number or any decision outcome.
   - **Presentation**: above the threshold the IRR figure carries a chip/label `극단값 — 검토 필요 (가정 점검: 시장 범위·점유율·투자 규모)` instead of rendering as a plain number; in a two-band design (OPEN-7) the lower band renders a softer `주의` chip with the same pointer text.
   - **Threshold** (OPEN-7, recommendation): flag above **100%/year IRR** for the standard 5-year horizon and a lower **`주의` band above 50%**; implemented as a **person-settable project-level assumption with those defaults** (e.g. `bc.irr_flag_threshold` / `bc.irr_caution_threshold`), so an industry where 80% screening IRRs are normal can raise the band without a code change. Changing the threshold never recomputes anything — it is display metadata.
   - **Where the threshold lives**: defaults as code constants; overrides as project-level assumptions written by a person (analyst+), same write discipline as `bc.capture_rate`.
   - **Where the flag renders**: scenario comparison rows (per case), the methodology panel next to the IRR figure, and gate-brief / IC-package text as a labelled output line — so the guard reaches the optimism-bias review, not just the analyst screen.
   - **Link to the scope check**: an IRR ceiling breach renders a one-line pointer listing the likely causes in order of diagnostic value — anchor scope mismatch (`시장 범위 불일치` if that flag is present), bare-default share (`근거 없는 기본 점유율`), undersized capex plan — with links to each flag where present. The two guards are independent detectors; the IRR guard is the cheap first tripwire that routes the reader to the specific cause flags.
3. Guards fire independently of the scope check (they catch scope mismatches, share errors, unit errors — anything that inflates revenue). A guard hit does not change any stored number, grade, or gate outcome; per the optimism-bias review, the gate brief surfaces guard hits so risk-officer's review sees them.

## 8. Human-owned inputs

- `target_scope_json`: person-set (analyst+), human-only write; AI may propose in text.
- Sizing scope and derivation factors: person-confirmed within the sizing pipeline, sources mandatory for a Green-flagged derivation (confidence discipline).
- Share basis note: person-entered, optional, labelled when absent.
- Decision support only: no flag blocks a gate, no flag alone caps the RAG grade; data confidence continues to cap the grade (non-negotiable #4), and an unresolved mismatch is *input* to that human judgement.

## 9. Slices

| Slice | Scope | Behavior change | Migration |
|---|---|---|---|
| 1 | `opportunity.target_scope_json` column (additive, NULL default); opportunity edit form + API for it (human-only write); `caseInputsBaseForProject` passes `targetScope` through untouched when NULL; **IRR ceiling review guard** (chip `극단값 — 검토 필요` above threshold, `주의` band, person-settable thresholds with defaults 100%/50%, flag in scenario rows / methodology panel / gate brief — cheap and UI-only, moved here per decider guidance) | None until a person sets a scope or a case breaches the IRR threshold (display only) | **Yes — one additive column** (assumption overrides reuse the existing `bc.*` store, no migration) |
| 2 | Scope-compatibility check (generator note fields + read-model flags); sizing-version scope extraction from payload; `시장 범위 불일치` / `시장 범위 미확인` flags on anchor display surfaces; gate-brief text | Display/notes only | None |
| 3 | Share labelling (`근거 없는 기본 점유율`), basis-note prompt on confirmation, `share_unsourced=1` run-note warning; plausibility ratio guard (Y1 revenue vs plan investment) with read-model recomputation; guard-to-cause pointer wiring (IRR guard renders the diagnostic links once slice 2's flags exist) | Display/notes only | None |
| 4 | Segment-scoped sizing pipeline: scope on analysis/version, sourced region-derivation lineage, proxy-chain payload shape (with quant-methodologist methodology doc); scoped analyses become the recommended source for opportunity anchors | Pipeline capability only; existing analyses untouched | None (payload-scope path) |

Slices 1-3 are independent of the sizing API being reachable (§6.4); Slice 4 needs it. Each slice is independently shippable and behavior-preserving until data is set.

## 10. Open decisions (with recommendations)

| ID | Question | Recommendation |
|---|---|---|
| OPEN-1 | Scope taxonomy: fixed region enum vs free tags | Hybrid as designed: fixed region enum (region-profiles list + `worldwide`) for regions — required for a deterministic compatibility predicate; free tags for segments (advisory text in the check). A segment enum is a later taxonomy project. |
| OPEN-2 | Where the sizing scope lives: inside the version `payload` JSON vs a new additive column `market_sizing_version.scope_json` | Payload-only first (no migration, history free); add the column later only if payload extraction proves awkward for queries. |
| OPEN-3 | Should the opportunity anchor eventually reference a sizing version (replacing the bare `market_size_krw_m` copy)? | Yes, long-term (kills the drift class); not in this design's slices. Register as a follow-up so the bare-anchor path is explicitly a legacy compat path. |
| OPEN-4 | Migration of the pilot anchor (3,580,000, `01M1MVCQ2T8R32JDNM1ZTP0668`): person re-runs a segment-scoped sizing vs person edits the anchor | Recommended: person re-runs sizing scoped to Europe Stage V (Slice 4) once the pipeline is reachable; interim, the person either sets the target scope (making the mismatch explicit and visible) or edits the anchor to a sourced regional figure. The agent never edits the number. |
| OPEN-5 | Where the compatibility check lives: generator only, read-model only, or both | Both: the generator note is the record of what a run used; the read-model flag is live truth. Generator-only would leave old cases silently unflagged after a scope fix; read-model-only would leave run notes incomplete. |
| OPEN-6 | Bare-default share warning: run-note only vs also a case-level warning row | Both (recommended): note is the provenance record; the case-level row is what a reviewer actually sees first. Cost is a read-only derived row. |
| OPEN-7 | Guard thresholds: Y1 revenue/capex ratio; **IRR ceiling review guard** — flag band and caution band, constant vs person-settable | IRR: flag (`극단값 — 검토 필요`) above **100%/year** for the 5-year horizon, softer `주의` band above **50%**; thresholds **person-settable project-level assumptions (`bc.irr_flag_threshold` / `bc.irr_caution_threshold`) with those values as code defaults**, so an industry with normally-high screening IRRs can raise the band without a code change; changing a threshold is display metadata only and never recomputes anything. Ratio guard: >20×, tunable constant. Both are display heuristics owned by risk-officer, deliberately generous to avoid alert fatigue; revisit after the first month of flags. (Decider requested the IRR safeguard 2026-10-16; the specific bands/thresholds remain this recommendation.) |
| OPEN-8 | Does a scope mismatch ever block anything? | Never — as designed, matching the non-negotiables. Recorded here so a future proposal to gate on mismatch needs a new ADR, not a silent change. |

## 11. Honest limits

- The compatibility check compares declared scopes only; a *wrong-but-consistent* scope (both say "eu" but the sizing actually measured something else) is undetectable without source verification — that remains the human reviewer's job and the data-confidence cap's.
- Segment comparison is advisory text, not a predicate; segment-only mismatches (right region, wrong segment) are caught by humans and by the plausibility guards, not by the scope check.
- The plausibility-guard thresholds are heuristics; a legitimate capital-light business can trip the ratio guard, and a bad anchor producing a plausible-looking ratio passes silently.
- Slice 4 depends on the market-sizing pipeline/API availability (ECONNREFUSED 2026-10-16); until then scoped sizings cannot be produced and unscoped anchors stay flagged `시장 범위 미확인`.
- No backfill: legacy opportunities and legacy sizing versions stay `unknown` until a person sets scope; the flags will be noisy at first — accepted, because silence is the failure mode this design fixes.
- The anchor-consumption arithmetic (`caseInputsBaseForProject`, fallbacks, CAPTURE_RATE) is deliberately untouched; this design changes visibility, not numbers.
- Whether the pilot's IRR magnitudes would have been caught by the guards at their recommended thresholds: plausible from the incident numbers (~180× ratio ≫ 20×) but not re-simulated — to verify at Slice 3 implementation against a seeded case.
