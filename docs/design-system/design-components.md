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
| ProjectSubNav | Tabs for moving between sub-screens within a project — Overview, Feasibility, Due Diligence, Investment Structure, Investment Review, etc. | Throughout the project detail screen |
| GateDecisionPanel | The card for selecting "Approve / Hold / Stop" and recording the reason and decision maker | Every screen requiring human approval |
| CommitteePanel | Panel showing committee member seating, score sheets, and meeting minutes | S4 and S11 committee review screens |
| ListBackButton | Button for returning to the list screen (behaves identically on every screen) | Any screen entered from a list into a detail view |
| data-table + .table-scroll | Table for showing list and summary data (scrolls horizontally when wider than the screen) | All screens |

## Rules to follow when building screens

- Every new detail screen must include ProjectSubNav. A screen built without these tabs becomes an "orphan screen" cut off from the other sub-screens, leaving users with no way to get back to other menus from there.
- Table headers and their data cells must use the same alignment (left/center/right) within each column. If the header is centered while the cells are left-aligned, the table looks visually misaligned.
- All reference documents, including this one, are read on the `/library` screen (a list + detail two-pane view), where each document is rendered in full on one screen without separate chapter splitting or page-navigation buttons.

## 🌐 External Reference — How component catalogs are managed in the industry

Traditionally, Atomic Design — classifying components with chemistry terms like "atom → molecule → organism" — was widely used. As of 2026, however, the industry trend is moving away from such abstract category names toward meaning-based naming, where the component's name itself immediately tells you what it does and where it is used. co-newbiz's component names (StageFrame, GateDecisionPanel, etc.) already follow this meaning-based naming and are in line with the trend. The industry also treats "you must be able to trace every element on a screen back to a standard component" as a core checklist item for a component catalog, and co-newbiz's rule that "new detail screens must include ProjectSubNav" is a concrete application of exactly that principle. For sources and details, see [docs/research/component-catalog-naming.md] (surveyed 2026-09-05).

## Source Mapping

| Claim | Basis |
|---|---|
| Component list | docs/architecture/ui-spec.md as-built, docs/designs/2026-09-01 standard screen patterns |
| Single list-return pattern | PR #219 design cleanup (ListBackButton consolidation) |
| Catalog naming practice | docs/research/component-catalog-naming.md |
