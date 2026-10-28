---
lang: en
counterpart: prj-dse4pw-reconfirmation_ko.md
---

# Procedure: PRJ-DSE4PW re-confirmation before new use (ADR-0186 owner decision O-6)

Owner: `process-governance-manager` (procedure); `quant-methodologist` supports the WACC session; every decision step is a human act. Scope: project PRJ-DSE4PW (greenfield). Its recorded history (`fs`, `dd`, `entity_ic`, `group_ic` GO by a single user, 17 mandatory `na` rows, no WACC assumption) **stays legacy and is never rewritten**; this procedure only governs *new* use.

## What counts as new use

Any of: a new gate decision (including a re-decision) on the project; generating a new gate brief; proposing or adopting a case; new IC package generation presented as current; moving the project into S11 establishment.

## Steps (all by humans; agents may prepare evidence)

1. **WACC session.** A person with analyst role or higher holds a WACC input session (skill `wacc-input-session`, quant-methodologist preparing inputs). Outcome: `md_project.wacc_subject` set with rationale and decider, and `wacc` and `hurdle_irr` assumptions saved as `kind=user` (the system's `fin.wacc_source_status` reads `sourced`). Agent-assumed values do not count.
2. **Review of the 17 legacy `na` rows.** A person other than the original entrant reviews each row: confirm (with substantive reason), reopen to pending, or record as accepted legacy with a reason. The second-person confirmation fields (`na_confirmed_by`, `na_confirmed_at`) are the evidence.
3. **IC countersign.** A person holding `entity-ic-reviewer` (and `group-ic-reviewer` for the group level) who is **not** the recorder of the original IC decisions countersigns, through the approval chain. This needs the O-1 provisioning (at least two grant holders).
4. **Clear the requirement.** Once steps 1 to 3 are evidenced, an eligible person clears the marker with a reason; the clearance is audited (who, when, why). Eligibility is defined below.

## Opening the requirement (owner or dba)

Back up first (ADR-0014; see `docs/runbooks/backup-restore.md`). Then run a dry run, review the output, and apply:

```
bun scripts/co-newbiz/reconfirm-requirement.ts --project PRJ-DSE4PW --by <admin-user>
bun scripts/co-newbiz/reconfirm-requirement.ts --project PRJ-DSE4PW --by <admin-user> --apply
```

`--project` accepts either the human project number (`PRJ-DSE4PW`) or the internal `md_project.id`; the output prints the resolved mapping. Optional flags: `--items`, `--reason`, `--db-path`. Equivalent over the API: `POST /api/projects/PRJ-DSE4PW/reconfirm` (administrator). Only one open requirement per project exists (a second attempt returns 409 `reconfirm_exists`). Agents may prepare the evidence but never run `--apply` on production.

## How the system marks, blocks and clears it (implemented behaviour)

- The project carries a **reconfirmation-required marker** while any of three items is unmet: `wacc_confirmed` (WACC subject unset or not `kind=user`), `na_review` (unconfirmed legacy `na` rows), `ic_countersign` (no effective countersign on its IC decisions).
- A visible notice reads "Legacy record: reconfirmation required before new use", listing the unmet items. Items clear automatically in the data when satisfied; the marker itself does not self-clear.
- **Clearing** is a human act with these conditions, all enforced by the system:
  - the clearer holds an active `entity-ic-reviewer` or `group-ic-reviewer` grant (otherwise 403 `human_role_required`);
  - a cookie session is used (no token or agent-service path);
  - the reason meets the acknowledgement rationale profile (otherwise 422 `rationale_insufficient`);
  - all items are satisfied (otherwise 409 `reconfirm_items_unmet`);
  - the clearer is not the recorder of any of the project's IC decisions (`entity_ic` or `group_ic`; otherwise 403 `reconfirm_clearer_is_maker`).

## Decision: warn vs block (implemented)

- **Block** (409 `reconfirmation_required`, naming the unmet items) for **new GO decisions** and **business-case adoption** on that project. Reason: ADR-0186 O-6 requires confirmation before the record is used for anything new, and these actions create new binding records or commit the deal direction.
  - **HOLD and KILL are never blocked** (ADR-0186 principle 5): stopping or pausing a deal must always remain possible.
  - **Exception:** an Entity IC or Group IC GO is allowed when `ic_countersign` is the **only** unmet item. The legacy GOs cannot be countersigned, so the re-decision is the only route to a countersignable record; the new GO is **not effective until a different eligible person countersigns it**.
- **Warn** (non-blocking `reconfirmation` notice in the response, no refusal) for read and preparation actions: viewing, generating a gate brief, and generating the IC package. Reason: the reviewers need this information to carry out the re-confirmation. Generated briefs carry the legacy and provisional-discount-rate labels.
- Boundary 2 holds: the marker never decides anything; it only refuses or labels, and only people clear it.
- The project marker is enforced regardless of the family flags in `gate-integrity-enforce-flip.md`, because it is a project-specific owner decision (ADR-0186 O-6), not a family rule.
