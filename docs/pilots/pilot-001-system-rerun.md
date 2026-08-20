# Pilot 001 — System Re-Run vs. Manual Pilot (Wave 5.10)

**Manual baseline**: `docs/pilots/pilot-001-hd-hyundai-stx-heavy-industries.md`
**Run mode**: System (`bun scripts/co-newbiz/newbiz.ts proc:resolve` / `rag`, against a scratch DB — no synthetic data invented beyond what the manual pilot already used)
**Design of record**: `docs/dev-plan.md` §3's Wave 5.10 acceptance criterion — "system-vs-manual-pilot result comparison documented; a discrepancy is investigated as a defect in one or the other, never left unexplained."

## 1. What Was Re-Run

Only the two things the manual pilot itself could actually execute from public data (§4/§5 of the manual pilot): the Screening procedure resolution, and the single gradable RAG dimension (Regulatory/Permit, behavioral remedy). Nothing else was re-run, because the manual pilot's own scope boundary (WACC/hurdle unavailable, five of six RAG dimensions ungradable from public data) is a real data-availability limit, not something the system could somehow supply that the manual exercise couldn't.

## 2. Comparison — Procedure Resolution

| | Manual pilot | System re-run |
|---|---|---|
| Steps | 1. brownfield-agent/brownfield-feasibility → target_longlist. 2. antitrust-agent/antitrust-screening → preliminary_hhi_screen. 3. process-governance-manager/stage-gate-governance → gate_pass_record | Identical — `bun scripts/co-newbiz/newbiz.ts proc:resolve --procedure brownfield-screening` returns the same 3 steps, same agent/skill/output mapping, layer `shared` |

**Match. No discrepancy.**

## 3. Comparison — RAG Assessment

| | Manual pilot | System re-run |
|---|---|---|
| Regulatory/Permit dimension | Amber — "binding 3-year behavioral remedies... not a clean pass" | Amber — `"Behavioral remedy obligation is active — Amber for the full obligation duration; no discharge event exists (FR-RAG-05, pilot 001 shape)."` |
| Other five dimensions | **Explicitly not graded** — "require inputs this pilot doesn't have" | **Amber, defaulted** — `financial`/`market`/`data_confidence`/`technical_execution`/`risk` all written as `"...not yet assessed — Amber by default."` |
| Overall grade | **None produced** — "Since not all six dimensions are gradable, no overall grade is produced — correctly, per the framework's own rule (Green requires all six; an incomplete assessment cannot default to any color)." | **Amber, produced and persisted** — `"recorded_overall": "amber"`, with a `rag_transition` row (`from: null, to: "amber"`) |

**Discrepancy found — the single gradable dimension matches exactly; the overall-grade behavior does not.**

## 4. Investigation

The manual pilot's rule — "an incomplete assessment cannot default to any color" — is design's own stated principle (`docs/rag-framework.md`, `docs/ui-spec.md` §3, and encoded again in `skills/rag-scoring-framework/SKILL.md`'s own description: "never render an overall grade without checking all six dimensions completed"). The system re-run violates it: `db/lib/rag-engine.ts`'s `evaluateRag()`/`assessRun()` (Wave 5.3) treats every dimension not present in the input scenario as **assessed-Amber-by-default**, not **unassessed**, and always computes and persists an `overall` row from those six (defaulted-or-real) dimension grades. There is no code path in the current engine that produces "insufficient data to grade at all" as an outcome — it always produces *some* overall grade once `assessRun()` is called, even from a single real input.

This is a **system defect, not a manual-pilot error**. The manual pilot's judgment (decline to grade) is correct per the design's own stated rule; the system's behavior (grade everything, defaulting unknowns to Amber) contradicts that rule. The contradiction traces to a genuine cross-wave gap: `rag-engine.ts` was built in Wave 5.3 for a different implicit use case — a single CLI call meant to produce one complete, deterministic assessment from a fully-specified scenario — before the web UI (Wave 5.6B) and the `rag-scoring-framework` skill (Wave 5.8I) later encoded the *incremental, dimension-by-dimension, possibly-still-incomplete* assessment model the design actually calls for. Nothing in Wave 5.3-5.9 caught this because no wave before this one actually exercised the engine with a genuinely partial, real-world input — every prior test (`tests/unit/*.test.ts`) supplied either a fully-specified scenario or checked the UI/API's own "not yet assessed" empty-state (no rows at all), never the CLI's actual default-fill behavior against a partial input.

## 5. Disposition

**Tracked as a follow-up defect, not fixed in this pilot re-run** — the fix is a real engine-behavior change (distinguishing "no input supplied, dimension genuinely unassessed" from "input supplied, dimension is Amber") that touches `db/lib/rag-engine.ts`'s core evaluation function, its existing test suite, and potentially the `rag` CLI's scenario contract (an explicit per-dimension "provided" signal, or simply: don't call `assessRun` for a dimension-incomplete scenario and don't write an `overall` row until all six have a real assessment on record). Scoping and shipping that change correctly is more than a same-session fix given everything else in this pilot re-run — recorded here explicitly per this wave's own acceptance rule ("never left unexplained") rather than silently worked around or deferred without a trace.

**Recommended fix direction** (for the follow-up): add an `assessed: boolean` field to each dimension in the scenario JSON contract (or infer it from field presence, more carefully than the current `input.field ? real : default` pattern, which cannot distinguish "caller explicitly checked and confirmed Amber" from "caller had nothing to report"), and have `assessRun` skip writing the `overall` row entirely — not default it — when fewer than six dimensions were actually assessed. The web UI's own `RagSignalCard` component already expects and correctly renders exactly this state (`평가 미완료`) once the API stops returning a spurious overall row; the fix is entirely on the write side, not the read side.

## 6. Verdict

**Not a pilot failure — a successful pilot.** Wave 5.10's purpose is exactly this: running a real case through the built system to expose exactly the kind of defect code review alone would not surface. The procedure-resolution path matched perfectly; the RAG-assessment path surfaced a real, now-documented, now-traceable defect rather than an ambiguous "seems fine" impression. Per ADR-0034/Wave 5.10's own rule, this discrepancy is investigated and explained, not left unaddressed — the fix is scoped and tracked, not silently absorbed.
