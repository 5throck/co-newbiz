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
| `agent-create.ts` | L0 | 1.0.1 | active | —| —| L0+L1 | —|
| `skill-session-review.ts` | L0 | 1.2.0 | active | `--date`, `--json`, `--dry-run` | —| L0+L1 | —|
| `design-lint.ts` | L0 | 2.1.0 | active | —| —| L0+L1 | —|
| `co-newbiz/beta-series.ts` | co-newbiz | 1.0.0 | active | 2026-10-09 | — | L3-only (project-local; registers KRX index + per-company daily-close beta series for a brownfield project (`--project <id>`, optional `--ticker 이름=코드` pin) and collects them via the krx adapter `listDailyRows` hook through ensure_fresh; 단축코드 resolution cached in db/data/krx-stock-code-cache.json; manual cadence — runbook rb-beta-series) | —|
| `co-newbiz/newbiz.ts` | co-newbiz | 1.20.0 | active | —| —| L3-only (project-local analysis-engine CLI, design v1.0 §4-8, not part of L0/L1/L2 lineage; v1.13.0 adds the `db:export` case delegating to db-export.ts; v1.14.0 adds the Wave A1 `fetch` (source-adapter collection through ensure_fresh, design 2026-09-09-source-adapter-framework-design.md) and `md:sync` (idempotent natural-key catalog upserts) cases; v1.15.0 adds the Wave A2 `calibrate` (correlation.py wrapper -> proxy_link/proxy_chain) and `convert` (unit + proxy-chain conversion with error bands) cases; v1.16.0 adds the Wave A3 `policy:sync`/`policy:impact`/`fin:project` cases; v1.16.1 hardens Wave A fetch argument parsing and period-bound fetcher wrapping; v1.16.2 adds verified KOSIS monthly seed ranges; v1.17.0 adds `hwp-extract`; v1.20.0 adds the KRX day-grain `fetch` path and `krx` source grade) | —|
| `typecheck-baseline.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (Wave A quality gate: tsc diagnostics ratchet vs `quality/typecheck-baseline.json`) | —|
| `coverage-baseline.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (Wave A quality gate: lcov coverage ratchet vs `quality/coverage-baseline.json`) | —|
| `co-newbiz/env-check.ts` | co-newbiz | 1.1.1 | active | —| —| L3-only (project-local, ADR-0075 pre-flight gate for pipeline API stages — verifies `.env` has the four required keys (DART_API_KEY, LAW_API_OC, KOSIS_API_KEY, CO_NEWBIZ_API_TOKEN; names only, values never printed), reports CRLF contamination with the canonical `tr -d '\r'` load preamble, `--exports` emits CRLF-stripped shell-safe export lines for `eval`-based loading in shells without process substitution; --probe` live-validates LLM/DART/KOSIS/LAW/Tavily credentials with 1-request HTTP probes (flags rejected keys with status evidence) | —|
| `co-newbiz/db-export.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, `db:export --dialect postgres` — ADR-0002's portability verification mechanism: schema+data dump with INTEGER→BIGINT/REAL→DOUBLE PRECISION type mapping, GLOB-CHECK warnings surfaced, internal tables skipped, FK-order-safe data section) | —|
| `co-newbiz/policy-sync.ts` | co-newbiz | 1.0.1 | active | 2026-09-09 | — | L3-only (project-local, `policy:sync` + `policy:impact` — Wave A3: scans the policies/ tree into the policy registry (migration 0011) idempotent by doc_path with append-mostly supersession on edits (one live row retained); impact lists referencing skills/procedures/checklists/docs + in-flight pinned projects, the mechanical core of policy-change-impact-analysis) | — |
| `co-newbiz/fin-project.ts` | co-newbiz | 1.0.1 | active | 2026-10-09 | — | L3-only (project-local, `fin:project` — one project's financial rollup as JSON: business-case year-1 nets per scenario, latest-model valuation percentiles, charter KPI targets; read-only, Wave A3) | — |
| `co-newbiz/calibrate.ts` | co-newbiz | 1.1.0 | active | 2026-09-09 | — | L3-only (project-local, `calibrate` — Wave A2 statistical proxy-hop calibration: wraps python/correlation.py (OLS + lead-lag + 95% CI) → proxy_link statistical hop + single-hop proxy_chain, grade B/C per R² eligibility; recalibration replaces the pair's previous hop; v1.1.0 writes the correlation.py input into a private `os.tmpdir()` temp directory instead of hard-coded `/tmp`, restoring Windows runs) | — |
| `co-newbiz/convert.ts` | co-newbiz | 1.1.0 | active | 2026-10-08 | — | L3-only (project-local, `convert` — same-dimension unit conversion via md_unit.si_coefficient (known units auto-seed) with cross-dimension refusal per FR-DATA-03, or proxy-chain conversion carrying the chain's compounded-CI band and grade; 1.1.0: math delegated to packages/core-scoring unit-conversion) | — |
| `co-newbiz/kosis-units.ts` | co-newbiz | 1.0.2 | active | 2026-10-09 | — | L3-only (project-local helper — KOSIS unit string → md_unit mapping; unknown units are quarantined, never auto-converted, FR-DATA-03; includes KOSIS 2020=100 index units) | — |
| `co-newbiz/source-adapters.ts` | co-newbiz | 1.2.0 | active | 2026-10-09 | — | L3-only (project-local, `fetch`/`md:sync` engine — k-* skill-mapped source-adapter framework per design 2026-09-09-source-adapter-framework-design_ko.md: dart/**ecos**/kosis/law/opendata adapters sharing ensure_fresh (ADR-0004) + ssrf safeFetch; DART ZIP-safe corp-code parsing; ECOS_API_KEY StatisticSearch adapter (721Y001 월별 시장금리, items 5020000/7020000) per ADR-0116 Phase 3; LAW_API_OC law sync; verified KOSIS seed dimensions; OpenDART corpCode ZIP request headers; fail-closed on missing credentials, unknown-unit quarantine, natural-key catalog upserts | — |
| `co-newbiz/dart-collect.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, DART OpenAPI collector for chain-node financials — ADR-0066 Phase A: fnlttSinglAcntAll per year → fact_industry revenue/operating_income/net_income; requires DART_API_KEY, financial-imports REST fallback documented on failure) | —|
| `deploy-web.ts` | co-newbiz | 1.1.0 | active | —| —| L3-only (project-local ADR-0014 deploy gate for the Docker production stack — records the running image, pulls ghcr.io/5throck/co-newbiz-web:latest (`--build` builds locally), `docker compose up -d`, then gates completion on /api/health polling with concrete code/db rollback hints on failure; design 2026-09-21-docker-prod-cicd) | —|
| `co-newbiz/model.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, `model`/`diff` — run-based versioning via db/lib/versioning.ts: createRun input snapshot + overrides + input_hash, diffRuns variable-level bridge; NPV-level decomposition deferred until the valuation engine exists) | —|
| `co-newbiz/proc-resolve.ts` | co-newbiz | 1.2.1 | active | —| —| L3-only (project-local, `proc:resolve` — merges shared+region+entity procedures; v1.1.0 also merges `kill_criteria`, union with shared-first precedence; v1.2.0 adds a cwd-walk-up fallback for `PROCEDURES_ROOT` when `import.meta.dirname` is undefined — found under Turbopack's bundling of a Next.js Route Handler dynamic import, ADR-0069/0070 Phase 2; the CLI and Hono call sites are unaffected) | —|
| `co-newbiz/gen-pk-notnull-rebuild.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, one-off generator for migration 0033/ADR-0071 — reads sqlite_master, rewrites every single-column `TEXT PRIMARY KEY` to add `NOT NULL` (SQLite does not imply it, unblocking Prisma client generation), emits a topologically-sorted table-rebuild migration with view/trigger recreation; not intended for reuse beyond that one migration) | —|
| `co-newbiz/shadow-compare.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, ADR-0069/0070 Phase 4 — fires the same GET request at the Hono API and the Next.js port with one bearer token, normalizes volatile fields (as_of/timestamps), diffs the JSON bodies; GET-only by design since both stacks share one live database; 37 representative endpoints, one per source route file, first run 2026-08-26 with 0 mismatches) | —|
| `co-newbiz/lint-server-boundary.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, ADR-0070 Decision 2 mechanical enforcement — scans app/web-next/**/*.{ts,tsx} for two rules: a "use server" file importing data access, and a page/layout outside app/api/** importing data access; wired into scripts/audit.ts's full audit pass as of audit.ts 2.15.0; verified against both the clean codebase and a synthetic violation fixture) | —|
| `co-newbiz/mcp-coverage.ts` | co-newbiz | 1.0.0 | active | 2026-10-08 | — | L3-only (project-local, Wave M MCP coverage gate, ADR-0154 §4 — fails when a flow.spec S1-S12 activity or requiredArtifact has no MCP tool, when a tool references an unknown activity/artifact, or when a human-only exclusion in `mcp-coverage.exclusions.yaml` (closure, PMI kickoff, decision/approval execution routes) gains a tool or is not refused by the in-process route guard; also checks kind/scope consistency and that propose tools declare only POST /api/proposals; run through the variant audit hook `co-newbiz/audit-variant.ts`) | —|
| `co-newbiz/audit-variant.ts` | co-newbiz | 1.0.0 | active | 2026-10-08 | — | L3-only (project-local variant audit hook probed by scripts/audit.ts §27 at scripts/<variant>/audit-variant.ts; v1.0.0 runs the MCP coverage gate) | —|
| `co-newbiz/backfill-hyd-brk-report.ts` | co-newbiz | 1.1.0 | active | —| —| L3-only (project-local, one-time idempotent backfill retiring the HYD-BRK freeze sentinel (ADR-0112) — persists the hydraulic-breaker research matrix as a regular market_sizing_version payload (provenance frozen-research), marks the analysis completed, and remaps legacy ksic 'HYD-BRK' to the real KSIC 29241 (collision falls back to NULL); re-run is a no-op) | —|
| `co-newbiz/backfill-capability-gap.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, ADR-0136 one-time idempotent backfill — merges legacy `greenfield_assessment.capability_gaps_json` rows into `opportunity.capability_gap_json` (S3 register), matching by capability text; existing S3 rows only get missing fields filled, never overwritten; unmatched legacy rows are added with source `manual`; `--dry-run` supported) | —|
| `co-newbiz/backfill-brownfield-financial-criteria.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, one-time idempotent backfill — relabels the 5 legacy S7 builtin financial eval criteria to the 3 concrete 5-year-benchmark criteria (matched by `data_ref`), soft-deleting the two retired items (`net_margin`/`segment_manual`) while preserving any recorded assessment history for audit; `--dry-run` supported) | —|
| `co-newbiz/seed-hydraulic-breaker-matrix.ts` | co-newbiz | 1.1.0 | active | —| —| L3-only (project-local, one-off idempotent seed for the hydraulic-breaker region×segment×scenario demand matrix from docs/research/hydraulic-breaker-market-2026-driver-analysis.md §4 — inserts industry_driver/chain_node_sensitivity/structure_simulation_result rows keyed by region_code/segment_code, migration 0034/0035; legacy HYD-BRK sentinel auto-migrated to KSIC 29241 (ADR-0112); `--project-id <id>`) | —|
| `co-newbiz/register-hydraulic-breaker-assumptions.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, registers the hydraulic-breaker region×segment×scenario matrix into the assumption registry per docs/research/hydraulic-breaker-market-2026-driver-analysis.md §7 — 72 kind='assumed' rows (baseline_2026 + cagr down/base/up per region×segment) via recordAssumption with rationale + anchor_ref + TTL 365d, append-safe/idempotent; `[--run-id <id>]`, defaults to the hydraulic-breaker-matrix-seed run) | —|
| `co-newbiz/committee-deliberation.ts` | co-newbiz | 1.1.0 | active | —| —| L3-only (project-local, committee-deliberation CLI — ADR-0097 §7 committee-style deliberation on the runDeliberationRounds engine in app/web-next/lib/deliberation.ts; `bun scripts/co-newbiz/committee-deliberation.ts "topic" [--agents a,b] [--rounds N] [--dialogue]`, risk-officer seat mandatory, transcript written to memory/committee-YYYY-MM-DD-[slug].md) | —|
| `co-newbiz/fix-construction-machinery-link.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (one-time data fix, 2026-09-13 — retires the mislabeled 전방 proxy_link 유압식 브레이커→건설기계 장비 운용 (placeholder evidence) and re-registers it as 후방 with a real evidence_ref per the ADR-0129 retire+re-register contract; placeholder-evidence sweep included; idempotent, audited) | —|
| `co-newbiz/graph-map.ts` | co-newbiz | 1.2.0 | active | —| —| L3-only (project-local, procedure→agent/skill graph mapping; `--check` gates referential integrity + human-role registry consistency + skill-graph metadata bidirectional contract + SA-5 projection-level stage-edge validation, `--json` emits full mapping; v1.2.0 adds SA-5: every procedure node in the generated graph with a non-empty `gate` must have exactly one outgoing `in_stage` edge, per ADR-0083) | —|
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
| `co-newbiz/watch-run.ts` | co-newbiz | 1.1.0 | active | —| —| L3-only (project-local, `watch:run` — OS-scheduler-driven monitoring cycle: change detection -> auto RAG re-assessment -> transition -> notification, via db/lib/watch-engine.ts; v1.1.0 adds the ADR-0130 `runMarketSizingQueuePass` recovery pass that heals stuck market-sizing runs and claims ready pending linked analyses) | —|
| `co-newbiz/assume.ts` | co-newbiz | 1.0.0 | active | —| —| L3-only (project-local, `assume` — registers an assumption row via the shared FR-DATA-07 write path db/lib/assumption.ts, the same recordAssumption() POST /api/assumptions uses, so CLI and REST cannot drift on validation) | —|
| `co-newbiz/design-lint.ts` | co-newbiz | 1.4.0 | active | 2026-09-08 | — | ADR-0074 — Onyx 3.0 design system mechanical enforcement (hardcoded hex/rgba/hsl colors, onInput, nested main via depth scan, icon-only buttons without aria-label); exit 1 on violations; v1.1.0 fixed the inverted icon-button rule and the commented-out nested-main check, added rgba/hsl detection; v1.2.0 added the list-table standard check (row-action tables without `.list-table` or an actions header); v1.3.0 added the 14px font-size floor rule (Wave U-2); v1.4.0 added rule 7, a class-less `<button>` is rejected (R2-C) | — |
| `co-newbiz/contrast-check.ts` | co-newbiz | 1.0.0 | active | 2026-09-08 | — | L3-only (project-local, `contrast:check` — WCAG AA token-pair contrast over app/web-next/app/styles.css in both themes: hex/rgb/hsl parsing, var() resolution, alpha compositing; ENFORCED pairs fail below 4.5:1, advisory pairs warn; design-accessibility rule 6 mechanized, CI-wired) | — |
| `co-newbiz/ux-layout-check.ts` | co-newbiz | 1.0.0 | active | 2026-10-08 | — | Wave U-1 runtime layout check — at 1024/1280/390px no position:fixed element intersects the sidebar and no horizontal scroll; optional evidence screenshots; needs a running server and a test-account JSON (never real credentials) | — |
| `co-newbiz/db-integrity.ts` | co-newbiz | 1.0.0 | active | 2026-09-16 | — | L3-only (project-local, `db:integrity` — extends SQLite PRAGMA foreign_key_check with polymorphic gate_decision entity reference validation for opportunity/project ledgers; default read-only gate exits 1 on orphan rows, `--fix` prunes local demo orphan gate decisions only) | — |
| `co-newbiz/seed-s1-s12-demo.ts` | co-newbiz | 1.8.0 | active | 2026-10-09 | — | L3-only (project-local, `seed:s1-s12-demo` — idempotently creates one clearly-labelled Brownfield demo chain covering S1 market sizing through S12 portfolio scorecard so process/data/web surfaces can be smoke-tested without treating the rows as production data; v1.4.1 seeds a graduate_to_core venture_transition_decision so the demo completes S12 under the ADR-0150 criteria; v1.5.0 judges the Wave F-8 M&A sub-track checklist items (brownfield-feasibility, ma-special-topics) so S9 completes; v1.6.0 adds humanDecisions and subTrackDd options for the Wave C E2E scenarios (defaults unchanged); v1.7.0 seeds a structurally complete demo-labelled SizingMatrix so the S1 report renders instead of crashing; v1.8.0 adds seedGreenfieldS1ToS12Demo — a full greenfield S1-S12 twin chain (S5 entry strategy, REAL generator S8, establishment 5-step record, no target_screening gate) with idempotency guard, and fixes the adoption meta key to the canonical model_id) | — |
| `co-newbiz/demo.ts` | co-newbiz | 1.0.0 | active | 2026-10-08 | — | L3-only (project-local, `bun run demo` — Wave C-2 internal demo: boots the production build through the E2E harness on a free port (never 7748 or 7749) against a temp SQLite DB seeded with the S1-S12 brownfield demo chain (human decisions recorded) and the greenfield E2E deal, LLM/DART/web-research env blanked, prints runtime-generated first-login passwords once; `--capture` walks S1-S12 headlessly and writes numbered screenshots to docs/evidence/demo/) | — |
| `co-newbiz/runbook-validate.ts` | co-newbiz | 1.0.0 | active | 2026-09-10 | — | L3-only (project-local, `runbooks:validate` — registry hygiene for docs/runbooks/registry.yaml: parses, unique ids, en/ko file existence, frontmatter lang + counterpart pairs, no orphan .md under docs/{runbooks,guidelines,manuals}, and the library projection carries every registered file; tests/unit/runbook-registry.test.ts runs the same check) | — |
| `co-newbiz/sync-agent-personas.ts` | co-newbiz | 1.1.0 | active | 2026-10-08 | — | L3-only (project-local, `agents:personas` — generates .claude/agents/<name>.md subagent definitions from the agents/ roster with tier→model mapping; normalizes CRLF input before rendering generated descriptions; syncs the `domain:` frontmatter of agents/*.md from the AGENTS.md domain tables (ADR-0153); --check mode exits 1 on drift, CI-wired) | — |
| `co-newbiz/sync-library-projection.ts` | co-newbiz | 1.2.0 | active | 2026-10-12 | — | Refreshes app/web-next/lib/library.generated.ts (content, checklist version/items) from its source files; `--check` exits 1 when stale; never adds or removes a document; guarded by tests/unit/library-projection-sync.test.ts; v1.1.0 embeds the greenfield S9 workspace overlay as LIBRARY_WORKSPACE_OVERLAY (ADR-0160 addendum b); v1.2.0 also embeds the brownfield overlay as LIBRARY_BROWNFIELD_WORKSPACE_OVERLAY (ADR-0162) | — |
| `co-newbiz/generate-process-flow.ts` | co-newbiz | 1.4.0 | active | 2026-10-02 | — | ADR-0074 — regenerates docs/process-flow.md from process/flow.spec.yaml (plus hand-maintained S8–S12 automation addendum, ADR-0095~0102); --check mode exits 1 on drift; v1.4.0 regenerates the S12 automation-addendum entries for the ADR-0150 six-criteria predicate | — |
| `co-newbiz/generate-spec-activities.ts` | co-newbiz | 1.1.0 | active | 2026-10-08 | — | Regenerates app/web-next/lib/spec-activities.generated.ts and mcp/co-newbiz/stage-guides.generated.ts (the MCP stage_guide prompts slice) (SPEC_VERSION + SPEC_STAGES static projection for the Next/Turbopack server bundle) from process/flow.spec.yaml; deterministic 2-space JSON output; --check mode exits 1 on drift; drift-gated by tests/unit/process-flow.test.ts | — |
| `co-newbiz/generate-prompt-registry.ts` | co-newbiz | 1.0.0 | active | 2026-09-15 | — | Projects app/web-next/prompts/prompts.json SSOT into app/web-next/lib/prompts.generated.ts (system prompts, owning agent, ledger purpose); rerun after prompt edits | — |
| `co-newbiz/generate-agent-registry.ts` | co-newbiz | 1.1.0 | active | 2026-09-13 | — | ADR-0128 — projects agents/*.md roster into app/web-next/lib/agent-registry.generated.ts for the runtime PM router; rerun after roster edits | — |
| `co-newbiz/job-worker.ts` | co-newbiz | 1.0.0 | active | 2026-09-19 | — | L3-only (project-local, parallel-execution child-process entrypoint for the independent job layer) | — |
| `co-newbiz/seed-benchmark-cases.ts` | co-newbiz | 1.0.0 | active | 2026-08-30 | — | ADR-0074 — idempotent seed of 8 public benchmark deals into benchmark_case (migration 0041) | — |
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
| `agent-lifecycle-audit.ts` | L0 | 1.7.0 | active | v1.4.0: discovers all agents/*.md; agent passes with a role or a description | —| L0+L1 | —|
| `agent-list.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `agent-verify.ts` | L0 | 1.0.2 | active | —| —| L0+L1 | —|
| `analyze-git-history.ts` | L0 | 1.0.2 | active | —| —| L0+L1 | —|
| `archive-memory.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `audit.ts` | L0 | 2.53.0 | active | —| —| L0+L1 | —|
| `cleanup-completed-md.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `clear-pm-approval.ts` | L0 | 1.0.0 | active | —| —| L0+L1 | —|
| `compile-tokens.ts` | L0 | 1.2.0 | active | —| —| L0+L1 | —|
| `dev-sync.ts` | L0 | 1.26.0 | active | —| —| L0+L1 | —|
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
| `hooks/gateguard-fact-force.ts` | L0 | 1.3.0 | active | —| —| L0+L1 | —|
| `hooks/post-write-lifecycle-check.ts` | L0 | 1.2.0 | active | —| —| L0+L1 | —|
| `hooks/pre-commit.ts` | L0 | 1.9.0 | active | —| —| L0+L1 | —|
| `hooks/pre-push.ts` | L0 | 1.4.1 | active | —| —| L0+L1 | —|
| `lib/auth.ts` | L0 | 1.0.0 | active | —| —| L0+L1 | —|
| `lib/encoding-utils.ts` | L0 | 1.2.0 | active | —| —| L0+L1 | —|
| `lib/error-handling.ts` | L0 | 1.4.0 | active | —| —| L0+L1 | —|
| `lib/language-guard.ts` | L0 | 1.0.0 | active | —| —| L0+L1 | —|
| `lib/git-status.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `lib/pipeline-state.ts` | L0 | 1.2.0 | active | —| —| L0+L1 | —|
| `lib/platform-context.ts` | L0 | 1.0.0 | active | —| —| L0+L1 | —|
| `lib/ssrf.ts` | L0 | 1.1.2 | active | —| —| L0+L1 (SSRF-safe pinned fetch with caller-supplied request headers); v1.1.2 removes two stale `@ts-expect-error` directives on the `LookupFunction` overloads that current Node types no longer need (was failing `tsc`/`next build`) | —|
| `lib/env-keys.ts` | L0 | 1.0.2 | active | 2026-09-11 | — | L0+L1 (pipeline credential loader — walks up to the root .env and imports only whitelisted pipeline keys, never overriding set values; shared by the k-* source adapters; includes LAW_API_OC for k-law and ECOS_API_KEY for k-ecos) | —|
| `lifecycle-sync-audit.ts` | L0 | 1.18.0 | active | —| —| L0+L1 | —|
| `md-to-ooxml.ts` | L0 | 1.2.0 | active | —| —| L0+L1 | —|
| `qa-gate.ts` | L0 | 1.3.0 | active | —| —| L0+L1 | —|
| `readme-lifecycle-audit.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `render-pdf-deck.ts` | L0 | 1.0.1 | active | —| —| L0+L1 | —|
| `retry-handler.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `setup-github-branch-protection.ts` | L0 | 1.0.1 | active | `--repo`, `--branch`, `--check` (repeatable), `--dry-run` | —| L0+L1 | —|
| `skill-lifecycle-audit.ts` | L0 | 1.8.0 | active | —| —| L0+L1 | —|
| `spec-register.ts` | L0 | 1.6.0 | active | `--file`, `--source`, `--update`, `--status`, `--list`, `--ref`, `--id` | —| L0+L1 | —|
| `lib/local-date.ts` | L0 | 1.0.0 | active | —| —| L0+L1 | —|
| `typecheck.ts` | L0 | 1.2.0 | active | —| —| L0+L1 | —|
| `sync-md.ts` | L0 | 1.4.0 | active | —| —| L0+L1 | —|
| `sync-skill-status.ts` | L0 | 1.1.0 | active | — | — | L0+L1 | — |
| `sync-skills.ts` | L0 | 1.11.0 | active | `--dir <path>`, `--all-variants` | — | L0+L1 | — |
| `team-builder.ts` | L0 | 1.4.1 | active | —| —| L0+L1 | —|
| `test-runner.ts` | L0 | 1.7.0 | active | 2026-10-08 | —| L0+L1 (`--parallel`, `--sequential`, `--concurrency <n>`, `--timeout <ms>`, `--allow-empty`) — v1.5.0: empty suites fail by default and scripts suite scans `scripts/tests/*.test.ts`; v1.6.0: bun test runs with `--timeout=30000` (per-test/hook default 5s flaked fresh-DB migration hooks on CI runners); scenarios suite runs sequentially, *.test.ts only (Wave C) | —|
| `translate-readme.ts` | L0 | 1.0.0 | active | —| —| L0+L1 | —|
| `validate-agents.ts` | L0 | 1.3.2 | active | —| —| L0+L1 | —|
| `validate-doc-folder.ts` | L0 | 1.2.1 | active | —| —| L0+L1 | —|
| `validate-docs-links.ts` | L0 | 1.5.0 | active | —| —| L0+L1 | —|
| `validate-md-language.ts` | L0 | 1.15.0 | active | —| —| L0+L1 | —|
| `validate-model-registry.ts` | L0 | 1.4.1 | active | —| —| L0+L1 | —|
| `validate-skills.ts` | L0 | 1.5.1 | active | —| —| L0+L1 | —|
| `verify-agent-deliverables.ts` | L0 | 1.0.1 | active | —| —| L0+L1 | —|
| `verify-memory.ts` | L0 | 1.2.0 | active | —| —| L0+L1 | —|
| `verify-platform-lifecycle.ts` | L0 | 1.6.1 | active | —| —| L0+L1 | —|
| `verify-readme-sync.ts` | L0 | 1.4.1 | active | —| —| L0+L1 | —|
| `verify-skill-graph.ts` | L0 | 2.0.0 | active | —| —| L0+L1 | —|
| `verify-scripts.ts` | L0 | 1.12.0 | active | v1.10.0: registry column-count check | —| L0+L1 | —|
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
| `validate-templates.ts` | L0 | 1.55.0 | active | v1.50.2: skips cleanly when no templates/common (project context) | —| L0+L1 | —|
| `helpers/upgrade-versions.ts` | L0+L1 | 1.0.2 | active | —| —| L0+L1 | —|
| `lib/propagation-map-schema.ts` | L0 | 1.3.0 | active | —| —| L0+L1 | —|
| `lib/constitution-scrub.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `helpers/l0-ref-policy.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `helpers/markers.ts` | L0 | 1.3.0 | active | —| —| L0+L1 | —|
| `helpers/layer-filter.ts` | L0 | 1.5.0 | active | —| —| L0+L1 | —|
| `generate-version-manifest.ts` | L0 | 1.10.0 | active | emits `validate-md-language:allowlist` markers around the generated Skills table (T-20260912-015) | —| L0+L1 | —|
| `lib/platform-delivery.ts` | L0 | 1.0.0 | active | —| —| L0+L1 | —|
| `lib/managed-block-parity.ts` | L0 | 1.2.0 | active | —| —| L0+L1 | —|
| `lib/variant-overlay-guard.ts` | L0 | 1.0.0 | active | —| —| L0+L1 | —|
| `lib/platform-mirror-freshness.ts` | L0 | 1.1.0 | active | Pure platform-skill-mirror vs skills/ SSOT version comparison for the platform-mirror-freshness check (T-20260916-008) | —| L0+L1 | —|
| `helpers/rollback-partial-project.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `helpers/scaffold-markers.ts` | L0 | 1.8.0 | active | Shared scaffold marker constants + (marker→source) mapping + delivery-tree derivations + transient test-fixture predicate (T-20260916-001) | —| L0+L1 | —|
| `lint-instructions.ts` | L0 | 1.0.0 | active | `--dir`, `--strict` | —| L0+L1 | —|
| `helpers/merge-state.ts` | L0 | 1.0.0 | active | §3.3 shared-file taxonomy + unresolved-conflict parsing for dev-sync main-drift/--conclude-merge (ADR-0081/T-20260918-002) | —| L0+L1 | —|
| `bootstrap-stages.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `evidence-backport-scan.ts` | L0 | 1.1.0 | active | Evidence Backporting scanner — read-only form detection (F1/F2/F3/F0/MIXED) + M1-M6 maturity bar over Projects/co-* evidence planes (ADR-0084 Decision 6, design §4); consumes graph-delta-log.ts output for M2/M4/M6b with git-log fallback; project-resync Step 2b | —| L0+L1 | —|
| `generate-raci.ts` | L0 | 1.2.0 | active | RACI matrix generator per ADR-0083 P4, ADR-0084 §3.4; derives A/R from procedures, accepts explicit C/I; loads governance/_human-roles.yaml when present; emits actor_types map when registry exists; sets schema_version: "1.1" for registries | —| L0+L1 | —|
| `graph-delta-log.ts` | L0 | 1.1.0 | active | Graph Delta Log — compute and persist per-scope structural diffs between committed and derived skill graphs (ADR-0084 §5); two-layer delivery (workspace root + projects); consumed by evidence-backport-scan.ts maturity bar (M2, M4, M6b tests) | —| L0+L1 | —|
| `migrate-quality-gates.ts` | L0 | 1.1.0 | active | Convert quality_gates prose entries to decision gates; automate classification (GATE vs INVARIANT vs MANUAL), YAML output, procedure schema updates, and _output-types.yaml enrichment (ADR-0083 P5); decider_agent derived from stage owner_agent, not procedure owner_agent | —| L0+L1 | —|
| `validate-process.ts` | L0 | 1.0.0 | active | Process/stages validation (ADR-0083 DEG-P-*), distinctness check (`--determinism` flag) | —| L0+L1 | —|
| `validate-raci.ts` | L0 | 1.2.0 | active | RACI validation per ADR-0083 DEG-R-01..05 + ADR-0084 DEG-R-06/07; DEG-R-06: human-accountable must match gate; DEG-R-07: actor_types key set must equal R/A/C/I union | —| L0+L1 | —|
| `lib/dependency-guard.ts` | L0 | 1.0.2 | active | DEPENDENCY GUARD — scans delivered scripts' bare-package imports vs project package.json, reports missing packages in the upgrade plan (T-20260920-001) | —| L0+L1 | —|
| `lib/upgrade-policy.ts` | L0 | 1.22.0 | active | exports `lifecyclelessText()` (equal-version agent drift) + `isDeliveredDiff()` (dev-sync 3.9 auto-E5, rollout hardening 2026-09-21) | —| L0+L1 | —|
| `helpers/golden-reference-loader.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `helpers/mirror-hygiene.ts` | L0 | 1.0.0 | active | v1.0.0 mirror-hygiene scanner (R6, spec docs/designs/2026-09-25-verifier-platform-expansion-design.md): a platform skill mirror contains only skill directories; stray files (SKILLS.md/README*.md) and non-skill dirs are findings; wired into validate-templates checkMirrorHygiene (WARN soak) | —| L0+L1 | —|
| `helpers/registries/capability-registry.ts` | L0 | 1.1.0 | active | —| —| L0+L1 | —|
| `helpers/registries/validation-policy.ts` | L0 | 1.3.0 | active | —| —| L0+L1 | —|
| `helpers/registries/variant-type-registry.ts` | L0 | 1.2.0 | active | —| —| L0+L1 | —|
| `helpers/resolve-pm-stub.ts` | L0 | 1.2.0 | active | v1.2.0 (registry & platform-policy completeness batch, spec docs/designs/2026-09-25-registry-policy-completeness-design.md R2.1): pure, read-only `composeResolvedAgentContent(agentPath, commonAgentPath, variant, opts)` returns exactly the content `resolveAgentExtendsStub` would write, without touching the filesystem (validators must not mutate the tree they audit); the resolver consumes the compose path so one merge implementation exists (in-place writer stays for the new-project/adopt-project delivery paths). Prior: v1.1.0 (T-20260924-003, spec docs/designs/2026-09-25-inventory-decisions-batch-design.md R2.2): generic `resolveAgentExtendsStub(agentPath, commonAgentPath, variant, opts)` wrapper — the pm canonical-prose check (H12) moves behind an injected `opts.isCanonicalStubBody` (pm passes isCanonicalPmStubBody; the empty-body i18n-specialist stubs skip it); `resolvePmExtendsStub` stays as a thin back-compat wrapper. Prior: Shared agents/pm.md normalization — ADR-0033 extends-stub resolution against the L1 body (H12 non-canonical prose flag) + L1-B metadata strip with project-local lifecycle regeneration; extracted verbatim from new-project §2.3b/§2.5, shared with the adopt-project settling pass | —| L0+L1 | —|
| `helpers/skills-registry.ts` | L0 | 1.2.0 | active | v1.2.0 (registry-policy-completeness batch W5, spec docs/designs/2026-09-25-registry-policy-completeness-design.md R5.1): registry auto-sync machinery — collectRegistryDrift, listSkillDirs, splitRootRegistry, collectCatalogEntries, collectCatalogDrift, syncVariantExclusiveCatalog, syncGenericRegistry, collectWorkspaceRegistryFindings (pure compute shared by the sync CLI, validate-templates VA-08, and unit tests; the root Variant-Exclusive catalog reconciles via a dedicated path — its 7th column is the owner-variant list, not notes). Prior: v1.1.0 (T-20260924-008, spec docs/designs/2026-09-24-skills-registry-overlay-reconcile-design.md): adds collectDeliveredSkills + pruneSkillRegistryRows (fresh-scaffold reconcile half); extractFrontmatterVersionAndReviewed moved in verbatim from upgrade-project.ts. v1.0.0: parse/reconcile project skills/SKILLS.md (T-20260922-001) | —| L0+L1 | —|
| `lib/platforms.ts` | L0 | 1.2.0 | active | Platform-list SSOT constants (PLATFORM_SKILL_BASES, PLATFORM_MIRROR_DIRS); Step 1 of the platform-parity program (spec: docs/designs/2026-09-24-platform-ssot-constant-design.md) | —| L0+L1 | —|
| `regenerate-agents-md.ts` | L0 | 1.3.0 | active | v1.2.0: tier extraction strips inline YAML comments (`medium # model-id` leaked into roster rows). | —| L0+L1 | —|
| `lib/ci-workflow-merge.ts` | L0 | 1.0.0 | active | v1.0.0 (T-20260930-026 PR-A, ADR-0094): fail-closed merge/validate of a project `.github/workflows/ci.yml` against the template — 12 error codes (MARKER_*, REGION_*, YAML_PARSE, DUPLICATE_KEY, RESERVED_JOB, FORBIDDEN_TRIGGER, TEMPLATE_JOB_DRIFT, MIGRATION_UNSAFE); PROJECT-JOBS region is untrusted input; legacy migration copies original text slices (never re-serializes); fs confined to applyCiWorkflowMerge (temp + re-validate + atomic rename) | —| L0+L1 | —|
| `validate-surface-registry.ts` | L0+L1 | 1.1.1 | active | v1.0.0 (2026-10-01, T-20261001-018, spec docs/designs/2026-10-01-surface-registry-validator-design.md): §11.0 supported-surface registry validator (ADR-0097 follow-up) — parses the 8-row CONSTITUTION table as the single source, checks instruction files/platform dirs per family/L2 skill mirroring (mirror:false honored, SCAFFOLD_COMPOSED excluded) at L0/L1/L2, compares templates/common/docs/context.md rows verbatim (one source), renders documented gaps (docs/surface-gaps.json) as WARN with ticket id and undocumented gaps as FAIL; audit.ts gate with --strict. | —| L0+L1 | —|
| `hooks/pm-role-bootstrap.ts` | L0 | 1.0.1 | active | SessionStart hook (all sources: startup, resume, clear, compact) injecting PM bootstrap reminder to read AGENTS.md and agents/pm.md before first response — design spec docs/designs/2026-10-02-pm-role-bootstrap-design.md | —| L0+L1 | —|
| `lib/self-managed-tools.ts` | L0+L1 | 1.1.0 | active | v1.0.0 (2026-10-02, T-20261002-001, spec docs/designs/2026-10-02-self-managed-tool-surfaces-design.md): shared loader for docs/self-managed-surfaces.json — the generic self-managed tool registry. Validators consult isSelfManagedPath to skip tool-owned surfaces (graft platform mirrors + helpers transferred to tool custody); selfManagedMirrorSkills seeds verify-platform-lifecycle's VERSION_EXEMPT_PLATFORM_SKILLS. | —| L0+L1 | —|
| `dependency-audit.ts` | L0 | 1.1.0 | active | v1.0.0 (T-20261003-011, spec docs/designs/2026-10-03-dependency-audit-waiver-design.md): waiver-aware `bun audit --json` gate for the CI dependency-audit job — fails on any high/critical finding, treats empty/unparseable output as an infrastructure failure, and adds a reviewed advisory-waiver channel (`.github/dependency-waivers.toml`; strict schema: advisory GHSA id, package, version pin, scope, reason, decided_by, revisit_by). Fail-closed on malformed file, expired revisit-by date, stale waiver (advisory no longer in audit output), installed-version drift, duplicate waivers, and dev-only scope contradiction | —| L0+L1 | —|
| `normalize-registry-provenance.ts` | L0 | 1.1.0 | active | v1.1.0 (2026-10-07, co-newbiz review follow-up): explicit nonstandard-vocabulary handling — shape-valid rows whose source/layer vocabulary is a per-repo convention (co-newbiz's `co-newbiz · L3-only prose` rows, 81 at review time) are skipped AND reported instead of falling out of the parse regex silently; duplicate script keys across registry rows are reported (report-only). Motivation: the co-newbiz format review found its vocabulary truthful (zero variant-delivered scripts) and only 6 hand-deduped duplicate rows. Prior: v1.0.0 (2026-10-07, spec docs/designs/2026-10-07-registry-provenance-normalization-design.md): initial release — relabels fossil provenance stamps in inherited project scripts/SCRIPTS.md registries: L1-delivered rows untouched, variant-overlay rows whose file exists in templates/<variant>/scripts become `L2 · L2-only`, project-local rows become `L3 · L3`, rows whose file exists nowhere are reported as ghosts (--strict fails on them, no auto-edit). Idempotent; --dry and --root for reuse across the fleet; wired into upgrade-project.ts v1.66.0 as a non-fatal post-upgrade pass. Motivation: fleet inspection found 113 fossil rows across 8 projects (co-deck 60, co-safety 33, co-consult 9, co-architect 6, co-game 3, co-price 2, co-design 1, co-abap 1) — stamps inherited from the 2026-07-02 L1 sync outlived the restructure that dropped those rows from the true L0/L1 registries | —| L0+L1 | —|
| `helpers/version-bump.ts` | L0 | 1.0.0 | active | v1.0.0 (2026-10-08, user directive): pure staged-version-bump detection (`detectVersionBumps`, `diffChangesVersion`, `hasTestUnitScript`) for dev-sync step 4.85 | —| L0+L1 | —|
| `lib/package-merge.ts` | L0 | 1.0.0 | active | v1.0.0 (2026-10-09, T-20261009-002, design 2026-10-09-scaffold-package-merge-and-baseline-surfacing): scaffold package.json merge primitives — mergePackageJson (scalar variant-wins, object keys per-key, non-object overlay preserves generated), hasTier2Scripts, evaluateScaffoldPackageContract (VA-08 decision core) | —| L0+L1 | —|
| `lib/skill-graph-compat.ts` | L0 | 1.1.0 | active | v1.1.0 (2026-10-09, T-20261008-009): normalizeForHash strips the ADR-0033 stub `variant:` token alongside `scope:` — stub agent families stop re-appearing as E2 drift findings. Prior: v1.0.0 (2026-10-08, skill-graph v2 design): v1 -> v2 skill-graph compat loader (`loadSkillGraph`, `upgradeSkillGraph`), `capabilityOf` (fleet-convergence grouping key), `contentHash`/`normalizeForHash`, `dedupeEdges`, `findCapabilityDivergence` (E2). Shared by generate/verify-skill-graph, skill-graph-fleet-report, graph-delta-log, validate-templates | —| L0+L1 | —|
| `lib/skills-used.ts` | L0 | 1.0.0 | active | v1.0.0 (2026-10-08, skill-graph v2 E3): `## Skills Used` evidence parser (`parseSkillsUsed`) extracted from skill-session-review.ts; shared with generate-skill-graph.ts | —| L0+L1 | —|
| `helpers/commit-message.ts` | L0 | 1.0.0 | active | v1.0.0 (2026-10-11, U-20261008-001, spec docs/designs/2026-10-11-backlog-batch-2-design.md): pure commit-message composition for dev-sync step 1 (`isWeakCommitMessage`, `deriveCommitMessage`, `composeCommitMessage`) — weak caller shapes replaced by a task-staged-set summary, 72-char budget, spec-id citation | —| L0+L1 | —|
| `helpers/ignored-tooling.ts` | L0+L1 | 1.0.0 | active | v1.0.0 (2026-10-11, T-20261011-014): selectIgnoredToolingArtifacts — picks machine-local tooling artifacts (extensionless executables, binary extensions) out of a git ls-files --others --ignored listing, skipping dep/cache/build trees and OS junk; consumed by upgrade-project's pre-upgrade stash inventory warning. | —| L0+L1 | —|
| `lib/model-literal-patterns.ts` | L0 | 1.0.0 | active | v1.0.0 (2026-10-11, T-20261011-015): shared model-ID literal detection for skill-lifecycle-audit Check MM and sync-model-registry.ts — versioned claude-/gemini-/gpt-5.* regex set + pure findModelLiterals; registry model IDs live only in docs/workspace-schema.json (models.*) and the CLAUDE.md §6 / AGENTS.md §3.6 managed prose, never in skills | —| L0+L1 | —|
| `upgrade-project.ts` | L0+L1 | 1.70.0 | active | v1.70.0 (2026-10-11, T-20261011-014): pre-upgrade stash inventory warning — stash push -u skips gitignored files, so machine-local tooling (co-abap's vsp binary) fell outside the rollback snapshot; before the stash, gitignored untracked files are enumerated via helpers/ignored-tooling.ts and tooling-like entries are warned with an inventory (stash behavior unchanged). Prior: v1.69.0 (2026-10-10, eight-platform coverage): list-valued `platform=` parsed via parsePlatformList (MERGE_FILES = union; `both` = all). v1.68.0 (T-20261007-028 + T-20261007-018): --preflight (clean tree / open PRs / template-version.txt, exit 0/1, no mutation); the delivery manifest write composes .claude/last-upgrade-pr-body.md at delivery time (stale-carried-body class). v1.67.0 (T-20261006-009 + T-20261006-010): PRUNE REMOVED agents/ consults the root agents/ SSOT (no more wrong "project-owned" basis); the registry-curated deletion exemption documented at v1.64.0 and the pass ordering pinned by test. v1.66.0 (2026-10-07, spec docs/designs/2026-10-07-registry-provenance-normalization-design.md): new POST-UPGRADE PROVENANCE NORMALIZE pass — after the scripts-snapshot regeneration, normalize-registry-provenance.ts relabels fossil provenance stamps in the project scripts/SCRIPTS.md (variant-delivered rows to `L2 · L2-only`, project-local rows to `L3 · L3`). Fossil `L0 · common` stamps from the pre-restructure era survived every upgrade because no pass touched the provenance columns (fleet inspection 2026-10-07: co-deck 60, co-safety 33, co-consult 9, co-architect 6, co-game 3, co-price 2, co-design 1, co-abap 1 rows). Non-fatal, dry-run aware — same contract as the snapshot and manifest regeneration blocks. Prior: v1.65.0 (2026-10-07, U-20261006-001): scripts-snapshot.json regenerated post-upgrade — the L2 script-version baseline was written only at scaffold/adopt and PROJECT_STATE-preserved forever, so every upgrade re-reported the same stale snapshot drift; reclassified REGENERATED (upgrade-policy v1.22.0) and regenerated in place via helpers/write-scripts-snapshot.ts (cwd = workspace root, project dir as argument, same as the scaffold/adopt call sites); non-fatal on failure. Prior: v1.64.0 (2026-10-06, U-20261006-005 upstream request from co-develop): PRUNE REMOVED goes preserve-by-default for project-owned (L3) agents/ and skills/ roster entries — the 2026-09-12 fleet-sync hard-deleted co-develop's exam-bank-steward.md + exam-bank-operations with no ADR-0080 decision record. Ownership test (no agents/skills delivery registry exists): a project file absent from every template tree and not manifest-blessed is project-owned → KEEP ("project-owned, kept") + ADR-0080 deprecation pointer; skills deletion fires only with an explicit retirement record (isRetiredSkill hoisted from the mirror sweep and shared); scripts/ registry-aware retirement (scriptIsRetiredDelivery) unchanged. Prior: v1.63.0 (2026-10-05, spec docs/designs/2026-10-05-country-prune-context-scrub-design.md): COUNTRY-SCOPED SKILL PRUNE context-doc scrub filter extended to bold table rows + skill-path shapes (parity with helpers/prune-country-scoped-assets v0.4.0) — pre-fix region-neutral scaffolds self-heal on the next upgrade. Prior: v1.62.0 (2026-10-02, T-20261002-015): LOCAL-PATCH report — before delivery the project tree is scanned for LOCAL-PATCH(upstream-request: <id>) markers and the summary lists every marked file + ticket id (upstream design Phase 3; scan runs pre-pass so overwritten patches are still reported). Prior: v1.61.0 (T-20260930-026 PR-A, ADR-0094): ci.yml MERGE via lib/ci-workflow-merge.ts — template jobs authoritative, PROJECT-JOBS region preserved, legacy marker-less migration by text-slice copy, fail-closed (no write, exit 1), temp+validate+atomic rename; new `--accept-ci-perm-diff` flag; dry-run prints per-project summary. Prior: v1.60.0 (T-20260930-025): docs/context.md re-delivery renders the scaffold placeholder map (applySubstitutions) before every write — stops the per-upgrade [Project Name] identity regression. v1.59.0 (T-20260927-010): new REGION PROFILES SYNC pass — per-file add-if-missing delivery of region-profiles/** (v1.19.0 policy claim), no clobber of project-customized profiles. Prior: v1.58.0 (2026-09-29): agents/ SYNC renders project-name placeholders before drift compare and writes (scaffolded names no longer reverted to [Project Name]); delivery manifest porcelain parsing fixed. Prior: v1.57.0 (2026-09-29): agent tier-comment migration strips stale model-ID comments from project agents/*.md tier lines. Prior: v1.56.0: SKILLS_REGISTRY_RECONCILE aligns row status/owner with delivered SKILL.md frontmatter (alignSkillRegistryRowsWithFrontmatter, previously scaffold-only) — fixes `Registry owner drift` after an upgrade replaces a project-local skill with the L0 copy. Prior: v1.55.0 (ADR-0093 Amendment 2): legacy `Hermes.md` renamed to `HERMES.md` before the MERGE pass (Hermes discovers only `.hermes.md`/`HERMES.md`; `git mv` when tracked, two-step temp rename for case-insensitive filesystems). Prior: v1.54.0 (ADR-0093, spec docs/designs/2026-09-27-hermes-md-instruction-file-design.md): HERMES.md joins the MERGE push for platform hermes/all — COMMON-HERMES managed block makes the MERGE pass its delivery channel (resolveClaim MERGE_MANAGED via upgrade-policy v1.18.0). Prior: v1.53.0 (T-20260926-030): VARIANT SCRIPTS pass delivers &quot;.json&quot; variant config files (atc-rulepack.json, tsconfig.json) — scaffold-only delivery meant post-scaffold template updates never reached live projects; unversioned .json flows through the existing hash-compare branch. Prior: v1.52.0 (T-20260926-021): W2 HARVEST line computation extracted to the pure helper `harvestVariantOnlyLines` (helpers/context-sections v1.8.0) and unit-tested; harvest report discloses the comparison is best-match-section-only. Prior: v1.51.0 (ADR-0088 W2): `.hermes` joins the platform set — VARIANT_ASSET_DIR_SKIP, upstream skill-name sources, and both mirrorRoot sweeps cover the fifth platform mirror. Prior: v1.50.0 (Design Gate delivery repair, spec docs/designs/2026-09-25-registry-policy-completeness-design.md W5 follow-up): SYNC_IF_NEWER scripts/ walk fully recursive — the flat one-level walk could not reach helpers/registries/*, so golden-reference-loader's transitive imports shipped broken in every project upgrade and the project-side Design Gate spec-check crashed on import. Prior: v1.49.0 (T-20260924-003, spec docs/designs/2026-09-25-inventory-decisions-batch-design.md R2.4): the agents/ SYNC pass skips template files whose frontmatter carries `extends:` (pure isExtendsStub from lib/upgrade-policy.ts) with a `STUB (resolved at scaffold)` line — fixes the v1.35.0 drift-reconciliation clobber where an apply-mode upgrade overwrote a project's resolved 349-line pm.md body with the 8-line template stub (proven by Projects/co-work dry-run); also protects the 13 new variant i18n-specialist.md stubs. Prior: v1.48.0 (T-20260924-011, spec docs/designs/2026-09-25-codex-merge-claim-routing-design.md D2/R4-R6): the VARIANT ASSET DIRS pass consults resolveClaim per walked file and delivers only VARIANT_ASSET_DIRS_PASS claims (procedures/** drops out; skipped files log one summary line per directory; generic asset dirs keep NEW/UPDATE/CONFLICT/COPIED; `.codex` stays in the skip set). Prior: v1.47.0 (platform-parity P1 bugfixes, spec docs/designs/2026-09-24-platform-parity-p1-bugfixes-design.md D2+D3): foreign-variant skill prune iterates PLATFORM_SKILL_BASES (a foreign skill's .codex copy no longer survives the prune); `.codex` joins VARIANT_ASSET_DIR_SKIP (the variant's top-level .codex/ is no longer hash-synced over project-owned Codex config — general resolveClaim bypass: T-20260924-011). Prior: v1.46.1 (T-20260924-008): mechanical move only — extractFrontmatterVersionAndReviewed relocated verbatim to `helpers/skills-registry.ts` and imported back; NO behavior change. Prior: v1.46.0 (scaffold identity overview §13, spec docs/designs/2026-09-24-scaffold-identity-overview-design.md): IDENTITY SEED step after TEMPLATE TREE SYNC — renders docs/project.template.md into docs/project.md ONLY when absent (existing file → no write, no verdict; AC4); sync pass walk untouched (its ADD_IF_MISSING claim for that path is a defensive no-op). Prior: v1.44.0 (T-20260923-003/-004): PRUNE REMOVED scripts/ category registry-aware — variant-sourced rows KEEP, pruned rows dropped; L1 engine mirror retired (ADR-0073 Amd. 1+3). Prior: v1.43.0 (adopt-project prerequisites): variant-scope skill prune honors variant.json skill_manifest; `.gitattributes` merge-aware LOCKED delivery. Prior: `--variant`/`--platform`/`--dry-run`/`--prune-removed`/`--rollback`/`--yes`/`--skip-context-commonization`/`--force-context-sync`; COMMON-CONTEXT splice under PRESERVE (T-20260919-003); skill sub-file sync (2026-09-21); W2 HARVEST (2026-09-22) | —| L0+L1 | —|

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
**v1.1.0**: Documented parallel execution capabilities, worker pool temp directory isolation (`tests/.temp/worker-<id>`), automatic sequential fallback, and CLI flags (`--parallel`, `--sequential`, `--concurrency <n>`, `--timeout <ms>`).

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
