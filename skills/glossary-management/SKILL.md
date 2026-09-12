---
name: glossary-management
scope: co-newbiz
description: >
  Authors and maintains `glossary/*.yaml` terms and absorbs the lint step
  (design §9.2 merge — linting is a means of managing the glossary, not a
  distinct product). Every term requires `why_it_matters_ko` — a project-
  specific rationale, not a textbook definition — enforced by
  `glossary/_validate.ts`. Terms surface across four tooling integrations
  (ADR-0022): the UI tooltip, MCP `lookup_term`, the report-appendix
  generator, and this authoring skill itself.

  Use when: "add a glossary term", "glossary lint", "undefined term",
  "glossary management", "why_it_matters_ko".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: glossary-curator
prerequisites: none
metadata:
  type: process
  triggers:
    - add a glossary term
    - glossary lint
    - undefined term
    - glossary management
    - why_it_matters_ko
---

## Context

`glossary/_schema.yaml` fixes the required fields per term: `ko`, `en`,
`definition_ko`, `why_it_matters_ko`, `category`
(`business`/`financial`/`legal`/`technical`/`unit`/`industry`), `owner`.
`why_it_matters_ko` is mandatory specifically because a definition alone
leaves a newcomer asking "so what" — this is the field reviewers should
scrutinize hardest, not treat as boilerplate. The four consuming surfaces
(ADR-0022) all read the same YAML files — a term added here is
automatically available everywhere, and a term missing here breaks all four
at once, not just one.

## When to Use

- A new domain term needs defining before it appears in a deliverable, UI
  copy, or agent output
- `glossary:lint` (`bun glossary/_validate.ts`) flags an undefined-term
  reference or a schema violation
- Reviewing whether an existing term's `why_it_matters_ko` has gone stale

## Execution Steps

1. **Check for an existing term first** — search `glossary/*.yaml` (via
   `lookup_term` or a direct grep) before adding a duplicate under a
   slightly different key
2. **Choose the right category file**: `business.yaml`, `financial.yaml`,
   `legal.yaml`, `technical.yaml`, or `industry.yaml` per the term's
   `category` field
3. **Write all required fields**: `ko`/`en` (both required, code and
   agent/skill files use `en`, deliverables and UI use `ko`),
   `definition_ko` (plain-language), `why_it_matters_ko` (project-specific
   — why does THIS term matter for THIS team's work, not what it means in
   general), `category`, `owner`. Optional: `aliases`, `related`, `used_in`
4. **Validate**: `bun glossary/_validate.ts` (`glossary:lint`) — catches a
   missing required field, an invalid `category` enum value, or (per the
   design's lint scope) a term referenced in a deliverable but not defined
5. **Confirm all four surfaces resolve**: the web UI's dashed-underline
   tooltip (`GlossaryTerm` component, `GET /api/glossary/:term`), the MCP
   `lookup_term` tool, the report-appendix generator
   (`python/report/glossary_appendix.py`), and this authoring file itself —
   a term visible in one but not another means a cache or lookup path is stale

## Output Format

- New or amended `glossary/<category>.yaml` entry, passing `glossary:lint`

## Related Skills

- `insight-synthesis`, `sample-driven-report-writing` — consumers of defined terms in narrative output
- `ui-information-architecture` — the tooltip surface this glossary backs
