---
lang: en
counterpart: rag-host-scheduler_ko.md
---

# Runbook — RAG Staleness Recompute (Host Scheduler Handoff)

Owner: infra-automation-engineer. Audience: operators. Wave F-5 (design `2026-10-08-wave-f-process-closure` §5).

## What and why

The web app recomputes the proposed RAG grade lazily: on gate-brief generation for the IC gates and on every IC-package read (`db/lib/rag-service.ts` `recomputeRag`). A project nobody opens therefore keeps an old proposal. The production container has **no scheduler by design**; the staleness pass is a host-level job.

## The job

```
bun scripts/co-newbiz/rag.ts --stale [--db-path <path>]
```

Walks every project and calls `recomputeRag(..., "stale_read")`. It is idempotent: an unchanged input set (stage gate, S1 data-confidence grade, carried dimension grades, IRR margin) writes nothing and reports `unchanged`. Output is JSON, one entry per project (`assessed | unchanged | nothing_to_assess | error`). The run is attributed to `cli:watch-cycle` (a label, not an account — agents have no accounts).

## Suggested cadence

Daily (e.g. 06:00 local) via launchd (macOS) or a systemd timer. Hysteresis holds a grade at least 7 days, so a more frequent cadence adds no information.

## Acceptance

1. Run once manually against a copy of the database; confirm no `error` entries.
2. Run twice; the second run reports only `unchanged`/`nothing_to_assess`.
3. Confirm no `gate_decision`, `approval`, or `venture_transition_decision` row was written (the job proposes grades only).

## Boundaries

The grade is a proposal. Data confidence caps it (an unverified LLM estimate never reads Green; a two-statistical-hop chain reads Red). An incomplete assessment produces no overall grade and the UI shows "not graded".
