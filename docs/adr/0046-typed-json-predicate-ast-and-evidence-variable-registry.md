# ADR-0046: Typed JSON predicate AST and an evidence-variable registry with run-scoped snapshots

**Status**: Accepted
**Date**: 2026-08-22 (accepted 2026-08-23)
**Deciders**: process-governance-manager, platform-lead, risk-officer, compliance-officer, quant-methodologist

> **Accepted 2026-08-23** — the proposal's effect condition is met: PR-1 (predicate engine, `db/lib/predicate.ts`) and PR-2 (migration: `rag_rule` DROP+CREATE, `evidence_var`, `rag_rule_variable`, `project_variable_snapshot`) landed. The engine now also carries the kill-criteria evaluation path (ADR-0057).

## Context

Three of the six RAG dimensions — `market`, `technical_execution`, and `risk` — have no scoring function. Callers write the grade into a scenario JSON by hand, and `docs/governance/rag-framework.md` does not state the criteria for these three even in prose. The `rag_rule` table exists but has **0 rows inserted and 0 code paths reading it**, which makes this the last moment at which its shape can be changed without a data migration or a compatibility shim.

Formalizing the three missing dimensions requires deciding, first, in what language a rule condition is written, and second, where the values that a condition refers to come from. Three candidate condition formats were considered:

1. **A custom textual DSL.** Rejected: it requires a hand-written parser and its own error reporting, and every rule becomes an opaque string that neither `zod` nor SQL can inspect. The repository would gain a second grammar to maintain alongside the procedure YAML schema for no expressive gain.
2. **Decomposed condition rows** (one SQL row per atomic comparison, joined by a group/sequence column). Rejected: nesting depth and operator precedence have to be reconstructed at read time, `at_least(k, …)` has no natural row representation, and a partially-written rule is indistinguishable from a complete one. Rules become unreadable in exactly the artifact — the governance document a human reviewer signs — where readability is the point.
3. **A typed JSON predicate AST.** Adopted. It is validated by `zod` at write time and at load time, it is diffable in review, it renders to Korean prose mechanically for the governance surface, and its variable references are extractable into a join table so that "which rules read this variable" is an indexed SQL query rather than a `LIKE` scan.

Alongside the format question, the original design resolved each variable at evaluation time with a dynamic per-variable query descriptor of the shape `{kind: "column", table, column, aggregate: "latest"}`. Schema verification found this unworkable on three independent counts, recorded in the Decision below.

## Decision

### 1. `condition_expr` is a typed JSON predicate AST

```ts
export type Predicate =
  | { op: "all_of" | "any_of" | "none_of"; of: Predicate[] }
  | { op: "at_least"; k: number; of: Predicate[] }
  | { op: "cmp"; var: string; cmp: "lt"|"lte"|"gt"|"gte"|"eq"|"neq"; value: Scalar; unit?: string }
  | { op: "in"; var: string; values: Scalar[] }
  | { op: "is_null"; var: string }
  | { op: "count"; var: string; cmp: "lt"|"lte"|"gt"|"gte"|"eq"; value: number };
```

It is not a DSL and not decomposed rows, for the reasons given in Context. The same predicate language is reused for `applies_when` (step applicability) and for the kill-criteria registry — one grammar, one validator, one renderer.

### 2. Evaluation uses Kleene three-valued logic, not a flat missing-evidence rule

The original rule — "if any referenced variable is missing, the whole predicate is UNASSESSED" — is **wrong**, and the correct truth tables are normative here rather than left to the implementation:

| Expression | Result | Why |
|---|---|---|
| `any_of(TRUE, UNASSESSED)` | **TRUE** | one branch is already true; a missing value in another branch cannot overturn it |
| `any_of(FALSE, UNASSESSED)` | UNASSESSED | the missing value is decisive |
| `at_least(k=2, [TRUE, TRUE, UNASSESSED])` | **TRUE** | the threshold is already met without the missing value |
| `at_least(k=2, [TRUE, UNASSESSED, FALSE])` | UNASSESSED | the missing value is decisive |
| `all_of(FALSE, UNASSESSED)` | **FALSE** | one branch is already false; the conjunction cannot be true |
| `all_of(TRUE, UNASSESSED)` | UNASSESSED | the missing value is decisive |
| `none_of(TRUE, UNASSESSED)` | FALSE | symmetric to `all_of` under negation |
| `none_of(FALSE, UNASSESSED)` | UNASSESSED | symmetric |

Leaf operators (`cmp`, `in`, `is_null`, `count`) return UNASSESSED when their referenced variable has snapshot `status != 'present'`; `is_null` is the one operator that may deliberately be written against an absent value and is evaluated against `status`, not against a NULL payload.

Getting this wrong in the permissive direction reproduces exactly the false-pass this whole work stream exists to prevent; getting it wrong in the conservative direction kills the feature permanently by making every rule UNASSESSED forever. PR-1 therefore carries a per-operator truth-table test matrix as an acceptance condition, not as optional coverage.

### 3. `rag_rule` is redefined by DROP+CREATE, with anti-tampering in SQL

```sql
DROP TABLE rag_rule;   -- verified 0 rows, 0 readers — the last safe window
CREATE TABLE rag_rule (
  id TEXT PRIMARY KEY,
  rule_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  stage_gate TEXT NOT NULL CHECK (stage_gate IN ('screening','pre_fs','fs','dd','entity_ic','group_ic')),
  dimension TEXT NOT NULL CHECK (dimension IN ('financial','market','data_confidence','regulatory_permit','technical_execution','risk','overall')),
  grade TEXT NOT NULL CHECK (grade IN ('green','amber','red')),
  condition_expr TEXT NOT NULL,
  priority INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  policy_id TEXT REFERENCES governance_doc(id),
  thresholds_source TEXT,
  created_at TEXT NOT NULL,
  CHECK (enabled = 0 OR (policy_id IS NOT NULL AND thresholds_source IS NOT NULL))
);
CREATE UNIQUE INDEX idx_rag_rule_key ON rag_rule(rule_key, version);
CREATE INDEX idx_rag_rule ON rag_rule(stage_gate, dimension, priority);
```

Two corrections are load-bearing. The `enabled` default is **inverted to 0** — the prior design claimed rules default to disabled while the DB default was in fact 1, so the documented anti-tampering property did not exist. And the requirement that an enabled rule cite an approved policy and a threshold source is expressed as a SQL `CHECK`, not as a seed-loader convention, because `governance_doc` has no write controls of its own.

### 4. Evidence variables live in a registry, joined to rules

```sql
CREATE TABLE evidence_var (
  var_key TEXT PRIMARY KEY,
  label_ko TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN ('number','string','boolean')),
  unit TEXT CHECK (unit IS NULL OR unit IN ('ratio','pp','krw','months','x','count')),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('column','computed','asserted')),
  requires_evidence_ref INTEGER NOT NULL DEFAULT 0 CHECK (requires_evidence_ref IN (0,1)),
  max_age_days INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE rag_rule_variable (
  rule_id TEXT NOT NULL REFERENCES rag_rule(id),
  var_key TEXT NOT NULL REFERENCES evidence_var(var_key),
  PRIMARY KEY (rule_id, var_key)
);
CREATE INDEX idx_rag_rule_variable_var ON rag_rule_variable(var_key);
```

The registry alone was claimed to solve the refactor problem; that claim is only half true. Renaming a *physical column* is indeed a one-place change. Renaming a *registry key* touches every rule file, every `applies_when`, and every already-written `dimension_input` row — and without `rag_rule_variable`, "which rules reference this variable" is answerable only by `LIKE '%var_key%'`, which cannot use an index and produces false positives on substring collisions. The join table makes the question an indexed lookup and makes an orphaned reference an FK violation rather than a silent no-op.

### 5. Variable resolution is a run-scoped snapshot, not a dynamic per-variable query

The original `{kind:"column", table, column, aggregate:"latest"}` descriptor is rejected for three reasons:

- **`latest` is undefined for over half the source tables.** `certification`, `incentive`, and `permit` among others carry no timestamp column, so there is no ordering to take the latest of.
- **It is an identifier-injection surface.** `table` and `column` are string-interpolated into SQL. The roadmap has agents authoring registry entries; an agent-authored identifier reaching string interpolation is a defect waiting to be scheduled.
- **It is N+1 by construction.** One query per variable per evaluation, multiplied by the project count on every monitoring cycle.

The replacement is a snapshot table populated once per run:

```sql
CREATE TABLE project_variable_snapshot (
  run_id TEXT NOT NULL REFERENCES run(id),
  project_id TEXT NOT NULL REFERENCES md_project(id),
  var_key TEXT NOT NULL REFERENCES evidence_var(var_key),
  value_num NUMERIC, value_text TEXT,
  evidence_ref TEXT, observed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('present','missing','stale')),
  PRIMARY KEY (run_id, project_id, var_key)
);
```

Population is by **hand-written, code-reviewed SQL per variable family** — never by dynamic string assembly. This yields zero injection surface, one query per evaluation instead of N, a statically decided ordering column per family so that "latest" is well defined where it applies, and the run-scoped reproducibility that ADR-0005 already requires of every other artifact in the system. `dimension_input` is demoted from a special case to one of several sources that populate the snapshot.

The three-way `status` distinction is deliberate: `missing` and `stale` are different facts, and collapsing them loses the ability to say "we have this, but it is older than `max_age_days`."

## Consequences

- **This is a foundational format choice that later ADRs depend on.** The market, technical-execution, and risk threshold ADRs — and the calibration decisions that follow them — all express their thresholds as predicates in this AST, resolve their inputs through `evidence_var`/`project_variable_snapshot`, and inherit the Kleene semantics above. Changing the AST or the truth tables after those ADRs are Accepted is a breaking change to all of them, not a local edit. This is the principal reason it is sequenced first (PR-1 before PR-6/PR-7).
- `renderKo` is a **governance deliverable**, not a debugging convenience — it produces the Korean sentence a human reviewer signs against. Correct particle selection (은/는, 이/가, 을/를, 와/과) and correct negation scope across six operators × six units × N variables is substantive work; the PR-1 estimate is revised upward threefold on this basis.
- `zod` is promoted from a transitive dependency to a direct one; the AST validator is the single gate through which every rule, `applies_when` clause, and kill-criterion passes.
- `requires_evidence_ref` is presently **decorative** — the columns it would govern (e.g. `value_chain_link.evidence_ref`) are unconstrained nullable TEXT. Enforcing it as a `document` FK or a validated URI pattern is scoped to PR-6/PR-8 as a v1.1 hardening item and is explicitly **not** a hard block for this ADR.
- Known debt recorded rather than fixed here: monetary amounts are stored as `REAL` across the repository, and `project_variable_snapshot.value_num` / `dimension_input.value_num` inherit that pattern. Repository-wide remediation is out of scope for this work stream but is recorded so that a future reader does not mistake the inheritance for a fresh decision.
- `db:export --dialect postgres` does not exist; the portability claims in ADR-0002 remain unverified against this schema as against any other. Out of scope here, flagged separately.
