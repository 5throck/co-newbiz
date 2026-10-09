---
lang: ko
lang_reason: source-material
---

# UX walkthrough S8-S12, gates, closure (2026-10-09)

Method: own production build and temp DB under /tmp/walk-s8s12, demo seed (gates left open, M&A sub-track DD), proxied on port 7812. Playwright-core, Chromium, ko-KR, analyst role. Viewports 1280x900 and 390x844. Curated before/after screenshots: `docs/evidence/gui-review/walkthrough-2026-10-09/curated/` (bulk screenshots moved out of the repository). Source code untouched.

Not covered: the IC-reviewer role was not exercised separately (the analyst holds the decision forms; no second login). "Confirm a decision proposal" was not reachable: with no LLM configured no proposal exists, `/agent-runs` shows "no committee proposals" and the Inbox is empty (curated/S14-inbox-empty-before.png, curated/S14-inbox-empty-before.png). The core-incorporation, divest and gate-KILL closure types were checked only up to their disabled/precondition state (curated/S8-closure-jargon-before.png); withdraw and kill-with-learning were executed. WACC and business-case generation were inspected, not edited.

## Task timing and click counts (click-only, from project overview)

| Task | Clicks | Time | Note |
|---|---|---|---|
| S8 open from overview | 1 | ~1 s | stage chip in the stage bar |
| S8 AI 2nd request | 1 | 3.5 s | result is "not performed: LLM provider is not configured" (raw English) |
| S8 HOLD (w/ missing artifacts) | 4 | 2.2 s | first attempt without the list: error only after submit |
| S8 GO | 3 | 2.1 s | no confirmation, no next-step prompt |
| S9 GO | 3 | 2.1 s | — |
| S9 open waiver form | 3 | 3.8 s | form is far below the table, no deep link from the row |
| S10 add hypothesis | 5 to open and fill (not submitted) | ~2 s | form hidden behind a collapsed link |
| S11 Entity IC GO + Group IC GO | 3 + 3 | 2.2 s each | both accepted although no Business Case is adopted |
| S12 KILL transition (w/ learning) | 3, 6 with the retry | ~2 s | one confirm dialog (only S12 has it) |
| Close, kill-with-learning | 5 | 4.0 s | lands on /projects/archives |
| Close, withdraw (from project list) | 5 | 3.4 s | — |

Back navigation: every project screen has a "< 프로젝트 개요" button (top left), a  bar, and the sidebar. No dead end found for back-navigation; the weaknesses are below.

## Findings

Severity: H = blocks or misleads a decision, M = slows or confuses, L = polish.

| # | Sev | Route | Finding | Screenshot | Repro | Suggested fix |
|---|---|---|---|---|---|---|
| 1 | H | /projects/:id/ic-review | Entity IC and Group IC GO are accepted while the page itself states "no adopted Business Case", RAG not graded, 5 establishment steps pending. No warning or confirm on GO. | curated/S1-ic-go-gap-dialog-before.png, curated/S10-establishment-before.png | Open S11, choose GO, type any rationale, click 결정 | Before recording, show an inline "open gaps" summary and require an explicit acknowledge; same for S8 GO with "채택 없음" |
| 2 | H | S8-S11 gate forms vs S12 | Inconsistent confirmation: S12 transition shows a confirm dialog; S8, S9, S11 GO/HOLD/KILL record instantly, form stays open and re-submittable, no toast, no "next: S9" CTA. Inbox badge/state refreshes only on reload. | curated/S2-gate-confirm-flow-before.png, curated/S2b-s12-confirm-before.png | Record GO at S8 | One shared confirm plus success state (decision chip, link to next stage), clear the form |
| 3 | M | all gate screens | Gate panel and the whole 3-stage review block are at the page bottom (S8 2.5k px, S9 3.3k px, S11 4k px at 1280; 6.5k at 390). The 3-stage review also appears twice (collapsed header + full copy in the decision panel). S11 repeats the full block for Entity IC and Group IC. Top CTA is a secondary action ("밸류에이션 재계산", "AI 2차 검토 요청") while the real primary (결정) is out of view; on S11 the top "결정 기록 (사람)" is disabled with a hint far from the field. | curated/S3-decision-reachable-top-before.png, curated/S10-establishment-before.png | Open any gate stage | One review block per gate, collapsed by default; sticky "record decision" action that scrolls to the form; make 결정 the stage primary |
| 4 | M | S8 /business-case?tab=* | The decision panel and 3-stage review repeat under every sub-tab (targets, params, WACC...). Two parallel tab rows ("요약/분석/WACC/재무분석" and "대상 비교·선정/…/WACC/재무분석"); WACC and 재무분석 exist twice. | curated/S4-s8-tab-merge-before.png, curated/S4-s8-tab-merge-before.png | Open S8 | Merge tab rows; show gate panel once or only in the 분석 tab |
| 5 | M | S9 /dd waiver | The row button "waiver" only says approval is needed in a tooltip; the request form sits below the checklist and does not scroll to it. Form layout broken at 1280: select overlaps the "조항" field, labels misaligned, textarea label offset. Submit "요청" disabled with no reason. Items bf-01..03 offer no waiver and no visible reason (tooltip only). | curated/S5-waiver-form-before.png | S9 > click "⚖ waiver" or "+ waiver 요청" | Open the form in a drawer prefilled with the item; grid layout; show the disabled reason as text; explain "no waiver path" on the row |
| 6 | M | S9 /dd | M&A 6 and special-topic checklist text is English (bf-01 ... "All six mandatory M&A validators run and recorded..."), while the commercial one is Korean; a custom item is tagged "맞춤". 100+ items with 4 buttons each; all pre-set to 충족 in the demo, so a reviewer cannot tell "judged" from "default". | curated/S6-s9-checklist-ko-before.png, curated/S6-s9-checklist-ko-before.png | S9 > "M&A 6대 검증" tab | Localize catalog text (or show a KO label with the English source); show who judged and when; add bulk filters for unjudged/failed |
| 7 | M | /projects/:id/dd and /wacc at 390 | Horizontal scroll (page 537 px wide). The checklist table is clipped: the judgement buttons are cut off. WACC has horizontal overflow too. Stage page height 5.3k px. | curated/S7-390-dd-wacc-before.png, curated/S7-390-dd-wacc-before.png | Resize to 390 on S9 | Card layout per item below 640 px; wrap the judgement control |
| 8 | M | S12 close dialog, S12/S8 errors | Internal jargon and English leak in user text: raw keys (`gate_decision(kill)`, `venture_transition_decision(...)`), English reasons ("A recorded gate KILL decision is required"), "ADR-0101 §2", "missing_artifacts(미완료 산출물 목록)", "LLM provider is not configured", "ADR-0143", "gate-primary", "★ RECOMMENDED", "origin∈{internal,joint}", "amber", "Business Case", "FS". The precondition links "게이트 결정 화면에서 기록" do not name the stage. Dialog needs inner scroll at 900 px height. | curated/S8-closure-jargon-before.png, curated/S8-closure-jargon-before.png, curated/S4-s8-tab-merge-before.png | S12 > 프로젝트 종료… | Map codes to Korean labels, move IDs under "개발자 세부정보", name the target stage in links |
| 9 | M | /projects/:id/deal-structure (S10) | Primary action unclear: top CTA "투자구조 저장" disabled with the reason only in tab text; the real action is "가설 기록" inside a collapsed "새 투자구조 가설 기록" link. S10 has no gate or "done" action. English enums in chips ("지분: majority", "수표: mixed"); "수표 믹스" looks like a mistranslation (cheque vs primary/secondary mix). Three tab levels (투자구조/부채, LLM 추천/가설/자금조달). | curated/S9-s10-primary-before.png, curated/S9-s10-primary-before.png | S10 > open form | Single primary "가설 추가" always visible; localize enums; fix the label |
| 10 | M | S11 establishment and PMI | Establishment 5 steps show status "대기" with no owner or action control: a dead end (no way to progress from the UI). PMI kickoff shows "기록됨" yet leaves the empty form open (re-recordable). Charter is only under S12 tabs, with S8's JTBD line "돈이 되는가?" and an empty body beyond "확정됨". | curated/S10-establishment-before.png, curated/S10-establishment-before.png | S11 scroll to 설립 실행 | Add owner/status actions or an explicit "tracked elsewhere" link; hide the form once recorded; fix the copy and show the charter content |
| 11 | L | closure | Closure is only on S12 and the project list ("종료…" next to a destructive "삭제"); S8-S11 have no entry. Archive shows the reason, not the closure type. After closing, there is no toast. Good: the dialog states the disabled reason ("제출할 수 없음: …") and the landing page is the archive. Label "학습 포착 (선택)" before choosing a type, then required for withdraw. | curated/S11-closure-archive-before.png, curated/S11-closure-archive-before.png, curated/S11-closure-archive-before.png | Close a project from the list | Separate/guard 삭제; show the type in the archive; keep the label consistent |
| 12 | L | sticky stage bar | The sticky stage bar is semi-transparent: scrolled content shows through behind it, and its top area covers headings. | curated/S8-closure-jargon-before.png, curated/S5-waiver-form-before.png | Scroll any stage | Opaque background |
| 13 | L | S8/S9/S12 AI 2nd request | Click gives no near-button feedback; the result ("not performed") appears inside the review block above. "개발자 세부정보" is visible to analysts. 2nd review with no LLM configured offers a dead action. | curated/S13-ai2nd-feedback-before.png | Click "AI 2차 검토 요청" | Disable with a reason or show a toast and scroll; hide developer details |
| 14 | L | /inbox, proposals | No path to confirm a decision proposal in an offline environment; the Inbox is empty and read-only; "결정 제안" has no empty-state hint on how proposals are created. | curated/S14-inbox-empty-before.png, curated/S14-inbox-empty-before.png | Open 결정 대기함 | Empty state with the creation path |

## Verified good

Back button on every screen; stage bar persistent; HOLD requires a missing-artifacts list and KILL a learning-capture field (field appears after choosing the type); closure dialog shows per-type preconditions; tab state in the URL (`?tab=`); no horizontal scroll at 390 on S8, S10, S11, S12.

## Environment notes

Server started with `TMPDIR=/tmp/walk-s8s12`, harness build (`bun --bun next build`; `app/web-next/tsconfig.json` shows as modified in git, which is likely a Next build side effect, not an edit by this walkthrough). The server was stopped and credentials were removed. Port 7749 was never touched.
