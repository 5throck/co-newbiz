# ADR-0100: S10 investment screening & execution — IC package surface, project-keyed establishment steps, and 0057 deprecation

- Status: Accepted
- Date: 2026-09-04
- Deciders: New Business Review Lead (PM), per approved S8–S11 implementation plan (Phase 5)
- Design of record: `process/flow.spec.yaml` (S10, spec v2.0.0), `db/migrations/0070_entity_establishment_project_key.sql` (new), `db/migrations/0059_entity_establishment.sql` (`entity_establishment_step`), `db/migrations/0057_investment_progress.sql` (`investment_decision`, `portfolio_entry` — deprecated), `app/web-next/lib/process-flow.ts` (project-branch S10 check), `app/web-next/app/api/projects/[id]/ic-package/route.ts`, `app/web-next/app/api/projects/[id]/establishment/route.ts` (new), `app/web-next/app/api/opportunities/[id]/establishment/route.ts` (existing pattern), `app/web-next/app/projects/[id]/ic-review/page.tsx` (new)
- Related: ADR-0095 (project promotion foundation; its Consequences note that `entity_establishment_step` stays opportunity-keyed until this phase backfills `project_id`), ADR-0085 (S10 establishment execution alignment; `entity_establishment_step` from 0059, origin∈{internal,joint} only), ADR-0094 (`gate_decision` as the sole human-confirmation ledger, entity_type rebuilt in 0062), ADR-0053 (decision_authority: human; the `entity-ic-reviewer` human-role key and the recorder pattern), ADR-0098 (S8; the `/api/projects/[id]/**` deny-by-default route pattern this phase follows), ADR-0078 (removal of the old S4+ web surface — the reason 0057 has no live writers), ADR-0014 (migration rules)
- Related non-ADR artifacts: project CLAUDE.md boundary #2 (gate approval and the investment decision belong to humans; agents produce analysis and a *proposed* RAG grade, never the decision), boundary #4 (data confidence caps the overall RAG grade — why the IC package must carry the confidence cap, not just the grade)

## Context

S10 (투자심사·실행) is the stage where the deal is decided and, for
origin∈{internal,joint}, executed as a new legal entity. Its completion
criteria, verbatim from `flow.spec.yaml` v2.0.0:

> Entity IC와 Group IC 승인이 모두 기록되었다
> origin∈{internal,joint}인 프로젝트는 entity-establishment-execution 5단계 완료 기록이 존재한다

— both gate approvals recorded, plus (where origin internal/joint) a record of
all five establishment steps being done. The stage carries gates
`entity_ic` and `group_ic`, and the required artifacts name the "IC 패키지"
(business case · DD · RAG · review) as the package the committees read.

The pieces exist but are disconnected:

- `gate_decision` (rebuilt in 0062 with `entity_type`) already accepts
  `entity_ic` and `group_ic` per ADR-0094 — it is the sole human-confirmation
  ledger and needs no extension.
- `entity_establishment_step` (0059, per ADR-0085) records the 5-step
  establishment execution — 설립준비 → 법인등기·정관·사업자등록 → 인허가
  이전/재발급 분류 → 인력이전(신 근로계약+PIIA) → 완료확인 — but is keyed
  `opportunity_id` only. ADR-0095's Consequences explicitly deferred the
  project key to this phase; until now `process-flow.ts` reaches it through a
  `source_opportunity_id` backlink join, which breaks for promoted projects
  whose source opportunity is invisible to non-promoter members.
- **No IC package surface exists.** The aggregated read-side package — adopted
  business case and valuation simulations (0068), DD checklist completion and
  findings (0039/0011), the AI-proposed RAG assessment, gate history, and
  establishment progress — is assembled nowhere; reviewers would have to
  hand-stitch it.
- **`investment_decision` / `portfolio_entry` (0057) are superseded.** They
  were the reduced-scope investment surface of the v1 stack. ADR-0094 made
  `gate_decision` the sole human-confirmation ledger; ADR-0085 moved execution
  into `entity_establishment_step`. Verified fact: **no code in the repository
  references either 0057 table** — the old S4+ web surface that wrote them was
  removed by ADR-0078, so they are already write-less and read-less. They are
  dead schema, not a live competitor.

## Decision

### 1. Migration `0070_entity_establishment_project_key.sql` (additive, ADR-0014)

`0070` is the next free number (0069 is the highest existing migration, used by
ADR-0099/Phase 4). Additive-only:

```sql
ALTER TABLE entity_establishment_step
  ADD COLUMN project_id TEXT REFERENCES md_project(id);
-- backfill: promoted opportunities carry md_project.id in opportunity.project_id
UPDATE entity_establishment_step
  SET project_id = (SELECT project_id FROM opportunity WHERE id = opportunity_id)
  WHERE project_id IS NULL;
CREATE INDEX idx_ees_project ON entity_establishment_step(project_id, step_no);
```

`opportunity_id` stays `NOT NULL` — the opportunity remains the origin of
record; `project_id` is the promoted-project projection of the same rows, so
both the opportunity establishment view and the project establishment view read
the same 5-step record. The ADR-0095 note is discharged: the join through
`source_opportunity_id` in `process-flow.ts` S10 becomes a direct
`project_id` lookup (the backlink remains as fallback only where
`project_id` is NULL, i.e. rows predating promotion that never backfilled).

**Deprecation of `investment_decision` / `portfolio_entry` (0057).** No
migration drop — ADR-0014 is additive-only. Deprecation is recorded here:
verified during this ADR, `grep` for either table name across `*.ts`/`*.tsx`
returns only the 0057 migration file itself; no code path creates, writes, or
reads these tables since ADR-0078 removed the old S4+ web surface. The tables
are formally dead and this ADR is the record of that finding. If a future
cleanup ADR ever relaxes ADR-0014's additive-only rule for legacy tables,
0057 is the first candidate; until then the tables simply sit unused.

### 2. API — project-keyed, deny-by-default (ADR-0098 Phase 3/4 pattern)

- `GET /api/projects/[id]/ic-package` — **read-only** aggregation for IC
  reviewers, behind `getProjectIfVisible` (deny-by-default membership
  visibility):
  - **Business case**: the adopted business case plus its valuation
    simulations (0068 outputs — the S8→S9 chain's adopted scenario);
  - **DD summary**: applied-checklist completion status (`project_checklist_item_state`,
    0039) and findings (`dd_finding`, 0011), including any unresolved mandatory
    items;
  - **RAG assessment**: the proposed grade — rendered explicitly as a
    **proposal**, with the confidence cap that produced it (boundary #4: a
    two-hop proxy estimate cannot read as Green regardless of financials);
  - **Gate history**: latest `gate_decision` per gate for `entity_ic` and
    `group_ic` (entity_type='project');
  - **Establishment progress**: the 5-step record via `project_id` (per §1).
- `GET /api/projects/[id]/establishment` and
  `PUT /api/projects/[id]/establishment` — the 5-step execution surface,
  mirroring `app/web-next/app/api/opportunities/[id]/establishment/route.ts`
  (sequence enforcement: a step may not be marked `done` ahead of its
  predecessor; status vocabulary `pending|in_progress|done|halted|escalated`
  per 0059; origin∈{internal,joint} enforced per ADR-0047/applies_when).
  Both routes operate on the same rows through the shared `project_id` key —
  the project route is a projection, not a second ledger.

### 3. Web — `app/web-next/app/projects/[id]/ic-review/page.tsx`

Single S10 screen: IC package summary + `GateDecisionPanel` ×2 (entity_ic,
group_ic) + establishment 5-step progress. Built on the Onyx 3.0 standard
screen system (`docs/design-system/design-guide.md`, semantic tokens, `StageFrame`), with
`design:lint` at 0 violations — user-mandated.

### 4. Boundary #2, explicitly

The IC package presents the AI-proposed RAG grade labeled as a **proposal** —
no PASS stamp, and the verified / could-not-verify / needs-judgment split is
carried where the underlying artifacts supply it (DD findings). Gate records
`entity_ic` and `group_ic` remain human authority: Entity IC confirmation is
executed by the human `entity-ic-reviewer` (ADR-0053 human-role key — the
reviewer confirms or corrects the proposed grade and records the decision),
and Group IC's decision step is executed by `process-governance-manager` under
the ADR-0053 **recorder** pattern — the agent records the human committee's
decision, it never makes it. The establishment steps are execution records with
named human `owner` per step (0059); an agent never marks a step done on the
human's behalf.

### 5. S10 completion in `process-flow.ts` (project branch)

Replace the current S10 branch — which already checks both gates but reaches
establishment through the `source_opportunity_id` backlink — with: both gates
`go` on the **latest** `gate_decision` per gate, AND, where
origin∈{internal,joint}, 5/5 `entity_establishment_step.status='done'` joined
by `project_id` (backlink fallback for un-backfilled rows). The S11 placeholder
(`REFINEMENT (Phase 6)`) stays untouched.

### 6. MCP thin wrapper

`get_ic_package` reads `GET /api/projects/[id]/ic-package` — REST-only, no
direct DB access, consistent with ADR-0094's no-dead-endpoints rule. The
establishment PUT is deliberately **not** MCP-exposed: step completion is a
human-owned execution record.

## Consequences

- **S10 has a complete v2-stack surface**: the committees read one deny-by-default
  screen; both gate decisions and the 5-step execution land in the ledgers that
  already exist. No new decision table is created — the IC phase is surface, not
  schema (except the §1 key).
- **Establishment steps are shared across opportunity and project views** via
  the backfilled `project_id`; ADR-0095's deferred note is discharged and the
  `source_opportunity_id` join becomes a fallback rather than the primary path.
- **0057 tables are formally dead**, with the write-less finding recorded here
  as the rationale; they linger only because ADR-0014 forbids drops.
- **Boundary #2 survives presentation**: the RAG grade reaches the committee as
  a capped proposal, and confirmation authority stays with registered human
  roles under ADR-0053's key and recorder shapes.
- **Deferred**: the S11 branch (portfolio scorecard refresh, Phase 6) remains a
  REFINEMENT placeholder and is the natural successor ADR for retiring 0057
  residue if `portfolio_entry`'s quarterly scorecard semantics are ever rebuilt
  on v2 primitives.
