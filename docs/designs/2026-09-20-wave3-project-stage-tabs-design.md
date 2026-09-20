# ADR-0120 Wave 3 — Project-Carrier Stage Tabs (S8~S12)

- Spec ID: `2026-09-20-wave3-project-stage-tabs`
- Date: 2026-09-20
- Status: **Implemented**
- Related: ADR-0120, `2026-09-19-adr0120-wave2-all-phases-design` (S1~S7 pattern), ADR-0094/0095 (carrier model)

## Requirements

- REQ-W3-1: The five project-carrier stage screens (S8 `사업성 분석`, S9 `실사`, S10 `투자구조`, S11 `투자심사`, S12 `포트폴리오`) are consumable inside `/deals/[id]/[stage]` tabs — Wave 2 covered S1~S7 only.
- REQ-W3-2: Carrier resolution follows ADR-0094/0095: a carrier that is an opportunity id resolves to its promoted `project_id`; a carrier that is already a project id is verified through `GET /api/projects/{id}/process` (membership-safe, GET-capable) and used as-is. An unpromoted opportunity shows a friendly empty state.
- REQ-W3-3: Tab-based screens (S8, S10) keep URL `?tab=` sync on their legacy pages and hold the tab in local state in embedded mode — no `router` writes away from the deals route.
- REQ-W3-4: Legacy pages keep working unchanged as wrappers.

## Design

- Same extraction convention as Wave 2: bodies moved to `components/stages/BusinessCaseStage.tsx`, `DdStage.tsx`, `DealStructureStage.tsx`, `IcReviewStage.tsx`, `PortfolioStage.tsx` (pages become `main`-shell wrappers). One documented Wave-2 precedent exception applies: `ProjectSubNav` + `StageFrame` are bound to `projectId`, so the stage components render them and callers provide only the main shell.
- `ProjectStageTab` in the deals stage page resolves the carrier once (opportunity GET → `project_id`; fallback `projects/{id}/process`) and renders the mapped stage component.
- The deal-structure page body's in-content `Link` to a sibling tab becomes a `setTab` button so it works in both modes.

## Verification

- [x] `bunx tsc --noEmit` clean; `bun run design:lint` clean; `bun run test:unit` green
- [x] Live: legacy pages 200; deals S8 via opportunity carrier (sub-nav, stage frame, tab nav, scenario table, fs gate); S9 checklist; S10/S11/S12 via project carrier (`비히클·4축` / `IC 패키지` / `스코어카드`); unpromoted-carrier path renders the resolve error path (no friendly-mislead)
