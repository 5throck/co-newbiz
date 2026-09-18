# ADR-0142: company-competitor-human-confirmation

**Status**: Accepted
**Date**: 2026-09-18
**Deciders**: workspace owner (user direction, 2026-09-18)

## Context

ADR-0089 introduced the group/affiliate company-profile surface as a non-stage
activity with no approval semantics, and the profile pipeline
(`lib/company-profile-pipeline.ts`) writes its LLM output — including the
`competitive.competitors` list — straight into the append-only
`company_profile_version` payload. A 2026-09-18 user review flagged that
AI-proposed competitors thereby become the de-facto record with no human
selection step, while the workspace boundary (ADR-0094 #2, CONSTITUTION
non-negotiables) says LLM output is decision support and the record is a
person's action. The payload itself must stay an immutable analysis artifact
(ADR-0132 protected reruns), so the fix cannot be "edit the payload".

## Decision

Confirmed competitors are a first-class registry (`company_competitor`) that
only a person's action can create or change: an AI proposal is accepted, or a
competitor is registered manually. The profile payload keeps its LLM-generated
competitor list unchanged and loses record status — it is proposal input.
Accepting a proposal snapshots the cross-check verdict and evidence onto the
registry row.

## Consequences

- The `/our-company` competitive tab becomes a three-section surface
  (confirmed registry / AI proposals / manual form) instead of a read-only
  render of the payload (`docs/designs/2026-09-18-company-competitor-registry-design.md`).
- Consumers of the competitor list (brownfield technical-draft evidence,
  target-detail profile) switch to registry-first reads with an explicit
  unconfirmed fallback marker, so payload-only data is never presented as
  confirmed.
- The cross-check claim-prefix coupling (`"경쟁사 {name}:"`) stops being
  load-bearing for the record: verdicts are copied onto the row at accept time.
- Re-analysis no longer mutates anyone's competitor record; it refreshes the
  proposal list.
- Requires the `company_competitor` table (migration 0112) and audit actions
  `competitor.{accept,register,update,exclude,restore}`.
