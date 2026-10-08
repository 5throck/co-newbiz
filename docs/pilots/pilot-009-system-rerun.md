# Pilot 009 — System Re-Run Through the Web UI vs. Manual Pilot (Wave C-2)

**Manual baseline**: `docs/pilots/pilot-009-emart-ebay-korea.md`, golden case `tests/eval/golden/cases/pilot-009.yaml` (fixture `tests/eval/golden/fixtures/pilot-009.input.json`)
**Run mode**: System, through the browser. A production build on its own free port and a temporary SQLite DB (harness `tests/scenarios/_support/harness.ts`, never port 7749). LLM, DART and web-research settings were blank, so only the deterministic and synthesis paths ran. The deal was entered as the `analyst` account with Playwright, screen by screen. Nothing was seeded beyond the two bootstrap accounts.
**Inputs**: only the public facts in the manual pilot and the golden fixture. Anything not in them was left empty and recorded as "not available". Nothing was invented.
**Design of record**: `docs/designs/2026-10-08-wave-c-e2e-proof-design.md` §5 and §12 (C-2), together with the Wave 5.10 rule. Every discrepancy is investigated as a defect on one side or the other and is not left unexplained.

## 1. How Far the Run Got

**It stopped at S2.** The stop at S2 is correct. S1 is also blocked, and that block comes from product defects. S3 to S12 were never reached, because the process enforces stage order and the S3 and S4 review panels report "locked behind an incomplete predecessor". No gate decision was recorded as the human proxy. Section 3 explains why that matches the real timeline.

## 2. Stage-by-Stage Record

| Stage | What the system required | What could be entered (public facts only) | Review buckets | RAG | Gate recorded as human proxy |
|---|---|---|---|---|---|
| S1 Market analysis | Market size and growth, competitive structure, value-chain structure, data-confidence grade | Industry name "온라인 리테일(전자상거래)". KSIC code: not available (not in the pilot). **Competitive shares (Naver 18%, Coupang 13%, eBay Korea 12%, SSG.com 3%) could not be entered: the S1 report has no input for competitive structure**, so the structure can only come from a re-analysis. | No review panel on S1, because no deal exists yet. The report's verification ledger lists 1 item. | Report shows "RAG cap: Amber" because the matrix is LLM-estimate or synthetic | None. Screening has no panel before S3. |
| S1 system output | — | — | Banner: "every step was filled with deterministic synthesis (dummy) values — do not trust the figures". Shown: $1B base, -100% CAGR, $0B in 2030, segments "construction / mining / other", chain grade C. **Stored `data_confidence_grade` = B.** | — | — |
| S2 Opportunity discovery | Attractiveness score (0–100) | Opportunity "Emart — eBay Korea 지분 80.01% 인수", scope "국내 온라인 리테일", node "온라인 마켓플레이스(Gmarket·Auction·G9)". Five factors from pilot §1: three opportunities (combined 15% share; 2020 GMV, revenue and OP with growth; SSG.com fulfilment synergy) and two risks (liabilities 11.8T→16.2T with the deal at 15.2% of assets; >KRW 1T fulfilment capex commitment). **Attractiveness score: not available** (an internal judgement, not public). | The deterministic draft answers null: "the score cannot be computed from the data alone; a person must assess it". This is the correct "could not verify" outcome. The overview lists S1 blockers (market size and growth; data-confidence grade not recorded). | Not graded | None |
| S3 Synergy and fit | Synergy score, fit rationale, capability list with source, `selected` | Not entered. All are internal judgements, and the stage is locked. | Verified 0 · Could not verify 2 ("locked behind an incomplete predecessor"; content accuracy) · Needs judgement 1 | Not graded | Screening: none |
| S4 Route decision | Track, route type, five-criteria scores, alternatives | Not entered. The scores are not public, and the stage is locked. | Same three buckets as S3. Route recommendation: "neutral (insufficient signal) — Greenfield 0 / Brownfield 0". This is correct with S1–S3 empty. | Not graded | Pre-FS: none |
| S5–S12 | — | Not reached | — | — | — |

## 3. Human-Proxy Gate Record vs. the Real Timeline

The public record holds one dated decision, the agreement of 2021-06-24 (golden `public_outcome: closed`, favourable). That corresponds to the S11 Entity and Group IC approvals. The dates and outcomes of the Screening, Pre-FS, Target Screening, FS and DD gates are not public. The run never reached S11, so recording an S11 GO would have skipped the evidence the process requires. Recording earlier GOs would have meant inventing their timing. So no gate was recorded. A probe on a separate throwaway opportunity showed that the API would have accepted those GOs anyway (D-4).

## 4. Comparison with the Manual Pilot and the Golden Case

| Item | Manual pilot / golden | System re-run (UI) | Discrepancy? |
|---|---|---|---|
| Entry point | Starts at the deal (Pre-FS and FS steps against a known target) | Starts at S1 and requires S1–S4 judgements before any brownfield stage | **Yes — 4.1** |
| S1 data confidence | Not discussed in the manual pilot. Golden: the financial dimension and overall are `not_graded`. | Shows chain grade C but stores grade B for a dummy matrix | **Yes — 4.2** |
| S2 attractiveness | Not scored | Null, needs a person (correct) | No |
| S6 antitrust (horizontal, moderate HHI, no certain block) | Satisfiable | Not reached through the UI | **Yes — 4.1**, same cause |
| S7 Kill Criteria (no hits) | No hits | Not reached | 4.1 |
| S8 financial / overall `not_graded`, three must-raise findings | Not graded | Not reached | 4.1 |
| F-3 acquisition vehicle (SPC) | A gap in the Pre-FS prompt | The S10 deal-structure screen already offers `vehicle = spc` ("SPC/SPV(목적법인)", migration 0013) | **Yes — 4.3** |

For the S6–S8 functions, engine-level evidence exists outside the UI. The deterministic eval suites (`bun run eval -- --no-report`, run during this wave) score 100% on the rag, kill and antitrust suites across the golden set. Those suites contain no pilot-009-specific UI path. They test the same functions on the fixture, not on data entered through the screens.

### 4.1 The system cannot start a review at a known target. Investigated: a product gap on the system side.

The manual pilot begins where a real M&A review usually begins, with a named target. The system models only the "market first" funnel. S1–S3 need judgement scores (attractiveness, synergy, five-criteria route scores) that a public-facts re-run cannot supply, so every brownfield stage stays locked. Stopping on an unknown score is correct behaviour (boundary #2: a person scores). What is missing is a sanctioned path for an inbound or known-target deal. Such a path would record S1–S3 as "not applicable / not available, with reason" and let a person open S6 directly, with the data-confidence cap applied. The manual pilot is not at fault. Its scope is the FS-level walk-through it states. **Defect D-5.**

### 4.2 The data-confidence grade overstates a dummy matrix. Investigated: a system defect.

`db/lib/data-confidence.ts` grades only provenance and proxy hops. Any non-`frozen-research` provenance is capped at B, and the offline synthesis path stamps its dummy matrix `provenance: "llm-estimate"`. The result is that a matrix the UI itself calls "do not trust" (all-zero baseline, -100% CAGR, unrelated segments) stores grade B. That is the same grade as a real LLM estimate, and it is better than the chain grade C shown on the same page. Because data confidence caps the overall RAG (non-negotiable #4), the cap is looser than the evidence supports. Fixing it needs a distinct provenance value for synthesis output, a grade of C (or ungraded) for it, and parity changes in migration 0125's backfill and in `tests/unit/wave-f5-rag.test.ts`. That is not a trivial fix, so it is listed here. **Defect D-2.**

### 4.3 The F-3 SPC finding was already closed on the system side. Investigated: the manual pilot is out of date, not a defect.

The manual pilot (2026-08-20) said the structure-hypothesis step does not name the acquisition vehicle. The built system has `deal_structure_hypothesis.vehicle` with `direct | spc | holdco | internal_venture_spinoff | jv`, and the S10 screen labels the SPC option. The pilot's "Action" column should read "closed by S10 deal-structure vehicle". This is not a system defect.

## 5. Product Defects Found

| ID | Severity | Defect | Disposition |
|---|---|---|---|
| D-1 | High | Every "start a new review" link (deal board, onboarding step 1) went to `/market`. With no deals yet, `/market` showed "no review in progress — go to the board", which links back to the same place. A first user could not reach S1 at all. | **Fixed.** `components/CarrierGate.tsx` now renders the S1 screen inline on `/market` when no deal exists, because S1 comes before any deal record. Verified in a fresh app: board → "새 검토 시작" → S1 with "신규 산업 분석". |
| D-2 | High | A dummy synthesis matrix stores data-confidence grade B (4.2). | Listed. Needs a provenance value, a migration-parity change and an ADR check. |
| D-3 | High | An opportunity registered by hand (S2 "기회 직접 등록") cannot be linked to the analysed S1 industry: the form and `POST /api/opportunities` take no `industry_id`. The S1 predicate keys on `opportunity.industry_id`, so S1 can never complete for a deal entered by hand. | Listed. Needs an API field, a form select, and validation against `md_industry`. |
| D-4 | High | `POST /api/opportunities/{id}/gate-decisions` accepted GO for `target_screening` (a brownfield-only gate) on an opportunity with no route decision and empty S1–S7, and GO for `screening` with S1–S3 empty. Probe on a throwaway opportunity: both returned 201. The S6/S7 tab also shows the Target Screening panel before any track is decided. | Listed. Gate–track applicability and the stage-order check belong in the route. This affects gate semantics, so it needs a design note. |
| D-5 | Medium | There is no entry path for a known-target or inbound deal (4.1). | Listed. Needs a design decision (process change). |
| D-6 | Medium | S1 has no manual input for competitive structure, so disclosed market shares cannot be recorded. Offline, S1 can therefore never satisfy the "competitive structure" criterion. | Listed. |
| D-7 | Medium | The offline synthesis template outputs heavy-industry segments ("construction / mining / demolition") for any industry, here e-commerce. | Listed. The banner already says "do not trust", so the risk is presentation. |
| D-8 | Medium | The E2E harness "offline mode" did not blank `TAVILY_API_KEY`, `ECOS_API_KEY` or `KRX_API_KEY`, and left the default-on DuckDuckGo fallback enabled. The root `.env` therefore supplied a live key, and S1 sizing made an external web call (a third-party snippet appeared in the qualitative sources). This breaks the C-1 non-goal "no external network call". | **Fixed** in `tests/scenarios/_support/harness.ts`: the keys are blanked (an empty value blocks the root `.env` fallback) and `WEB_SEARCH_DDG_ENABLED=false` is set. The signal handler now also removes the temporary directory. |
| D-9 | Low | The S1 primary action "입력 완료하기" opens the new-analysis form. It does not complete anything, so the label promises an action the button does not take. | Listed (copy). |
| D-10 | Low | The three-stage review panel shows a bare "Not found." when a stage tab is opened without a real deal id. | Listed. Reachable only by a direct URL. |

## 6. Verdict

**The run stopped early, and the stop was useful.** The system behaved correctly wherever data was missing. The S2 draft refused to invent a score. The S3 and S4 reviews declared what they could not verify, and no RAG grade was rendered. It also surfaced four High defects that the seeded C-1 scenarios cannot find, because those scenarios bypass S1–S7 with fixtures. One High defect and one Medium defect were fixed in this wave. The rest are listed above with severities. The engine-level S6–S8 expectations in the golden case remain covered by the deterministic eval suites. A UI-level re-run of S6–S8 for this pilot is blocked until D-3 and D-5 (and D-6 offline) are resolved.

## 7. Re-run after C-3

**Mode**: same as section 1. A production build on its own free port, a temporary SQLite DB, LLM, DART and web-research settings blank (no network call), public facts only, entered as the `analyst` through the browser. The only seeding was the two bootstrap accounts. Port 7749 was not touched.

### 7.1 Defect disposition

| ID | C-3 change | Observed in the re-run |
|---|---|---|
| D-2 | One source of truth. A deterministic-synthesis matrix (LLM off or failed) is stamped `synthesized` and graded **C** (`deriveDataConfidence`, F-5 rule). The report shows the stored grade, not a separate display value. An LLM estimate stays B, frozen research A. | The offline analysis stored C, and the report line read "데이터 신뢰도 등급 C (저장된 등급 — RAG 상한 기준) … cap C (deterministic synthesis, not a real estimate)". The old run stored B beside a "do not trust" banner. |
| D-3 | `industry_id` on `POST /api/opportunities` and `PUT /api/opportunities/{id}`, validated against `md_industry`. The S2 registration form has an "S1 분석 산업" select, and each funnel row can be linked afterwards. | The hand-entered opportunity was linked to "온라인 리테일(전자상거래)", and the S1 predicate found the matrix. |
| D-4 | Both gate-decision routes (and so the proposal-confirm path, which calls them) refuse GO with 409 `gate_prerequisites_incomplete`, naming the missing stages. HOLD and KILL stay allowed (KILL still needs learning capture). Existing rows are not touched. | Screening GO: 409 "S2 기회 발굴 미완료; S3 시너지·전략적 적합성 미완료". Pre-FS GO: 409 "S4 미완료". Target Screening GO: 409 "brownfield 트랙 결정 필요; S7 미완료". No `gate_decision` row was written. |
| D-5 / 4.1 | "알려진 대상으로 시작" on the deal board. `POST /api/opportunities` accepts `known_target`, which puts the named target into the S6 Long List (marked `[알려진 대상]`, with a discovery source) and pre-defines a Target Universe of one candidate. No predicate is skipped. The opportunity page shows a guide that links S1–S4 with the target as context. No migration. | Target "이베이코리아" was pre-filled into S6. The guide listed S1 완료, S2 지금 진행, S3/S4 대기. |
| D-6 | `PUT /api/market-overview/analyses/{id}/competitive` records the concentration summary and major players as a new analysis version. This is the field the S1 predicate reads. The competitive tab has a "경쟁 구조 직접 입력" form. | Naver 18%, Coupang 13%, eBay Korea 12% and SSG.com 3% were entered. The "경쟁 구조" requirement cleared. |
| D-7 | The pipeline's fallback segments are industry-agnostic (주요/보조/기타 수요처). The heavy-industry set stays only for legacy matrices that carry no segments. | The segments read "주요 수요처 / 보조 수요처 / 기타 수요처". 건설/광산 no longer appears. |
| D-9 | The S1 and S3 primary actions are labelled for what they do: "새 산업 분석 입력" and "새 시너지 평가 입력". | S1 shows "새 산업 분석 입력". |
| D-10 | A bare "Not found." in the review panel is replaced by a message that points back to the deal board. | Copy change only. |

Two more dead ends of the same kind as D-1 were found and fixed during the re-run. `/opportunities` showed "no review in progress" when no deal existed, so the S2 registration form was unreachable on a fresh install. `CarrierGate` now renders the S2 funnel inline in that case, and also for `?known_target=1`.

### 7.2 How far it now gets

**It still stops at S2, and this time the stop is legitimate.**

- S1 is complete: market size and growth (from the synthesized matrix, flagged), competitive structure (public shares), value-chain structure, and a stored confidence grade (C).
- S2 needs the opportunity attractiveness score (0–100). That is an internal judgement that the public record does not contain, and boundary #2 gives scoring to a person. With the LLM blank, the draft answers that a person must assess it.
- S3 (synergy score, fit rationale, sourced capability list, `selected`) and S4 (five-criteria route scores, alternatives) are internal judgements too. The deal then reaches S6/S7 with the named target already in place, but candidate screening evidence and the Kill Criteria inputs remain for a person to enter.

None of the stops is a product defect. Each is a missing non-public input or a human judgement. The synthesized S1 figures are not real market data (the banner says so and the grade is C). A person with the real S1 sources would replace them by re-analysing with an LLM configured or by seeding a researched matrix.
