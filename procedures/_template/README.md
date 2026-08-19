# Procedure Template

Copy `schema.yaml` from this directory when creating a new procedure. Fill every `TODO`.

## Rules (design §6.3, §6.8 — do not violate these when authoring a new procedure)

1. **A shared procedure lists `steps:` directly.** An entity or region procedure that consumes a shared one uses `references:` and only declares `overrides:` — it never copies the shared steps.
2. **`steps` is structured data** (`agent_key`, `skill_key`, `output_type`), not prose. Dispatch code reads this list directly (meeting M7-3 D-M7-3-1).
3. **A procedure owns what/when.** It never describes *how* an agent does its work — that's the referenced skill's job. If you find yourself writing technique or judgment guidance into a procedure step, it belongs in a skill instead.
4. **`legal_basis` requires at least one real reference** (policy clause, design section, meeting decision) — not a placeholder.
5. **Register `kill_criteria` explicitly**, even as an empty list, so the field's absence never gets mistaken for "not yet decided."
