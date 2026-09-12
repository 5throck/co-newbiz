# UX Designer Agent Creation — Design

- **Spec ID**: 2026-09-12-ux-designer-agent-design
- **Date**: 2026-09-12
- **Status**: implemented
- **Scope**: agent roster — `agents/ux-designer-agent.md`, governance record, `AGENTS.md` registration

## 1. Problem

The 2026-09-12 usability review of the web surface found a systematic design
gap: screens presented analysis results without the search/registration (CRUD)
surfaces users need, and stage screens did not express how work flows from the
previous stage into the next (most visibly S6/S7 Long-List discovery and
Short-List derivation). The roster had a design-system GOVERNOR
(design-system-agent) and an IMPLEMENTER (frontend-engineer) but no design
OWNER to hold screen-design responsibility and apply a consistent methodology.

## 2. Decision

Create `ux-designer-agent` (technical/design, tier medium, PM-dispatched) as
the screen-design owner. Its definition encodes:

### 2.1 Design doctrine (binding sources of truth)

All design work is grounded top-down in the existing documentation hierarchy:
`design-philosophy.md` (gov-des-00 philosophy) → `design-guide.md` P1–P6 plus
ADR-0083/0086/0119/0121 (principles) → `design-guide.md`/`design-tokens.md` +
`design-tokens.json`/`design-accessibility.md` (guides) →
`design-components.md` + the real `components/` inventory (key components —
reuse first, invention is a violation) → `design-screens.md` P0–P5 + the
standard-screen-patterns design + `DESIGN-CHECKLIST.md` (standard screens).
Design docs state the ADR-0087 order and checklist items (pattern, tokens and
components consumed, CRUD conformance, icon registration).

### 2.2 External conventions adopted

- awesome-copilot `se-ux-ui-designer.agent.md`: discovery-first workflow
  (JTBD before pixels), named deliverables, explicit escalation list,
  measurable success criteria in the handoff.
- Figma design agent: generate strictly WITHIN the existing design system —
  no invented components; new tokens/patterns escalate via
  design-system-agent + ADR procedure.
- Design-handoff checklists (Storyflow/Supernova): accessibility (WCAG AA,
  both themes, keyboard order, labels, no color-only, ≤880px responsive
  minimum) is embedded in the design, not retrofitted; specs carry reasoning.

### 2.3 Role boundaries (reviewed in a five-perspective session)

PM, design-system-agent, frontend-engineer, process governance, and a
deal-practitioner perspective reviewed the draft (2026-09-12 session notes).
Decisions incorporated: the three-way boundary (ux-designer designs /
design-system-agent verifies / frontend-engineer implements, connected by the
three-stage review), a prohibition on direct `styles.css`/token-registry
edits, standard personas (deal analyst / IC reviewer / operator), a dispatch
scope with the feedback collect→revise→re-propose loop, and a design
acceptance checklist (search+registration on every list; input←output linkage
on every stage screen; one primary action per screen; no results-only screens;
designs must reference real API/data contracts).

## 3. Changes

- `agents/ux-designer-agent.md` — new agent definition (frontmatter per
  roster convention + doctrine/boundaries/workflow/acceptance/dispatch/
  escalation/collaboration/deliverables sections)
- `docs/lifecycle/agents/ux-designer-agent.md` — governance record
- `AGENTS.md` — technical domain row added (10→11), roster total 40→41
- `.claude/agents/ux-designer-agent.md` — regenerated via
  `sync-agent-personas.ts` (generated copy)

## 4. Verification

- `bun run agent:verify` — 41 agents, 0 orphans, documentation in sync
- `bun scripts/validate-md-language.ts` — English-only gate passes
- skill graph regenerated if the new agent's required skills change the graph
