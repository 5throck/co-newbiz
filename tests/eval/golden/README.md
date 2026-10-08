# Golden Dataset (Wave B-2)

Versioned expected answers for the AI evaluation harness (`bun run eval`). Design of record: `docs/designs/2026-10-08-wave-b-ai-eval-design.md` §3.

The dataset is built only from public facts already written in `docs/pilots/`. It has no new research and no invented numbers. Eval scores are evidence for people to read. They are not a pass stamp.

## Layout

| Path | Purpose |
|---|---|
| `VERSION` | Semver. Bump it on any expectation change. |
| `schema.ts` | Zod schema. This is the only source for the file format, the leakage keyword list (`LEAKAGE_KEYWORDS`) and `findLeakage()`. |
| `cases/pilot-0NN.yaml` | One case per pilot. |
| `fixtures/pilot-0NN.input.json` | Facts known **before** the decision (leakage-linted). |
| `fixtures/pilot-0NN.post-decision.json` | Optional. Facts that include the regulator's decision (not linted, never calibrated). |
| `CHANGELOG.md` | The reason for each expectation change, with a pilot-doc citation. |

## Case fields

| Field | Meaning |
|---|---|
| `case_id` | `pilot-0NN`. |
| `golden_version` | The dataset version this case was written for. |
| `source_doc` | The pilot doc the case is derived from. |
| `deal_type` / `case_subtype` | `brownfield`, `greenfield`, `intra_group_restructuring` or `group_capital_allocation`. R&BD cases are `brownfield` + `case_subtype: rbd`. |
| `public_outcome` | Present **only** on the outcome-labelled set (003, 008, 009, 010). It has `favourable` per design §7: closed/approved, including conditional approval, is favourable. Prohibited/abandoned/suspended is unfavourable. If it is absent, the case is excluded from outcome calibration. This holds even if the pilot doc mentions an outcome (001, 002). |
| `inputs_ref` | Pre-decision fixture. |
| `post_decision_inputs_ref` | Optional post-decision fixture. |
| `expectations[]` | See below. |

Each expectation has these fields:

- `stage`: S1–S12 per `process/flow.spec.yaml`.
- `gate`: `screening`, `pre_fs`, `fs`, `dd`, `entity_ic` or `group_ic`.
- `function`: the expectation type.
- `expected`: the type-specific payload.
- `input_basis`: `pre_decision` (default) or `post_decision`.
- `citation`: one or more `{ doc, section }`. `section` is the exact heading text of a `##`/`###` heading in that doc. The loader rejects an expectation that has no citation.
- `tolerance`: used by `rag_dimensions` only. The value is `exact` or `one_grade`.
- `note`: optional.

### Expectation types

| `function` | `expected` payload | Scored as |
|---|---|---|
| `antitrust_flags` | `filing_required`, `jurisdictions`, `multi_jurisdiction`, `combination_type`, `product_overlap`, `hhi_flag`, `certain_block`, `relevant_markets` (all optional; only stated flags are scored) | flag accuracy |
| `rag_dimensions` | Any of the six dimensions, each `green`/`amber`/`red`/`not_graded` | exact / within one grade |
| `rag_overall` | `overall` + `complete` | exact |
| `kill_criteria` | `hits` (exact procedure condition keys) and optional `not_evaluable` | set precision / recall |
| `confidence_cap` | `cap_applies` + `data_confidence` | exact |
| `dd_tailoring` | `checklist`, `required_items` (must be retained, 100%), optional `droppable_with_reason` | retention rate |
| `review_findings` | `must_raise` (finding keys) + `must_declare_could_not_verify` | recall by key; no LLM judge |

`not_graded` is a real expected value, not a gap. Under `docs/governance/rag-framework.md` an incomplete assessment produces no overall grade. Pilot 001 and its system re-run set this precedent. A system that defaults a missing dimension to Amber fails the case. The one exception is a Red dimension or a Kill Criteria hit, which forces `overall: red` even when the assessment is incomplete (pilot 010).

## Leakage rule

Public outcomes are likely in model training data. Leakage *inside our own inputs* is avoidable, and we do not allow it:

1. `inputs_ref` contains only facts dated before the decision. It never contains the decision, the remedy or the deal's eventual status.
2. The loader runs `findLeakage()` on every pre-decision fixture. It fails if any `LEAKAGE_KEYWORDS` stem appears, such as `approv`, `prohibit`, `block`, `suspend`, `closed`, `complet`, `divest`, `remed`, `condition` or `withdr`. Write neutral wording instead. For example, write "boards ended the agreement", not "withdrew".
3. Some expectations can only be derived from the decision itself, for example a Regulatory/Permit grade for a behavioral remedy. These use `input_basis: post_decision` and read `post_decision_inputs_ref`. Such expectations test grading rules only. They are **never** used for outcome calibration (design §7).
4. Training-data contamination cannot be removed this way. Scoreboards must state it as a limitation.

## Authoring rules

- An expectation needs a citation. Use only facts already in the pilot doc.
- Changing an expectation requires a `VERSION` bump, a `CHANGELOG.md` entry, and a second-domain review per the cross-validation matrix.
- Add outcome labels only when the pilot doc states a public outcome *and* the label set is extended under design §3.3.
