# DEG Stage Alignment for co-newbiz

- **Date**: 2026-09-20
- **Status**: Implemented (PR1 `co-newbiz#365`, PR2 `co-newbiz#367` — merged 2026-09-20)
- **Scope**: `Projects/co-newbiz` only. No files in the root `ai-workspace-standards` repo change.
- **Upstream brief**: `ai_workspace/docs/designs/2026-09-19-template-domain-operating-system-design.md` §1.4, §13.2 (P7), §13.3, §13.4
- **Upstream ADRs**: ADR-0083 (Domain Execution Graph and Stage Axis), ADR-0084 (RACI actor typing)
- **Local precedent**: ADR-0053 / `procedures/_human-roles.yaml` (closed registry, fail-closed, anti-gaming)

---

## 0. Position

co-newbiz is the **donor**, not a rollout target. It already implements the Stage axis under the
name `gate:`. Nothing about the existing `gate:` field, its values, or the tooling that reads it
changes. This design adds a **thin adapter** so that the same conceptual axis is also expressible in
the workspace-standard DEG vocabulary, and makes `scripts/co-newbiz/graph.ts` declare conformance.

Everything here is **additive**. The acceptance test for the whole change is: *delete the two new
YAML files and the new emission branches, and co-newbiz behaves exactly as it does today.*

---

## 1. Evidence base

### 1.1 Observed `gate:` values

Verified by grep over `procedures/**/schema.yaml` on 2026-09-20:

| `gate:` value | Occurrences | Procedures |
|---|---:|---|
| `Screening` | 4 | `brownfield-screening`, `greenfield-screening`, `company-profile-analysis`, `deal-shape-chain` |
| `Target Screening` | 1 | `brownfield-target-screening` |
| `Pre-FS` | 4 | `brownfield-pre-fs`, `greenfield-pre-fs`, `brownfield-target-identification`, `greenfield-capability-assessment` |
| `FS` | 2 | `brownfield-fs`, `greenfield-fs` |
| `DD` | 3 | `brownfield-dd`, `greenfield-dd`, `deal-structuring` |
| `Entity IC` | 2 | `entity-ic-review`, `entity-establishment-execution` |
| `Group IC` | 1 | `group-investment-review` |
| `post_close` | 3 | `pmi-integration-execution`, `jv-lifecycle-governance`, `portfolio-venture-monitoring` |

**8 distinct values**, not the 6 implied by the upstream doc's "six-gate sequence" phrasing.
`procedures/_template/schema.yaml` carries the sentinel `gate: TODO` and is excluded from
validation (see §5.3).

Quoting style is inconsistent (`gate: DD` vs `gate: "DD"`) and three entries carry trailing YAML
comments. Both are irrelevant to the adapter — YAML parses the scalar identically and strips the
comment. **No normalization of existing files is in scope.**

### 1.2 Correction to the dispatch brief

The dispatch brief states that *Target Screening* is the parallel entry point, citing the code
comment "entry station; the chain runs parallel". **That comment is on a different procedure.** The
actual source line is:

```yaml
# procedures/_shared/deal-shape-chain/schema.yaml:17
gate: Screening   # entry station; the chain runs parallel to the market-shaped chains, not inside the six-gate sequence
```

The parallel entry station is `deal-shape-chain`, whose gate is **`Screening`**. `Target Screening`
carries no such comment and sits sequentially on the brownfield chain
(`brownfield-screening` → `brownfield-target-screening` → `brownfield-pre-fs`).

This inverts the answer to the question the brief asked (§2.2).

---

## 2. `process/stages.yaml` and `process/stage-aliases.yaml`

### 2.1 File locations — deviation from the dispatch brief, noted

The brief proposed `procedures/stage-aliases.yaml`. This design uses **`process/stage-aliases.yaml`**
instead, for three reasons:

1. The authoritative upstream text (§13.3(a)) says `process/stage-aliases.yaml` verbatim.
2. `Projects/co-newbiz/process/` **already exists** (it holds `flow.spec.yaml`), so no new directory
   is created and the path matches the `templates/co-*/process/stages.yaml` convention the rollout
   established.
3. `procedures/` is the namespace of procedure definitions and their registries; the stage axis is a
   process-layer concern, and mixing it into `procedures/` would obscure that the two new files are
   contract artifacts rather than procedure content.

Two files, not one:

| File | Contract | Purpose |
|---|---|---|
| `process/stages.yaml` | `templates/common/schemas/process.schema.json` (unforked, consumed as-is) | The stage definitions themselves — the standard contract. |
| `process/stage-aliases.yaml` | co-newbiz-local (§2.4) | The thin adapter: `gate:` value → stage id. Nothing else. |

They must be separate because `process.schema.json` declares `"additionalProperties": false` at the
document root and `"required": ["schema_version", "variant", "stages"]`. An alias block cannot be
carried inside a conformant `stages.yaml`. Splitting is what makes "consume the same contract, do
not fork the schema" actually achievable.

`variant: co-newbiz` satisfies the schema's `"pattern": "^co-[a-z]+$"` — verified.

### 2.2 Stage numbering — the decision

**Decision: `Target Screening` gets its own stage id, `S2`. `Screening` is `S1`. Both
`deal-shape-chain` (the actual parallel entry station) and the two screening procedures alias to
`S1`.**

| Order | Stage id | Title | Aliased `gate:` value |
|---:|---|---|---|
| 1 | `S1` | Screening | `Screening` |
| 2 | `S2` | Target Screening | `Target Screening` |
| 3 | `S3` | Pre-FS | `Pre-FS` |
| 4 | `S4` | FS | `FS` |
| 5 | `S5` | DD | `DD` |
| 6 | `S6` | Entity IC | `Entity IC` |
| 7 | `S7` | Group IC | `Group IC` |
| 8 | `S8` | Post-Close | `post_close` |

**Justification.**

1. **Evidence (§1.2).** The parallelism comment belongs to `deal-shape-chain`, which is already at
   `Screening`/`S1`. `Target Screening` is a sequential brownfield step. The premise for collapsing
   it into `S1` does not hold.
2. **Independent confirmation of the offsets.** The upstream design doc's own worked example is
   `gate: "Pre-FS"` → `stage: S3`. That offset is only reachable if `Target Screening` occupies a
   distinct `S2`. Collapsing it would make Pre-FS land on `S2` and contradict the brief.
3. **Information preservation.** Aliasing two gates onto one stage is lossy and irreversible in the
   graph projection; splitting is not. An 8→8 mapping keeps the adapter a pure bijection, which is
   what makes it auditable and cheap to validate (§5).
4. **The `stage_follows` objection is answered by node semantics, not by numbering.** The common
   generator derives `stage_follows` from order adjacency, so `S1→S2→S3` will be emitted even though
   greenfield procedures skip `S2`. That edge asserts *stage ordering*, not *mandatory traversal* —
   the same is already true of every variant where optional stages exist. The brownfield/greenfield
   path distinction is carried by the procedures' own `applies_to` semantics, not by the stage
   lattice. To keep this explicit rather than implicit, `S2` carries a `purpose` sentence naming it
   brownfield-only (§2.3).

### 2.3 `process/stages.yaml` shape

Conforms to `process.schema.json` v1.0 with no extensions. Per-stage required fields: `id`, `title`,
`order`, `purpose`, `entry_criteria`, `exit_criteria`, `owner_agent`.

```yaml
schema_version: "1.0"
variant: co-newbiz
stages:
  - id: S1
    title: Screening
    order: 1
    purpose: >-
      Initial opportunity and company screening. Entry station for all chains,
      including the deal-shape chain, which runs parallel to the market-shaped
      chains rather than inside the sequential gate ladder.
    entry_criteria:
      - "An opportunity or candidate company has been registered."
    exit_criteria:
      - "A screening verdict is recorded with its RAG grade."
    owner_agent: <resolve from the procedures' owner at this gate>
  - id: S2
    title: Target Screening
    order: 2
    purpose: >-
      Brownfield-only target shortlisting. Greenfield chains advance from S1
      directly to S3; S2 is a stage in the ordering lattice, not a mandatory
      traversal for every chain.
    ...
  # S3 Pre-FS, S4 FS, S5 DD, S6 Entity IC, S7 Group IC, S8 Post-Close
```

`owner_agent`, `entry_criteria`, and `exit_criteria` values are **not invented by this design**.
Implementation must derive each from the existing SSOTs at that gate — the procedures' declared
owners, and the gate criteria already encoded in `procedures/_kill-criteria/*.json` and
`docs/manuals/business-manual.md`. If a value cannot be sourced, the implementer stops and escalates
rather than authoring policy. That boundary is the whole point of co-newbiz being the donor.

### 2.4 `process/stage-aliases.yaml` schema — exact

Deliberately modeled on `_human-roles.yaml`: a closed registry, a top-level map keyed by the domain
value, each entry a small object with a human-readable justification and a reference. No lists, no
ordering information (ordering lives in `stages.yaml`, single source of truth).

```yaml
# process/stage-aliases.yaml — the thin field adapter that maps co-newbiz's
# native `gate:` field onto the workspace-standard DEG Stage axis
# (ADR-0083). co-newbiz is the donor of the Stage concept; this file is an
# EXPORT surface, not a migration. The `gate:` field remains the SSOT and
# every co-newbiz tool that reads it keeps working unchanged.
#
# Closed registry (mirrors procedures/_human-roles.yaml, ADR-0053): every
# `gate:` value used by any procedures/**/schema.yaml MUST have an entry
# here, and every entry MUST name a stage id declared in
# process/stages.yaml. Both directions are enforced fail-closed by
# procedures/_validate.ts. Adding a gate value = adding the alias entry in
# the same change.
#
# Read statically — no database dependency.

schema_version: "1.0"
variant: co-newbiz

aliases:
  "Screening":
    stage: S1
    note: >-
      Entry station for all chains. deal-shape-chain also sits here and runs
      parallel to the market-shaped chains.
    reference: procedures/_shared/brownfield-screening/schema.yaml
  "Target Screening":
    stage: S2
    note: Brownfield-only. Greenfield chains advance S1 -> S3.
    reference: procedures/_shared/brownfield-target-screening/schema.yaml
  "Pre-FS":
    stage: S3
    reference: procedures/_shared/brownfield-pre-fs/schema.yaml
  "FS":
    stage: S4
    reference: procedures/_shared/brownfield-fs/schema.yaml
  "DD":
    stage: S5
    reference: procedures/_shared/brownfield-dd/schema.yaml
  "Entity IC":
    stage: S6
    note: Human decision authority (ADR-0053, boundary #2).
    reference: procedures/_shared/entity-ic-review/schema.yaml
  "Group IC":
    stage: S7
    note: >-
      Ranking decision, not a yes/no approval (ADR-0029). Human decision
      authority.
    reference: procedures/_shared/group-investment-review/schema.yaml
  "post_close":
    stage: S8
    note: >-
      Gate slot added after entity_ic per ADR-0052. Covers PMI, JV lifecycle
      governance, and venture-portfolio monitoring.
    reference: procedures/_shared/pmi-integration-execution/schema.yaml
```

**Field contract:**

| Field | Type | Required | Rule |
|---|---|:--:|---|
| `schema_version` | string | yes | Fixed `"1.0"`. |
| `variant` | string | yes | Fixed `"co-newbiz"`. Matches `stages.yaml`. |
| `aliases` | map | yes | Keys are the exact `gate:` scalar as it appears in `schema.yaml` (comments already stripped by the YAML parser; whitespace-trimmed). Case-sensitive. |
| `aliases.<gate>.stage` | string | yes | Must match `^S[0-9]+$` and must be declared in `process/stages.yaml`. |
| `aliases.<gate>.note` | string | no | Free text. Why this mapping, or a domain caveat. |
| `aliases.<gate>.reference` | string | yes | A repo-relative path to one `schema.yaml` that uses this gate value. Mirrors `_human-roles.yaml`'s `reference`. |

Unknown keys under an alias entry are an **error** (closed registry discipline).

**Cardinality decision:** one gate maps to exactly one stage (`stage:` is a scalar, not a list).
A many-to-one mapping is permitted in principle by the schema (two gates could name the same stage
id) but is not used, and §2.2 argues it should stay unused. A one-to-many mapping is forbidden
outright — it would make the graph projection non-deterministic.

---

## 3. Consumption contract for `scripts/co-newbiz/graph.ts`

### 3.1 What exists today

`scripts/co-newbiz/graph.ts` v0.4.1 (1078 lines) emits 9 node types
(`agent`, `artifact`, `adr`, `decision`, `procedure`, `rule`, `skill`, `step`, `var`) and 12 edge
types. Its node ids use a colon scheme: `proc:<key>`, `proc:<key>#<stepId>`, `agent:<key>`,
`skill:<name>`, `artifact:<name>`, `rule:<stem>`, `var:<name>`.

Critically, **`gate` is already carried on every `step` node** as a node property
(`addNode({ id: stepId, type: "step", label: ..., gate: st.gate })`), and `--gate <Name>` is a
shipped CLI surface (`printGateBundle`) that filters on it. That is the surface that must not break.

### 3.2 The additive rule

Three hard constraints on the implementation:

1. **`step.gate` stays.** The property keeps its exact current name, type, and value — the raw
   domain string. It is not renamed to `stage`, not replaced, not normalized.
2. **`context --gate <Name>` stays.** Same flag, same matching, same output.
3. **Nothing that exists today is removed.** The pre/post node-set diff for all pre-existing node
   types must be **zero**, matching the P3 exit gate the upstream rollout held itself to.

### 3.3 What gets added

A new module-level loader, called once from the same place the `_human-roles.yaml` loader is called:

```
loadStageAliases()   // reads process/stage-aliases.yaml + process/stages.yaml
                     // returns { stages: StageDef[], aliasOf: Map<gate, stageId> }
```

Both files are read with `existsSync` guards. If either is absent the generator emits its current
output unchanged and records a warning — **the graph must never hard-fail on the adapter's absence**,
because the adapter is an export surface, not a prerequisite. (Absence is caught fail-closed by the
validator instead; see §5. Separating "the graph degrades" from "the build fails" keeps the graph a
pure projection.)

Then, three additive emissions:

**(a) Stage nodes.** One per entry in `stages.yaml`, using the DEG id convention
`stage.co-newbiz.<id>`:

```json
{ "id": "stage.co-newbiz.S3", "type": "stage", "label": "Pre-FS",
  "order": 3, "gate_alias": "Pre-FS" }
```

`gate_alias` is a co-newbiz-local property that makes the adapter visible in the projection itself,
so a reader of `docs/graph/graph.json` can see the mapping without opening the YAML. `stage` joins
the `NodeType` union as a 10th type.

**(b) `stage_follows` edges.** Between order-adjacent stages, `N → N+1`, matching the common
generator's derivation exactly. `source_ref: "process/stages.yaml"`.

**(c) `in_stage` edges.** Procedure → stage, derived by looking up the procedure's `gate:` value in
`aliasOf`:

```json
{ "type": "in_stage", "from": "proc:brownfield-pre-fs",
  "to": "stage.co-newbiz.S3",
  "source_ref": "procedures/_shared/brownfield-pre-fs/schema.yaml" }
```

The edge is emitted **from the procedure node**, not the step node, matching the common generator
(`in_stage: procId → stageId`). Steps continue to carry their `gate` property and gain nothing new;
this avoids a combinatorial explosion of step→stage edges that would carry no information the
procedure edge does not already carry.

A procedure whose gate value has no alias entry emits **no** `in_stage` edge and appends to a new
`warnings.unaliased_gates` array — consistent with how `graph.ts` already handles
`undeclared_procedures` and `unknown_step_agents`.

### 3.4 Node id namespace note

co-newbiz's existing ids use `proc:` / `agent:` colon prefixes; DEG uses dotted
`procedure.<variant>.<name>`. **This design does not renamespace the existing ids.** Doing so would
break every committed `docs/graph/graph.json` consumer and every `--skill` / `--gate` bundle, for
zero semantic gain, and it is explicitly outside what §13.3(b) asks for ("make its output carry
`graph_profile` and rename only the colliding edges"). Only the **new** stage nodes adopt the dotted
DEG convention, because they have no legacy consumers. The resulting mixed scheme is intentional and
must be documented in the generator's header comment: dotted ids are DEG-conformant nodes, colon ids
are co-newbiz-native superset nodes.

If full id renamespacing is ever wanted, it is a separate, larger change with its own design.

### 3.5 Determinism

Stage nodes sort into the existing node ordering by id; `stage_follows` and `in_stage` edges sort
into the existing edge ordering. `graph --check` must stay byte-stable — the existing no-timestamp
discipline already guarantees this provided the new emissions are sorted, not append-at-end.

---

## 4. `graph_profile: "deg/v1"` placement

### 4.1 What the common generator emits

`ai_workspace/scripts/generate-skill-graph.ts` (v1.11.1) returns:

```js
return {
  version: 1,
  graph_profile: 'deg/v1',
  nodes: sortedNodes,
  edges: sortedEdges
};
```

**Top level, second key, immediately after `version`, sibling of `nodes`/`edges`.** Its type
declaration is `graph_profile?: 'deg/v1'` — optional, single literal value.

### 4.2 What co-newbiz emits today

`renderJson()` in `graph.ts`:

```js
{
  meta: {
    generator: "scripts/co-newbiz/graph.ts",
    generator_version: "0.4.0",
    design_doc: "docs/designs/2026-08-24-multi-element-skill-graph-pilot-design.md",
    node_count: ...,
    edge_count: ...
  },
  nodes: g.nodes,
  edges: g.edges
}
```

### 4.3 Decision

**`graph_profile` goes at the top level of the document, not inside `meta`.**

```js
{
  graph_profile: "deg/v1",
  meta: { ... },
  nodes: g.nodes,
  edges: g.edges
}
```

Rationale: the field is a **conformance declaration about the document**, and a consumer must be
able to detect it with a single unconditional top-level key read, byte-for-shape identical to the
common generator's output. Nesting it under `meta` would make co-newbiz's declaration
structurally unreachable to any consumer written against the common shape — which is precisely the
interoperability the P7 alignment exists to buy. `meta` stays exactly as it is (it is a co-newbiz
superset block the common generator does not have, and it is not in conflict).

Key order: `graph_profile` first. The common generator places it after `version`; co-newbiz has no
`version` key, so first position is the closest equivalent. **Do not add a `version: 1` key** —
co-newbiz already versions via `meta.generator_version`, and adding a second, differently-scoped
version field would be a real ambiguity rather than a cosmetic one.

One bookkeeping item: `meta.generator_version` is hardcoded `"0.4.0"` in `renderJson` while the
file header says `@version 0.4.1`. This change bumps to `0.5.0`; **fix the drift in the same PR** by
having `renderJson` read a single module constant, and update the `SCRIPTS.md` row accordingly (the
lifecycle check fails the sync otherwise).

---

## 5. Edge rename list

### 5.1 DEG edge vocabulary (from `generate-skill-graph.ts`)

`step_uses_skill`, `step_by_agent`, `produces`, `in_stage`, `stage_follows`, `accountable_for`,
`consulted_on`, `informed_of`, `gated_by`, `decides_on`, `evidenced_by`.

### 5.2 Full collision analysis of co-newbiz's 12 edge types

| co-newbiz edge | Endpoints | DEG counterpart | Verdict |
|---|---|---|---|
| `executes_agent` | `step → agent` | `step_by_agent` (`step → agent`) | **RENAME** |
| `executes_skill` | `step → skill` | `step_uses_skill` (`step → skill`) | **RENAME** |
| `produces` | `step → artifact` | `produces` (`procedure\|skill → output_type`) | Keep — see §5.4 |
| `step_of` | `step → procedure` | none | Keep (superset) |
| `owns` | `agent → skill` | none | Keep (superset) |
| `member_of` | `skill → procedure` | none | Keep (superset) |
| `evaluates` | `rule → var` | none | Keep (superset) |
| `anchored_by` | `rule → adr` | none | Keep (superset) |
| `consumes` | inferred, artifact-level | none | Keep (superset) |
| `amends` | `adr → adr` | none | Keep (superset) |
| `supersedes` | `decision → decision` | none | Keep (superset) |
| `activates_reverses` | decision-level | none | Keep (superset) |

### 5.3 The rename list — exactly two entries

| Old name | New name | Endpoints (unchanged) | Emission sites |
|---|---|---|---|
| `executes_agent` | `step_by_agent` | `step → agent` | `graph.ts:509`, `graph.ts:524`, read at `:749` |
| `executes_skill` | `step_uses_skill` | `step → skill` | `graph.ts:536`, read at `:752` |

Both are **pure renames**: same subject, same object, same cardinality, same `source_ref`. The
semantics are identical to the DEG edges; only the label differs. Leaving them would mean two names
for one relation across the workspace, which is the exact failure `graph_profile: "deg/v1"` claims
to have avoided.

Both names also appear in `renderMarkdown()`'s step table construction and must be updated there in
the same edit. Grep for both literals across `scripts/` and `tests/` before editing — the
`--check` drift test and any committed `docs/graph/graph.json` will both need regeneration.

**These two renames are the complete list.** No other co-newbiz edge collides. The remaining nine
are genuine superset relations with no DEG equivalent, and renaming any of them would be inventing
work the brief explicitly warned against.

### 5.4 Why `produces` is not renamed

`produces` is the one **same-name** case. co-newbiz emits `step → artifact:<name>`; DEG emits
`procedure|skill → output_type.<name>`. The *relation* is identical — producer to produced output
type. What differs is the subject granularity (step vs procedure) and the target namespace
(`artifact:` vs `output_type.`).

Renaming would be wrong on both readings:

- It is not a **semantic** collision (the meaning matches), so the "rename colliding names" rule
  does not fire.
- It is not a **namespace** collision either, because the two graphs are separate documents with
  disjoint id schemes; a `produces` edge's target prefix unambiguously identifies which model it
  belongs to.

Keeping `produces` also preserves the finer granularity co-newbiz has (step-level attribution),
which is a superset property worth protecting under the same logic that protects `rule` and `var`.

**Residual risk, recorded:** if a future pass ever merges the two graphs into one document, the
`artifact:` vs `output_type.` split under a shared edge name becomes a real ambiguity. That is a
merge-time problem with a merge-time solution (namespace the ids, per §3.4) and is out of scope
here. Flagged so it is not rediscovered as a surprise.

---

## 6. Validation

Fail-closed, mirroring the `_human-roles.yaml` anti-gaming pattern: *adding a gate value requires
adding the alias entry in the same change.* The registry is worthless if a new gate can slip in
unmapped.

### 6.1 `procedures/_validate.ts` — the enforcement point

`_validate.ts` already owns the `_human-roles.yaml` pattern end to end: a `loadHumanRoles()`
loader at `:518` that returns `{ roles: Set, error }` and pushes a **file-level error** if the
registry is unreadable, plus per-key checks that error with the "add the registry entry in the same
change" message (`:595`). The new checks slot in beside these, reusing the same shape.

Add `loadStageAliases()` and four checks:

| # | Check | Severity | Message shape |
|---|---|---|---|
| **SA-1** | Registry loads: `process/stage-aliases.yaml` exists, parses, has `schema_version: "1.0"` and `variant: co-newbiz`. | **error** | `process/stage-aliases.yaml: unreadable or malformed — <detail>` |
| **SA-2** | **Coverage (the anti-gaming check).** Every `gate:` value on every `procedures/**/schema.yaml` has an `aliases` entry. | **error** | `<file>: gate '<value>' is not listed in process/stage-aliases.yaml — add the alias entry in the same change` |
| **SA-3** | **Referential integrity.** Every `aliases.<gate>.stage` matches `^S[0-9]+$` and is declared in `process/stages.yaml`. | **error** | `process/stage-aliases.yaml: alias '<gate>' names stage '<id>' which is not declared in process/stages.yaml` |
| **SA-4** | **Dead-entry sweep.** Every `aliases` key is used by at least one `schema.yaml`. | **warning** | `process/stage-aliases.yaml: alias '<gate>' is unused by any procedure — remove it or confirm it is reserved` |

SA-4 is a warning, not an error: a gate can legitimately be pre-registered ahead of the procedure
that will use it, the way `post_close` was added as a slot under ADR-0052 before all three of its
procedures landed. Erroring would punish correct sequencing.

**Exclusion:** `procedures/_template/schema.yaml` carries the sentinel `gate: TODO` and must be
excluded from SA-2 by the same mechanism `_validate.ts` already uses to skip the template directory.
Verify that mechanism exists before implementing; if the template is currently walked, add an
explicit `_template` skip rather than adding `TODO` to the registry — registering a sentinel as a
real gate value is exactly the gaming the pattern exists to prevent.

**Normalization:** compare the trimmed YAML scalar. Trailing `#` comments are already stripped by
`js-yaml`; quoting style is already normalized by the parser. No other normalization —
specifically, the comparison is **case-sensitive** (`post_close` ≠ `Post_Close`), so a typo'd gate
fails loudly instead of silently aliasing.

### 6.2 `scripts/co-newbiz/graph-map.ts --check`

`graph-map.ts --check` already performs the cross-registry consistency pass for human roles. It
gains **one** check:

| # | Check | Severity |
|---|---|:--:|
| **SA-5** | Every procedure node in the generated graph that has a non-empty `gate` also has exactly one outgoing `in_stage` edge. | **error** |

This is the projection-level mirror of SA-2 — it catches the case where the registry is complete but
the generator failed to emit, which `_validate.ts` cannot see because it never looks at the graph.
It is the same belt-and-braces split already in place for human roles (registry checked in
`_validate.ts`, projection checked in `graph-map.ts`).

### 6.3 What is deliberately *not* validated

- **No check that `stages.yaml` is complete w.r.t. some external stage list.** There is no such
  external list; `stages.yaml` is the SSOT for stage existence.
- **No validation of `gate:` values against a hardcoded enum.** The registry *is* the enum. Adding a
  second hardcoded list would create a third place to update and a new drift surface.
- **No `graph.ts` hard-fail on a missing adapter** (§3.3) — that is `_validate.ts`'s job. Keeping
  the generator a pure projection means it degrades rather than blocks.

---

## 7. PR split

**Confirmed: this splits cleanly into two PRs, matching §13.4's "P7 | 2 | adapter; then graph
reconciliation".** The split is clean because PR1 introduces no consumer of the new files, so it
cannot regress the graph; and PR2 introduces no new authored data, so it cannot regress the
contract.

### PR1 — Stage adapter and validation

| Files | Change |
|---|---|
| `process/stages.yaml` | **new** — 8 stages, conformant to `templates/common/schemas/process.schema.json` |
| `process/stage-aliases.yaml` | **new** — 8 alias entries |
| `procedures/_validate.ts` | `loadStageAliases()` + SA-1..SA-4; `@version` bump |
| `tests/` | Unit tests for SA-1..SA-4, including a negative fixture (a gate value with no alias entry must error) |
| `CHANGELOG.md`, `SCRIPTS.md` | Entry + `@version` row for `_validate.ts` |

**Exit gate:** `_validate.ts` green on the real tree; the negative fixture fails as designed;
`docs/graph/graph.json` is **byte-identical** to its committed state (nothing consumes the new files
yet). That last condition is what proves PR1 is inert.

### PR2 — Graph reconciliation

| Files | Change |
|---|---|
| `scripts/co-newbiz/graph.ts` | `graph_profile` (§4.3); `stage` node type; `stage_follows` + `in_stage` emission; 2 edge renames (§5.3); `meta.generator_version` drift fix; `@version` → 0.5.0 |
| `scripts/co-newbiz/graph-map.ts` | SA-5; `@version` bump |
| `docs/graph/graph.json`, `docs/graph/graph.md` | regenerated |
| `tests/` | Determinism (`graph --check` clean twice), node-set diff, rename coverage |
| `CHANGELOG.md`, `SCRIPTS.md` | Entries + `@version` rows for both scripts |

**Exit gate:** `graph --check` exits 0 on a clean regeneration; the pre/post node-set diff for all
pre-existing node types is **zero**; `context --gate <Name>` produces identical output to
pre-change; `graph_profile: "deg/v1"` present at top level.

### Ordering

PR1 must merge before PR2 opens. Not a stylistic preference: PR2's generator reads the files PR1
creates, and CONSTITUTION §3.3's sequential-branch rule applies because both PRs touch
`CHANGELOG.md` and `SCRIPTS.md`, which `dev-sync.ts` rewrites on every commit. Parallel branches
conflict by default here.

---

## 8. Open items for PM

1. **`stages.yaml` content sourcing** (§2.3). `owner_agent`, `entry_criteria`, and `exit_criteria`
   must be derived from existing SSOTs, not authored. If the implementer finds a stage with no
   sourceable owner or criteria, that is an escalation, not a judgement call.
2. **Path deviation** (§2.1). This design uses `process/stage-aliases.yaml` per the upstream doc,
   not `procedures/stage-aliases.yaml` per the dispatch brief. Confirm.
3. **`Target Screening` = `S2`** (§2.2). Decided against the brief's suggested framing, on the
   evidence in §1.2. Confirm before PR1.
4. **`_template/schema.yaml` skip mechanism** (§6.1). Verify it exists before implementing SA-2.
