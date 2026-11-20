---
name: meeting-facilitation
status: active
scope: common
description: >
  Facilitates structured multi-agent meetings for collaborative decision-making and
  problem resolution. Use when: running agent meetings, coordinating multi-agent
  discussions, or facilitating collaborative problem-solving sessions.
owner: pm
version: 1.6.0
last_reviewed: 2026-11-21
prerequisites: []
metadata:
  type: process
  triggers:
    - meeting
    - agent discussion
    - collaborative decision
    - multi-agent coordination
    - facilitate meeting
  # LOCAL-PATCH(co-newbiz): project procedure edges (PR #846, ADR-0196) — re-add if a template delivery drops them
  procedure_keys:
    - entity-ic-review
    - group-investment-review
---

## Context

This skill defines the multi-agent meeting facilitation flow. It is self-contained: the
skill body below is the specification the PM follows when orchestrating a meeting. The
legacy `/meeting` slash command was retired on 2026-09-26 — invoke this skill directly
by name.

## When to Use

Invoke this skill when the user requests:
- A structured multi-agent discussion on a named topic
- Facilitating collaborative decision-making across specialist agents
- Coordinating agent discussions for design reviews, problem-solving, or planning

## Execution Steps

<!-- LOCAL-PATCH(upstream-request: U-20261121-001) -->
The default meeting is turn-based (dialogue form, ADR-0204): participants take short turns
in sequence and each turn answers the transcript so far. The PM facilitates and votes nothing.

1. **Agenda**: state the topic and 2-5 issues. For each issue, select 3-5 relevant
   participants and give a one-line reason per seat. The dissent / red-team seat is always
   included (Governance Rule 1).
2. **Discussion, per issue**: speakers alternate; each turn is one short move (propose,
   ask, answer, rebut, concede, amend).
   - After a proposal, the next speaker challenges it (ask or rebut).
   - Address peers by display name, never by agent key.
   - Each participant amends at most once per issue, unless answering a question.
   - Do not repeat boilerplate disclaimers.
   - A non-participant may request the floor once per issue; the facilitator grants or
     declines and records the decision.
3. **Consensus, per issue**: the chair proposes; only participants vote (accept / reserve).
   Record non-participants as "not participating" - never count them as agreement. Close
   the issue with the outcome and the tally.
4. **Progress**: report `issue i/n · speaker · turns used/budget` while the meeting runs.
   The turn budget is 3 × participants per issue (max 12).
5. **Resume**: resume an interrupted meeting from the issue where it stopped, never from
   the start. The minutes state the number of sittings.
6. **Outcome synthesis and logging**: the PM synthesizes agreements, open items, and a
   proposed recommendation, then writes `memory/meeting-YYYY-MM-DD-[slug].md`.

## Output Format

Minutes written to `memory/meeting-YYYY-MM-DD-[slug].md`, in order:
- Header: date, topic, chair, number of sittings (when more than one)
- Body, one short section per issue:
  - Attendees on one comma-separated line
  - Verbatim key exchanges ("seat: utterance")
  - Consensus proposal
  - Outcome and tally, including who was not participating
  - Per-seat recommendation
  - Dissent, transcribed VERBATIM - never summarized or averaged (Governance Rule 3)
- Open items, with owner assignments for action items
- Proposed recommendation, explicitly labelled a PROPOSAL for the user's approval - never
  a decision or PASS stamp (Governance Rule 2)
- Appendix A: the full turn transcript, in order
- Appendix B: interrupted attempts, if any

## Governance Rules

All meetings facilitated through this skill MUST uphold three invariants:
1. **Dissent seat**: at least one participant is designated as a red-team / dissenting role whose duty is to challenge the emerging consensus.
2. **PROPOSAL, never decision**: the synthesized outcome is a proposal for the user's approval — the meeting itself does not decide.
3. **Dissent preserved verbatim**: recorded disagreements are transcribed as stated — never summarized away or averaged into consensus.

## Related Skills

- `project-review` — uses meeting-facilitation for Gemini CLI parallel dispatch
- `team-builder` — may invoke meetings during team assembly (Phase 0)
