---
lang: en
counterpart: gate-integrity-enforce-flip_ko.md
---

# Runbook: Gate-integrity enforce flip (ADR-0186 P5)

Audience: the system owner and operators executing; `compliance-officer` operating the shadow review; `release-engineer` advising on the Docker stack. Governing documents: `docs/adr/0186-gate-integrity.md`, `docs/designs/2026-10-26-gate-integrity-design.md` sections 7, 11 and 13, and the KPIs in `docs/governance/governance-operations.md` section 4.1.

**Agents must not perform any step in this runbook that changes the production environment or restarts the stack.** Changing `.env.prod` and recreating the container on port 7749 is executed by the owner. Agents may read shadow reports and prepare evidence only. The flip decision is a human decision recorded in a decision record per family.

## 1. Families

Each family is controlled by `CO_NEWBIZ_GATE_INTEGRITY_<FAMILY>` with values `off | shadow | enforce`. Production default is `shadow`; a change needs a restart.

| Family | Variable | Rationale and what enforce does | Preconditions (all evidenced) |
|---|---|---|---|
| rationale | `CO_NEWBIZ_GATE_INTEGRITY_RATIONALE` | Rejects placeholder or form-insufficient rationale (422 `rationale_insufficient`), D2. Pure record hygiene. | Denylist reviewed against real recent rationales; zero unexplained `would_block:rationale_insufficient`; UI shows the 422 message clearly. |
| waiver | `CO_NEWBIZ_GATE_INTEGRITY_WAIVER` | Separate approve act, approver differs from requester and holds the matching role, 90-day cap, `not_waivable`, `na` second-person confirmation (D5). | The 26 legacy unconfirmed mandatory `na` rows reviewed by a human (17 on PRJ-DSE4PW, 9 on a soft-deleted project): each either confirmed, reopened or recorded as accepted legacy; no active waiver over 90 days or without `approved_at`; approver roles granted to at least one person other than the usual requesters. |
| ladder | `CO_NEWBIZ_GATE_INTEGRITY_LADDER` | GO at gate N requires GO at N-1 on the track ladder (D7). | Every in-flight project and opportunity checked for a missing predecessor; any known gap (one grandfathered record) is documented; zero unexplained `would_block:gate_sequence`. |
| validators | `CO_NEWBIZ_GATE_INTEGRITY_VALIDATORS` | Brownfield `dd`, `entity_ic`, `group_ic` GO blocked while an applicable core validator is missing (409 `validators_incomplete`); bf-03 certification block at `pre_fs` (D1, D4, O-3). | Every brownfield project at DD or later has the six core validator records (or a documented not-applicable determination); bf-03 state checked for brownfield projects at Pre-FS; zero unexplained would-blocks. |
| wacc | `CO_NEWBIZ_GATE_INTEGRITY_WACC` | `fs` GO blocked unless WACC subject set and `wacc`/`hurdle_irr` are `kind=user`; regression to `assumed` blocks later gates (D8). | Every in-flight project at S8 has a confirmed WACC, or the owner has recorded an accepted provisional state with a named reason; KPI G11 at zero or fully explained; PRJ-DSE4PW handled per its own procedure (`docs/runbooks/prj-dse4pw-reconfirmation.md`). |
| snapshot_ack | `CO_NEWBIZ_GATE_INTEGRITY_SNAPSHOT_ACK` | GO requires `snapshot_hash` and per-item acknowledgements; stale hash returns 409 (D1, 3.10). | Confirm flow exercised by a human end to end (propose, confirm, stale retry); KPI G4 shows acknowledgement rejections acceptable; unassessed share (G5) understood. |
| kill_binding | `CO_NEWBIZ_GATE_INTEGRITY_KILL_BINDING` | A triggered `halt` criterion blocks GO unless a `group-ic-reviewer` override exists (409 `kill_binding_unoverridden`). | A grant holder for `group-ic-reviewer` exists and has issued a test override in a non-production scenario; every `halt` criterion's evidence variable has a TRUE and an UNASSESSED test; G5 shows no halt-class criterion unassessed everywhere. Flip together with `snapshot_ack`. |
| divergence | `CO_NEWBIZ_GATE_INTEGRITY_DIVERGENCE` | A decision that differs from the stored AI recommendation requires a substantive `divergence_reason` (422 `divergence_reason_required`), D9. | KPI G3 shortfall explained; brief persistence (`brief_id`) verified on every gate path including MCP. |
| maker_checker | `CO_NEWBIZ_GATE_INTEGRITY_MAKER_CHECKER` | IC GO is `pending_countersign` until a different human with the matching role countersigns (D6, O-1). | `GET /api/admin/human-roles/readiness` shows at least 2 distinct holders for each of `entity-ic-reviewer` and `group-ic-reviewer`; the two holders have each done a countersign in a rehearsal; the owner has told the second person what is expected of them; no pending IC decisions are stranded (G7). |

## 2. Shadow-report acceptance criterion

A family may flip when all hold:

1. It has run in `shadow` for at least 14 consecutive days, **and** at least 10 relevant gate writes (or a documented walk-through of every code path with fixtures) were observed, so a quiet system does not pass by being unused.
2. Weekly review by `compliance-officer` of `gate_integrity.would_block:<code>` events for the family shows **zero unexplained would-blocks over those 14 days**. Produce the review input with the shadow report: `bun scripts/co-newbiz/gate-integrity-shadow-report.ts [--days 14] [--json] [--db-path <path>]` (read-only; it lists would-block events per family and the gate-write volume that supports the 10-write minimum). "Explained" means each event is attributed to a fixture, a known legacy record, or a defect already fixed, and recorded as such.
3. All family preconditions in section 1 are evidenced by pointer (query, screenshot, readiness output), not memory.
4. A decision record names the family, the evidence and the date; the owner approves it.

Process-governance-manager's reading of this criterion is a proposal to the owner, not the decision.

## 3. Recommended flip order

Per design section 7, with rationale:

1. **rationale** - mechanical, no deal judgement, lowest regret.
2. **waiver** - closes the self-approval gap; needs the legacy `na` review first.
3. **ladder** - enforces an existing policy clause; data shows it is already followed.
4. **validators** - binding by policy; needs the brownfield validator records complete.
5. **wacc** - binding by policy; needs S8 WACC sessions held.
6. **snapshot_ack and kill_binding** (together) - the acknowledgement contract and halt binding only make sense jointly; highest user-visible change, so after the simpler blocks have stabilized.
7. **divergence** - depends on briefs being persisted and on users knowing the acknowledgement flow.
8. **maker_checker** - last because it depends on a second human being provisioned (O-1) and changes who can make a GO effective.

Flip one family at a time with at least 3 business days between flips, so a new block is attributable.

## 4. Steps on the Docker production stack (port 7749) - owner executes

Do not run any of this as an agent. Reference: `docs/runbooks/deployment.md` (container reads `.env.prod`, not the root `.env`; changes apply only after a force recreate).

1. Confirm the acceptance evidence and the decision record exist. Announce the change window (section 7).
2. Take a backup per `docs/runbooks/backup-restore.md` and note the time.
3. Edit the host-local `.env.prod` (gitignored): set `CO_NEWBIZ_GATE_INTEGRITY_<FAMILY>=enforce` for exactly one family. Keep the others unchanged.
4. Apply: `docker compose up -d --force-recreate` from the repository directory. Do not stop or touch the dev server on 7748 for this.
5. Check health: `curl -s http://127.0.0.1:7749/api/health` returns `{"status":"ok"}`.

## 5. Verification after the flip

- The settings or health surface (or startup log) reports the family as `enforce`; confirm that and the other families' unchanged values.
- Perform one **negative test** that should now be refused, on a scratch or demo project (for example a placeholder rationale for `rationale`; a self-countersign for `maker_checker`) and confirm the expected code (422/409/403). Then perform one **positive test** that succeeds.
- Over the next 5 business days compliance-officer reviews KPIs G1, G4, G6 and G7. Any unexplained refusal of a legitimate action is a rollback trigger.

## 6. Rollback

Set the family back to `shadow` (or `off` if the check itself misbehaves) in `.env.prod`, run `docker compose up -d --force-recreate`, confirm health, and record the reason. The schema is additive, so no migration rollback is needed for behavior. Existing rows are never rewritten by a flip or a rollback. After rollback the family returns to the acceptance criterion in section 2 with the counter reset.

## 7. Communication to users

Before the flip (at least 2 business days): short notice naming the family, what will now be refused, the exact error the user would see and what to do instead, the date and time of the restart (the app is unavailable briefly), and who to contact. After the flip: confirmation, and for `maker_checker` a list of the people now holding each role. State plainly that the system still does not make decisions: it refuses incomplete records and requires acknowledgements; every GO remains a human decision.

## 8. Demo data

Demo projects are reseeded through the gate contract (snapshots, acknowledgements, countersign) with `bun scripts/co-newbiz/seed-s1-s12-demo.ts --db-path <path>`. This is for the dev database only; never run it against production without a backup (`docs/runbooks/backup-restore.md`) and the owner's approval. Use the reseeded demo project for the negative and positive tests in section 5.
