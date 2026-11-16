# S6 Bulk AI Evaluation with Versioned Draft Snapshots

- Spec ID: `2026-11-16-s6-bulk-ai-eval-versioning`
- Date: 2026-11-16
- Status: approved (user approval 2026-11-16; §13 Q1–Q8 resolved by the user
  2026-11-16; incremental DART collection added by user approval 2026-11-16). Not yet
  implemented.
- Author: data-architect (Row 0 design, PM dispatch)
- Registration note: spec-register and `/sync` are NOT run by this task — PM registers
  the spec after user approval.
- ADR: [ADR-0199](../adr/0199-s6-bulk-ai-eval-draft-versions.md) (draft, Proposed) —
  required because this design adds DB tables and a column (workspace schema-governance
  baseline, `docs/context.md`).
- Builds on: design `2026-09-16-brownfield-eval-auto-draft` (ADR-0140 financial rubric,
  ADR-0141 technical evidence draft), ADR-0139 (S7 eval layer, migrations 0103/0104),
  ADR-0171 (criteria reconcile, judgement invalidation), ADR-0131 (rerun keeps the prior
  completed version), ADR-0005 (run-based versioning and attribution), ADR-0014
  (reversible migrations), ADR-0012 (append-only audit), ADR-0061 (money convention),
  ADR-0184 (next-intl ko/en), ADR-0187 D1 (data-confidence grades), ADR-0198 (no grade
  uplift on human acceptance).

## 1. Problem

The S6 longlist (`대상 후보 발굴`, `components/stages/brownfield/LonglistSection.tsx`)
shows two score chips per candidate (financial / technical) from `tgt.eval_summary`
(`app/api/brownfield/[oppId]/targets/route.ts:58`). Those chips fill only after a person
has saved verdicts on the S7 candidate detail screen, one candidate at a time. The
auto-draft that would help (`POST .../targets/[targetId]/eval-draft`, ADR-0140/0141)
exists only per candidate, is triggered by hand on the S7 detail screen, and is never
persisted — so:

1. A longlist of 20–60 candidates needs 40–120 manual draft clicks before any ranking
   signal appears at S6.
2. A draft is lost the moment the page closes. Nothing records which numbers, base
   years, disclosures, or LLM answer a confirmed verdict rested on — an attribution gap
   against ADR-0005.
3. The technical draft reads DART disclosure TITLES only (ADR-0141 rejected body parsing
   for v1). `lib/dart-client.ts` already ships `selectBusinessReport` and
   `fetchDisclosureText` but nothing calls them for evaluation, so R&D spend, patents,
   main products, and facilities stay `확인 안됨` even when the business report states
   them.
4. Every run pays the full DART cost again. `syncCompanyFinancialFacts`
   (`lib/dart-financial-facts.ts`) dedups on write only: it always validates the corp code
   and calls `fetchFinancials` for all 5 years. Disclosure lists and business-report bodies
   are never persisted. A bulk action that is re-run on the same longlist would therefore
   repeat ≈ 9–14 calls per candidate for data that cannot have changed (closed fiscal
   years, immutable filings).

## 2. Goals and non-goals

### Goals

- G1. One bulk `AI 평가` action on the S6 longlist runs, for every DART-registered
  candidate: DART financial-fact sync → financial draft (deterministic rubric) →
  technical draft (LLM over evidence), with per-candidate progress.
- G2. Candidates without a DART corp code (unlisted, overseas) produce an explicit
  `확인 안됨 · DART 미등록` outcome — never a fabricated verdict, never a silent gap.
- G3. The DART daily call budget is respected: work is chunked per candidate, a run
  pauses before exhausting the budget, and it resumes from the first unfinished
  candidate.
- G3a. DART collection is incremental. Closed fiscal years already in `fact_financial`
  are not re-fetched. Disclosure lists persist by `rcept_no` and are queried from the
  last cursor. Business-report extracts persist by `rcept_no` and are never re-fetched.
  Within the freshness window (30 days, or 7 days from March 1 to May 31; resolved
  Q8), no DART call is made unless the run sets
  `force_refresh`. Added by user approval 2026-11-16 (§3.5, §6).
- G4. The technical draft gains business-report body evidence (R&D, patents, main
  products, facilities); a verdict that cannot cite evidence stays unverified.
- G5. Every successful per-candidate, per-category draft is stored as an immutable
  snapshot `v{n}` (S1 market-analysis precedent). Replace-on-success: an in-progress or
  failed run never hides or overwrites the previous good version.
- G6. S6 shows provisional chips `AI 잠정 v{n} · {date}` visually and textually distinct
  from the confirmed score; a version older than 90 days shows `갱신 권장`; an expandable
  per-candidate comparison table shows score and per-item verdict changes across
  versions.
- G7. A person can confirm a version's proposals in bulk; the written verdict records
  `assessed_by` = that person and `confirmed_from_version_id`, so the audit trail shows
  the draft a verdict rested on. Items a person already judged are never overwritten.

### Non-goals

- Auto-confirmation of any draft, under any threshold (boundary #2 — rejected in ADR-0199).
- Provisional scores feeding the `잠정 순위` ranking, Short List promotion
  (`eval_summary.complete`), gate snapshots, kill criteria, or the RAG grade.
- Drafting for non-DART candidates from web or profile evidence alone (resolved Q3:
  they get no draft and show `확인 안됨 · DART 미등록`).
- Normalizing business-report figures (R&D spend amounts) into structured columns —
  v1 stores quoted evidence only.
- Persisting the DART call counter across process restarts (known limitation, §6.5;
  resolved Q4: separate follow-up task).
- Scheduler auto-resume of paused runs (resolved Q2), versioning of the S7
  per-candidate draft (resolved Q5: follow-up), a longlist-wide `전체 확정` action
  (resolved Q6: not built), and a version retention cap (resolved Q7: follow-up).
- Changes to the rubric thresholds, criteria seeding, or `computeEvalScore` semantics.

## 3. Data model

### 3.1 Layer placement

| Object | Layer | Rationale |
|---|---|---|
| `fact_financial` (existing, synced from DART) | fact | Unchanged; the financial draft reads it via `getCompanyFinancialFacts`. |
| `brownfield_eval_draft_run` (new) | fact (operational run header) | One bulk run = one attribution unit (ADR-0005 `run` analogue). Mutable status only. |
| `brownfield_eval_draft_run_item` (new) | fact (operational progress) | Per-candidate checkpoint that makes resume possible. Mutable. |
| `brownfield_eval_draft_version` (new) | fact (immutable snapshot) | Per-candidate, per-category draft `v{n}`. Insert-once; DB triggers forbid UPDATE. |
| `brownfield_target_eval_state.confirmed_from_version_id` (new column) | fact | Links a human verdict to the draft version it rested on. |
| `dart_disclosure` (new, §3.5) | raw (verbatim DART list rows) | One immutable row per `rcept_no`. Shared DART evidence keyed by `corp_code`; makes the disclosure list incremental. |
| `dart_business_report_extract` (new, §3.5) | raw (verbatim excerpts) | Extracted business-report sections per `rcept_no`: tag-stripped substrings of the filing, capped per section, tagged with `extractor_version`. The full document text is not stored (size; DART remains the system of record). |
| `dart_corp_sync_state` (new, §3.5) | operational freshness metadata | Per `corp_code` "last successful check" timestamps and the disclosure cursor. Gives the seasonal freshness window (§6.2) a home without touching `fact_financial`. |
| Version payload citations | fact (inside the version) | Quotes are **copied** into the version payload, so a version stays self-contained even if the cache is later archived. There is no FK from a version to the cache. |

No `md_*` change: categories (`financial`/`technical`) and statuses are closed
enumerations enforced by CHECK, matching migrations 0103/0104. No free-text code column
is introduced.

The user brief proposed a single `eval_draft_run` table carrying candidate, category,
version, and payload. This design splits it into run header / run item / version
because the three have different mutability: progress must be updated in place to
resume, while a snapshot must never change. Mixing them in one table would force either
a mutable snapshot (breaks attribution) or append-only progress noise.

### 3.2 Migration `0194_brownfield_eval_draft_versions.sql` (number tentative)

Next free number on `main` at design time is `0194` (last applied: `0193_opportunity_driver_links.sql`).
If another branch lands first, renumber at implementation; the content does not depend
on the number.

```sql
-- @reversible: true (additive: three new tables, two triggers, indexes, and one
-- nullable FK column on brownfield_target_eval_state; no existing row rewritten,
-- no backfill. Rollback: the ROLLBACK-SQL block below after the pre-migration
-- backup per ADR-0014. Draft versions, run history, and confirmed_from_version_id
-- links recorded after this migration are lost on rollback; human verdicts stay.)
-- ROLLBACK-SQL-BEGIN
--   DROP TRIGGER trg_bedv_no_update;
--   DROP TRIGGER trg_bedv_no_orphan_delete;
--   DROP TABLE brownfield_eval_draft_run_item;
--   (brownfield_target_eval_state.confirmed_from_version_id participates in a
--    FOREIGN KEY, so SQLite cannot DROP COLUMN it: rebuild the table without the
--    column (0104 create-copy-rename pattern) or restore the pre-migration backup;
--    only then:)
--   DROP TABLE brownfield_eval_draft_version;
--   DROP TABLE brownfield_eval_draft_run;
-- ROLLBACK-SQL-END
--
-- ADR-0199 (spec 2026-11-16-s6-bulk-ai-eval-versioning): S6 bulk AI evaluation —
-- run header, per-candidate progress, immutable per-candidate/per-category draft
-- snapshots, and the human-verdict → draft-version attribution link.

CREATE TABLE brownfield_eval_draft_run (
  id TEXT PRIMARY KEY NOT NULL,                         -- ulid (db/lib/ulid.ts)
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  categories TEXT NOT NULL CHECK (categories IN ('financial', 'technical', 'both')),
  web_evidence INTEGER NOT NULL DEFAULT 0 CHECK (web_evidence IN (0, 1)),  -- per-run opt-in (Q1); resume reuses it
  force_refresh INTEGER NOT NULL DEFAULT 0 CHECK (force_refresh IN (0, 1)), -- ignore the DART freshness window (§6.2); resume reuses it
  status TEXT NOT NULL CHECK (status IN
    ('running', 'paused_budget', 'interrupted', 'completed', 'cancelled', 'failed')),
  total_targets INTEGER NOT NULL CHECK (total_targets >= 0),
  started_by TEXT NOT NULL,                             -- app_user.id of the caller (boundary #1)
  started_via TEXT NOT NULL,                            -- callPathOf(ctx): web | mcp | agent-delegated
  resumed_by TEXT,                                      -- last person/delegated caller who resumed
  started_at TEXT NOT NULL,                             -- ISO 8601
  heartbeat_at TEXT NOT NULL,                           -- bumped after every step; stale → interrupted
  finished_at TEXT,
  pause_reason TEXT,                                    -- e.g. 'dart_budget_reserve', 'dart_status_020'
  error_message TEXT
);
-- Pattern: "is a run active for this opportunity?" (start = reuse; one active run max).
CREATE UNIQUE INDEX ux_bedr_active ON brownfield_eval_draft_run(opportunity_id)
  WHERE status IN ('running', 'paused_budget', 'interrupted');
-- Pattern: "latest run for this opportunity" (S6 progress panel on load).
CREATE INDEX idx_bedr_opp_started ON brownfield_eval_draft_run(opportunity_id, started_at DESC);

CREATE TABLE brownfield_eval_draft_run_item (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES brownfield_eval_draft_run(id) ON DELETE CASCADE,
  brownfield_target_id TEXT NOT NULL REFERENCES brownfield_target(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,                                 -- processing order, stable across resume
  state TEXT NOT NULL CHECK (state IN
    ('pending', 'financial_sync', 'financial_draft', 'technical_draft',
     'done', 'failed', 'skipped_not_dart', 'skipped_no_company', 'skipped_llm_unconfigured')),
  financial_outcome TEXT CHECK (financial_outcome IS NULL OR financial_outcome IN
    ('versioned', 'unchanged', 'failed', 'skipped', 'nothing_pending')),
  technical_outcome TEXT CHECK (technical_outcome IS NULL OR technical_outcome IN
    ('versioned', 'unchanged', 'failed', 'skipped', 'nothing_pending')),
  -- The version written ('versioned') or re-confirmed as current ('unchanged', §3.3).
  -- In the migration file, this table is created AFTER brownfield_eval_draft_version so
  -- these FKs bind. Both rows cascade with a deleted candidate within one statement.
  financial_version_id TEXT REFERENCES brownfield_eval_draft_version(id),
  technical_version_id TEXT REFERENCES brownfield_eval_draft_version(id),
  dart_calls INTEGER NOT NULL DEFAULT 0 CHECK (dart_calls >= 0),  -- calls spent on this item (budget telemetry, §6.1)
  error_message TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (run_id, brownfield_target_id)
);
-- Pattern: resume scan "first non-terminal item of run R in seq order".
CREATE INDEX idx_bedri_run_state ON brownfield_eval_draft_run_item(run_id, state, seq);

CREATE TABLE brownfield_eval_draft_version (
  id TEXT PRIMARY KEY NOT NULL,
  brownfield_target_id TEXT NOT NULL REFERENCES brownfield_target(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('financial', 'technical')),
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  run_id TEXT REFERENCES brownfield_eval_draft_run(id),  -- NULL reserved for a future single-candidate S7 path (Q5)
  provisional_score INTEGER CHECK (provisional_score IS NULL OR provisional_score BETWEEN 0 AND 100),
  proposed_count INTEGER NOT NULL CHECK (proposed_count >= 0),
  unverified_count INTEGER NOT NULL CHECK (unverified_count >= 0),
  evidence_grade TEXT NOT NULL CHECK (evidence_grade IN ('A', 'B', 'C', 'U')),  -- ADR-0187 D1
  input_hash TEXT NOT NULL,                             -- sha256 of canonical inputs (ADR-0005)
  payload TEXT NOT NULL CHECK (json_valid(payload) = 1),
  created_by TEXT NOT NULL,                             -- the run's acting caller
  created_at TEXT NOT NULL,
  UNIQUE (brownfield_target_id, category, version_no)
);
-- The UNIQUE index above serves "latest version per target+category" (MAX(version_no))
-- and the per-candidate version list. Pattern: "versions produced by run R".
CREATE INDEX idx_bedv_run ON brownfield_eval_draft_version(run_id);

-- Immutability (ADR-0005 snapshot rule, ADR-0012 trigger precedent): never UPDATE.
CREATE TRIGGER trg_bedv_no_update BEFORE UPDATE ON brownfield_eval_draft_version
BEGIN SELECT RAISE(ABORT, 'brownfield_eval_draft_version is immutable'); END;
-- DELETE only as the FK cascade of a deleted candidate (parent row already gone).
CREATE TRIGGER trg_bedv_no_orphan_delete BEFORE DELETE ON brownfield_eval_draft_version
WHEN EXISTS (SELECT 1 FROM brownfield_target WHERE id = OLD.brownfield_target_id)
BEGIN SELECT RAISE(ABORT, 'draft versions are deleted only with their candidate'); END;

ALTER TABLE brownfield_target_eval_state
  ADD COLUMN confirmed_from_version_id TEXT REFERENCES brownfield_eval_draft_version(id);
-- Pattern: "which verdicts rested on version V" (comparison table badge, audit lookup).
CREATE INDEX idx_bf_target_eval_state_from_version
  ON brownfield_target_eval_state(confirmed_from_version_id)
  WHERE confirmed_from_version_id IS NOT NULL;
```

Notes on the design choices:

- **FK to the version id, not `version_no`.** The brief named `confirmed_from_version`; an
  FK to the immutable row is the DB-enforced form. `version_no` is derivable through it.
- **Candidate delete.** `DELETE /api/brownfield/targets/[targetId]` hard-deletes a
  candidate after deleting its eval states (`route.ts:143-147`). Versions and run items
  cascade with the candidate (`ON DELETE CASCADE`); the delete trigger allows only that
  path because the parent row is already gone when the cascade fires
  (`PRAGMA foreign_keys = ON` is set in `db/client.ts:105`). The existing delete route
  needs no change: it deletes `brownfield_target_eval_state` first, so the
  `confirmed_from_version_id` FK never dangles. The audit log keeps the
  `target_eval.draft_version.create` events after the delete.
- **Retention (FR-DATA-09).** The no-orphan-delete trigger also blocks ad-hoc pruning. A
  future retention policy enters through its own governed migration that replaces the
  trigger; this design adds no pruning.
- **Portability (ADR-0002).** Partial unique indexes, `ON DELETE CASCADE`, and CHECK
  enumerations are portable. `json_valid` and the trigger syntax follow existing house
  precedent (migrations 0150/0193; ADR-0012 audit triggers) and carry the same
  portability note as those migrations.
- **Money (ADR-0061).** No monetary column is added. The financial payload stores
  ratios and percentages as computed by `deriveFinancialAnalysis`. If a payload ever
  carries an absolute amount, it is an integer in KRW millions with a `unit:
  "KRW_mn"` key. A REAL money value in a payload fails review the same as a column would.

### 3.3 Version payload document (`payload`, schema version 1)

```jsonc
{
  "schema": 1,
  "category": "financial" | "technical",
  "criteria_snapshot": [            // full criterion set at snapshot time (for comparison)
    { "criterion_id": "...", "label": "...", "data_ref": "revenue_5y", "weight": 10,
      "source": "builtin|seeded|custom", "rubric": { "cagrPass": 5, ... } | null }
  ],
  "items": [                        // one per criterion that was pending at snapshot time
    { "criterion_id": "...",
      "proposed_status": "pass" | "partial" | "fail" | null,   // null = 확인 안됨
      "reason": "확인 안됨 — ..." | null,
      "metrics": [{ "label": "CAGR", "value": "+7.2%" }],
      "note": "자동초안(...) — ...",
      "citations": [{ "kind": "business_report|disclosure|profile|web",
                      "ref": "rcept_no:section | url", "quote": "≤300 chars" }] }
  ],
  "human_items": [                  // criteria already judged by a person — read-only context
    { "criterion_id": "...", "status": "pass", "assessed_by": "...", "assessed_at": "..." }
  ],
  "provisional_score": { "score": 72, "scored_weight": 40, "total_weight": 40 },
  "dart": { "corp_code": "00123456", "base_years": [2020, 2021, 2022, 2023, 2024],
            "latest_sync_at": "...", "sync_warnings": ["corp_code_name_mismatch: ..."] },
  "evidence": {
    "disclosures": [{ "rcept_no": "...", "rcept_dt": "20250314", "report_nm": "..." }],
    "business_report": { "rcept_no": "...", "rcept_dt": "...", "available": true,
                         "sections_found": ["주요 제품 및 서비스", "연구개발활동", ...],
                         "truncated": false, "error": null },
    "profile": { "present": true, "version_no": 3 },
    "web": [{ "criterion_id": "...", "url": "...", "host": "..." }]
  },
  "llm": { "source": "llm", "provider": "...", "prompt_key": "s7.screening_draft" } | null,
  "runner": { "user_id": "...", "via": "web" },
  "generated_at": "..."
}
```

- `provisional_score` = `computeEvalScore` over the merge of `human_items` (as they
  stood) and `items[].proposed_status`. It is the score the candidate would have if
  every proposal were confirmed unchanged. It is a projection, labelled as one, and is
  never written to `eval_summary`.
- `input_hash` covers: the canonical sorted fact rows used (financial) or the evidence
  identifiers and quote hashes (technical), the criteria snapshot including rubric
  JSON, the human-judged set, the `web_evidence` flag, and the prompt key. Two versions
  with the same hash had the same inputs. The financial rubric is deterministic, so
  equal hash ⇒ equal financial proposals (test T1). The hash is computed **before** the
  rubric or the LLM runs: every input is known after evidence assembly.
- **Unchanged evidence creates no new version.** If the computed `input_hash` equals the
  latest version's `input_hash` for that candidate and category, the engine writes no
  version and does not call the LLM. The run item records outcome `unchanged` and points
  `*_version_id` at the existing version. Reasons:
  1. Attribution is unaffected. The existing version already attributes exactly these
     inputs (ADR-0005), and a duplicate row adds no information.
  2. The financial rubric is deterministic, so a new financial version would be a
     byte-identical copy that fills the comparison table with empty "no change" columns.
  3. For the technical category, re-asking the LLM over identical evidence only measures
     sampling noise. A verdict flip with no evidence change would be shown as a "change"
     and would mislead reviewers. It would also spend LLM cost for nothing.
  4. With the DART cache, a re-run inside the freshness window usually reproduces the
     same evidence. Without this rule, every routine re-run would mint a version.

  Freshness stays visible without mutating the immutable version. A8 reports
  `checked_at` = the `updated_at` of the latest run item whose outcome is `versioned` or
  `unchanged` for that candidate and category (falling back to the version's
  `created_at`). The 90-day `갱신 권장` rule uses `checked_at`. The chip reads
  `AI 잠정 v3 · 11-16`, with the tooltip `확인 11-30 · 근거 변경 없음`.
  Consequence: v1 has no "re-draft the same evidence" button. A change in criteria,
  rubric, human-judged set, or evidence always produces a new version.
- Payload size cap: 64 KiB. Quotes are truncated to 300 characters, and at most 3
  citations are kept per item. A payload over the cap fails the item (no version), and
  the UI shows the error. It is never silently truncated.

### 3.4 Evidence grade (ADR-0187 D1)

| Version | `evidence_grade` | Reason |
|---|---|---|
| Financial draft over synced DART facts, ≥ `minYears` years | `A` | Filed statements, deterministic rubric. |
| Financial draft with fewer years than `minYears` (all items `확인 안됨`) | `U` | No proposal possible. |
| Technical draft (any evidence mix) | `C` | LLM interpretation of evidence. Business-report quotes strengthen citations but do not lift the class. |
| Non-DART candidate | — (no version) | Run item `skipped_not_dart`. |

Human confirmation never upgrades the grade (ADR-0198 precedent). See §8 for the RAG cap.

### 3.5 DART evidence cache — migration `0195_dart_evidence_cache.sql` (number tentative)

This is a separate migration from 0194 per ADR-0014: it is an independent, reusable
evidence store that other DART consumers (S7 detail auto-sync, the company screen) can
adopt later. Each migration is reversible on its own. There is no FK in either direction
between the 0194 and 0195 table sets: versions copy their quotes and cite `rcept_no` as
text, so archiving the cache never invalidates a version. 0195 has no dependency on 0194
and may land first.

```sql
-- @reversible: true (purely additive: three new tables, one trigger, indexes; no existing
-- table altered, no backfill. Rollback: the ROLLBACK-SQL block below after the
-- pre-migration backup per ADR-0014. Cached DART evidence is lost on rollback; it is
-- re-fetchable from DART, so no information is lost.)
-- ROLLBACK-SQL-BEGIN
--   DROP TRIGGER trg_dart_disclosure_immutable;
--   DROP TABLE dart_business_report_extract;
--   DROP TABLE dart_disclosure;
--   DROP TABLE dart_corp_sync_state;
-- ROLLBACK-SQL-END
--
-- ADR-0199 (spec 2026-11-16-s6-bulk-ai-eval-versioning §3.5/§6): incremental DART
-- collection — disclosure rows by rcept_no, business-report section extracts by rcept_no,
-- and per-corp freshness state. Shared public DART evidence; no per-user or per-opportunity
-- data.

-- DART filing list rows, verbatim. rcept_no is DART's immutable 14-digit receipt number;
-- a corrected filing ([기재정정] etc.) is a NEW rcept_no, never an update of the old row.
CREATE TABLE dart_disclosure (
  rcept_no TEXT PRIMARY KEY NOT NULL CHECK (length(rcept_no) = 14),
  corp_code TEXT NOT NULL CHECK (length(corp_code) = 8),
  corp_name TEXT NOT NULL,
  report_nm TEXT NOT NULL,
  rcept_dt TEXT NOT NULL CHECK (length(rcept_dt) = 8),   -- YYYYMMDD as DART returns it
  flr_nm TEXT,
  rm TEXT,
  pblntf_ty TEXT,                                        -- DART disclosure type when known
  fetched_at TEXT NOT NULL                                -- ISO 8601, first time we saw the row
);
-- Pattern: incremental cursor (MAX(rcept_dt) per corp), "last 36 months for corp C",
-- and selectBusinessReport over the cached list.
CREATE INDEX idx_dart_disclosure_corp_dt ON dart_disclosure(corp_code, rcept_dt DESC);
CREATE TRIGGER trg_dart_disclosure_immutable BEFORE UPDATE ON dart_disclosure
BEGIN SELECT RAISE(ABORT, 'dart_disclosure rows are immutable (rcept_no identity)'); END;

-- Business-report section extract per rcept_no: verbatim excerpts, never the full document.
CREATE TABLE dart_business_report_extract (
  rcept_no TEXT NOT NULL REFERENCES dart_disclosure(rcept_no),
  extractor_version TEXT NOT NULL,                       -- bump → re-extract once (one fetch)
  status TEXT NOT NULL CHECK (status IN ('extracted', 'no_sections', 'not_zip')),
  sections_json TEXT CHECK (sections_json IS NULL OR json_valid(sections_json) = 1),
    -- {main_products|facilities|rnd|ip: {heading_raw, text, chars, truncated}}
  source_chars INTEGER NOT NULL CHECK (source_chars >= 0),  -- tag-stripped document length
  content_hash TEXT,                                     -- sha256 of sections_json
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (rcept_no, extractor_version)
);

-- Per-corp freshness. A timestamp advances only when that fetch kind finished successfully.
CREATE TABLE dart_corp_sync_state (
  corp_code TEXT PRIMARY KEY NOT NULL CHECK (length(corp_code) = 8),
  corp_code_checked_at TEXT,                             -- last successful validateCorpCode
  financial_checked_at TEXT,                             -- last fully successful financial fetch
  disclosures_checked_at TEXT,                           -- last fully successful list query
  disclosures_complete_through TEXT CHECK (disclosures_complete_through IS NULL
    OR length(disclosures_complete_through) = 8),        -- end_de (YYYYMMDD) of that query
  updated_at TEXT NOT NULL
);
```

Design notes:

- **Why typed tables instead of `raw_payload`.** `raw_payload` (`id, source_id,
  fetched_at, content_hash, payload`) is a key/blob store with no `corp_code` or
  `rcept_dt` column. The incremental cursor ("latest `rcept_dt` for corp C") and the
  36-month window would need JSON extraction on every query, with no index. Its
  retention class is also archive-only, which suits verbatim API responses but not a
  capped section extract. The typed tables keep FK-enforced identity (`rcept_no`) and an
  index that serves the real query.
- **`corp_code` as the key.** The cache describes DART entities, not our company
  master. `md_company.dart_corp_code` remains the mapping from our company to the DART
  entity. If a company's corp code is corrected, the new code simply has no state yet
  and is fetched fresh. The length CHECKs pin DART's code system (8-digit corp code,
  14-digit receipt number, 8-digit date) so free text cannot enter.
- **Size.** Each section text is capped at 8,000 characters (the `truncated` flag
  records the cut). That gives at most about 32,000 characters (≈ 100 KB UTF-8 worst
  case) per report and one report per company per year in practice. A 60-candidate
  longlist therefore adds a few MB at most. Disclosure rows are about 200 bytes each.
- **Retention.** v1 registers no retention policy. Because versions copy their quotes,
  the cache is re-fetchable convenience evidence rather than a lineage anchor. It is
  eligible for a later `archive_then_delete` entry in `db/lib/retention-registry.ts`
  (FR-DATA-09), which would also cover the deferred version-retention follow-up (Q7).
  Disclosure rows are never updated; only the immutability trigger and a governed
  retention migration may change that.
- **Revision discipline (ADR-0004 / FR-DATA-05).** `fact_financial` keeps its existing
  append-only revision writer. The cache adds no second write path for financial values.

## 4. API surface

All routes use `lib/envelope.ts` (`ok`/`fail`/`badRequest`/`notFound`) and
`authenticate` + `requireBusinessActor`. An out-of-scope or unknown opportunity or
candidate returns 404, not 403. Agents have no accounts. An MCP or agent caller acts
under the delegating user's identity, and `started_by`/`created_by` record that user
with `started_via` = `callPathOf(ctx)` (boundary #1).

| # | Method + path | Role | Human-only | Purpose |
|---|---|---|---|---|
| A1 | `POST /api/brownfield/[oppId]/eval-draft-runs` | analyst+ (write) | No — drafting is a proposal | Start a bulk run. Body `{ categories?: "both"\|"financial"\|"technical", target_ids?: string[], web_evidence?: boolean, force_refresh?: boolean }`. Default: every non-excluded candidate. `web_evidence` (resolved Q1) and `force_refresh` (§6.2) both default to `false` and are stored in the run header, so resume keeps them. If a run is already active, returns it with `meta.reused: true` (the S1 `alreadyRunning` precedent). Returns 202 `{ run_id }`. |
| A2 | `GET /api/brownfield/[oppId]/eval-draft-runs/latest` (and `/[runId]`) | read | No | Run header plus items (`seq`, candidate, `state`, outcomes, error) and budget snapshot `{ calls, budget, reserve }`. Lazily marks a `running` run with `heartbeat_at` older than 10 minutes as `interrupted`. |
| A3 | `POST /api/brownfield/[oppId]/eval-draft-runs/[runId]/resume` | analyst+ | No | Resumes a `paused_budget` or `interrupted` run from the first non-terminal item. Refused with 409 `budget_reserve` while the reserve is still unmet. Sets `resumed_by`. |
| A4 | `POST /api/brownfield/[oppId]/eval-draft-runs/[runId]/cancel` | analyst+ | No | Stops after the current step. Completed versions stay. |
| A5 | `GET /api/brownfield/[oppId]/targets/[targetId]/eval-draft-versions?category=&limit=` | read | No | Versions newest first (`versions[0]` = latest, S1 shape), each with summary columns. `?include=payload` returns full payloads (used by the comparison table). Each item carries `confirmed_count` = verdicts that cite this version. |
| A6 | `POST /api/brownfield/[oppId]/targets/[targetId]/eval-draft-versions/[versionId]/confirm` | analyst+ | **Yes** (`humanOnlyDenied` + `HUMAN_ONLY_ROUTES` + mcp-coverage exclusion) | Bulk-confirms proposals of the given version. Body `{ criterion_ids?: string[] }` (default: every item with a non-null `proposed_status`). See the rules below. |
| A7 | `PUT .../eval-state/[criterionId]` (existing, extended) | analyst+ | unchanged | Gains optional `confirmed_from_version_id`. When the person edits a draft on the S7 detail screen and saves it, the link records the draft basis even if the saved status differs from the proposal. A save without the field writes NULL, because the verdict no longer rests on a draft. |
| A8 | `GET /api/brownfield/[oppId]/targets` (existing, additive field) | read | — | Each row gains `eval_draft: { financial?: VersionChip, technical?: VersionChip, run_item?: { state, error } }` with `VersionChip = { version_no, created_at, checked_at, provisional_score, stale, evidence_grade }`. `stale` = `checked_at` older than 90 days (§3.3). `eval_summary` is untouched (confirmed only). |

**A6 confirm rules** (all in one transaction):

1. The version must be the **latest** version for its candidate and category. Otherwise
   the request fails with 409 `stale_version`, so nobody confirms a superseded draft.
2. Only criteria whose current state is `pending` (or that have no row) are written. The
   UPDATE carries a `status = 'pending'` guard so a concurrent human save wins. Skipped
   items are returned with reason `already_judged`. Items already judged by a person are
   never overwritten.
3. Items with `proposed_status = null` (`확인 안됨`) are never written. A person records
   those manually.
4. A criterion that is deleted, retired (ADR-0171), or whose `rubric_json` differs from
   the version's `criteria_snapshot` is skipped with reason `criterion_changed`.
5. Each write calls `upsertEvalState` with `assessedBy` = the caller,
   `note` = the proposal note, and `evidence_ref` = the version id. It also sets
   `confirmed_from_version_id`. Then `invalidateTargetJudgements` runs for seeded
   criteria (ADR-0171 parity with the single PUT path).
6. Response: `{ confirmed: n, skipped: [{ criterion_id, reason }], scores }`.

**Audit events** (`appendAudit`, append-only, ADR-0012):

| Action | Target |
|---|---|
| `target_eval.bulk_run.start` | `{oppId}:run:{runId}:targets={n}:categories={c}` |
| `target_eval.bulk_run.resume` / `.cancel` / `.pause` / `.complete` | `{oppId}:run:{runId}` (pause carries `pause_reason`) |
| `target_eval.draft_version.create` | `{oppId}:{targetId}:{category}:v{n}:run={runId}` |
| `target_eval.draft_version.unchanged` | `{oppId}:{targetId}:{category}:v{n}:run={runId}` (same `input_hash`, no new version) |
| `target_eval.confirm_from_version` | `{oppId}:{targetId}:{category}:v{n}:confirmed={k}:via={callPath}` |

The existing per-candidate `target_eval.financial_draft` / `.technical_draft` events are
unchanged.

**MCP.** Phase 1 adds no MCP tool. A later `run_bulk_eval_draft` tool would wrap only
A1–A2. A6 stays human-only at the in-process port.

## 5. Run engine

- Implementation home: `lib/brownfield-eval-bulk.ts` (engine) and
  `db/repositories/brownfield-eval-draft.repository.ts` (all SQL for the three 0194
  tables; version insert computes `MAX(version_no)+1` inside the insert transaction —
  SQLite's single writer serializes it). `db/repositories/dart-evidence-cache.repository.ts`
  holds all SQL for the three 0195 tables (insert-or-ignore by `rcept_no`, cursor and
  freshness reads, state advance).
- Execution: A1 inserts the run and the run items (`seq` = longlist order). Then it
  launches the engine fire-and-forget (`void runBulkEval(db, runId).catch(...)`), the same
  pattern as the S1 rerun route (`market-overview/analyses/[id]/rerun/route.ts`). The engine
  processes **one candidate at a time**. Inside a candidate it reuses today's code paths:
  `syncCompanyFinancialFacts` (in incremental mode, §6.2) → `deriveFinancialAnalysis` +
  `draftFinancialVerdict`, then the technical evidence assembly (from the DART evidence
  cache, §3.5) + `completeOrFallback` + `parseTechnicalDrafts`. The route body is factored
  into shared library functions so the S7 per-candidate route and the bulk engine run
  identical drafting logic. The S7 route keeps its current non-incremental, non-cached
  DART behavior in v1. Switching it and the company-screen sync to the cache is a
  follow-up.
- Checkpointing: `run_item.state` advances before each step, and `heartbeat_at` is
  bumped. A version is inserted at the end of its category step. That insert is the
  "success" moment for that category and makes replace-on-success atomic. When the
  `input_hash` is unchanged (§3.3), the step ends with outcome `unchanged` and no insert.
- Candidate eligibility, evaluated per item at its turn (not at start):
  - no `dart_corp_code` and no resolvable `md_company` → `skipped_not_dart` /
    `skipped_no_company`, outcome `확인 안됨 · DART 미등록`;
  - no pending criteria in a category → outcome `nothing_pending` (no version);
  - LLM not configured → the technical step is `skipped_llm_unconfigured` (no version). A
    deliberately unconfigured LLM is not a failure, but it also must not produce an
    all-unverified version that would supersede a real one.
- No automatic resume by the scheduler. A paused or interrupted run resumes only through
  A3, called by a person or an agent under a person's delegation. This keeps every
  version attributable to a real caller (boundary #1). It means the system never acts
  under a stored identity after the request ends, apart from finishing the run the caller
  started. Resolved Q2: the scheduler never resumes a run.
- Web evidence: the technical step calls the web-search provider only when the run's
  `web_evidence` flag is set (default off, resolved Q1). Without it, the evidence is DART
  disclosures, the business-report body, and the company AI profile.

## 6. DART collection, budget, and resume

### 6.1 Calls per candidate: reuse versus new

Baseline today: `syncCompanyFinancialFacts` dedups on write only. It always calls
`validateCorpCode` once and `fetchFinancials` for all 5 years (CFS, with a BFS fallback
per year that misses). The technical draft calls `searchDisclosures` twice (recent and
business) and never persists the result. Estimates below are to be confirmed by the
per-item `dart_calls` telemetry in phase 2.

| Step | Today (every run) | Cold cache (first run for a corp) | Warm, inside the freshness window (30 d; 7 d in Mar–May) | Warm, window expired | `force_refresh` |
|---|---|---|---|---|---|
| corp-code validation | 1 | 1 | **0** (reuse `corp_code_checked_at`) | 1 | 1 |
| financial facts | 5–10 (5 years × CFS/BFS) | 5–10 (all 5 years are missing) | **0** (reuse `fact_financial`) | 1–2 for the latest year, plus 1–2 per missing year, plus 1–2 per closed year re-flagged by a corrected business report | 5–10 (all 5 years) |
| disclosure list | 2 (never stored) | 1–3 pages (36-month window, all types, 100 rows/page) | **0** (reuse `dart_disclosure`) | 1 page (incremental from the cursor) | 1 page (incremental; rows are immutable, so a full re-list adds nothing) |
| business-report body | 1 (heavy, up to 20 MB) | 1 | **0** | 0 if the latest business-report `rcept_no` is already extracted, else 1 | 0 for an already-extracted `rcept_no` (never re-fetched); 1 only for a new `rcept_no` |
| **Total** | **≈ 9–14** | **≈ 8–15** | **0** | **≈ 3–5 typical** | **≈ 8–13** |

`DAILY_BUDGET` is 15,000 (75 % of OpenDART's 20,000). A cold 60-candidate run costs about
900 calls. A repeat run on the same longlist inside the window (30 days; 7 days in
March–May) costs 0, and after the window
about 200–300. The budget binds only when other features (scheduler collection, S1, S7
detail auto-sync) have consumed most of it.

### 6.2 Incremental collection rules

**Freshness window (resolved Q8).** The window has two code constants and no schema
impact: `DART_FRESHNESS_DAYS = 30` normally, and `DART_FRESHNESS_DAYS_FILING_SEASON = 7`
from March 1 to May 31 inclusive. The season covers annual business reports and their
corrections. The applicable window is chosen by the evaluation date in KST
(`Asia/Seoul`, DART's calendar) when the engine checks a candidate, not by the date of
the cached check. For example, a check made on February 25 is stale on March 4. For each
fetch kind, if the corp's `dart_corp_sync_state.*_checked_at` is within the window and
the run's
`force_refresh` is `0` (default), the engine makes **no DART call** for that kind and
reuses the cache. `force_refresh` lives on the run header next to `web_evidence`
(§3.2). It is set only at start (A1 body, a start-dialog checkbox `DART 최신 재조회`,
unchecked by default) and kept on resume.

**Financial facts (seam changes, existing callers unchanged).**

- `fetchFinancials(corpCode, opts)` gains `opts.fiscalYears?: number[]`. When present, it
  fetches exactly those business years (same CFS-then-BFS rule per year) and ignores
  `opts.years`. When absent, behavior is byte-identical (latest = current year − 1,
  `years` capped at 5). It also returns an additive
  `yearOutcomes: Array<{ year, outcome: "found" | "not_filed" | "error" }>`. DART statuses
  `013` (no data) on both bases mean `not_filed`. Any thrown, HTTP, or parse failure
  means `error`. Today these are folded into one `lastError` string.
- `syncCompanyFinancialFacts(db, companyId, opts)` gains
  `opts.incremental?: boolean` (default `false`) and `opts.forceRefresh?: boolean`. With
  `incremental: true`:
  1. Target years T = {latest − 4 … latest}, where latest = current year − 1 (the same
     anchor as `fetchFinancials`). Stored years S = fiscal years with at least one
     `fact_financial` row for the company from source `dart`.
  2. A **closed year** is any year in S other than `latest`. Closed years are skipped.
  3. Fetch set = (T \ S) ∪ {latest} ∪ R. R is the set of closed years whose business
     report has a **new correction** in the disclosure cache. A new correction is a
     `dart_disclosure` row with `report_nm` containing `사업보고서` and a correction marker
     (`정정`), a period `(YYYY.MM)` mapping to that fiscal year, and `fetched_at` after
     the corp's `financial_checked_at`. The disclosure step therefore runs **before** the
     financial step inside a candidate.
  4. Inside the window and without `forceRefresh`, the fetch set is empty and no call is
     made. With `forceRefresh`, the fetch set is all of T.
  5. Corp-code validation is skipped when `corp_code_checked_at` is within the window
     (unless `forceRefresh`). The corp-code authority rules of design 2026-11-11 §D5 are
     unchanged.
  6. **Revision semantics are unchanged.** Fetched values go through the same writer: a
     value equal to the latest revision is skipped, and a changed value becomes
     `revision_no + 1`. A year not fetched gets no rows. `getCompanyFinancialFacts` is
     unchanged.
  7. Error contract: in incremental mode the sync throws `dart_retrieval_failed` only if
     no year is stored after the fetch. A `not_filed` latest year with stored closed years
     is a normal outcome (for example before the March filing season) and appears in
     `warnings`.
  8. `financial_checked_at` advances only if every requested year returned `found` or
     `not_filed`. With one `error` year it does not advance. Rows already written for
     other years stay, because they are true values under the revision rule.
- Existing callers (S7 detail load-time sync, company screen) pass neither option, so they
  keep today's behavior.

**Disclosure list (incremental, persisted).** This is a new `listDisclosuresSince(corpCode,
bgnDe, endDe)` in `lib/dart-client.ts`. It pages through `list.json` with no type filter,
100 rows per page, until the last page. `searchDisclosures` and its existing callers are
unchanged.

- First fetch: `bgnDe` = today − 36 months.
- Later fetches: `bgnDe` = `disclosures_complete_through` − 1 day. The one-day overlap
  catches filings that landed after the previous query ran on the same day. Rows are
  written with `INSERT OR IGNORE` on `rcept_no`, so the overlap never duplicates.
- `disclosures_complete_through` = the query's `endDe` (today, YYYYMMDD). It and
  `disclosures_checked_at` advance only after the **last page** succeeds.
- The technical evidence reads the last 36 months from `dart_disclosure`, newest first,
  capped at 24 rows (today's cap). `selectBusinessReport` runs over the cached rows.

**Business-report body (per `rcept_no`, never re-fetched).**

- The engine selects the latest business report from the cached list. If a
  `dart_business_report_extract` row exists for that `rcept_no` and the current
  `extractor_version`, it is reused and no call is made, regardless of `force_refresh`.
  An `rcept_no` names an immutable filing.
- Otherwise it calls `fetchDisclosureText` once, extracts the four sections
  deterministically, and inserts the extract.
- A corrected filing has a new `rcept_no`. It is fetched fresh on first sight, and the
  original filing's extract stays. Evidence selection uses a new selector,
  `selectEvidenceBusinessReport`. It takes the newest business report by `rcept_dt`
  **including corrections**, because a correction supersedes the facts it corrects. The
  existing `selectBusinessReport` (which prefers non-corrected reports) and its callers
  are unchanged. This is tested by T20.
- Deterministic negative results are cached so a 20 MB document is not re-downloaded
  every run: `not_zip` (HWP binary) and `no_sections`. Transient failures (HTTP error,
  timeout, budget, ZIP corruption reported as an error) write **no** row.
- An `extractor_version` bump re-processes each `rcept_no` once with one fetch. This is
  the only re-fetch path for an existing `rcept_no`.

**Within-candidate order.** Disclosure list → financial facts → financial draft →
business-report body → technical draft. The disclosure step comes first because it
feeds the corrected-year set R.

### 6.3 Reserve rule

Before starting each candidate, the engine reads `dartBudgetUsed()`. It continues only if
`budget − calls ≥ max(PER_CANDIDATE_RESERVE = 40, INTERACTIVE_FLOOR = 10 % of budget)`.
A candidate whose fetch plan is fully cached (0 planned calls) proceeds even below the
reserve. Otherwise the run moves to `paused_budget` with
`pause_reason = 'dart_budget_reserve'`, and the UI shows the paused-for-budget message
(`stages.s67.aiEval.pausedBudget`, see the UI label glossary in §10). The floor keeps
headroom for interactive users. A thrown
`DART 일 호출 예산 초과` error or a DART status `020` (rate limit) inside a step also pauses
the run. That step's partial work produces no version, and the item restarts from that
step's beginning on resume.

### 6.4 Resume

A3 picks the first item with a non-terminal state in `seq` order and restarts at the
recorded step. Every step is idempotent, and the cache makes a restarted step cheaper
than the original:

- **Disclosure list.** Pages already inserted stay (true, immutable rows). The cursor did
  not advance, so the restarted query begins at the old cursor and `INSERT OR IGNORE`
  absorbs the overlap.
- **Financial.** Years fetched before the pause are now stored. If they are closed years,
  the incremental rule skips them on restart. `financial_checked_at` did not advance, so
  the remaining years are still fetched.
- **Business report.** An extract is inserted only after a complete fetch and extraction,
  so a paused fetch simply runs again.
- **Drafts.** Nothing is written until the version insert or the `unchanged` decision.
  Categories already `versioned` or `unchanged` in this run are not redone.

### 6.5 Known limitation

The call counter in `lib/dart-client.ts` is per process, in memory, and resets on
restart. A restart can therefore under-count the day's usage. Persisting the counter
(for example in `job_run` or a small `dart_call_ledger`) is out of scope: a separate
follow-up task (resolved Q4). The cache reduces how much this limitation matters,
because a warm re-run needs few or no calls.

## 7. Failure semantics

| Situation | Run item | Version written? | S6 shows |
|---|---|---|---|
| Category step completes (including some items `확인 안됨`) | `versioned` | Yes, `v{n+1}` | `AI 잠정 v{n+1} · date` |
| DART fetch / sync error (non-budget) | `failed` + error | No | previous `v{n}` + `v{n} 유지` chip with the error in the tooltip; `실패` if no prior version |
| LLM call error (provider error, parse failure of the whole answer) | `failed` | No (ADR-0131: a genuine LLM failure never overwrites) | `v{n} 유지` |
| Budget reserve hit / status 020 | item stays at its step; run `paused_budget` | No | progress panel paused message; previous versions visible |
| Process restart mid-run | run `interrupted` (lazy, heartbeat > 10 min) | No for the in-flight step | `중단됨 — 이어서 실행` action |
| Non-DART candidate | `skipped_not_dart` | No | `확인 안됨 · DART 미등록` (gray, with text) |
| No pending criteria | `nothing_pending` | No | confirmed chips only |
| Run cancelled | remaining items `pending` → run `cancelled` | already-written versions stay | per-candidate latest version |
| Evidence identical to the latest version (`input_hash` equal) | `unchanged`, `*_version_id` = existing version | No; no LLM call | `AI 잠정 v{n} · date`, tooltip `확인 {checked_at} · 근거 변경 없음`; `갱신 권장` clears |
| Disclosure list page fails mid-pagination | `failed` (or paused if budget/020) | No | `v{n} 유지` |
| Business-report fetch fails transiently (HTTP, timeout, corrupt ZIP) | `failed` (or paused) | No | `v{n} 유지` |
| Business report is HWP / has no recognizable sections | continues; evidence shows `사업보고서 본문 확보 실패` | Yes, if the rest of the step completes | as usual; affected items stay `확인 안됨` |

An in-progress run never hides the previous version. The longlist always shows the
latest **inserted** version, because only finished category steps insert one.

**A failed fetch never poisons the cache.** The cache only ever holds DART responses that
were received whole:

| Cache object | Written on failure? | Freshness/cursor advanced on failure? |
|---|---|---|
| `dart_disclosure` rows | Rows from pages that succeeded, yes (they are true, immutable facts). | No: `disclosures_checked_at` and `disclosures_complete_through` advance only after the last page. The next attempt restarts from the old cursor. |
| `fact_financial` | Values from years that returned `found`, through the unchanged revision writer. | No: `financial_checked_at` advances only if every requested year returned `found` or `not_filed`. |
| `dart_business_report_extract` | No row for transient failures. Rows only for a complete extraction or a deterministic negative (`not_zip`, `no_sections`). | — (keyed by `rcept_no`; no window) |
| corp-code validation | — | `corp_code_checked_at` advances only when DART answered (`validated` is `true` or `false`). An unreachable DART (`null`) does not advance it. |

A cached deterministic negative is re-tried only after an `extractor_version` bump.
`force_refresh` does not re-fetch an `rcept_no`, because the filing cannot change.

## 8. Data confidence and the RAG cap

- Drafts never enter `eval_summary`, `잠정 순위`, promotion (`complete`), gate snapshots,
  kill-criteria evaluation, or `run_rag_recompute`. They are proposals.
- A confirmed verdict is a human verdict. Its provenance is now traceable through
  `confirmed_from_version_id` → `evidence_grade`. Non-negotiable #4 (data confidence caps
  the overall RAG grade) is unaffected in v1 because no RAG computation reads S6/S7 eval
  scores through this path. Any future consumer that lifts confirmed eval scores into a
  RAG input must read the linked `evidence_grade` and apply the cap: a verdict confirmed
  from a `C` technical draft cannot support Green on its own. That consumer re-enters the
  Design Gate.
- Human confirmation never upgrades the evidence class (ADR-0198).

## 9. Security and MNPI

- **Need-to-know.** Versions and run progress are readable by exactly those who can read
  the opportunity's candidates today (same `requireBusinessActor` read gate). Admin role
  stays rejected on business routes. There is no new export surface.
- **Third-party disclosure amplification.** The technical step sends
  `{company name} {criterion label}` to the web-search provider and the evidence block to
  the LLM provider, as the per-candidate route already does. A bulk run would send this
  for the **whole longlist at once**, so the provider would see our target list, which
  is deal-sensitive. Mitigations: web search is **off by default** for bulk runs and is
  an explicit per-run opt-in (`web_evidence: true`, resolved Q1). When enabled, queries
  carry no opportunity name, our company name, or deal terms (assert in tests). The
  security-engineer reviews this against ADR-0038/0040 before phase 2b merges.
- **DART data** is public. Business-report quotes stored in payloads are public filings.
  The AI profile excerpt is internal and is not copied into the payload (only
  `profile.version_no`).
- **The DART evidence cache is shared evidence, not per-user or per-opportunity data.**
  The model above still holds. Reasons:
  1. **Content.** `dart_disclosure`, `dart_business_report_extract`, and
     `dart_corp_sync_state` hold only public DART filings, verbatim excerpts of them, and
     fetch timestamps. They carry no opportunity id, user id, candidate id, AI profile
     text, LLM output, web result, or verdict. This is enforced by the schema (no such
     columns) and asserted in tests (T25).
  2. **No read surface.** No route, MCP tool, or UI lists the cache. It is read only
     server-side by the draft engine on behalf of a caller who already passed the
     opportunity read/write gate. Everything a user sees from the cache arrives inside a
     version, which keeps its existing opportunity-scoped gate.
  3. **Cross-deal inference.** The only cross-opportunity signal is that a corp's data may
     already be warm when another analyst evaluates it, which shows up as fewer DART
     calls in `dart_calls`/progress. That reveals no more than the public fact that the
     company files with DART. The UI shows `캐시 재사용` without naming who warmed it or
     when. `fetched_at` is never exposed.
  4. **Permissions.** Fetches are made with the server's DART API key, as today. Agents
     still act only under the calling user's permissions (boundary #1): the cache adds no
     identity, no account, and no write path reachable without a run started by an
     authorized caller.
  5. **Retention and deletion.** A cached row is not personal data and is not deal
     evidence on its own. Deleting a candidate does not delete cache rows, because they
     may serve other deals and carry no link back to the candidate.
- **No notifications** carry figures or verdicts (ADR-0190 rule). Run completion is
  in-app only.
- **Boundary #2.** A6 is human-only at three layers: the route (`humanOnlyDenied`), the
  in-process MCP port (`HUMAN_ONLY_ROUTES`), and the mcp-coverage exclusion.

## 10. UI behavior (S6 longlist)

Owned by ux-designer-agent (handoff) and frontend-engineer (implementation), within Onyx
3.0 (`docs/design-system/design-guide.md`, `design-components.md`,
`design-accessibility.md`) and `lint:design`.

- **Action.** `AI 평가` button in the longlist `SectionToolbar`. The screen keeps a single
  primary action, so the ux-designer rules on whether `AI 평가` is primary or secondary. A
  confirmation dialog states the candidate count, the DART-eligible count, the estimated
  DART calls, and that results are proposals (`판정 확정은 사람이 합니다`). It also offers
  a `웹 검색 근거 포함` checkbox, unchecked by default, with a note that company names
  are sent to the search provider (resolved Q1). A second checkbox, `DART 최신 재조회`
  (`force_refresh`), is unchecked by default and states that it ignores the reuse window
  (30 days; 7 days in March–May) and costs more DART calls. The estimate splits into
  cache reuse versus new calls (`stages.s67.aiEval.estimate`, glossary below).
- **Progress panel** under the toolbar while a run is active, showing count, current
  candidate, and current step (`stages.s67.aiEval.progress`, glossary below). It has a determinate progress bar, an `aria-live="polite"`
  region, polling every 3 s only while active, and `일시 정지`/`중단됨` states with
  `이어서 실행`.
- **Chips** in the existing `재무·기술 평가` column. Row 1 keeps the confirmed chips
  (unchanged). Row 2 adds provisional chips:
  `AI 잠정 v3 · 11-16 · 재무 72` / `기술 55`. They are distinguished **without color
  alone**: the literal text `AI 잠정`, a dashed outline token, and a draft icon with
  `aria-label`. State chips: `갱신 권장` (`checked_at` older than 90 days, the S1
  `STALE_DAYS` rule; §3.3), `v{n} 유지` (last attempt failed), `확인 안됨 · DART 미등록`, and `진행 중`.
  Each has a tooltip with the reason. Provisional chips never change the `잠정 순위`
  column or the promote button.
- **Expandable comparison** (reuses the existing row `Fragment` expansion pattern, one
  row open at a time). The table has criteria as rows and the last 5 versions as columns,
  newest first. A score row shows the provisional score and delta per version. Cells show
  the proposal text (`충족`/`부분충족`/`미충족`/`확인 안됨`), with `사람 판정` where a
  person had already judged. A changed cell is marked with a text marker `변경` (not color
  only). A version column header shows `확정 근거 {k}건` when verdicts cite it. This
  mirrors the CalibrationPanel version table.
- **Confirm.** `v{n} 제안 확정 (미판정 {k}건)` in the expansion, enabled only on the latest
  version. A dialog lists the items to be written and the items skipped (already judged
  or `확인 안됨`). After confirming, the confirmed chips refresh. There is no
  longlist-wide `전체 확정` action (resolved Q6). Confirmation is per candidate only.
- **i18n (ADR-0184).** All strings live in next-intl catalogs. ko is the master and en
  must reach parity. Keys go under `stages.s67.longlistSection.*` and a new
  `stages.s67.aiEval.*`. Counts use ICU plurals. Dates use the next-intl formatter
  (`useFormatter`), not ad-hoc `toLocaleDateString`. `i18n-lint` and the catalog parity
  tests must pass.
- **Tokens.** No hard-coded colors or sizes; `--fs-*`, `--muted-fg`, and status tokens
  only.

### 10.1 UI label glossary

The ko master strings, with their English meaning and the proposed locale key. Keys are
proposals; the frontend-engineer finalizes them in the catalogs under ADR-0184. Elsewhere
in this design, Korean labels appear only as quoted code spans.

| English meaning | Korean label (ko master) | Locale key (proposed) |
|---|---|---|
| Bulk AI evaluation action | `AI 평가` | `stages.s67.aiEval.action` |
| Provisional AI draft chip | `AI 잠정 v{n} · {date}` | `stages.s67.aiEval.provisionalChip` |
| Unverified | `확인 안됨` | `stages.s67.aiEval.unverified` |
| Unverified, not DART-registered | `확인 안됨 · DART 미등록` | `stages.s67.aiEval.notDart` |
| Refresh recommended (> 90 days) | `갱신 권장` | `stages.s67.aiEval.stale` |
| Previous version kept | `v{n} 유지` | `stages.s67.aiEval.versionKept` |
| In progress | `진행 중` | `stages.s67.aiEval.inProgress` |
| Progress line | `AI 평가 진행 중 {done}/{total} · {company} · {step}` | `stages.s67.aiEval.progress` |
| Paused to protect the DART daily limit | `DART 일일 한도 보호로 일시 정지 — {done}/{total} 완료` | `stages.s67.aiEval.pausedBudget` |
| Paused / interrupted / resume | `일시 정지` / `중단됨` / `이어서 실행` | `stages.s67.aiEval.paused` / `.interrupted` / `.resume` |
| Include web-search evidence (checkbox) | `웹 검색 근거 포함` | `stages.s67.aiEval.webEvidence` |
| Re-query latest DART data (checkbox) | `DART 최신 재조회` | `stages.s67.aiEval.forceRefresh` |
| Call estimate | `캐시 재사용 {reused}곳 · 신규 조회 약 {calls}건` | `stages.s67.aiEval.estimate` |
| Cache reused | `캐시 재사용` | `stages.s67.aiEval.cacheReused` |
| Human confirms the verdict | `판정 확정은 사람이 합니다` | `stages.s67.aiEval.humanConfirms` |
| Confirm v{n} proposals ({k} pending) | `v{n} 제안 확정 (미판정 {k}건)` | `stages.s67.aiEval.confirmVersion` |
| Verdict values | `충족` / `부분충족` / `미충족` | existing verdict keys |
| Judged by a person | `사람 판정` | `stages.s67.aiEval.humanJudged` |
| Changed (comparison cell marker) | `변경` | `stages.s67.aiEval.changed` |
| Confirmation basis ({k} verdicts) | `확정 근거 {k}건` | `stages.s67.aiEval.confirmedBasis` |
| Checked on {date}, evidence unchanged | `확인 {date} · 근거 변경 없음` | `stages.s67.aiEval.checkedUnchanged` |
| Business-report body unavailable | `사업보고서 본문 확보 실패` | `stages.s67.aiEval.reportUnavailable` |
| Longlist-wide confirm (not built, Q6) | `전체 확정` | — |

## 11. Test plan

| ID | Area | Assertion |
|---|---|---|
| T1 | Rubric determinism | The same fact rows and rubric produce identical financial proposals, identical `provisional_score`, and identical `input_hash` across two runs. |
| T2 | Version immutability | `UPDATE brownfield_eval_draft_version` aborts. A direct `DELETE` aborts while the candidate exists. A candidate delete cascades its versions and run items. |
| T3 | Replace-on-success | Simulated LLM failure on run 2 → no `v2`, the longlist still shows `v1` plus `v1 유지`. Successful run 3 → `v2` (numbering has no gap). |
| T4 | In-progress visibility | While a run is mid-candidate, A8 returns the previous version for that candidate. |
| T5 | Budget pause/resume | Stub `dartBudgetUsed` below the reserve → run `paused_budget` after the current candidate. A3 resumes at the first non-terminal item. No duplicate version for already-versioned categories. |
| T6 | Interrupted | A stale heartbeat makes A2 mark the run `interrupted`. A3 resumes it. |
| T7 | Non-DART path | A candidate without a corp code → `skipped_not_dart`, no version, chip `확인 안됨 · DART 미등록`. No LLM or web call is made for it. |
| T8 | Human boundary — confirm | A6 called via bearer, MCP, or agent → 403 `human_only`. The route is in `HUMAN_ONLY_ROUTES`, and mcp-coverage passes. |
| T9 | Human boundary — no overwrite | A criterion judged by a person between snapshot and confirm stays untouched (`already_judged`). `확인 안됨` items are not written. A non-latest version → 409 `stale_version`. A changed or retired criterion is skipped. |
| T10 | Attribution | A confirmed row has `assessed_by` = the caller, `confirmed_from_version_id` = the version, and `evidence_ref` = the version id. A later plain PUT clears the link. `invalidateTargetJudgements` runs for seeded criteria. |
| T11 | Provisional isolation | Before and after a run, `eval_summary`, `evalRank`, and `complete` are byte-equal. Gate snapshot and RAG inputs are unchanged. |
| T12 | Business-report evidence | Section extraction finds the four sections on fixture XML. A non-ZIP (HWP) body → `available: false` with the reason. An LLM verdict citing a missing section is downgraded to unverified. |
| T13 | One active run | A second A1 during an active run returns the same `run_id` (`reused`). The partial unique index rejects a second active row. |
| T14 | Audit | Every action in §4 is appended with the documented target shape. |
| T15 | MNPI | A run started without `web_evidence` (the default) makes no web call, including after resume. With `web_evidence: true`, queries contain only company name and criterion label. |
| T16 | UI | `lint:design` 0 violations; chips carry text labels (`AI 잠정`, `갱신 권장`); keyboard expansion; i18n parity. |
| T17 | Closed-year skip | With years latest−4…latest−1 stored and the window expired, incremental sync calls `fetchFinancials` with `fiscalYears = [latest]` only. A missing closed year is added to the set. Existing callers without `incremental` still request all 5 years (byte-identical seam). Revision rule: an equal value is skipped and a changed latest-year value becomes `revision_no + 1`. |
| T18 | Incremental disclosure list | The first fetch covers 36 months across all pages. A second fetch starts at `disclosures_complete_through − 1 day`. The overlap row is ignored, not duplicated. A failure on page 2 leaves page-1 rows and does not advance the cursor, and the retry restarts from the old cursor. |
| T19 | `rcept_no` immutability | `UPDATE dart_disclosure` aborts. A re-listed `rcept_no` is ignored. An existing extract for (`rcept_no`, `extractor_version`) causes zero `fetchDisclosureText` calls, even with `force_refresh`. An `extractor_version` bump causes exactly one re-fetch. |
| T20 | Corrected filing | A `[기재정정]사업보고서 (YYYY.12)` with a new `rcept_no` is fetched fresh, and the original extract stays. `selectEvidenceBusinessReport` picks the correction, while `selectBusinessReport` behavior is unchanged. The correction adds fiscal year YYYY to the financial fetch set even though it is closed. |
| T21 | `force_refresh` | With a warm cache inside the window, the default run makes 0 DART calls. With `force_refresh` it validates the corp code, fetches all 5 years, and runs the incremental list, but re-fetches no existing `rcept_no`. The flag survives resume. |
| T22 | Freshness window | Outside the season (evaluated in e.g. October): `*_checked_at` 29 days old → no call for that kind; 31 days → a call. In season (evaluated in e.g. April): 6 days → no call; 8 days → a call. Boundary: a check on Feb 25 evaluated on Mar 4 (KST) → a call; evaluated on May 31 → 7-day rule; on Jun 1 → 30-day rule. Each kind is evaluated independently. |
| T23 | Unchanged evidence | A second run with an identical `input_hash` writes no version and makes no LLM call. The outcome is `unchanged` with `*_version_id` = the existing version, `checked_at` advances, and the `target_eval.draft_version.unchanged` audit is written. Any change in criteria, rubric, human-judged set, `web_evidence`, or evidence → a new version. |
| T24 | No cache poisoning | A transient `fetchDisclosureText` error writes no extract row. A `fetchFinancials` year `error` keeps `financial_checked_at`. `validated: null` keeps `corp_code_checked_at`. A `not_zip` result is cached and not re-fetched. |
| T25 | Cache content isolation | The schema of the three 0195 tables has no opportunity, user, candidate, or verdict column. No route or MCP tool reads them (route-table scan). Deleting a candidate leaves cache rows intact. |

Migration checks (both 0194 and 0195): apply against a dev DB copy;
`PRAGMA foreign_key_check` (0 rows); `PRAGMA integrity_check` (ok);
`PRAGMA foreign_key_list(brownfield_target_eval_state)` shows the new FK; each migration's
rollback rehearsed independently from the pre-migration backup (dba).

## 12. Phased rollout and work breakdown

| Phase | Work | Agent (tier / model) | Exit |
|---|---|---|---|
| 0 | This design + ADR-0199 draft; user approval; spec-register | data-architect (High / opus) → PM | Approved spec |
| 1 | Migration 0194 (as §3.2), repository, payload types + zod schema, version-number allocation, immutability tests T2/T13 | data-architect reviews → backend-engineer (High / opus) implements; dba operational review (backup-before / health-after, rollback rehearsal) | Migration applied on dev, tests green |
| 1b | Migration 0195 DART evidence cache (as §3.5) + `dart-evidence-cache.repository.ts`; may land before 0194 | data-architect reviews → backend-engineer (High / opus); dba operational review (independent rollback rehearsal) | T19 (trigger part), T25 (schema part) |
| 2a | Factor eval-draft route logic into shared lib functions (no behavior change on S7). DART seams: `fetchFinancials` `fiscalYears` + `yearOutcomes`, `syncCompanyFinancialFacts` `incremental`/`forceRefresh`, new `listDisclosuresSince`, new `selectEvidenceBusinessReport`. Existing callers byte-identical. | backend-engineer; dba consulted on the ADR-0004 freshness discipline | S7 tests unchanged, T17, T18, T22, T24 |
| 2b | Business-report evidence: section extraction over `fetchDisclosureText` into `dart_business_report_extract` (8,000-character section cap, `extractor_version`), citation validation, prompt update (`s7.screening_draft` user content only), web evidence gated by the run flag | backend-engineer; security-engineer review (MNPI, cache isolation) | T12, T15, T19, T20 |
| 2c | Bulk engine + A1–A6 + A7/A8 extensions (`force_refresh`, `checked_at`), within-candidate order (§6.2), `unchanged` rule, budget reserve with the cached-plan exemption, audit, `HUMAN_ONLY_ROUTES` | backend-engineer | T1, T3–T11, T14, T21, T23 |
| 3 | S6 UI: action, progress panel, provisional chips, comparison table, confirm dialog, ko/en catalogs | ux-designer-agent handoff → frontend-engineer (Medium / sonnet); design-system-agent lint ruling | T16, `lint:design`, i18n-lint |
| 4 | Docs: ADR-0199 to Accepted, ADR index row, handbook/S6 user guide section, CHANGELOG via `/sync` | docs-writer (Medium / sonnet) | `/sync` green |
| Follow-up (out of scope) | Separate tasks, each with its own approval: S7 per-candidate draft writes a version (`run_id` NULL, Q5); persisted DART call ledger (Q4, own ADR); version and DART-cache retention policy under FR-DATA-09 (Q7); switching S7 detail auto-sync and the company screen to incremental/cached DART collection; MCP tool for A1–A2 | backend-engineer + frontend-engineer; data-architect for Q4/Q7 schema | Not part of this spec |

## 13. Open questions — resolved

All eight questions were resolved by the user on 2026-11-16. The body of this design
and ADR-0199 reflect these decisions.

| # | Question | Decision | Where it applies |
|---|---|---|---|
| Q1 | Web evidence in bulk runs | **Off by default.** Web search is an explicit per-run option (`web_evidence: true`, start-dialog checkbox unchecked by default), stored on the run so resume keeps it. | §3.2 `web_evidence` column, §4 A1, §5, §9, §10, T15 |
| Q2 | Automatic resume | **Manual resume only.** A budget-paused or interrupted run resumes only through A3, called by a person or an agent under a person's delegation. The scheduler never resumes a run. | §5, §6.4, ADR-0199 decision 4 |
| Q3 | Non-DART candidates | **No draft.** They get no financial or technical draft and show `확인 안됨 · DART 미등록`. | §2, §5, §7, T7 |
| Q4 | DART counter persistence | **Accepted as recommended:** keep the per-process counter limitation for now. A persisted call ledger is a separate follow-up task with its own ADR, out of this spec's scope. | §6.5, §12 follow-up |
| Q5 | S7 single-draft versioning | **Accepted as recommended:** S7 per-candidate drafts writing versions is a separate follow-up task, out of this spec's scope. `run_id` stays nullable for it. | §3.2, §12 follow-up |
| Q6 | Longlist-wide confirm | **No `전체 확정` action.** Confirmation is per candidate, from the comparison expansion. | §10, ADR-0199 decision 6 |
| Q7 | Version retention | **Accepted as recommended:** unlimited versions per candidate until an FR-DATA-09 retention policy is designed as a separate follow-up task, out of this spec's scope. | §3.2 retention note, §12 follow-up |
| Q8 | Freshness window during the filing season | **30 days normally, 7 days from March 1 to May 31** (KST evaluation date). These are code constants (`DART_FRESHNESS_DAYS`, `DART_FRESHNESS_DAYS_FILING_SEASON`) with no schema impact. In season, this costs about one incremental list call per candidate per week, and it catches new annual reports and corrections within a week. | §2 G3a, §6.1, §6.2, §10, T22, ADR-0199 decision 8 |
