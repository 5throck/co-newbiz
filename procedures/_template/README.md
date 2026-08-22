# Procedure Template

Copy `schema.yaml` from this directory when creating a new procedure. Fill every `TODO`.

## Rules (design §6.3, §6.8 — do not violate these when authoring a new procedure)

1. **A shared procedure lists `steps:` directly.** An entity or region procedure that consumes a shared one uses `references:` and only declares `overrides:` — it never copies the shared steps.
2. **`steps` is structured data** (`agent_key`, `skill_key`, `output_type`), not prose. Dispatch code reads this list directly (meeting M7-3 D-M7-3-1).
3. **A procedure owns what/when.** It never describes *how* an agent does its work — that's the referenced skill's job. If you find yourself writing technique or judgment guidance into a procedure step, it belongs in a skill instead.
4. **`legal_basis` requires at least one real reference** (policy clause, design section, meeting decision) — not a placeholder.
5. **Register `kill_criteria` explicitly**, even as an empty list, so the field's absence never gets mistaken for "not yet decided."
6. **Every `output_type` must be a key of `procedures/_output-types.yaml`** (closed vocabulary, ADR-0053 §4). An unregistered value is an `_validate.ts` error; adding a new deliverable type = a registry entry in the same change. A registry entry no step uses warns as dead vocabulary.
7. **A step whose output binds on human authority carries `decision_authority: human`** (ADR-0053). Two legal shapes only:
   - **Human-role key** — `agent_key` names a role listed in `procedures/_human-roles.yaml`; no `agents/<key>.md` may exist for it (the registry entry earns the exemption from the agents-file checks). Extending the registry = same-change entry, never by accident.
   - **Recorder key** — an AI agent (`agents/<key>.md` exists) records a human committee's decision (e.g. PGM recording `group_ic_decision`); the marker documents that the authority is the committee, not the agent.
   The value must be the literal `human` — anything else is an `_validate.ts` error. A registry key used without the marker, or a registry key that also has an agent file, is a `graph-map.ts --check` error.
