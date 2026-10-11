---
title: Our-company (group and affiliate profile) UI refinement
status: proposed
date: 2026-10-11
owner: ux-designer-agent
domain: technical
---

# Our-company UI refinement (/our-company, S3 input)

Source: logged-in QA of `http://localhost:7748/our-company` on 2026-10-11 (group with 3 affiliates, 1280px)
plus code read of `app/web-next/app/our-company/page.tsx` and
`app/web-next/components/stages/our-company/{OurCompanyStage,GroupPanels,MembersPanel,useOurGroups,types}.ts(x)`.
The same `OurCompanyStage` is consumed by `/deals/[id]/s3?surface=company` (embedded mode); every change
below must work in both modes.

Korean UI strings are described in English. The implementer writes Korean wording by reusing existing
strings in these files or `app/web-next/lib/labels.ts`; label-key names below are proposed keys for
`labels.ts` (or a local `OUR_COMPANY_COPY` map), not new glossary terms.

## 1. Job to be done

Deal analyst: "Keep my group's affiliate profiles current so S3 synergy/fit evaluation runs on fresh,
correct inputs." The screen's jobs, in order: pick a group, see which affiliates are analyzed and how
fresh, open or (re)analyze one, maintain the roster (add, edit, role, evidence file, delete).

## 2. Findings addressed

| # | Finding | Resolution (section) |
|---|---|---|
| F1 | Three-sentence description in small text in page header | 3.1 |
| F2 | Emoji icons in section headings (building, factory, link) | 3.1 |
| F3 | Group selector: tiny chips, weak selected state, no status | 3.2 |
| F4 | Group header: edit/delete/register at equal weight; two identical primaries | 3.3 |
| F5 | Affiliate table: role select overflows (626 > 616), name indent, 5 row buttons wrap | 3.4 |
| F6 | No stale-analysis cue | 3.5 |
| F7 | 375px unverified | 3.6 |
| F8 | Empty/loading/error states undefined | 3.7 |
| F9 | S3 link explanation too long / buried | 3.1 |

## 3. Layout

### 3.1 Page header and S3 context

- `h1` unchanged (page title). Replace the paragraph with ONE line at `--fs-body`, `--muted-fg`:
  copy `ourCompany.s3Lead` ("This profile is the input to S3 synergy and fit evaluation."), reusing the
  existing sentence fragment.
- Below it a native `<details className="how-used">` (pattern already used in `CommitteePanel.tsx`,
  `StatusPage.tsx`) with summary `ourCompany.howUsed.summary` ("How this is used") and body = the two
  remaining existing sentences (DART financials for listed affiliates, research for all). Closed by
  default.
- Embedded mode (`/deals/[id]/s3`): the page header is not rendered (caller owns chrome); the details
  block is NOT shown there either (the S3 tab already provides context).
- Remove the `icon` prop values (building, factory) from `SectionToolbar` calls and the link emoji in the
  synergy-matrix h2. No replacement icon (text-only headings per Onyx section toolbar); `count` badge stays.

### 3.2 Group selector

- Region `<section aria-label="groups">` with `SectionToolbar` title "Analysis target groups" (existing).
- Render groups as a horizontal list of compact selectable cards using the existing button semantics
  (`aria-pressed`) - not tabs, because selection loads content below and also clears the open member;
  a pressed-button list keeps the current behaviour exactly. Container `role="group"` with
  `aria-label` = section title.
- Card: min-width 10rem, min-height 44px, padding `--space-2 --space-3`, border `--border`; content
  line 1 group name (semibold, ellipsis at 14rem with `title`), line 2 caption "affiliates N"
  (existing `sizing-chip-meta`).
- Selected state: `--accent` 2px border + `--accent-subtle` background + a leading check icon (Onyx
  icon, `aria-hidden`) so selection is not color-only. Unselected hover: `--surface-hover`.
- No analysis recency on the cards: `GroupRow` only carries `member_count` (see 5, open question Q1).
- Overflow: wraps (flex-wrap) at all widths; at 375px cards go full-width single column.
- "Register group" moves from a toolbar ghost button into this section's toolbar as a secondary
  (`btn-ghost`) action; the page-level `PrimaryAction` keeps "Register group" only when no group is
  selected (current logic), so there is never more than one primary.

### 3.3 Group detail header

`SectionToolbar` for the selected group:

- Title: group name (no emoji) + count badge (existing `count`).
- Meta line under title (caption, `--muted-fg`), derived client-side from `selectedGroup.members`:
  "analyzed X of N - last analysis YYYY-MM-DD" (`ourCompany.group.meta`), and the stale cue (3.5) if the
  newest `analyzed_at` is stale; "not analyzed yet" when none.
- Actions, left to right:
  1. "Register affiliate" as `btn-ghost` toggle (existing; aria-expanded kept). The page-level
     `PrimaryAction` stays "Add affiliate" (existing logic) - the in-toolbar toggle is secondary, so one
     primary per region holds.
  2. An overflow menu button "More group actions" (`ourCompany.group.more`, icon-only kebab with
     `aria-label`) containing: "Edit group name", separator, "Delete group" (danger styling, last item).
- Delete keeps the existing `confirm(...)` flow from `useConfirm()` / `ConfirmDialog` in
  `components/crud.tsx` (already wired in `removeGroup`). No change to the confirm copy.
- Edit group name keeps the existing inline input + save/cancel in the toolbar.

### 3.4 Affiliate table

Wrap in `<div className="table-scroll" tabIndex={0} role="region" aria-label="affiliate list">` and add
modifier class `members-list-table` on the existing `data-table list-table`:

```
.list-table.members-list-table { max-width: 72rem; min-width: 54rem; }
```

All columns scale together: a `<colgroup>` with PERCENTAGE widths that sum to 100 (no `auto` column, no
fixed rem widths on `th`), on top of `table-layout: fixed`. Below the min width the `.table-scroll`
wrapper scrolls horizontally. Shares are the `MEMBER_COL_PCT` constant (`constants.ts`):

| Column | Width | Content |
|---|---|---|
| Company name | 24% | name button: `min-width: 0`, `white-space: nowrap`, `overflow: hidden`, `text-overflow: ellipsis`, `title` = full name; `padding-inline: 0` so text aligns with the header |
| Role | 12% | select at `width: 100%` with `max-width: 100%; box-sizing: border-box`; existing `aria-label` kept |
| DART code | 14% | code or amber chip "code unconfirmed" (existing) |
| Analysis status | 18% | status chip (existing) |
| Analysis date | 14% | date; the stale cue sits on its own line below the date |
| Actions | 18% | one main action + overflow menu |

The confirmed-competitor table in the member detail uses the same rule (`COMPETITOR_COL_PCT`: 18 / 12 /
24 / 16 / 14 / 16, min-width 48rem, name cell ellipsis + `title`, inputs at `width: 100%`).

Role: keep the inline select (it saves immediately, behaviour unchanged). For viewers (`!canAct`) render
a read-only text chip instead of a disabled select.

Row actions (`.sizing-actions-cell`, nowrap, single line):

- Primary: "Open" / "Close" when analyzed (existing toggle); when not analyzed and `canAct`, the primary
  becomes "Analyze" (existing label). Rendered as `btn-ghost btn-sm`.
- Overflow menu button (kebab, `aria-label` "More actions for {company}") with items:
  "Re-analyze" (only when analyzed; shows "Analyzing..." disabled while loading), "Edit",
  "Evidence file" (triggers the existing hidden file input via ref click), separator,
  "Delete" (danger, last). Delete uses the existing `removeMember` -> `confirm(...)` flow.
- While editing a row, the actions cell shows "Save" / "Cancel" instead of the menu (existing).
- Viewers: only Open (if analyzed); no menu.

Overflow menu component: reuse the menu pattern in `components/StageTabs.tsx` (`role="menu"`) by
extracting a small shared `RowMenu` into `components/crud.tsx` if it cannot be imported as-is; do not
create a third menu implementation. Behaviour in 6.

### 3.5 Stale analysis indicator

- Named constant `PROFILE_STALE_DAYS = 90` in `components/stages/our-company/constants.ts` (open question
  Q2 for the value).
- A member is stale when `analyzed_at` exists and `today - analyzed_at > PROFILE_STALE_DAYS`.
- Date cell: date text followed by a clock/alert Onyx icon (`aria-hidden`) and caption text
  "stale" (`ourCompany.stale`) with `title` "Analyzed more than 90 days ago - re-analysis recommended"
  (`ourCompany.staleHint`). Text + icon, amber foreground token; never color alone.
- With 2026-09-17 and today 2026-10-11 (24 days), no cue appears; the test fixture must use an older date.

### 3.6 Mobile (below 640px)

Decision: keep the table with horizontal scroll (min-width 46rem inside `.table-scroll`), not a card
layout. Justification: max rows per group are small, the role select and actions are row-scoped, and the
name column stays first so it is visible without scrolling; this matches earlier list-table PRs.
Additional rules at <=640px: row action buttons and menu trigger min 44x44px; group cards full width;
toolbar actions wrap below the title.

### 3.7 States

| State | Region | Rendering |
|---|---|---|
| Loading groups | selector | existing "Loading..." text inside `aria-busy="true"` region; 2 skeleton cards optional |
| No groups | selector | existing empty copy; page `PrimaryAction` "Register group" |
| Group loading | detail | "Loading..." line with `aria-busy` while `loadGroup` runs (new client flag only) |
| Group with no affiliates | detail | existing empty copy (replace the full-width plus sign text with the button name); primary "Add affiliate" |
| Populated | detail | table |
| Error | page | existing `role="alert"` paragraph, moved directly under the header so it is seen; unchanged text |
| Analyzing row | row | status chip unchanged; primary/menu item shows "Analyzing..." disabled |

## 4. Copy table

| Key | English meaning | Source |
|---|---|---|
| ourCompany.s3Lead | This profile is the input to S3 synergy and fit evaluation | existing sentence, shortened |
| ourCompany.howUsed.summary | How this is used | NEW (Q3) |
| ourCompany.howUsed.body | listed affiliates use DART statements; all use analyst reports and industry research | existing |
| ourCompany.group.meta | analyzed X of N, last analysis {date} | NEW (Q3) |
| ourCompany.group.notAnalyzed | not analyzed yet | reuse "analysis pending" wording |
| ourCompany.group.more | More group actions | NEW (Q3) |
| ourCompany.group.edit / delete | Edit group name / Delete group | existing "edit"/"delete" + noun |
| ourCompany.row.more | More actions for {company} | NEW (Q3) |
| ourCompany.row.open/close/analyze/reanalyze/edit/evidence/delete | existing row labels | existing |
| ourCompany.stale / staleHint | stale / analyzed more than N days ago, re-analysis recommended | NEW (Q3) |

## 5. Data contract

None. All new information (analyzed count, last analysis, stale flag) is derived client-side from the
existing `GroupDetail.members[].analyzed_at` / `latest_version`. API calls, payloads, confirm flows, URL
`?member=` sync and embedded-mode behaviour are unchanged. If Q1 is answered yes, the only addition would
be `last_analyzed_at: string | null` and `analyzed_count: number` on `GroupRow` from
`GET /api/our-company/groups` (additive, no schema change - aggregate over existing columns).

## 6. Accessibility (WCAG 2.1 AA)

- Group cards: `button` + `aria-pressed`; container `role="group"` with label; visible focus ring.
- Role select: existing `aria-label` "{company} role change"; viewer read-only chip has text, not color.
- Overflow menus: trigger `aria-haspopup="menu"`, `aria-expanded`; menu `role="menu"`, items
  `role="menuitem"`; ArrowUp/Down move, Home/End, Enter/Space activate, Escape closes and returns focus
  to the trigger; Tab closes; click outside closes. Delete item announced with its danger meaning in text.
- Confirm dialogs: existing `ConfirmDialog` (focus trap and return assumed per crud.tsx; verify).
- Stale cue: text plus icon; chip colors paired with text.
- Touch targets >= 44px at 375px; `.table-scroll` focusable with label (existing focus-visible rule).
- Contrast for `--muted-fg` caption on surface meets 4.5:1 (token already compliant).

## 7. Success criteria (measurable)

1. No cell content crosses its cell box at 1280, 1024, 768 and 375 (measured: for each td child,
   child.right <= td.right). Specifically role select right edge <= DART cell left.
2. Each affiliate row renders at most 2 visible controls in the actions cell, on one line, at 1280.
3. At most one primary action per region (page PrimaryAction; one primary per row).
4. Delete (group and member) is reachable only inside an overflow menu and always passes `confirm`.
5. No emoji in any h1/h2/section title on the page (`design:lint` plus grep).
6. Header description is one line at 1280; long text is inside a closed `details`.
7. Stale cue appears for a fixture member with `analyzed_at` older than `PROFILE_STALE_DAYS`, with text.
8. `design:lint` and axe (accessibility-audit) zero new violations.

## 8. Preview verification

Breakpoints 1280, 768, 375; both `/our-company` and `/deals/{id}/s3?surface=company`. States: populated
(3 affiliates incl. one stale fixture), group with no affiliates, no groups (fresh DB or viewer of an
empty org), loading (throttled network), error (API 500 via devtools block). Keyboard pass: select group,
open row menu, Escape returns focus, delete confirm cancel returns focus. Viewer role pass.

## 9. ADR assessment

None required: no DB schema, auth, MCP tool scope, policy or procedure change. Display layer only.

## 10. Non-goals

- Profile report view (`ProfileSection`, tabs) and synergy matrix content (only its emoji is removed).
- Register-affiliate form redesign and DART search flow.
- Any change to analysis triggers, polling, or uploads.
- Card layout for the table on mobile.

## 11. Open questions (human)

- Q1: Should group cards show last-analysis recency? Requires the additive `GroupRow` fields in 5.
  Default: no (meta shown only in the selected group header).
- Q2: Stale threshold - 90 days proposed (quarterly reporting cadence). Alternative: 180 days.
- Q3: Korean wording for the NEW keys in section 4.
- Q4: Should viewers see the role as read-only chip (proposed) or the disabled select (current)?

## 12. Task split

| Row | Agent | Scope |
|---|---|---|
| 1 | backend-engineer | NOT needed unless Q1 = yes (additive `GroupRow` fields) |
| 2 | frontend-engineer | page.tsx header + details; GroupPanels (cards, emoji removal, toolbar); MembersPanel (toolbar menu, table wrapper/widths, row menu, stale cue, viewer chip); constants.ts `PROFILE_STALE_DAYS`; shared `RowMenu` in crud.tsx (reusing StageTabs pattern); styles.css `.members-list-table`, group card and `.how-used` rules with Onyx tokens; preview verification per 8 |
