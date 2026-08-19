# Meeting M7-3: Deal Review Execution Model (Axis C)

**Date**: 2026-08-20
**Facilitator**: pm
**Participants**: pm, process-governance-manager, security-engineer, compliance-officer, risk-officer, platform-lead
**Objective**: Fix per-gate agent assignment mechanics, permission inheritance implementation detail, human/agent boundary enforcement point, output stamping, and the concurrent-deal cap in practice.

---

## Agenda
1. How `procedures/*.yaml` actually assigns agents per gate (mechanically)
2. Permission inheritance — implementation checkpoint
3. Human/agent boundary — where exactly is the enforcement point
4. Concurrent-deal cap — first real number and how it gets measured

## Discussion

**pm**: Design fixed the principle (procedures own agent assignment, not skills). I want the actual data shape and the human/agent boundary's enforcement point nailed down before Stage 2 writes real procedures.

**process-governance-manager**: Concretely, each procedure step in a `procedures/*.yaml` file names an `agent_key` and produces an `analysis_task` row when dispatched. The procedure doesn't say "brownfield-agent does X" in prose — it's a structured `steps: [{gate, agent_key, skill_key, output_type}]` list that the dispatch layer reads directly, so there's no re-parsing of natural language to figure out who runs next.

**platform-lead**: That maps cleanly to `analysis_task.agent_key`/`skill_key` already in the design's schema — confirming no new fields needed, just confirming the procedure YAML's `steps` list is the authoritative source dispatch code reads.

**security-engineer**: On permission inheritance implementation checkpoint — I want this stated as a specific test, not a principle: "dispatch an agent against a project where the requesting user is not a `project_member`; assert the dispatch is rejected before any agent code executes, not after the agent tries and fails to read data." Rejecting late (agent starts, then fails to fetch data) still risks a timing/error-message side channel; rejecting early at dispatch time is the only acceptable enforcement point.

**pm**: Agreed, and I'll own enforcing that at the PM dispatch layer specifically, since PM is the single dispatch point — this is literally the PM Gateway's job, not something each specialist agent re-checks independently.

**compliance-officer**: On the human/agent boundary enforcement point — `analysis_task.reviewed_by` being NULL blocks the gate is already fixed. I want to add: the gate-check query must be a single authoritative check (one function, one place), not scattered across each procedure's own gate logic, or someone will eventually write a new procedure that forgets the check.

**risk-officer**: Agreed, and pairing with that — when an agent's proposed RAG grade differs from what a human ultimately sets, I want that recorded as a `rag_assessment` correction with a mandatory reason field, not a silent overwrite. That data becomes the calibration input risk-officer already committed to using in Stage 3.

**pm**: On concurrent-deal cap — design's formula is `min(reviewer_capacity / 0.3, wall_group_compatible_assignments)`. For a first real number: if we assume one reviewer at the "≥2.5 days/week" bar the design's O-16 default settles for, that's roughly 0.5 FTE, giving reviewer_capacity/0.3 ≈ 1.67 → effectively cap at 1 concurrent deal until reviewer allocation is confirmed at a higher level. I want that stated plainly rather than defaulting to the design's "start at 3" figure, which assumed a stronger reviewer baseline than we've actually confirmed.

**process-governance-manager**: Agreed — the "start at 3" in the design was written before O-16 was known to still be unconfirmed. Correcting it here: concurrent-deal cap starts at 1 under the conservative reviewer-allocation assumption, and only moves to 3 once reviewer allocation is actually confirmed at ≥1.0 FTE equivalent (a dedicated reviewer or several part-time reviewers summing to that).

## Decisions

| # | Decision |
|---|---|
| D-M7-3-1 | Procedure agent-assignment data shape confirmed: `steps: [{gate, agent_key, skill_key, output_type}]`, structured, not prose — dispatch code reads this directly |
| D-M7-3-2 | Permission-inheritance enforcement point: **at dispatch time**, before any agent code executes — rejecting after an agent attempts and fails is not acceptable (timing side-channel risk) |
| D-M7-3-3 | PM Gateway is the single point enforcing D-M7-3-2 — not re-checked independently by each specialist agent |
| D-M7-3-4 | Human/agent boundary gate-check (`reviewed_by` NULL blocks gate) must be one authoritative function, not duplicated per-procedure logic |
| D-M7-3-5 | Human corrections to an agent-proposed RAG grade are recorded with a mandatory reason field, feeding the Stage 3 calibration dataset — never a silent overwrite |
| **D-M7-3-6** | **Correction to design default**: concurrent-deal cap starts at **1** (not 3) under the current unconfirmed-reviewer-allocation assumption; moves to 3 only once reviewer allocation is confirmed at ≥1.0 FTE equivalent |

## Action Items

| # | Action | Owner | Landing | Status |
|---|---|---|---|---|
| A-1 | Implement dispatch-time permission check as a PM Gateway precondition, not per-agent | pm, backend-engineer | Stage 5.1/5.5 | Pending |
| A-2 | Implement the single authoritative gate-check function | backend-engineer, data-architect | Stage 5.3 | Pending |
| A-3 | Add `rag_assessment` correction-reason field to schema | data-architect | Stage 4 db-schema.md | Pending |
| A-4 | Update design doc's concurrent-deal-cap starting value from 3 to 1 pending O-16 | process-governance-manager | Design doc addendum | Pending |

## Open Issues
- Concurrent-deal cap of 1 is a real operational constraint until O-16 (reviewer allocation) is confirmed — flagging this makes Stage 1's dependency on O-16 concrete rather than abstract.
