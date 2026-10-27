# ADR-0187: Process SSOT and decision evidence (engine-spec parity, checklist and kill-list reconciliation, derived data confidence, pre-IC permit/incentive capture, cross-validation matrix)

- Status: Proposed (2026-10-27)
- Date: 2026-10-27
- Decider: human owner. Drafted by process-governance-manager on PM dispatch (wave W3, Row 0).
- Design-of-record: [docs/designs/2026-10-27-process-ssot-decision-evidence-design.md](../designs/2026-10-27-process-ssot-decision-evidence-design.md)
- Source review: [docs/reports/2026-10-26-project-review-s1-s12.md](../reports/2026-10-26-project-review-s1-s12.md) findings H7, H8, H9, H11, M1-M9, M14, M15, M17.
- Related: ADR-0020 (procedure overrides), ADR-0047 (classification matrix), ADR-0057 (kill evaluator), ADR-0074 (flow.spec SSOT), ADR-0161 (retroactive precedent), ADR-0185 (agent/skill placement), ADR-0186 (gate integrity). Supersedes none. Amends neb-policy (policy_change record required) and adds migrations.

## Context

After ADR-0186 the gate write path is sound, but what it checks against is not: the engine enforces blockers flow.spec does not declare (H8), a mandatory screening checklist has no producer or consumer (H9), three kill lists diverge (M4), activities name agents with no procedure step (M2), the AI-2nd reviewer collapses to platform-lead (M7), and decision evidence is defaulted - data confidence resolves to B with no chain (H7), there are no base rates, greenfield permits/incentives exist only after IC (H11), and S10 does not reconcile to S8 (M1). S12 has no activity for brownfield external minority / R&BD / CVC (M17, verified). Verified status per finding is in design section 2; M14 is mostly closed by ADR-0186 P5.

## Decision (proposed)

1. flow.spec 2.14.0 declares every engine blocker (S3 capability register, S8 adoption, S11 PMI kickoff and GF baseline), the S2 entry-market input on S3-S12, the S11 order, S12 coverage for the missing sub-tracks, `ip-fto-review`, region-labor review (all tracks except GF internal), and removes the S10 site activity. `process/stages.yaml` becomes a projection of flow.spec.
2. Blocker codes become stable keys; a parity validator keeps `lib/process-flow.ts` and flow.spec equal.
3. The kill-criteria registry is the single kill list; neb-policy section 4 and flow.spec `killCriteria` cite registry keys.
4. `legal-regulatory-checklist` is produced by a screening step using `regulatory-screening` (legal-counsel) and consumed by the screening gate.
5. Each flow.spec activity agent must hold a step in each referenced procedure (allowlist by ADR only).
6. Data confidence is derived only from recorded chain hops and sources; no chain recorded yields a non-default grade (D1) with an honest rationale. Base rates and benchmark cases get a sourced table.
7. Greenfield permit and incentive (with clawback) candidates are captured before IC and linked by the S11 baseline.
8. S10 reconciles uses to the S8 adopted investment, checks covenant headroom under downside and requires funding evidence.
9. A committed cross-validation matrix routes AI-2nd review; fallback is labelled.
10. Eight validators (design section 4.6) enforce the above in `bun scripts/audit.ts`.
11. Thresholds are proposed by risk-officer + quant-methodologist and bind only on owner record.

## Consequences

- Positive: spec, engine, policy and procedures can be proven equal by script; RAG caps reflect real evidence; every track reaches S12.
- Negative: in-flight RAG proposals may downgrade at next write (labelled legacy, not rewritten); procedure version churn; new schema.
- Schema: `base_rate`, `benchmark_case` population, pre-IC permit/incentive capture columns, data_confidence twin migration - all reversible.

## Open decisions

Owner confirmation (2026-10-27): D1-D9 are decided exactly as recommended; the options are kept for the record. The D2 thresholds (S10 uses within +/-5% of the S8 investment; downside DSCR headroom of at least 1.2x) are confirmed as starting values, owned by `risk-officer` + `quant-methodologist`.

Status note: this ADR stays Proposed; acceptance happens at the owner's merge of the PR.

| ID | Question | Options | Recommendation | Decision |
|---|---|---|---|---|
| D1 | Data-confidence rule when no chain is recorded and the source is not direct data | (a) keep B; (b) C; (c) new `U` (unknown) capping RAG at Amber and blocking Green | (c): honest, distinct from a measured weak chain; caps per boundary 4 | Decided (owner, 2026-10-27): (c) new `U` (unknown) capping RAG at Amber and blocking Green |
| D2 | Source of benchmark / base-rate data and tolerance thresholds (S10 reconciliation, covenant headroom) | (a) external paid database; (b) internal post-mortems + sourced public studies with provenance; (c) defer | (b) now, (a) evaluated later; thresholds proposed by risk-officer + quant-methodologist: uses within +/-5% of S8 investment, downside DSCR headroom >= 1.2x - both owner-confirmed | Decided (owner, 2026-10-27): (b) internal post-mortems + sourced public studies with provenance now, (a) evaluated later |
| D3 | Cross-validation matrix content | (a) domain-to-domain only (status quo); (b) artifact type x author domain -> reviewer agent; (c) (b) plus risk-officer on every IC artifact | (b), with industry-lead reviewing market/proxy outputs, region-lead regulatory/labor, risk-officer valuation/synergy, platform-lead only technical artifacts | Decided (owner, 2026-10-27): (b) artifact type x author domain -> reviewer agent |
| D4 | Pre-IC permit/incentive capture shape and stage | (a) S5 for GF; (b) S8 for GF; (c) new rows reusing S11 schema with `stage_captured`, linked at S11 | (c) at S8 (FS has the site), S5 optional - avoids double entry | Decided (owner, 2026-10-27): (c) new rows reusing S11 schema with `stage_captured`, linked at S11; captured at S8, S5 optional |
| D5 | Owner of the S3 capability register | (a) strategic-fit-screening (PGM); (b) new activity per track lead (greenfield-agent / brownfield-agent); (c) financial-analyst | (b): track leads consume it at S5/S9 capability-dd; PGM consumes it in the screen | Decided (owner, 2026-10-27): (b) new activity per track lead (greenfield-agent / brownfield-agent) |
| D6 | S3 synergy author once risk-officer keeps red-team | (a) financial-analyst; (b) track lead; (c) keep risk-officer and add an independent red-team | (a): quantitative author, risk-officer stays independent | Decided (owner, 2026-10-27): (a) financial-analyst |
| D7 | S11 order of establishment vs group IC | (a) group IC GO before establishment; (b) parallel with establishment held until GO | (a): matches stages.yaml G7 text and keeps capital commitment after the final human decision | Decided (owner, 2026-10-27): (a) group IC GO before establishment |
| D8 | S12 coverage for brownfield external minority / R&BD / CVC | (a) widen portfolio-venture-monitoring applies_when; (b) new activity; (c) declare out of S12 scope | (a): the venture scorecard already models minority/hybrid cells | Decided (owner, 2026-10-27): (a) widen portfolio-venture-monitoring applies_when |
| D9 | GF internal-expansion DD trim | (a) keep full DD; (b) trim to capability, financial, legal-regulatory, EHS; (c) waive DD entirely | (b): removes busywork, keeps binding items | Decided (owner, 2026-10-27): (b) trim to capability, financial, legal-regulatory, EHS |

## Review

AI-1st formal; AI-2nd platform-lead (validators, schema) and risk-officer (thresholds, kill list); human final. Policy, thresholds and this ADR cannot pass on AI review alone.
