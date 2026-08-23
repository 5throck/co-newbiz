# agents/

Agent definition files for the co-newbiz new-business-review team. The canonical roster
(counts, domains, tier assignments) is [`AGENTS.md`](../AGENTS.md) — this README explains
the structure and the dispatch model; it deliberately does not duplicate the roster.

## File structure

Every agent file follows the 3-Section structure:

1. **Legal Basis** — authority/regulatory grounding for the role
2. **Role** — responsibilities and scope
3. **Protocols** — operating procedures and dispatch rules

Register every agent in `AGENTS.md` and verify with `bun run agent:verify`.

## Agent classes (readiness audit 2026-08-23)

34 agents in four classes — the classes, not the individual names, are the stable contract:

| Class | Count | Dispatch behavior |
|---|---|---|
| Domain leads | 4 | Design/review owners under the New Business Review Lead (functional `process-governance-manager`, technical `platform-lead`, industry `industry-lead`, region `region-lead`). Leads other than PGM are **not dispatched as procedure steps by design** — industry/region input enters via `industry-profiles/` / `region-profiles/` and lead consultation. (`process-governance-manager` IS dispatched — ×16 steps; `region-lead` ×1 via the EU override) |
| Deal-review specialists | ~21 | Dispatched via `agent_key` in procedure steps (85 AI steps across 15 shared procedures + override layers). This is the class the readiness audit found **complete** — no deal-review agent is undispatched |
| Build/run | 8 | `data-architect`, `dba`, `backend-engineer`, `frontend-engineer`, `release-engineer`, `sre`, `infra-automation-engineer`, `security-engineer`. Dormant until a runtime-hardening round activates `app/server` / `app/web` work |
| Non-deal support | 2 | `glossary-curator`, `docs-writer` — governance/documentation, outside deal review |

## Human roles are NOT agent files

Gate approval and investment decisions belong to humans (non-negotiable boundary #2).
Human authorities are registered in [`procedures/_human-roles.yaml`](../procedures/_human-roles.yaml)
— currently `entity-ic-reviewer`, `bau-exit-certifier`, `venture-portfolio-ic`. Do not create
agent files for them; the skill-graph test pins the four human-authority steps.

## Dispatch model

Agents are dispatched by the PM through procedure steps (`agent_key` + `skill_key` +
`output_type` per step) — never ad hoc. What/when lives in `procedures/**/schema.yaml`;
how lives in `skills/`. See [`docs/audits/2026-08-23-readiness-audit.md`](../docs/audits/2026-08-23-readiness-audit.md)
§3.2 for the full dispatch/zero-dispatch analysis.

## Lifecycle rules

Modifying anything under `agents/**` requires: update the `AGENTS.md` roster, verify domain
counts, regenerate/verify READMEs (`bun run agent:verify`, `bun run validate-agents`), per
the Co Newbiz lifecycle rules in [`docs/context.md`](../docs/context.md).
