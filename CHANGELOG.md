# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- **[2026-08-19]**: Initial L3 scaffold for the co-newbiz variant, created from `templates/common` via `create-l3-scaffold.ts --domain consulting` (219 files: common overlay, scripts, skills, `.claude/` and `.gemini/` platform configs, deliverables layout).
- **[2026-08-19]**: `## Co Newbiz Context` section in `CLAUDE.md` and `GEMINI.md` — identical heading structure for Antigravity parity (P-01). Covers the New Business Review Lead role override, the three team axes, the five non-negotiable boundaries, the three-stage review model, and variant lifecycle rules.
- **[2026-08-19]**: `agents/pm.md` — PM override as New Business Review Lead, using the `extends` pattern (ADR-0033). Defines the four-domain coordination loop, the 34-agent roster contract, stage gates through Entity IC to Group IC, and the three-stage review dispatch protocol.
- **[2026-08-19]**: `docs/lifecycle/agents/pm.md` — governance record for the PM agent.
- **[2026-08-19]**: `package.json` and `bun.lock` — dependency manifest adapted from `templates/common/package.json` (28 scripts retained, none dangling). The scaffold generator omits this and its install check looks under `scripts/`, so dependency resolution was silently falling through to the parent workspace's `node_modules` — which would break on a standalone clone, since this is its own git repository.

### Changed
- **[2026-08-19]**: `variant.json` — completed from the generated stub: description, design-doc and spec-ID references, PM override rationale, and agent manifest notes. Corrected `name` from `co-co-newbiz` to `co-newbiz`; the scaffold generator prefixes `co-` unconditionally, doubling it for names that already carry the prefix.
### Changed
### Fixed
### Removed
