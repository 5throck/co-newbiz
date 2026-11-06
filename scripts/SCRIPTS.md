# SCRIPTS.md —Script Lifecycle Registry

> This file is the Single Source of Truth (Tier 1 SSOT) for all directly-invokable scripts in `scripts/` (workspace root) — i.e. scripts run via `bun scripts/<name>.ts` or `bun run <alias>`. Internal library/helper modules under `scripts/lib/` and `scripts/helpers/` that are imported by other scripts but never run standalone (e.g. `auth.ts`, `security-validator.ts`, `pipeline-state.ts`) are intentionally excluded — they have no independent CLI usage to register.
> Template `templates/common/scripts/` (Tier 2) is a snapshot published from here via `bun run propagate:apply`.
> Project `scripts/` (Tier 3) is a snapshot created from Tier 2 at `new-project` time.
>
> **Machine parsing**: `verify-scripts.ts --verify` reads the `## Registry` section only.
> **Human reading**: see `## Guide` section below for purpose, usage, and deprecation notes.

---

## Architecture: TypeScript-Only Policy (ADR-0036)

> **Policy change (2026-06-11)**: All scripts are TypeScript executed via Bun. The former Tier 1 sh/ps1 bootstrap tier has been abolished. See [ADR-0036](../../docs/adr/0036-script-ts-migration.md) for rationale.

## Error Handling Standard (ADR-0054)

> **Policy (2026-08-16)**: Error and exit paths in all scripts MUST use `scripts/lib/error-handling.ts` (`die()`, `fatalError()` + `logError()`, `withSyncErrorHandling()`). Migration is **incremental** — a script migrates when it is otherwise modified (no pure-consistency rewrites). When migrating an L0+L1 script, sync the change to `templates/common/scripts/` in the same commit. See [ADR-0054](../../docs/adr/0054-error-handling-standardization.md) and the coding guidelines §8.11.

All scripts in this workspace are written in TypeScript and executed via `bun`. There is no longer a distinction between "bootstrap" and "ops" tiers — Bun is a hard prerequisite for the workspace and is assumed to be installed before any script runs.

**Single rule**: every new script must be a `.ts` file. No `.sh` or `.ps1` files will be accepted.

**Invocation pattern**:
```bash
bun scripts/<name>.ts [args]       # direct
bun run <alias>                     # via package.json alias (preferred for CI)
```

### Ops & Automation Scripts (Bun/TypeScript)
*   **Purpose**: All scripting tasks — project scaffolding, pipeline, code generation, linting, syncing, lifecycle audits.
*   **Implementation**: Written in TypeScript (`.ts`), executed via the Bun runtime.
*   **Execution**: `bun scripts/<name>.ts` or via `package.json` alias.
*   **Examples**: `upgrade-project.ts`, `cleanup-completed-md.ts`, `audit.ts`, `dev-sync.ts`.

---

## Registry

<!-- verify-scripts.ts parses rows between the Registry header and the next ## header. -->
<!-- Required columns: script | source | version | status | removal-date | security-advisory | layer | pair -->
<!-- status: active | deprecated | experimental -->
<!-- removal-date: YYYY-MM-DD (required when status=deprecated) or —-->
<!-- security-advisory: CVE-XXXX or —-->
<!-- Layer column values (ONLY 2 TYPES USED). L0/L1/L2/L3 here follow
     workspace Terminology Definition (L1=templates/common, L2=templates/co-*,
     L3=Projects/*); these Layer values predate that document and use L2 to mean
     "reaches a scaffolded project," which the current terminology calls L3 — not renamed here
     since layer-filter.ts and verify-scripts.ts parse these literal strings:
  L0           = workspace root only; must NOT be copied to templates/common/ or L3 projects
  L0+L1        = exists in scripts/ AND templates/common/scripts/; scaffold-copies to L3 at new-project time
  L0+L1+L2     = reserved for future use (Fork Model architecture - not currently used)
-->
<!-- pair: reserved field (was used for sh/ps1 pair tracking — abolished per ADR-0036) -->
<!-- Check A (lifecycle-sync-audit.ts): verifies @version header == registry version (formal consistency only). Semantic content alignment —whether file content actually reflects version history —is NOT verified by tooling. Use git log to confirm content for Type-2 fixes. -->

| script | source | version | status | removal-date | security-advisory | layer | pair |
|--------|--------|---------|--------|--------------|-------------------|-------|------|
| `sync-agent-mirrors.ts` | L0 | 1.3.0 | active | —| —| L2-only | —|
| `agent-create.ts` | L0 | 1.0.1 | active | —| —| L0+L1 | —|
| `skill-session-review.ts` | L0 | 1.3.0 | active | `--date`, `--json`, `--dry-run` | —| L0+L1 | —|
| `design-lint.ts` | L0 | 2.5.0 | active | —| —| L0+L1 | —|
| `co-newbiz/beta-series.ts` | co-newbiz | 1.3.1 | active | 2026-11-03 | — | L3-only (project-local; registers KRX index + per-company daily-close beta series for a brownfield project (`--project <id>`, optional `--ticker 이름=코드` pin) and collects them via the krx adapter `listDailyRows` hook through ensure_fresh; 단축코드 resolution cached in db/data/krx-stock-code-cache.json; manual cadence — runbook rb-beta-series; v1.1.0 adds `--budget N` request cap, basDd-based stock-master resolution via the shared krx adapter, and fail-fast on missing KRX_API_KEY; v1.2.0 persists the listing market (raw_payload `krx:stock-master:<companyId>`) for the beta-series route index default and adds idempotent `--backfill-market` (cache-only, no KRX calls)); v1.3.0 (owner decision 2026-11-02, option 1) persists each registration to the stock_series table (migration 0187, upsert by company_id via db/repositories/stock-series.repository.ts, registered_by 'beta-series') in addition to the in-process registration — from then on the nightly collect.krx collects the company's closes in every process (re-registration updates and re-enables, identical rows are a no-op); main is exported as betaSeriesMain behind an import.meta.main guard with a test-only pacing parameter (production defaults unchanged); v1.3.1 (2026-11-03) is lint-gate cleanup only — useTemplate string concat → template literal, `let rows: KrxDailyRow[]` instead of an implicit-any let, biome format drift; no behavior change | —|
| `co-newbiz/scope-impact.ts` | co-newbiz | 1.0.0 | active | 2026-10-13 | —| L3-only (read-only operator helper: `--db <path>` opened readonly; lists projects whose effective date is on/after 2026-07-01 with track, dd decision, later gate rows and whether the by-date S9 scope is pinned off by a valid dd decision; DEC-20261013-05) | —|
| `co-newbiz/copy-legacy-bf-capability-judgements.ts` | co-newbiz | 1.0.0 | active | 2026-10-15 | —| L3-only (person-run operator script, dry-run by default and writes only with `--apply`; copies legacy Brown Field capability judgements stored on S3 register rows to each project's selected target as unconfirmed judgements in `brownfield_target_capability_judgement`, one audit row per copy, idempotent, skips existing judgements and rows with no seeded S7 criterion; ADR-0171 slice 3) | —|
| `co-newbiz/newbiz.ts` | co-newbiz | 1.24.1 | active | 2026-11-03 | —| L3-only (project-local analysis-engine CLI, design v1.0 §4-8, not part of L0/L1/L2 lineage; v1.13.0 adds the `db:export` case delegating to db-export.ts; v1.14.0 adds the Wave A1 `fetch` (source-adapter collection through ensure_fresh, design 2026-09-09-source-adapter-framework-design.md) and `md:sync` (idempotent natural-key catalog upserts) cases; v1.15.0 adds the Wave A2 `calibrate` (correlation.py wrapper -> proxy_link/proxy_chain) and `convert` (unit + proxy-chain conversion with error bands) cases; v1.16.0 adds the Wave A3 `policy:sync`/`policy:impact`/`fin:project` cases; v1.16.1 hardens Wave A fetch argument parsing and period-bound fetcher wrapping; v1.16.2 adds verified KOSIS monthly seed ranges; v1.17.0 adds `hwp-extract`; v1.20.0 adds the KRX day-grain `fetch` path and `krx` source grade; v1.21.0 wires the KRX per-run request budget/stats into `fetch`; v1.23.0 delegates the `fetch`/`md:sync` cases to the shared fetchSource library (ADR-0189 P5, design 2026-10-29 section 3.2) with byte-identical output lines (formatFetchEventLine), observation upsert on (series_id, period) now writing a data_change_log row per CHANGED value in the upsert's transaction); v1.24.0 passes the db handle in `fetch --list`'s adapter ctx so the krx listing includes the table-backed stock_series rows (migration 0187) alongside the static seeds; v1.24.1 (2026-11-03) is lint-gate cleanup only — `result.catalog` guards replace the `catalog!` non-null assertions in the fetch and md:sync cases (md:sync gains an explicit unreachable-branch guard: dart/law are catalog adapters, fetchSource always populates the catalog on the ok path), biome format drift; no behavior change | —|
| `typecheck-baseline.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (Wave A quality gate: tsc diagnostics ratchet vs `quality/typecheck-baseline.json`) | —|
| `coverage-baseline.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (Wave A quality gate: lcov coverage ratchet vs `quality/coverage-baseline.json`) | —|
| `co-newbiz/env-check.ts` | co-newbiz | 1.1.1 | active | —| —| L3-only (project-local, ADR-0075 pre-flight gate for pipeline API stages — verifies `.env` has the four required keys (DART_API_KEY, LAW_API_OC, KOSIS_API_KEY, CO_NEWBIZ_API_TOKEN; names only, values never printed), reports CRLF contamination with the canonical `tr -d '\r'` load preamble, `--exports` emits CRLF-stripped shell-safe export lines for `eval`-based loading in shells without process substitution; --probe` live-validates LLM/DART/KOSIS/LAW/Tavily credentials with 1-request HTTP probes (flags rejected keys with status evidence) | —|
| `co-newbiz/db-export.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, `db:export --dialect postgres` — ADR-0002's portability verification mechanism: schema+data dump with INTEGER→BIGINT/REAL→DOUBLE PRECISION type mapping, GLOB-CHECK warnings surfaced, internal tables skipped, FK-order-safe data section) | —|
| `co-newbiz/policy-sync.ts` | co-newbiz | 1.0.1 | active | 2026-09-09 | — | L3-only (project-local, `policy:sync` + `policy:impact` — Wave A3: scans the policies/ tree into the policy registry (migration 0011) idempotent by doc_path with append-mostly supersession on edits (one live row retained); impact lists referencing skills/procedures/checklists/docs + in-flight pinned projects, the mechanical core of policy-change-impact-analysis) | — |
| `co-newbiz/governance-sync.ts` | co-newbiz | 1.0.0 | active | 2026-10-29 | — | L3-only (project-local, `governance:sync` with `--dry-run` and `--check`: scans policies/procedures/checklists/guidelines/templates into docs/governance/governance-registry.generated.json and, via db/lib/governance-registry.ts, upserts governance_doc with append-mostly supersession and an audit row per run; `--check` is the audit-variant drift gate) | — |
| `co-newbiz/fin-project.ts` | co-newbiz | 1.0.1 | active | 2026-10-09 | — | L3-only (project-local, `fin:project` — one project's financial rollup as JSON: business-case year-1 nets per scenario, latest-model valuation percentiles, charter KPI targets; read-only, Wave A3) | — |
| `co-newbiz/calibrate.ts` | co-newbiz | 1.1.0 | active | 2026-09-09 | — | L3-only (project-local, `calibrate` — Wave A2 statistical proxy-hop calibration: wraps python/correlation.py (OLS + lead-lag + 95% CI) → proxy_link statistical hop + single-hop proxy_chain, grade B/C per R² eligibility; recalibration replaces the pair's previous hop; v1.1.0 writes the correlation.py input into a private `os.tmpdir()` temp directory instead of hard-coded `/tmp`, restoring Windows runs) | — |
| `co-newbiz/convert.ts` | co-newbiz | 1.1.0 | active | 2026-10-08 | — | L3-only (project-local, `convert` — same-dimension unit conversion via md_unit.si_coefficient (known units auto-seed) with cross-dimension refusal per FR-DATA-03, or proxy-chain conversion carrying the chain's compounded-CI band and grade; 1.1.0: math delegated to packages/core-scoring unit-conversion) | — |
| `co-newbiz/kosis-units.ts` | co-newbiz | 1.0.2 | active | 2026-10-09 | — | L3-only (project-local helper — KOSIS unit string → md_unit mapping; unknown units are quarantined, never auto-converted, FR-DATA-03; includes KOSIS 2020=100 index units) | — |
| `co-newbiz/source-adapters.ts` | co-newbiz | 1.5.1 | active | 2026-11-03 | — | L3-only (project-local, `fetch`/`md:sync` engine — k-* skill-mapped source-adapter framework per design 2026-09-09-source-adapter-framework-design_ko.md: dart/**ecos**/kosis/law/opendata adapters sharing ensure_fresh (ADR-0004) + ssrf safeFetch; DART ZIP-safe corp-code parsing; ECOS_API_KEY StatisticSearch adapter (721Y001 월별 시장금리, items 5020000/7020000) per ADR-0116 Phase 3; LAW_API_OC law sync; verified KOSIS seed dimensions; OpenDART corpCode ZIP request headers; fail-closed on missing credentials, unknown-unit quarantine, natural-key catalog upserts; v1.3.0 adds KRX weekday iteration, shared per-(service,day) calls, stock-master resolution and run budget/stats; v1.4.0 — md_statute natural-key idempotency DB-enforced (0186 idx_md_statute_code, data-architect review 2026-11-01): the md_statute catalog insert uses ON CONFLICT DO NOTHING and upsertCatalog counts a conflicted row as existing, never as a phantom insert); v1.5.0 (owner decision 2026-11-02, option 1) — per-deal KRX stock series are table-backed (stock_series, migration 0187): loadStockSeriesDescriptors(db) builds descriptors from enabled rows and both enumeration points merge them — krx listSeries (seeds < table rows < in-process registry) and listKrxDailyRows resolution — with the SourceAdapter listSeries/listDailyRows ctx carrying the caller's db handle (passed by fetchSource) so the nightly collect.krx collects stock_series rows without any beta-series process having run in the collector; the in-process registry (registerKrxSeries) still wins on conflict; v1.5.1 (2026-11-03) is lint-gate cleanup only — useLiteralKeys dot access on the law-adapter rows, noNonNullAssertion removed (the kosis closure snapshots the validated orgId/tblId/itmId keys; listKrxDailyRows restructures the indexCode/ticker pick so no `series.ticker!` is needed), upsertCatalog/findCatalogByNaturalKey/insertCatalogByNaturalKey params typed Database (bun:sqlite) instead of hand-rolled structural shapes, biome format drift; no behavior change | — |
| `co-newbiz/dart-collect.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, DART OpenAPI collector for chain-node financials — ADR-0066 Phase A: fnlttSinglAcntAll per year → fact_industry revenue/operating_income/net_income; requires DART_API_KEY, financial-imports REST fallback documented on failure) | —|
| `deploy-web.ts` | co-newbiz | 1.1.0 | active | —| —| L3-only (project-local ADR-0014 deploy gate for the Docker production stack — records the running image, pulls ghcr.io/5throck/co-newbiz-web:latest (`--build` builds locally), `docker compose up -d`, then gates completion on /api/health polling with concrete code/db rollback hints on failure; design 2026-09-21-docker-prod-cicd) | —|
| `co-newbiz/model.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, `model`/`diff` — run-based versioning via db/lib/versioning.ts: createRun input snapshot + overrides + input_hash, diffRuns variable-level bridge; NPV-level decomposition deferred until the valuation engine exists) | —|
| `co-newbiz/proc-resolve.ts` | co-newbiz | 1.2.1 | active | —| —| L3-only (project-local, `proc:resolve` — merges shared+region+entity procedures; v1.1.0 also merges `kill_criteria`, union with shared-first precedence; v1.2.0 adds a cwd-walk-up fallback for `PROCEDURES_ROOT` when `import.meta.dirname` is undefined — found under Turbopack's bundling of a Next.js Route Handler dynamic import, ADR-0069/0070 Phase 2; the CLI and Hono call sites are unaffected) | —|
| `co-newbiz/gen-pk-notnull-rebuild.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, one-off generator for migration 0033/ADR-0071 — reads sqlite_master, rewrites every single-column `TEXT PRIMARY KEY` to add `NOT NULL` (SQLite does not imply it, unblocking Prisma client generation), emits a topologically-sorted table-rebuild migration with view/trigger recreation; not intended for reuse beyond that one migration) | —|
| `co-newbiz/shadow-compare.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, ADR-0069/0070 Phase 4 — fires the same GET request at the Hono API and the Next.js port with one bearer token, normalizes volatile fields (as_of/timestamps), diffs the JSON bodies; GET-only by design since both stacks share one live database; 37 representative endpoints, one per source route file, first run 2026-08-26 with 0 mismatches) | —|
| `co-newbiz/lint-server-boundary.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, ADR-0070 Decision 2 mechanical enforcement — scans app/web-next/**/*.{ts,tsx} for two rules: a "use server" file importing data access, and a page/layout outside app/api/** importing data access; wired into scripts/audit.ts's full audit pass as of audit.ts 2.15.0; verified against both the clean codebase and a synthetic violation fixture) | —|
| `co-newbiz/mcp-coverage.ts` | co-newbiz | 1.0.0 | active | 2026-10-08 | — | L3-only (project-local, Wave M MCP coverage gate, ADR-0154 §4 — fails when a flow.spec S1-S12 activity or requiredArtifact has no MCP tool, when a tool references an unknown activity/artifact, or when a human-only exclusion in `mcp-coverage.exclusions.yaml` (closure, PMI kickoff, decision/approval execution routes) gains a tool or is not refused by the in-process route guard; also checks kind/scope consistency and that propose tools declare only POST /api/proposals; run through the variant audit hook `co-newbiz/audit-variant.ts`) | —|
| `co-newbiz/audit-variant.ts` | co-newbiz | 1.9.0 | active | 2026-10-29 | — | L3-only (project-local variant audit hook declared in variant.json script_manifest.local and executed by scripts/audit.ts §27 — spawned via `bun` with stdio inherited, exit 0 = Pass, non-zero = Fail; v1.0.0 runs the MCP coverage gate; v1.1.0 adds the SKILLS.md registry parity gate — each structural section header at most once, no duplicate rows inside a section, the Workspace Skills table's skill-name set equal to the skills/ directory set in both directions, and no Retired / Tracked Elsewhere row carrying a directory (graduation ratchet); v1.2.0 absorbs the two runtime projection drift gates (agent-registry `--check` and PM-catalog `--check`) out of a direct audit.ts wiring that violated Core Script Standardization (audit.ts must stay identical to templates/common), with visible skip notes when the generators are absent (non-web contexts); v1.3.0 adds the route audit scan (review W1 M11, FR-SEC-07 — every state-changing Route Handler reaches an appendAudit write or carries a reasoned entry in `route-audit-allowlist.json`); v1.4.0 adds the ADR-0187 P1 process SSOT validators (`co-newbiz/process-ssot-check.ts`) as report-only WARN output that never fails the hook; v1.5.0 (ADR-0187 P2) fails the hook on any finding of the six BLOCKING_CHECKS and keeps engine-spec parity (P3) and review coverage (P4) as WARN; v1.6.0 (ADR-0187 P3) makes engine-spec parity blocking too, review coverage (P4) stays WARN; v1.7.0 (ADR-0187 P4) makes review coverage blocking too and adds the review-matrix projection drift gate; v1.8.0 (ADR-0022 / FR-SYS-04) adds the glossary-data projection drift gate) | —|
| `co-newbiz/backfill-hyd-brk-report.ts` | co-newbiz | 1.1.0 | active | —| —| L3-only (project-local, one-time idempotent backfill retiring the HYD-BRK freeze sentinel (ADR-0112) — persists the hydraulic-breaker research matrix as a regular market_sizing_version payload (provenance frozen-research), marks the analysis completed, and remaps legacy ksic 'HYD-BRK' to the real KSIC 29241 (collision falls back to NULL); re-run is a no-op) | —|
| `co-newbiz/backfill-capability-gap.ts` | co-newbiz | 1.1.1 | active | 2026-10-14 | — | L3-only (project-local, ADR-0136 one-time idempotent backfill — merges legacy `greenfield_assessment.capability_gaps_json` rows into `opportunity.capability_gap_json` (S3 register), matching by capability text; v1.1.1 backfills the ADR-0172 necessity/necessityScopeNote columns as 미정 defaults (typing fix); existing S3 rows only get missing fields filled, never overwritten; unmatched legacy rows are added with source `manual`; `--dry-run` supported; v1.1.0 routes the merged write through the shared `serializeGapRegister` helper (ADR-0169) so a stored `technicalLens` key is carried over instead of dropped) | —|
| `co-newbiz/backfill-brownfield-financial-criteria.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, one-time idempotent backfill — relabels the 5 legacy S7 builtin financial eval criteria to the 3 concrete 5-year-benchmark criteria (matched by `data_ref`), soft-deleting the two retired items (`net_margin`/`segment_manual`) while preserving any recorded assessment history for audit; `--dry-run` supported) | —|
| `co-newbiz/seed-hydraulic-breaker-matrix.ts` | co-newbiz | 1.1.0 | active | —| —| L3-only (project-local, one-off idempotent seed for the hydraulic-breaker region×segment×scenario demand matrix from docs/research/hydraulic-breaker-market-2026-driver-analysis.md §4 — inserts industry_driver/chain_node_sensitivity/structure_simulation_result rows keyed by region_code/segment_code, migration 0034/0035; legacy HYD-BRK sentinel auto-migrated to KSIC 29241 (ADR-0112); `--project-id <id>`) | —|
| `co-newbiz/register-hydraulic-breaker-assumptions.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, registers the hydraulic-breaker region×segment×scenario matrix into the assumption registry per docs/research/hydraulic-breaker-market-2026-driver-analysis.md §7 — 72 kind='assumed' rows (baseline_2026 + cagr down/base/up per region×segment) via recordAssumption with rationale + anchor_ref + TTL 365d, append-safe/idempotent; `[--run-id <id>]`, defaults to the hydraulic-breaker-matrix-seed run) | —|
| `co-newbiz/committee-deliberation.ts` | co-newbiz | 1.1.0 | active | —| —| L3-only (project-local, committee-deliberation CLI — ADR-0097 §7 committee-style deliberation on the runDeliberationRounds engine in app/web-next/lib/deliberation.ts; `bun scripts/co-newbiz/committee-deliberation.ts "topic" [--agents a,b] [--rounds N] [--dialogue]`, risk-officer seat mandatory, transcript written to memory/committee-YYYY-MM-DD-[slug].md) | —|
| `co-newbiz/fix-construction-machinery-link.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (one-time data fix, 2026-09-13 — retires the mislabeled 전방 proxy_link 유압식 브레이커→건설기계 장비 운용 (placeholder evidence) and re-registers it as 후방 with a real evidence_ref per the ADR-0129 retire+re-register contract; placeholder-evidence sweep included; idempotent, audited) | —|
| `co-newbiz/graph-map.ts` | co-newbiz | 1.3.0 | active | —| —| L3-only (project-local, procedure→agent/skill graph mapping; `--check` gates referential integrity + human-role registry consistency + skill-graph metadata bidirectional contract + SA-5 projection-level stage-edge validation, `--json` emits full mapping; v1.2.0 adds SA-5: every procedure node in the generated graph with a non-empty `gate` must have exactly one outgoing `in_stage` edge, per ADR-0083; v1.3.0 adds the ADR-0186 reverse rule: an AI-agent agent_key must not carry decision_authority: human) | —|
| `co-newbiz/graph.ts` | co-newbiz | 0.6.0 | active | —| —| L3-only (project-local, multi-element graph projection per docs/designs/2026-08-24-multi-element-skill-graph-pilot-design.md; `graph` emits docs/graph/graph.{json,md} from the skills/agents/procedures/kill-criteria/decisions SSOTs, `--check` drift-gates, `--no-consumes` suppresses the now-default exact-token inference (precision 1/1 vs pilots), `context --skill/--gate` emits session context bundles; v0.5.0 adds DEG stage-axis conformance per ADR-0083: reads process/stages.yaml + process/stage-aliases.yaml, emits stage nodes, stage_follows + in_stage edges, declares graph_profile: "deg/v1" at top level, renames executes_agent→step_by_agent and executes_skill→step_uses_skill; v0.2.0 honors the ADR-0053 human-role registry so person-role executors are nodes, not warnings; v0.4.1 normalizes every edge source_ref to repo-relative POSIX — an embedded absolute path made the committed projection match only the author's machine (CI graph audit failure); v0.6.0 adds the GATE_ID_TO_DEG mapping (ADR-0149 accepted 2026-10-02): internal stage ids are G1-G8, DEG wire ids stay stage.co-newbiz.S<n> | —|
| `co-newbiz/backup.ts` | co-newbiz | 1.0.1 | active | —| —| L3-only (project-local, ADR-0014/0015 — checkpointed SQLite backup + row-count manifest) | —|
| `co-newbiz/restore.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, ADR-0014 rollback mechanism — restore + manifest verification) | —|
| `co-newbiz/fin-analyze.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, `fin:analyze` — runs python/kpi.py, reused from co-consult) | —|
| `co-newbiz/simulate.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, `simulate` — runs python/monte_carlo.py, seeded contingent-liability Monte Carlo) | —|
| `co-newbiz/fin-pipeline.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, `fin:pipeline` — full DART->validate->normalize->KPI chain, reuses python/{validate,normalize}.py from co-consult) | —|
| `co-newbiz/driver-tree.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, `fin:driver-tree` — runs python/driver_tree.py, 5-level ROIC value driver tree reused from co-consult) | —|
| `co-newbiz/report.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, `report` — Markdown -> docx/pdf/hwpx via shared AST in python/report/, glossary appendix from glossary/*.yaml, Korean TTF resolution via theme.py) | —|
| `co-newbiz/hwp-extract.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, `hwp-extract` — legacy HWP 5.0 OLE BodyText text extraction via python/extract_hwp.py) | —|
| `co-newbiz/rag.ts` | co-newbiz | 1.3.0 | active | 2026-10-08 | — | L3-only (project-local, `rag` — six-dimension RAG assessment from a scenario JSON via db/lib/rag-engine.ts; creates a run row keyed by the scenario's SHA-256 input_hash; Wave 5.10 fix — `complete`/nullable `recorded_overall` for genuinely incomplete assessments; v1.3.0 adds `--stale` for the host-scheduled web-recompute cycle (ADR Wave F-5, no container cron)) | —|
| `co-newbiz/watch-run.ts` | co-newbiz | 1.1.1 | active | —| —| L3-only (project-local, `watch:run` — OS-scheduler-driven monitoring cycle: change detection -> auto RAG re-assessment -> transition -> notification, via db/lib/watch-engine.ts; v1.1.0 adds the ADR-0130 `runMarketSizingQueuePass` recovery pass that heals stuck market-sizing runs and claims ready pending linked analyses; v1.1.1 ADR-0186 P2: the latest-run anchor skips gate_integrity_eval runs) | —|
| `co-newbiz/assume.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, `assume` — registers an assumption row via the shared FR-DATA-07 write path db/lib/assumption.ts, the same recordAssumption() POST /api/assumptions uses, so CLI and REST cannot drift on validation) | —|
| `co-newbiz/design-lint.ts` | co-newbiz | 1.5.0 | active | 2026-10-24 | — | ADR-0074 — Onyx 3.0 design system mechanical enforcement (hardcoded hex/rgba/hsl colors, onInput, nested main via depth scan, icon-only buttons without aria-label); exit 1 on violations; v1.1.0 fixed the inverted icon-button rule and the commented-out nested-main check, added rgba/hsl detection; v1.2.0 added the list-table standard check (row-action tables without `.list-table` or an actions header); v1.3.0 added the 14px font-size floor rule (Wave U-2); v1.4.0 added rule 7, a class-less `<button>` is rejected (R2-C); 2026-10-24: picked up the L0 2.2.0 delivery (workspace-schema designLint-driven scanRoots/tokenSources/allowlist + list-table check) — project-local rules unchanged; v1.5.0 closed the U-2 floor gap: styles.css rule 6 now also rejects body-range non-token rem literals (0.875rem < v < 1rem — they pass at the 16px root but compute below 14px at the ≥1920px 15px root step, e.g. 0.92rem → 13.8px) with a token-steer verdict, em-relative font-size literals are report-only (parent-relative, not mechanically floor-checkable), token-equal 0.875rem and html/body/:root root-sizing declarations are exempt, and the token-equal 0.875rem literals in styles.css were tokenized to var(--fs-body) (tests/unit/r2c-system-quality.test.ts) | — |
| `co-newbiz/i18n-lint.ts` | co-newbiz | 1.2.0 | active | 2026-10-26 | — | L3-only (project-local, `lint:i18n` — design 2026-10-23-i18n-ui-adoption §3.6 re-liquefaction guard: scans app/web-next/{app,components,lib,i18n} sources for Hangul after comment/string-aware stripping; committed baseline allowlist (`i18n-lint.baseline.json`) records extraction-start Korean-line counts and must only shrink — `--update` regenerates it after an extraction batch, a file outside the baseline or exceeding its count fails with exit 1, counts below baseline print a shrink notice; scanner exported for tests/unit/i18n-lint.test.ts, so `test:unit` fails the PR that reintroduces a hard-coded string; 1.0.1 fixes a dead-arg `loadBaseline()` call, no behavior change; 1.1.0 adds the dotted-key check (review W1 H2) — translator-taking label maps that store raw `stages.*`/`common.*`/`pages.*` keys fail when a consumer renders them without a `tr()` call; 1.2.0 adds the dynamic-key catalog coverage check (validator-hardening D8, design 2026-11-04-i18n-dynamic-key-lint) — a family table (`handling_`/`handlingHint_` under `admin.ops`, values parsed out of the `RetentionHandling` type-union declaration in db/lib/retention-registry.ts, the SSOT, so future enum members are auto-covered; unparseable source is itself a violation, fail-loud) cross-checks every enum member × locale (ko/en) against the nested catalogs and fails on a missing/empty key, covering template-literal keys like `` t(`handling_${e.handling}`) `` that the Korean-line and dotted-key checks cannot see; enforced via tests/unit/i18n-dynamic-key-lint.test.ts in the unit-suite gate) | — |
| `co-newbiz/locale-jargon-lint.ts` | co-newbiz | 1.0.0 | active | 2026-10-26 | — | L3-only (project-local, chained into `lint:i18n`, `lint:locale-jargon` — review W1 H4: flags internal references in app/web-next/locales/*.json user copy (numbered boundary refs, ADR numbers, flow.spec versions, roster agent keys, ma-/bf-/cdd- checklist ids, developer-facing wording); exemptions only via `locale-jargon-allowlist.json` (exact key path + reason, no wildcards); `--json` supported; covered by tests/unit/locale-jargon-lint.test.ts) | — |
| `co-newbiz/process-ssot-check.ts` | co-newbiz | 4.0.0 | active | 2026-10-28 | — | L3-only (project-local, `process:ssot-check`, also run by the variant audit hook `co-newbiz/audit-variant.ts`; rule `activity-agent-in-procedure` also an ERROR in `procedures/_validate.ts` 1.9.0 — ADR-0187: eight named process SSOT checks (engine/spec parity H8, checklist producer/consumer H9, activity agent in procedure M2, kill registry parity M4, S2 entry-market inputs M9, review coverage M7/M8, S12 classification coverage M17, stages.yaml derivation M3); v2.0.0 (P2): six checks blocking (exit 1) with ADR-backed allowlists (ACTIVITY_AGENT_ALLOWLIST, CHECKLIST_DECLARED_CONSUMERS verified against the module, CHECKLIST_EXEMPTIONS), S12 step scope read from flow.spec `procedureSteps`; v3.0.0 (P3): engine/spec parity H8 compares stable blocker KEYS (app/web-next/lib/process-blocker-keys.ts `blocker("sN.x")` calls and `blockerKey:` tables <-> flow.spec `blockers:` with artifact / criterion coverage, `nonBlockingArtifacts`, dead-key and raw-label detection) and is blocking, the site-selection and greenfield-feasibility consumer exemptions are gone (machine consumers in lib/checklist-gate-consumers.ts); v4.0.0 (P4): check-review-coverage reads process/cross-validation-matrix.yaml (stage output registry covered_by/exempt with reasons, artifact type x author domain pairs, roster-consistent reviewers, labelled cross-domain fallback, pm exemption, target_screening exception verified against neb-policy) and is blocking - all eight checks now block; `--strict` also fails on WARN; `--check <id>`, `--json`; covered by tests/unit/process-ssot-check.test.ts) | — |
| `co-newbiz/route-audit-scan.ts` | co-newbiz | 1.0.0 | active | 2026-10-26 | — | L3-only (project-local, `lint:route-audit`, also run by the variant audit hook `co-newbiz/audit-variant.ts` — review W1 M11, FR-SEC-07: every POST/PUT/PATCH/DELETE Route Handler under app/web-next/app/api must reach an `appendAudit(` write in the route file or a local import (shared auth/envelope/client modules excluded); intentionally unaudited routes only via `route-audit-allowlist.json` (exact route path + reason, no wildcards, stale entries rejected); covered by tests/unit/route-audit-scan.test.ts) | — |
| `co-newbiz/contrast-check.ts` | co-newbiz | 1.0.0 | active | 2026-09-08 | — | L3-only (project-local, `contrast:check` — WCAG AA token-pair contrast over app/web-next/app/styles.css in both themes: hex/rgb/hsl parsing, var() resolution, alpha compositing; ENFORCED pairs fail below 4.5:1, advisory pairs warn; design-accessibility rule 6 mechanized, CI-wired) | — |
| `co-newbiz/ux-layout-check.ts` | co-newbiz | 1.0.0 | active | 2026-10-08 | — | Wave U-1 runtime layout check — at 1024/1280/390px no position:fixed element intersects the sidebar and no horizontal scroll; optional evidence screenshots; needs a running server and a test-account JSON (never real credentials) | — |
| `co-newbiz/db-integrity.ts` | co-newbiz | 1.0.2 | active | 2026-09-16 | — | L3-only (project-local, `db:integrity` — extends SQLite PRAGMA foreign_key_check with polymorphic gate_decision entity reference validation for opportunity/project ledgers; default read-only gate exits 1 on orphan rows, `--fix` prunes local demo orphan gate decisions only; v1.0.1 ADR-0186 P2: never prunes snapshot-bearing decisions) | — |
| `co-newbiz/align-existing-projects.ts` | co-newbiz | 1.1.0 | active | 2026-10-14 | — | L3-only (project-local; per-project dry-run report of existing-project data gaps vs the 2026-10 model (ADR-0159..0167); `--apply` performs deterministic backfills only in one transaction with audit_log rows and a VACUUM INTO backup; `--apply-approved-decisions` executes only the three human-approved 2026-10-14 decisions behind precondition guards; refuses live DB paths without `--apply --i-know-this-is-a-live-db`) | — |
| `co-newbiz/restore-capability-levels.ts` | co-newbiz | 1.0.0 | active | 2026-10-14 | — | L3-only (project-local; restores only requiredLevel/currentLevel of opportunity.capability_gap_json rows from a pre-S8-edit DB backup (ADR-0170); dry run by default, `--apply` takes a VACUUM INTO safety copy and runs one transaction with audit_log rows) | — |
| `co-newbiz/seed-s1-s12-demo.ts` | co-newbiz | 1.15.0 | active | 2026-11-06 | — | L3-only (project-local, `seed:s1-s12-demo` — idempotently creates one clearly-labelled Brownfield demo chain covering S1 market sizing through S12 portfolio scorecard so process/data/web surfaces can be smoke-tested without treating the rows as production data; v1.4.1 seeds a graduate_to_core venture_transition_decision so the demo completes S12 under the ADR-0150 criteria; v1.5.0 judges the Wave F-8 M&A sub-track checklist items (brownfield-feasibility, ma-special-topics) so S9 completes; v1.6.0 adds humanDecisions and subTrackDd options for the Wave C E2E scenarios (defaults unchanged); v1.7.0 seeds a structurally complete demo-labelled SizingMatrix so the S1 report renders instead of crashing; v1.8.0 adds seedGreenfieldS1ToS12Demo — a full greenfield S1-S12 twin chain (S5 entry strategy, REAL generator S8, establishment 5-step record, no target_screening gate) with idempotency guard, and fixes the adoption meta key to the canonical model_id; v1.8.1 briefly set the greenfield demo origin to joint; v1.8.2 restores internal per ADR-0166; v1.8.4 market-share term rename only — seeded text now says 시장점유율, no behavior change; v1.9.0 seeds the demo target scope into the 0151 entry-market FK tables (repository write instead of the frozen target_scope_json column — ADR-0181); v1.10.0 the greenfield twin gains its confirmed execution baseline (recordBaselineEntries + confirmExecutionBaseline service path), the S12 scorecard moves to recordGreenfieldScorecardFromRequest (sanctioned route service), establishment_mode is seeded, and the CLI seeds BOTH tracks — predicates S1-S12 complete per the s1-s12-demo-e2e (T-20261022-003); v1.11.0 seeds the predicate-optional demo surfaces the tool cards read (T-20261022-042) — S9 DD tools (dd_interview, contract_coc, management_package, comp_benchmark), S11 PMI monitoring (pmi_key_talent, pmi_synergy_certification — brownfield only per ADR-0161), and S12 project_milestone rows on both tracks; v1.12.0 records the demo gate ladder through the ADR-0186 contract — snapshots and acknowledgements, six validator records, user-confirmed WACC, countersigned IC GOs, a cleared condition, HOLD, KILL with learning capture and a waiver — via seed-demo-gate-contract.ts, option gateDecisions:false skips it; v1.13.0 (ADR-0187 P3, M1) gives every demo funding source evidence_kind / evidence_ref and re-cuts the greenfield plan to the adopted case investment so S10 completes under the reconciliation and funding-evidence checks; v1.14.0 (ADR-0187 P5, M14) seeds the greenfield site assessment (2 ranked sites) and pre-IC permit (S5, S8) and incentive-with-clawback (S8) candidates through lib/pre-ic-capture.ts, adopted by the S11 baseline by id, plus one failing (with reason) and one not-applicable (with note) optional DD row on each track; v1.15.0 seeds synergy_rationale on both demo opportunities so the ADR-0192 S3 strategic-fit predicate completes demo chains; the reseed command on a real DB is owner/dba-run) | — |
| `co-newbiz/seed-demo-gate-contract.ts` | co-newbiz | 1.0.0 | active | 2026-10-27 | — | L3-only (project-local helper module imported by seed-s1-s12-demo.ts; records the demo gate ladder through recordGateDecisionRow / countersignDecision / closeCondition / recordWaccSession with every gate-integrity family forced to enforce for the duration; ADR-0186 O-5; no CLI) | — |
| `co-newbiz/reconfirm-requirement.ts` | co-newbiz | 1.1.0 | active | 2026-10-27 | — | L3-only (project-local, `reconfirm:requirement` — opens a legacy-record re-confirmation requirement on a project (ADR-0186 O-6, migration 0179), admin account, dry run unless --apply; `--project` takes the internal id or the human project_no (v1.1.0); the PRJ-DSE4PW command is owner/dba-run) | — |
| `co-newbiz/gate-integrity-shadow-report.ts` | co-newbiz | 1.1.0 | active | 2026-10-27 | — | L3-only (project-local, `gate-integrity:shadow-report` — READ-ONLY summary of gate_integrity.would_block:* and *.refused:* audit rows per family/code/day/entity over a window plus the enforce-flip readiness counts (grant holders, legacy unconfirmed mandatory na, brownfield missing validators, S8+ provisional WACC); --json; ADR-0186 P5; v1.1.0 degrades on a database that lacks a gate-integrity migration — affected sections are reported `migration_pending` with the missing migrations instead of throwing) | — |
| `co-newbiz/demo.ts` | co-newbiz | 1.0.0 | active | 2026-10-08 | — | L3-only (project-local, `bun run demo` — Wave C-2 internal demo: boots the production build through the E2E harness on a free port (never 7748 or 7749) against a temp SQLite DB seeded with the S1-S12 brownfield demo chain (human decisions recorded) and the greenfield E2E deal, LLM/DART/web-research env blanked, prints runtime-generated first-login passwords once; `--capture` walks S1-S12 headlessly and writes numbered screenshots to docs/evidence/demo/) | — |
| `co-newbiz/manual-capture.ts` | co-newbiz | 1.1.0 | active | 2026-10-13 | — | L3-only (project-local, `manual:capture` — isolated-harness screenshot tool for the user-manual wiki: boots the E2E temp DB/server, seeds both demo tracks, logs in through the UI, saves 1440x900 light-theme PNGs to docs/wiki/ko/images per docs/wiki/ko/capture-manifest.json; read-only navigation, write-looking clicks refused, personal data masked; `--list`/`--only <prefix>`; design docs/designs/2026-10-13-user-manual-wiki-design.md) | — |
| `co-newbiz/runbook-validate.ts` | co-newbiz | 1.0.0 | active | 2026-09-10 | — | L3-only (project-local, `runbooks:validate` — registry hygiene for docs/runbooks/registry.yaml: parses, unique ids, en/ko file existence, frontmatter lang + counterpart pairs, no orphan .md under docs/{runbooks,guidelines,manuals}, and the library projection carries every registered file; tests/unit/runbook-registry.test.ts runs the same check) | — |
| `co-newbiz/sync-agent-personas.ts` | co-newbiz | 1.1.0 | active | 2026-10-08 | — | L3-only (project-local, `agents:personas` — generates .claude/agents/<name>.md subagent definitions from the agents/ roster with tier→model mapping; normalizes CRLF input before rendering generated descriptions; syncs the `domain:` frontmatter of agents/*.md from the AGENTS.md domain tables (ADR-0153); --check mode exits 1 on drift, CI-wired) | — |
| `co-newbiz/sync-library-projection.ts` | co-newbiz | 1.3.0 | active | 2026-10-13 | — | Refreshes app/web-next/lib/library.generated.ts (content, checklist version/items) from its source files; `--check` exits 1 when stale; never adds or removes a document; guarded by tests/unit/library-projection-sync.test.ts; v1.1.0 embeds the greenfield S9 workspace overlay as LIBRARY_WORKSPACE_OVERLAY (ADR-0160 addendum b); v1.2.0 also embeds the brownfield overlay as LIBRARY_BROWNFIELD_WORKSPACE_OVERLAY (ADR-0162) | — |
| `co-newbiz/sync-wiki-projection.ts` | co-newbiz | 1.0.0 | active | 2026-10-23 | — | Regenerates app/web-next/lib/wiki.generated.ts wholesale from the Korean user-manual wiki at docs/wiki/ko (2026-10-23 wiki in-app viewer design D2/§5) — unlike sync-library-projection.ts this is a full regeneration, so page additions/removals are reflected mechanically; built-in source validation fails with file/line on internal .md links that miss a projection page, images/ references missing an image file, and in-page anchor links diverging from the renderer's heading slugs (shared app/web-next/lib/wiki-heading-slug.ts); out-of-folder links resolve against the library projection's LIBRARY_DOCS file paths to /library?doc=<id> (unmatched recorded as null and rendered as plain text); `--check` exits 1 when stale; guarded by tests/unit/wiki-projection-sync.test.ts | — |
| `co-newbiz/check-wiki-nav.ts` | co-newbiz | 1.0.2 | active | 2026-10-25 | — | Machine gate for the rebuilt Korean user-manual wiki's handbook-standard structure (2026-10-23 wiki handbook standard rebuild design §3.3 checker 3) — derives the expected prev/next reading chain deterministically from _Sidebar.md group/item order (R1 straight, R2 fork 23→10·11, R3 join 45·56→30 via the two lane-group-title anchors, R4 last page carries 처음: Home — no hardcoded page table, so the sidebar stays the reading-order SSOT and page additions/removals re-derive the chain), then verifies every page's actual nav row against it plus R5 mutual symmetry (A.next contains B ⟺ B.prev contains A), nav label = target slug, nav row as the page's last line, the last page's ## 마무리 section, and the sentence gates: zero em-dash in prose outside fences/inline code (E1~E3 — same 3-stage code stripping as validate-md-language.ts's stripCodeForLanguageScan but line-preserving so findings carry file:line; backticked screen values and table cells survive per E3) and zero calendar dates outside the D1 exemptions (frontmatter, 82-변경-이력, _Footer), plus per-type required H2 sections in the fixed order (전형: 왜 이 단계인가 → 단계 → 결과 확인 → 자주 하는 실수 → [알려진 불일치] → 스스로 확인하기 → 핵심 요약; 연습: 마무리; 참조 exempt); exit 1 with file:line findings; --dir defaults to docs/wiki/ko; v1.0.2 updates the `LANE_GROUP_TITLES` anchors to the 여정 wording per the 2026-10-25 wiki language-fix stream (constant + fixtures only, no logic change); guarded by tests/unit/check-wiki-nav.test.ts | — |
| `co-newbiz/generate-process-flow.ts` | co-newbiz | 1.5.0 | active | 2026-10-28 | — | ADR-0074 — regenerates docs/process-flow.md from process/flow.spec.yaml (plus hand-maintained S8–S12 automation addendum, ADR-0095~0102); --check mode exits 1 on drift; v1.4.0 regenerates the S12 automation-addendum entries for the ADR-0150 six-criteria predicate; v1.5.0 renders each stage's flow.spec `blockers:` as an "엔진 차단 키" list (ADR-0187 P3) | — |
| `co-newbiz/generate-spec-activities.ts` | co-newbiz | 1.2.0 | active | 2026-10-08 | — | Regenerates app/web-next/lib/spec-activities.generated.ts and mcp/co-newbiz/stage-guides.generated.ts (the MCP stage_guide prompts slice) (SPEC_VERSION + SPEC_STAGES static projection — v1.2.0 adds stage name and applicableTracks to SPEC_STAGES for the /api/flows direct projection — for the Next/Turbopack server bundle) from process/flow.spec.yaml; deterministic 2-space JSON output; --check mode exits 1 on drift; drift-gated by tests/unit/process-flow.test.ts | — |
| `co-newbiz/generate-review-matrix.ts` | co-newbiz | 1.0.0 | active | 2026-10-28 | — | L3-only (project-local; ADR-0187 P4, M7/M8, D3) Regenerates app/web-next/lib/review/review-matrix.generated.ts from process/cross-validation-matrix.yaml (artifact type x author domain -> AI-2nd reviewer, stage artifact typing, fallback, agent/gate exemptions) for the Next/Turbopack bundle; `--check` exits 1 on drift (run by audit-variant.ts and tests/unit/review-matrix.test.ts) | — |
| `co-newbiz/generate-glossary-data.ts` | co-newbiz | 1.1.0 | active | 2026-10-29 | — | L3-only (project-local; ADR-0022 / FR-SYS-04, `glossary:generate` / `glossary:check`) Regenerates app/web-next/lib/glossary-data.generated.ts from glossary/*.yaml after running glossary/_validate.ts, for the Next/Turbopack bundle read by the UI tooltip, /api/glossary, MCP lookup_term and the admin glossary page; deterministic; `--check` exits 1 on drift or validation failure (run by audit-variant.ts and tests/unit/glossary-data-sync.test.ts) | — |
| `co-newbiz/generate-prompt-registry.ts` | co-newbiz | 2.1.1 | active | 2026-09-15 | — | v2.1.1 follows the ADR-0185 prompt key renames; projects app/web-next/prompts/prompts.json SSOT into app/web-next/lib/prompts.generated.ts (system prompts, owning agent, ledger purpose); enforces the D3 machine bar: 5-section skeleton markers in order, closed heading vocabulary — any /^#\s+\S/ heading outside the 5 markers dies as "undeclared section marker" (no # Role / persona headings, design addendum §13 / DEC-20261025-05), Hangul zones, ONE-JSON + no-code-fence, Explanation-style clause, advisory >25-word sentence warns; rerun after prompt edits | — |
| `co-newbiz/generate-agent-registry.ts` | co-newbiz | 1.1.0 | active | 2026-09-13 | — | ADR-0128 — projects agents/*.md roster into app/web-next/lib/agent-registry.generated.ts for the runtime PM router; rerun after roster edits; --check mode exits 1 on drift; drift-gated by tests/unit/platform-parity.test.ts and the variant audit hook `co-newbiz/audit-variant.ts` (scripts/audit.ts §27) (ADR-0183 D3), and its projection is cross-validated against the agents/*.md frontmatter by validate-model-registry.ts v1.6.0 | — |
| `co-newbiz/generate-pm-catalog.ts` | co-newbiz | 1.4.0 | active | 2026-10-28 | — | ADR-0183 D1 — joins the 3 SSOTs (app/web-next/prompts/prompts.json × process/flow.spec.yaml activities × agents/*.md roster) into app/web-next/lib/pm-catalog.generated.ts (PM_CATALOG + CATALOG_SOURCES source hashes + DYNAMIC_AGENT_PROMPTS for the 2 agent=null prompts) for the runtime PM router and /flows console; v1.4.0 re-adds s3.synergy_fa as a sanctioned dual assignment (owner decision D6' 2026-10-28: market-intelligence-agent leads S3 synergy-analysis, financial-analyst quantifies); v1.3.0 removes the s3.synergy_fa dual assignment (ADR-0187 D6: financial-analyst now leads S3 synergy-analysis); v1.2.0 adds four ADR-0185 sanctioned dual assignments to DUAL_ASSIGNMENTS; v1.1.0 adds D2 hard-fail (prompt agent must equal the spec activity agent unless listed in DUAL_ASSIGNMENTS with a rationale) and the SPECIALIST_TRACK_AFFINITY curated array (DEC-20261025-02, display-only markers) with die validation, both projected into the catalog; deterministic output with generate-time reference-integrity die() checks (prompt agents, activity mappings, and flow.spec activity agents all must exist in the roster); --check mode exits 1 on drift; drift-gated by tests/unit/pm-catalog.test.ts and the variant audit hook `co-newbiz/audit-variant.ts` (scripts/audit.ts §27) (ADR-0183 D3) | — |
| `co-newbiz/job-worker.ts` | co-newbiz | 1.0.0 | active | 2026-09-19 | — | L3-only (project-local, parallel-execution child-process entrypoint for the independent job layer) | — |
| `co-newbiz/scheduler-core.ts` | co-newbiz | 1.0.0 | active | 2026-10-29 | — | L3-only (project-local, scheduler runtime primitives: due-job computation with compare-and-set cursor, lease lock, job_run lifecycle, stale sweep, run-now requests, heartbeat; ADR-0189 P1) | — |
| `co-newbiz/schedule-tick.ts` | co-newbiz | 1.0.0 | active | 2026-10-29 | — | L3-only (project-local, minute-tick scheduler dispatcher fired by the OS scheduler: env guard (CO_NEWBIZ_SCHEDULER_ENV), heartbeat, stale sweep, due-job + run-now selection, detached run-job children; ADR-0189 P1) | — |
| `co-newbiz/run-job.ts` | co-newbiz | 1.0.0 | active | 2026-10-29 | — | L3-only (project-local, scheduler runner for one registered job handler: enabled re-check, lease lock, timeout, retry, job_run recording, secret-scrubbed errors; ADR-0189 P1) | — |
| `co-newbiz/schedule-seed.ts` | co-newbiz | 1.1.0 | active | 2026-11-02 | — | L3-only (project-local, idempotent seed of default rows (INSERT-missing-only, explicit-run only; ADR-0189 P1): v1.0.0 seeds default schedule_job rows for every registered handler, created disabled (D3) and never overwriting an admin-edited cron/enabled flag; v1.1.0 also seeds default retention_policy rows for every registry-eligible table (db/lib/retention-registry.ts RETENTION_ELIGIBLE_TABLES, the D2/dba-adjudication defaults) with the stored action derived from handlingToStoredAction(entry.handling) so every seeded row passes the executor's action_mismatch guard — registry reconciliation 2026-11-02; dry_run_session intentionally not seeded (executor-refused, read-path purge per migration 0172); CLI JSON reports jobs and policies (inserted/existing); --dry-run writes nothing; ADR-0189 P1) | — |
| `co-newbiz/scheduler-install.ts` | co-newbiz | 1.0.0 | active | 2026-10-30 | — | L3-only (project-local, OS registration installer for the minute-tick scheduler (ADR-0189 P2, design section 7): launchd renders ops/scheduler/launchd/co-newbiz-tick.plist.tmpl to ~/Library/LaunchAgents/org.bizknights.co-newbiz.<env>.tick.plist (StartInterval 60, AbandonProcessGroup - detached run-job children must outlive the tick) and bootstraps via launchctl bootstrap gui/$UID, uninstall = bootout + file removal (only this env's plist); systemd writes the rendered user units to ~/.config/systemd/user/ and prints the systemctl --user enable --now commands (never executes systemctl); schtasks prints the /Create /XML command and the rendered XML (never executes); --env prod/dev --platform launchd/systemd/schtasks --uninstall --dry-run --print; plists/units/XML carry no secrets (design section 5); covered by tests/unit/scheduler-p2-install.test.ts) | — |
| `co-newbiz/orphan-memberships.ts` | co-newbiz | 1.0.0 | active | 2026-10-29 | — | L3-only (project-local, read-only report of active project_member rows whose user is deleted or disabled; never auto-fixes) | — |
| `co-newbiz/jobs/index.ts` | co-newbiz | 1.2.0 | active | 2026-11-02 | — | L3-only (project-local, scheduler job-handler registry (watch.evaluate, gate_integrity.shadow_report, notify.deliver, notify.digest; v1.1.0 adds the five collect.* handlers — ADR-0189 P1/P3/P5; v1.2.0 adds retention.cleanup — ADR-0189 P6); registration is what makes schedule-seed create each row disabled (D3)) | — |
| `co-newbiz/jobs/retention-cleanup.ts` | co-newbiz | 1.2.0 | active | 2026-11-02 | — | L3-only (project-local, retention.cleanup executor (ADR-0189 P6, design 2026-10-29-scheduled-jobs-design §3.3/§8/§10-D2/D6): executes retention_policy rows for tables in the code-level allow-list RETENTION_ALLOW_LIST (dba-adjudication 2026-11-02 reconciled table-for-table with db/lib/retention-registry.ts RETENTION_ELIGIBLE_TABLES: job_run 12m delete_only/started_at, notification 12m archive_then_delete/sent_at, llm_call_log 12m archive_then_delete/created_at (dba-adopted volume table), raw_payload 24m archive_only/fetched_at, execution_job 6m delete_only/created_at terminal rows only (succeeded/failed/cancelled per migration 0117 CHECK), session 1m delete_only/expires_at — session TTL is 12h (db/lib/accounts.ts SESSION_HOURS), so the dba-set default is 1 month past expiry, not the proposed 12m); audit_log hard refusal + any non-allow-listed / basis-mismatched / action-mismatched (policy action ≠ handlingToStoredAction(entry.handling) — the SAME mapping the seeder and admin route derive the stored action from, so registry-created/seeded rows always pass; v1.2.0 replaces the old defaultAction guard whose vocabulary collided with the registry) policy row fails the run with a structural RetentionPolicyError (never a silent skip); deterministic cutoff now−retention_months (UTC calendar months, reuses db/lib/retention-registry.ts retentionCutoff) on the declared basis column; runtime behavior pinned by entry.handling (never read from the stored action): archive_then_delete writes gzip'd JSONL month files db/archive/<table>/<yyyy-mm>.jsonl.gz (D6) via temp-file + atomic rename with PK-dedupe idempotency and read-back verification BEFORE batch-deleting, delete_only plain-deletes without archiving, archive_only archives and NEVER deletes (raw_payload lineage — v1.2.0 fixes the P6 branch that would have deleted after archive); batches ≤1,000 rows (§11), ctx.signal honoured between batches; RETENTION_DRY_RUN=1 computes everything, writes nothing, reports planned counts + would-be paths (mandatory before first destructive prod run, §8-P6 gate); last_run_at updated on successful non-dry runs only; rerun is a no-op; raw_payload (no ingest path writes it today) is a zero-row no-op; cron 0 3 * * *, timeout 30 min, max_retries 0, catchup once/24h (D7); covered by tests/unit/retention-cleanup.test.ts) | — |
| `co-newbiz/jobs/types.ts` | co-newbiz | 1.0.0 | active | 2026-10-29 | — | L3-only (project-local, scheduler job-handler contract types; ADR-0189 P1) | — |
| `co-newbiz/jobs/watch-evaluate.ts` | co-newbiz | 1.0.0 | active | 2026-10-29 | — | L3-only (project-local, watch.evaluate scheduler handler wrapping watch-run (FR-MON-01); ADR-0189 P1) | — |
| `co-newbiz/jobs/gate-integrity-shadow-report.ts` | co-newbiz | 1.0.0 | active | 2026-10-29 | — | L3-only (project-local, gate_integrity.shadow_report scheduler handler wrapping the shadow report, ISO-week keyed file; ADR-0189 P1) | — |
| `co-newbiz/jobs/notify-deliver.ts` | co-newbiz | 1.1.0 | active | 2026-10-31 | — | L3-only (project-local, notify.deliver delivery worker (ADR-0189/0190 P3, design section 13.2): expands recent notifications into notification_delivery rows per db/lib/notify policy resolution, sends due immediate email/webhook rows (retries 1/5/15/60 min, Retry-After honoured, dedupe cooldown, D14 rate limits, D11 batch_failure→ops webhook routing, provider message ids scrubbed + 256-capped); masked recipient addresses only; v1.1.0 adds channel-level is_test webhook expansion for admin test sends (P4, design section 13.7); covered by tests/unit/notify-delivery.test.ts) | — |
| `co-newbiz/jobs/notify-digest.ts` | co-newbiz | 1.0.0 | active | 2026-10-31 | — | L3-only (project-local, notify.digest daily-bundle worker (ADR-0189/0190 P3, design section 13.2): folds each recipient's undelivered daily/deferred rows of the past 24 h into one MNPI-safe email with a shared digest ULID, marks rows sent; cron 30 8 * * *, catchup skip; provider message ids scrubbed + 256-capped; covered by tests/unit/notify-delivery.test.ts) | — |
| `co-newbiz/jobs/collect/fetch-source.ts` | co-newbiz | 1.3.1 | active | 2026-11-03 | — | L3-only (project-local, fetchSource collection library (ADR-0189 P5, design section 3.2) shared by the CLI fetch/md:sync cases and the collect.* handlers: runs one source adapter, per-observation transaction upserts fact_market_observation on (series_id, period) with revision_no+1 on change (FR-DATA-05), writes a data_change_log row in the upsert's transaction — 'new' (old_value NULL) on first-ever insert, mirroring ensure_fresh's contract (watch-run.ts:130 watermark count and watch-engine MAX(detected_at) staleness both need it; data-architect review 2026-11-01) and 'revised' when the value actually differs (deletions not detected: window-dependent), structured {seriesId, period, message, retryable} failures (no raw exceptions), credential gate returns credential_missing outcome instead of throwing; resolveMonthlyPeriods/upsertPeriod/sha256Hex/isRetryableCollectError/formatFetchEventLine moved or added here; v1.1.0 (2026-11-02): isRetryableCollectError classifies zlib/'unexpected end of file' and parser 'corp-code ZIP truncated' errors as retryable (dart streaming-ZIP gate fix, design section 3.1 dart row); v1.2.0 (2026-11-02): the truncation class regex broadens to 'DART .*ZIP truncated' so the disclosure-side parser errors ("DART disclosure ZIP truncated", dart-client v1.2.0 readZipEntries) classify retryable too; covered by tests/unit/collect-handlers.test.ts and tests/unit/dart-corp-zip.test.ts); v1.3.0 (2026-11-02) forwards the caller's db handle in the observation-adapter ctx — listSeries({ db }) and listDailyRows({ seriesId, sourceId, db }) — so the krx adapter merges its table-backed stock series (stock_series, migration 0187, owner decision 2026-11-02 option 1); fixture adapters ignore the extra ctx field; v1.3.1 (2026-11-03) is lint-gate cleanup only — the four `db: any` params typed Database from bun:sqlite (upsertPeriod, registerSourceIfNeeded, upsertObservation, fetchSource; the #792 pattern), biome format drift; no behavior change | — |
| `co-newbiz/jobs/collect/common.ts` | co-newbiz | 1.0.0 | active | 2026-11-01 | — | L3-only (project-local, shared collect.* handler core (ADR-0189 P5, design section 3.1): credential gate first → job_run skipped/credential_missing with zero adapter calls; runs fetchSource; partial failure = success with failures in detail_json, nothing-landed = failed via RetryableJobError only when every failure is network/5xx/429-class; empty catalog sync fails loudly; covered by tests/unit/collect-handlers.test.ts) | — |
| `co-newbiz/jobs/collect/dart.ts` | co-newbiz | 1.0.0 | active | 2026-11-01 | — | L3-only (project-local, collect.dart handler (ADR-0189 P5, design section 3.1 row 1): weekday 07:00 KST full-market DART corp-code catalog sync into md_company through fetchSource (fetch and md:sync are the same catalog operation for dart — performed once); cron 0 7 * * 1-5, timeout 30 min, max_retries 2, catchup once/24h (D7), credential DART_API_KEY; covered by tests/unit/collect-handlers.test.ts) | — |
| `co-newbiz/jobs/collect/ecos.ts` | co-newbiz | 1.0.0 | active | 2026-11-01 | — | L3-only (project-local, collect.ecos handler (ADR-0189 P5, design section 3.1 row 2): daily 08:00 KST ECOS monthly interest-rate observations into fact_market_observation through fetchSource; cron 0 8 * * *, timeout 20 min, max_retries 2, catchup once/24h (D7), credential ECOS_API_KEY; covered by tests/unit/collect-handlers.test.ts) | — |
| `co-newbiz/jobs/collect/krx.ts` | co-newbiz | 1.0.0 | active | 2026-11-01 | — | L3-only (project-local, collect.krx handler (ADR-0189 P5, design section 3.1 row 3): weekday 18:30 KST (after close) KRX daily-close collection via the adapter's listDailyRows hook inside fetchSource; cron 30 18 * * 1-5, timeout 20 min, max_retries 2, catchup once/24h (D7), credential KRX_API_KEY; covered by tests/unit/collect-handlers.test.ts) | — |
| `co-newbiz/jobs/collect/kosis.ts` | co-newbiz | 1.0.0 | active | 2026-11-01 | — | L3-only (project-local, collect.kosis handler (ADR-0189 P5, design section 3.1 row 4): weekly Mon 09:00 KST KOSIS monthly statistical series through fetchSource (weekly cadence respects free-tier quota, D1); cron 0 9 * * 1, timeout 30 min, max_retries 2, catchup once/24h (D7), credential KOSIS_API_KEY; covered by tests/unit/collect-handlers.test.ts) | — |
| `co-newbiz/jobs/collect/law.ts` | co-newbiz | 1.0.0 | active | 2026-11-01 | — | L3-only (project-local, collect.law handler (ADR-0189 P5, design section 3.1 row 5): daily 06:00 KST statute whitelist sync from 법제처 into md_statute through fetchSource (LAW_WHITELIST default; fetch/md:sync converge for catalog adapters); DRIFT REPORTED: design says upsert by statute id + promulgation date but md_statute has no promulgation-date column — upsert key stays korea_statute_id (data-architect change needed); cron 0 6 * * *, timeout 30 min, max_retries 2, catchup once/24h (D7), credential LAW_API_OC; covered by tests/unit/collect-handlers.test.ts) | — |
| `co-newbiz/seed-benchmark-cases.ts` | co-newbiz | 1.0.0 | active | 2026-08-30 | — | ADR-0074 — idempotent seed of 8 public benchmark deals into benchmark_case (migration 0041) | — |
| `co-newbiz/import-base-rates.ts` | co-newbiz | 1.0.0 | active | 2026-10-28 | — | L3-only (ADR-0187 D2, migration 0181) — imports base_rate rows from a JSON file; every row needs source / verified_on / maintainer / evidence_kind, any unsourced row rejects the whole file (exit 2), person-attributed (`--actor` must be an app_user), `--dry-run`, `--db-path`; format in docs/architecture/base-rate-import-format.md; covered by tests/unit/adr-0187-p4-evidence.test.ts | — |
| `co-newbiz/import-benchmark-cases.ts` | co-newbiz | 1.0.0 | active | 2026-10-28 | — | L3-only (ADR-0187 D2, migration 0181) — imports benchmark_case rows with the same mandatory provenance and all-or-nothing contract; deal_size_krw_m INTEGER KRW millions (ADR-0061) | — |
| `co-newbiz/glossary-lint.ts` | co-newbiz | 1.1.1 | active | —| —| L3-only (project-local, `glossary:lint` — ADR-0022 weekly undefined-jargon report over skills/ + docs/; report-only, exit 0 regardless of findings; distinct from glossary/_validate.ts entry validation; 1.1.0 — `findProjectRoot()` cwd walk-up fallback for the Turbopack server bundle (import.meta.dirname unavailable — proc-resolve.ts pattern), exported scanner reused by GET /api/admin/glossary-lint) | —|
| `co-newbiz/adr-new.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, `adr:new` — scaffolds docs/adr/NNNN-<slug>.md from the next free number with the workspace section skeleton; refuses a duplicate title instead of auto-bumping) | —|
| `co-newbiz/scorecard-rollup.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, `scorecard:rollup` — one review cycle's portfolio scorecard rollup as JSON via venture-scorecard.repository getPortfolioRollup: bifurcated financial/strategic sections, venture_class rollup, insufficient_evidence exceptions, run/cycle provenance; ADR-0059 E.4 link 2, group-operator CLI surface, read-only) | —|
| `eval/run.ts` | co-newbiz | 1.1.0 | active | —| —| L3-only (project-local, Wave B-2 AI evaluation harness — `bun run eval`: deterministic suites (rag, kill, antitrust, calibration) offline by default; `--llm` (needs CO_NEWBIZ_EVAL_LLM=1) adds the LLM suites under `--max-cost-usd` (default 2.00) and `--repeat`; writes the scoreboard to docs/reports/eval/) | —|
| `eval/loader.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, Wave B-2 AI evaluation harness — golden dataset loader: Zod validation, citation heading check, leakage lint on pre-decision fixtures) | —|
| `eval/deterministic.ts` | co-newbiz | 1.1.0 | active | —| —| L3-only (project-local, Wave B-2 AI evaluation harness — rag, kill and antitrust suites scored against db/lib engines; unsupported expectations are reported as could-not-evaluate, never guessed) | —|
| `eval/llm-suites.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, Wave B-2 AI evaluation harness — opt-in review-ai2, stage-reco, committee, dd-tailor and business-case suites through an injectable client with budget and usage ledger; no LLM-as-judge) | —|
| `eval/inventory.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, Wave B-2 AI evaluation harness — LLM call-site inventory check against tests/eval/call-sites.yaml; fails on a call site with no suite and no exemption) | —|
| `eval/types.ts` | co-newbiz | 1.1.0 | active | —| —| L3-only (project-local, Wave B-2 AI evaluation harness — shared result types for the eval harness (library module)) | —|
| `eval/calibration.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, Wave B-3 RAG calibration suite — grade-to-probability mapping, Brier score, per-grade reliability table with fixed-seed bootstrap intervals, with and without the data-confidence cap; method in docs/methodology/rag-calibration.md; never retunes weights) | —|
| `agent-delete.ts` | L0 | 1.0.1 | active | —| —| L0+L1 | —|
| `agent-lifecycle-audit.ts` | L0 | 1.9.0 | active | v1.4.0: discovers all agents/*.md; agent passes with a role or a description | —| L0+L1 | —|
| `agent-list.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `agent-verify.ts` | L0 | 1.0.2 | active | —| —| L0+L1 | —|
| `analyze-git-history.ts` | L0 | 1.0.2 | active | —| —| L0+L1 | —|
| `archive-memory.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `audit.ts` | L0 | 2.61.0 | active | —| —| L0+L1 | —|
| `cleanup-completed-md.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `clear-pm-approval.ts` | L0 | 1.0.0 | active | —| —| L0+L1 | —|
| `compile-tokens.ts` | L0 | 1.3.0 | active | —| —| L0+L1 | —|
| `dev-sync.ts` | L0 | 1.37.0 | active | v1.30.0 (2026-10-26, T-20261026-003): the non-main branch guard refuses CLOSED *and* MERGED PRs on the current branch — a follow-up sync onto a merged-PR branch orphans the commits off main (fleet-review wave-1 incident); the guard notes the switch-to-main remediation. | —| L0+L1 | —|
| `dispatch-parallel.ts` | L0 | 1.1.1 | active | —| —| L0+L1 | —|
| `dispatch-serial.ts` | L0 | 1.1.2 | active | —| —| L0+L1 | —|
| `dispatch.ts` | L0 | 1.1.1 | active | —| —| L0+L1 | —|
| `gen-pr-body.ts` | L0 | 1.2.0 | active | —| —| L0+L1 | —|
| `generate-ide-rules.ts` | L0 | 1.0.0 | active | —| —| L0+L1 | —|
| `generate-skill-graph.ts` | L0 | 2.0.0 | active | —| —| L0+L1 | —|
| `helpers/extends-validator.ts` | L0 | 1.0.1 | active | —| —| L0+L1 | —|
| `helpers/merge-frontmatter.ts` | L0 | 1.8.6 | active | —| —| L0+L1 | —|
| `helpers/security-validator.ts` | L0 | 1.1.1 | active | —| —| L0+L1 | —|
| `helpers/pm-md-parser.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `helpers/template-utils.ts` | L0 | 1.3.0 | active | —| —| L0+L1 | —|
| `hooks/gateguard-fact-force.ts` | L0 | 1.3.2 | active | —| —| L0+L1 | —|
| `hooks/post-write-lifecycle-check.ts` | L0 | 1.2.0 | active | —| —| L0+L1 | —|
| `hooks/pre-commit.ts` | L0 | 1.12.0 | active | —| —| L0+L1 | —|
| `hooks/pre-push.ts` | L0 | 1.7.0 | active | v1.5.0 (2026-10-26): deleting a `pr/*` remote branch now requires `ALLOW_REMOTE_BRANCH_DELETE=1`; unset, the push is blocked. | —| L0+L1 | —|
| `lib/auth.ts` | L0 | 1.0.0 | active | —| —| L0+L1 | —|
| `lib/encoding-utils.ts` | L0 | 1.2.0 | active | —| —| L0+L1 | —|
| `lib/error-handling.ts` | L0 | 1.4.0 | active | —| —| L0+L1 | —|
| `lib/language-guard.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `lib/git-status.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `lib/pipeline-state.ts` | L0 | 1.2.0 | active | —| —| L0+L1 | —|
| `lib/platform-context.ts` | L0 | 1.0.0 | active | —| —| L0+L1 | —|
| `lib/ssrf.ts` | L0 | 1.1.2 | active | —| —| L0+L1 (SSRF-safe pinned fetch with caller-supplied request headers); v1.1.2 removes two stale `@ts-expect-error` directives on the `LookupFunction` overloads that current Node types no longer need (was failing `tsc`/`next build`) | —|
| `lib/env-keys.ts` | L0 | 1.0.4 | active | 2026-11-04 | — | L0+L1 (pipeline credential loader — walks up to the root .env and imports only whitelisted pipeline keys, never overriding set values; shared by the k-* source adapters; includes LAW_API_OC for k-law and ECOS_API_KEY for k-ecos) | —|
| `lib/env-value.ts` | L0 | 1.0.0 | active | 2026-11-04 | — | L0+L1 (the one .env value parser — dotenv-16.3.1-compatible: trims, unwraps `"`/`'`/backtick quotes, cuts an unquoted value at the first `#`; replaces three divergent inline parsers per design 2026-08-31-pipeline-execution-environment §2.5) | —|
| `lifecycle-sync-audit.ts` | L0 | 1.20.1 | active | —| —| L0+L1 | —|
| `md-to-ooxml.ts` | L0 | 1.2.0 | active | —| —| L0+L1 | —|
| `qa-gate.ts` | L0 | 1.3.0 | active | —| —| L0+L1 | —|
| `readme-lifecycle-audit.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `render-pdf-deck.ts` | L0 | 1.0.1 | active | —| —| L0+L1 | —|
| `retry-handler.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `setup-github-branch-protection.ts` | L0 | 1.0.1 | active | `--repo`, `--branch`, `--check` (repeatable), `--dry-run` | —| L0+L1 | —|
| `skill-lifecycle-audit.ts` | L0 | 1.10.0 | active | —| —| L0+L1 | —|
| `spec-register.ts` | L0 | 1.6.0 | active | `--file`, `--source`, `--update`, `--status`, `--list`, `--ref`, `--id` | —| L0+L1 | —|
| `lib/local-date.ts` | L0 | 1.0.0 | active | —| —| L0+L1 | —|
| `typecheck.ts` | L0 | 1.2.0 | active | —| —| L0+L1 | —|
| `sync-md.ts` | L0 | 1.4.0 | active | —| —| L0+L1 | —|
| `sync-skill-status.ts` | L0 | 1.1.0 | active | — | — | L0+L1 | — |
| `sync-skills.ts` | L0 | 1.11.0 | active | `--dir <path>`, `--all-variants` | — | L0+L1 | — |
| `team-builder.ts` | L0 | 1.5.0 | active | —| —| L0+L1 | —|
| `test-runner.ts` | L0 | 1.11.0 | active | 2026-10-08 | —| L0+L1 (`--parallel`, `--sequential`, `--concurrency <n>`, `--timeout <ms>`, `--allow-empty`) — v1.5.0: empty suites fail by default and scripts suite scans `scripts/tests/*.test.ts`; v1.6.0: bun test runs with `--timeout=30000` (per-test/hook default 5s flaked fresh-DB migration hooks on CI runners); scenarios suite runs sequentially, *.test.ts only (Wave C); v1.10.2: catch handlers narrowed from `:any` to unknown + `Number.isNaN` (lint hygiene, no behavior change); v1.11.0 (review 2026-11-04 H1): the `scripts` suite scans `scripts/tests/*.test.ts` again — a `test-*.ts` filter over top-level `scripts/` matched only the self-excluded runner, so `test:scripts` resolved 0 files and passed vacuously while the three real tests never ran in CI; scripts-only name special-case removed (uniform extension matching), dead `bun-script` exec mode removed (members are bun:test files, per-test budget restored), and an empty suite now hard-fails unless `--allow-empty` is passed | —|
| `translate-readme.ts` | L0 | 1.0.0 | active | —| —| L0+L1 | —|
| `validate-agents.ts` | L0 | 1.4.1 | active | —| —| L0+L1 | —|
| `validate-doc-folder.ts` | L0 | 1.2.3 | active | —| —| L0+L1 | —|
| `validate-docs-links.ts` | L0 | 1.6.0 | active | —| —| L0+L1 | —|
| `validate-md-language.ts` | L0 | 1.16.1 | active | —| —| L0+L1 | —|
| `validate-model-registry.ts` | L0 | 2.3.0 | active | —| —| L0+L1 (v1.6.0 adds ADR-0183 D3 runtime catalog parity: agent-registry.generated.ts / pm-catalog.generated.ts cross-validated against agents/*.md frontmatter; targets self-skip where the web runtime is not delivered) | —|
| `validate-skills.ts` | L0 | 1.5.2 | active | —| —| L0+L1 | —|
| `verify-agent-deliverables.ts` | L0 | 1.0.1 | active | —| —| L0+L1 | —|
| `verify-memory.ts` | L0 | 1.2.0 | active | —| —| L0+L1 | —|
| `verify-platform-lifecycle.ts` | L0 | 1.6.1 | active | —| —| L0+L1 | —|
| `verify-readme-sync.ts` | L0 | 1.5.0 | active | —| —| L0+L1 | —|
| `verify-skill-graph.ts` | L0 | 2.0.0 | active | —| —| L0+L1 | —|
| `verify-scripts.ts` | L0 | 1.13.0 | active | v1.10.0: registry column-count check | —| L0+L1 | —|
| `verify-skills.ts` | L0 | 1.5.2 | active | —| —| L0+L1 | —|
| `validate-pm-extends.ts` | L0 | 0.3.1 | active | —| —| L0+L1 | —|
| `validate-decisions.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `validate-procedures.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `helpers/context-sections.ts` | L0 | 1.8.0 | active | —| —| L0+L1 | —|
| `lib/context-md-schema.ts` | L0 | 1.0.1 | active | —| —| L0+L1 | —|
| `handbook/apply-handbook-theme.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local handbook toolkit — applies the shared CSS theme to every HTML page under a handbook's docs/ directory) | —|
| `handbook/build-search-index.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local handbook toolkit — reads docs/search-manifest.json and generates docs/assets/search-data.js for client-side search) | —|
| `handbook/check-a11y.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local handbook toolkit — accessibility checks for handbook HTML: alt text, heading hierarchy, empty links, lang attributes) | —|
| `handbook/check-authoring.ts` | co-newbiz | 1.2.0 | active | —| —| L3-only (project-local handbook toolkit — AUTHORING_GUIDELINES compliance checker for handbook sources) | —|
| `handbook/check-external-links.ts` | co-newbiz | 1.2.0 | active | —| —| L3-only (project-local handbook toolkit — external link validation for handbook HTML files) | —|
| `handbook/check-i18n-parity.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local handbook toolkit — cross-language content parity check for localized handbook pages) | —|
| `handbook/check-labels.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local handbook toolkit — chapter-nav link labels must match the target file's title or h1) | —|
| `handbook/check-links.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local handbook toolkit — verifies all internal a href targets resolve to existing files) | —|
| `handbook/check-lint.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local handbook toolkit — basic HTML lint for handbook files without stylelint/eslint) | —|
| `handbook/check-search.ts` | co-newbiz | 2.0.0 | active | —| —| L3-only (project-local handbook toolkit — search-manifest.json must contain all primary HTML files in docs/) | —|
| `handbook/check-spell.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local handbook toolkit — basic spell checker for English handbook HTML files) | —|
| `handbook/check-structure.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local handbook toolkit — HTML structure validator: tag nesting, pre/copy-btn, nested code-block, stray characters) | —|
| `handbook/check-symmetry.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local handbook toolkit — chapter-nav prev/next symmetry check between handbook pages) | —|
| `handbook/check-tables.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local handbook toolkit — enforces the table column-sizing policy for handbook HTML) | —|
| `handbook/deploy-handbook.ts` | co-newbiz | 1.1.0 | active | —| —| L3-only (project-local handbook toolkit — deploys a handbook to GitHub Pages: repo creation, visibility, README patching) | —|
| `handbook/extract-copycode.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local handbook toolkit — extracts code blocks from handbook HTML into standalone files) | —|
| `handbook/handbook-doctor.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local handbook toolkit — enhanced static analyzer for handbook HTML files) | —|
| `handbook/handbook-sync-audit.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local handbook toolkit — three audit modes for co-deck generated handbooks) | —|
| `handbook/nav-utils.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local handbook toolkit — HTML parsing helpers for handbook validation, zero external deps; imported by the check scripts, also runnable standalone) | —|
| `handbook/scaffold-handbook.ts` | co-newbiz | 1.2.0 | active | —| —| L3-only (project-local handbook toolkit — generates handbook project scaffold from skill templates + assets) | —|
| `handbook/update-footers.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local handbook toolkit — syncs the localized site footer into every HTML page under docs/) | —|
| `handbook/validate-handbook.ts` | co-newbiz | 1.1.0 | active | —| —| L3-only (project-local handbook toolkit — unified validator and single entry point: aggregates all read-only checks) | —|
| `handbook/validate-nav.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local handbook toolkit — navigation integrity validator: runs all 4 nav checks, exit 1 on failure) | —|
| `tests/apply-handbook-theme.test.ts` | co-newbiz | 1.0.1 | active | —| —| L3-only (project-local bun:test unit tests for handbook/apply-handbook-theme.ts) | —|
| `tests/check-structure.test.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local bun:test regression tests for handbook/check-structure.ts, fixtures mirror real production bugs) | —|
| `tests/deploy-readme-patch.test.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local bun:test unit tests for patchReadmePagesUrl() in handbook/deploy-handbook.ts) | —|
| `resolve-variants.ts` | L0 | 1.0.3 | active | —| —| L0+L1 | —|
| `validate-variant-readiness.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `validate-templates.ts` | L0 | 1.70.0 | active | v1.50.2: skips cleanly when no templates/common (project context) | —| L0+L1 | —|
| `helpers/upgrade-versions.ts` | L0+L1 | 1.2.0 | active | —| —| L0+L1 | —|
| `lib/propagation-map-schema.ts` | L0 | 1.3.0 | active | —| —| L0+L1 | —|
| `lib/constitution-scrub.ts` | L0 | 1.2.0 | active | —| —| L0+L1 | —|
| `helpers/l0-ref-policy.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `helpers/markers.ts` | L0 | 1.3.0 | active | —| —| L0+L1 | —|
| `helpers/layer-filter.ts` | L0 | 1.5.0 | active | —| —| L0+L1 | —|
| `generate-version-manifest.ts` | L0 | 1.11.0 | active | emits `validate-md-language:allowlist` markers around the generated Skills table (T-20260912-015) | —| L0+L1 | —|
| `lib/platform-delivery.ts` | L0 | 1.0.0 | active | —| —| L0+L1 | —|
| `lib/managed-block-parity.ts` | L0 | 1.2.0 | active | —| —| L0+L1 | —|
| `lib/variant-overlay-guard.ts` | L0 | 1.0.0 | active | —| —| L0+L1 | —|
| `lib/platform-mirror-freshness.ts` | L0 | 1.1.0 | active | Pure platform-skill-mirror vs skills/ SSOT version comparison for the platform-mirror-freshness check (T-20260916-008) | —| L0+L1 | —|
| `helpers/rollback-partial-project.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `helpers/scaffold-markers.ts` | L0 | 1.9.0 | active | Shared scaffold marker constants + (marker→source) mapping + delivery-tree derivations + transient test-fixture predicate (T-20260916-001) | —| L0+L1 | —|
| `lint-instructions.ts` | L0 | 1.0.0 | active | `--dir`, `--strict` | —| L0+L1 | —|
| `helpers/merge-state.ts` | L0 | 1.0.0 | active | §3.3 shared-file taxonomy + unresolved-conflict parsing for dev-sync main-drift/--conclude-merge (ADR-0081/T-20260918-002) | —| L0+L1 | —|
| `bootstrap-stages.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `evidence-backport-scan.ts` | L0 | 1.2.0 | active | Evidence Backporting scanner — read-only form detection (F1/F2/F3/F0/MIXED) + M1-M6 maturity bar over Projects/co-* evidence planes (ADR-0084 Decision 6, design §4); consumes graph-delta-log.ts output for M2/M4/M6b with git-log fallback; project-resync Step 2b | —| L0+L1 | —|
| `generate-raci.ts` | L0 | 1.2.0 | active | RACI matrix generator per ADR-0083 P4, ADR-0084 §3.4; derives A/R from procedures, accepts explicit C/I; loads governance/_human-roles.yaml when present; emits actor_types map when registry exists; sets schema_version: "1.1" for registries | —| L0+L1 | —|
| `graph-delta-log.ts` | L0 | 1.1.0 | active | Graph Delta Log — compute and persist per-scope structural diffs between committed and derived skill graphs (ADR-0084 §5); two-layer delivery (workspace root + projects); consumed by evidence-backport-scan.ts maturity bar (M2, M4, M6b tests) | —| L0+L1 | —|
| `migrate-quality-gates.ts` | L0 | 1.1.0 | active | Convert quality_gates prose entries to decision gates; automate classification (GATE vs INVARIANT vs MANUAL), YAML output, procedure schema updates, and _output-types.yaml enrichment (ADR-0083 P5); decider_agent derived from stage owner_agent, not procedure owner_agent | —| L0+L1 | —|
| `validate-process.ts` | L0 | 1.0.0 | active | Process/stages validation (ADR-0083 DEG-P-*), distinctness check (`--determinism` flag) | —| L0+L1 | —|
| `validate-raci.ts` | L0 | 1.2.0 | active | RACI validation per ADR-0083 DEG-R-01..05 + ADR-0084 DEG-R-06/07; DEG-R-06: human-accountable must match gate; DEG-R-07: actor_types key set must equal R/A/C/I union | —| L0+L1 | —|
| `lib/dependency-guard.ts` | L0 | 1.0.2 | active | DEPENDENCY GUARD — scans delivered scripts' bare-package imports vs project package.json, reports missing packages in the upgrade plan (T-20260920-001) | —| L0+L1 | —|
| `lib/upgrade-policy.ts` | L0 | 1.36.0 | active | exports `lifecyclelessText()` (equal-version agent drift) + `isDeliveredDiff()` (dev-sync 3.9 auto-E5, rollout hardening 2026-09-21) | —| L0+L1 | —|
| `helpers/golden-reference-loader.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `helpers/mirror-hygiene.ts` | L0 | 1.0.0 | active | v1.0.0 mirror-hygiene scanner (R6, spec docs/designs/2026-09-25-verifier-platform-expansion-design.md): a platform skill mirror contains only skill directories; stray files (SKILLS.md/README*.md) and non-skill dirs are findings; wired into validate-templates checkMirrorHygiene (WARN soak) | —| L0+L1 | —|
| `helpers/registries/capability-registry.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `helpers/registries/validation-policy.ts` | L0 | 1.3.0 | active | —| —| L0+L1 | —|
| `helpers/registries/variant-type-registry.ts` | L0 | 1.2.0 | active | —| —| L0+L1 | —|
| `helpers/resolve-pm-stub.ts` | L0 | 1.2.0 | active | v1.2.0 (registry & platform-policy completeness batch, spec docs/designs/2026-09-25-registry-policy-completeness-design.md R2.1): pure, read-only `composeResolvedAgentContent(agentPath, commonAgentPath, variant, opts)` returns exactly the content `resolveAgentExtendsStub` would write, without touching the filesystem (validators must not mutate the tree they audit); the resolver consumes the compose path so one merge implementation exists (in-place writer stays for the new-project/adopt-project delivery paths). Prior: v1.1.0 (T-20260924-003, spec docs/designs/2026-09-25-inventory-decisions-batch-design.md R2.2): generic `resolveAgentExtendsStub(agentPath, commonAgentPath, variant, opts)` wrapper — the pm canonical-prose check (H12) moves behind an injected `opts.isCanonicalStubBody` (pm passes isCanonicalPmStubBody; the empty-body i18n-specialist stubs skip it); `resolvePmExtendsStub` stays as a thin back-compat wrapper. Prior: Shared agents/pm.md normalization — ADR-0033 extends-stub resolution against the L1 body (H12 non-canonical prose flag) + L1-B metadata strip with project-local lifecycle regeneration; extracted verbatim from new-project §2.3b/§2.5, shared with the adopt-project settling pass | —| L0+L1 | —|
| `helpers/skills-registry.ts` | L0 | 1.2.0 | active | v1.2.0 (registry-policy-completeness batch W5, spec docs/designs/2026-09-25-registry-policy-completeness-design.md R5.1): registry auto-sync machinery — collectRegistryDrift, listSkillDirs, splitRootRegistry, collectCatalogEntries, collectCatalogDrift, syncVariantExclusiveCatalog, syncGenericRegistry, collectWorkspaceRegistryFindings (pure compute shared by the sync CLI, validate-templates VA-08, and unit tests; the root Variant-Exclusive catalog reconciles via a dedicated path — its 7th column is the owner-variant list, not notes). Prior: v1.1.0 (T-20260924-008, spec docs/designs/2026-09-24-skills-registry-overlay-reconcile-design.md): adds collectDeliveredSkills + pruneSkillRegistryRows (fresh-scaffold reconcile half); extractFrontmatterVersionAndReviewed moved in verbatim from upgrade-project.ts. v1.0.0: parse/reconcile project skills/SKILLS.md (T-20260922-001) | —| L0+L1 | —|
| `lib/platforms.ts` | L0 | 1.2.0 | active | Platform-list SSOT constants (PLATFORM_SKILL_BASES, PLATFORM_MIRROR_DIRS); Step 1 of the platform-parity program (spec: docs/designs/2026-09-24-platform-ssot-constant-design.md) | —| L0+L1 | —|
| `regenerate-agents-md.ts` | L0 | 1.4.0 | active | v1.2.0: tier extraction strips inline YAML comments (`medium # model-id` leaked into roster rows). | —| L0+L1 | —|
| `lib/ci-workflow-merge.ts` | L0 | 1.0.0 | active | v1.0.0 (T-20260930-026 PR-A, ADR-0094): fail-closed merge/validate of a project `.github/workflows/ci.yml` against the template — 12 error codes (MARKER_*, REGION_*, YAML_PARSE, DUPLICATE_KEY, RESERVED_JOB, FORBIDDEN_TRIGGER, TEMPLATE_JOB_DRIFT, MIGRATION_UNSAFE); PROJECT-JOBS region is untrusted input; legacy migration copies original text slices (never re-serializes); fs confined to applyCiWorkflowMerge (temp + re-validate + atomic rename) | —| L0+L1 | —|
| `validate-surface-registry.ts` | L0+L1 | 1.1.1 | active | v1.0.0 (2026-10-01, T-20261001-018, spec docs/designs/2026-10-01-surface-registry-validator-design.md): §11.0 supported-surface registry validator (ADR-0097 follow-up) — parses the 8-row CONSTITUTION table as the single source, checks instruction files/platform dirs per family/L2 skill mirroring (mirror:false honored, SCAFFOLD_COMPOSED excluded) at L0/L1/L2, compares templates/common/docs/context.md rows verbatim (one source), renders documented gaps (docs/surface-gaps.json) as WARN with ticket id and undocumented gaps as FAIL; audit.ts gate with --strict. | —| L0+L1 | —|
| `hooks/pm-role-bootstrap.ts` | L0 | 1.1.2 | active | SessionStart hook (all sources: startup, resume, clear, compact) injecting PM bootstrap reminder to read AGENTS.md and agents/pm.md before first response — design spec docs/designs/2026-10-02-pm-role-bootstrap-design.md | —| L0+L1 | —|
| `lib/self-managed-tools.ts` | L0+L1 | 1.2.0 | active | v1.0.0 (2026-10-02, T-20261002-001, spec docs/designs/2026-10-02-self-managed-tool-surfaces-design.md): shared loader for docs/self-managed-surfaces.json — the generic self-managed tool registry. Validators consult isSelfManagedPath to skip tool-owned surfaces (graft platform mirrors + helpers transferred to tool custody); selfManagedMirrorSkills seeds verify-platform-lifecycle's VERSION_EXEMPT_PLATFORM_SKILLS. | —| L0+L1 | —|
| `dependency-audit.ts` | L0 | 1.1.0 | active | v1.0.0 (T-20261003-011, spec docs/designs/2026-10-03-dependency-audit-waiver-design.md): waiver-aware `bun audit --json` gate for the CI dependency-audit job — fails on any high/critical finding, treats empty/unparseable output as an infrastructure failure, and adds a reviewed advisory-waiver channel (`.github/dependency-waivers.toml`; strict schema: advisory GHSA id, package, version pin, scope, reason, decided_by, revisit_by). Fail-closed on malformed file, expired revisit-by date, stale waiver (advisory no longer in audit output), installed-version drift, duplicate waivers, and dev-only scope contradiction | —| L0+L1 | —|
| `normalize-registry-provenance.ts` | L0 | 1.1.0 | active | v1.1.0 (2026-10-07, co-newbiz review follow-up): explicit nonstandard-vocabulary handling — shape-valid rows whose source/layer vocabulary is a per-repo convention (co-newbiz's `co-newbiz · L3-only prose` rows, 81 at review time) are skipped AND reported instead of falling out of the parse regex silently; duplicate script keys across registry rows are reported (report-only). Motivation: the co-newbiz format review found its vocabulary truthful (zero variant-delivered scripts) and only 6 hand-deduped duplicate rows. Prior: v1.0.0 (2026-10-07, spec docs/designs/2026-10-07-registry-provenance-normalization-design.md): initial release — relabels fossil provenance stamps in inherited project scripts/SCRIPTS.md registries: L1-delivered rows untouched, variant-overlay rows whose file exists in templates/<variant>/scripts become `L2 · L2-only`, project-local rows become `L3 · L3`, rows whose file exists nowhere are reported as ghosts (--strict fails on them, no auto-edit). Idempotent; --dry and --root for reuse across the fleet; wired into upgrade-project.ts v1.66.0 as a non-fatal post-upgrade pass. Motivation: fleet inspection found 113 fossil rows across 8 projects (co-deck 60, co-safety 33, co-consult 9, co-architect 6, co-game 3, co-price 2, co-design 1, co-abap 1) — stamps inherited from the 2026-07-02 L1 sync outlived the restructure that dropped those rows from the true L0/L1 registries | —| L0+L1 | —|
| `helpers/version-bump.ts` | L0 | 1.0.0 | active | v1.0.0 (2026-10-08, user directive): pure staged-version-bump detection (`detectVersionBumps`, `diffChangesVersion`, `hasTestUnitScript`) for dev-sync step 4.85 | —| L0+L1 | —|
| `lib/package-merge.ts` | L0 | 1.0.0 | active | v1.0.0 (2026-10-09, T-20261009-002, design 2026-10-09-scaffold-package-merge-and-baseline-surfacing): scaffold package.json merge primitives — mergePackageJson (scalar variant-wins, object keys per-key, non-object overlay preserves generated), hasTier2Scripts, evaluateScaffoldPackageContract (VA-08 decision core) | —| L0+L1 | —|
| `lib/skill-graph-compat.ts` | L0 | 1.1.0 | active | v1.1.0 (2026-10-09, T-20261008-009): normalizeForHash strips the ADR-0033 stub `variant:` token alongside `scope:` — stub agent families stop re-appearing as E2 drift findings. Prior: v1.0.0 (2026-10-08, skill-graph v2 design): v1 -> v2 skill-graph compat loader (`loadSkillGraph`, `upgradeSkillGraph`), `capabilityOf` (fleet-convergence grouping key), `contentHash`/`normalizeForHash`, `dedupeEdges`, `findCapabilityDivergence` (E2). Shared by generate/verify-skill-graph, skill-graph-fleet-report, graph-delta-log, validate-templates | —| L0+L1 | —|
| `lib/skills-used.ts` | L0 | 1.0.0 | active | v1.0.0 (2026-10-08, skill-graph v2 E3): `## Skills Used` evidence parser (`parseSkillsUsed`) extracted from skill-session-review.ts; shared with generate-skill-graph.ts | —| L0+L1 | —|
| `helpers/commit-message.ts` | L0 | 1.1.1 | active | v1.0.0 (2026-10-11, U-20261008-001, spec docs/designs/2026-10-11-backlog-batch-2-design.md): pure commit-message composition for dev-sync step 1 (`isWeakCommitMessage`, `deriveCommitMessage`, `composeCommitMessage`) — weak caller shapes replaced by a task-staged-set summary, 72-char budget, spec-id citation | —| L0+L1 | —|
| `helpers/ignored-tooling.ts` | L0+L1 | 1.0.0 | active | v1.0.0 (2026-10-11, T-20261011-014): selectIgnoredToolingArtifacts — picks machine-local tooling artifacts (extensionless executables, binary extensions) out of a git ls-files --others --ignored listing, skipping dep/cache/build trees and OS junk; consumed by upgrade-project's pre-upgrade stash inventory warning. | —| L0+L1 | —|
| `lib/model-literal-patterns.ts` | L0 | 1.1.0 | active | v1.0.0 (2026-10-11, T-20261011-015): shared model-ID literal detection for skill-lifecycle-audit Check MM and sync-model-registry.ts — versioned claude-/gemini-/gpt-5.* regex set + pure findModelLiterals; registry model IDs live only in docs/workspace-schema.json (models.*) and the CLAUDE.md §6 / AGENTS.md §3.6 managed prose, never in skills | —| L0+L1 | —|
| `helpers/local-patch-scan.ts` | L0+L1 | 1.1.0 | active | v1.0.1 (2026-10-13, U-20261012-001): dropped @l2-propagate:false — upgrade-project imports this helper, so scaffolds must deliver it; the header made the delivery derivation skip it while the scaffold copied it (Test 26 drift) and projects failed typecheck TS2307. v1.0.0 (2026-10-02, T-20261002-015): pure LOCAL-PATCH marker scanner for the upgrade report — finds LOCAL-PATCH(upstream-request: id or pending) across text files, skipping dependency and non-text trees; consumed by upgrade-project pre-delivery. | — | L0+L1 | — |
| `helpers/substitute-placeholders.ts` | L0+L1 | 1.3.0 | active | v1.3.0: exported pure `applySubstitutions`/`substituteFiles` (strict-UTF-8 guard, explicit file list) for adopt's scoped substitution; CLI flow guarded by import.meta.main, behavior unchanged | —| L0+L1 | —|
| `lib/env-sample.ts` | L0+L1 | 1.0.0 | active | —| —| L0+L1 | —|
| `lib/managed-block-merge.ts` | L0+L1 | 1.6.0 | active | v1.4.0 (2026-09-29): hyphenated WORKSPACE-MANAGED keys matched (tier-model-mapping now reaches projects); repeated keys pair by occurrence; missing later occurrence inserted after its predecessor. Prior: v1.3.0 (spec docs/designs/2026-09-27-hermes-merge-marker-design.md): COMMON-HERMES joins MANAGED_PATTERNS (after its COMMON-CODEX twin) — the HERMES.md MERGE delivery to existing L2 projects activates (ADR-0093 shipped the file L0/L1 but the pattern gap made the MERGE pass skip it); engine untouched (pattern-generic positional path). Previous: v1.2.0 (T-20260924-010) COMMON-CODEX joins MANAGED_PATTERNS — the CODEX.md MERGE pass union-merge activates | —| L0+L1 | —|
| `helpers/gitleaks-merge.ts` | L0+L1 | 1.1.0 | active | v1.0.0 (2026-10-13, T-20261013-010): extracted mergeGitleaksToml + extractGitleaksArray from upgrade-project — unit-testable gitleaks.toml merge that preserves project-only allowlist entries; replacer-function merge keeps `$''`-anchored entries literal. | — | L0+L1 | — |
| `helpers/registry-append.ts` | L0+L1 | 1.2.0 | active | v1.2.0 (2026-10-17, T-20261017-001): the append-index scan stops at the NEXT `## ` heading — v1.1.0's sole stop condition (first `#### \` header) let it run through the intermediate ## sections' backtick-row-shaped tables (Layer Classification / Ownership Layers / Lifecycle States), landing the scaffold VARIANT SCRIPTS append inside the Lifecycle States table (co-abap scaffold: 7 unregistered rows, nightly all-variants 13/14 on 10-15/10-16); anchor tightened to the exact `## Registry` line (a preceding `## Registry Scope` can no longer hijack it). v1.1.0 (2026-10-14, T-20261014-002): boundary scan exported as registryAppendIndex and adopted by reconcileScriptRegistry's append arm — one ## Registry-anchored, ####-bounded semantics everywhere; the "break at first non-table line" rule retired. v1.0.0 (2026-10-13, T-20261013-001): shared ## Registry-table row-append mechanics (new-project §6.6 + upgrade-project VARIANT SCRIPTS SYNC dedupe). | — | L0+L1 | — |
| `hooks/codex-user-prompt-gate.ts` | L0 | 1.0.0 | active | UserPromptSubmit (Codex CLI/Desktop App/IDE extension) identity gate enforcing the PM Gateway single-point-of-entry rule (AGENTS.md §3.1): a slash-style prompt invoking a rostered specialist (agents/*.md minus pm.md) from a session without a fresh pm-role-bootstrap marker gets `{"decision":"block"}` with a PM Gateway reason (documented Codex UserPromptSubmit block shape); prose mentions are not gated; fail-open. Wired via .codex/hooks.json (SessionStart reuses pm-role-bootstrap unchanged + UserPromptSubmit gate), mirrored to templates/common/.codex/ via the codex-hooks propagation domain; variant (L2) wiring out of scope — variants carry no .codex config layer; Codex trust-gating (hash-pinned /hooks review, skipped-until-trusted) documented in CODEX.md §1. Spec: docs/designs/2026-10-18-codex-user-prompt-gate-design.md | —| L0+L1 | —|
| `hooks/pm-dispatch-gate.ts` | L0 | 1.1.1 | active | PreToolUse (Claude `Agent`) / BeforeTool (Gemini `invoke_subagent`) identity gate enforcing the PM Gateway single-point-of-entry rule (AGENTS.md §3.1): a rostered specialist dispatch (agents/*.md minus pm.md) from a session without a fresh pm-role-bootstrap marker gets `ask` (Claude) or `deny`-with-reason (Gemini); fail-open. Delivery surface (2026-10-17; gate script itself verbatim at v1.0.0 per design §2.2): gate mirrored into templates/common/scripts/hooks/ (startup wiring) and delivered to the 13 variant platform settings via the propagation chain — sync-variant-settings.ts v1.1.0 (MANAGED_SUBSTRINGS + `.claude` PreToolUse / `.gemini` BeforeTool rows + sameFamily stale-replace), new-project/upgrade-project/adopt-project/project-to-variant post-scaffold wiring (lib/upgrade-policy.ts SYNC claim), post-scaffold check A/Sync covered by verify. Spec: docs/designs/2026-10-17-pm-dispatch-gate-design.md; audit.ts ::1793-1802 wording generalized to managed-hook drift | —| L0+L1 | —|
| `render-commands.ts` | L0+L1 | 1.1.0 | active | v1.1.0 (2026-10-13, T-20261013-009 phase 1): promoted from Projects/co-abap (v1.0.1) and generalized — renders .gemini/commands/*.toml from the .claude/commands SSOT (ADR-0077 D4); Gemini CLI loads TOML only; legacy .md kept as P-02 mirrors. v1.0.1: gemini-parity:skip, --check. | — | L0+L1 | — |
| `helpers/variant-context.ts` | L0+L1 | 1.0.0 | active | v1.0.0 (2026-10-26, U-20261026-002): pure variant-context placement guard — variant.json name -> docs/<variant>.context.md convention-path check with skip/pass/fail finding (fail carries the return-or-register remediation); fs injected for fixtures; consumed by audit.ts v2.55.0 placement gate. | — | L0+L1 | — |
| `lib/platform-skeleton-merge.ts` | L0 | 1.2.0 | active | v1.0.0 (spec docs/designs/2026-10-25-managed-platform-skeleton-design.md, ADR-0101): canonical-section registry (MANAGED_SKELETON_SECTIONS v1: CLAUDE §2/§3/§4.5/§5/§6, GEMINI §5) + mergeSkeletonSections() — the upgrade MERGE pass (upgrade-project mergeWorkspaceManaged) runs it strictly AFTER mergeManagedBlocks for CLAUDE.md/GEMINI.md. Missing registered sections insert at template-relative anchors (before/afterZoneContaining); drifted bodies replace only under guards G1 (no project-only heading/comment in the span — keeps co-abap's LOCAL-PATCH GEMINI §5) and G2 (≤120-line cap), with the number-collision guard logging SKELETON DRIFT for occupied numbers. Pure, import-safe, never throws; replaces push snapshots[] for the caller's fail-closed <file>.pre-skeleton.bak (T-20260917-010 pattern); byte-equal present sections are a silent no-op (idempotent). validateSkeletonRegistry() backs the validate-templates skeleton-registry arm (SK-01); section content always read from templates/common/<rel> at merge time | —| L0+L1 | —|
| `helpers/design-lint-roots.ts` | L0+L1 | 1.1.0 | active | v1.0.0 (2026-10-26, U-20261026-006): pure design-lint scan-root resolver — configured designLint.scanRoots filtered by existence; when none exist, falls back to the design-lint.ts conventional uiSourceRoots default (./playground/src, ./src) so audit.ts and the standalone lint agree on the same schema; skip verdict names both the configured roots and the conventional candidates; fs injected for fixtures; consumed by audit.ts v2.56.0 design-lint gate. | — | L0+L1 | — |
| `helpers/pre-commit-script-gate.ts` | L0 | 1.1.0 | active | v1.1.0 (2026-10-27, T-20261027-010): parseCheckAErrorsDetailed — Check A extraction from AuditResult.errors that PRESERVES the fixData payload so pre-commit check 6c keeps its actionable "→ Fix:" output while finally reading the real wire shape; parseCheckAErrors delegates to it so the two extractions cannot drift. v1.0.0 (2026-10-27, T-20261027-009): import-safe merge-aware SCRIPTS.md gate for pre-commit check 6 — gate decision (pass / proxy-fail / merge-verify), Check A error parsing from `lifecycle-sync-audit.ts --json` (AuditResult.errors, level==error), exit-code content gate with an injectable audit-runner seam so unit tests target the module (pre-commit.ts itself runs main() at import) | —| L0+L1 | —|
| `helpers/theme-token-policy.ts` | L0 | 1.0.0 | active | v1.0.0 (2026-10-27, U-20261027-005): DESIGN-R2 theme-invariance key classification — theme presets in tokens.json may override only color/shadow tokens (typography/spacing/borderRadius/target-size are theme-invariant); shared by compile-tokens.ts v1.3.0 (hard compile error) and design-lint.ts v2.3.0 (themes sub-check) so the two enforcement points cannot drift; kebab-normalized membership test | —| L0+L1 | —|
| `changelog-normalize.ts` | L0 | 1.0.0 | active | v1.0.0 (2026-10-31, T-20261031-003 — spec docs/designs/2026-10-31-changelog-normalize-design.md): CHANGELOG structural normalizer — the gate-carried migration path for the dev-sync step 3b duplicate gate. Consumes `changelogGateFindings` (helpers/changelog-duplicates.ts) as the findings source so healer and detector cannot disagree. Structure-only repair: duplicate `### <Category>` blocks collapse into the first occurrence's position (entries appended in original relative order), and all `[Unreleased]`-family sections (`## [Unreleased]`, dated variants) merge into ONE canonical `## [Unreleased]` at the position of the first. Entry lines never edited; frontmatter (`lang: ko` / `lang_reason: legal`) and preamble byte-identical; idempotent; zero findings = byte-untouched; CRLF-safe. Modes: write (default), `--dry-run` (unified diff to stdout), `--check` (exit 0 when zero findings). Consumed by dev-sync step 3b fail-then-heal; unit-pinned by tests/unit/changelog-normalize.test.ts. | —| L0+L1 | —|
| `helpers/changelog-duplicates.ts` | L0+L1 | 1.0.0 | active | v1.0.0 (2026-10-29, U-20261028-013 — spec docs/designs/2026-10-29-delivery-bookkeeping-engine-design.md §3.A4): CHANGELOG structural-duplicate detection (`changelogGateFindings`) for dev-sync step 3b — duplicate `### <Category>` headings within one `## [...]` release section and duplicate `[Unreleased]` sections (`^## [Unreleased]` prefix match); pure, CRLF-safe, preamble ignored; each finding names the merge action. | —| L0+L1 | —|
| `helpers/spec-header-consistency.ts` | L0+L1 | 1.0.0 | active | v1.0.0 (2026-10-29, T-20261029-002 — spec docs/designs/2026-10-29-retro-records-registration-design.md §6): pure registry-vs-design-header status parsing — extractStatusHeaderValue finds the house-style `- **Status**:` list line; parseStatusHeaderValue returns the FIRST status-vocabulary word in the value (earliest position, word-bounded, case-insensitive — "implemented (registry SSOT; retro-marked from draft ...)" parses as implemented, not draft); classifySpecHeader yields match/mismatch/unparseable verdicts; consumed by audit.ts v2.59.0 spec-check Check 6 (mismatch FAIL, header-less docs aggregated WARN); unit-pinned by tests/unit/spec-header-consistency.test.ts | —| L0+L1 | —|
| `lib/generator-manifest.ts` | L0 | 1.0.0 | active | v1.0.0 (2026-10-31, U-20261029-004 — spec docs/designs/2026-10-31-variant-generators-design.md §6.1): loader + runner for project-authored `scripts/<variant>/generators.json` generator manifests — strict parse (JSON shape, `version: 1`, `{}` = the documented empty-manifest no-op, name charset, ≤ 16 generators / ≤ 8 outputs, argv[0] must be `bun`, outputs non-empty, sources advisory), path containment (absolute paths and `..` traversal rejected; command script must exist with its realpath inside the project root — symlink escape rejected at declaration-load time; outputs/sources re-checked lexically against the concrete root), duplicate-name rejection across manifests; `runDeclaredGenerators` executes array-form Bun.spawnSync with cwd pinned to the project root (no env fabrication), verifies outputs on exit 0, stages them via array-form `git add`, and fails loudly (`[generator:<name>]` rows, last 20 lines secret-scrubbed via scrubSecretLines — key/token/secret/password/credential value assignments elided, no partial staging). Consumed by dev-sync step 3.86 and validate-templates.ts (additive arm). Unit-pinned by tests/unit/generator-manifest.test.ts | —| L0+L1 | —|
| `route-audit-scan.ts` | L0 | 1.0.1 | active | v1.0.0 (2026-10-29, T-20261029-005 — spec docs/designs/2026-10-29-route-audit-scan-fleet-design.md): fleet-general write-route audit tripwire generalized from Projects/co-newbiz/scripts/co-newbiz/route-audit-scan.ts (co-newbiz PR #742, FR-SEC-07 — swept 226 write routes to 0 unaudited). Every route.ts exporting POST/PUT/PATCH/DELETE must reach an auditTokenPatterns match within its local import graph (depth-3) or carry a reason-mandatory (>= 10 chars), wildcard-rejected, stale-checked allowlist entry; no-API-surface targets are a SKIP (exit 0, design-lint skip convention). ONE config mechanism: docs/workspace-schema.json `routeAudit` block (auditTokenPatterns + optional allowlist/sharedInfra; designLint/platform_surfaces block precedent) — script constants carry the co-newbiz defaults verbatim; a present-but-malformed block is a hard error. Unit-pinned by tests/unit/route-audit-scan.test.ts. NOT wired into audit.ts/dev-sync — wiring is a deliberate follow-up once a host project adopts the routeAudit block | —| L0+L1 | —|
| `lib/hook-dedupe.ts` | L0 | 1.1.0 | active | v1.1.0 (2026-10-31, design docs/designs/2026-10-31-graft-trail-migration-design.md R2.4 arm (a), U-20261031-009): dropMissingPathHookEntries(template, exists) — the trail-migration JSON_MERGE guard; drops template hook entries whose command references a repo-relative path the exists predicate reports missing (shell-token path extraction: script/config extensions only, `${CLAUDE_PROJECT_DIR:-.}/` interpolation stripped, absolute/`..` tokens ignored, extensionless tokens never candidates); pure, injectable exists for fixture tests. tests/unit/graft-trail-migration.test.ts. Prior: v1.0.0 (2026-10-31, spec docs/designs/2026-10-31-template-security-hardening-design.md R2.6, U-20261031-008): hook-entry dedupe + drift analysis for .claude/settings.json — dedupeClaudeSettingsHooks (consumed by upgrade-project's JSON_MERGE pass) collapses exact (event, matcher, command) duplicates, first occurrence wins, distinct commands preserved; analyzeClaudeHookDrift (consumed by lifecycle-sync-audit Check I) flags within-event duplicate pairs and per-event entry counts exceeding the common template; dedup is within-event only (cross-event repeats are intentional) | —| L0+L1 | —|
| `helpers/hub-topology.ts` | L0+L1 | 1.1.0 | active | v1.1.0 (2026-11-02, spec docs/designs/2026-11-01-hub-consolidation-design.md §6.2 Phase 1.5): promotion/instantiation preflight legs — checkHubDoctrineDuplication (a template carrying a hub-doctrine copy that is neither the hub's own, nor common-contract stock, nor a declared consumer's stale-read copy per §7.4 FAILs) + entryTemplateRelPath (canonical_path → template-relative path). Consumers: new-project.ts v1.40.0 create-time preflight and l3-to-variant-pipeline.ts v1.22.0 Phase 4.8. Additive. Prior: v1.0.1 (2026-11-01): drop stray // @l2-propagate: false header (copy-paste remnant from hub-promotion.ts) — the header made delivery derivation (scaffold-markers.ts deriveNewProjectDelivery) exclude an L0+L1 script that scaffolding delivers, failing test-new-project E2E Test 26; comment-only, no behavior change. Prior: v1.0.0 (2026-11-01, design docs/designs/2026-11-01-hub-consolidation-design.md §2.4 Phase 1): pure hub_topology registry helpers — strict semver parse/compare, registry shape validation (fail-closed), cross-variant duplicate derivation (L1-common excluded via common-contract), the three FAIL legs (unregistered-duplicates with declared-soak WARN, variant-identity clobber, consumer minimum_version), consuming-variant loader; one derivation shared by validate-templates.ts v1.70.0 hub legs, audit.ts v2.61.0 hub-resolve, and hub-promotion.ts v1.0.0. Unit-pinned by tests/unit/hub-topology-legs.test.ts | —| L0+L1 | —|
| `hooks/agent-model-gate.ts` | L0 | 1.3.0 | active | v1.3.0 (L1 promotion, 2026-11-02, Phase 4 hook-delivery wave): added to templates/common/scripts/hooks/ byte-identically — the hook was L0-only, invisible to upgrade-project's version-gated SYNC_IF_NEWER: scripts/ pass, so every fleet project/hub lacked it while the root canonical set (hub-bootstrap §4.4 hook-integrity comparison) carried it; no content change, version unchanged. Content: v1.3.0 (2026-10-26, ADR-0102 / T-20261026-018, user ruling 2): tier source moves from schema agent_tiers (removed) to each agents/<name>.md frontmatter — scalar `tier:` with uniform legacy-block fallback during transition; missing/unparseable/mixed tier WARN-and-skips per agent (same fail-open shape as the old missing-agent_tiers case); models.claude still from the schema. Prior: v1.2.0 (2026-10-26, T-20261026-009 #30): full model IDs accepted (provider/model form and any models.* registry ID); a provided-but-unrecognized value still trips but with a corrected reason that names the value instead of claiming the model param was omitted. v-fix (2026-10-02, T-20261002-013): workspace root via fileURLToPath(new URL(...)) — URL.pathname keeps a leading slash and percent-encodes spaces on Windows, producing an unusable root (same class as pm-role-bootstrap, PR #1317). Prior: — | —| L0+L1 | —|

---

## Layer Classification Framework

> **Two layer types are in use**: `L0` (workspace root only) and `L0+L1` (workspace + template snapshot). `L0+L1+L2` is reserved but unused.

| Layer | Description | Publish | Example |
|-------|-------------|---------|---------|
| L0 | Workspace infrastructure only | No | new-project.ts, remove-project.ts, propagate-to-templates.ts |
| L0+L1 | Workspace + Template snapshot | Yes, to templates/common/ | audit.ts, hooks/pre-commit.ts |
| L0+L1+L2 | Reserved for future use | Not used (Fork Model) | N/A |

**Note**: All scripts must have L0 as their source of truth (SSOT principle). L0+L1+L2 is reserved for future architectural needs but not currently implemented due to the Fork Model (L2 variants evolve independently after scaffolding).

---

## Ownership Layers

| Layer | Location | Owner | Update Policy |
|-------|----------|-------|---------------|
| **L0 —Workspace SSOT** | `scripts/` (workspace root) | workspace maintainer | Versioned via this file |
| **L1 —Template snapshot** | `templates/common/scripts/` | publish: `bun run propagate:apply` | Explicit publish from L0 via consolidated tool |
| **L2 —Variant template** | `templates/co-*/scripts/<variant>/` | variant maintainer | Variant-specific scripts, propagated from L0 |
| **L3 —Project** | `<project>/scripts/` | project team | Independent snapshot after creation, plus L1->L3 propagation via `propagate-to-templates.ts` |

**Propagation rule**: L0 is the development SSOT. Publish L0→L1 explicitly with `bun run propagate:apply`, which is a consolidated tool that also handles L1->L3 propagation. L3 projects snapshot L1 at creation time and receive subsequent updates via propagation. No automatic back-propagation from L3.

---

## Lifecycle States

| Status | Meaning | Action Required |
|--------|---------|-----------------|
| `active` | In production use | Changes require version bump in Registry |
| `deprecated` | Scheduled for removal | `removal-date` field required; L1/L2 warned on `dev-sync` |
| `experimental` | Not guaranteed stable | Not synced to L1/L2 automatically |

**Deprecation flow:**
1. Set `status: deprecated` and `removal-date: YYYY-MM-DD` (minimum 90 days notice)
2. `bun run dev-sync` warns L1/L2 consumers on every run
3. On `removal-date`, `verify-scripts.ts --verify` **hard blocks** pre-commit

**Security advisory flow:**
1. Set `security-advisory: CVE-XXXX` (status can remain `active` or become `deprecated`)
2. `bun run dev-sync` **hard blocks** in L1/L2 until the script is updated or removed
3. Unlike deprecation, security advisories take immediate effect with no grace period

---

## Guide

### Everyday Development Scripts (Tier 2 —`bun run <script>`)

#### `audit.ts`
**Purpose**: Documentation audit gate. Checks CHANGELOG.md, workspace standards, AGENTS.md,
agent frontmatter, skill health, template lifecycle validation, and variant context guidelines
section presence (VARIANT-INJECT: guidelines [REQUIRED] marker enforcement).
**Usage**: `bun run audit`
**Runs automatically**: pre-commit hook, pre-push hook, `bun run dev-sync`

#### `dev-sync.ts`
**Purpose**: Full sync pipeline — pre-flight markdown link validation gate (`bun scripts/validate-docs-links.ts`) — session log — MEMORY.md index — CHANGELOG auto-add — audit gate — sensitive file check — branch creation — commit — push — PR.
**Usage**: `bun run dev-sync "feat: description"`
**Claude Code / Gemini**: `/sync "feat: description"`
**v1.5.0**: Added pre-flight markdown link validation gate (`bun scripts/validate-docs-links.ts`) executed before git operations to ensure all documentation links resolve.

#### `test-runner.ts`
**Purpose**: Test suite execution framework supporting `unit`, `integration`, `scenarios`, and `scripts` suites. Features parallel test execution with worker pool concurrency, worker temp directory isolation (`TEST_TEMP_DIR`), automatic fallback to sequential execution on failure, and per-suite timeouts.
**Usage**:
- `bun scripts/test-runner.ts [suite] [flags]` (default suite: `integration`)
- Via `package.json` aliases: `bun run test`, `bun run test:unit`, `bun run test:e2e`, `bun run test:full`
**CLI Flags**:
- `--parallel`: Enable parallel execution across test files (default when > 1 test file)
- `--sequential`: Force sequential test file execution
- `--concurrency <n>`: Set worker pool concurrency level (default: CPU core count up to 4)
- `--timeout <ms>`: Set per-test execution timeout in milliseconds
- `--allow-empty`: Let a suite that resolves to zero test files pass. Without it an empty suite is a hard failure — a suite matching nothing is a gate that always passes.
**v1.1.0**: Documented parallel execution capabilities, worker pool temp directory isolation (`tests/.temp/worker-<id>`), automatic sequential fallback, and CLI flags (`--parallel`, `--sequential`, `--concurrency <n>`, `--timeout <ms>`).
**v1.11.0** (2026-11-04, review H1): the `scripts` suite scans `scripts/tests/*.test.ts` again. Between v1.5.0 (which documented that scan) and v1.11.0 the suite still pointed at top-level `scripts/` with a `test-*.ts` filter, whose only match was the self-excluded runner — `bun run test:scripts` resolved zero files, returned PASS, and the three real script tests never ran in CI. The scripts-only name special-case is gone (extension matching is uniform), the dead `bun-script` exec mode was removed so suite members run under `bun test --timeout` like every other suite (restoring the per-test budget), and an empty suite now fails with a message naming the suite and its scan dir. `test:integration` passes `--allow-empty` because an integration-less tree is legitimate; `test:scripts` does not.

#### `sync-md.ts`
**Purpose**: Updates `memory/MEMORY.md` index with today's session entry.
**Usage**: Called automatically by `bun run dev-sync`. Rarely invoked directly.

#### `gen-pr-body.ts`
**Purpose**: Generates a structured template PR body from commit message + file list — template fallback for `dev-sync.ts`. (AI-mode generation via `claude -p` was removed in 1.2.0; the agent writes the PR body itself per `skills/sync/SKILL.md`.)
**Usage**: Invoked automatically. Can be called standalone: `bun run gen-pr-body "msg"`

#### `generate-scripts-readme.ts`
**Purpose**: Auto-generates scripts/README.md from SCRIPTS.md registry.
**Usage**: `bun scripts/generate-scripts-readme.ts`
**Runs automatically**: `bun run dev-sync`

#### `compile-tokens.ts`
**Purpose**: Design token compiler for `co-design`. Reads `templates/co-design/tokens.json` and generates CSS custom properties (`:root { --color-primary: ... }`) and TypeScript constant types (`tokens.ts`) for design system consistency.
**Usage**: `bun scripts/compile-tokens.ts [--input <path>] [--out-css <path>] [--out-ts <path>] [--watch] [--check]`

#### `generate-ide-rules.ts`
**Purpose**: IDE context rules generator for `.cursorrules` and `.clauderules`. Generates IDE-specific context rules dynamically based on workspace context and agent rosters.
**Usage**: `bun scripts/generate-ide-rules.ts [--check] [--force] [--dir <path>]`

#### `render-pdf-deck.ts`
**Purpose**: Playwright paged-media presentation PDF renderer. Converts HTML presentation decks into paginated PDF files respecting `@page` print rules using Playwright headless Chromium.
**Usage**: `bun scripts/render-pdf-deck.ts [--input <file>] [--output <file>] [--check]`

#### `md-to-ooxml.ts`
**Purpose**: Markdown to Microsoft Office OOXML (`.docx` / `.xlsx`) compiler script for `co-work`. Compiles Markdown source files into native Microsoft Office Open XML structures.
**Usage**: `bun scripts/md-to-ooxml.ts --input <file.md> [--output <file>] [--type docx|xlsx] [--check]`

---

### Installation

> **Bun is a workspace prerequisite.** Install it once via the [official installer](https://bun.sh/docs/installation) before using any script. `install-bun.sh/ps1` have been deleted (ADR-0036).

---

### Agent Lifecycle Scripts (Bun / TypeScript)

#### `agent-create.ts`
**Purpose**: Creates a new agent file with proper frontmatter and required sections.
**Usage**: `bun scripts/agent-create.ts <name> --role "Display Name" --group <group>`

#### `agent-delete.ts`
**Purpose**: Removes an agent file and updates AGENTS.md.
**Usage**: `bun scripts/agent-delete.ts <name> [--force]`

#### `agent-list.ts`
**Purpose**: Lists all agents with their status, group, and tier.
**Usage**: `bun scripts/agent-list.ts [--group <group>] [--verbose]`

#### `agent-verify.ts`
**Purpose**: Verifies agent/AGENTS.md synchronization (files vs. registry).
**Usage**: `bun scripts/agent-verify.ts`

#### `agent-lifecycle-audit.ts`
**Purpose**: Full agent lifecycle audit —frontmatter validation, AGENTS.md consistency,
deprecated agent references, missing fields.
**Usage**: `bun scripts/agent-lifecycle-audit.ts`
**Runs automatically**: pre-commit hook when `agents/*.md` files are staged.

**Purpose**: Synchronizes agent status between agent files and AGENTS.md.

---

### Skill Lifecycle Scripts (Bun / TypeScript)

#### `skill-lifecycle-audit.ts`
**Purpose**: Full skill lifecycle audit —owner validation, orphaned skills, deprecated
skills still being modified, dependency graph, circular dependencies, `scope` field validity.
**Usage**: `bun scripts/skill-lifecycle-audit.ts`
**Runs automatically**: pre-commit hook when `skills/**` files are staged.
**v1.2.0**: `scope` validation now accepts `workspace | common | variant | <current project's own directory name>` (was previously only the literal string `variant`, which incorrectly flagged legitimate variant-name scope values like `scope: co-consult`); `docs/_examples/skills/**` excluded from scanning (illustrative documentation, not real skills). Run once per location (workspace root + each `templates/co-*/` variant + `templates/common/`) since agent/scope resolution is relative to `cwd`.

#### `readme-lifecycle-audit.ts`
**Purpose**: Validates README.md / README_ko.md pairing in `templates/` directories.
**Usage**: `bun scripts/readme-lifecycle-audit.ts`

#### `verify-skills.ts`
**Purpose**: Cross-validates skills referenced in `docs/context.md` against actual
skill files on disk. Detects missing or orphaned skill references. SKILLS.md
index generation is opt-in (`--write-index`); the default run validates and
reports only and never writes SKILLS.md, which is hand-maintained.
**Usage**: `bun scripts/verify-skills.ts [--write-index]`

#### `sync-skill-status.ts`
**Purpose**: Synchronizes skill status between SKILL.md and registry tables.
**Usage**: `bun scripts/sync-skill-status.ts`

#### `new-project.ts`
**Purpose**: Scaffolds a new project under the workspace root. Copies `templates/common/`
and an optional variant, substitutes `[Project Name]` placeholders, strips L1-B metadata
from `agents/pm.md`, flattens `docs/_common/`, and runs the post-scaffold audit.
**Usage**: `bun scripts/new-project.ts <name> <variant>`
**Breaking change from**: `bash scripts/new-project.sh` / `.\scripts\new-project.ps1` (removed 2026-06-11, ADR-0036)
**Note**: L0 script (workspace infrastructure only). Changes must be versioned in SCRIPTS.md.

#### `remove-project.ts`
**Purpose**: Safely deletes a project directory without requiring administrator privileges.
Detects running Claude Code / Antigravity processes with user confirmation before removal.
**Usage**: `bun scripts/remove-project.ts <project-name>`
**Breaking change from**: `.\scripts\remove-project.ps1` / `bash scripts/remove-project.sh` (removed 2026-06-11, ADR-0036)
**Note**: L0 script.

#### `sync-skills.ts`
**Purpose**: Distributes skills from a project's SSOT (`skills/`) to its runtime locations
(`.claude/skills/`, `.gemini/skills/`, `.agents/skills/`). Run after any change to `skills/`
to ensure Claude Code, Antigravity, and Antigravity CLI pick up the update.
**Usage**:
- `bun run sync-skills` — workspace root only (default, unchanged from prior versions)
- `bun scripts/sync-skills.ts --dir templates/co-consult` — a single project root (variant or `templates/common`)
- `bun scripts/sync-skills.ts --all-variants` — every `templates/co-*/` variant plus `templates/common/`
**v1.4.0**: added `--dir`/`--all-variants` — the workspace-root-only default was silently leaving `.agents/skills/` (Antigravity CLI) far behind `.claude/skills/`/`.gemini/skills/` in every variant (discovered during a full skill-lifecycle audit, 2026-07-19). Run `--all-variants` after any variant-level skill change.

#### `sync-skills-to-l2.ts`
**Purpose**: Synchronizes explicitly requested skills or scripts from L1 (templates/common) to L2 variants.
**Usage**: `bun scripts/sync-skills-to-l2.ts`

#### `resolve-variants.ts`
**Purpose**: L1-B Phase script that pre-resolves `extends:` skeleton references in each `templates/co-*/` variant. Writes fully-merged files in-place so that audit can validate complete content before `new-project` runs. After resolution, `new-project.ts` only needs a simple file copy — no `merge-frontmatter` step required.
**Usage**: `bun scripts/resolve-variants.ts [--force] [--variant co-develop]`
**Idempotency**: files already marked `# @resolved-from:` are skipped unless `--force` is passed.
**Note**: L0 script (workspace infrastructure only). Not copied to `templates/common/scripts/`.

#### `verify-memory.ts`
**Purpose**: Validates `memory/*.md` session logs for mandatory 4-section format compliance
(`## Session Summary`, `## Changes`, `## Decisions`, `## Open Issues`) and detects
orphaned files not registered in `MEMORY.md` index.
**Usage**: `bun scripts/verify-memory.ts [--verify | --report]`
**Runs automatically**: pre-commit hook when `memory/*.md` files are staged.

#### `archive-memory.ts`
**Purpose**: Archives memory markdown files older than 7 days to keep the root memory directory clean and within context limits.
**Usage**: `bun scripts/archive-memory.ts`

---

### Multi-Agent Orchestration Scripts (Bun / TypeScript)

#### `dispatch.ts`
**Purpose**: Single-agent dispatch wrapper. Spawns one agent with a given prompt and
waits for completion.
**Usage**: `bun scripts/dispatch.ts --agent <name> --prompt "task"`

#### `dispatch-parallel.ts`
**Purpose**: Parallel multi-agent dispatch. Spawns multiple agents simultaneously and
collects results when all complete.
**Usage**: `bun scripts/dispatch-parallel.ts --agents agent1,agent2 --prompt "task"`

#### `dispatch-serial.ts`
**Purpose**: Serial multi-agent dispatch. Chains agents sequentially, passing each
agent's output as input to the next.
**Usage**: `bun scripts/dispatch-serial.ts --agents agent1,agent2 --prompt "task"`

#### `retry-handler.ts`
**Purpose**: Wraps any dispatch call with retry logic (configurable attempts, backoff).
**Usage**: `import { withRetry } from './retry-handler.ts'` (library module)

---

#### `validate-pm-extends.ts`
**Purpose**: Validates pm.md extends chains for correctness and compliance per ADR-0033.
Checks 6 validation rules: syntax, circular references, depth limits, file existence, override validity, and platform parity.
**Usage**: `bun scripts/validate-pm-extends.ts [options] [files...]`
**Options**:
  - `--fix` - Auto-fix simple issues (optional)
  - `--verbose` - Detailed output
  - `--json` - JSON output format
  - `--max-depth N` - Set custom max depth (default: 3)
**Exit codes**: 0 (all valid), 1 (errors found)
**Examples**:
  - `bun scripts/validate-pm-extends.ts` (validate all pm.md files)
  - `bun scripts/validate-pm-extends.ts agents/pm.md` (validate specific file)
  - `bun scripts/validate-pm-extends.ts --json` (CI/CD friendly output)

---

### Propagation Scripts (Bun / TypeScript)

#### `propagate-to-templates.ts`
**Purpose**: Publishes L0 workspace scripts and governance docs to L1 (`templates/common/`) and propagates L1 changes to L2 variant templates. This is the consolidated propagation tool invoked via `bun run propagate:apply`.
**Usage**: `bun scripts/propagate-to-templates.ts [flags]`
**Layer**: L0 (workspace infrastructure only — not copied to templates/common/, templates/co-*/, or L3 projects)
**Aliases**: `bun run propagate:apply` (--apply), `bun run propagate:dry-run` (--dry-run)

**Flag → Layer/Phase Mapping**:

| Flag | Layer Operation | Phase Context |
|------|----------------|---------------|
| `--apply` | L0 → L1(common) sync | Phase A: install scripts into common template |
| `--dry-run` | L0 → L1(common) diff | Any phase: preview changes before applying |
| `--governance-l1` | L0 governance → L1(common) | Phase A: deploy CLAUDE.md/GEMINI.md/AGENTS.md to L1 |
| `--docs` | L1(common) → L1(variants) COMMON marker injection | Phase B: prepare variant-specific governance docs |
| `--prune` | L1(common) cleanup | Maintenance: remove L0-only orphan files from L1 |
| `--check-drift` | L1 vs L2 drift report | Any phase: verify L2 variants not diverged from L1 |
| `--include-disabled` | Opt-in override | Include domains marked `disabled: true` (e.g. `docs`) in the dry-run report only — combining with `--apply` is a hard error (exit 1), not a silent write |

**Typical workflow**:
```bash
bun scripts/propagate-to-templates.ts --dry-run          # preview L0→L1 changes
bun scripts/propagate-to-templates.ts --apply            # publish scripts L0→L1
bun scripts/propagate-to-templates.ts --governance-l1    # publish governance docs L0→L1
bun scripts/propagate-to-templates.ts --docs             # inject COMMON markers into variants (Phase B)
bun scripts/propagate-to-templates.ts --prune            # remove orphan files from L1
bun scripts/propagate-to-templates.ts --check-drift      # report L1 vs L2 drift
bun scripts/propagate-to-templates.ts --domain docs --include-disabled --dry-run  # inspect a disabled domain
```

**Disabled domains**: a domain entry may carry `"disabled": true` in `propagation-map.json` to declare it *intentionally* inactive (as opposed to silently never having worked — see the `docs` domain's `note` field for the concrete incident this guards against). Default runs skip it and print why; `--include-disabled` is a read/inspect escape hatch, not a way to reactivate it — flip the flag in `propagation-map.json` itself once the underlying policy question is resolved.

### L3 Variant Tooling (Bun / TypeScript)

#### `generate-l3-readme.ts`
**Purpose**: Regenerates `README.md`/`README_ko.md` for a Phase A L3 project (`Projects/<name>/`) from the workspace README Standard template (`templates/common/docs/README.template.md`), reading the live agent roster and skills via `scanL3Project()`. This is the Phase A self-service complement to `l3-to-variant-pipeline.ts`'s Phase B README generation — both call the same rendering engine (`helpers/generate-variant.ts`'s `generateReadme`/`generateReadmeKo`), so Phase A and Phase B READMEs can never drift structurally. Phase A is self-service only (no CI gate, consistent with the L3 Design Gate exemption); Phase B's `templates/co-*/` README standard stays hard-enforced by `WS-08` in `validate-templates.ts`. `create-l3-scaffold.ts` also calls this renderer directly at scaffold time, so even a same-day scaffold ships the real 7-section structure instead of a stub.
**Usage**: `bun scripts/generate-l3-readme.ts [--l3-path <path>] [--dry-run] [--locale en|ko|both]`
**Layer**: L0 (workspace infrastructure — not copied to templates/common/ or L3 projects)

**Flags**:

| Flag | Behavior |
|------|----------|
| `--l3-path <path>` | Target L3 project (defaults to `process.cwd()` — works bare from inside the project) |
| `--dry-run` | Print planned output (agent/skill counts, files would-write) without writing |
| `--locale en\|ko\|both` | Which README(s) to regenerate (default: `both`) |

**Typical workflow**:
```bash
bun scripts/generate-l3-readme.ts --l3-path Projects/co-journalist --dry-run  # preview
bun scripts/generate-l3-readme.ts --l3-path Projects/co-journalist            # write both
cd Projects/co-journalist && bun scripts/generate-l3-readme.ts                # bare form (cwd)
```

---

## Version Bump Policy

When modifying a script:
1. Increment `version` in the Registry row (semver: patch for bugfix, minor for feature)
2. Update the Guide section if the interface or behavior changes
3. If the change is breaking, set `status: deprecated` on the old version entry and
   add a new row for the replacement

---

*SCRIPTS.md — project snapshot (auto-generated at scaffold time)*
*Last updated: 2026-08-29 — verify-scripts.ts 1.4.2 (recursive variant-dir governance) and verify-skills.ts reconciled to L1 canonical; drifted core scripts restored.*
