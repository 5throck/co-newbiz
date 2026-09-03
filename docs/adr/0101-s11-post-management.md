# ADR-0101: S11 post-management — portfolio scorecard view, human transition-decision ledger, and completion of the S8–S11 chain

- Status: Accepted
- Date: 2026-09-04
- Deciders: New Business Review Lead (PM), per approved S8–S11 implementation plan (Phase 6 — final)
- Design of record: `process/flow.spec.yaml` (S11, spec v2.0.0), `procedures/_shared/portfolio-venture-monitoring/schema.yaml` (steps 1–3; step 3 `decision_authority: human`), `procedures/_human-roles.yaml` (`venture-portfolio-ic` registry entry), `db/migrations/0024_venture_scorecard.sql`, `db/migrations/0071_venture_transition_decision.sql` (new), `db/repositories/venture-scorecard.repository.ts` (`getPortfolioRollup` — the shared rollup core), `scripts/co-newbiz/scorecard-rollup.ts` (`scorecard:rollup` CLI), `app/web-next/lib/process-flow.ts` (project-branch S11 check + `PORTFOLIO_TRANSITIONS`), `app/web-next/app/api/projects/[id]/scorecard/route.ts`, `app/web-next/app/api/projects/[id]/transition-decision/route.ts` (new), `app/web-next/app/projects/[id]/portfolio/page.tsx` (new)
- Related: ADR-0059 (the `venture_scorecard` storage the E.4 chain deferred at design time; open question (b) — weights and cadence stay governance-doc references, never columns), ADR-0053 (`decision_authority: human`; the `venture-portfolio-ic` human-role key and the recorder pattern), ADR-0100 (S10; the project-keyed `/api/projects/[id]/**` deny-by-default pattern and the ADR-0098 route conventions this phase follows), ADR-0095 (project promotion; the project is the S8–S11 stage carrier), ADR-0014 (additive-only migration rules)
- Related non-ADR artifacts: project CLAUDE.md boundary #2 (gate approval and the investment decision belong to humans — tranche release and kill/divest are investment decisions), the design §E.2 integrity guardrails (small senior IC; kill is a governed decision, not a silent starve)

## Context

S11 (사후 관리) is the last stage of the project branch and the only S8–S11
stage with no gate. Its outputs, verbatim from `flow.spec.yaml` v2.0.0:

> 포트폴리오 스코어카드 / 사업 성과 리포트 / 포트폴리오 전환 결정(어휘 5종:
> next_tranche_released / held_evidence_incomplete / graduate_to_core /
> reduce_or_divest / kill_with_learning_captured)

with completion criterion "분기별 스코어카드가 갱신되었다" (the quarterly
scorecard has been refreshed). `stateTransitions` for S11 is
`{ onComplete: terminal, onHold: S11, onKill: terminal }` — the stage never
hands off; it is the standing portfolio-governance surface.

The backend chain is complete:

- `venture_scorecard` (0024, ADR-0059) stores the per-cycle evidence rows —
  bifurcated financial/strategic, class taxonomy, per-measure targets, the
  `'????-Q[1-4]'` GLOB CHECK that makes lexicographic MAX(review_cycle) a safe
  latest-cycle resolution.
- `db/repositories/venture-scorecard.repository.ts` owns every write
  (`recordVentureScorecardCycle`) and exposes `getPortfolioRollup` — a PURE
  query returning one review cycle's rollup: bifurcated sections, class
  rollup, `insufficient_evidence` exceptions, `resolved_from: explicit|latest`.
- `scripts/co-newbiz/scorecard-rollup.ts` (`scorecard:rollup`) is a thin CLI
  print-shape over `getPortfolioRollup`, deliberately guard-free because it is
  a group-operator aggregate view with no writes; per the procedure's step 1,
  per-caller visibility "belongs to the server route (PR-3)".

The procedure (`portfolio-venture-monitoring/schema.yaml`) states the exact
remaining work in step 1: **"The portfolio VIEW (server routes + web page) is
the remaining E.4 link."** Nothing of that view exists — no scorecard route, no
portfolio page, no transition-decision endpoint.

The transition decision (procedure step 3) is the other missing piece. The
0024 migration header explicitly excludes it: *"Decisions excluded —
venture_transition_decision and tranche releases are approval-chain records
(two-tier-approval-chain / group-level-review lineage); this table stores
evidence rows only."* Verified fact: no `venture_transition_decision` table,
column, or code reference exists anywhere in the repository today — the only
occurrence of the name is that 0024 comment. S11's five-vocabulary decision
(currently unpersisted) needs a home. `PORTFOLIO_TRANSITIONS` already exists in
`process-flow.ts` with the exact five values from the procedure, exported but
consumed by nothing server-side yet.

`process-flow.ts`'s S11 branch is the last remaining placeholder-grade check
in the project branch: it counts any `venture_scorecard` row for the project —
"any row ever" is not "분기별 스코어카드가 갱신되었다" (refreshed), and the
branch's own comment already names the refinement ("분기 최신성(현재 분기 vs
최신 review_cycle) 검사로 강화").

## Decision

### 1. Migration `0071_venture_transition_decision.sql` (additive, ADR-0014)

`0071` is the next free number (0070 is the highest existing migration, used
by ADR-0100/Phase 5). The verification above settles the "reuse or add?"
question: **nothing exists to reuse** — 0024 stores evidence rows only and its
header names the decision ledger as deliberately out of scope. A small
additive table:

```sql
CREATE TABLE venture_transition_decision (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES run(id),
  project_id TEXT NOT NULL REFERENCES md_project(id),
  review_cycle TEXT NOT NULL CHECK (review_cycle GLOB '????-Q[1-4]'),
  decision TEXT NOT NULL CHECK (decision IN (
    'next_tranche_released','held_evidence_incomplete',
    'graduate_to_core','reduce_or_divest','kill_with_learning_captured')),
  decided_by TEXT NOT NULL CHECK (decided_by = 'venture-portfolio-ic'),
  decided_at TEXT NOT NULL,
  rationale TEXT NOT NULL CHECK (rationale <> ''),
  learning_capture TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_vtd_project ON venture_transition_decision(project_id, review_cycle);
```

Design notes:

- The five-vocabulary CHECK is the server-side enforcement point the route
  validates against; `PORTFOLIO_TRANSITIONS` in `process-flow.ts` is the
  TypeScript mirror and the two must stay in lockstep (the ADR-0098
  type-and-spec-port pattern).
- `decided_by` is constrained to the ADR-0053 human-role key — an agent
  identity can never be the decider of record. The **recorder** (whoever
  wrote the row) is tracked separately by run/actor lineage (ADR-0005), which
  is how ADR-0100's recorder pattern is expressed without a second column.
- `rationale` is REQUIRED — "a kill is a governed decision, not a silent
  starve" (procedure step 3); `learning_capture` is optional and carries the
  playbook recycle note where the IC supplied one.
- No `portfolio_entry`/`investment_decision` (0057) revival: those are the
  dead v1 tables ADR-0100 formally recorded as write-less; S11 decisions are
  portfolio-governance transitions, not gate records, so they do not belong in
  `gate_decision` either (S11 has `gates: []` in the spec).

### 2. API — project-keyed, deny-by-default (ADR-0098/0100 pattern)

- `GET /api/projects/[id]/scorecard` — the quarterly rollup view, behind
  `getProjectIfVisible`. It imports `getPortfolioRollup` from
  `db/repositories/venture-scorecard.repository.ts` directly. **No logic is
  extracted or duplicated**: the shared rollup function already lives at the
  repository layer (the CLI's `runScorecardRollup` is a `JSON.stringify` print
  wrapper over the same call), so the route and `scorecard:rollup` consume one
  implementation. Optional `?review_cycle=YYYY-Qn` resolves explicit cycles;
  otherwise latest (the repository's `resolved_from` field is surfaced so the
  UI never mistakes a resolved-latest read for an explicitly pinned one).
- `POST /api/projects/[id]/transition-decision` — human-only write surface.
  Validates the 5-vocabulary, requires non-empty rationale, records
  `decided_by: 'venture-portfolio-ic'`. Per ADR-0053's recorder pattern (the
  same shape ADR-0100 applied to Group IC), the route is operated by
  `process-governance-manager` — the procedure's step-2 agent — recording the
  venture-portfolio-IC's decision made in the IC sitting; the agent records,
  it never decides. Kills additionally require `learning_capture` when the
  decision is `kill_with_learning_captured` (route-level rule mirroring the
  procedure's "rationale and learning capture recycled into the playbook").

### 3. Web — `app/web-next/app/projects/[id]/portfolio/page.tsx`

Single S11 screen: scorecard trend view (cycles × bifurcated
financial/strategic sections, class rollup, `insufficient_evidence`
exceptions) + the transition-decision panel — explicitly marked as a **human
decision of the venture-portfolio-IC**, rendering prior decisions with
rationale. Built on the Onyx 3.0 standard screen system
(`docs/design-guide.md`, `StageFrame`, semantic tokens), `design:lint` at 0
violations — user-mandated.

### 4. S11 completion in `process-flow.ts` (project branch) — the last placeholder

Replace the S11 branch's count-any-rows probe with: **a scorecard row exists
for the latest recorded cycle and that cycle is not stale** — the project's
MAX(`review_cycle`) must be a current quarter (the cycle containing "now" per
the `'????-Q[1-4]'` shape; a lagging latest cycle yields a blocker naming the
stale cycle). "분기별 스코어카드가 갱신되었다" is thus mechanically checkable,
matching how S8–S10 predicates were made checkable in Phases 3–5. With this,
**every S8–S11 stage-completion criterion in the project branch is a real
predicate** — the ADR-0095 skeleton's REFINEMENT markers are fully retired.

### 5. MCP thin wrapper

`get_portfolio_scorecard` reads `GET /api/projects/[id]/scorecard` — REST-only,
no direct DB access, consistent with ADR-0094's no-dead-endpoints rule. The
transition-decision POST is deliberately **not** MCP-exposed: recording an
IC's decision is a governed act done through the procedure's recorder flow,
not an API convenience.

## Consequences

- **The E.4 chain is closed.** 0024's own header said the view "follows"; this
  ADR is that follow-through, and the procedure's step 1 "remaining E.4 link"
  note is discharged.
- **The S8–S11 chain is complete.** Every stage's completion criterion in
  `process-flow.ts`'s project branch is now a real predicate over real
  artifacts; no REFINEMENT placeholders remain anywhere in the branch.
- **Boundary #2 survives S11**: tranche release and kill/divest are investment
  decisions — `decided_by` is schema-constrained to the human role, the agent
  surfaces evidence and records, and kill requires captured learning. The
  scorecard view presents data, never a recommendation to kill or fund.
- **A second (small) ledger table enters with 0071** — accepted because 0024
  explicitly excluded decisions and forcing them into evidence rows or
  `gate_decision` (a gate-less stage) would both be type errors.
- **Deferred / unchanged**: scorecard weights and review cadence remain
  ADR-0052 open question (b) — they enter via governance-doc reference when
  decided, never as columns with silent defaults; 0057 residue stays formally
  dead under ADR-0014's additive-only rule.
