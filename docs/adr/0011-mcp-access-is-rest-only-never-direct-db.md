# ADR-0011: MCP access is REST-only, never direct DB

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: security-engineer, backend-engineer

## Context

AI clients (Claude Code, Desktop, Antigravity, Codex) need programmatic access to project data, but that access must not be able to bypass permission or audit-logging enforcement.

## Decision

The MCP server (`mcp/co-newbiz/`) calls the REST API exclusively — it never opens a direct database connection. Every MCP call is subject to the same scope and audit-log enforcement as a web-session call.

## Consequences

A single enforcement point (the REST layer) for permissions and audit means no client-specific bypass is architecturally possible.
