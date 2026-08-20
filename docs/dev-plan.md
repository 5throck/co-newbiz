# Development Plan — co-newbiz Stage 5

**Owner**: pm, platform-lead
**Design of record**: design v1.0 §10 Stage 5 wave table (task 4.6), `docs/srs.md`, `docs/traceability-matrix.md`
**Status**: Stage 4 draft — sprint/PR boundary plan for Stage 5's system build. No code written yet.

## 1. Wave Structure (from Design §10, Confirmed Unchanged)

Wave 5.1 is a hard precondition for 5.2-5.7 (serial); 5.2's four sub-tracks run in parallel; 5.8 (skills) runs parallel across the whole span. **Minimum one PR per wave** — parallel branches conflict by default under the workspace's shared-pipeline-file rule (CONSTITUTION.md §3.3), so wave boundaries are also PR boundaries, not just planning labels.

| Wave | Scope | Depends On | Parallel-Safe With |
|---|---|---|---|
| 5.1 | DB — migrations, master data, repository layer | None (first) | — |
| 5.2a | CLI + fetcher (SSRF-guarded) + statute/regulation collection + `proc:resolve` + `glossary:lint` | 5.1 | 5.2b, 5.2c, 5.2d |
| 5.2b | Financial pipeline (ported from co-consult) + peer/growth-projection | 5.1 | 5.2a, 5.2c, 5.2d |
| 5.2c | Proxy-chain / value-chain-linkage / simulation / attribution Python | 5.1 | 5.2a, 5.2b, 5.2d |
| 5.2d | Document renderer (docx/pdf/hwpx) + glossary-appendix generator | 5.1 | 5.2a, 5.2b, 5.2c |
| 5.3 | RAG engine + approval-chain engine + compliance/waiver/interpretation engine | 5.1, 5.2a | — |
| 5.4 | Monitoring/auto-reanalysis + OS-level scheduler registration | 5.1, 5.3 | — |
| 5.5 | Auth/account/session + **information-protection tables (§9 of `docs/db-schema.md`)** | 5.1 | — |
| 5.6 | Hono API (`docs/api-spec.md`) + React SPA (`docs/ui-spec.md`) + admin console | 5.1-5.5 | — |
| 5.7 | OpenAPI + MCP server (`docs/mcp-integration.md`) | 5.6 | — |
| 5.8 | Skills — reused (16) + new (per design §5) | Any (parallel throughout) | Everything |
| 5.9 | Deployment pipeline, runbooks, security-baseline execution | 5.1-5.7 | — |
| 5.10 | System pilot — re-run the Stage 3 manual-pilot case(s) through the built system, compare results | 5.1-5.9 complete | — |

## 2. PR Boundary Rules

- A wave's PR is not opened until its dependency waves are merged — no speculative branching ahead of a blocking dependency.
- 5.5 (information protection) is **never split across multiple PRs mid-implementation** — a partially-implemented access-control layer is worse than none, since it creates a false sense of coverage. It lands as one reviewed, tested unit.
- 5.6 (API+UI+admin) may split into sub-PRs by API domain (matching `docs/api-spec.md`'s §2-8 sections) once 5.1-5.5 are stable, but every sub-PR must pass the full `docs/security-model.md` §7 verification checklist, not a partial subset.

## 3. Acceptance Criteria Per Wave (Summary — Full Detail in `docs/traceability-matrix.md`)

| Wave | Must Pass Before Merge |
|---|---|
| 5.1 | `db:export --dialect postgres` diffed clean against ADR-0002 portability constraints; all §2-10 tables in `docs/db-schema.md` migrated |
| 5.2a-d | Design §12's crankshaft-scenario E2E steps 1-13 (fetch idempotency, revision preservation, staging_unmapped quarantine, KPI/driver-tree, base-rate warning, calibration, conversion with error bands, seeded simulation) |
| 5.3 | Design §12 verification item 14 (chain grade C caps overall at Amber regardless of financial strength) + all Must-priority FR-RAG/FR-GOV rows in `docs/traceability-matrix.md` |
| 5.4 | Design §12 item 17 (watch → auto-run → RAG transition → notification, with cooldown suppressing duplicate sends) |
| 5.5 | `docs/security-model.md` §7's full 8-point verification list — every point, no partial pass |
| 5.6 | `accessibility-audit` clean; every FR-SYS row in `docs/traceability-matrix.md` §8 |
| 5.7 | `docs/mcp-integration.md` §7's verification list — including at least one successful real call from 3 distinct AI clients |
| 5.8 | `skill-lifecycle-audit.ts` clean for every new/reused skill |
| 5.9 | One real rollback rehearsed on a reversible-tagged migration; one real recovery drill executed and logged |
| 5.10 | System-vs-manual-pilot result comparison documented — a discrepancy is investigated as a defect in one or the other, never left unexplained |

## 4. Relationship to the Pilot Set

Stage 5's 5.10 system pilot re-runs Stage 3's real cases (`docs/pilots/pilot-001` through the latest) through the built system. This is a **regression-and-validation double-check**, not a new source of test cases — the fourteen real cases already walked manually are the fixture set; 5.10's job is confirming the system reproduces the same conclusions the manual walkthroughs reached, not discovering new findings. If the system and the manual pilot disagree on a case, that is treated as a defect requiring root-cause resolution before Stage 5 is considered complete (design §5.10's own stated principle).

## 5. Explicit Non-Goals for Stage 5 (Tier 2/3 per `docs/srs.md` §14)

Web UI polish beyond WCAG AA compliance, multi-language UI, governance-KPI dashboard, region profiles beyond the KR/EU/US/CN/SEA initial drafts, and simulation sophistication beyond the base Monte Carlo are explicitly out of Stage 5's Must-priority scope — tracked as follow-on release candidates, not silently dropped.

## 6. Related

- `docs/srs.md`, `docs/traceability-matrix.md` — the requirement source this plan sequences
- `docs/db-schema.md`, `docs/api-spec.md`, `docs/ui-spec.md`, `docs/mcp-integration.md`, `docs/security-model.md` — the Stage 4 specs each wave implements
- `docs/pilots/` — the real-case fixture set for wave 5.10
