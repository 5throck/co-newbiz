---
lang: en
date: 2026-11-18
status: implemented
owner: backend-engineer (design), pm (dispatch)
related: ADR-0011 (MCP access is REST-only), ADR-0154 (remote transport), docs/architecture/mcp-integration.md
spec: mcp-package-distribution
---

# Design — MCP Server Package Distribution (npmjs.com primary, GitHub Packages secondary)

## Problem

The stdio MCP server (`mcp/co-newbiz/`) is usable only from a repo checkout: every AI client spawns `bun run ./mcp/co-newbiz/index.ts` from this repository (`.mcp.json`, mcp-integration.md §4). Any consumer outside a checkout — another workstation, another person, or an AI client without MCP OAuth support (ZCode's HTTP transport is static-headers only, so the ADR-0154 OAuth remote endpoint `/api/mcp` is not usable there) — has no supported path. The remote HTTP transport is not a substitute: it requires OAuth 2.1 (authorization_code + PKCE, no client_credentials, 15-minute access tokens), so only OAuth-implementing clients can use it.

Verified precondition: the import graph of `mcp/co-newbiz/` is fully self-contained — relative imports within the subtree only; external dependencies are exactly `@modelcontextprotocol/sdk` (^1.32.2) and `zod` (plus `node:crypto`, builtin). `stage-guides.generated.ts` lives inside the subtree. The directory is already a package boundary in everything but name.

## Decision

Distribute the stdio server as a **public npm package, published to two registries from one `mcp-v*` tag**:

- **Primary — npmjs.com** (`registry.npmjs.org`). Public packages are served anonymously, so consumers install with `bunx @co-newbiz/co-newbiz-mcp`: no `.npmrc`, no PAT; bun is the only prerequisite.
- **Secondary — GitHub Packages** (`npm.pkg.github.com`). Retained for consumers already on that auth path. GitHub Packages npm authenticates every registry request, public packages included, so it can never be token-free.

Both jobs publish the same manifest version from the same tagged commit, so the registries cannot drift by construction. The published package stays a pure REST relay — ADR-0011 unchanged. The decision history (private-to-public flip, why npmjs became primary) is recorded in the Implementation record below.

### 1. Package identity and versioning

- **Name**: `@co-newbiz/co-newbiz-mcp` — org-scoped per the user's decision to keep the `5throck` namespace out of the package identity.
- **Prerequisites (external, operator action)**:
  - *Primary (npmjs.com)*: the `@co-newbiz` scope/org must exist on npmjs.com, and the repository secret **`NPM_TOKEN`** must be a **granular access token** with **Read and write** on `@co-newbiz/*` and **"bypass 2FA"** enabled (a token without 2FA bypass fails the publish with E403 in CI; see the 2026-11-18 note below).
  - *Secondary (GitHub Packages)*: a GitHub organization named `co-newbiz` must exist, owned by the operator's account (`5throck`). GitHub Packages npm registry only accepts scoped packages, and the scope must correspond to an existing user/org account. The repository itself stays at `5throck/co-newbiz`; no repo transfer.
- **Version**: tag-driven. Tags named `mcp-vX.Y.Z` publish version `X.Y.Z` from `mcp/co-newbiz/package.json`. The workflow rejects a tag whose prefix does not match the version declared in the manifest (single source of truth = the manifest).
- The `mcp-v` prefix avoids collision with any existing `v*` tags.
- **Version reality**: `1.0.0` exists only on GitHub Packages; `1.0.1` (tag `mcp-v1.0.1`) is the first npmjs release. From `1.0.1` onward both registries carry the same version.

### 2. Runtime target: bun-only (no compile)

`bin` points at the TypeScript entry (`./index.ts`); consumers run it through `bunx`/`bun`, which execute TS natively. Rationale:

- The server already requires bun in practice (root runbook: plain Node cannot resolve `bun:sqlite` in the repo's dev stack, and the relay's own dev/test loop is bun).
- A `bun build --compile` matrix adds three-platform artifacts and CI cost for no consumer benefit: anyone who cannot install bun also cannot develop against this project.
- Decided: **bun-only**. Consumer prerequisite: bun on PATH (documented).

### 3. Packaging mechanics

`mcp/co-newbiz/package.json` (root `package.json` untouched — it declares no `workspaces` field, so a nested manifest is invisible to root installs and changes nothing locally):

```json
{
  "name": "@co-newbiz/co-newbiz-mcp",
  "version": "1.0.1",
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

`.github/workflows/mcp-package.yml`:

- **Trigger**: `push` to tags `mcp-v*`.
- **`guard` job**: fail if tag != `mcp/co-newbiz/package.json` `version` (strip prefix); tarball-list assertion (§6).
- **`publish-npmjs` job (primary)**: `needs: guard`. Writes a fresh `~/.npmrc` containing only `//registry.npmjs.org/:_authToken=${NPM_TOKEN}` and runs `npm publish --access public --registry https://registry.npmjs.org`. `--access public` is required because a first publish of a scoped package defaults to restricted.
- **`publish` job (secondary)**: `needs: guard`, runs in parallel with `publish-npmjs` with no ordering dependency. Configures the `@co-newbiz` scope against `https://npm.pkg.github.com` from repository secret **`MCP_PACKAGES_PAT`** (classic PAT with `write:packages`, owned by a member of the `co-newbiz` org) and runs `npm publish --access public`. Rationale for the PAT: the repository is personal-account-owned while the package scope is org-scoped — the repo-scoped `GITHUB_TOKEN` does not reliably carry org package write permission for that shape. If the repository is later transferred into the `co-newbiz` org, the job can switch to `GITHUB_TOKEN` with `packages: write` (same shape as `docker.yml`); note that step for the operator, not as a blocker.
- **`smoke` job**: `needs: publish` (see §6).
- CI (`ci.yml`) is not touched; publish is a separate workflow, mirroring the docker.yml split.

### 5. Consumer install (docs, shipped in the same PR)

Primary channel (npmjs.com) — no `.npmrc`, no token, bun is the only prerequisite:

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

The connected-apps page (`app/web-next/app/settings/connected-apps/page.tsx`) copies this exact package command as its one-time reveal dialog's config snippet, so in-app users get a working `mcpServers` block without a repository checkout (origin and token filled in automatically).

Personal API tokens (issued via `POST /api/tokens`) remain the auth model for this transport — unchanged from §2 of mcp-integration.md. The OAuth-only constraint of `/api/mcp` (ADR-0154) is untouched and remains the path for OAuth-capable clients.

#### Secondary channel (GitHub Packages)

For consumers who want or already have the GitHub auth route. GitHub Packages authenticates every request even for public packages, so both lines are required; any GitHub account's own `read:packages` PAT works (no org membership or package-level access grant):

```ini
# ~/.npmrc
@co-newbiz:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=<PAT with read:packages>
```

### 6. Tests and gates

| Gate | What it verifies |
|---|---|
| `tests/unit/mcp.test.ts` (existing) | ADR-0011 subtree import scan; tool catalog; stdio wire test — unchanged |
| Tarball-list assertion (`guard` job) | `npm pack --dry-run --json` contains only subtree files; fails on any db/, app/ or scripts/ path leaking in |
| Smoke job (`smoke`, `needs: publish`) | Packs the tarball from the tagged commit (`npm pack`) and installs it with `bun add ./co-newbiz-co-newbiz-mcp-*.tgz` — not a registry round-trip, which sidesteps registry propagation delay (publish already validates the registry path). Spawns `bunx co-newbiz-mcp` with `CO_NEWBIZ_API_BASE_URL` pointing at a stub HTTP server, sends `initialize` + `tools/list` over stdio and requires at least one tool — mirrors the real-transport approach of `tests/unit/mcp.test.ts` |
| `bun scripts/co-newbiz/mcp-coverage.ts` (existing, variant audit hook) | Stage activity/artifact coverage — unchanged |

### 7. Docs and security-model currency

Same-PR doc updates (runbook rule): `docs/architecture/mcp-integration.md` §4 (add package row: "any client, no checkout"), `docs/runbooks/deployment.md` §5 (consumer prerequisite + release note: publishing covers both registries).

Post-publish extension: the docs surfaces reach the consumer-facing layer too — wiki page `docs/wiki/ko/12-공통-화면-둘러보기.md` §6 (token flow notes the copied `bunx` config snippet), the docs hub `docs/README.md` architecture row (MCP integration entry names the npm distribution), and the root `README.md` / `README_ko.md` architecture notes (stdio server also installable as `@co-newbiz/co-newbiz-mcp`).

Threat-model currency check: this is a **distribution channel change, not a new trust boundary** — same code, same bearer-token auth, same REST-only enforcement, no new endpoint and no new auth path. The package is public and the repository is already public, so publishing exposes no code that was not already visible. `docs/security/security-model.md` needs no STRIDE update; this paragraph is the record of that check.

## Config table

| Item | Value | Notes |
|---|---|---|
| Package name | `@co-newbiz/co-newbiz-mcp` | npmjs `@co-newbiz` scope (primary); GitHub org `co-newbiz` (secondary) |
| Primary registry | `registry.npmjs.org` | public, anonymous install; no token needed by consumers |
| Secondary registry | `npm.pkg.github.com` | public package but every request authenticated; consumer needs scope mapping + `read:packages` PAT |
| Primary publish auth | repo secret `NPM_TOKEN` | granular token, Read-and-write on `@co-newbiz/*`, bypass 2FA |
| Secondary publish auth | repo secret `MCP_PACKAGES_PAT` (write:packages, org member) | personal-owned repo x org-scoped package; switch to `GITHUB_TOKEN` if the repo moves into the org |
| Tag format | `mcp-vX.Y.Z` | must equal manifest version; one tag publishes to both registries |
| Runtime | bun-only (`bin` -> `./index.ts`) | no compile matrix |
| Files | `mcp/co-newbiz/package.json`, `.github/workflows/mcp-package.yml` | additive only |
| Env contract | `CO_NEWBIZ_API_BASE_URL`, `CO_NEWBIZ_API_TOKEN` | consumer-supplied, unchanged |

## Out of scope

- OAuth remote transport changes (ADR-0154 unchanged).
- Compiled multi-platform binaries.

## Implementation record (2026-11-18)

Published `@co-newbiz/co-newbiz-mcp@1.0.0` on 2026-11-18 via tag `mcp-v1.0.0` at commit `19a62fb8` (workflow run 44206090564: guard / publish / smoke jobs all green). Two fixes landed during the first publish:

- **PR #912** — the guard's `npm pack --dry-run --json` parsing now tolerates npm 11's array-of-pack-objects output shape (the original parser assumed a single object).
- **Org precondition realized** — the GitHub organization `co-newbiz` had to exist before the first publish; without it the registry rejects the scoped package with 403 (owner not found). This was the §1 operator prerequisite, confirmed in practice.

**Decision amendment (owner decision, 2026-11-18): package visibility changes from private to public.** The repository `5throck/co-newbiz` is already public, so no new code is exposed; the visibility flip itself is a package-level, one-way change made in the GitHub UI. Consequences:

- Consumer `.npmrc` still needs both the `@co-newbiz:registry=https://npm.pkg.github.com` scope mapping and the `//npm.pkg.github.com/:_authToken=` line with a `read:packages` PAT — GitHub Packages npm authenticates every registry request even for public packages. What the public flip removes is the org-side requirement: any GitHub account's own `read:packages` PAT now works, without org membership or the package-level access grant (Settings → Packages → add user/team) that private packages require. (Correction 2026-11-18: this bullet originally claimed the PAT/`_authToken` requirement was dropped — anonymous registry requests are rejected, 401/403, even for public packages.)
- The publish workflow now passes `--access public` to `npm publish`, so a future first publish (e.g. after package deletion) re-lands public instead of inheriting the registry's private default.
- Note: the GitHub UI visibility flip is one-way — a package cannot be made private again without deletion.

The body above already reflects this amendment (and the dual-publish amendment below); the env contract, REST-only relay boundary (ADR-0011), and tag-driven publish flow are unchanged.

**Decision amendment (owner decision, 2026-11-18): dual publish — npmjs.com becomes the primary channel.** Supersedes the original "Out of scope" bullet "Publishing to the public npm registry", which has been removed from the body.

- **Why.** The public-visibility flip above removed the *org-side* prerequisite, not the *token* prerequisite. GitHub Packages npm authenticates every registry request, public packages included — anonymous requests are rejected with 401/403 (verified; see the correction in the bullet above). A token-free install is therefore impossible on that registry, no matter the package's visibility. npmjs.com serves public packages anonymously by design, which is what a `bunx` consumer with no `.npmrc` needs.
- **What changed.**
  - `mcp/co-newbiz/package.json` → `1.0.1`.
  - `.github/workflows/mcp-package.yml` gains a `publish-npmjs` job (`needs: guard`, runs in parallel with the existing `publish` job) that writes a fresh `~/.npmrc` containing only `//registry.npmjs.org/:_authToken=${NPM_TOKEN}` and runs `npm publish --access public --registry https://registry.npmjs.org`. The existing `publish` job is retained unchanged as the **secondary** channel — same version, same tag, same tagged commit.
  - Both jobs publish from a single `mcp-vX.Y.Z` tag, so the two registries cannot drift in version by construction.
- **Consumer consequence.** The install path is now `bunx @co-newbiz/co-newbiz-mcp` with **no `.npmrc` and no PAT**; prerequisite is bun alone. The GitHub Packages path remains available for anyone who wants (or already has) that auth route — scope mapping plus a `read:packages` PAT, as documented in the §5 "Secondary channel" subsection.
- **Version reality.** `1.0.0` exists only on GitHub Packages. A version already published there cannot be re-published to npmjs under the same number from the existing tag, so **`1.0.1` (tag `mcp-v1.0.1`) is the first npmjs release**. From `1.0.1` onward both registries carry the same version.

The env contract (`CO_NEWBIZ_API_BASE_URL` / `CO_NEWBIZ_API_TOKEN`) and the REST-only relay boundary (ADR-0011) are unchanged by this amendment — publishing to a public registry exposes the same already-public code to the same already-documented npmjs audience, so no new trust boundary is introduced and `docs/security/security-model.md` needs no STRIDE update.

**First npmjs publish (2026-11-18).** The first npmjs publish attempt of `mcp-v1.0.1` failed with E403 because `NPM_TOKEN` lacked 2FA bypass. After replacing it with a granular token with bypass-2FA, the rerun of workflow run 44223981816 published `1.0.1` to npmjs (the log shows `+ @co-newbiz/co-newbiz-mcp@1.0.1`). Registry read-after-publish was still 404 several minutes later, which is consistent with propagation delay; no further verification was performed (e.g. an anonymous `bunx` install from npmjs has not been confirmed).
