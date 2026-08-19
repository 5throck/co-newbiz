# ADR-0020: Procedure references: + overrides model for shared/entity/region procedures

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: process-governance-manager, group-review-agent

## Context

Copying a shared procedure into each entity's and region's own file breaks the property that a group policy change should propagate automatically everywhere it applies.

## Decision

Adopt safety_os's proven `references:` + `overrides:` mechanism (`add_steps`, `replace_steps`, `thresholds`) verbatim. A common procedure exists in exactly one place; entity/region procedures declare only their deviation.

## Consequences

An audit script actively detects and rejects duplicated copies of a shared procedure (verification gate, design §12) — this property is enforced, not just documented.
