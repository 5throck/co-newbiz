# Agent Governance Record — i18n-specialist

## Overview

- **Agent Name**: i18n-specialist
- **Formal Name**: I18N Specialist Agent
- **Role**: Locale configuration (BCP 47), locale-specific formatting, text layout guidance, and the i18n audit suite across all four domains
- **Phase**: production
- **Domain**: _shared
- **Tier**: medium

## Scope

Owns locale configuration, locale-specific formatting, text layout guidance, and the i18n audit suite. Belongs to no single domain since internationalization is a cross-cutting concern.

## Phase History

- **2026-08-24**: Initial release. Added to `_shared` alongside docs-writer to cover cross-domain i18n concerns.
- **2026-10-25**: Template 0.20.1 delivery — frontmatter field order normalized (`domain` ahead of `status`; the domain value stays `_shared`; commit a2285742).
- **2026-11-08**: Template 0.30.0 upgrade — version 1.3.2, `last_reviewed` 2026-11-06, the routing-trigger table's hwp pointer dropped from the `i18n-layout` row (commit ab68da4d).
- **2026-11-10**: Meeting-participation sweep — the stale `/meeting` slash-command boilerplate in the Meeting Participation section renamed to the `meeting-facilitation` skill (workspace-root PR #1950 sweep; commit e9cf3cf1).

## Acceptance Criteria

- [x] Defined in `agents/i18n-specialist.md`
- [x] Carries `lifecycle` frontmatter with `phase` and `governance`
- [x] Validated by `scripts/validate-agents.ts`
- [x] Registered in `AGENTS.md` roster
- [ ] Exercised in a Stage 1 planning meeting

## References

- Design of record: [`docs/designs/2026-08-19-co-newbiz-design_ko.md`](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md) section 5
