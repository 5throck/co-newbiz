---
name: partner-due-diligence
scope: co-newbiz
description: >
  Screens candidate partners on compliance (sanctions, anti-corruption
  history — not optional, since a partner's exposure transfers to us),
  financial stability/capacity, and dependency risk including the risk the
  partner becomes a competitor after technology transfer. Mandatory
  Partnership DD validators (`checklists/partnership-checklist.yaml`
  pt-02/pt-03/pt-04).

  Use when: "partner due diligence", "partner compliance screening",
  "sanctions screening for a partner", "post-transfer competitor risk".
version: 1.1.0
last_reviewed: 2026-08-20
status: active
owner: partnership-agent
prerequisites:
  - partner-sourcing-strategy
metadata:
  type: domain
  procedure_keys:
    - deal-shape-chain
  triggers:
    - partner due diligence
    - partner compliance screening
    - sanctions screening for a partner
    - post-transfer competitor risk
---

## Context

Compliance screening is mandatory, not a nice-to-have, because a partner's
exposure transfers to the deal — a partner with sanctions or anti-corruption
history is not just a reputational concern, it is a direct legal and
financial exposure to the party entering the relationship (pt-02).
Dependency risk assessment (pt-04) has a specific, easy-to-miss failure
mode: a partner who receives technology or know-how transfer during the
relationship may be capable of competing independently once that transfer
is complete, even if the current relationship looks purely complementary.

## When to Use

- Every shortlisted partner candidate, before term-sheet negotiation
- Any partnership involving technology or know-how transfer to the partner

## Execution Steps

1. **Compliance screening** — sanctions lists, anti-corruption history —
   for every shortlisted candidate, no exceptions regardless of how
   strategically attractive a candidate looks otherwise (pt-02)
2. **Financial stability and capacity scoring** — record per candidate with
   evidence references, not a qualitative impression (pt-03)
3. **Dependency risk assessment** (pt-04):
   - What does the deal depend on the partner for, and how hard would it be
     to replace them?
   - **Post-transfer competitor risk**: if technology/know-how transfers to
     the partner during the relationship, assess whether they would then
     have what they need to compete independently — this risk exists even
     in an otherwise well-aligned partnership
4. **Rank candidates** against `partner-sourcing-strategy`'s sourcing
   criteria, with compliance findings treated as a gate (a compliance
   failure excludes a candidate regardless of financial/capability strength),
   not one input among several to be averaged

## Output Format

- Per-candidate DD record: compliance screen result, financial
  stability/capacity score with evidence, dependency-risk assessment
  including post-transfer competitor exposure

## Related Skills

- `partner-sourcing-strategy` — the sourcing criteria this DD screens against
- `jv-structuring` — where a selected partner's terms get formalized
