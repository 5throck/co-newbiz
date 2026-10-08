# Meeting — Website Critique Round 2 (Evidence-Based) — 2026-10-09

- **Facilitator**: pm (process owner; no opinions)
- **Why a second round**: Round 1 (`meeting-2026-10-09-ui-critique.md`) judged 3 screens from screenshots. It missed workflow failures. The user found that `/market` cannot start a new market analysis and that there is no way back. This round runs on hands-on walkthrough evidence.
- **Evidence** (2026-10-09, three walkthroughs on isolated servers):
  - `docs/reports/ux/2026-10-09-walkthrough-s1-s7.md`: 10 findings, 2 blockers.
  - `docs/reports/ux/2026-10-09-walkthrough-s8-s12.md`: 14 findings, 2 high.
  - `docs/reports/ux/2026-10-09-walkthrough-shell.md`: 73 routes × 3 roles, with axe.
- **Participants (11)**:
  - Design: ux-designer-agent, design-system-agent.
  - Build: frontend-engineer, i18n-specialist, platform-lead, security-engineer.
  - Users by stage:
    - market-intelligence-agent (S1/S2 user);
    - greenfield-agent (S5);
    - brownfield-agent (S6/S7/S10);
    - financial-analyst (S8/S9);
    - process-governance-manager (gates/IC/S11/S12).
  - **Dissent seat**: risk-officer.
- **Output**: a PROPOSAL. The user asked for the fixes to be carried out, and PM dispatches them through the gateway.

## Agenda
1. Task flows that cannot be finished (blockers).
2. Wayfinding: entry, exit, back, and orphan routes.
3. Decision surfaces: gate form placement, confirmation, and the boundary #2 warnings.
4. Visual and system quality: dark-mode contrast, 390px, the 404 page, titles, raw buttons.
5. Language: jargon and Korean/English mixing.

---

## Round 1 — Each seat names what blocks its own job

**market-intelligence-agent (S1/S2 user)**
- I cannot do my first task. "새 검토 시작 (시장분석부터)" lands on a picker of existing deals with no "new analysis" button and no back. The only path is to open an unrelated deal's S1 and use "+ 신규 산업 분석" (6 clicks).
- With the LLM off, the S1 tiles show $1B, −100% and $0B, and S2 repeats "CAGR −100%" with no synthetic marker. A fake number with no label is worse than an empty tile.
- The S1 report has no "next: S2" action and no rail.

**greenfield-agent (S5)**
- The stage rail marks 미적용 inconsistently while the route is undecided. I cannot tell whether S5 applies to me.

**brownfield-agent (S6/S7/S10)**
- "알려진 대상으로 시작" lands on a plain S2 page. The form is at the bottom, and the guide's "S1 지금 진행" has no link.
- On S6/S7, "후보 등록" overlaps the DART row.
- S10 has no clear primary: "투자구조 저장" is disabled and the real "가설 기록" hides behind a collapsed link. There are three tab levels, English enums, and "수표 믹스" is a mistranslation.

**financial-analyst (S8/S9)**
- S8 has two tab rows, and WACC and 재무분석 appear twice. The decision panel repeats under every sub-tab.
- On S9 the waiver form is far below the table, with no link from the row. It is broken at 1280 (select overlaps the clause field). "요청" is disabled with no reason. bf-01 to bf-03 show no explanation of why they cannot be waived.
- The M&A checklist is in English while the commercial one is Korean. Every item is pre-judged 충족, so I cannot tell judged from default.
- At 390px, S9 scrolls horizontally and the judgement buttons are clipped.

**process-governance-manager (gates/IC/S11/S12)**
- Gate recording is inconsistent. S12 asks for confirmation; S8, S9 and S11 record instantly with no toast and no next-stage prompt, and the form stays open and can be re-submitted.
- On gate screens the decision form sits 2.5k–6.5k px down the page, below a duplicated review block. On S11 the review is repeated for Entity and Group IC.
- S11 establishment steps have no owner or action control, so they cannot be progressed. The PMI kickoff form stays open after "기록됨". The charter is reachable only from the S12 tabs and carries S8's "돈이 되는가?" tagline.

**ux-designer-agent**
- The root failure is wayfinding:
  - about 13 orphan or legacy routes;
  - four picker pages with no h1, no active sidebar item and no back;
  - "목록으로" going to the wrong place;
  - the S8–S12 rail links on opportunity pages using the opportunity id ("Not found.").
- Round 1 looked at pixels, not journeys. We need one rule: every page has a title, a way back (breadcrumb), and a primary next action.
- S3 tells the user to press "회사 등록", a button that does not exist.
- A new opportunity cannot be advanced from the S2 list: the header button acts on the deal you came in with, not the new one.

**design-system-agent**
- Dark mode fails contrast (serious) on about 60 of 73 routes. The cause is the shared tokens `.btn-primary`, `.control-chip` and `--primary-bg`, so the fix belongs in tokens, not per page.
- The 404 page is the stock Next.js page: English, no way back, unthemed in dark mode.
- About 20 raw `<button>` elements have no design class.
- Loading skeletons misuse `aria-label` on a div (33 axe nodes).
- Every page has the same `<title>`; 8 routes have no h1.
- There is 390px overflow on `/brownfield`, `/greenfield`, dd, `/companies` and wacc.

**frontend-engineer**
- The rail bug is in `StageFrame.tsx`, which uses `params.id` for S8+ links. It needs the promoted project id from the opportunity.
- Gate recording should use one shared flow: confirm dialog → toast → the form closes into a "recorded" summary → a next-stage prompt.
- Picker pages need a create action and a breadcrumb, plus a smart default: when exactly one deal exists, or after "new review", go straight to a create form.

**i18n-specialist**
- Jargon leaks into the UI: `gate_decision(kill)`, `missing_artifacts`, "LLM provider is not configured", ADR numbers, "★ RECOMMENDED", `origin∈{…}`, "FS" without a label.
- Labels are mixed: inbox "알림 / 딜" against "검토/안건" elsewhere; the DD tabs Commercial/Technical/Legal; "Run"; "Hurdle IRR"; "…security 설계…".
- Proposal: one glossary-backed label map for gates, stages and enums. ADR references go into developer disclosures only.

**security-engineer**
- Role gating is silent: a viewer opening `/admin/*` lands on `/deals` with no message, and viewers see analyst primary buttons on `/deals`, S4, S8 and S9. Server-side enforcement must be verified, and the UI must hide or disable actions with a reason.
- `/proposals/bogus/confirm` returns 200 with a normal shell, and `/oauth/authorize` with no params shows a consent page. Both must show explicit error states.

**platform-lead**
- Scope control: this is a wayfinding and decision-surface fix, not a redesign. Orphan routes either get an entry point or are removed or redirected with a notice; nothing stays silently reachable.
- The walkthrough produced about 54 MB of screenshots. Committing all of them bloats the repo. Commit the reports plus a curated subset (one screenshot per finding), and keep the rest out of git.

**risk-officer (dissent seat)**
- I challenge two directions:
  1. Adding a confirm dialog to every gate is fine, but "IC GO accepted with no adopted business case, an ungraded RAG and 5 pending establishment steps" must NOT be "fixed" by blocking the human. Boundary #2 says humans decide. Blocking a recorded human verdict on artifact completeness would turn the system into the decider.
  2. Hiding synthetic numbers entirely risks hiding that a model ran at all.

## Round 2 — Convergence

**process-governance-manager**
- I accept the risk-officer's point.
- For IC GO with missing artifacts: show a blocking-style warning dialog that lists each missing item (adoption, RAG, establishment) and requires a typed rationale to proceed. The human can still record GO.
- This differs from C-3's prerequisite guard. That guard covers stage completion. The entity_ic gate's own artifacts are evidence for the human, not prerequisites.
- **Dissent noted:** I would prefer blocking IC GO when no business case is adopted at all. I yield to boundary #2 on condition that the override rationale is stored and shown in the IC package.

**market-intelligence-agent**
- Synthetic numbers: show "합성 추정 (검증 안 됨)" badges and replace −100% / $0 with "산정 불가" when the inputs are degenerate. This keeps the risk-officer's visibility point.

**ux-designer-agent**
- I propose a page contract for every route:
  - a document title per page;
  - an h1;
  - a breadcrumb (deal › stage › tab);
  - one primary action;
  - an explicit empty state with a create action.
- Pickers become list + "새로 만들기" + breadcrumb.
- `/market` gets "새 시장분석 시작" as its primary, which opens the new-industry form directly.

**design-system-agent**
- Dark-mode contrast gets fixed at the token level and verified by axe dark runs across all routes in E2E.
- Add a themed, Korean 404/error page.
- Add a lint rule rejecting class-less `<button>`.
- Fix the skeletons with `role="status"`.

**security-engineer**
- Viewer UI: action buttons are hidden, or disabled with the text "보기 권한만 있습니다". Admin redirects show a notice.
- Verify that the server rejects viewer writes, and add tests.
- The invalid proposal and OAuth params get explicit error pages.

**financial-analyst**
- S8: merge the tab rows into one. The decision panel appears only on a "결정" tab or as a sticky footer action.
- S9: put an inline waiver action on each row, show the reason when it is disabled, add an explicit non-waivable explanation, translate the M&A checklist to Korean, add a "판정 대기" default state (not pre-judged 충족), and make the layout responsive at 390.

**brownfield-agent**
- S10: a single primary "투자구조 가설 기록", two tab levels at most, Korean enums, fix the "수표 믹스" term (instrument mix → "지급 수단 구성").
- Known-target entry: land on a focused form, and make the guide steps links.

**risk-officer (dissent, final, verbatim)**
"I accept the warning-with-rationale design for IC GO. My remaining dissent: the S9 change from pre-judged '충족' to '판정 대기' must not silently re-open DD for in-flight projects — grandfather existing judgements, or every live deal regresses at S9 overnight."

---

## Synthesized proposal

| Batch | Fixes | Owners |
|---|---|---|
| **R2-A Blockers & wayfinding (P0)** | 1. `/market`: "새 시장분석 시작" primary + breadcrumb; the board "새 검토 시작" opens the new-analysis form directly. 2. Pickers (`/market`, `/opportunities`, `/route-decision`, `/synergy`) get h1, breadcrumb, create action and active nav. 3. Rail S8–S12 links use the promoted project id; hide them if the deal is not promoted. 4. S3 "회사 등록" dead reference fixed with a real link or create action. 5. A new opportunity can be advanced from the S2 list (row action). 6. "목록으로" targets and breadcrumbs everywhere; the S1 report gets rail + next-step. 7. Known-target entry lands on a focused form with linked guide steps. 8. Orphan routes linked or redirected with a notice. | ux-designer, frontend-engineer |
| **R2-B Decision surfaces (P0/P1)** | 1. Shared gate-recording flow: confirm → toast → recorded summary (no resubmit) → next-stage prompt. 2. Decision form reachable at the top: a "결정" tab or sticky action; review shown once per gate. 3. IC GO with missing artifacts: a warning dialog listing the items plus a required rationale, stored and shown in the IC package (no blocking; boundary #2). 4. S8 single tab row and decision panel once. 5. S9 inline waiver per row, disabled reasons, non-waivable explanation, Korean M&A checklist, "판정 대기" default for NEW items only (grandfather existing judgements — dissent). 6. S10 one primary, ≤2 tab levels, Korean enums and terms. 7. S11 establishment steps with owner/action controls; the PMI form collapses after recording; charter reachable from S11 with the right tagline. | process-governance-manager, financial-analyst, brownfield-agent → frontend-engineer |
| **R2-C System quality (P1)** | 1. Dark-mode contrast fixed in tokens; axe dark across all routes in E2E. 2. Themed Korean 404/error page with a way back. 3. Per-page document titles and h1. 4. 390px overflow fixes. 5. Lint rule against class-less buttons; fix about 20. 6. Skeleton `role="status"`. 7. Synthetic-value badges and "산정 불가" for degenerate values. 8. Glossary-backed label map; jargon and ADR refs moved into developer disclosures; Korean/English consistency. 9. Viewer action gating with a reason; admin redirect notice; server-side write tests. 10. Error states for an invalid proposal and for OAuth with no params. | design-system, i18n-specialist, security-engineer → frontend-engineer |
| **R2-D Verification** | Re-run all three walkthroughs after the fixes. Acceptance: no blocker or high finding, axe 0 serious/critical in light AND dark on all routes, and every task completes with UI-only navigation. Commit the reports plus one screenshot per finding; keep bulk screenshots out of git. | ux-designer, design-system |

**Dissent preserved**:
- risk-officer on S9 grandfathering, verbatim above.
- process-governance-manager's preference to block IC GO with no adopted business case. It yielded on the condition that the rationale is stored and shown.
