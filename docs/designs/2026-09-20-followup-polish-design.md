# Follow-up Polish — S3 Surface Switcher, Alternatives Textarea, Manifest Drift Zero

- Spec ID: `2026-09-20-followup-polish`
- Date: 2026-09-20
- Status: **Implemented**
- Related: ADR-0120 Wave 2 (`2026-09-19-adr0120-wave2-all-phases-design`), 2026-09-20 live review findings

## Requirements

- REQ-F1: The deals S3 tab exposes a visible surface switcher (`시너지·전략적 적합성` / `그룹·계열사 프로파일`) — the `?surface=company` URL parameter alone was undiscoverable.
- REQ-F2: The S5 `검토한 대안` field renders as a textarea (rows=2) — the saved long text clipped in the single-line input.
- REQ-F3: `docs/VERSION_MANIFEST.md` regenerates with zero drift issues.

## Design

- REQ-F1: two `control-chip` links above the S3 stage content, `aria-current="page"` on the active one. Both target the same deals stage route; the company surface appends `?surface=company`.
- REQ-F2: like the S4 `RouteDecisionStage` textarea precedent.
- REQ-F3, root causes (verified via the new per-issue printout): (a) `collectAgents` did not skip `agents/README_ko.md`, emitting a phantom missing-tier agent row — the skip now uses the same `README(_\w+)?.md` pattern as `validate-agents`' `isAgentFile`; (b) 14 materialized skills carried no `metadata.triggers` — trigger lists added (version 1.0.0 → 1.0.1; the 7 skills that already had a `metadata` block received triggers merged into it, no duplicate key). Script bumped 1.8.0 → 1.9.0 (SCRIPTS.md row updated) and drift issues now print individually instead of a bare count.

## Non-goals

- The browser-use in-app-browser locator click timeout (isolated 2026-09-20: locator resolution succeeds — count()=1 — while the click action times out even with `force`; the button has no CSS animation and a valid bounding box; evaluate-based clicks work) — a ZCode browser-use runtime issue, not an application defect; workaround stands, recorded in session memory.

## Verification

- [x] `bunx tsc --noEmit` clean; `bun run design:lint` clean
- [x] `bun scripts/generate-version-manifest.ts` → 0 drift issues
- [x] `bun run test:unit` green
