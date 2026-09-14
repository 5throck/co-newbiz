---
lang: ko
lang_reason: source-material
---
# Design: System mode deletion gate, capability register relocation, and S4 evidence flow (2026-09-15)

- Status: implemented
- Related ADRs: [ADR-0133](../adr/0133-system-mode-gates-deal-deletion.md), [ADR-0134](../adr/0134-remove-standalone-fit-verdict.md)
- Related migrations: 0100_system_mode.sql (additive-only)

## Requirements

1. Deal data (projects, opportunities) must be undeletable while the system runs in production; development environments keep the existing tombstone-delete capability for test-data cleanup. Mode switching is admin-only, via the admin console.
2. The standalone strategic-fit verdict (`fit_verdict`) is redundant with the `screening 진행 권고` and must be removed as a user-facing concept.
3. The capability-level register (구 `역량 갭`, renamed `필요 역량 수준`) belongs to S3: it must live on `/synergy`, auto-derive from the synergy analysis's own synergy areas on new analysis and re-analysis, and feed S4's 평가 근거 tab and capability-related 5-criteria scoring as direct evidence.

## Design

### 1. System mode (ADR-0133)

- `system_setting` (`key`/`value`/`updated_by`/`updated_at`), seeded `system_mode='production'` — fail-closed: a missing row reads as production.
- `db/lib/system-mode.ts`: `getSystemMode` (defaults production), `setSystemMode`.
- `DELETE /api/projects/[id]` and `DELETE /api/opportunities/[id]`: 403 `production_mode_delete_blocked` immediately after the role check when production. No other DELETE route is gated (routine record management is out of scope — user decision).
- `GET/POST /api/admin/system-mode` (`requireAdmin`; POST validates mode ∈ {production, development}, audited `system_mode_set`).
- `/admin/system-mode` page + `SystemModeSection` component; registered in `ADMIN_NAV`; switching to development requires inline confirmation. Existing tombstone-delete semantics unchanged; no hard-delete endpoint exists.

### 2. Fit-verdict removal (ADR-0134)

- `opportunity-screening.ts`: delete `runFitAnalysis` + `industryContext`; `gateRecommendation()` = attractiveness ≥ 60 AND synergy ≥ 60 → Go; attractiveness < 60 OR synergy < 40 → Kill; else Hold.
- `screening/route.ts` GET-only; OpenAPI updated. `fit_verdict`/`fit_rationale`/`fit_source` columns stay (additive-only convention) but nothing reads or writes them.
- UI: S4 decision-tab fact grid drops 적합성 card; `/opportunities/{id}` drops the badge; `/synergy` never gains the interim fit block.

### 3. Capability register → S3 with pipeline derivation

- UI moved from `/opportunities/{id}` tab (removed; pointer line left on the S3 panel) into `/synergy` 연계 시너지 tab below the synergy-area table. Same APIs (`/api/opportunities/{id}/capability-gap`, `.../llm-draft`).
- Rename 역량 갭 → 필요 역량 수준 in user-facing strings only (track-advisory labels, gate-brief manifest/headers, stage-handoff copy, API error messages); code identifiers unchanged.
- Pipeline (synergy-pipeline.ts step 5): one `askJsonTracked` call proposes ≤6 capability rows from the analysis's synergy areas (Short List first); persisted in the same transaction as the version insert — add-only merge into `opportunity.capability_gap_json` (case-insensitive capability dedupe; `source: "synergy_area"`, held `unevaluated`, requiredNote cites the source area; note marks LLM-proposed). LLM failure → skip (no fabrication); ADR-0132 protected-rerun guard unchanged.
- S4 (RouteDecisionStage): advisory `capabilityGap` gains full rows; 평가 근거 tab renders summary chips inline with the heading plus a collapsible read-only register table; capability-criteria scoring rows (역량 결정성·통합 역량·역량확보 속도) show a live `역량 참고` evidence line; tabs reordered 경쟁 구조 → 평가 근거 → 위원회 심의 → 결정 (default first).
- `필요 역량 추가 제안` button (renamed from `LLM 보유 판정 초안`): additional proposals + held-judgment drafts; auto-persists unsaved rows before calling the draft endpoint (the endpoint reads the stored register).

## Acceptance

- `bunx tsc --noEmit` (app/web-next): zero errors.
- `bun test tests/unit`: 1188 pass / 0 fail (project-delete, deal-archive, navigation, adr-0104 suites updated for the gate and wording).
- Browser-verified: admin mode toggle blocks/allows DELETE; S4 tab order + register scaffold + 역량 참고 lines; /synergy rerun derives capability rows and stays on the list; confirm-rationale blank for unconfirmed recommendations.
