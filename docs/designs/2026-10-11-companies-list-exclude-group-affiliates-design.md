# Companies List: Exclude Group and Affiliate Companies - Design

- **Date**: 2026-10-11
- **Status**: implemented (Design Gate Row 0, user decision; shipped in PR #509, registry flipped per T-20261029-002)
- **Owner**: backend-engineer
- **ADR**: none required (read-only query filter; no schema, auth, or MCP scope change)

## Problem

/companies lists every md_company row, including the group's own affiliates (which are managed on
/our-company) and the internal synergy-registry sentinel row. The screen is meant for acquisition targets
and analysis-base companies.

## Decision

GET /api/companies gains an optional query parameter scope=targets. With it, rows are excluded when:

1. a non-deleted company_group_member (deleted_at IS NULL) matches by DART code (both non-empty and equal),
   or, when the md_company row has no DART code, by exact trimmed name equality with company_name;
2. the row is the sentinel md-synergy-registry-sentinel (migration 0060).

company_group_member and md_company have no foreign key, hence the matching rule. A same-name company with
a different non-null DART code is kept. Without the parameter the response is unchanged, so the project
financial-analysis connect-search keeps seeing every company. The /companies page passes scope=targets and
shows a note linking to /our-company. No data is modified.
