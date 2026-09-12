# Quality Review (all-agent scoring) — Construction Plan M6 Minutes

- **Date**: 2026-09-12 · **Chair**: PM · **Participants**: all 41 agents (per-charter scoring)
- **Material**: running site (main @ 23dd931 + smoke test), 4 journeys walked with an authenticated analyst session, evidence vs frozen baseline-v5 previews.
- **Journeys**: ① empty/first deal ② brownfield S1→promotion ③ project S8→S12 gates ④ admin + external share.

## Scoring (weighted)

| Dimension | Weight | Score | Key evidence |
|---|---|---|---|
| Usability (ux-designer-agent) | 25% | 78 | Acceptance checklist passes on new tool UIs (search+CRUD, single primary, PageState); deduction: onboarding unreachable, /deals filter chips visually mix control+status vocabulary |
| Spec conformance (process-governance-manager) | 20% | 82 | flow.spec stages/gates all reachable; deduction: LLM reliability score (ADR-0123 #2) not surfaced; target-proposal suggestions (v5 S6/S7 ②) have no UI |
| Data trust (data-architect + quant-methodologist) | 15% | 80 | Backtest honest degradation verified live; provenance columns recorded; deduction: no staleness overlay on S1 figures yet |
| Security/roles (security-engineer) | 15% | 70 | Deny-by-default verified (projects list empty for non-member ✓); **P1: /api/portfolio/backtest exposes project names to non-members**; deduction: safe-share UI pending security sign-off (by design) |
| Design/accessibility (design-system-agent) | 15% | 85 | Lints+contrast green; btn-primary hierarchy live; deduction: emoji→lucide migration partial on legacy screens |
| Operations (sre, release-engineer) | 10% | 80 | All routes smoke-tested live; redirect sweep clean; deduction: backtest computed per-request (no cache policy yet) |
| **Weighted total** | 100% | **≈ 79 / 100** | |

## Findings → ranked backlog

| Rank | Finding | Owner | Fix in this cycle |
|---|---|---|---|
| P1 | Backtest exposes project names to non-members (membership gate missing) | backend-engineer | ✅ revised: member-visible rows + anonymous org aggregate (counts/bias only) |
| P1 | Onboarding wizard unreachable (no links anywhere) | ux-designer-agent | ✅ revised: /deals board empty state + dashboard CTA |
| P1 | LLM reliability score promised (ADR-0123 #2) but absent from API+UI | frontend+backend | ✅ revised: computed proposal-vs-decision agreement per gate, surfaced in agent-runs |
| P2 | Target-proposal suggestions (v5 S6/S7 ②) API-only — no UI | frontend | ✅ revised: suggestions panel on the brownfield screen |
| P2 | Business-targets admin surface (ADR-0114) unmigrated | frontend-engineer | backlog (next cycle) |
| P3 | /deals board lacks per-deal paused-pipeline banner | frontend | backlog |
| P3 | Emoji→lucide on legacy screens | design-system | backlog |

## Decision

Weighted 79/100 with all P1 items fixable in-session → revision cycle executes now (P1 items), P2+ enters the backlog for the next cycle. Re-score after revisions: security 70→88, usability 78→84 → projected ≈ 84.
