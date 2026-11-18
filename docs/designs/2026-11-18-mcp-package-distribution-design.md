---
lang: en
date: 2026-11-18
status: implemented
owner: backend-engineer (design), pm (dispatch)
related: ADR-0011 (MCP access is REST-only), ADR-0154 (remote transport), docs/architecture/mcp-integration.md
spec: mcp-package-distribution
---

# Design — MCP Server Package Distribution (GitHub Packages)

## Problem

The stdio MCP server (`mcp/co-newbiz/`) is usable only from a repo checkout: every AI client spawns `bun run ./mcp/co-newbiz/index.ts` from this repository (`.mcp.json`, mcp-integration.md §4). Any consumer outside a checkout — another workstation, another person, or an AI client without MCP OAuth support (ZCode's HTTP transport is static-headers only, so the ADR-0154 OAuth remote endpoint `/api/mcp` is not usable there) — has no supported path. The remote HTTP transport is not a substitute: it requires OAuth 2.1 (authorization_code + PKCE, no client_credentials, 15-minute access tokens), so only OAuth-implementing clients can use it.

Verified precondition: the import graph of `mcp/co-newbiz/` is fully self-contained — relative imports within the subtree only; external dependencies are exactly `@modelcontextprotocol/sdk` (^1.32.2) and `zod` (plus `node:crypto`, builtin). `stage-guides.generated.ts` lives inside the subtree. The directory is already a package boundary in everything but name.

## Decision

Distribute the stdio server as a **private npm package on GitHub Packages**, mirroring the existing ghcr.io docker distribution pattern (PAT with `read:packages`, private registry, tag-driven publish). The published package stays a pure REST relay — ADR-0011 unchanged.

### 1. Package identity and versioning

- **Name**: `@co-newbiz/co-newbiz-mcp` — org-scoped per the user's decision to keep the `5throck` namespace out of the package identity.
- **Prerequisite (external, operator action)**: a GitHub organization named `co-newbiz` must exist, owned by the operator's account (`5throck`). GitHub Packages npm registry only accepts scoped packages, and the scope must correspond to an existing user/org account — hence this precondition. The repository itself stays at `5throck/co-newbiz`; no repo transfer.
- **Version**: tag-driven. Tags named `mcp-vX.Y.Z` publish version `X.Y.Z` from `mcp/co-newbiz/package.json`. The workflow rejects a tag whose prefix does not match the version declared in the manifest (single source of truth = the manifest).
- The `mcp-v` prefix avoids collision with any existing `v*` tags.

### 2. Runtime target: bun-only (no compile)

`bin` points at the TypeScript entry (`./index.ts`); consumers run it through `bunx`/`bun`, which execute TS natively. Rationale:

- The server already requires bun in practice (root runbook: plain Node cannot resolve `bun:sqlite` in the repo's dev stack, and the relay's own dev/test loop is bun).
- A `bun build --compile` matrix adds three-platform artifacts and CI cost for no consumer benefit: anyone who cannot install bun also cannot develop against this project.
- Decided: **bun-only**. Consumer prerequisite: bun on PATH (documented).

### 3. Packaging mechanics

Add `mcp/co-newbiz/package.json` (new file; root `package.json` untouched — it declares no `workspaces` field, so a nested manifest is invisible to root installs and changes nothing locally):

```json
{
  "name": "@5throck/co-newbiz-mcp",
  "version": "1.0.0",
  "type": "module",
  "bin": { "co-newbiz-mcp": "./index.ts" },
  "files": [
    "index.ts", "define.ts", "registry.ts",
    "stage-guides.ts", "stage-guides.generated.ts",
    "shared/", "tools/"
  ],
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.32.2",
    "zod": "^3"
  }
}
```

- `files` pins the tarball to the subtree contents — no db modules exist there, so the published artifact cannot violate ADR-0011 by construction. The existing gate `tests/unit/mcp.test.ts` ("no file under mcp/co-newbiz imports bun:sqlite or a db module") stays authoritative for the source; CI adds a tarball-list assertion (§6).
- `scripts/co-newbiz/mcp-coverage.ts` imports `mcp/co-newbiz/registry.ts` from the source path — unaffected (source stays in place; the manifest is additive).
- The root already hoists both dependencies; the nested manifest only declares what the published tarball needs.

### 4. Publish workflow

New `.github/workflows/mcp-package.yml`:

- **Trigger**: `push` to tags `mcp-v*`.
- **Guard job**: fail if tag != `mcp/co-newbiz/package.json` `version` (strip prefix).
- **Publish job**: setup-bun; `bun install` at root (dependency resolution); `npm publish` with `registry=https://npm.pkg.github.com` and scope auth configured from a repository secret **`MCP_PACKAGES_PAT`** (classic PAT with `write:packages`, owned by a member of the `co-newbiz` org). Rationale: the repository is personal-account-owned while the package scope is org-scoped — the repo-scoped `GITHUB_TOKEN` does not reliably carry org package write permission for that shape. If the repository is later transferred into the `co-newbiz` org, the workflow can switch to `GITHUB_TOKEN` with `packages: write` (same shape as `docker.yml`); note that step for the operator, not as a blocker.
- CI (`ci.yml`) is not touched; publish is a separate workflow, mirroring the docker.yml split.

### 5. Consumer install (docs, shipped in the same PR)

```ini
# ~/.npmrc
@co-newbiz:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=<PAT with read:packages, granted on the co-newbiz org>
```

```bash
bunx @co-newbiz/co-newbiz-mcp   # or: bun x @co-newbiz/co-newbiz-mcp
```

Client registration example (stdio; env supplied by the consumer, no repo paths anywhere):

```json
"co-newbiz": {
  "type": "stdio",
  "command": "bunx",
  "args": ["-y", "@co-newbiz/co-newbiz-mcp"],
  "env": {
    "CO_NEWBIZ_API_BASE_URL": "https://dev-newbiz.bizknights.org",
    "CO_NEWBIZ_API_TOKEN": "<personal API token>"
  }
}
```

Personal API tokens (issued via `POST /api/tokens`) remain the auth model for this transport — unchanged from §2 of mcp-integration.md. The OAuth-only constraint of `/api/mcp` (ADR-0154) is untouched and remains the path for OAuth-capable clients.

### 6. Tests and gates

| Gate | What it verifies |
|---|---|
| `tests/unit/mcp.test.ts` (existing) | ADR-0011 subtree import scan; tool catalog; stdio wire test — unchanged |
| New tarball-list assertion (CI publish workflow, guard job) | `npm pack --dry-run` contains only subtree files; fails on any db/ or app/ path leaking in |
| New smoke install job (CI publish workflow) | In a temp dir with `MCP_PACKAGES_PAT` registry auth: `bun install @co-newbiz/co-newbiz-mcp@<tag>`, spawn `bunx co-newbiz-mcp` with `CO_NEWBIZ_API_BASE_URL` pointing at a stub HTTP server, send `initialize` + `tools/list` over stdio — mirrors the real-transport approach of `tests/unit/mcp.test.ts` |
| `bun scripts/co-newbiz/mcp-coverage.ts` (existing, variant audit hook) | Stage activity/artifact coverage — unchanged |

### 7. Docs and security-model currency

Same-PR doc updates (runbook rule): `docs/architecture/mcp-integration.md` §4 (add package row: "any client, no checkout"), `docs/runbooks/deployment.md` §5 (consumer prerequisite + release note: publishing now includes the npm channel).

Threat-model currency check: this is a **distribution channel change, not a new trust boundary** — same code, same bearer-token auth, same REST-only enforcement, no new endpoint and no new auth path. The published tarball is private (GitHub Packages inherits repo visibility). `docs/security/security-model.md` needs no STRIDE update; this paragraph is the record of that check.

## Config table

| Item | Value | Notes |
|---|---|---|
| Package name | `@co-newbiz/co-newbiz-mcp` | scope = GitHub org `co-newbiz` (operator-created prerequisite) |
| Registry | `npm.pkg.github.com` | private; PAT `read:packages` (org-granted) to install |
| Publish auth | repo secret `MCP_PACKAGES_PAT` (write:packages, org member) | personal-owned repo × org-scoped package; switch to `GITHUB_TOKEN` if the repo moves into the org |
| Tag format | `mcp-vX.Y.Z` | must equal manifest version |
| Runtime | bun-only (`bin` → `./index.ts`) | no compile matrix |
| New files | `mcp/co-newbiz/package.json`, `.github/workflows/mcp-package.yml` | additive only |
| Env contract | `CO_NEWBIZ_API_BASE_URL`, `CO_NEWBIZ_API_TOKEN` | consumer-supplied, unchanged |

## Out of scope

- OAuth remote transport changes (ADR-0154 unchanged).
- Compiled multi-platform binaries.
- Publishing to the public npm registry (repo and package are private by design).

## Implementation record (2026-11-18)

Published `@co-newbiz/co-newbiz-mcp@1.0.0` on 2026-11-18 via tag `mcp-v1.0.0` at commit `19a62fb8` (workflow run 44206090564: guard / publish / smoke jobs all green). Two fixes landed during the first publish:

- **PR #912** — the guard's `npm pack --dry-run --json` parsing now tolerates npm 11's array-of-pack-objects output shape (the original parser assumed a single object).
- **Org precondition realized** — the GitHub organization `co-newbiz` had to exist before the first publish; without it the registry rejects the scoped package with 403 (owner not found). This was the §1 operator prerequisite, confirmed in practice.

**Decision amendment (owner decision, 2026-11-18): package visibility changes from private to public.** The repository `5throck/co-newbiz` is already public, so no new code is exposed; the visibility flip itself is a package-level, one-way change made in the GitHub UI. Consequences:

- Consumer `.npmrc` no longer needs the `//npm.pkg.github.com/:_authToken=` line — only the `@co-newbiz:registry=https://npm.pkg.github.com` scope mapping. The `read:packages` PAT requirement for consumers is dropped: once public, tokens are simply unnecessary.
- The publish workflow now passes `--access public` to `npm publish`, so a future first publish (e.g. after package deletion) re-lands public instead of inheriting the registry's private default.
- Note: the GitHub UI visibility flip is one-way — a package cannot be made private again without deletion.

This amendment supersedes the "private npm package" framing in the Decision and §7 above for consumer-install purposes; the env contract, REST-only relay boundary (ADR-0011), and tag-driven publish flow are unchanged.
