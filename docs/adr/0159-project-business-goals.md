# ADR-0159 — Project-level business goals above group/affiliate standards

- Status: Accepted
- Date: 2026-10-11
- Deciders: Accepted by the user (account techcross, chat, 2026-10-12). Drafted by platform-lead. AI review alone cannot accept this ADR (DB schema change).
- Design of record: `docs/designs/2026-10-11-s8-project-business-goals-design.md`
- Related: ADR-0114 (business-target standards, reference-only fs evidence), ADR-0146 (admin role vs business content), ADR-0154 (human-only actions), ADR-0158 (human-only S8 route precedent), ADR-0061 (money units), ADR-0014 (additive-only migrations)

## Context

Business-target standards (`md_business_target`, migration 0082, ADR-0114) exist only at group and affiliate level and are written only by the `admin` role through `app/api/admin/business-targets` (`requireAdmin`). ADR-0146 bars `admin` from deal content and no business role can write standards, so no one can set a goal for a specific deal. On greenfield project `01M1MXQN21DP8KYHNW3GDSE4PW` the scope resolved but no standards existed, and three scenarios were compared and one adopted with no goals. The user chose option C: analysts set project-level goals in S8 before comparing scenarios.

## Decision

1. **New table `project_business_goal`** via additive migration `0135_project_business_goal.sql`: project-scoped goal rows using the same metric keys, directions and stored units as `METRIC_PRESETS` (custom metrics by label), with mandatory `rationale`, optional `source_note`, `created_by/created_at`, append-only versioning (`supersedes_id`, `superseded_at`, `superseded_by`) and soft delete (`retired_at/by/reason`). One active row per project + metric + label (partial unique index). `md_business_target` is not changed.
2. **Resolution order** per metric: project > affiliate > group. Target-check and fs-gate evidence report each entry's source (`project | affiliate | group`) and which standards it shadowed.
3. **Authority.** Analyst+ write goals only through the new human-only route `POST /api/projects/{id}/business-goals` (actions create / supersede / retire; cookie session with CSRF; registered in `HUMAN_ONLY_ROUTES` and the MCP coverage exclusions). Viewers read only; admin has no access (ADR-0146, via `visibleProject`). Every write appends an audit entry. Agents read goals through `get_target_check` and cannot write them.
4. **Boundary unchanged (ADR-0114).** Goals are reference evidence. A missed goal never blocks a gate, never changes RAG automatically and never re-ranks scenarios; recommendations remain proposals; a human decides.
5. **Adoption without goals** requires an explicit acknowledgement (confirmation, not a block), stored in the existing `s8_case_adopt` `process_run.meta_json` — no schema change for this part.

## Alternatives considered

- **Nullable `project_id` on `md_business_target`.** Rejected: the table is admin master data (`group_id NOT NULL`, admin-only route); mixing deal rows risks exposing deal content to admin (ADR-0146), its update-in-place model conflicts with append-only judged history, and it lacks rationale/source fields.
- **Store goals as `assumption` rows (ev-band pattern).** Rejected: goals need per-metric versions, retire semantics and an active-uniqueness constraint that the assumption store does not enforce.
- **Let analysts write `md_business_target`.** Rejected: changes ADR-0114/0146 authority for shared standards across all deals.

## Consequences

- Positive: goals can be set where scenarios are compared; evidence shows provenance and shadowing; full history.
- Negative: two goal sources to explain in the UI (mitigated by source badges and shadowed notes); `TargetCheckEntry`/target-check response widens (additive; `overridden_note` kept one release).
- Rollback: revert code; `DROP TABLE project_business_goal` and its two indexes. No backfill in either direction.

## Open questions

See the design doc: computable NPV p05 / payback presets, an agent proposal type for goals, behaviour when goals change after adoption, analyst+ vs lead-only.
