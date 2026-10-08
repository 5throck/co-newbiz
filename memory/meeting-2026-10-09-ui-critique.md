# Meeting — Website Critique (UI/UX) — 2026-10-09

- **Facilitator**: pm (process owner; no opinions)
- **Participants**: ux-designer-agent, design-system-agent, frontend-engineer, i18n-specialist, process-governance-manager (**dissent seat**)
- **Rounds**: 2
- **Evidence**:
  - The user's screenshot of `/inbox` at about 1920px, dark mode.
  - `docs/evidence/gui-review/u3-s8-1280.png`.
  - `docs/evidence/gui-review/u3-deals-1280.png`.
  - The other u3-* screenshots.
- **Output**: a PROPOSAL. The user asked for the improvements to be carried out, and PM dispatches them through the normal gateway.

## Agenda
1. What looks wrong on the Decision Inbox, the deal board and the stage screens (S8 as the reference).
2. Root causes: component level vs. content level vs. data level.
3. A prioritized fix list that keeps the Onyx 3.0 doctrine and boundary #2.

---

## Round 1 — Findings

**ux-designer-agent**
- The inbox filter row has five fully filled blue chips. They read as five primary buttons, or as "all selected", so you cannot tell which filter is active.
- The deal board uses a different chip style (outline plus a filled active chip). There are two chip languages for the same job.
- On the deal board, "+ 새 검토 시작 (시장분석부터)" renders as a flat blue rectangle with no radius or padding. It looks like selected text, not a button, and it is the page's primary action.
- The inbox detail pane shows the 3-stage review block before the one thing the user came for, the link to the human-only control. The primary action is below the fold.
- On S8 the review block sits above the actual analysis content. The page's main job (reading the business case) is pushed down by a governance panel.
- The inbox detail metadata grid (종류/딜/경과/긴급도) is sparse, with large empty cells. At 1920px the page stops at about 1420px and leaves a dead band on the right.

**design-system-agent**
- The chip inconsistency is a component gap. There is no shared `FilterChip` with a `selected` state. Pages built their own: the inbox applies `btn-primary`-like fills to every chip.
- The "새 검토 시작" button is missing the button class entirely, likely lost in the U-3 PrimaryAction refactor (`PrimaryAction` was passed a link without the button variant).
- The review buckets are three equal narrow columns with long text. Line length is 18–22 characters, which forces scrolling. Bucket item bodies are indented twice (list indent plus card padding).
- The sidebar collapse control is a tiny "·" glyph with no visible affordance.
- In the screenshot, the Next dev indicator "N" overlaps the bucket card at the bottom right. It is dev-only, but it hid content during review.
- The stage stepper wraps to two rows at 1280px. The current-stage chip combines "8 사업성 분석 현재 FS" in one pill, which is noisy.

**frontend-engineer**
- Data bug in the inbox: the could-not-verify item renders "보완 필요: . Missing: .." The HOLD `missing` list is empty, and the string builder still joins the labels. This comes from `process-flow.ts`, where the HOLD blocker template is `${g} 진행 HOLD — 보완 필요: ${(missing).join(", ") || "근거 확인"}`, combined with the review AI-1st formatter that appends "Missing:" again.
- The badge counts disagree: the sidebar inbox says 1 (2 in the u3 shot) while the top bar says "알림 0". The two numbers come from different sources, and nothing explains why.
- The bucket layout uses fixed `grid-cols-3` with no min width per column. On narrower detail panes it should stack.
- The S8 review tabs label artifacts with raw spec strings ("S8 Business Case", "S8 Target 비교 분석"). These are artifact keys, not user labels.

**i18n-specialist**
- The review text mixes languages in one card. Bucket titles are bilingual ("확인됨 (Verified)"). The item bodies are English developer prose ("Deterministic check of the stage completion predicate (lib/process-flow); it proves the records exist…"), and the citations read "출처: AI 1차 · stage:S8".
- Korean users get internal file paths (`lib/process-flow`) and code identifiers. AI-1st reason strings are authored in English in `lib/review/ai-first.ts` with no locale catalog.
- The decision buttons and gate names mix too: "screening 게이트 HOLD 해소 대기" uses the lowercase gate id instead of the display name "Screening".
- Recommendation: a ko message catalog for review reasons and gate display names, with English kept only as a secondary tooltip.

**process-governance-manager (dissent seat)**
- I challenge the drift toward hiding the review block. The 3-bucket view and its "could not verify" list are a non-negotiable design element: silence must never read as approval.
- Moving the review below the content is acceptable only if it remains visible without an extra click on gate and decision screens. On the inbox, the reviewer must see "could not verify" BEFORE following the link to decide.
- So on the inbox I object to putting the primary link above the buckets unless the bucket counts (verified n / could-not-verify n / needs-judgement n) are shown next to the link.
- I also object to softening "확인하지 못함" into vaguer wording during the i18n cleanup. The exact meaning must survive translation.

## Round 2 — Responses and convergence

**ux-designer-agent**
- I accept the dissent. On the inbox detail I propose:
  - a header row: title, a 3-count summary strip (확인됨 2 · 확인 못 함 3 · 판단 필요 3), and the single primary link "게이트 화면에서 결정하기";
  - the full buckets directly below, expanded by default.
- On stage screens (S8), the content comes first. A compact review summary strip with the same three counts sits at the top and expands into the full buckets. On gate panels the buckets stay expanded.

**design-system-agent**
- I will add a shared `FilterChip` (selected state = filled, unselected = outline, `aria-pressed`) and replace the inbox and deal board chips.
- I will restore the button variant on the deal-board primary.
- The buckets become responsive: 3 columns at ≥1100px of container width, then stacked, with one indent level only.
- The inbox gets a two-column layout that grows to the full content width, and the meta grid becomes an inline definition row.
- The sidebar collapse control gets a proper icon button with a label.
- The stepper becomes a single row with horizontal scroll and the current stage centered. The FS gate badge moves to a separate small marker.

**frontend-engineer**
- I will fix the empty "Missing" join at the source and in the formatter.
- I will unify the badge count: the inbox badge counts open decision items, the bell counts unread notifications, and each gets a tooltip that says what it counts.
- Artifact display names will come from a label map derived from flow.spec, not the raw keys.
- The dev indicator is already moved; I will confirm it does not overlap content at 1920px.

**i18n-specialist**
- I will create a ko/en catalog for AI-1st reason codes, gate display names and bucket titles.
- The Korean bucket titles stay exact: "확인됨", "확인하지 못함", "판단 필요". English stays only in a `title` tooltip. Internal paths are removed from user text and kept in a developer details disclosure.
- I agree with the dissent that "확인하지 못함" must not be softened.

**process-governance-manager (dissent seat)**
- My objection is satisfied by the count strip next to the primary link and by buckets expanded by default on decision surfaces.
- **Remaining dissent, verbatim:** "On stage screens, a collapsed review summary risks being skimmed past. I want the could-not-verify count rendered in the warning color whenever it is non-zero, and the strip must not be dismissible." This is preserved as a condition on the proposal.

---

## Synthesized proposal (for user approval / PM dispatch)

| # | Fix | Owner | Priority |
|---|---|---|---|
| 1 | Data bug: empty "Missing: . Missing: .." join in HOLD blockers and the review formatter | frontend-engineer | P0 |
| 2 | Shared `FilterChip` (selected/outline, aria-pressed); replace inbox and deal-board chips | design-system-agent → frontend-engineer | P0 |
| 3 | Restore button styling of the deal-board primary "새 검토 시작" | frontend-engineer | P0 |
| 4 | Inbox detail: header with a 3-count strip + single primary link; buckets expanded below; full-width two-column layout; compact meta row | ux-designer-agent → frontend-engineer | P0 |
| 5 | Review text i18n: ko catalog for AI-1st reasons, gate display names and bucket titles; no file paths in user text (developer disclosure instead) | i18n-specialist → frontend-engineer | P1 |
| 6 | Stage screens: content first; non-dismissible review summary strip (could-not-verify count in warning color when >0) that expands to the buckets; gate panels stay expanded | ux-designer-agent → frontend-engineer | P1 |
| 7 | Responsive buckets (3 columns ≥1100px container, else stacked; single indent) | design-system-agent | P1 |
| 8 | Artifact display labels from a flow.spec label map instead of raw keys | frontend-engineer | P1 |
| 9 | Badge semantics: inbox = open decision items, bell = unread notifications; tooltips | frontend-engineer | P2 |
| 10 | Sidebar collapse icon button; single-row stepper with horizontal scroll and a separate gate marker | design-system-agent | P2 |

**Dissent preserved**: process-governance-manager's condition on item 6, quoted above.

**Verification**:
- design:lint, contrast:check, axe (0 serious/critical), test:e2e.
- Screenshots at 1280, 1920 and 390 in both themes, light and dark.
- Re-run the usability tasks T3 and T5.
