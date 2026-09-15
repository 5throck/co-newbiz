---
lang: ko
lang_reason: source-material
---

# ADR-0120: Deal-centric workspace IA — one deal, one URL family, S1–S12 inside

- Status: Accepted
- Date: 2026-09-12
- Deciders: New Business Review Lead (PM)
- Deciders note: the 2026-09-12 audit showed a single deal's journey scattered across six top-level pages (/market → /opportunities → /synergy → /route-decision → /greenfield or /brownfield → /projects/**), each requiring re-selecting the entity, with four stacked navigation systems (sidebar 18 links, ProjectSubNav 14 flat links, StageRail, in-page anchors). Users experience the tool as "complex and hard to read" precisely because the process — the product's own spine — is not the organizing principle of the UI.
- Related: ADR-0074 (definition-driven UI — strengthened, not changed), ADR-0105 (navigation SSOT — nav structure revised, SSOT mechanism unchanged), ADR-0102 (auto-pipeline pause deep links — remapped), ADR-0086 (StageFrame stays the stage shell), ADR-0091 (role/screen separation — unchanged), ADR-0094/0095 (carrier model — unchanged)

## Context

The web surface grew stage-page by stage-page, mirroring implementation
history rather than the process model. The result violates the design
philosophy's own first principle ("stage-guided"): the sidebar groups are
tool-named (시너지 정합성, 추진 전략), the track split (S5 GF / S6–S7 BF) is
invisible until a user happens on the right page, and the S7→S8 carrier
handoff had no UI trigger at all until the 2026-09-12 P1 repair. Wayfinding is
stacked four deep before content begins.

## Decision

1. **`/deals` is the deal surface.** A board merges today's opportunity funnel,
   project S8–S12 snapshot, gate aging, and pipeline-paused chips. Every deal —
   opportunity (S1–S7 carrier) or promoted project (S8–S12 carrier) — is
   addressable as `/deals/{id}`, where `{id}` resolves either carrier via
   `source_opportunity_id` (the promotion backlink). Stage tabs live at
   `/deals/{id}/s1 … s12`; track-inapplicable tabs are hidden (S5 for
   brownfield, S6/S7 for greenfield), rendering the applicableTracks skip of
   flow.spec as navigation instead of prose.
2. **The sidebar becomes deal-first + reference.** Sections: 딜 (보드, 목록),
   참조 (시장분석·그룹/계열사·기업·벤치마크·라이브러리·용어집 — deal-independent
   analytical surfaces), 관리 (admin, role-gated per ADR-0091). Stage-named
   top-level entries disappear; the stage structure is carried by the deal
   workspace's stepper + tabs, which render from the spec (ADR-0074
   definition-driven UI is strengthened: the same `STAGE_META`/`STAGES` data
   drives sidebar, stepper, tabs, and completion guidance).
3. **Legacy stage pages become compatibility layers, then redirects.**
   `/opportunities`, `/route-decision`, `/greenfield`, `/brownfield`,
   `/projects/**` keep working during the migration phases (each wraps and
   delegates to the extracted stage components) and are 307-redirected to
   their `/deals/...` equivalents in the final sweep. Deep-link contract of
   ADR-0102 (`pauseLinkFor`) is remapped to `/deals/...` targets in the same
   change that introduces the workspace; the pipeline never gains new
   confirmation surfaces (boundary #2 regression tests stay green).
4. **Inside a deal, the stage tab IS the stage page.** StageFrame remains the
   single stage shell (ADR-0086); stage workloads are extracted into shared
   components consumed by both the workspace tabs and, transitionally, the
   legacy pages. ProjectSubNav's 14 flat links fold into the workspace's
   grouped sub-navigation (분석·실사·심의·사후 + 도구), and StageRail items link
   to the corresponding stage tab.
5. **Navigation registry discipline holds.** `lib/navigation.ts` stays the
   SSOT; `tests/unit/navigation.test.ts` is updated to pin the new section
   order as part of the implementing phase. New routes register in the same
   PR (ADR-0105 rule).

## Consequences

- One deal = one URL family; stage handoffs become in-workspace tab
  navigation with completion-driven next-step guidance, ending the
  re-select-the-entity loop and the S7 dead-end class of defects.
- Track branching becomes visible navigation: greenfield users never see
  brownfield tabs.
- Cost: a route migration with redirect debt and a navigation-test update —
  accepted in exchange for removing the four-stack wayfinding. Reference
  surfaces (market, our-company, companies, benchmarks, library, glossary)
  keep their URLs; only deal-scoped journeys move.

## Phasing

Ph2 design + mockup (this ADR + docs/designs/2026-09-12-deal-workspace-ui-redesign-design.md
+ mockup) → Ph3 primitives → Ph4 workspace skeleton + nav re-plane → Ph5/Ph6
page migrations + redirect sweep. Mockup approval by the review lead gates Ph4.
