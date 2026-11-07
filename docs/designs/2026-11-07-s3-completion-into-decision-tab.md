---
lang: ko
lang_reason: source-material
---

# S3 completion moves into the decision tab — UX handoff

Status: proposed handoff (design only, no code). Pattern: standard stage screen (tabbed result + single primary action). Components: `PrimaryAction`, `.status-chip` (green / not-started / amber), `.market-section`, `GateDecisionPanel` (unchanged), `SynergyTabs` tab bar. No new tokens/components; nothing escalated to `design-system-agent`. No icons added (✓ ○ ● are text glyphs, `aria-hidden`, P5).

## 1. JTBD
- Persona: deal analyst (writes), IC reviewer (reads only).
- Job: after reading the synergy analysis, decide "do we carry this opportunity into S4?" and record that once.
- Input -> output: confirmed synergy score + recorded rationale (from the score-evaluation tab) -> opportunity `status: selected` (PUT `/api/opportunities/[id]`, existing route; audit row stamped server-side) -> S4 `/deals/[id]/s4`.
- Defects fixed: (a) two places record the same decision (SynergySelectPanel vs GO record both -> `selected`); (b) the completion ask sits above the analysis it depends on; (c) 3-line checklist is permanent chrome; (d) "완료" chip is glued to the sentence (inline `—` + chip, no wrap/gap).

## 2. Above the tabs: one compact status line (replaces SynergySelectPanel there)
A single `role="status"` row under the toolbar; never a button when not complete, so it never competes with the primary.
- Before completion: `○` text + info sentence + a text link-button "의사결정 탭으로 이동" calling `onTab("decision")` (then focus the decision section heading). Secondary style (`btn-ghost btn-sm`), not primary.
- After completion: `[✓ S3 완료]` chip (`status-green`) + the `PrimaryAction` "S4 진출방식 결정으로 이동 →" (href `/deals/[id]/s4`, `readOnly` so reviewers can navigate).
- Layout fix: flex row, `gap` token spacing, `flex-wrap`, chip `white-space: nowrap`, sentence in its own span (no inline `—` joiner). Wraps to two lines at 375px; chip never splits from its label.

## 3. Inside the 의사결정 tab — placement order (top to bottom)
1. Completion checklist (`SynergySelectPanel` body, moved): heading "S3 완료하기", 3 rows (점수 확정 / 근거 기록 / 기회 선택). Each row = glyph + label on the left, chip on the right as its own flex cell (fixes glue). Rows 1-2 link to the score-evaluation tab when pending.
2. Primary action "이 기회 선택" directly under the checklist (disabled with visible reason when blocked).
3. Selected banner (only after selection): chip + who/when from the existing GO/selected record + "S4 진출방식 결정으로 이동 →" (primary, see §4).
4. `GateDecisionPanel` (screening gate, formal GO/HOLD/KILL record) — unchanged component, same `selected` outcome, now directly below so it reads as the formal record of the same decision. Caption: "이 선택은 아래 GO 기록과 같은 결과(selected)로 이어집니다." The GO form submit stays `btn-ghost` (already is), so it never becomes a second primary.
5. Existing hint "GO로 기록하면 ... S4로 자동 이동" and the inline "지금 바로 S4로 이동 →" link: keep only the hint; drop the duplicate link (replaced by the primary in step 3).

## 4. Single-primary rule (exactly one `.btn-primary` visible at any time)
| State | Above tabs | Decision tab |
|---|---|---|
| Score not confirmed | existing "save fit evaluation" primary (`t("saveFitEvaluation")`, shown while score unconfirmed) stays the sole primary; status line is info-only | "이 기회 선택" not rendered as primary; checklist shows blocker; no primary |
| Confirmed, not selected | info line + ghost jump link (no primary) | "이 기회 선택" = primary |
| Selected | "S4 ... 이동 →" = primary | S4 action repeats as a **secondary** (`btn-ghost`) link at the end of the tab; no second primary |
Rule: on the decision tab after selection the above-tabs S4 button is the sole primary; the end-of-tab S4 link is ghost. Before selection the tab's "이 기회 선택" is the sole primary and the top line carries no button primary.

## 5. States (decision-tab block)
- Loading: status fetch pending -> button disabled, reason "상태 확인 중…" (`aria-describedby` via `PrimaryAction`); checklist rows show `대기` chips; status line shows skeleton-free text "상태 확인 중…".
- Load failed: reason "기회 상태를 불러오지 못했습니다." + ghost "다시 시도" (calls refreshStatus) in the same block.
- Blocked (disabled, reason visible text, not tooltip-only), precedence kept from today: score unconfirmed -> rationale missing -> role -> status identified -> status not selectable.
- Ready: all prerequisites met, status `assessed`, role analyst -> primary enabled.
- Saving: label "저장 중…", `aria-live="polite"` text; double-click guarded.
- Error on select: `role="alert"` caption under the button, button re-enabled.
- Selected: green `✓ 선택 완료` row, S4 actions per §2/§4. Re-visit after reload shows the same (status read from the persisted record, P3).

## 6. Copy (ko / en) — reuse existing `stages.s3.synergySelectPanel.*` keys where unchanged
| Key (new = *) | ko | en |
|---|---|---|
| panelTitle | S3 완료하기 | Complete S3 |
| selectAction | 이 기회 선택 | Select this opportunity |
| goToS4 | S4 진출방식 결정으로 이동 → | Go to S4 route decision → |
| statusLinePending* | S3는 아직 완료되지 않았습니다. 의사결정 탭에서 완료하세요. | S3 is not complete yet. Finish it in the Decision tab. |
| statusLineJump* | 의사결정 탭으로 이동 | Go to Decision tab |
| statusLineDone* | ✓ S3 완료 | ✓ S3 complete |
| sameResultNote* | 이 선택은 아래 GO 기록과 같은 결과(selected)로 이어집니다. | This selection leads to the same outcome (selected) as the GO record below. |
| retryStatus* | 다시 시도 | Retry |
Blocker strings (blockerConfirmScoreFirst etc.) unchanged. Per CLAUDE.md language policy the app copy follows ko/en locale files; this doc stays English.

## 7. Accessibility (WCAG AA, both themes)
- Status line `role="status"`; checklist is an `<ol>` with `aria-label`; glyph `aria-hidden`, state also in chip text (no color-only).
- Jump link moves focus to the decision-section heading (`tabIndex={-1}`) after `onTab("decision")` and the tab switch sets `aria-selected`; DOM order: tab bar -> status line -> panel.
- Keyboard order in the tab: checklist links -> primary -> GateDecisionPanel form; no focus trap; visible focus ring (token).
- Disabled reasons are text linked with `aria-describedby`; chips use existing `status-*` tokens (contrast verified by design-lint in light/dark).
- 375px: checklist rows stack label over chip; primary full-width.

## 8. Handoff to frontend-engineer
- Contracts (real, unchanged): GET/PUT `/api/opportunities/[id]` (`status` assessed -> selected), `synState` (confirmed, synergyRationale) from `useSynergyResult`, `advanceToRouteDecision`, `GateDecisionPanel` props.
- Changes: split `SynergySelectPanel` into `SynergyCompletionStatusLine` (above tabs, props: `completed`, `onJumpToDecision`, S4 href) and the checklist+primary body rendered in the `tab === "decision"` block; lift the `selected` status to one place (SynergyResult) so the line and tab share it with no duplicate GET; remove the `goToS4Now` duplicate link; add locale keys in en.json + ko.json.
- Reasoning: one decision place removes the double-record path without changing ADR-0094 boundary #2 (selection stays an explicit human click; AI never selects); status line keeps the stage-linkage cue visible on every tab.

## 9. Success criterion (measurable)
1. On `/deals/[id]/s3` every tab renders at most one `.btn-primary` (DOM assertion across all states in §4).
2. "S3 완료하기" checklist and "이 기회 선택" exist only inside the decision tab (0 occurrences outside it).
3. From any tab before completion, analyst reaches "이 기회 선택" in <= 2 interactions (jump link -> primary); after selection reaches S4 in 1 click.
4. Chip and sentence never share a text node and never split at 375px (visual/e2e snapshot ko + en, light + dark).
5. Exactly one network GET of opportunity status per page load; design-lint and existing synergy tests pass.
