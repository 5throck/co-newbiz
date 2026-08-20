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
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: commercial-dd-agent
prerequisites: none
metadata:
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

## Output Format

- Interview writeup with source count/independence noted per claim,
  triangulation status, `assumed`-vs-`derived` tagging applied correctly downstream

## Related Skills

- `commercial-due-diligence`, `technical-due-diligence` — the DD processes this evidence typically feeds
- `assumption-audit` — where the `assumed`/`derived` tagging discipline is enforced
