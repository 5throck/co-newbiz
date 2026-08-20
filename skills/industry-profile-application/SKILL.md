---
name: industry-profile-application
scope: co-newbiz
description: >
  Applies industry-specific profile data (ADR-0024's profile-first
  principle: one `industry-lead` agent, coverage expressed as
  `industry-profiles/*.yaml`, a dedicated agent warranted only past a
  5-judgment-heavy-procedure maturity threshold) to a project's target
  industry. As of this skill's authoring, `industry-profiles/*.yaml`
  itself has not yet been created — this is a real, explicitly flagged gap,
  not a claim of existing coverage.

  Use when: "apply the industry profile", "industry-specific review",
  "industry profile gap".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: industry-lead
prerequisites: none
metadata:
  type: domain
  triggers:
    - apply the industry profile
    - industry-specific review
    - industry profile gap
---

## Context

**Adaptation note**: unlike `region-profiles/` (5 profiles already exist:
KR, EU, US, CN, SEA, each with a validated schema and `_validate.ts`), no
`industry-profiles/*.yaml` files exist yet in this repo as of Wave 5.8. The
design principle (ADR-0024) is clear — industry coverage scales via profile
count under one `industry-lead` agent, the same pattern as region — but the
actual profile data has not been authored. This skill describes the intended
application discipline for when profiles exist; until then, industry-specific
analysis draws on `industry-lead`'s direct research per project rather than a
reusable profile file, and that gap should be named explicitly rather than
silently worked around.

## When to Use

- A project's target industry needs industry-specific review content applied
- Deciding whether a specific industry has accumulated enough
  judgment-heavy procedures to warrant its own profile (or, per ADR-0024's
  higher bar, its own dedicated agent)

## Execution Steps

1. **Check whether an industry profile exists** for the target industry —
   today, none do; this step itself is the gap-detection mechanism
2. **If a profile exists** (future state): load it, apply its
   industry-specific fields (analogous in spirit to region-profiles' axes —
   likely candidates include typical margin/capex benchmarks, standard
   proxy-chain relationships, common certification requirements, typical
   deal-structure patterns) to the project at hand, following the same
   provenance discipline as `region-profile-application` (source,
   verified_on, maintainer per section)
3. **If no profile exists** (current state): `industry-lead` conducts the
   research directly for this project, and separately flags whether this
   industry has now accumulated enough recurring judgment-heavy procedures
   to justify authoring a profile — this is the ADR-0024 accumulation
   signal, not a decision to make casually per project
4. **Never claim profile-backed coverage that doesn't exist** — cite the
   actual research conducted for this project, not a nonexistent profile file

## Output Format

- Industry-specific review findings for the current project, with an
  explicit note on profile-file status (exists / does not yet exist)
- Where applicable, a signal to `process-governance-manager` that this
  industry may warrant profile authoring

## Related Skills

- `region-profile-application` — the parallel, actually-implemented region-side discipline this mirrors
- `proxy-industry-chain` — a downstream consumer of industry-specific structural knowledge
