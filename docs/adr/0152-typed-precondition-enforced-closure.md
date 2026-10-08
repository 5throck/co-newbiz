# ADR-0152 — Typed, precondition-enforced closure for projects and opportunities

- Status: Accepted (2026-10-08, approved by the user in chat)
- Date: 2026-10-08
- Deciders: Human reviewer (user, approved in chat 2026-10-08). Drafted by platform-lead (Wave F Row 0). Vocabulary input requested from process-governance-manager. AI review alone cannot accept this ADR (DB schema change).
- Design of record: `docs/designs/2026-10-08-wave-f-process-closure-design.md` §3
- Related: ADR-0014 (rollback convention), ADR-0150, ADR-0151

## Context

Closure is expressed by three unlinked fields: `md_project.status`, `pipeline_run.status`, and the S12 `venture_transition_decision`. `closeProject` requires only a reason text and marks active runs `completed` even for abandoned deals. Gate KILLs at S1–S11 and opportunity drops capture no learning.

## Decision

1. Add a `closure_record` table (migration 0122). It holds one active row per entity and records `closure_type`, the basis record, the reason, `learning_capture`, `closed_by`, and `closed_at`.
2. The vocabulary is `killed_at_gate`, `withdrawn`, `graduated_to_core`, `divested`, `killed_with_learning`, plus `dropped` for opportunities only. Each type has a blocking precondition on its basis record (design §3.1).
3. Every kill or withdrawal closure requires learning capture. `gate_decision` gains a nullable `learning_capture` column (migration 0123), and the route requires it when `decision='kill'`.
4. `pipeline_run.status` gains `killed` and `withdrawn` through a table rebuild. Closure maps the type to a terminal status instead of always using `completed`.
5. `md_project.closure_type` is denormalized and written in the same transaction. `archived` requires a prior closure.
6. Enforcement lives in the repository and route layers. `closed_by` comes from the session user, and agents cannot close.
7. Grandfathering follows ADR-0151: legacy closed rows keep `closure_type = NULL`, and pre-0123 kills are exempt from the learning requirement.

## Consequences

- Closing is blocked until the human-recorded basis exists. `withdrawn` is the escape path.
- A table rebuild is needed. It must be rehearsed on a backup.
- The IC/portfolio reports can filter by closure type and aggregate learning.

## Resolved questions (approved 2026-10-08)

1. Closure vocabulary as in design section 3.1; `dropped` stays a separate opportunity-only type.
2. The `domain:` frontmatter field on `agents/*.md` is added in PR F-2, not F-1.
3. `pipeline_run.status` is extended with `killed` and `withdrawn` via a table rebuild.
