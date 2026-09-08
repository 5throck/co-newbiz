# Pipeline Execution Procedure (Project Memory)

> Renumbered 2026-09-08 to flow.spec **v2.2.x** (S10 투자구조 설계 inserted at
> v2.2.0; IC moved S10→S11). The operational runbook now lives in the
> **`deal-pipeline-orchestration`** skill (dispatch loop, gates, committees,
> three-stage review, environment discipline) — this memory file keeps only
> the run-specific lessons and the stage map at a glance.
> First distilled from the `samsung-robotics-rainbow` process-check run
> (2026-08-31); see `deliverables/samsung-robotics-rainbow/governance/00-governance-summary.md`.
> Update this file whenever a run uncovers a new environment or execution lesson.

## 1. Stage map (flow.spec v2.2.x)

| Stage | Deliverables | Gate | Authority |
|---|---|---|---|
| S1 market | market sizing, competitive intelligence, value-chain analysis | Screening | AI formal review |
| S2 opportunity | opportunity registry, business-model sketch | Screening | AI formal review |
| S3 synergy/fit | strategic-fit checklist result, synergy analysis | Screening | AI formal review (threshold: ADR-0051 open question (b) — unresolved) |
| S4 route | route decision (`track` recorded) | Pre-FS | PM records; `decided_by` must name the human approver |
| S5 capability (GF) / S6–S7 target longlist & screening (BF) | capability gap & entry strategy / Target Universe, Long→Short List | Pre-FS / Target Screening | Target Screening gate is brownfield-only |
| S8 business case | DCF/comparables/Monte Carlo, WACC assembly | FS | WACC/hurdle must reach `kind='user'` before gate exit |
| S9 DD | checklist judgments (commercial/technical/legal/regulatory/special topics) | DD | fail-closed: unresolved mandatory items ⇒ Fail (waiver via `waiver-management`) |
| S10 deal structuring | vehicle + four-axis review + balanced sources & uses | — (no gate) | feeds the S11 IC package |
| S11 investment review & execution | IC package, charter baseline, kill-criteria evaluation, establishment | Entity IC → Group IC | human `reviewed_by`; never fabricate approval |
| S12 post-investment | venture scorecard, transition decisions | — (no gate) | quarterly refresh; five transition vocabularies |

Non-negotiables during any run: no PASS stamps without evidence; silence is not
approval; missing data access is recorded as a limitation, never silently skipped.

## 2. Procedure and checklist sources

- Shared procedure schemas: `procedures/_shared/<procedure>/schema.yaml`
  (known gap: no shared YAML for S2 opportunity discovery — see governance summary §2.2).
- Checklists: `checklists/*.yaml` (strategic-fit for S3; the five DD checklists for S9).
- Kill criteria: `procedures/_kill-criteria/*.json` evaluated at S9/S11 with `evidence_ref` citations.

## 3. Skills used per stage

- `k-kosis` (S1 statistics), `k-dart` (S1/S8/S9 filings and peer financials),
  `k-law` (S9 statute text). All three follow fail-closed: if a lookup fails,
  record the limitation explicitly and triangulate — never fill with assumption.
- Data confidence caps the RAG grade (ADR-0016/0049).

## 4. Environment loading

> Formalized as ADR-0075 and now carried in the `deal-pipeline-orchestration`
> skill ("Environment Discipline") — that skill is authoritative. The lessons
> below are the original run evidence behind them.

1. **`device_bash` starts a fresh shell on every call.** There is no persistent
   environment. Every command that needs secrets must source `.env` itself, and any
   dispatch prompt to a subagent must state this explicitly — do not rely on the
   subagent to discover it.
2. **This project's `.env` uses CRLF line endings.** Sourcing it naively appends `\r`
   to every value, which makes external APIs fail with no clear error. Always load with:
   ```bash
   set -a; source <(tr -d '\r' < .env); set +a
   ```
3. **Do not trust a subagent report of "API key missing" without reproducible evidence.**
   Re-verify with a curl call and the HTTP status code before concluding any key is
   absent. (This exact misdiagnosis occurred on 2026-08-31; keys were valid throughout.)
4. **Known remaining infra gap:** `bun` runtime absence blocks `procedures/_validate.ts`
   automatic validation. Run `bun install` / provide bun before relying on validation.
