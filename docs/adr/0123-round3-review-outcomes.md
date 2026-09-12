# ADR-0123: Round-3 review outcomes — agent transparency, learning loops, and external boundaries

- Status: Accepted
- Date: 2026-09-12
- Deciders: New Business Review Lead (PM)
- Deciders note: the third all-agent review found that the platform's biggest unpaid dividends were transparency over machinery that already exists (agent runs), learning from time (forecast vs actual), and safe contact with the outside world (advisors, e-approval). The review lead adopted all eight improvement plans and five advancement ideas (backtest, reliability score, safe-share, e-approval hub, resource calendar).
- Related: ADR-0096 (agent run records), ADR-0102 (pipeline boundary), ADR-0118 (LLM decision support), ADR-0122 (round-2 outcomes), docs/designs/2026-09-12-website-construction-plan.md, docs/designs/2026-09-12-implementation-matrix.md

## Decision

1. **Agent-run viewer** (frontend-engineer): every deal exposes a timeline of `agent_run` / `activity_run` / `gate_evaluation` rows — which agent ran, when, and whether the output was an artifact or a PROPOSAL. Data already persisted since ADR-0096; this is surface-only. Proposals stay visually distinct from human records (boundary #2).
2. **LLM proposal reliability score**: cumulative per-stage acceptance rate (proposal adopted as-recorded by the human) over the agent-run history. Display-only learning signal — it never gates anything.
3. **Forecast–actual backtest viewer** (valuation-agent, financial-analyst): S8 forecasts (NPV/IRR, chosen scenario) auto-compared with S12 scorecard-derived actuals, per deal and org-wide, with bias detection (e.g., systematic over-forecasting) feeding future data-confidence grades. Learnings from cancelled/failed deals (kill-with-learning) are part of the corpus.
4. **External safe-share links** (security-engineer — design sign-off required BEFORE implementation): sharing MNPI-adjacent material (IC summaries, DD extracts) with external advisors happens only through expiring (≤30 days), watermarked, access-logged links; summaries/snapshots only, never live data; English view for foreign recipients; every access audit-logged.
5. **E-approval cross-reference + hub** (compliance-officer): gate decisions may carry the group e-approval document number (`gate_decision.erp_ref`, migration) so the workspace ledger and the corporate approval system stop being parallel books. The hub (two-way status mirroring) ships only after an external-system POC; the cross-reference field is self-contained and ships regardless.
6. **flow.spec version badge** (process-governance-manager): deals started under an older spec show a stale-spec banner (`process_run.spec_version`) with migration guidance for criteria that changed (e.g., v2.3 added the charter-baseline confirmation to S11).
7. **Data-source health badges + fallback transparency** (market-intelligence, infra-automation-engineer): figure panels show source status (healthy / degraded / fallback-in-use) for ECOS, DART, and web-research; failures surface queuing/retry state instead of silent staleness.
8. **Group isolation + storage-tier visibility** (data-architect, dba): lists expose the owning group filter; archive rows show their storage tier (online standard vs cold 5-year audit retention).
9. **UI copy/help standard dictionary** (docs-writer, i18n-specialist): glossary-backed standard phrases for confirmations, empty states, and help hints; new screens draw from the dictionary.
10. **Portfolio resource calendar** (group-review-agent — adopted with ADR-0122's portfolio view): lead workload and review dates on one time axis; contention cells propose adjustments, humans decide.

## Consequences

- v5 baseline (frozen 2026-09-12) is the development basis; this ADR's items map to construction-plan Wave 3.
- New persistence: `gate_decision.erp_ref`, share-link tables, backtest fact view, `deal_comment`/`stage_sla` (round-2). Most transparency surfaces read existing tables.
- Security: A4 share links have a hard pre-implementation gate (security-engineer design sign-off). E-approval hub has a POC gate; the cross-reference field ships independently.

## Alternatives rejected

- Storing LLM reliability scores as authoritative quality metrics: they are display-only learning signals — acceptance rate conflates proposal quality with task difficulty, and gating on it would quietly automate judgement (boundary #2).
- Letting the backtest viewer rewrite confidence grades automatically: grade adjustments are proposed, human-approved.
