---
lang: ko
lang_reason: source-material
---

# S6/S7 Screening Pre-Check Restore (t-01~09 Verdict Recording and Visibility)

- Spec ID: `2026-09-16-s6s7-screening-precheck-restore`
- Date: 2026-09-16
- Status: implemented
- Related: [2026-09-15 S6/S7 eval registration + redesign mockup](2026-09-15-s6s7-eval-registration-and-redesign-mockup.md), [2026-09-16 brownfield eval auto-draft](2026-09-16-brownfield-eval-auto-draft-design.md)

## Problem

The 2026-09-15 S6/S7 redesign removed the t-01~09 screening verdict strip from
the Long List expanded row, but three consumers of that data survived: the
Short List "인수 가능성" excerpt section (t-01/t-02/t-08), the committee-basis
comment, and the server-side `screening_json` merge route. With no writer left,
every verdict stayed `미판정` forever, the "인수 가능성 우려" chip could never
appear, and `saveScreening`/`generateScreeningDraft` on `/brownfield` became
dead code.

The user requirement (2026-09-16): the target-longlist-shortlist-committee
deliberates on t-01~09 (ADR-0097; role-separated from the financial/technical
ranking scores), so pre-review must show which items have been checked per
candidate, and verdicts must be recordable again.

## Design

1. **Recording surface — candidate detail page.** The verdict strip moves to
   `/brownfield/targets/[targetId]` as a new `사전 검토` (screening) profile
   tab, placed between 공시 and 평가. It renders all nine checklist items with
   a 4-value select (충족/미충족/해당없음/예외 + 미판정), a `판정 저장` button
   (existing `POST /api/brownfield/[oppId]/targets/[targetId]` states merge
   route), and a `판정 초안 생성 (웹검색)` button (existing `screening-draft`
   route; drafts fill pending items only, saved human verdicts are kept).
   Knock-out fail and pending-mandatory items are surfaced as alerts.
2. **Detail API.** `GET /api/brownfield/targets/[targetId]` additionally
   returns `checklist` (from `screeningItems()`) and `screening_summary`
   (from `screeningSummary()`). Additive change, no consumer breakage.
3. **Long List visibility.** The Long List table gains a `사전 검토` column
   rendering the per-candidate `assessed/total` chip (red `knock-out 실패`
   state included; tooltip lists pending mandatory items). The summary uses
   the `screening_summary` field the list API already computed but the UI
   never displayed.
4. **Committee brief.** `buildEvalBriefMd` switches its basis back to t-01~09:
   one markdown table, one column per checklist item, verdict labels plus an
   assessed/total cell, with the financial·technical combined score kept as a
   secondary context column and a legend stating the role separation.
5. **Dead code removal.** `/brownfield` main page drops the orphaned
   `saveScreening`, `generateScreeningDraft`, `screeningDraft`/`screeningReco`
   state, and the unused `VERDICTS`/`EVAL_VERDICTS` constants. The detail
   header card gains a `사전 검토 {assessed}/{total}` chip next to the score
   chips. The Short List `인수 가능성` cards are upgraded from bare
   `미판정` text lines to a `판정 n/9` progress chip, color-coded verdict
   chips with item short-labels, and a deep link to the candidate's
   pre-check tab (the detail page honors `?tab=screening`).
6. **Checklist coupling note.** The `chk-target-screening` yaml NOTE now lists
   all three coupled UI surfaces (Short List excerpt, detail pre-check tab,
   committee brief).

## Boundaries preserved

- Short List promotion stays gated on financial/technical evaluation
  completion (user decision 2026-09-15); t-01~09 verdicts remain advisory
  pre-review evidence, not a promotion gate.
- Committee output is a proposal; gate decisions stay human (ADR-0097).
- LLM screening drafts fill pending items only; final verdicts are human.
- No schema change; `brownfield_target.screening_json` is reused as-is.

## Addendum — same-day repositioning (user decision 2026-09-16)

User feedback after the restore clarified the checklist's role and surfaced a
rank-visibility bug:

1. **chk-target-screening is a Short-List final check.** The checklist exists
   to examine candidates that have already been promoted to the Short List
   ("are there any problems?"), not to pre-screen the whole Long List. The
   Short List section was therefore expanded from the t-01/t-02/t-08 excerpt
   ("인수 가능성") to the full t-01~09 verdict strip per shortlisted candidate,
   renamed `사전 검토`, with a section-level readiness chip (`전 후보 검토
   완료` / `미완료 n/m`). The Long List `사전 검토` column now shows the
   progress chip only on shortlisted rows (pending rows show `—`); recording
   remains available on every candidate's detail tab.
2. **Committee = final reviewer proposing to the human.** An explicit line
   above the committee panel states the role: the committee reviews the Short
   List on the 사전 검토 verdicts and proposes the Target Screening gate
   decision to the human (proposal-only, ADR-0097 boundary). Committee label
   updated accordingly; an amber `사전 검토 미완료 n/m` chip warns when
   deliberating before verdicts are recorded.
3. **Eval rank persists after promotion.** `pendingRank` (pending rows only)
   made the 잠정 순위 column go `—` the moment a candidate was promoted or
   excluded. Replaced with `evalRank` over all non-excluded candidates with a
   combined score: pending rows keep the active provisional rank, shortlisted
   rows keep showing their rank muted (reference — the displayed Short List
   order stays the human-adjusted rank), excluded rows show `—`.

## Addendum 2 — surface consolidation (user decision 2026-09-16, later same day)

Follow-up feedback: chk-target-screening still lingered as "사전 검토" surfaces
on the candidate detail screen and the Long List. The checklist now has exactly
one recording/display surface and one consumer:

1. **Long List column removed.** The `사전 검토` column is gone from the table
   entirely — the checklist has no Long-List role.
2. **Detail tab removed.** The `사전 검토` profile tab (and its header chip,
   state, save/draft functions, `?tab=` deep-link support) is removed from the
   candidate detail page; the additive `checklist`/`screening_summary` fields
   on `GET /api/brownfield/targets/[targetId]` are reverted (no consumer).
3. **Inline recording on the Short List section.** Each shortlisted candidate
   card in the `사전 검토` section now carries the nine items with compact
   selects, a per-card `판정 저장` button (existing `screening_json` merge
   route), and a per-card `판정 초안 생성 (웹검색)` button (screening-draft
   route; fills pending selects only). This section is the single place the
   checklist is exercised; the committee consumes the verdicts as its final-
   review basis and proposes the gate decision to the human.

## Addendum 3 — integrated committee pre-check flow + evidence persistence

User feedback (2026-09-16, third round): the pre-check and the committee were
still separate surfaces, and the UI implied the human must judge all nine items
by hand. Also, collected information should be persisted (registration,
re-analysis, committee pre-check) and referenceable later from the candidate
detail screen.

1. **Integrated "위원회 추천 검토" flow.** The Short List section becomes
   `사전 검토 · 위원회 추천` with one primary button. One click runs all
   shortlisted candidates through the enhanced screening-draft route, which
   now (a) reuses already-secured information — DART 5-year financial facts,
   the company AI profile, and recent disclosure titles — without re-searching
   it, (b) web-searches only the items the secured data cannot judge
   (t-08 재무적 매력도 is judged purely from secured financial facts when
   available), and (c) returns per-item verdict proposals with rationale,
   source, and an evidence kind (`secured` | `web`). Per candidate a
   deterministic `추천안` badge (추천 / 보류 — 정보 부족 / 제외 검토, from the
   Part-1 knock-out items t-01~t-05) summarizes the proposal; the human
   reviews, edits selects, and confirms via `판정 저장`. The committee panel
   now lives inside the same section and its convening brief includes the
   not-yet-confirmed proposals (marked as such).
2. **Evidence persistence.** Migration 0108 adds
   `brownfield_target.screening_evidence_json` (per-item rationale, source
   URL, kind). The verdict-save route accepts an `evidence` map and merges it
   alongside `screening_json` (evidence for items re-set to pending is
   dropped), and records a `screening` timeline row. Migration 0109 adds
   `brownfield_target_evidence` — a per-candidate evidence timeline
   (`discovery` at candidate registration with the proposal rationale/source,
   `analysis` when the company AI profile is re-analyzed for linked targets,
   `screening` for pre-check runs and human confirmations).
3. **Candidate detail upgrade (read-only archive).** The detail page gains a
   `사전 검토 근거` tab, visible only when collected data exists. It shows the
   confirmed verdict strip with per-item rationale/source/kind chips, the
   standing recommendation (deterministic, from confirmed knock-out verdicts),
   and the evidence timeline. Recording stays exclusively on the
   /brownfield Short List section; the detail tab is a reference archive.

Same-day layout change (user proposal): the per-candidate cards were replaced
by a **transposed table** — checklist items are the column headers (grouped
`Part 1 — 필수 (knock-out)` spanning t-01~t-05 and `Part 2 — 권장 평가`
spanning t-06~t-09, full item text in tooltips), Short List candidates are
rows, and each cell is a single verdict select (evidence compressed to
tooltips, a `기` secured-marker, and a source link). The 후보 cell carries the
recommendation and progress chips; the 확정 column carries per-row save /
re-draft actions. This suits cross-candidate comparison during committee
review.

## Addendum 4 — proposal coverage + button de-duplication (same day)

User feedback: the duplicate `초안 재생성` row button was indistinguishable
from `위원회 추천 검토` (same operation, different scope), and most items
received no proposal. Fixes:

1. **One button.** The per-row `초안 재생성` is removed; `위원회 추천 검토`
   is the single trigger and is idempotent — re-running it keeps confirmed
   verdicts and re-proposes only the remaining pending items (stated in its
   tooltip).
2. **Search queries rebuilt.** Queries were `company + first 40 chars of the
   item sentence` (near-zero recall). Now each item searches
   `company + short label` plus `company + first sub-clause` (two queries,
   merged and deduped by `researchSources`).
3. **All open items are judging candidates.** Previously only items with
   web-search evidence were even offered to the LLM, so a weak search
   silently emptied the proposal set. Now every pending item is listed; the
   LLM judges from the secured block (DART facts / AI profile / disclosure
   titles) plus per-item web evidence where present, and omits only items
   with no support at all (anti-fabrication instruction kept, system prompt
   updated in the prompts registry). The response note now states
   `n/m 제안 (기확보 x + 웹검색 y) — 나머지는 근거 부족` so partial coverage
   is explicit.

## Addendum 5 — single committee trigger (same day)

User feedback: the standalone `위원회 추천 검토` button duplicated the
committee panel's role, and per-cell 출처 links broke the table row heights.

1. **One trigger.** The standalone button is removed. `CommitteePanel` gains
   optional `beforeConvene` / `conveneLabel` props (backward compatible): the
   S6/S7 panel's button — `위원회 추천 검토 · 소집` — first runs the evidence
   collection + proposal pass for all shortlisted candidates, then convenes
   the committee with a brief built from those proposals (the hook returns the
   fresh brief text synchronously, avoiding a stale-closure convene). The
   table remains the human review surface; `판정 저장` confirms.
2. **Cell layout.** The per-cell 출처 link (block element under the select)
   was breaking row alignment; evidence now lives in the select tooltip
   (rationale + source URL) and, durably, in the candidate's `사전 검토 근거`
   archive tab. The `기` secured-marker stays inline.

Boundaries preserved: every LLM output is a proposal until the human saves
(경계 #2); the committee proposes, the human records the gate decision
(ADR-0097); promotion gating stays on financial/technical evaluation
completion.

## Addendum 6 — granular verdict scale + committee = recommendation (same day)

User feedback: verdicts cannot happen without sufficient search; the
committee's role is to decide the recommendation FROM the verdicts; the
pass/fail scale is too coarse; and `해당없음`/`예외` do not belong in this
checklist.

1. **5-level verdict scale** (replaces pass/fail/na/waived):
   `confirmed` 충족(근거 명확) · `probable` 충족(추정) · `partial` 부분 충족 ·
   `unfulfilled` 미충족 · `insufficient` 근거 부족(DD/추가 확인 필요). The LLM
   must assign one of the five to EVERY open item — `insufficient` is a
   first-class honest verdict, which is what makes full proposal coverage
   compatible with the anti-fabrication boundary (nothing is invented;
   unknowns are labeled). Legacy stored values (`pass`/`fail`/`na`/`waived`)
   are normalized on read (`normalizeVerdict`), no data migration needed. The
   save route validates only the new scale.
2. **Committee = recommendation decider.** The deterministic `추천안` rule
   becomes 4-tier from Part-1 knock-outs only: `제외 검토` (any unfulfilled),
   `보류 — 근거 부족` (any insufficient/pending), `조건부 추천` (any partial),
   `추천` (all confirmed/probable). The committee's LLM deliberation stays the
   formal proposal step on top of these verdicts (ADR-0097).
3. **Deeper search.** Per item: 3 query variants (company+short label,
   company+first sub-clause, label+second sub-clause) × up to 6 merged
   results; LLM budget raised (1800 tokens) to justify all nine items.
4. Shared verdict constants/labels/normalization live in
   `lib/brownfield-precheck.ts` (client-safe); the prompts-registry
   `s7.screening_draft` system prompt was rewritten for the scale and
   regenerated; `tests/unit/web-research-ddg.test.ts` now clears the global
   research test-override so the provider chain is testable in combined runs.
5. **Judgment anchors + explicit agenda** (user questions on t-03/t-05/t-07
   perspectives and the committee agenda). The secured block now also carries
   (a) the opportunity's 목표 시장 정의 (definition/criteria/scope — the anchor
   for t-03 지역 적합성: the candidate's 사업 거점 is judged against THE
   opportunity's own region criteria; regional support/incentives are
   secondary evidence only), (b) the S3 capability-gap register with held
   status, and (c) the candidate's confirmed technical-evaluation verdicts
   (ADR-0139) — (b)+(c) are the direct anchors for t-05 역량 적합성 and
   t-07 역량 보완성 (gap-filling potential vs internal overlap), already
   secured so no re-search. The committee brief now opens with an explicit
   `# 안건` section (target candidates, requested decision: 추천/조건부
   추천/보류/제외 검토 per candidate; final GO/HOLD/KILL stays human) and is
   persisted with the session so later rounds deliberate the same agenda.

## Impact

- Files: `app/web-next/app/brownfield/page.tsx`,
  `app/web-next/app/brownfield/targets/[targetId]/page.tsx`,
  `app/web-next/app/api/brownfield/targets/[targetId]/route.ts`,
  `checklists/target-screening-checklist.yaml`.
- No new routes, no schema migration, no ADR needed (UI-surface restoration
  within the ADR-0097/ADR-0139 role separation already decided).
