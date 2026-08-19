# ADR-0038: Project-level need-to-know access control: role x membership, deny by default

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: security-engineer, legal-counsel, compliance-officer

## Context

Role alone (admin/analyst/viewer) cannot express M&A information isolation between projects — an `analyst` role on one deal should not imply visibility into a different, unrelated deal.

## Decision

Deny by default: a user must hold explicit `project_member` membership to see a project at all, in listings, search, API, or reports. `admin` grants system-administration privilege only, never deal-data visibility — accessing deal data still requires an explicit, audited membership grant.

## Consequences

This is a non-negotiable MVP item (design §10 MVP boundary) — it cannot be added after the fact because it constrains the schema and every API entry point from day one. Verification: a non-member must see the project nowhere, including for an admin account (design §12).
