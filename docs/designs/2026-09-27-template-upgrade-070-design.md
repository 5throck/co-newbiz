# Design: Template upgrade to 0.7.0 + COMMON-HERMES activation (2026-09-27 resync)

- **Spec ID**: 2026-09-27-template-upgrade-070
- **Date**: 2026-09-27
- **Status**: implemented
- **Source**: manual (backfill recorded 2026-09-28; the upgrade round landed 2026-09-27 as PRs #418–#420)

## Problem

The project pinned template 0.6.x while the workspace shipped v0.7.0 (auto-release
2026-09-27). The upgrade round ran as three PRs and no design record was registered for
the round, so the Design Gate file trail (ADR-0074) is missing its spec activity. The
round also exposed a delivery gap: the first two syncs could not deliver `Hermes.md`
because the L0 merge engine had no COMMON-HERMES marker pattern yet.

## Decision

Upgrade through the workspace-side tooling (`upgrade-project`, ADR-0073 coverage
policy), in three landings:

1. **PR #418 — template sync v0.7.0** (385 files, +27,286/−15,066): skill catalog
   refresh across the platform mirrors (`.hermes/skills` ×155, `.codex/skills` ×49,
   `.claude/skills` ×46, `.gemini/skills` ×45, `.agents/skills` ×45), three governance
   docs, two project skills (`design-foundation`, `meeting-facilitation`),
   `skills/SKILLS.md`, and the validator set (`validate-templates`,
   `validate-docs-links`, `verify-platform-lifecycle`, `verify-readme-sync`,
   `verify-scripts`).
2. **PR #419 — post-v0.7.0 tail** (scripts, registries, schema): `scripts/audit.ts`,
   `scripts/helpers/upgrade-versions.ts`, `scripts/lib/upgrade-policy.ts`,
   `scripts/validate-md-language.ts`, `docs/skill-graph.json` + `.md`,
   `docs/workspace-schema.json`, `scripts/SCRIPTS.md`, `docs/VERSION_MANIFEST.md`,
   `CODEX.md`. Session note at this point: `Hermes.md` (workspace ADR-0093) not yet
   delivered — the L0 merge engine lacked the COMMON-HERMES marker pattern.
3. **PR #420 — COMMON-HERMES activation**: after the L0 fix (managed-block-merge 1.3.0,
   workspace PR #1129), a re-run delivers `Hermes.md` (120 lines). Final state:
   `.claude/template-version.txt` at `version=0.7.0` (platform `all`, country `KR`,
   upgraded 2026-09-27).

Record-keeping note: the COMMON-HERMES decision itself is workspace ADR-0093. This
project carries the delivered artifact and does not duplicate the ADR (one decision,
one record).

## Accessibility

Non-UI infrastructure change — no accessibility impact (explicit statement per
ADR-0065).

## Preview Verification

Non-UI change — no rendered-preview verification required (explicit statement per
ADR-0070).

## Verification

- `bun scripts/audit.ts` — green at each of the three PRs (reported in the upgrade
  session logs, `memory/2026-09-27.md`).
- `bun scripts/verify-scripts.ts --verify` — clean post-upgrade.
- App code untouched by the round: skill mirrors, validators, and registries only.
