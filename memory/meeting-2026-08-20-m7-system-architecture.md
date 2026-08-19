# Meeting M7: System Architecture & Operating Model

**Date**: 2026-08-20
**Facilitator**: platform-lead
**Participants**: platform-lead, backend-engineer, frontend-engineer, dba, sre, security-engineer
**Objective**: Fix DB/API/MCP boundaries, operating rhythm ownership, security baseline scope, and deploy/rollback approach at an implementable level of detail.

---

## Agenda
1. DB/API/MCP boundary — confirm nobody bypasses the layering
2. Operating rhythm — who owns which cadence item
3. Security baseline scope for Stage 4/5
4. Deploy/rollback — concrete mechanics

## Discussion

**platform-lead**: The design already fixes MCP→REST→DB layering (never MCP→DB direct). I want to confirm nobody has a reason to violate it in practice before we build against it.

**backend-engineer**: No reason to violate it — the CLI (`newbiz.ts`) and the MCP server both go through the same repository layer as the web API, so there's exactly one code path with permission/audit enforcement. The one thing I need clarified: does the CLI, run by a human operator locally, also go through project_member checks, or is it trusted as an operator tool?

**security-engineer**: CLI must still resolve to a specific `project_member` context (via an operator's own account, or an explicit `--as-user` flag that's itself audit-logged) — "it's a local CLI" is not an exemption from need-to-know. Otherwise the CLI becomes exactly the kind of privileged bypass path the design explicitly forbids for agents.

**backend-engineer**: Understood, I'll implement CLI auth against the same session/token model, not a separate trusted-operator mode.

**dba**: Operating rhythm ownership, concretely: daily health-check + backup-success confirmation is mine; weekly capacity/perf review is mine; monthly recovery drill is mine and I want it calendared as a real recurring task, not a design-doc aspiration — first drill scheduled for one month after Stage 5 go-live.

**sre**: Daily fetch-failure triage and alerting pipeline is mine; incident response and post-incident analysis is mine. I want alert cooldown/hysteresis parameters fixed now rather than left to "whatever the code defaults to": cooldown = 24h per (project, trigger_type) pair, hysteresis mirrors the RAG hysteresis from M3 (7-day minimum hold before re-alerting on a re-crossed threshold).

**frontend-engineer**: For the RAG dashboard and admin console, I need the M3 threshold numbers and M6 site-scoring weights as concrete inputs to build against — noting those are now fixed from this session, which unblocks my UI spec work.

**security-engineer**: Security baseline for Stage 4/5: threat model draft due at Stage 4 (not deferred to Stage 5), covering agent-impersonation (the inherited-permission boundary), MNPI leakage via MCP, and SSRF on every external fetch. `security-scan`/`stride-threat-matrix` run at the end of Stage 4 as a pre-build gate, not just at Stage 5 verification.

**platform-lead**: On deploy/rollback — concrete mechanics: every migration is tagged reversible or not at write time (not inferred later), backup runs immediately before any migration, and release-engineer rehearses rollback on the reversible-tagged migrations at least once per release. Irreversible migrations get an extra release-engineer + dba joint sign-off before shipping.

## Decisions

| # | Decision |
|---|---|
| D-M7-1 | CLI auth resolves to a real `project_member` context (operator account or audited `--as-user`) — no trusted-operator exemption from need-to-know |
| D-M7-2 | Operating rhythm ownership fixed: dba=daily backup/weekly capacity/monthly drill; sre=daily fetch-triage/alerting/incident response |
| D-M7-3 | Alert cooldown = 24h per (project, trigger_type); hysteresis mirrors M3's 7-day RAG hold |
| D-M7-4 | Security threat model due at Stage 4 (not Stage 5); scans run as a pre-build gate at end of Stage 4 |
| D-M7-5 | Migrations tagged reversible/irreversible at write time; irreversible migrations require release-engineer + dba joint sign-off |

## Action Items

| # | Action | Owner | Landing | Status |
|---|---|---|---|---|
| A-1 | Implement CLI auth against session/token model, no separate trusted mode | backend-engineer | Stage 5.2 | Pending |
| A-2 | Calendar first recovery drill for one month post-Stage-5-go-live | dba | Stage 5.9 ops handoff | Pending |
| A-3 | Draft threat model at Stage 4, not deferred | security-engineer | Stage 4.5 | Pending |
| A-4 | Build RAG dashboard and site-comparison UI against M3/M6 fixed numbers | frontend-engineer | Stage 4.4/5.6 | Pending |

## Open Issues
None new.
