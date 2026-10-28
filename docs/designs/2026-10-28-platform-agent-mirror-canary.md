# Design: Platform Agent-Mirror Canary Adoption (co-newbiz)

> Local adoption record for the workspace-root spec
> `2026-10-28-platform-agent-mirror-design` (DEC-20261028-06). This project is
> the orphan canary per §6 step 4 — no living template (ADR-0102 §8.4), so the
> capability is installed manually instead of via upgrade delivery.

## Scope

- `scripts/sync-agent-mirrors.ts` v1.1.0 installed (template-managed generator; the wave delivers it to templated projects).
- `platform_surfaces` registry block added to `docs/workspace-schema.json` (byte-copy of the L1/L0 block).
- Generator write-once over `.claude/agents/` (41 mirrors, fleet-unique tree): registry-resolved frontmatter + GENERATED provenance marker; provenance manifest adopted on first run (removals disabled; unknown files untouched). `--check` green: 41 in parity (0 missing / 0 extra-managed / 0 differing).

## Disposition

- Persona-projection half of the local `scripts/co-newbiz/sync-agent-personas.ts` is superseded; its retirement (keeping the ADR-0153 `domain:` half, Q4) is this project's disposition.
- SSOT `agents/*.md` `model:` WARN-and-ignore is active until the §4.4 sweep reaches this orphan project.

## Accessibility statement

Non-UI tooling — ADR-0065 exemption (governance/developer workflow only).
