---
lang: ko
lang_reason: source-material
---

# Policy impact analysis — ADR-0196 Phase E (entity/group IC committee deliberation)

Date: 2026-11-09 · Owner: process-governance-manager · Trigger: `procedures/**` change (project CLAUDE.md lifecycle rule: policy impact analysis + `project_policy_pin` check required before merge; ADR — ADR-0196 already carries the decision, ADR-0186 carries the amendment note)

Change under analysis: `procedures/_shared/entity-ic-review/schema.yaml` v1.4.0 → v1.5.0 (new step 4.5.5, IC committee deliberation), `procedures/_shared/group-investment-review/schema.yaml` v1.3.0 → v1.4.0 (new step 4.4), `procedures/_committees.yaml` +2 committees (`entity-ic-committee`, `group-ic-committee`), `procedures/_output-types.yaml` +2 output types, `process/flow.spec.yaml` v2.20.0 → v2.21.0 (one exit-criteria line each at `entity_ic` / `group_ic`).

Design of record: `docs/designs/2026-11-08-committee-minutes-as-meeting-design.md` §7.2 (ADR-0196 decision 9). The deliberation step is decision support placed in front of the human verdict step; it replaces no step and decides nothing (design boundary 2).

## 1. Documents referencing the two procedures or gates `entity_ic` / `group_ic`

### Policies

| Document | Reference | Affected? | Action |
|---|---|---|---|
| `policies/group/neb-policy.md` §2.1 (ladder), §2.9 (gate-record integrity), §2.10 (conditions), §3 (Group IC axes), §4 (Kill Criteria) | Entity IC / Group IC as human decision gates with maker/checker | No wording change required. The committee session is a DISPLAY/ACK item in the gate snapshot (ADR-0186 amendment); policy already states "agents may propose but never acknowledge, countersign, approve, clear or override" — the deliberation step stays inside "propose". | None. Amendment recorded on ADR-0186, not the policy. |
| `policies/group/neb-policy_ko.md` | Korean mirror of the above | No | None (mirror stays in sync because the policy itself is unchanged). |

### Procedures / registries (changed in this task)

| Document | Change |
|---|---|
| `procedures/_shared/entity-ic-review/schema.yaml` | v1.5.0 — step 4.5.5 inserted; final human step unchanged |
| `procedures/_shared/group-investment-review/schema.yaml` | v1.4.0 — step 4.4 inserted; final human step unchanged |
| `procedures/_committees.yaml` | `entity-ic-committee` (gate `entity_ic`), `group-ic-committee` (gate `group_ic`) — 4 committees total; validator pass green |
| `procedures/_output-types.yaml` | `ic_committee_deliberation`, `group_ic_committee_deliberation` registered (validator requires same-change registration) |

### Skills (reference the procedures; none restates steps)

`stage-gate-governance`, `dd-to-valuation-bridge`, `two-tier-approval-chain`, `executive-presentation`, `legal-risk-register`, `waiver-management`, `insight-synthesis`, `financing-plan-review`, `rag-scoring-framework`, `portfolio-fit-assessment`, `intra-group-transaction-compliance`, `group-level-review`, `meeting-facilitation` (newly referenced as the deliberation step's method skill — it owns HOW a meeting is facilitated; the WHAT stays in the procedure per boundary 3).

Assessment: no skill restates gate steps (validator SA pass green). No skill edits required — the deliberation step's skill reference (`meeting-facilitation`) already exists and passes the skill-existence bar.

### flow.spec / generated projections

- `process/flow.spec.yaml` v2.21.0: one `decisionCriteria` line added at `entity_ic` and `group_ic` ("IC 위원회 세션이 존재하고 그 회의록(확정 또는 초안)이 IC 패키지에서 참조되었다"). This is a spec-recorded criterion, not an engine blocker — the committee session is never a HARD BLOCK input (ADR-0186 amendment). S11 activity hosting unchanged.
- Regenerated: `docs/process-flow.md`, `app/web-next/lib/spec-activities.generated.ts`, `mcp/co-newbiz/stage-guides.generated.ts` (spec 2.21.0).
- Spec registry (`docs/specs/registry.json`): no entry needed — prior flow.spec bumps (e.g. ADR-0195 → 2.20.0) register the design doc, not the spec file; the Phase E design doc is already registered (id `2026-11-08-committee-minutes-as-meeting-design`).

### ADRs and records

- `docs/adr/0186-gate-integrity.md` — amendment note extended 2026-11-09 (DISPLAY/ACK classification, minutes maker-checker, `snapshot_hash` coverage). Not a new ADR.
- `docs/adr/0196-committee-minutes-as-meeting.md` — already carries Phase E; untouched here.
- `docs/adr/0053`, `0100`, `0161`, `0051`, `0060` — historical references to the procedures; the new step does not contradict them (ADR-0053 recorder pattern is explicitly reused as the chair rule). No amendment needed.

### Others checked and unaffected

`docs/governance/process-map.md` (generated family), `docs/governance/traceability-matrix.md`, `docs/architecture/{srs.md,api-spec.md,openapi.yaml}`, runbooks, pilots, decisions (DEC-*), reports, audits, `checklists/financing-plan-checklist.yaml` (referenced as step-4 evidence list; step numbering unchanged), agent roster files — all descriptive/historical references; none encodes the step chain, so no follow-up edits required beyond the regenerations above.

## 2. `project_policy_pin` check (in-flight projects)

Query: `SELECT project_id, policy_doc_id, pinned_version FROM project_policy_pin` on `db/data/co-newbiz.sqlite`.

**Result: 0 rows.** The `project_policy_pin` table exists but no in-flight project pins `entity-ic-review` v1.4.0 or `group-investment-review` v1.3.0 (or anything else).

Rule applied (design §7.2): pinned projects keep pinned versions; the new deliberation step applies to new pins only; re-pin is an explicit human action. **No migration performed — nothing to migrate.**

## 3. Required follow-ups

1. None blocking merge. Validators green: `bun procedures/_validate.ts --strict` (0 errors; pre-existing declared-but-inert warnings unchanged), `bun scripts/co-newbiz/process-ssot-check.ts` (exit 0), `bun scripts/co-newbiz/runbook-validate.ts` (exit 0), `bun test tests/unit/process-flow.test.ts tests/unit/committee-boundary.test.ts` (29 pass).
2. When the engine (parallel Phase E work) lands project-scoped sessions, if it requires a DB schema change that ADR is drafted separately (owner decision; this task stays out of `app/` and `tests/unit/committee-*`).
3. Hardening "missing session ⇒ ACK" to HARD BLOCK requires a separate owner decision (recorded on ADR-0186 amendment).
