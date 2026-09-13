---
name: committee-deliberation
status: active
scope: co-newbiz
description: >
  Runs structured multi-round committee deliberation for gate reviews and design
  vetting via the ADR-0096 deliberation engine CLI (steering committee, ADR-0097).
  Use when: convening the steering committee, gate deliberation (Screening through
  Group IC), or recorded red-team design reviews.
owner: pm
version: 1.6.0
last_reviewed: 2026-09-13
prerequisites: []
metadata:
  type: process
  triggers:
    - committee
    - committee-deliberation
    - steering committee
    - gate deliberation
    - red-team review
---

## Context

Structured committee deliberation runs on the dedicated deliberation engine
`runDeliberationRounds()` in `app/web-next/lib/deliberation.ts` (ADR-0096),
with the pluggable member executor `app/web-next/lib/committee-agents.ts`
(deterministic by default; LLM-backed seats register via `committee-llm.ts`
when `CO_NEWBIZ_COMMITTEE_AGENTS=llm` and the LLM client is configured).
The steering committee (ADR-0097) is the primary consumer; the CLI
`scripts/co-newbiz/committee-deliberation.ts` drives ad-hoc committee-style
runs.

Committee deliberation is engine-run and DB-recorded (process_run /
agent_position / gate_evaluation) and gate-oriented. Procedure authority is
unchanged: this skill references the engine; it does not restate any
procedure's gate steps.

## When to Use

- Gate deliberation for stage gates (screening, pre_fs, fs, dd, entity_ic, group_ic)
- Steering committee convening (ADR-0097)
- Recorded design vetting that must leave an auditable position trail

## Execution

```bash
bun scripts/co-newbiz/committee-deliberation.ts "<topic>" [--agents a,b] [--rounds N] [--dialogue]
```

- `--agents` member keys (default: industry-lead,region-lead,
  market-intelligence-agent,risk-officer). Ad-hoc deliberations MUST include
  `risk-officer` — the mandatory red-team seat (ADR-0097 §2).
- `--rounds` default 2; round 2+ members receive every other member's
  prior-round position verbatim (the engine's rebuttal rule).

## Output Format

Transcript written to `memory/committee-YYYY-MM-DD-[slug].md`:
- Agenda and objectives
- Per-agent contributions (round-by-round)
- Synthesized outcome — a PROPOSAL, never a decision (design boundary #2)
- Dissent preserved verbatim (never summarized or averaged)

## Related Skills

- `stage-gate-governance` — gate mechanics the deliberation feeds
