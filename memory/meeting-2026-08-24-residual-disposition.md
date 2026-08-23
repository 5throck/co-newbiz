# Meeting — D-Round Residual Disposition (2026-08-24)

## Agenda and Purpose

A decision-support leads' meeting on how to dispose of the three residual categories left after the D-round completed (PRs #102–#104: kill-criteria classification + the E.4 scorecard full chain):

1. **R9** procedure-execution orchestrator (the only class-D development residual)
2. **class C** items awaiting user decisions
3. **Optional backlog** (class-(iii) 25-var seeding · templates 8/59 · R6)

Session composition: PM (chair) + process-governance-manager (functional domain) + platform-lead (technical domain). Industry/region leads not convened — outside this agenda. Decision-support meeting — verdicts belong to a human (boundary #2).

---

## Perspective Statements (round 1)

### 1. platform-lead (technical / build-run domain)

- **Start R9 now**: the `newbiz.ts` CLI performs only deterministic computations (proc:resolve/rag/watch:run/scorecard:rollup); step-by-step procedure execution is entirely manual. Now that the execution machinery can trust procedure YAML and evaluation schemas post-D-round, this is the lowest-risk moment to add an execution layer.
- **R9 MVP scope**: (1) run lifecycle persistence (procedure_run), (2) step state machine (pending/in_progress/blocked/done), (3) agent-dispatch loop (read each step's agent_key/skill_key/output_type and record deliverable links), (4) pause/resume for human steps. **Excluded as overreach**: automatic retry/scheduling, multi-run concurrency optimization, a UI procedure viewer, agent accounts, kill-criteria auto-triggering (read-only reflection of the 0023 evaluation results into state).
- **Three runtime risks**: duplicate run creation (resolve output varies by time → must pin the resolved snapshot JSON onto the run), resume semantics for partially-completed runs, resume authorization boundary (anyone resuming violates boundary #2).
- Class-(iii) seeding touches the same files as R9 (db/lib, migrations, proc-resolve) — contention is real → recommended deferral.

### 2. process-governance-manager (functional / procedures·policy domain)

- **Reorder R9 (do NOT start it now)**: the bottleneck is not "no execution actor" but "no verdict criteria." An orchestrator without thresholds is pseudo-automation that waves gates through on ILLUSTRATIVE values. Preconditions: the class-C package decided + one real deal passing a procedure fully manually first (axis C quality-validates A/B).
- **class C is the only real work** (though all an agent can do is assemble the decision package — boundary #2). Combine the four `docs/decisions/` drafts + ADR-0052 open questions (a)–(d) into a single agenda pack. (Note: the audit's `docs/decisions/open/` path reference does not exist — correction requested.)
- **The 25-var seeding is conditional**: items whose thresholds are already settled in their wording (#18 ip_assignment etc., completeness facts) can be seeded without upstream decisions — opposed to blanket-deferring "everything until thresholds." ADR-0060 §3's per-dimension ADR discipline still applies.
- **Adopted two traps as prohibitions**: no `is_null` over routing vars (`project.origin` etc. — until the snapshot-mirroring decision), and no reuse of the `market.bargaining_power_hhi` antitrust var. Threshold-landing PRs must explicitly pass `_validate.ts`'s anti-tamper gate (`enabled:true` ⇒ `policy_id`+`thresholds_source`) — the sole line of defense against ILLUSTRATIVE auto-promotion.

---

## Chair Synthesis (PM)

**Convergence**: assembling the class-C package is the only real work for agents now / no template expansion, no R6 / no blanket 25-var seeding / common gate conditions for any future R9 design (the four human-authority pins are non-bypassable · no automated verdict approval · no agent accounts · block ILLUSTRATIVE promotion).

**Branch ruling (when to start R9)** — weighted toward the functional lead, conditional compromise: "thresholds → seeding → R9 design → (one real deal manual pass OR explicit user GO) → R9 implementation." Grounding: (i) the evaluator+ledger (0023)+rollup chain has already landed, so realizing threshold value needs no orchestrator (the technical lead's premise factually rebutted); (ii) automating what has never passed a single real deal automates error; (iii) the technical lead's MVP skeleton and three runtime risks are adopted as the base skeleton of the future R9 design ADR (design may proceed in parallel with the landing rounds); (iv) since waiting indefinitely for "one real deal" carries its own risk, explicit user GO may substitute.

---

## Post-Meeting Premise Correction (PM, 2026-08-24 — recorded as required)

The meeting proceeded on the audit report's class-C narrative, but post-meeting verification against git history showed half that premise was wrong:

- The market/risk/technical-execution RAG thresholds + substitution vocabulary were **already user-approved on 2026-08-23** ("go", #86 `dbed8f1` — predating audit baseline `2b61403`). Rule-layer activation (migration 0022, 18/19 rows enabled=1) has landed too. The Green cap remains in force per the approval records.
- The audit §4 R7 / §5-2 "awaiting approval" wording was **stale-on-arrival** — corrected with amendment markers in the same PR; the ADR-0052 open-questions header synced to match.
- The functional lead's proposed agenda item 1 (RAG 3+1) is **void — already decided**. The genuine remaining class C: **(a) TRL/MRL per-gate cutoffs · (b) JV weights/cadence · (c) synergy certification + 90-day attrition · (d) deal-shape selection thresholds · the calibration corpus (→ Green cap lift) · the antitrust #13 reversal yes/no**. The priority logic for (b) (immediate utility once values fill the live E.4 chain) stands.
- Derived effect: with the RAG approvals in hand, class-(iii) vars previously blocked on "threshold pending" are **now seedable** — distinguish them via the decision pack's "what each decision unlocks" section and the ADR-0060 table.

---

## Decisions and Action Items

| # | Item | Owner | Status |
|---|---|---|---|
| 1 | Assemble the decision pack (`docs/decisions/2026-08-24-residual-decisions-pack.md`) — (b) prioritized over (a)(c)(d)·corpus·antitrust, stating explicitly "RAG already approved" | docs-writer → PM gate | This PR |
| 2 | Correct stale audit R7/§5-2 wording + sync ADR-0052 status | PM | This PR |
| 3 | User decision (meeting or async), based on the pack | User | After pack delivery |
| 4 | Threshold-landing PR (explicit anti-tamper gate) → per-dimension ADR seeding of unlocked vars → re-baseline executables | PM + specialists | After decision |
| 5 | R9 design ADR (MVP skeleton + gate conditions + three risks) — may proceed in parallel with 4 | platform-lead designs, PM gates | Separate approval |
| 6 | R9 implementation — precondition: one real deal passed manually OR explicit user GO | build/run class agents | When conditions met |

**Explicitly excluded**: R6 verification · template expansion · blanket 25-var seeding · antitrust reversal (until a meeting says yes) · starting R9 without thresholds.
