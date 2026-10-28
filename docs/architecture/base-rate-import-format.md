# Base-rate and benchmark-case import format

ADR-0187 decision D2 (owner, 2026-10-27) adds the `base_rate` table and provenance columns on `benchmark_case` in migration 0181. The repository ships with **no** base-rate rows. No sourced base-rate data exists in the repository, and an invented row would be the defaulted evidence that finding H7 removes. Data enters only through the two import scripts below.

## Provenance (mandatory on every row)

| Field | Rule |
|---|---|
| `source` | Non-blank citation: the post-mortem record id, or the study / statistic with its publisher and year |
| `verified_on` | `YYYY-MM-DD`, not in the future: the date a person last checked the figure against the source |
| `maintainer` | Non-blank owner of the row (person or role) |
| `evidence_kind` | `internal_post_mortem` \| `public_study` \| `regulatory_statistic` \| `industry_dataset` |

A row with `evidence_kind = internal_post_mortem` must not name a project or opportunity. Its `source` and `note` (for benchmark cases: `source`, `title` and `summary_ko`) are rejected when they contain `PRJ-`, `NP-` or a 26-character record id (the ULID format used for project and opportunity ids). Base rates are readable by every authenticated user, so a post-mortem enters only as aggregated, de-identified knowledge (need-to-know, boundary 1).

If any row in a file fails, the whole file is rejected and nothing is written. The script prints every failing row index with its reasons and exits with code 2. The database also enforces these rules (NOT NULL and CHECK on `base_rate`), so a write that skips the script still cannot land without provenance.

## `base_rate` rows

```json
[
  {
    "reference_class_key": "greenfield.plant.capex_overrun",
    "metric": "capex_overrun_ratio",
    "unit": "ratio",
    "sample_size": 12,
    "p10": 0.02,
    "p50": 0.18,
    "p90": 0.55,
    "source": "<citation>",
    "verified_on": "2026-10-28",
    "maintainer": "risk-officer",
    "evidence_kind": "internal_post_mortem",
    "note": "optional"
  }
]
```

`p50` is required; `p10` and `p90` are optional, and the file is rejected unless p10 <= p50 <= p90. Rows are never deleted. A newer row for the same class and metric is added beside the older one, and the older row may be marked `superseded_by`. A duplicate of (`reference_class_key`, `metric`, `source`, `verified_on`) is skipped.

```bash
bun scripts/co-newbiz/import-base-rates.ts --file rows.json --actor <app_user id> --dry-run
bun scripts/co-newbiz/import-base-rates.ts --file rows.json --actor <app_user id>
```

## `benchmark_case` rows

The fields are `title`, `summary_ko`, `deal_type` (`greenfield` \| `brownfield` \| `license-in` \| `jv` \| `partnership`), and the optional `industry`, `region`, `deal_year`, `deal_size_krw_m` (INTEGER, KRW millions, ADR-0061), `key_metrics` (object) and `reference_class_key`, plus the four provenance fields. `source` is stored in `source_ref`.

```bash
bun scripts/co-newbiz/import-benchmark-cases.ts --file cases.json --actor <app_user id>
```

The eight cases seeded by `seed-benchmark-cases.ts` before migration 0181 keep their `source_ref`. Their `verified_on`, `maintainer` and `evidence_kind` stay NULL, so they read as provenance-incomplete until a maintainer verifies them.

## Read path (read-only)

`GET /api/base-rates?reference_class_key=<key>[&metric=<metric>]` returns `{status: "available", rows}` with provenance, or `{status: "not_available", reason}`. A missing class is never returned as a default value. Without `reference_class_key`, the route lists the reference classes that have rows. The consumers are assumption-audit (S3 reference-class deviation), the S8 valuation sanity check and the risk-officer red-team.
