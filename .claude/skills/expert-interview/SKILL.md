---
name: expert-interview
scope: co-newbiz
description: >
  Conducts external expert interviews per `guidelines/expert-interview-conduct.md`:
  compliance clearance before contact, triangulation as the actual target
  (2-3 independent sources for any material claim, not optional polish),
  disconfirming questions structured explicitly (not just validating the
  deal thesis), and source count/independence recorded so a reviewer can
  see triangulation strength at a glance.

  Use when: "expert interview", "expert network call", "source
  triangulation", "disconfirming questions".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: commercial-dd-agent
prerequisites: none
metadata:
  procedure_keys:
    - brownfield-dd
  type: process
  triggers:
    - expert interview
    - expert network call
    - source triangulation
    - disconfirming questions
---

## Context

`guidelines/expert-interview-conduct.md` (recommended layer — deviation
requires a stated reason, not a blocked gate) sets one hard-edged rule
inside a recommended-enforceability document: an untriangulated claim
feeding a valuation assumption is tagged `assumed` with the limitation
noted in `rationale`, never `derived` — the guideline's flexibility is
about interview *practice*, not about silently upgrading confidence in a
single-source claim.

## When to Use

- Commercial DD, technical DD, or any deal review requiring external expert input

## Execution Steps

1. **Compliance clearance before contact**: confirm no NDA/MNPI conflict,
   and confirm the expert isn't a current competitor employee without
   documented compliance sign-off
2. **Plan for triangulation from the start**: identify 2-3 independent
   sources for each material claim before treating any single interview as
   confirmatory — triangulation is the target, not optional polish
3. **Structure disconfirming questions explicitly**: alongside questions
   that would validate the deal thesis, ask questions specifically designed
   to surface reasons the thesis might be wrong — an interview set that
   only validates produces confirmation bias, not diligence
4. **Record source count and independence explicitly** in the writeup —
   readable at a glance, not something a reviewer has to infer from prose
5. **If fewer than 2 independent sources exist for a material claim**:
   state that explicitly in the finding. This is not a Kill Criteria, but
   the claim's downstream assumption is tagged `assumed` with the
   limitation in `rationale`, never `derived` — the confidence label must
   match the actual evidentiary strength
6. **Run structured elicitation, not a conversation** (v1.1.0 — SHELF /
   Stanford-SRI protocol discipline per
   `docs/research/readiness-gap-best-practice.md` Area 3): (a) frame the
   question set BEFORE the interview (what quantity, over what period,
   under what definition); (b) pin the probability vocabulary — unpinned
   words like "likely" mean different things to different people and are
   not usable as recorded evidence; (c) elicit ranges/quantiles, not point
   answers, and record the uncertainty; (d) where multiple experts are
   interviewed, aggregate explicitly (which experts, how combined) rather
   than quoting the most quotable one
7. **Reference this protocol from the R&BD evidence rows**: when a
   checklist item in `checklists/rbd-technology-checklist.yaml` calls for
   expert-based validation evidence, the writeup cites which protocol
   elements above were applied — "we asked an expert" is not a validation
   evidence row

## Output Format

- Interview writeup with source count/independence noted per claim,
  triangulation status, `assumed`-vs-`derived` tagging applied correctly downstream
- Elicitation record: pre-framed question set · pinned vocabulary used ·
  ranges/quantiles with uncertainty · expert aggregation method

## Related Skills

- `commercial-due-diligence`, `technical-due-diligence` — the DD processes this evidence typically feeds
- `assumption-audit` — where the `assumed`/`derived` tagging discipline is enforced
