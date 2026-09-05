# Pilot 002 — Hanwha Impact / HSD Engine (Brown Field)

**Case type**: Brown Field (M&A)
**Region**: Korea (KR)
**Run mode**: Manual (no system — Stage 3 pilot per ADR-0034)
**Case source**: `docs/planning/pilot-candidate-research.md` — a real, publicly documented, already-completed deal, held in reserve after pilot 001 and now promoted per user instruction (2026-08-20)
**Status**: In progress

## 0. Purpose and Scope

Same purpose and public-data-only constraint as pilot 001 (`pilot-001-hd-hyundai-stx-heavy-industries.md` §0) — this exercise does not fabricate internal DD, WACC, or IC deliberation data. This case was chosen specifically because it has **richer public disclosure on deal structure and post-acquisition financial performance** than pilot 001, and a **different antitrust outcome** (unconditional approval vs. pilot 001's conditional approval) — together these test parts of the procedure pilot 001 could not reach.

## 1. Screening

Procedure: `procedures/_shared/brownfield-screening/schema.yaml`

| Step | Output | Result |
|---|---|---|
| 1. `brownfield-agent` — target longlist | `target_longlist` | Real input: HSD Engine, Korea's #2 global marine low-speed engine manufacturer (formed 1999 from Doosan Heavy Industries' and Samsung Heavy Industries' spun-off, merged engine divisions). As in pilot 1, this step is satisfied by the real fact pattern rather than a fresh longlisting exercise. |
| 2. `antitrust-agent` — preliminary HHI screen | `preliminary_hhi_screen` | Real data available, but **materially different risk signal than pilot 001**: at the time of this deal (2023), Hanwha Impact was not yet a marine-engine-market incumbent — Hanwha's related shipbuilding position came from Hanwha Ocean (formerly Daewoo Shipbuilding, acquired 2023), a shipyard, not an engine maker. A preliminary screen correctly reads this as **vertical integration** (shipyard + engine maker under one group) rather than **horizontal concentration** (two competing engine/parts makers merging, as in pilot 001) — a materially different antitrust risk shape that the same screening step correctly discriminates. |
| 3. `process-governance-manager` — gate pass record | `gate_pass_record` | Screening deliverables present; gate opens to Pre-FS. |

**Kill Criteria check**: `no_viable_target_in_longlist` — not triggered. `preliminary_hhi_flags_certain_block` — not triggered; the real outcome was unconditional approval, consistent with the vertical (not horizontal) nature of this combination.

## 2. Pre-FS

Deliverable: deal structure hypothesis; WACC/hurdle IRR confirmed `kind=user`.

- **Deal structure hypothesis — real public data is unusually granular here, more so than pilot 001**:
  - MOU stage (2023-02): two separate MOUs — a share-purchase MOU with the controlling shareholder (Inhwa Jeong-gong / 인화정공) and a new-share-subscription MOU with HSD Engine itself. This is a real example of a **mixed secondary + primary structure**, useful for exercising a deal-structure-hypothesis step that has to represent more than a simple single-instrument purchase.
  - Definitive agreement (2023-07): Hanwha Impact subscribed ~11.93M new shares (~KRW 89.5B, at KRW 7,520/share) and purchased ~15.44M existing shares from Inhwa Jeong-gong (~KRW 137.4B).
  - Completion (2024-02-28): 32.77% stake, total consideration KRW 226.9B.
  - Seller's residual position: Inhwa Jeong-gong retained ~11.6% post-closing and **continues as an ongoing equipment supplier to Hanwha Engine** — a real example of a seller remaining commercially entangled with the target post-close, which is exactly the kind of relationship the customer/supplier-concentration checklist items are meant to catch, just from the seller side rather than the buyer side.
- **WACC/hurdle IRR**: **not available from public sources**, same boundary as pilot 001. No number fabricated.
- **Certification transferability**: not applicable — equity-stake acquisition, same reasoning as pilot 001.

## 3. FS

- **Full valuation**: out of scope, same reason as pilot 001 (no WACC/hurdle, no non-public financials at the granularity a real valuation requires).
- **Six-way M&A cross-check, started**: antitrust workstream has real data (§4). One additional workstream has partial real data this time — see the financial-performance note in §5.

## 4. DD — M&A Special Topics Checklist Walkthrough

Checklist: `checklists/ma-special-topics-checklist.yaml`.

| Item | Real-world check | Result |
|---|---|---|
| ma-01: relevant market defined, HHI/HHI-delta calculated | Product market: marine low-speed engines. This deal is vertical (shipyard-to-engine-maker), not horizontal (engine-maker-to-engine-maker) — no direct competitor overlap in the target's own product market, which is why the screen in §1 read low horizontal risk. | **Satisfiable — and usefully different from pilot 001's horizontal case.** |
| ma-02: merger-control filing requirements confirmed for every applicable jurisdiction | Real filing: **multiple jurisdictions** — public reporting confirms review by "major export-country" authorities in addition to Korea FTC, before the Korea FTC's own approval. This is the first pilot case to actually exercise the "multi-jurisdiction filing" branch of this checklist item; pilot 001 only had a single (Korean) filing. | **Satisfiable — first real multi-jurisdiction test case.** |
| ma-03: gun-jumping prohibition acknowledged | No public evidence of pre-clearance integration; deal proceeded MOU (2023-02) → definitive agreement (2023-07) → regulatory approvals → completion (2024-02), a normal sequenced timeline. | **Satisfiable — no violation found in the public record.** |
| ma-04 (executive compensation / CoC triggers) | Partial: a new CEO (유문기, formerly Hanwha Impact's investment-strategy head) was named at closing — a public fact, but with **no compensation figures disclosed**. Confirms this remains an internal-DD-only item; the leadership-change fact alone doesn't satisfy the checklist's compensation-package requirement. | **Not executable from public data.** |
| ma-05 through ma-06 (non-compete, employee comp harmonization) | No public disclosure. | **Not executable from public data.** |
| ma-07/ma-08 (customer/supplier change-of-control and retention risk) | **Real, unusually concrete data point**: the seller (Inhwa Jeong-gong) retains a supply relationship with the target post-close. This is the reverse direction of what the checklist item is usually framed for (target's customer contracts), but it is a real, checkable instance of exactly the underlying risk category (a counterparty relationship that could change on a control event) — worth noting as a case where the checklist's framing (customer-side) should be read to also cover a retained supplier-side relationship. | **Partially satisfiable — a real finding, framed slightly outside the checklist's literal customer-only wording (see §6 F-2).** |
| ma-09 (incentive/clawback exposure) | No public disclosure — not a regional-relocation deal, low relevance in this instance even if data existed. | **Not applicable to this case specifically.** |
| ma-10/ma-11 (contingent liabilities, covenant breach) | No public disclosure. | **Not executable from public data.** |
| ma-12 (certification transferability) | Not applicable, same reasoning as Pre-FS. | **N/A, correctly excluded.** |

## 5. Entity IC / Group IC

Not run — same valuation/six-way-cross-check gap as pilot 001. Stops at the expected data-availability boundary.

**Illustrative RAG assessment**, extended slightly further than pilot 001 because of the real post-acquisition financial performance disclosure:

| Dimension | Grade (illustrative) | Rationale |
|---|---|---|
| Regulatory/Permit | Green | Unconditional approval across all reviewing jurisdictions, no ongoing behavioral remedy obligations — a materially cleaner outcome than pilot 001's Amber. This is a useful contrast case: the framework should (and does) grade the same dimension differently across two real deals in the same industry, which is exactly what a rule-based (not templated) framework should do. |
| Financial | **Still not gradable, but with a caveat worth recording**: public reporting shows a 9-month cumulative operating profit of KRW 82.7B versus KRW 8.7B for the full prior year pre-close — a >9x increase. This is directionally strong but **cannot be converted to an IRR/DSCR grade** without the acquisition's capital structure and hurdle rate, neither of which is public. Recording the raw figure here rather than inferring a grade from it is itself the correct behavior under the framework's `assumption.kind='user'` rule — a tempting shortcut (grade Green because profit grew 9x) is exactly the kind of unsupported inference the framework's structure is meant to prevent. |
| Other four dimensions | Not gradable | Same reasoning as pilot 001. |

No overall grade produced — correct, same reasoning as pilot 001.

## 6. Findings

| # | Finding | Type | Action |
|---|---|---|---|
| F-1 | The antitrust-screening path correctly discriminated a vertical-integration deal (this case, unconditional approval) from a horizontal-concentration deal (pilot 001, conditional approval) using the same procedure and checklist, producing different — and each individually correct — results. | Positive — process validated across two structurally different real cases | None needed |
| F-2 | `ma-07`/`ma-08`'s wording is framed for the target's customer contracts; this case's real, checkable finding is a **retained seller-side supply relationship** instead. The underlying risk category (a counterparty relationship exposed to a change-of-control event) is the same, but the checklist text should be broadened to say "customer or supplier relationships," not narrowed to imply customer-only. | Gap — checklist wording | `brownfield-agent`/`customer-retention-agent` should widen ma-07/ma-08 wording in a follow-up checklist revision |
| F-3 | A strong real financial-performance figure (>9x operating profit growth) was correctly **not** converted into a Financial-dimension grade without a hurdle rate — confirming the framework resists an intuitive but unsupported shortcut. | Positive — framework validated under temptation, not just under a null case | None needed |
| F-4 | This is the first pilot to exercise the multi-jurisdiction branch of ma-02 with real data (major export-country reviews + Korea FTC) — previously untested by pilot 001, which only had a single-jurisdiction filing. | Positive — checklist coverage extended | None needed |
| F-5 (carried forward from pilot 001, still open) | No formal procedure schema exists yet for Pre-FS/FS/DD/Entity-IC gates. | Gap | Same Stage 4 SRS action item as pilot 001's F-3 — not duplicated as a new action, tracked once |

## 7. Verdict

**Process executable, same data-availability boundary as pilot 001, with genuinely new coverage** — this case exercised the multi-jurisdiction filing branch, the vertical-vs-horizontal antitrust discrimination, and (most valuably) tested whether the RAG framework would resist grading Financial on a tempting-but-unsupported inference. All three held correctly. Not a failure under ADR-0034.

## 8. Cross-Pilot Note (Pilot 001 vs. Pilot 002)

Both deals sit in the same industry vertical and region (Korea, marine engine/crankshaft) but are **not comparable as a Group IC ranking exercise** — the two acquirers (HD Hyundai and Hanwha) are different corporate groups, not sibling entities competing for one group's capital budget, so ADR-0029's ranking model does not apply across them. They are useful as two *independent* process-validation runs, not as a ranking test case. A genuine ranking exercise (two of the *same* group's subsidiaries proposing concurrently) still requires either a real intra-group case or a third researched precedent — noted as a possible pilot 003 candidate if one is wanted later.
