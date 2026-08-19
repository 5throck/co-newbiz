# ADR-0009: Password hashing: PBKDF2-HMAC-SHA256

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: security-engineer

## Context

Account authentication needs an irreversible, industry-standard password storage scheme reusable from the workspace's existing `scripts/lib/auth.ts`.

## Decision

PBKDF2-HMAC-SHA256, 210,000 iterations, 16-byte salt, 32-byte key (OWASP 2023 guidance), reused as-is from the workspace library rather than reimplemented.

## Consequences

Neither direct DB access nor the admin console can recover a plaintext password — a verification gate in design §12.
