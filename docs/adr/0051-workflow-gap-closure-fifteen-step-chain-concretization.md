# ADR-0051: Workflow gap closure — fifteen-step chain concretization

**Status**: Accepted
**Date**: 2026-08-22 (accepted 2026-08-23)
**Deciders**: process-governance-manager, compliance-officer, legal-counsel, valuation-agent, hr-integration-agent

> **Accepted 2026-08-23** — the implementation landed as PR-10 (#77, commit 1e05e49): six checklists, seven procedure files, three skills, the six-validator no-waiver core unchanged at steps 6-11.

## Context

The design's 15-step M&A chain was audited against the 10 shared procedures. The audit found nine gaps: strategic fit tested only at Group IC (never at first screen); market DD absent (market-intelligence-agent had zero brownfield steps); legal DD absent (legal-counsel had one brownfield step — certification transferability only); HR DD partial (comp review only); deal structure partial (hypothesis at Pre-FS, no four-axis review step); financing absent entirely (no step, no skill, no checklist); management/day-1 partial; internal-origin projects had no entity-formation/IP-assignment/employment-transfer steps; and pure internal Green Field ventures had no pre-feasibility gate.

The root cause was **routing, not skill inventory** — most needed capabilities existed as skills, but no procedure step dispatched them. Two research reports (committed at `docs/research/`) supplied the external best practice: M&A due-diligence practice across legal/market/financing/HR workstreams (62 sources), and venture-governance practice for strategic-fit screening, stage-gates, entity formation, and JV governance (38 sources). The user directive was to close the gaps and concretize the manuals, checklists, and regulations with that researched practice.

## Decision

Eight additions, all at the routing/checklist layer:

1. **Six new checklists** — `chk-strategic-fit`, `chk-legal-dd`, `chk-market-dd`, `chk-financing`, `chk-hr-dd`, `chk-entity-formation` (each with mandatory/waiver-eligible items per the `checklist-authoring` contract).
2. **Seven procedure files edited or created**:
   - `brownfield-screening` v1.1.0 — strategic-fit screen inserted as step 2 (before HHI);
   - `greenfield-screening` v1.3.0 — the same screen as step 1 (before market sizing; the strategic filter precedes attractiveness rating);
   - `brownfield-dd` v1.3.0 — four new steps: market DD (4), legal DD (5), financing readiness (12), HR DD (13);
   - `brownfield-fs` v1.1.0 — four-axis deal-structure review after valuation (`deal_structure_review`, setting `four_axis_review_completed`);
   - `entity-ic-review` v1.1.0 — financing precondition step before the human decision;
   - `entity-establishment-execution` v1.0.0 (NEW, conditional on `origin ∈ {internal, joint}`) — formation, statutory filings, permit/certification classification, people transfer, completion confirm;
   - `greenfield-pre-fs` v1.1.0 — GF-internal pre-feasibility gate as conditional step 1 (market evidence via proxy chain, technical feasibility, right-to-win PROOF).
3. **Three new skills** — `strategic-fit-screening` (process-governance-manager), `legal-due-diligence` (legal-counsel), `financing-plan-review` (valuation-agent) — mirrored across `skills/`, `.claude/skills/`, `.gemini/skills/`, `.agents/skills/`.

**The six-validator no-waiver completeness core is UNCHANGED** in size and relative order: antitrust, HR-comp, customer, incentive, contingent-liability, certification — certification still LAST among validators (meeting M5's fixed order). In `brownfield-dd` the validators moved from steps 4-9 to steps 6-11 by insertion, nothing more; the completeness check moved 10 → 14.

**The four new DD steps are OUTSIDE the no-waiver core**: mandatory with the standard waiver path (`waiver_eligible: true` unless the item is a completeness fact). Whether legal DD should join the no-waiver core is deliberately left OPEN — recorded below for the thresholds meeting, not decided here.

**Illustrative thresholds discipline**: research-derived figures (strategic-fit ≥60/100 advance and 45-59 hold/recycle bands; reverse-termination-fee 4-7% of EV; stay-bonus 12-24 months) are marked ILLUSTRATIVE in every checklist and procedure step that cites them. Activation requires the thresholds meeting recorded under `docs/decisions/open/` — the same discipline that keeps `rag_rule` rows at `enabled=0` until a dated decision record exists.

**Korea caveats**: KFTC merger-threshold KRW figures and the Korean employment-succession doctrine (영업양도, Supreme Court 2000다8448 line; company split 물적분할/인적분할 under Commercial Act arts. 527-2/527-5) arrived via research summaries — every load-bearing citation carries "verify against current statute / with counsel before enforcement use".

## Open Questions (for the thresholds meeting — `docs/decisions/open/`)

- **(a)** Does legal DD join the six-validator no-waiver core? Arguments both ways: an IP title gap or a non-assignable contract is as deal-structural as a non-transferable certification; but the core is a design-fixed completeness invariant (§8.9-1(f)) and widening it is a design change, not an ADR-level patch.
- **(b)** Strategic-fit scorecard weights and advance/hold/kill thresholds — the ≥60/100 and 45-59 bands are Cooper/Green Book practice, not our policy.
- **(c)** RTF 4-7% of EV and stay-bonus 12-24 months as policy vs. illustration.

## Consequences

- **Agent/skill coverage grows**: `market-intelligence-agent` and `legal-counsel` are now dispatched in brownfield paths (`graph-map` coverage increases accordingly); `legal-due-diligence` and `financing-plan-review` are dispatched from two procedures each.
- **Cross-validation matrix follow-up** (for the matrix owner, design §review model): AI-2nd pairs must now include market DD ↔ commercial DD (both produce market-facing findings from different methods) and legal DD ↔ certification findings (both legal-counsel-owned; same-domain review cannot substitute for second-stage review). Not wired in this ADR — flagged as follow-up.
- **Renumbering**: `brownfield-dd` steps shifted (validators 4-9 → 6-11, completeness 10 → 14); `greenfield-screening`, `brownfield-fs`, `entity-ic-review`, `greenfield-pre-fs` each shifted by one. Live docs (`docs/process-map.md`, `docs/srs.md`, `docs/traceability-matrix.md`) were updated; pilot files keep their version-pinned historical numbering.
- **Routing dependency**: `entity-establishment-execution`'s conditional dispatch waits on PR-5 classification routing; until then a missing origin classification at Entity IC exit is a kill criterion (halt), because a silent skip would be "a waiver with none of a waiver's controls" (ADR-0047).
- **Boundary #3 held**: every new skill references its procedure keys and describes how; no skill restates gate steps (enforced by `procedures/_validate.ts`'s authority-split check).

## Source basis

Primary external sources (not merely the intermediate research files — full reports with complete citation lists at `docs/research/ma-dd-best-practice.md` and `docs/research/venture-governance-best-practice.md`):

- Cooper / Stage-Gate Institute — Gate 1 knock-out + scorecard design; Gate 2→3 right-to-win escalation (stage-gate.com; PDMA 2026)
- HM Treasury Green Book 2026 — Five Case Model, Strategic Outline Case before full appraisal (gov.uk)
- Thomson Reuters Practical Law — M&A DD guide; commitment letters; funds-flow memorandum
- dealroom.net — PE deal lifecycle stage map (where DD workstreams and financing sit)
- Goodwin (Oct 2025) — deal & financing certainty, RTF 4-7% benchmark, equity backstop
- Cleary Gottlieb — SunGard/certain-funds limited conditionality
- Acas / Practical Law — TUPE inform & consult regime
- KLRI (elaw.klri.re.kr) — Korean Commercial Act arts. 527 et seq. English text
- The Korean Law Blog — employment succession doctrine on business transfer (영업양도), Supreme Court 2000다8448 line
- ICLG / Kim & Chang / Lee & Ko — KFTC merger-control thresholds and 2024 voluntary-commitment track (figures via search snippets — verify against current statute)
