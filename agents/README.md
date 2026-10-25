# agents/

Agent definition files for the co-newbiz new-business-review team. The canonical roster
(counts, domains, tier assignments) is [`AGENTS.md`](../AGENTS.md) — this README explains
the structure and the dispatch model; it deliberately does not duplicate the roster.

## File structure

Every agent file follows the canonical 9-section body standard (design
[`docs/designs/2026-10-25-agent-and-context-ssot-upgrade-design.md`](../docs/designs/2026-10-25-agent-and-context-ssot-upgrade-design.md)),
in order:

1. **Legal Basis** — authority/regulatory grounding, ending with a **Boundary** paragraph naming sibling-agent ownership
2. **Role**
3. **Responsibilities** — bold-labeled bullets tied to flow.spec activities / procedure steps
4. **Protocols** — four fixed H3 subsections: `⚠️ PM-ONLY INVOCATION` (verbatim 3-step refusal script, identical in every file), `Dispatch Protocol` (Can Lead Stages / Can Support In / Auto-Dispatch To / Requires Prior Output From / Tier / Communication Style), `Output Format`, `Output Destination` (SSOT blockquote pointing to the stage outputs declared in `process/flow.spec.yaml` and `docs/co-newbiz.context.md`)
5. **Constraints** — Do-NOT bullets with the correct redirect
6. **Meeting Participation** — Voice & Stance / In every turn you MUST / You do NOT
7. **Engagement Context** — stage entry/exit, re-engagement triggers, true engagement mode
8. **Deliverable Standards**
9. **Special Instructions**

Frontmatter contract: the identity keys (`name`, `formal_name`, `status`, `domain`, `tier` across the four platforms, `model`, the `lifecycle` block) plus the rewrite additions — `role` (one line), `color`, `description` enriched with "Use when:" dispatch triggers, `examples`, `phases`, `handoff_to` / `handoff_from` (existing non-deprecated agent names only; the human roles of `procedures/_human-roles.yaml` are forbidden targets), and `required_skills`. Length bands: domain leads 170–200 lines, specialists 140–170 lines.

Register every agent in `AGENTS.md` and verify with `bun run agent:verify`.

## Agent classes (readiness audit 2026-08-23; expanded 2026-09-04)

41 agents — four classes plus two outside them (`pm`, the coordinator itself, and the shared `i18n-specialist`); the classes, not the individual names, are the stable contract:

| Class | Count | Dispatch behavior |
|---|---|---|
| Domain leads | 4 | Design/review owners under the New Business Review Lead (functional `process-governance-manager`, technical `platform-lead`, industry `industry-lead`, region `region-lead`). Leads other than PGM are **not dispatched as procedure steps by design** — industry/region input enters via `industry-profiles/` / `region-profiles/` and lead consultation. (`process-governance-manager` IS dispatched — ×16 steps; `region-lead` ×1 via the EU override) |
| Deal-review specialists | ~25 | Dispatched via `agent_key` in procedure steps (85 AI steps across 15 shared procedures + override layers). Includes the six standing functional-expert seats of the ADR-0097 committees added 2026-09-04 (`financing-agent`, `site-facility-agent`, `legal-counsel`, `hr-integration-agent`, `ir-agent`, `ip-agent`); the two technical design seats (`design-system-agent`, `ux-designer-agent`) are PM-dispatched design work in build/run rounds, with no `agent_key` steps. This is the class the readiness audit found **complete** — no deal-review agent is undispatched |
| Build/run | 8 | `data-architect`, `dba`, `backend-engineer`, `frontend-engineer`, `release-engineer`, `sre`, `infra-automation-engineer`, `security-engineer`. Dormant until a runtime-hardening round activates `app/web-next` / `scripts/` work |
| Non-deal support | 2 | `glossary-curator`, `docs-writer` — governance/documentation, outside deal review |

## Human roles are NOT agent files

Gate approval and investment decisions belong to humans (non-negotiable boundary #2).
Human authorities are registered in [`procedures/_human-roles.yaml`](../procedures/_human-roles.yaml)
— currently `entity-ic-reviewer`, `bau-exit-certifier`, `venture-portfolio-ic`,
`execution-baseline-confirmer`. Do not create
agent files for them; the skill-graph test pins the four human-authority steps.

## Dispatch model

Agents are dispatched by the PM through procedure steps (`agent_key` + `skill_key` +
`output_type` per step) — never ad hoc. What/when lives in `procedures/**/schema.yaml`;
how lives in `skills/`. See [`docs/audits/2026-08-23-readiness-audit.md`](../docs/audits/2026-08-23-readiness-audit.md)
§3.2 for the full dispatch/zero-dispatch analysis. Handoff edges are informational: `handoff_to`
names where this agent's primary output flows next, `handoff_from` names whose output it requires —
PM mediates all dispatch, so not every procedural touch needs an edge.

## Lifecycle rules

Modifying anything under `agents/**` requires: update the `AGENTS.md` roster, verify domain
counts, regenerate/verify READMEs (`bun run agent:verify`, `bun run validate-agents`), per
the Co Newbiz lifecycle rules in [`docs/context.md`](../docs/context.md).
