# Product Backlog Roadmap — co-newbiz (2026-09)

**Owner**: pm
**Status**: Active — approved 2026-09-09 (user-approved master plan; waves execute sequentially)
**Origin**: full product review 2026-09-08/09; supersedes the "Still open" list in `docs/meta/co-newbiz.context.md` as the working backlog index
**Execution model**: one wave = one branch → `/sync` pipeline → PR → CI green → merge; signature waves (A1, B1, C1, D1–D3) require a `docs/designs/` design doc approved before implementation (Design Gate)

## Guiding architecture decision (user-directed)

The data collection engine is a **pluggable source-adapter framework mapped 1:1 to the k-* skill family** — each k-* skill is the operating manual of its adapter:

| Adapter | k-skill | API / credential | Supplies |
|---|---|---|---|
| `dart` | k-dart | DART OpenAPI / `DART_API_KEY` | company financials & filings (generalizes `dart-collect.ts`) |
| `kosis` | k-kosis | KOSIS stats API / `KOSIS_API_KEY` | industry/economic time series (S1 workhorse) |
| `opendata` | k-opendata | data.go.kr / `DATA_GO_KR_API_KEY` | government open data |
| `law` | k-law | 법제처 법령 OpenAPI / `LAW_API_OC` | `md_statute` sync (`law:sync` foundation) |

Adapters share the already-built revision-preserving ingest core (`ensure_fresh` in
`db/repositories/observation.repository.ts`), the SSRF guard (`scripts/lib/ssrf.ts`), and
root-`.env` credential loading (the `lib/llm.ts` loadRootEnv pattern). A `SOURCE_ADAPTERS`
registry makes adding a source a one-line change.

## Waves

### Wave A — Data pipeline (landed; live source breadth expands operationally)
- **A1. Source-adapter framework + fetch + md:sync** (design doc required) — 4 adapters (dart/kosis/opendata/law), `fetch` CLI case, catalog seeding (`md:sync`: md_industry/md_source/md_period/md_unit/md_company/md_statute). Fixture-Fetcher tests for idempotency/revision preservation/change log.
  - 2026-09-09 operations note: initial KOSIS monthly index seeds are live-verified and can be fetched with bounded `--from YYYY-MM --to YYYY-MM` ranges; add future series only after recording `tblId` + `itmId` + every required `objL*` coordinate.
- **A2. calibrate + convert** — CLI wrappers: `python/correlation.py` OLS/lead-lag → `proxy_link`/`proxy_chain` upsert (grades A/B/C); unit conversion through `md_unit.si_coefficient` + proxy coefficients with compounded-CI error bands.
- **A3. policy:sync / policy:impact / fin:project** — policy-doc registry + impact reverse-index (skills/procedures), project financial rollup. (`law:sync` is absorbed by the A1 law adapter; `export` already exists as `db:export`.)

### Wave B — Deal lifecycle completion
- **B1. Project closure/archival** (design doc + migration) — `md_project.status(open|closed|archived)` + `closed_at` + `closure_reason`; `closeProject()` mutation → `PATCH /api/projects/:id/close`; KILL (derived) vs closed distinction; closed projects excluded from pipeline/scorecard aggregates; deal-workspace-operations skill updated.
- **B2. Project child views ×3** — `financial-analysis` (fact_financial/comp_benchmark/valuation_simulation + ECharts), `proxy-chain` (value_chain_link + proxy grades), `reports` (new API route wrapping python/report renderers + history). Registered in navigation.ts + ProjectSubNav per the existing pattern.

### Wave C — Engines
- **C1. WACC input session** (design doc) — WACC stored via the `assumption` table (kind=user, key='wacc', project-scoped); `db/lib/simulation.ts`'s "run.wacc ignored" seam resolved; `business-case-generator.ts` `WACC=0.1` hardcode removed (user WACC, fallback 0.1 with provenance). Full DCF engine explicitly out of scope (follow-up backlog).
- **C2. HWP extraction port** — port co-consult's `python/extract_hwp.py` (adds `olefile` dep) + `hwp-extract` CLI; hwp-document-processing skill's Adaptation Note replaced with the real mechanism; sample-fixture test.

### Wave D — UX gaps
- **D1. Notification read state** (migration) — `notification.read_at`, `POST /api/notifications/:id/read`, unread badge + mark-all.
- **D2. List-row stale signal** (design doc — rule definition) — derived from observation `fetched_at` + per-source/series `max_age_days` (market-evidence precedent); derived-never-stored principle kept.
- **D3. dd-tailor Tavily provenance** — executor uses the existing `tavilySearch()`; source-reliability grading rules (official/primary=B, general web=C, unverifiable=C) defined in a design doc before anything above C is recorded; env gate kept.

### Wave E — Industry profile content (1 PR + ongoing)
- Pilot profile (KSIC 264 semiconductors) researched with real cited sources satisfying `industry-profiles/_schema.yaml` (every section: source/verified_on); companion research doc in `docs/research/`; profile-authoring procedure guide. Remaining profiles are ongoing content work.

### Wave F — Policy decision briefs (1 PR)
- ADR-0051(b) synergy threshold: options/evidence/recommendation brief → user decision → DEC record + checklist reflection.
- ADR-0052 open questions triaged with recommendations; skill-review triage support.

## Acceptance criteria (every wave)
- `test:unit`, `audit.ts`, both design lints, `contrast:check`, personas `--check`, openapi drift gate — all green
- Skills/docs saying "not implemented" are updated in the same wave the implementation lands
- External-API verification only with keys present; otherwise deterministic fixture tests + recorded limitations
