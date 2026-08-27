# Web Implementation Plan — co-newbiz Workflow Website (Onyx 2.0)

**Owner**: frontend-engineer
**Status**: Approved plan (v2, revised after 2026-08-27 review — 15 findings incorporated)
**Scope**: Extend `app/web-next/` (Next.js 16 App Router, React 19, Tailwind 4, Prisma/SQLite) with the co-price Onyx 2.0 dark design system, ECharts visualizations, and the remaining ui-spec.md surfaces — so the stage-gate review workflow (Screening → Pre-FS → FS → DD → Entity IC → Group IC) is operable end-to-end from the web.

---

## 1. Decisions of Record

| Topic | Decision | Rationale |
|---|---|---|
| Project structure | Extend existing `app/web-next/` | Reuses 67 built API routes, Prisma schema, auth, and 16 components |
| Design theme | Onyx 2.0 dark-only (co-price design system v5.0 adapted) | User selection; premium glassmorphism aesthetic |
| Chart library | ECharts via `echarts-for-react` (installed 2026-08-27: echarts 6.1.0, echarts-for-react 3.0.6, lucide-react 1.34.0) | User selection; strong financial-chart support |
| Icons | Lucide React | co-price parity |
| Fonts | System font stack + `font-variant-numeric: tabular-nums` first; JetBrains Mono webfont is optional follow-up | Avoids a webfont dependency for marginal gain (review finding 13) |
| Language | UI Korean; code/config/docs English | Existing policy (ui-spec §Status, docs/CONTEXT.md) |

## 2. Non-Negotiable Constraints (verified against the codebase)

1. **CSS token compatibility** (review finding 1 — critical): the 21 ported component files consume `var(--bg)`, `var(--green-bg)`, `text-[color:var(--red-fg)]` etc. as *complete color values*. The Onyx migration therefore **keeps every existing custom-property name and swaps only the values** to dark-only complete colors (no HSL triplets in existing names). New Onyx tokens (`--primary`, `--surface`, `--shadow-glow`, …) are added alongside. No component rewrite is required for the theme cutover.
2. **Dark-only changes a ui-spec rule** (finding 2): ui-spec §1 currently says "Dark mode supported" via `prefers-color-scheme`. Phase 1 updates that sentence (dark-only, `color-scheme: dark`) in the same changeset as the stylesheet — never after the fact.
3. **No empty-shell features** (findings 3, 9, 10): every new UI surface lands together with its backend route, or renders the established explicit "아직 API가 없습니다" note (the admin Database section pattern) — never placeholder data.
4. **Charts obey FR-SYS-05** (finding 6): icon/label + color together in every ECharts legend, tooltip, and axis; WCAG 2.1 AA contrast palette baked into the shared theme module.
5. **Governance sync per phase** (finding 5): each phase's definition-of-done includes ui-spec.md as-built marker updates, CHANGELOG `[Unreleased]` entries, and the `/sync` pipeline (memlog → audit → PR).
6. **Verification per phase** (finding 11): `bun run build` in `app/web-next/` (typecheck included) must pass before a phase closes.
7. **Route placement** (finding 12): new authenticated pages go under the existing `app/(app)/` route group where applicable; `/reports` follows the same gating as other pages via AppShell.

## 3. API Inventory Reconciliation (findings 7, 8, 9, 10)

Verified against all 67 `route.ts` files under `app/web-next/app/api/`:

**Available now (frontend can build immediately):**
- `GET /api/projects/[id]/rag` + `rag/history` → Overview RAG card + history sparkline (deferred view)
- `GET /api/projects/[id]/approval-chain` → gate progression bar (Entity IC → Group IC chain)
- `GET /api/projects/[id]/compliance-checks`, `waivers` → gate blocking/waiver display
- `GET /api/projects/[id]/industries/[industryId]/financials` → 5-year financial series charts
- `GET /api/projects/[id]/value-chain/topology`, `chain-sensitivities` → chain diagram (proxy-chain tab's substitute basis)
- `GET /api/series`, `series/[id]/observations`, `data-changes` → Data tab charting
- `GET /api/simulations/[id]/results` → histogram/CDF quantiles (charting layer only)
- `GET /api/runs/[id]/diff/[otherId]` → waterfall bridge charting

**Backend gap — requires companion API work in the same phase:**
- `GET /api/projects` does not return `rag_overall` / gate stage / staleness → Phase 2 adds a summary join (no per-card N+1)
- Reports page: no route exists (`document` table exists) → Phase 5 develops the route with the page
- Admin sections 6–10 (Notifications/rag_rule, Governance docs, Glossary queue, Master data, ADR index): no routes → Phase 4 builds each section **with** its route or ships the explicit no-API shell; per-section choice recorded in ui-spec at build time

**Explicitly deferred (insufficient data source):**
- ROIC driver-tree waterfall (no API; revisit after model engine) — financial tab v1 = time-series + composition charts from `industries/[id]/financials`
- Pure proxy-chain hop grading view (no API; topology-based chain diagram ships instead)

## 4. Milestones (order-based, no week estimates — finding 14)

### M1 — Foundation
1. ADR trigger check via `adr-governance` skill (design-system replacement, chart-library adoption, layout change are all design §7 candidates); draft ADR if triggered, **before** the change lands.
2. `styles.css`: Onyx 2.0 token cutover per constraint 1 (values swapped in place, new tokens added, `color-scheme: dark`, glass/btn-premium/card component classes, thin scrollbars).
3. ui-spec.md §1 dark-mode sentence update (same commit).
4. Common UI components: `components/ui/` — Button, Card, Badge, DataTable (Onyx styled, keyboard accessible).
5. AppShell: top-nav → sidebar + header layout (co-price pattern), responsive to tablet, admin-gated entries preserved.
6. `lib/echarts-theme.ts`: Onyx theme registration (AA palette, tabular-nums labels, text legends).
7. Verify: `bun run build`. Sync: ui-spec markers, CHANGELOG, `/sync`.

### M2 — Dashboard & Gate Visualization
1. Backend: `GET /api/projects` summary fields (rag_overall, rag_assessed_at, gate stage, stale) via one join.
2. Project list: RAG badge grid, gate progress bar (Screening → Group IC), filters (GF/BF, RAG grade), staleness badges — all consuming the new payload.
3. Overview tab: gate progression bar from `approval-chain` + `compliance-checks`/`waivers` blocking display; RAG history sparkline from `rag/history`.
4. Verify + sync (as M1.7).

### M3 — Project Detail Charts (ECharts)
Order: Simulation (histogram/CDF) → Model (waterfall/tornado from run inputs) → Version compare (waterfall bridge) → Data (series time-series) → Financial (time-series + composition, deferred-scope per §3) → Permits (node-link DAG replacing layered-list approximation, critical path highlighted) → Market & Chain (topology chain diagram) → M&A Review (HHI before/after bar, clawback exposure chart).
Each: FR-SYS-05-compliant theming, SourceTooltip provenance preserved, no chart without its API field.
Verify + sync.

### M4 — Admin Console Completion
Sections 6–10 per §3's gap rule (route + UI together, or honest no-API shell). Notification-threshold editing keeps the mandatory-ADR-reference hard block (FR-GOV/ui-spec §5). Audit-log screen gains no delete control (FR-SEC-07, unchanged).
Verify + sync.

### M5 — Reports & Close-out
1. `GET /api/reports` route (documents list, superseded chain) + `/reports` page + export controls (PDF via browser print first; DOCX/HWPX via existing report renderer where reachable).
2. Accessibility pass: `accessibility-audit` skill against every new screen (WCAG 2.1 AA), keyboard navigation for sidebar, charts, dialogs.
3. Final verify + sync.

## 5. Risks & Open Questions

| Risk | Mitigation |
|---|---|
| Onyx dark-only regression on 21 legacy components | Constraint 1 keeps var names stable; visual smoke pass of every existing route after M1.2 |
| ECharts bundle size in App Router | `next/dynamic` lazy import per chart component; no SSR for charts |
| Admin section scope creep (5 routes ≈ largest backend chunk) | Per-section route-or-shell decision recorded at build time; sections land independently |
| ui-spec as-built drift | Constraint 5 makes marker updates part of each phase's definition-of-done |

## 6. References (research standards)

- Planally — investment lifecycle workflow UX (phase visibility, decision gates) [Source: https://planally.com/investment-management, accessed 2026-08-27]
- DealRoom — diligence pipeline & milestone tracking patterns [Source: https://dealroom.net/product/due-diligence-software, accessed 2026-08-27]
- Midaxo — M&A platform structure (pipeline → diligence → PMI) [Source: https://www.midaxo.com/, accessed 2026-08-27]
- InetSoft — M&A dashboard KPI taxonomy [Source: https://www.inetsoft.com/info/mergers-and-acquisitions-dashboard/, accessed 2026-08-27]
- Stage-Gate International — gate review / checklist best practices [Source: https://www.stage-gate.com/blog/the-stage-gate-model-an-overview, accessed 2026-08-27]
- co-price (`../co-price/`) — Onyx 2.0 design tokens, component classes, layout patterns (local reference, read 2026-08-27)

## 7. Related

- `docs/ui-spec.md` — the IA this plan completes; as-built markers updated per milestone
- `docs/api-spec.md` — REST contract every new route must follow (envelope, membership filtering, MNPI, audit)
- `docs/process-map.md` — the stage-gate workflow the gate visualizations render
- `docs/srs.md` — FR-SYS-03/04/05 constraints carried into charts and tooltips
