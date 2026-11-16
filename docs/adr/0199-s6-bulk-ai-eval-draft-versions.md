---
lang: en
lang_reason: Row 0 design dispatched in English; docs/context.md English-only zone
---

# ADR-0199: S6 bulk AI evaluation with immutable draft versions, confirm-from-version attribution, and incremental DART collection

**Status**: Accepted (2026-11-16, user approval of spec `2026-11-16-s6-bulk-ai-eval-versioning`; implementation pending). Amended by [ADR-0200](0200-s6-direct-ai-verdicts-with-origin.md) (Accepted 2026-11-17): decision 6 (provisional-only drafts, confirm route A6) and the bulk-run concurrency rule.
**Date**: 2026-11-16
**Deciders**: User (scope approval 2026-11-16); PM dispatch (Row 0 non-exempt); schema designed by data-architect, to be landed by backend-engineer with a dba operational review
**Related**: ADR-0139 (S7 eval layer, migrations 0103/0104), ADR-0140 (financial rubric draft), ADR-0141 (technical evidence draft; this ADR lifts its "no disclosure body parsing" alternative for the business report only), ADR-0171 (criteria reconcile, judgement invalidation), ADR-0131 (rerun keeps the prior completed version), ADR-0005 (run versioning and attribution), ADR-0004 / FR-DATA-05 (freshness and revision-preserving ingest; `fact_financial` revision writer unchanged), ADR-0014 (reversible migrations), ADR-0012 (append-only audit, trigger precedent), ADR-0061 (money convention), ADR-0184 (next-intl ko/en), ADR-0187 D1 (data-confidence grades), ADR-0198 (no grade uplift on human acceptance), design `2026-11-16-s6-bulk-ai-eval-versioning-design`

## Context

The house baseline (`docs/context.md`) requires an ADR for any database schema change.
The co-newbiz ADR trigger list also covers DB schema changes. This decision adds six
tables, three triggers, one column on an existing table, and their indexes, across two
migrations (0194 draft versioning, 0195 DART evidence cache), so the ADR is mandatory.

Each table is justified by a query or write pattern that existing tables cannot serve:

- Draft run/item/version: these need resume, immutable attribution, and FK-enforced
  verdict links. Payload columns on `brownfield_target` cannot carry them.
- `dart_disclosure`: the incremental cursor needs `corp_code` + `rcept_dt` indexed with
  `rcept_no` identity. The key/blob table `raw_payload` has no such columns.
- `dart_business_report_extract`: never re-fetching an immutable filing needs a durable
  per-`rcept_no` record of what was extracted.
- `dart_corp_sync_state`: a freshness window needs a "last successful check" time.
  `fact_financial` only records when a value **changed**, so an unchanged company would
  look stale forever.

The S6 longlist score chips fill only after a person saves verdicts on the S7 candidate
detail screen. The ADR-0140/0141 auto-draft runs one candidate at a time and is never
persisted. So a 20–60-candidate longlist has no early ranking signal, and a confirmed
verdict cannot be traced to the numbers, base years, disclosures, or LLM answer it rested
on. The user approved four changes:

1. A bulk `AI 평가` action over the longlist (DART sync → financial draft → technical
   draft), with explicit `확인 안됨` for non-DART candidates, within the DART daily budget.
2. Business-report body evidence for the technical draft.
3. S1-style immutable versions with replace-on-success.
4. A human confirm path that records which draft version a verdict rested on, never
   overwriting human judgements.
5. Incremental DART collection (approved in a second round on the same day). Today
   `syncCompanyFinancialFacts` dedups on write only and always fetches all 5 years plus a
   corp-code validation. Disclosure lists and business-report bodies are never persisted.
   A repeat run would therefore pay ≈ 9–14 calls per candidate for data that cannot have
   changed.

## Decision

1. **Three new tables plus one column, in migration `0194_brownfield_eval_draft_versions.sql`
   (number tentative)**:
   - `brownfield_eval_draft_run`: bulk-run header. Holds opportunity FK, status
     (`running|paused_budget|interrupted|completed|cancelled|failed`), the per-run
     options `web_evidence` and `force_refresh` (both default 0, kept on resume), runner
     identity (`started_by`, `started_via`), heartbeat, and pause reason. A partial
     unique index allows at most one active run per opportunity.
   - `brownfield_eval_draft_run_item`: per-candidate checkpoint (`seq`, `state`,
     per-category outcome including `unchanged`, the version written or re-confirmed,
     and `dart_calls`). This is what makes chunked resume possible. It is mutable.
   - `brownfield_eval_draft_version`: the immutable per-candidate, per-category snapshot
     `v{n}`. `UNIQUE(brownfield_target_id, category, version_no)`, `payload` JSON
     (`json_valid` CHECK), summary columns `provisional_score`, `proposed_count`,
     `unverified_count`, `evidence_grade` (ADR-0187 D1), and `input_hash` (ADR-0005). A
     `BEFORE UPDATE` trigger aborts every update. A `BEFORE DELETE` trigger aborts unless
     the parent candidate is already gone, so versions disappear only through the
     `ON DELETE CASCADE` of the existing candidate-delete route.
   - `brownfield_target_eval_state.confirmed_from_version_id`: a nullable FK to the
     version row. It is not a bare `version_no`, so the link is DB-enforced. A partial
     index on it serves the "verdicts resting on version V" lookup.
2. **Replace-on-success.** A version row is inserted only when a category step finishes.
   DART errors, LLM call failures, budget pauses, interruptions, and cancellations write
   no version. The S6 list always shows the latest inserted version, so a failed or
   in-flight run never hides or overwrites the previous good one (the ADR-0131 rule,
   applied per candidate). A deliberately unconfigured LLM skips the technical step
   rather than producing an all-unverified version. **Unchanged evidence creates no
   version.** The `input_hash` is computed before the rubric or LLM runs. If it equals
   the latest version's hash, the item records `unchanged`, points at the existing
   version, makes no LLM call, and advances `checked_at`, which drives the 90-day
   `갱신 권장` rule. Reasons:
   - A duplicate row adds no attribution.
   - A financial duplicate would be byte-identical.
   - A technical re-ask over identical evidence would surface LLM sampling noise as a
     verdict "change".
3. **Non-DART candidates are skipped explicitly** (`skipped_not_dart`), with no version,
   no LLM or web call, and a `확인 안됨 · DART 미등록` chip. Nothing is fabricated.
4. **DART budget.** Candidates are processed one at a time. Before each candidate, the
   engine requires `max(40 calls, 10 % of DAILY_BUDGET)` of remaining budget. Otherwise,
   or on DART status `020`, the run pauses. Resume restarts at the first non-terminal
   item, and steps are idempotent until the version insert. Resume is an explicit
   person or delegated action. The scheduler never resumes a run (user decision
   2026-11-16), so every version is attributable to a real caller (boundary #1).
5. **Business-report evidence.** The technical draft adds deterministic section
   extraction (main products, facilities, R&D activity, intellectual property) from the
   latest business report via `selectBusinessReport` + `fetchDisclosureText`. Only
   section names, `rcept_no`, and quotes of 300 characters or less are stored. A
   pass/partial/fail proposal whose citation does not resolve is downgraded to
   unverified. Technical versions stay grade `C` regardless of evidence mix. Web search
   is off by default for bulk runs and is an explicit per-run option
   (`brownfield_eval_draft_run.web_evidence`, default 0, kept on resume; user decision
   2026-11-16).
6. **Human boundary (non-negotiable #2).** Drafts are proposals:
   - `provisional_score` is shown as `AI 잠정 v{n}` and never enters `eval_summary`,
     `잠정 순위`, promotion, gate snapshots, kill criteria, or RAG.
   - The confirm route
     `POST /api/brownfield/{oppId}/targets/{targetId}/eval-draft-versions/{versionId}/confirm`
     is human-only at the route, the in-process MCP port (`HUMAN_ONLY_ROUTES`), and the
     mcp-coverage exclusion. It accepts only the latest version (409 `stale_version`).
   - The route writes only criteria still `pending`, guarded in the UPDATE, and never
     writes `확인 안됨` items. It skips changed or retired criteria. It records
     `assessed_by` = the caller and `confirmed_from_version_id`, and it runs ADR-0171
     judgement invalidation.
   - The existing single `PUT eval-state` gains an optional `confirmed_from_version_id`.
     A save without it clears the link.
   - Confirmation is per candidate only. There is no longlist-wide `전체 확정` action
     (user decision 2026-11-16).
7. **API and audit.** New routes: start (reuse if active), status/progress, resume,
   cancel, and version list. The targets GET gains an additive `eval_draft` field. New
   audit actions: `target_eval.bulk_run.{start,pause,resume,cancel,complete}`,
   `target_eval.draft_version.create`, `target_eval.draft_version.unchanged`, and
   `target_eval.confirm_from_version`. Agents use the calling user's permissions. Runner
   identity and call path are recorded.
8. **Incremental DART collection with a shared evidence cache** (migration
   `0195_dart_evidence_cache.sql`, number tentative). It is a separate migration so each
   set is independently reversible (ADR-0014). There is no FK between the 0194 and 0195
   sets: versions copy their quotes and cite `rcept_no` as text.
   - `dart_disclosure` (raw layer): verbatim list rows keyed by DART's immutable 14-digit
     `rcept_no`, with an index on (`corp_code`, `rcept_dt DESC`) and an UPDATE-abort
     trigger. A corrected filing is a new `rcept_no`. A new `listDisclosuresSince` pages
     `list.json` from `disclosures_complete_through − 1 day` with `INSERT OR IGNORE`. The
     first fetch covers 36 months.
   - `dart_business_report_extract` (raw layer, verbatim excerpts): extracted sections
     per (`rcept_no`, `extractor_version`), capped at 8,000 characters per section, never
     the full document. An existing `rcept_no` is never re-fetched (not even with
     `force_refresh`); only an `extractor_version` bump re-processes it, once.
     Deterministic negatives (`not_zip`, `no_sections`) are cached. Transient failures
     write nothing. Evidence uses a new `selectEvidenceBusinessReport` that prefers the
     newest report including corrections. `selectBusinessReport` is unchanged.
   - `dart_corp_sync_state`: per-`corp_code` `corp_code_checked_at`,
     `financial_checked_at`, `disclosures_checked_at`, and `disclosures_complete_through`.
     Each advances only after its fetch kind fully succeeds, so a failed fetch never
     poisons the cache.
   - Financial seams: `fetchFinancials` gains `opts.fiscalYears` and additive
     `yearOutcomes`. `syncCompanyFinancialFacts` gains `incremental` and `forceRefresh`,
     both default off, so existing callers are byte-identical. In incremental mode, the
     closed years already in `fact_financial` are skipped. The engine fetches missing
     years, the latest year, and any closed year whose business report has a new
     correction in the disclosure cache. The append-only revision writer is unchanged.
   - Freshness (user decision 2026-11-16): the window is `DART_FRESHNESS_DAYS = 30`
     normally and `DART_FRESHNESS_DAYS_FILING_SEASON = 7` from March 1 to May 31, chosen
     by the KST evaluation date. These are code constants with no schema impact. Inside
     the window, no DART call is made for a kind unless the run's `force_refresh` is set.
     Within a candidate, the order is disclosure list →
     financial → business report, so corrections feed the financial year set.
   - The cache is shared public evidence. It has no opportunity, user, candidate, or
     verdict column and no read route. The permission and MNPI model is unchanged.

## Alternatives considered

- **Overwrite a single draft row per candidate (no versions).** Rejected. It destroys
  attribution: a confirmed verdict could not show which inputs it rested on (ADR-0005).
  A failed rerun would also wipe the last good draft, the exact defect ADR-0131 fixed
  for S1.
- **Auto-confirm drafts (all, or above a confidence or score threshold).** Rejected:
  this violates non-negotiable #2 (gate approval and judgements belong to humans). It
  would also let grade-`C` LLM output become a recorded verdict with no human reading.
- **Count provisional scores in ranking or promotion until a human confirms.** Rejected
  for the same boundary. Provisional chips are visually and textually separate and
  affect nothing downstream.
- **One combined table (`eval_draft_run` carrying candidate, category, version, and
  payload).** Rejected. Progress must be updated in place to resume, while snapshots must
  be immutable. One table forces either mutable snapshots or append-only progress noise.
- **Store drafts in `brownfield_target.screening_evidence_json` or another payload
  column.** Rejected. There is no per-version immutability, the column is not
  FK-addressable from the eval state, and payloads grow unbounded on one row.
- **Scheduler auto-resume after the DART day rollover.** Rejected (user decision
  2026-11-16). It would act under a stored identity after the request ends, which
  conflicts with boundary #1.
- **Draft non-DART candidates from web and profile evidence only.** Rejected (user
  decision 2026-11-16). Non-DART candidates get no technical draft and show
  `확인 안됨 · DART 미등록`.
- **Web search on by default in bulk runs.** Rejected (user decision 2026-11-16). It
  would send the whole target list to the search provider without an explicit choice.
- **Longlist-wide `전체 확정`.** Rejected (user decision 2026-11-16). One click across
  dozens of candidates weakens the human review that boundary #2 protects.
- **Always create a new version on every run, even with identical inputs.** Rejected.
  It mints byte-identical financial rows and sampling-noise technical rows, and it adds
  no attribution. Freshness is tracked on the run item (`checked_at`) instead of
  duplicating the snapshot.
- **Store the DART cache in `raw_payload`.** Rejected. That key/blob table has no
  `corp_code` or `rcept_dt` column for the incremental cursor, and its archive-only
  retention suits verbatim responses, not capped extracts.
- **Store the full business-report text.** Rejected for size (documents up to 20 MB).
  The capped section extract is what the draft uses, and DART remains the system of
  record.
- **Per-opportunity or per-user cache.** Rejected. DART filings are public, and
  duplicating them per deal adds cost without any confidentiality gain.
- **Infer freshness from `fact_financial.created_at`.** Rejected. It only moves when a
  value changes, so an unchanged company would look stale forever.

## Consequences

- **Additive migration.** No existing row is rewritten and there is no backfill.
  Existing S6/S7 behavior is byte-identical until a run is started. Rollback: drop the
  run-item table and triggers. Then rebuild `brownfield_target_eval_state` without
  `confirmed_from_version_id` (SQLite cannot DROP a column used in an FK) or restore the
  pre-migration backup, and drop the version and run tables (ADR-0014). The migration
  header carries the ROLLBACK-SQL block. The dba runs backup-before and health-after
  (`foreign_key_check`, `integrity_check`).
- **Second additive migration (0195).** It has three new tables and one trigger, no
  existing table altered, and no backfill. Rollback drops them after the pre-migration
  backup. Cached evidence is re-fetchable from DART, so rollback loses no information.
  The dba rehearses each migration's rollback independently.
- **DART cost.** A repeat run inside the window (30 days; 7 days in March–May) costs 0
  calls per candidate. After the window, a typical run costs ≈ 3–5 calls instead of
  ≈ 9–14, and `force_refresh` ≈ 8–13. The 7-day season window adds about one incremental
  list call per candidate per week from March to May. A fully cached candidate proceeds even below the budget reserve. Per-item
  `dart_calls` telemetry verifies the estimates in phase 2.
- **Staleness trade-off.** Inside the window, a newly filed report can be missed until
  the window expires or someone sets `force_refresh`. The shorter 7-day window from
  March 1 to May 31 limits this lag to at most a week during the annual filing and
  correction season (user decision 2026-11-16). Closed-year corrections are
  caught only through the disclosure cache (a `정정` business report). A correction filed
  without one is caught by `force_refresh`.
- **Other DART consumers unchanged in v1.** S7 detail auto-sync and the company screen
  keep their current full fetch. Moving them to the cache is a follow-up.
- **Cache retention.** No policy in v1. Cache rows are not deleted with a candidate,
  because they carry no link to it. The cache is eligible for a later
  `archive_then_delete` retention-registry entry (FR-DATA-09).
- **Candidate deletion keeps working.** Versions and run items cascade with the
  candidate, and the route already deletes eval states first. Draft history for a
  deleted candidate survives only in the audit log.
- **Retention.** The delete trigger blocks ad-hoc pruning. Versions are unlimited per
  candidate (S1 precedent) until an FR-DATA-09 policy replaces the trigger through its
  own migration. That policy is a separate follow-up task, out of this ADR's scope.
- **MNPI.** By default a bulk run makes no web-search call. The evidence is DART, the
  business report, and the AI profile, and the evidence block still goes to the LLM
  provider. When a person opts in to web evidence for a run, the whole target list's
  company names reach the search provider. Queries exclude opportunity and our-company
  names. A security-engineer review is required before the evidence phase merges.
- **Known limitation.** The DART call counter is per process and in memory. A restart
  can under-count the day's usage. A persisted call ledger is a separate follow-up task
  with its own ADR. The cache reduces the exposure, because warm re-runs need few or no
  calls.
- **Follow-ups out of scope.** S7 per-candidate drafts writing versions (`run_id` stays
  nullable for it), the persisted DART ledger, and the retention policy are each separate
  tasks.
- **RAG interplay.** No RAG computation reads S6/S7 eval scores through this path. A
  future consumer must read the linked `evidence_grade` and honor the data-confidence
  cap (non-negotiable #4). Human confirmation never upgrades the grade (ADR-0198).
- **Shared logic.** The per-candidate S7 `eval-draft` route is factored into library
  functions shared with the bulk engine, so both paths produce identical drafts. S7 still
  does not persist versions in v1. Making it do so is a follow-up decision.
