# Project Review — co-newbiz — 2026-09-22
**Date**: 2026-09-22
**Scope**: variant project / full
**Method**: machine baseline + 4 parallel specialist review slots (architecture, standards+lifecycle, automation, docs+security) + in-session fixes
> Fixes were applied in this session (Critical + High + selected Moderate/Low); see `## Verification`.

## Context

Same-day change set under review: ADR-0143 S8 multi-target feasibility (PR #401), agent roster repair (PR #403), persona integrity gate (PR #404), dev origins fix (PR #405), plus the L0 validator gate (ai-workspace-standards #1017).

## Baseline (machine battery)

| Validator | Result |
|---|---|
| `audit.ts` | ✅ all checks passed |
| `verify-scripts.ts --verify` | ✅ 182 registered scripts, 0 warnings |
| `skill-lifecycle-audit` | ✅ 103 skills healthy |
| `agent-lifecycle-audit` | ⚠️ 3 warnings (pm.md missing `role:`; stale `last_updated` on pm.md / i18n-specialist.md) |
| `validate-templates.ts` | ❌ **crashes in variant context** — ENOENT `templates/common/AGENTS.md` (L0-only assumption, no graceful degradation) → `script-gap` |

## Review Results — co-newbiz — 2026-09-22

### 🔴 Critical (fix immediately — fixed in-session)

| # | Issue | Agent | File:Line | Class | Fix |
|---|-------|-------|-----------|-------|-----|
| C1 | The roster-repair re-delivery (#403, branch pre-dating #401) silently reverted the S8 skill delivery: 4 SKILL.md version bumps + per-target prose + WACC note rolled back across `skills/` and all 4 mirrors while keeping `procedure_keys` — a self-consistent pre-S8 state no gate could flag. Spec v2.5.0, the new procedure, and the fs gate demand the comparative flow the skills no longer described. | standards | skills/brownfield-feasibility/SKILL.md:17-18 + 3 siblings, skills/SKILLS.md:51,109,163,185 | one-time (root cause: cross-branch file checkout during re-delivery) | Re-applied all 4 SKILL.md changes + versions (1.2.0/1.2.0/1.4.1/1.3.1) + SKILLS.md rows; mirrors re-synced; skill-graph + VERSION_MANIFEST regenerated |

### 🟡 High (fix within 1 week — fixed in-session)

| # | Issue | Agent | File:Line | Class | Fix |
|---|-------|-------|-----------|-------|-----|
| H1 | S8 brownfield completion predicate probed the latest model per target **regardless of variant** — with DART-backed targets the last-created model is `downside:historical`, so the gate judged comparison-evidence BEP/snapshot (unclearable false blocker, or false pass via historical-only). Test seed had no `dart_corp_code`, so the hazard never materialized. | architecture | app/web-next/lib/process-flow.ts:361-384 | one-time (test blind spot: add DART-backed fixture class) | Per-target probe now pins `market_forward` and requires a base-scenario p50 row; greenfield branch pinned to market_forward as well (same latent leniency) |
| H2 | `decision_authority: human` missing on `brownfield-fs-comparative` step 2 — required by the design of record, template rule 7, and sibling recorder steps; `_validate.ts` only validates the field if present | standards | procedures/_shared/brownfield-fs-comparative/schema.yaml:34-48 | one-time | Marker added; human-authority count test updated 4 → 5 |
| H3 | Target DELETE throws raw FK 500 once a target has S8 cases (migration 0120 FK is live; DELETE route had no dependents check) | automation | app/web-next/app/api/brownfield/targets/[targetId]/route.ts:100-112 | one-time | 409 `target_has_cases` with count + remediation message before the delete |
| H4 | Late shortlist edits created an unrecoverable S8 dead-end: generate idempotency returns the old run forever, and manual CRUD could not set `target_id` (only raw SQL could) | automation | app/api/projects/[id]/business-case/route.ts:64-68, generate/route.ts idempotency | one-time | Manual POST/PUT now accept a **validated** `target_id` (shortlist membership against the project's source opportunity); test (b) now exercises the API path instead of raw SQL |

### 🟢 Moderate (fixed in-session unless noted)

| # | Issue | Agent | File:Line | Class | Fix |
|---|-------|-------|-----------|-------|-----|
| M1 | `subjectScope` (v2.5.0) had zero enforcement — rename/drop would pass every gate | architecture | tests/unit/process-flow.test.ts (no coverage) | script-gap | **Hardening landed**: closed-vocabulary + exact-map test added to process-flow.test.ts |
| M2 | Human-decision runs persisted `spec_version: "unknown"` (violates flow.spec invariant; shared writer resolves 2.5.0) | architecture | app/web-next/lib/business-case.ts:134,224 | one-time | Both writers now persist `SPEC_VERSION` |
| M3 | Re-selection / late target exclusion did not cascade: stale adoption could carry a deselected target into S10/S11; excluded selected target still satisfied the S8 probe | architecture + automation | app/web-next/lib/business-case.ts:215-219, process-flow.ts:385-395 | systemic | Adoption + S8 probe now re-verify the selected target is still `shortlisted`; blocker added; legacy NULL-target models rejected for brownfield adoption |
| M4 | Kill-criteria registry `action: "halt"` contradicted schema `escalate_to_risk_officer` (no cross-check exists) | architecture + standards (dup) | procedures/_kill-criteria/brownfield-fs-comparative__….json:5 | one-time | JSON aligned to `escalate_to_risk_officer` |
| M5 | `sigmaOverride` read path had a dead guard (`x !== null && x >= 0 ? x : (x !== null ? x : null)` ≡ `x`) — a negative override poisoned dispersion | automation | app/web-next/lib/business-case-generator.ts:464 | one-time | Negative now falls back to the derived model |
| M6 | Persona integrity gate required `---` at byte 0 — files with a leading `# @resolved-from:` annotation were silently skipped (the exact layout `parseFrontmatter` supports) | automation | scripts/validate-agents.ts:340-342 | script-gap | Tolerant `^---` (multiline) anchor; gate covers annotated files |
| M7 | Inline-fallback Monte Carlo honored user `bc.iterations` up to 10M synchronously on the request thread | automation | app/web-next/lib/business-case-generator.ts:468 | one-time | Fallback clamps to 200k (engine path keeps its out-of-process ceiling) |
| M8 | `docs/process-flow.md` (generated) carried 330+ Korean lines with no `lang` frontmatter — English-only policy exception undeclared | docs+security | docs/process-flow.md:1-6; scripts/co-newbiz/generate-process-flow.ts:55 | systemic | Generator now emits `lang: ko` / `lang_reason: source-material` frontmatter; doc regenerated |
| M9 | flow.spec.yaml line-1 header still said "v2.2.1" — stale since v2.3.0, worsened by v2.5.0 | standards | process/flow.spec.yaml:1 | one-time | Header version dropped (meta.version is authoritative) |

### ℹ️ Low / Improvements (fixed in-session)

- `listShortlistSubjects` scalar subqueries without `LIMIT 1` — safe only while `md_company.dart_corp_code` keeps its unique index → `LIMIT 1` added (automation)
- `flagRecommendedTarget` mutated its input objects — now returns new objects (automation)
- Rationale on target selection was unbounded (audit/storage bloat) → 4,000-char cap at route + lib (docs+security)
- Broken indentation at business-case route GET visibility check (docs+security nit)

### Deferred (recorded for backlog — variant project: no L0 ticket.ts; tracked here + memory log)

| # | Item | Class | Reason deferred |
|---|------|-------|-----------------|
| D1 | `validate-templates.ts` variant-context crash → graceful degradation in L1/L3 (see Baseline) | script-gap | Needs an L0-side fix pattern (same file is the L0 source); coordinate with the L0 repo |
| D2 | Surface engine/fallback provenance in the cross-target comparison (mixed `engine=` streams ranked together when the Python engine dies mid-run) | systemic | Needs a small design touch on `TargetComparisonRow` + UI footnote |
| D3 | Per-subject input resolution re-runs project-level queries N×(including one discarded growth-model resolution) | one-time | Efficiency only; bounded by shortlist size |
| D4 | Admin read/write semantics on project surfaces (UI renders analyst controls; APIs deny admins by role separation — pre-existing house pattern, needs an explicit product decision) | systemic | Product decision, not a bug fix |
| D5 | Error taxonomy by `message.startsWith()` in adopt/target-selection routes — rewording a lib message silently changes HTTP mapping; introduce a typed error | one-time | Refactor with test updates |
| D6 | Activity ids embed target company name (non-unique) — switch to target id + update test | one-time | Touches run-log readability; low risk |
| D7 | 9 sibling projects' `agents/pm.md` carry dangling template-relative `extends` (fleet survey, this gate now detects them) | systemic | Per-project sync flows; L0 gate (ai-workspace-standards #1017) enforces |
| D8 | CI unit-test job was lost to a fleet resync once already (re-added today) — recurrence watch | systemic | Consider upstreaming the job into the L0 CI template so resyncs deliver it instead of resetting it |

### ✅ Strengths (verified by reviewers)

- Migration 0120 exemplary: additive nullable FK, covering index matching the predicate access path, verified rollback order, FK actually enforced.
- Spec ↔ projection ↔ generated docs ↔ STAGES parity is exact at v2.5.0; `brownfield-fs-comparative` passes every procedure gate; output types registered same-change; kill-criteria registry complete both directions.
- Boundary #2 held on every new surface: engine proposes (meta_json only), humans select/adopt, fs gate separate — pinned by tests.
- Strong feature tests (300-line multi-target suite against real route handlers + real SQLite); greenfield seeds byte-identical to pre-change.
- Security: new endpoint's control order correct (auth → viewer 403 → deny-by-default 404 → validation), SQL fully parameterized, audit parity with adopt, no id leaks in envelopes, no cross-tenant exposure, zero secret-shaped strings in today's diff.
- ADR-0143 `lang: ko` frontmatter legitimate (source-material); all 25 internal link targets in today's docs resolve.

## Action wiring

- Fixed in-session: C1, H1–H4, M1–M9 (M1 = hardening landed), Low items above.
- Deferred: D1–D8 (see table; D1 and D7 carry the ratchet intent — both are already detected mechanically or scheduled for the L0-side fix).
- Ticket system note: `scripts/ticket.ts` is workspace-root (L0) only; per skill, deferred items live in this report + `memory/2026-09-22.md`.

## Verification

- `bun run test` — full unit suite green (123 files) including the updated human-authority count test (5 steps) and the new subjectScope gate test
- `bun scripts/audit.ts` — all gates pass (incl. language, skill-graph, VERSION_MANIFEST, spec-check, agent sync)
- `bun procedures/_validate.ts` — 0 errors; `bun scripts/validate-agents.ts` — 82 files / 0 errors / 0 warnings
- `bun scripts/verify-scripts.ts --verify` — 182 scripts, 0 warnings
- Reviewers' High findings re-verified fixed in the working tree before commit (predicate variant pin, decision_authority marker, DELETE 409, manual target_id path)
