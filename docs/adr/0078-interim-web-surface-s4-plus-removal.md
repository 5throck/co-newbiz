# ADR-0078: Interim web surface — S4+ features removed pending the v2.0.0 workflow rebuild

**Status**: Accepted — removal executed 2026-08-31
**Date**: 2026-08-31
**Deciders**: user (standing directive), frontend-engineer (execution), pm (process owner)
**Design of record**: `app/web-next` working tree; process definition per ADR-0076

## Context

flow.spec v2.0.0 (ADR-0076) redefined everything after S4 (Route Decision): the old linear
S5–S8 web workflow (deal workspace, workflow tabs, business case panels, target lists, IC
chain) no longer matches any stage of the new spec — Greenfield now has a capability-assessment
stage (S5) and Brownfield has Target Identification (S6) and Target Screening (S7) stages that
never existed in the UI. The user directive was explicit: remove the mismatched S4–S7 features
entirely rather than half-migrate them; the web will be rebuilt against the v2 spec.

## Decision

1. **Removed from the web app** (pages, API routes, and their exclusive components):
   - `/projects` (deal list + detail workspace) and `app/api/projects/**` (≈45 routes: DD
     workspaces, gate decisions, business case, targets, approval chains, agent-run, …)
   - `/reports`, `/profitability`, `/portfolio-scorecard` and their APIs (project-scoped S7/S8
     features)
   - opportunity promotion (`promote`) and route-decision APIs (S4 gateway features)
   - admin watch-rule form (project-ID registration) and orphaned routes
     (`/api/runs`, `/api/simulations`, `/api/assumptions`, `/api/watch`)
   - components exclusive to the removed surfaces (WorkflowTab, WorkflowSidebar, StageLights,
     BusinessCasePanel, ProcessHeader, StageNav, 13 tab components, NotificationBell)
2. **Kept and adjusted**:
   - `lib/process-flow.ts` truncated to the opportunity lifecycle S1–S3 (evaluation engine
     only); `lib/agent-orchestrator.ts` kept as-is (reads the spec at runtime with no stage
     hardcoding — reused unchanged by the rebuild)
   - dashboard rebuilt around the S1–S3 opportunity funnel (counts, funnel chart, recent
     opportunities) replacing the project-KPI dashboard
   - library page simplified to document browsing (deal-bound checklist assessment returns
     with the rebuild)
   - `/process/[stage]` serves S1–S3 only; S2's selected-opportunity cards state that the
     next step is pending rebuild
3. **Preserved for the rebuild (no DB changes)**: `md_project`, `project_company` (candidate =
   Long List, target = Short List), `screening_longlist`, `route_decision`, `gate_decision`,
   `opportunity.project_id`, and `lib/api.ts` client helpers for removed endpoints (dead code,
   to be replaced during the rebuild).

## Consequences

- **Positive**: no UI lies about the process — everything visible matches the current spec;
  the S1–S3 surfaces (market → opportunities → synergy) are fully functional; the rebuild
  starts from a clean, spec-aligned slate with the DB intact.
- **Accepted loss (temporary)**: existing project records are invisible in the web (data is
  intact in SQLite and reachable via MCP/REST should it be needed); deal reporting and
  portfolio scorecard are unavailable until the rebuild.
- **Rebuild contract**: the new S4+ workflow must render from the v2 spec (track-aware stage
  list, `target_screening` gate surfaces, per-track panels for S5 vs S6/S7) per ADR-0074's
  no-hardcoding principle; this ADR is the acceptance baseline for that work.
