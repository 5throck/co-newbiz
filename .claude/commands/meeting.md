---
name: meeting-facilitation
status: active
scope: co-newbiz
description: >
  Facilitates structured multi-agent meetings using the /meeting command for collaborative
  decision-making and problem resolution. Use when: running agent meetings, coordinating
  multi-agent discussions, or facilitating collaborative problem-solving sessions.
owner: pm
version: 1.5.0
last_reviewed: 2026-09-03
prerequisites: []
metadata:
  type: process
  triggers:
    - meeting
    - agent discussion
    - collaborative decision
    - multi-agent coordination
    - facilitate meeting
---

## Context

Structured multi-agent deliberation runs on the ONE deliberation engine:
`runDeliberationRounds()` in `app/web-next/lib/agent-orchestrator.ts`
(ADR-0096), with the pluggable member executor
`app/web-next/lib/committee-agents.ts`. The steering committee (ADR-0097)
and this skill are two consumers of the same engine — they differ only in
committee membership and output destination. Procedure authority is
unchanged: this skill references the engine; it does not restate any
procedure's gate steps.

## When to Use

Invoke this skill when the user requests:
- `/meeting "topic"` — structured multi-agent deliberation
- Facilitating collaborative decision-making across specialist agents
- Coordinating agent discussions for design reviews, problem-solving, or planning

## Execution

The `/meeting` command (`.claude/commands/meeting.md`, mirrored at
`.gemini/commands/meeting.md`) drives:

```bash
bun scripts/co-newbiz/meeting.ts "<topic>" [--agents a,b] [--rounds N] [--dialogue]
```

Ad-hoc meetings must include `risk-officer` — the mandatory red-team seat
(ADR-0097 §2). Round 2+ members receive every other member's prior-round
position verbatim (the engine's rebuttal rule).

## Output Format

Meeting transcript written to `memory/meeting-YYYY-MM-DD-[slug].md` containing:
- Agenda and objectives
- Per-agent contributions (round-by-round)
- Synthesized outcome — a PROPOSAL, never a decision (design boundary #2)
- Dissent preserved verbatim (never summarized or averaged)

## Related Skills

- `project-review` — uses meeting-facilitation for Gemini CLI parallel dispatch
- `team-builder` — may invoke meetings during team assembly (Phase 0)
