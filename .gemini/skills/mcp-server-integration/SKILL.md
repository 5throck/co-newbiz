---
name: mcp-server-integration
scope: co-newbiz
description: >
  Designs and adds MCP tools to `mcp/co-newbiz/` under ADR-0011's
  non-negotiable rule: the server calls the REST API exclusively, never a
  direct DB connection — enforced by a `bun:test` file-scan
  (`tests/unit/mcp.test.ts`), not just a design statement. Every new tool
  needs a matching REST endpoint first (`rest-api-design`); a tool
  without one is a Stage 5 CI failure per `docs/mcp-integration.md` §6.

  Use when: "add an MCP tool", "MCP server integration", "MCP-REST
  parity", "no direct DB access from MCP".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: backend-engineer
prerequisites:
  - rest-api-design
metadata:
  type: implementation
  triggers:
    - add an MCP tool
    - MCP server integration
    - MCP-REST parity
    - no direct DB access from MCP
---

## Context

Wave 5.7A already implements 11 tools covering exactly the REST surface
Wave 5.6A built — this skill is the discipline for adding the next one, or
for extending coverage once a deferred REST endpoint (api-spec §4/§6)
lands. The `bun:sqlite`/`db/client`/`db/repositories`/`db/lib` import scan
in `tests/unit/mcp.test.ts` is the enforcement mechanism, not a
documentation promise — any new tool file added under `mcp/co-newbiz/`
that imports the DB layer directly fails that test automatically.

## When to Use

- Adding a new MCP tool
- A REST endpoint is added and its MCP counterpart is due

## Execution Steps

1. **Confirm the REST endpoint exists first** (`rest-api-design`) — a tool
   with no matching endpoint is not buildable under this architecture
2. **Write the tool function** in `mcp/co-newbiz/tools/*.ts`, calling
   `shared/rest-client.ts`'s `rest.get`/`rest.post`/`rest.delete` — never
   `bun:sqlite` or any `db/*` import
3. **Register the tool** in `index.ts`'s `TOOLS` array (name, description,
   inputSchema) and its `dispatch()` case
4. **Respect the retry policy**: never retry a write on failure (risk of
   duplicate side effect); a 4xx (e.g. 403 membership denial) is terminal,
   never retried — only network failures and 5xx retry, and only for reads
5. **MNPI default exclusion**: a `list`-shaped tool never passes
   `include_mnpi=1` by default — the REST layer's own default already
   enforces this, the tool just doesn't opt out
6. **Verify with a real stdio client**, not just `dispatch()` directly —
   `tests/unit/mcp.test.ts`'s own pattern of spinning a real
   `StdioClientTransport`/`Client` pair against the actual server binary

## Output Format

- New tool registered in `TOOLS`/`dispatch()`, passing the DB-import scan test

## Related Skills

- `rest-api-design` — the prerequisite endpoint this tool wraps
- `auth-and-account-management` — the Bearer-token scope model this tool's write/read gating relies on
