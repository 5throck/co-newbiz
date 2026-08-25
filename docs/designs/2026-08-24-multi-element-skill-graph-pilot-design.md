# Multi-Element Skill Graph Pilot — Design

**Status**: Proposed — awaiting acceptance (per ADR-0032, no implementation starts before this design is accepted)
**Owner**: process-governance-manager role (graph infrastructure); authored via workspace session 2026-08-24
**Date**: 2026-08-24
**Scope**: Project-local pilot (`Projects/co-newbiz`). Generalization to the workspace root (L0) is explicitly out of scope for this design and will be proposed separately after pilot validation.
**External research basis**: SkillDAG typed-edge model and propose-then-commit protocol [Source: arXiv 2606.03056] · SKILLGRAPH edge decay/reinforcement for non-permanent relations [Source: arXiv 2605.12039] · Graph-of-Skills sparse validation within candidate pools [Source: arXiv 2604.05333] · LEDGER layered evidence graphs [Source: arXiv 2608.18398] · Decision Event Schema append-only enrichment [Source: arXiv 2604.09296]

---

## 0. Problem and goal

The workspace root already owns a **skill-to-skill relationship graph** (ADR-0060, generated projection, advisory edges). Two gaps motivated this pilot:

1. The root graph covers only skill↔skill/agent/phase relations over `templates/`. This project's richest relational material lives **project-locally** and is invisible to it.
2. Relations here span more element types than skills: procedures, agents, artifacts, executable rules, evidence variables, and decision records already reference each other — but no unified view exists, so contextual linkage ("when I load X, what else matters?") requires reading five file families by hand.

**Goal**: one generated, committed projection (`docs/graph/graph.json` + `graph.md`) over **7 node types and advisory typed edges**, derived exclusively from existing SSOTs — plus a context-bundle CLI that consumes the graph at session time. No new registry, no hand-maintained store.

## 1. SSOT map (verified 2026-08-24)

| Element | Source of truth | Notes |
|---|---|---|
| Skills (122) | `skills/*/SKILL.md` | `metadata.procedure_keys[]` present in 44; `owner:` names an agent |
| Agents (34) | `agents/*.md` (+ AGENTS.md roster) | four domains + `_core`/`_shared` |
| Procedures (15) | `procedures/_shared/<name>/schema.yaml` | `steps[]{id, gate, agent_key, skill_key, output_type, applies_when}`; dispatch reads this directly (meeting M7-3 D-M7-3-1) |
| Region/entity overrides | `procedures/entities/`, `procedures/regions/` | resolved by `newbiz.ts proc:resolve`; graph uses the **shared layer** and records override existence as a node attribute |
| Kill-criteria rules | `procedures/_kill-criteria/<procedure>__<criterion_id>.json` | per-entry files; anti-tamper gate requires governance anchors for enabled entries; predicates parse under the ADR-0046 AST (`db/lib/kill-criteria.ts`) |
| Threshold decisions | `docs/decisions/{market,risk,technical-execution}-thresholds.md`, `docs/decisions/*.md` | Supersedes/Amends/anchor vocabulary in active use (e.g. `gd-0024-class-c-decisions`) |
| Evidence variables | `db/lib/snapshot-filler.ts` SNAPSHOT_VAR_KEYS + migrations | snapshot-var plane the evaluator reads (`db/lib/kill-criteria.ts`, ADR-0057) |

## 2. Node types (7)

| Type | id scheme | Extracted from |
|---|---|---|
| `skill` | `skill:<name>` | SKILL.md frontmatter (name, version, status) |
| `agent` | `agent:<key>` | agents/ roster + schema.yaml `agent_key` values |
| `procedure` | `proc:<procedure_id>` | schema.yaml header (id, title, version, status, gate chain) |
| `step` | `proc:<pid>#<n>` | schema.yaml steps[] (gate, applies_when summary) |
| `artifact` | `artifact:<output_type>` | distinct `output_type` values across all steps |
| `rule` | `rule:<procedure>__<criterion_id>` | `_kill-criteria/*.json` |
| `decision` | `dec:<file stem>` (+ `adr:<number>` alias nodes) | `docs/decisions/*.md`, `docs/adr/*.md` |

Gates are **step attributes**, not nodes (avoids node-type bloat; a gate is never dispatched, only crossed).

## 3. Edge types (10, all advisory)

| Edge | From → To | Extraction rule | Mutability handling |
|---|---|---|---|
| `owns` | agent → skill | SKILL.md `owner:` exact match against roster | regen |
| `member_of` | skill → procedure | SKILL.md `metadata.procedure_keys[]` | regen; backfilled via §6 |
| `executes` | step → agent, step → skill | schema.yaml step fields | regen |
| `produces` | step → artifact | schema.yaml `output_type` | regen |
| `consumes` | step → artifact | **exact-token match only**: an `output_type` identifier appearing verbatim in a later step's `description` or `applies_when` var path | regen; low-confidence matches suppressed, listed in report |
| `evaluates` | rule → evidence var | predicate AST variable references (ADR-0046 parser reused from `db/lib`) | regen; follows registry `verified_on` |
| `anchored_by` | rule → decision | registry entry anchors (anti-tamper field) | regen |
| `supersedes` / `amends` | decision → decision \| adr | `Supersedes:` / `Amends:` lines, exact id match | **append-only** — historical records never rewritten |
| `activates_reverses` | decision/adr → rule | decision prose citing `<procedure>__<criterion_id>` verbatim (e.g. ADR-0062 → `brownfield-screening__preliminary_hhi_flags_certain_block`) | regen; premise-locked rules carry the lock as an attribute |

All edges carry `source_ref` (file + line/step id) so every claim is auditable back to its SSOT line. Byte-stable generation (no timestamps) so drift-check diffs are clean — same discipline as the root generator.

## 4. Emitter and drift gate

- `bun scripts/co-newbiz/newbiz.ts graph` → writes `docs/graph/graph.json` (machine) + `docs/graph/graph.md` (human catalog: per-procedure step tables, per-skill relation rows, orphan lists).
- `bun scripts/co-newbiz/newbiz.ts graph --check` → regenerate to memory, diff against committed files, exit 1 on drift.
- Wired into `scripts/audit-variant.ts` (the pluggable variant audit hook) so pre-commit enforces freshness without touching core scripts.

## 5. Context bundle (the consumer side)

- `newbiz.ts context --skill <name>`: owning agent · member procedures and step positions · artifacts produced · downstream consumers · enabled rules evaluating this procedure's plane (with premise-lock status) · anchoring decisions · supersession chain heads.
- `newbiz.ts context --gate <Gate>`: ordered steps crossing the gate · executing agents/skills · mandatory checklist files referenced by those steps · kill-criteria evaluated at the gate · open decision records affecting them.
- Bundle output is plain markdown to stdout — paste-into-session friendly, no runtime coupling. This is the "contextual linkage" deliverable: loading a skill can pull its neighborhood in one command.

## 6. procedure_keys backfill (corrected scope)

Full disposition of all 122 skills — inference is bounded, exclusion is explicit:

| Segment | Count | Treatment |
|---|---|---|
| Already declared | 44 | **Integrity check only** (no backfill): verify each declared key resolves to an existing `procedures/_shared/<key>/schema.yaml`; flag stale references. Reverse gap also checked: 15 procedures exist vs 13 distinct keys declared — procedures with zero declaring skills reported. |
| Common/platform skills | 22 | Rule-based exclusion (`templates/common/skills` ∪ workspace-root `skills` name sets). Never sent to inference — forced membership would fabricate edges. Recorded as `member_of: none(platform)`. |
| Domain candidates | 56 | LLM two-view proposal (what-it-does / what-it-needs) → candidate pairs scored against the 15 procedure schemas → **diff report for human review** → reviewer marks either a procedure key or an explicit `N/A(platform)` disposition. Exact-name matching only; no fuzzy commits. |

Deliverable: `docs/graph/backfill-report.md` recording per-skill disposition and rationale — N/A verdicts are first-class results, not failures.

## 7. Non-goals and rejected alternatives

| Rejected | Reason |
|---|---|
| Runtime dependency semantics (edges gate execution) | Procedures already own orchestration via `proc:resolve`; duplicating control flow in a second artifact would split the WHAT/WHEN ownership boundary (#3 discipline). All edges remain documentation/audit surfaces. |
| Hand-maintained master graph | Fights the mutability requirement; drifts from SSOTs (ADR-0060 lesson restated). Everything derives; only dispositions (§6) are human-entered, and they live in the skills themselves once accepted. |
| Gate nodes | Gates are crossed, not executed; keeping them as step attributes avoids a seventh node type that would appear in exactly one edge family. |
| Workspace-root implementation first | Root graph scans `templates/`, not `Projects/`; building there would require cross-repo assumptions before the element model is validated. Pilot-local first, generalize after. |

## 8. Risks

1. **Decision-record prose parsing** relies on `Supersedes:/Amends:/anchor` conventions staying consistent; malformed records degrade to missing edges (visible as orphan nodes in the report, never wrong edges).
2. **`consumes` inference from prose** is the weakest extractor; it ships suppressed-by-default and is excluded from `--check` failure conditions until precision is reviewed against pilots 001–010 walkthroughs.
   → **RESOLVED 2026-08-25 (v0.4.0)**: corpus-wide inference yielded exactly ONE edge (`greenfield-dd#4 ← dd_finding`) — a TRUE positive, independently corroborated by the kill-criteria predicate `dd_finding_with_value_impact_not_in_valuation_bridge`. Promoted to default-on; `--no-consumes` opts out.
3. **Registry growth** (kill-criteria extension rounds continue per ADR-0064/0065) increases node counts; generation cost is linear and negligible, but the human catalog needs stable section ordering (alphabetical by id).

## 9. Implementation checklist

1. `scripts/co-newbiz/graph.ts` module (extractors per §1–§3) + `newbiz.ts` `case "graph"` / `case "context"` wiring
2. First emission of `docs/graph/graph.{json,md}`, committed
3. `audit-variant.ts` drift wiring
4. §6 disposition pass → `backfill-report.md` → accepted `procedure_keys` written back into the 56-segment SKILL.md files (one PR)
5. Scenario validation against pilots: antitrust-screening bundle · Screening gate bundle · #13 reversal trace (ADR-0062 → rule #13 → gd-0024 anchor chain)
