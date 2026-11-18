---
lang: en
counterpart: mcp-admin-guide_ko.md
---

# MCP Admin Guide — Token Policy and Package Release

> **Language**: **English** · [한국어](mcp-admin-guide_ko.md)

**Audience**: system administrators and release owners (release-engineer, sre)
**Not for**: people who only want to connect an AI client (see `mcp-user-guide.md`)

## What This Guide Covers

The personal API token policy, the release of the `@co-newbiz/co-newbiz-mcp` package to two registries, the secrets that release needs, and the 90-day rotation of `NPM_TOKEN`. Sources: `docs/architecture/mcp-integration.md`, `.github/workflows/mcp-package.yml`, `docs/designs/2026-11-18-mcp-package-distribution-design.md`, and the Connected Apps page source.

## 1. Personal API Token Policy

| Rule | Value |
|---|---|
| Who may issue | Analysts and viewers. **Administrators cannot issue tokens**, read scope included (`POST /api/tokens` returns 403 `role_forbidden`) |
| Scopes | `read-only` (default) or `read-write`. Viewers lose `write`; only analysts may hold it |
| Expiry options | 7, 30, 90 or 180 days; default 30 |
| Active-token cap | 5 per user; the 6th request is refused |
| Role inheritance (ADR-0146) | The MCP server relays the bearer token, so every tool runs with the token owner's role. Write and `propose_*` tools need an analyst token |
| Existing admin tokens | A token issued before the rule stays valid until it expires. Any admin token receives 403 `role_forbidden` on business routes |
| MNPI | `mnpi_flag=true` projects are excluded from tool responses by default |
| Issue and revoke | Human web-session only. Tokens and agents cannot issue or revoke tokens |
| Storage | Hashed at rest; the secret is shown once at issue |
| Audit | Each tool call becomes a REST call and an `audit_log` entry, read-only calls included |
| Rate limit | Per-token limits, independent of web-session limits; write tools get a tighter budget |

## 2. Package Release

Release owners publish the package by tag. Follow `docs/runbooks/deployment.md` for the surrounding release checks.

1. Bump the version in `mcp/co-newbiz/package.json`.
2. Push a tag `mcp-vX.Y.Z`. The tag version **must equal** the manifest version.
3. The `guard` job fails the run if the tag and manifest differ, or if the tarball contains a file outside the allowlist (the `mcp/co-newbiz` subtree; no `db/`, `app/` or `scripts/` code; ADR-0011).
4. Two publish jobs then run in parallel from the same tagged commit (section 3).
5. The `smoke` job installs the packed tarball and runs a stdio handshake against a stub REST server (`initialize`, then `tools/list`).

## 3. Dual Publish and Secrets

| Job | Registry | Secret | Role |
|---|---|---|---|
| `publish-npmjs` | `registry.npmjs.org` | `NPM_TOKEN` | Primary channel. Consumers install anonymously |
| `publish` | `npm.pkg.github.com` | `MCP_PACKAGES_PAT` | Secondary channel |

- `MCP_PACKAGES_PAT` is a **classic PAT with `write:packages`**, owned by a member of the `co-newbiz` GitHub organization. The `co-newbiz` organization must exist.
- Both jobs publish the same manifest version from the same tag, so the registries cannot drift.
- `1.0.1` onwards is the npmjs line; `1.0.0` exists only on GitHub Packages.
- Neither secret is ever written in a document. Consumers need neither: anonymous npmjs install works (verified 2026-11-18, HTTP 200 on the tarball).

## 4. NPM_TOKEN Rotation (every 90 days)

**Requirement.** `NPM_TOKEN` must be an npm **granular access token** with **Read and write** permission on `@co-newbiz/*` and **bypass 2FA** enabled, expiring at most 90 days after creation. Rotate it **every 90 days, before it expires**.

**Current state.** The token in place was set on 2026-11-18, so it lapses about **2027-02-16**. Confirm the exact expiry date on npmjs.com (Access Tokens page) and record it in the table below.

**Failure signature.** An expired or insufficient token makes `publish-npmjs` fail with E403 while the GitHub Packages `publish` job (a different secret) still passes. The first npmjs publish on 2026-11-18 failed with the same E403 because the token had no 2FA bypass. After you confirm the token has not expired, check the bypass-2FA setting.

**Rotation steps.**

1. On npmjs.com, create a new granular token: Read and write on `@co-newbiz/*`, bypass 2FA, expiry of 90 days or less.
2. Replace the repository secret `NPM_TOKEN` (GitHub repository Settings, Secrets and variables, Actions).
3. Record the new expiry date and the next due date in the Rotation record below. Set a reminder some days before the due date.
4. Revoke the old token on npmjs.com.
5. Verify at the next `mcp-v*` release that `publish-npmjs` is green. If no release is imminent, treat the next release as the verification and say so in the record.

**Rotation record.** Update this table on every rotation. Never write the token value here.

| Token created | Expires | Next rotation due | Rotated by | Verified at release |
|---|---|---|---|---|
| 2026-11-18 | about 2027-02-16 (confirm on npmjs.com) | before expiry (set after confirming the date) | to be recorded | next `mcp-v*` release |

## 5. Incident Symptoms

| Symptom | Likely cause | First check |
|---|---|---|
| `guard` fails on the version step | Tag does not equal `mcp/co-newbiz/package.json` version | Bump the manifest, then retag |
| `guard` fails on the tarball step | A file outside the allowlist entered the package | Read the listed offenders; keep the package inside the subtree (ADR-0011) |
| `publish-npmjs` fails with E403 while `publish` passes | `NPM_TOKEN` expired or insufficient | Check expiry on npmjs.com, then the bypass-2FA and `@co-newbiz/*` read-write settings; rotate (section 4) |
| `publish` fails | `MCP_PACKAGES_PAT` invalid or expired, or the `co-newbiz` organization precondition is unmet | Check the PAT owner, its `write:packages` scope and the organization |
| `smoke` fails | Tarball content or the stub-handshake broke | Read the job log. The workflow lists `smoke` as running after `publish` |
| A consumer cannot install a just-published version | A registry read can lag shortly after a first publish; 2026-11-18 showed 404 for a few minutes. Observed once, not a guarantee | Retry after a few minutes; then check the job results |

## Related Screens

- `연결된 앱` / Connected Apps (`/settings`) — where users issue and revoke their own tokens.
- `docs/runbooks/deployment.md` — release procedure that links here for the rotation requirement.
- `docs/architecture/mcp-integration.md` — architecture and client registration.
- `mcp-user-guide.md` — the user-side counterpart of this guide.
