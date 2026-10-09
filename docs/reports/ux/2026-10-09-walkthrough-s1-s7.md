---
lang: ko
lang_reason: source-material
---

# UX walkthrough S1-S7 (deal analyst), 2026-10-09

Scope: read-only hands-on walkthrough of S1 to S7 as a first-time analyst. Own server on port 7811 (production build, temp DB, demo seed + greenfield seed, offline LLM mode), Playwright at 1280x800 light. Screenshots: `docs/evidence/gui-review/walkthrough-2026-10-09/s1-s7/` Main commit 77aeb61e. Server stopped at the end.

Method note: clicks counted by script; "time" is wall-clock of the scripted run (machine speed, LLM off), so use click counts as the real signal.

## Task results

| Task | Result | Clicks | Time |
|---|---|---|---|
| T1 Start a brand-new market analysis for a new industry, from the board | Blocked by the intended entry. Only a workaround works: board -> "새 검토 시작" (lands on picker) -> pick an unrelated existing deal -> "+ 신규 산업 분석" -> name -> "분석 범위 선택" -> "이 산업만 분석" | 6 clicks + 1 text entry (intended path: 1 click, then stuck) | about 2.5 s UI + 4 s analysis |
| T2 Register an opportunity from that analysis | Works, but hidden. S1 rail "2" -> industry card -> "기회 발굴" (auto) or "+ 기회 등록" (no visible effect, form is below the fold) -> fill name/score -> 등록 | 3 clicks (auto) / 6 actions (manual) | about 6 s |
| T2b Move the new opportunity forward (S2 evaluate -> S3) | Only possible from the opportunity detail page, not from the S2 list | open row (1) + score+평가 (2) + "S3 탭으로 이동" (1) = 4 | about 5 s |
| T3 S3 synergy for the new opportunity | Blocker for a first-time user: needs group -> affiliate -> analysis, with no guidance | 5+ clicks and not completed (stopped at empty group list) | n/a |
| T4 S4 route decision | Reachable via rail; decision form is the 4th tab under a long card; LLM off so all manual | 2 clicks to the form | n/a |
| T5 S5 greenfield | Reachable; primary "타당성 검토 실행" disabled with a reason shown | 1 click | n/a |
| T6/T7 S6/S7 long and short list | Reachable; registering needs a target market definition first (empty state explains) | 1 click | n/a |
| T8 "Start from a known target" | Works: board -> button -> (scroll to find form, not clicked) -> name + target + 등록 | 4 clicks, 3 fields | about 3.5 s |

## Findings

Severity: blocker = task cannot be completed through the UI; major = task completes only with a workaround or wrong result; minor = friction.

### F1 (blocker) No "create new market analysis" entry on /market
- Route: `/market` (reached from board button "+ 새 검토 시작 (시장분석부터)")
- Screenshot: curated/F1-market-new-analysis-before.png
- Steps: /deals -> click "+ 새 검토 시작 (시장분석부터)". Page only says "여러 진행 중인 검토/안건이 있어 ... 선택하세요" and lists two existing deals. No create button, no back button, no breadcrumb.
- Impact: the board's primary "new" action cannot create anything. The only way to analyze a new industry is to open an unrelated deal's S1 and use "+ 신규 산업 분석", which has no hint it is meant for that.
- Fix: on `/market` show a primary "새 산업 분석 시작" (industry name + KSIC, same form as S1) above the deal picker, and make the new analysis independent of a deal. Rename the picker section so it does not read as the only option. Add a "검토/안건 보드로" back link.

### F2 (blocker) S3 requires Group -> Affiliate -> Analysis with no pointer
- Route: `/deals/<id>/s3`, `?surface=company`
- Screenshots: curated/F2-s3-empty-state-before.png, curated/F2-s3-empty-state-before.png, curated/F2-s3-empty-state-before.png
- Steps: S3 -> "새 시너지 평가 입력": panel says the target comes from a group profile created elsewhere; "분석 시작" disabled; no company list or link in the panel. Empty state says use "회사 등록", a button that does not exist (real names: "+ 새 분석", "새 시너지 평가 입력", "+ 그룹 등록").
- Fix: when no group exists, show an inline "그룹/계열사 프로파일 등록" CTA linking to `?surface=company` and a stepper "그룹 -> 계열사 -> 분석". Fix the empty-state copy to match real labels. Collapse the two redundant buttons ("새 시너지 평가 입력", "+ 새 분석") into one.

### F3 (major) Opportunity detail "← 목록으로" returns to a deal picker, not the S2 list
- Route: `/opportunities/<id>`
- Screenshots: curated/F3-opp-detail-back-before.png, curated/F3-opp-detail-back-before.png
- Steps: S2 list -> open an opportunity -> "← 목록으로" -> `/opportunities` shows "검토/안건 선택" picker (and the new, not-yet-promoted opportunity is not in it). Page also has no stage rail, no link to the deal, and no board link except the sidebar.
- Fix: link back to `/deals/<id>/s2` (or the originating S2 list with the same filters); add the stage rail and a breadcrumb "보드 / 이 안건 / S2".

### F4 (major) Stage-rail S8-S12 links use the opportunity id as project id
- Route: any `/deals/<oppId>/sN` of a promoted deal, rail items 8-12
- Screenshots: curated/F4-rail-s8-project-id-before.png
- Steps: demo deal S7 -> click rail "8 사업성 분석" -> `/projects/demo-s1-s12-opportunity/business-case" renders the shell with "Not found." and "불러오지 못함". The real project is "demo-s1-s12-project`.
- Root cause: `components/StageFrame.tsx` builds hrefs from the route param `params.id`, which on `/deals/<id>` is the opportunity id.
- Fix: resolve `opportunity.project_id` for promoted deals before building S8+ hrefs; disable S8+ rail items (with tooltip) for unpromoted deals.

### F5 (major) New opportunity cannot be advanced from the S2 list; header primary acts on a different deal
- Route: `/deals/<id>/s2`
- Screenshots: curated/F5-s2-header-action-before.png, curated/F5-s2-header-action-before.png
- Steps: S2 shows primary "스크리닝으로 승격 (S3)", which links to the S3 of the deal you entered through (the unrelated demo deal), not the opportunity just registered. Rows for new opportunities offer only "비즈니스 모델 검토" and "삭제"; promotion exists only inside the detail page after scoring.
- Fix: per-row primary "평가" / "S3로" action; make the header action name its target ("S3로: <기회명>") or hide it when the page has no selected opportunity.

### F6 (major) S1 report view has no way back to the industry list or forward to S2
- Route: `/deals/<id>/s1` after clicking an industry
- Screenshot: curated/F6-s1-report-nav-before.png
- Steps: the stage rail disappears; the only back control, "검토/안건 개요", goes to the deal overview. No "산업 목록으로", no "이 산업으로 기회 발굴 (S2)" CTA.
- Fix: breadcrumb "S1 시장분석 / <산업>", a "목록으로" link, and a primary "S2 기회 발굴로" handoff.

### F7 (major) Misleading synthetic numbers shown as headline values
- Routes: S1 report and S2 industry cards
- Screenshots: curated/F6-s1-report-nav-before.png, curated/F7-synthetic-values-before.png
- With LLM off, KPI tiles show "$1B", "-100.0%", "$0B"; the S2 industry card repeats "CAGR -100%". A red banner exists on the report, but the card and tiles carry no "합성/신뢰 불가" marker.
- Fix: render "—" plus a "합성 값" badge when provenance is deterministic synthesis; never propagate it to downstream cards.

### F8 (major) Known-target form is below the fold and the landing looks like plain S2
- Route: `/opportunities?known_target=1`
- Screenshots: curated/F8-known-target-before.png, curated/F8-known-target-before.png
- Steps: board "알려진 대상으로 시작" opens the S2 page with no mention of known target. The form is a collapsed "✍️ 기회 직접 등록" block at the page bottom. After submit, the detail page says "S1 시장분석 — 지금 진행" but offers no S1 link, no rail, no board link.
- Fix: for `known_target=1` auto-open and scroll/focus the form (or use a dedicated page), and after submit show a next-step CTA to S1 with the deal context.

### F9 (minor) "+ 기회 등록" button has no visible effect
- Route: `/deals/<id>/s2`. Clicking toggles a form that is far below the fold; no scroll, no focus move (`scrollY` stays 0, focus stays on the button). Two similar entries exist ("+ 기회 등록" and "+ 기회 직접 등록").
- Fix: scroll into view and focus the first field, or merge into one control.

### F10 (minor) S4 header copy points to a tab that is not visible
- Route: `/deals/<id>/s4`, screenshot curated/F10-s4-header-tab-name-before.png. Header says "의사결정 탭에서 ... 채우면 제안할 수 있습니다", but the tab is named "결정" and sits below a tall recommendation card, below the fold. Primary "진출방식 제안" is disabled with only a gray hint.
- Fix: align the name, put the tabs above the card or add an in-page anchor in the hint.

### F11 (minor) Stage rail "미적용" is inconsistent while route is undecided
- Routes: `/deals/<newOpp>/s5" marks 6 and 7 as 미적용; "/s6" marks 5 as 미적용 and says "진출방식이 Brownfield로 결정된" for a deal with no decision.. Screenshot: curated/F11-rail-miaejung-before.png.
- Fix: show both branches neutral until S4 is decided; reword the S6 copy as conditional.

### F12 (minor) /route-decision (bare) lists only promoted deals, read-only
- Route: `/route-decision`, curated/F12-route-decision-bare-before.png. In-flight opportunities (the ones needing S4) are absent; "승격됨" items are view-only. S5/S6 link to this page from "진출방식 결정 화면으로 이동" without a deal id.
- Fix: pass the deal id in those links, and list in-flight deals first.

### F13 (minor) Back-control labels are inconsistent
- The top-left back button reads "이전" (history based) on some loads and "검토/안건 개요" on others, and "프로젝트 개요" on projects. The /market and /opportunities pickers have none. Deal overview "단계 화면으로 이동" goes to S1 while the board shows the deal at S3 (curated/F13-back-labels-before.png).
- Fix: one consistent parent-based back plus a breadcrumb; have the overview's primary action go to the true current stage.

### F14 (minor) Industry-filter chips on S2 lag behind S1 additions; star toggles icon-only
- S1 list: "☆/★" buttons expose only the glyph as text (title and aria-pressed exist, so acceptable but add aria-label "핵심 산업 고정"). S2 "분석된 산업" cards update, but the S1 scope modal's linked-industry proposals show "미등록 — 자동 등록" with no checkboxes (cannot choose), curated/F14-industry-chips-before.png. Two primary-looking actions appear at once while the modal is open ("시장 규모 분석 실행" in the header plus "이 산업만 분석").

### F15 (minor) Layout glitch: "후보 등록" button overlaps the DART row
- Route: `/deals/<id>/s6`, `s7`; curated/F11-rail-miaejung-before.png, curated/F15-s6-overlap-before.png. The pill button floats over the field row (misaligned with "DART 검색").

## Back / board test summary
- Always works: sidebar "검토/안건 보드" and the logo (1 click) on every screen tested.
- No contextual back: `/market` picker, `/opportunities` picker, `/route-decision`.
- Wrong or stranded back: opportunity detail (F3), S1 report (F6), known-target landing (F8).
- Browser back button was never used.

## Priority order for fixing
F1, F2, F4, F5, F3, F6, F8, F7, then minors.
