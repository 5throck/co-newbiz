---
lang: en
counterpart: dashboard-screen-patterns_ko.md
---

# Research Note — Dashboard and Business Screen Pattern Classification Standard Practices

> 🌐 External reference material. Researched: 2026-09-05. For comparing the industry practices behind the P0–P5 standard screen pattern classification.

## Standard Practices

1. **Layout standard**: fixed left sidebar + top search/user/action bar + card-based content area —
   even as menus grow from 5 to 50 items, collapsible groups maintain orientation. Best suited to
   internal tools and CRUD-heavy admin screens
2. **Dashboard taxonomy (3 categories)**: **operational** (real-time tracking of daily operations),
   **analytical** (exploring historical data and discovering trends), **strategic** (high-level KPI
   summaries for executives) — the distinguishing criterion is that dashboards, unlike reports
   (point-in-time snapshot documentation), are designed for continuous monitoring and immediate action
3. **Decision-support design principles**: one clear verdict per screen, build hierarchy with typography
   and whitespace rather than boxes, reserve color exclusively for status, progressive disclosure —
   design should start from the **decision** the user actually has to make, and the layout should follow
   that decision
4. **Registry-style data management**: group related metrics under clear labels, arrange visual hierarchy
   so the 3–5 most important metrics are read first, drill down from summary to detail, and manage
   complexity with tabbed sub-views
5. **Academic classification axes**: data abstraction (raw/aggregated/derived), visual encoding, meta
   information, spatial layout, interaction, role-based adaptation — among structural patterns, the
   "drillboard" organizes a dashboard as a hierarchy of chart leaves (atoms) and chart groups (internal
   nodes), enabling dynamic drill-down from high-level overview to detail

## co-newbiz mapping

- P1 Registry (lists·registries), P2 Report (report viewing), P3 Decision (adjudication·scoring),
  P4 Execution (execution·checklists), and P5 Monitoring (dashboards) correspond to a further refinement
  of the industry's operational/analytical/strategic 3-category taxonomy plus CRUD/report patterns into
  five — P5 is closest to an operational dashboard, and P2 closest to the analytical report family.
- "One screen, one purpose" (design-philosophy principle 3) is identical to the "one clear verdict per
  screen" principle.
- P0 Shell (common skeleton: header·sidebar·StageRail) matches the structure of the industry-standard
  layout (fixed sidebar + top bar) — when designing a new screen, this standard layout practice can serve
  as the baseline against which deviations are checked.

## Sources

- Setproduct, "Dashboard UI design: From KPIs to layouts that convert" — https://www.setproduct.com/blog/dashboard-ui-design (accessed 2026-09-05)
- AdminLTE.IO, "Admin Dashboard Design: Principles, Layouts & Examples (2026)" — https://adminlte.io/blog/admin-dashboard-design/ (accessed 2026-09-05)
- Emergent Mind, "Dashboard Design Patterns" — https://www.emergentmind.com/topics/dashboard-design-patterns (accessed 2026-09-05)
