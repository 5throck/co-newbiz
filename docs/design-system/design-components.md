---
governance_doc_id: gov-des-03
layer: docs-content
title: "Key Component Catalog"
scope: co-newbiz
owner_agent: frontend-engineer
version: "1.0.0"
effective_from: "2026-09-05"
lang: en
counterpart: design-components_ko.md
---
# How recurring screen pieces get reused

Like LEGO blocks, once the pieces that make up a screen are built well, they can be taken and used as-is across many screens. Such reusable screen pieces are called **components**. Instead of building things from scratch every time, combining already-proven components prevents designs from drifting subtly from screen to screen and speeds up development. The actual implementation code lives in `app/web-next/components/`, and the following are the representative components used repeatedly across co-newbiz screens.

| Component | What it does | Where it is used |
|---|---|---|
| StageFrame | The skeleton of each stage screen (the slots for title, description, and body) | All stage screens S1–S12 |
| StageTabs | Tabs for moving between sub-screens within a project / deal — replaces the retired ProjectSubNav (2026-10-22 review: the catalog's subject component no longer exists; StageTabs carries `role="tablist"`, `aria-selected` + `aria-current="page"`, and the ESC-restorable 더보기 menu) | Throughout the project/deal detail screens |
| GateDecisionPanel | The card for selecting "Approve / Hold / Stop" and recording the reason and decision maker | Every screen requiring human approval |
| CommitteePanel | Panel showing committee member seating, score sheets, and meeting minutes | S4 and S11 committee review screens |
| ListBackButton | Button for returning to the list screen (behaves identically on every screen) | Any screen entered from a list into a detail view |
| data-table + .table-scroll | Table for showing list and summary data (scrolls horizontally when wider than the screen) | All screens |
| list-table (data-table modifier) | Standard for LIST tables — tables that render per-row actions. Fixed column layout, width-capped at 64rem, every column headed | All list screens (S1 산업 목록, S2 기회 퍼널, 계열사 목록, 시너지 분석 목록, admin users/business targets) |

## Rules to follow when building screens

- Every new detail screen must include StageTabs. A screen built without these tabs becomes an "orphan screen" cut off from the other sub-screens, leaving users with no way to get back to other menus from there. (Formerly ProjectSubNav — renamed with the component's 2026 replacement; the rule is unchanged.)
- Table headers and their data cells must use the same alignment (left/center/right) within each column. If the header is centered while the cells are left-aligned, the table looks visually misaligned.
- **List-table standard**: any `.data-table` that renders per-row actions (`sizing-actions-cell`) must also carry the `list-table` class. The standard fixes the failure mode where the label column (기회명·산업명) — the only unconstrained column in an auto-layout table — absorbs all leftover screen width and pushes the score/action columns to the far right edge, detaching them from the names they describe. Rules: (1) `.list-table` applies a fixed column layout capped at 64rem; (2) every column except the primary label column carries an explicit width class; (3) every column is headed in the accessibility tree — the actions column header is a visually hidden (`sr-only`) `작업`: sighted readers need no label for self-evident row buttons, screen readers still announce the column (2026-09-15 readability report); (4) long status chips wrap inside their column instead of overflowing. (5) date columns (YYYY-MM-DD) carry the `col-date` class — 7rem standard width, no wrap — so the date never folds onto two lines. design-lint fails row-action tables that omit the class or the actions header.
- **Local-component decisions (2026-10-26, dry-run console)**: (1) `AgentCombobox` (`app/web-next/app/flows/dry-run/agent-combobox.tsx`, ARIA 1.2 editable combobox over the domain-grouped agent roster) is **not** catalogued. It has a single consumer (`flows/dry-run/[sessionId]`), and its props are bound to the roster (`BlueprintAgent[]`, domain grouping from `dry-run-ui-lib`), so it is domain-specific rather than a generic picker. It stays local and composes existing input/menu styling with no new tokens. Re-evaluate for catalog registration when a second consumer appears or the props are generalized to an option-group list. (2) `--doc-figure-max: 40rem` (`.library-doc-body`, `styles.css`) is **not** promoted to a token: exactly one surface (the `/library` document body) uses it. Promote it to a named layout token only when a second surface needs a capped figure width.
- All reference documents, including this one, are read on the `/library` screen (a list + detail two-pane view), where each document is rendered in full on one screen without separate chapter splitting or page-navigation buttons.

## 🌐 External Reference — How component catalogs are managed in the industry

Traditionally, Atomic Design — classifying components with chemistry terms like "atom → molecule → organism" — was widely used. As of 2026, however, the industry trend is moving away from such abstract category names toward meaning-based naming, where the component's name itself immediately tells you what it does and where it is used. co-newbiz's component names (StageFrame, GateDecisionPanel, etc.) already follow this meaning-based naming and are in line with the trend. The industry also treats "you must be able to trace every element on a screen back to a standard component" as a core checklist item for a component catalog, and co-newbiz's rule that "new detail screens must include StageTabs" is a concrete application of exactly that principle. For sources and details, see [docs/research/component-catalog-naming.md] (surveyed 2026-09-05).

## Source Mapping

| Claim | Basis |
|---|---|
| Component list | docs/architecture/ui-spec.md as-built, docs/designs/2026-09-01 standard screen patterns |
| Single list-return pattern | PR #219 design cleanup (ListBackButton consolidation) |
| Catalog naming practice | docs/research/component-catalog-naming.md |
