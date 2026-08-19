# Pilot 003 — Doosan Bobcat / Doosan Robotics Comprehensive Share Exchange (2024)

**Case type**: Intra-group restructuring (not cross-group Brown Field — a distinct case type from pilots 001/002)
**Region**: Korea (KR)
**Run mode**: Manual (no system — Stage 3 pilot per ADR-0034)
**Case source**: `docs/pilot-candidate-research.md` Candidate A, promoted per user instruction (2026-08-20)
**Status**: In progress — real-world case itself is suspended (see §0), not concluded

## 0. Purpose and Scope

Same public-data-only constraint as pilots 001/002. This case is structurally different from the prior two: it is not a cross-group acquisition but a **restructuring between sibling entities of the same group** (Doosan Enerbility, Doosan Bobcat, Doosan Robotics), so it exercises `group-review-agent`'s scope (`procedures/_shared/group-investment-review/schema.yaml`) rather than `brownfield-agent`'s. It is chosen specifically to fill the gap pilots 001/002 flagged: neither had public disclosure dense enough to exercise Pre-FS/FS/Entity-IC-equivalent content. This case does.

**Real-world status caveat**: as of the last confirmed public reporting, this restructuring is **suspended** following the December 2024 martial-law situation (계엄 사태), with a planned extraordinary shareholder meeting cancelled. This pilot walks the process up to the suspension point — a real, if incomplete, outcome, not a fabricated one.

## 1. Deal Structure (Real Public Facts)

| Stage | Date | Terms |
|---|---|---|
| Initial announcement | 2024-07-11 | Spin off Doosan Bobcat from Doosan Enerbility; comprehensive share exchange making Bobcat a subsidiary of Doosan Robotics. Initial ratio: 100 Bobcat shares : 63 Robotics shares (0.6 Robotics shares per Bobcat share). |
| Regulatory friction | 2024-07 to 08 | Financial Supervisory Service (FSS) rejected the securities registration statement **twice**, citing insufficient transparency on the valuation methodology behind the exchange ratio. |
| Withdrawal | 2024-08-29 | Doosan Bobcat and Doosan Robotics boards each convened emergency sessions and resolved to terminate the share-exchange agreement — 49 days after the original announcement. The underlying spin-off (Bobcat leaving Doosan Enerbility) was **not** abandoned, only the share-exchange/subsidiary-conversion component. |
| Reproposal | 2024-10-21 | Doosan Enerbility, Doosan Bobcat, and Doosan Robotics management announced the restructuring would proceed again, with Bobcat becoming a Robotics subsidiary. |
| Revised ratio | 2024-10 | Enerbility shareholders would receive 88.5 Enerbility shares + 4.3 Robotics shares per 100 shares held (up from 3.2 Robotics shares in the prior structure) — a revision favoring Enerbility/Bobcat-side shareholders relative to the withdrawn version. |
| Activist opposition | 2024-10-15 to 11-18 | Align Partners Asset Management (activist fund, ~1.0% of Doosan Bobcat's shares) sent shareholder letters demanding the re-proposal be permanently abandoned, the KRW 1.5 trillion earmarked for share buybacks be redirected to a special dividend instead, and shareholder-return normalization to peer levels (Caterpillar/Deere/Kubota, ~65%). Doosan Bobcat rejected the board-independence criticism (cited two-thirds outside-director composition) on 2024-11-15. |
| Suspension | 2024-12 onward | Restructuring procedures stalled following the martial-law situation; a scheduled extraordinary general meeting was cancelled. Public reporting does not confirm a resumption as of this pilot's research date. |

## 2. Walkthrough Against `procedures/_shared/group-investment-review/schema.yaml`

| Step | Real-world check | Result |
|---|---|---|
| 1. Entity IC precondition check (hard-reject if Entity IC approval not recorded) | This real-world case did not go through this team's Entity IC gate — it is a real corporate action outside this system. The step's own logic (hard rejection, no soft warning) cannot be tested against a case that never entered the system, but the case is a useful **negative-space check**: if this deal *had* been run through the design's procedures, would Entity IC-level scrutiny plausibly have caught the valuation-fairness issue before it became a public dispute? Plausibly yes — see step 2. | **Structurally sound; not directly testable against public data (no real Entity IC record exists for this case).** |
| 2. Portfolio overlap / cannibalization finding | Real, checkable: Bobcat (construction equipment, profitable) and Robotics (industrial/collaborative robotics, loss-making) have **no product-market overlap** — this is not a cannibalization case, it is a **cross-subsidization/valuation-fairness** case. The `portfolio-fit-assessment` skill's overlap-detection framing doesn't fully capture this deal's actual risk, which is about relative valuation fairness between merging entities, not competitive overlap. | **Partially satisfiable — a real finding that the skill's scope should be read broadly enough to include valuation-fairness scrutiny in a no-overlap merger, not just overlap detection (see §4 F-1).** |
| 3. Intra-group transaction compliance (Fair Trade Act §47 screen) | **Directly and strongly applicable.** This is precisely a related-party transaction between group-affiliated entities. The Korean Fair Trade Act §47 (특수관계인 부당이익제공, unfair benefit provision to specially related persons) is the exact legal basis this checklist item is built to screen for, and the real dispute — an exchange ratio alleged to favor one sibling entity's controlling interests at another's minority shareholders' expense — is a textbook instance of the risk this step exists to catch. The FSS's two rejections and the eventual board withdrawal are real evidence this risk was live, not hypothetical. | **Fully satisfiable — the strongest real-data match of any procedure step tested across all three pilots so far.** |
| 4. Group agenda ranking (IRR-over-hurdle + RAG grade + capital requested, normalized to cycle budget) | **Not executable** — this restructuring is not one proposal competing against concurrent siblings for a shared capital budget; it is a single reorganization transaction. No IRR, hurdle, or capital-request figure is publicly disclosed for it as an "investment," since it is a share-exchange restructuring, not a capital deployment. This step, as written, assumes a capital-competing-for-budget scenario that doesn't fit this case's shape — confirms this case is the wrong one for testing step 4 specifically (see pilot 004 instead). | **Not applicable to this case's transaction type — correctly identifies that step 4's ranking formula is scoped to capital-allocation decisions, not restructuring/share-exchange decisions.** |
| 5. Group IC decision record (approved / rejected / conditional) | Real, mappable: the actual sequence — announce → regulatory rejection ×2 → **withdraw** → re-propose with revised terms → activist opposition → **suspend** — maps cleanly onto a "conditional, then reset" pattern the schema's three-way decision type doesn't fully capture (it has approved/rejected/conditional, but not "withdrawn-and-restarted"). | **Gap found — see §4 F-2.** |

## 3. Illustrative RAG-Adjacent Observations

A full RAG assessment doesn't apply cleanly to a restructuring transaction (the framework's six dimensions are built for investment/acquisition decisions), but the case still validates one framework principle: **the human-reviewer sign-off requirement** (`docs/manuals/business-manual.md` §3 — "confirm or correct the AI-proposed RAG grade with a reason if you correct it") is exactly what the FSS's role played in the real world — a reviewing body rejecting a proposed valuation basis and demanding a corrected justification, twice, before allowing the proposal to proceed. This is a real-world instance of the review-gate concept working as intended, even though the FSS isn't this team's Entity/Group IC.

## 4. Findings

| # | Finding | Type | Action |
|---|---|---|---|
| F-1 | `portfolio-fit-assessment`'s framing emphasizes overlap/cannibalization detection, but this case's real risk was valuation-fairness in a no-overlap merger. The skill's scope should explicitly cover both. | Gap — skill scope | Flag for `group-review-agent` to broaden `skills/portfolio-fit-assessment` scope note in a follow-up revision (not applied in this pilot, since `skills/` content is Stage 5 territory per the design's document-first ordering — tracked, not fixed here) |
| F-2 | `group_ic_decision`'s output type only models approved/rejected/conditional — this case's real pattern (withdraw, then re-propose with revised terms) doesn't map onto any of the three cleanly. | Gap — schema | Add a fourth state or a `withdrawn_pending_resubmission` sub-status to `group_ic_decision` when the procedure schema work resumes (Stage 4 SRS candidate, alongside the Pre-FS/FS/Entity-IC schema gap carried from pilots 001/002) |
| F-3 | Step 3 (intra-group transaction compliance / Fair Trade Act §47) is the single strongest real-data match found across all three pilots — confirms this procedure step is well-specified and its legal basis is directly on point. | Positive — process validated | None needed |
| F-4 | Step 4 (group agenda ranking) correctly does not apply to this case's transaction type (restructuring, not capital-competing investment) — confirms the schema's scoping is sound, and that pilot 004 (a genuine capital-allocation case) is needed to actually test step 4. | Positive — confirms need for pilot 004 | Proceed to pilot 004 |
| F-5 (carried forward) | Pre-FS/FS/DD/Entity-IC procedure schemas still don't exist as `schema.yaml` files — this pilot's step 3 finding shows the *content* for at least the intra-group-transaction-compliance portion is now well understood from real data, which should inform how that schema is eventually written. | Gap, now better-informed | Same Stage 4 SRS action item as pilots 001/002, updated with this pilot's concrete Fair Trade Act §47 test case as a worked example |

## 5. Verdict

**Process partially executable — the strongest single-step validation yet (step 3), a genuine schema gap surfaced with a concrete real-world shape to design against (F-2, the withdraw-and-resubmit state), and a confirmed need for a fourth pilot to test step 4.** Not a failure under ADR-0034 — every non-executable step failed for a structurally sound reason (case-type mismatch for step 4, no real Entity IC record for step 1), not a defect.
