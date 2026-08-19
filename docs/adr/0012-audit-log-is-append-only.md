# ADR-0012: Audit log is append-only

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: security-engineer, dba

## Context

Compliance and incident response both require the audit trail to be tamper-evident, including against an administrator with system access.

## Decision

The audit log supports insert only. Not even an `admin` role can delete an entry; retention/archival is the sole lifecycle action available.

## Consequences

Storage grows monotonically; retention/archival policy (ADR-0042 territory) manages long-term size without permitting deletion.
