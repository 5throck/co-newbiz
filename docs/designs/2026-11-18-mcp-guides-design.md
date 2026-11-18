---
lang: en
date: 2026-11-18
status: approved
owner: backend-engineer (design), pm (dispatch)
related: docs/designs/2026-11-18-mcp-package-distribution-design.md, docs/architecture/mcp-integration.md, ADR-0011, ADR-0154
spec: mcp-guides
---

# Design — Dedicated MCP User and Admin Guides

## Problem

MCP setup knowledge is scattered. The token flow is a paragraph in the wiki (`docs/wiki/ko/12-공통-화면-둘러보기.md` §6), client config and distribution live in `docs/architecture/mcp-integration.md` §4 and the package-distribution design, and the release/secret handling lives in `docs/runbooks/deployment.md`. A user who wants to connect an AI client, and an administrator who must keep the npm package publishable, each have to assemble the answer from architecture and design documents. One operational fact has no durable home at all: the npmjs publish credential (`NPM_TOKEN`) is a granular token that expires (at most 90 days), and its lapse silently breaks the primary release channel. The first npmjs publish already failed once (E403) because the token lacked 2FA bypass.

## Decision

Add two dedicated guides under `docs/manuals/`, each as an English file plus a Korean counterpart (`*_ko.md`, same convention as the existing manuals), and link them from the docs hub and the existing manuals. The guides are operational documentation only: every claim must trace to the grounding sources below; they add no behavior and invent none.

Grounding sources: `docs/architecture/mcp-integration.md`, `docs/wiki/ko/12-공통-화면-둘러보기.md` §6 (connected apps), `docs/designs/2026-11-18-mcp-package-distribution-design.md`, `.github/workflows/mcp-package.yml`, `app/web-next/app/settings/connected-apps/page.tsx` (and the constants it imports from `app/web-next/lib/token-issue-access.ts`: expiry options 7/30/90/180 days, default 30, active-token cap 5).

### Files

New:

| File | Purpose |
|---|---|
| `docs/manuals/mcp-user-guide.md` | MCP user guide (English) |
| `docs/manuals/mcp-user-guide_ko.md` | Korean counterpart |
| `docs/manuals/mcp-admin-guide.md` | MCP admin guide (English) |
| `docs/manuals/mcp-admin-guide_ko.md` | Korean counterpart |
| `docs/designs/2026-11-18-mcp-guides-design.md` | This design (registered as spec `mcp-guides`) |

Edited:

| File | Change |
|---|---|
| `docs/README.md`, `docs/README_ko.md` | `manuals/` row names the two MCP guides |
| `docs/manuals/admin-manual.md` + `_ko` | Link both guides from `## 8. Related` |
| `docs/manuals/operations-manual.md` + `_ko` | Link the admin guide from `## 6. Related` |
| `docs/manuals/business-manual.md` + `_ko` | Link the user guide (this manual has no Related section; add a one-line pointer in or beside `## 7. Related Screens`) |
| `docs/runbooks/deployment.md` + `_ko` | Release procedure (npm package channel paragraph) gains the NPM_TOKEN 90-day rotation requirement and a link to the admin guide |

### MCP user guide outline

1. What this is and which path to pick: hosted-app connector (OAuth, Claude.ai/ChatGPT style, connector address shown on the Connected Apps screen) versus personal API token (local stdio MCP server or scripts). A personal token is never pasted into a hosted AI app.
2. Issuing a token from `연결된 앱` / Connected Apps: label (required), permission (`read-only` default or `read-write`), expiry (7/30/90/180 days, default 30), **Issue token**. Limits stated by the code: at most 5 active tokens; admins cannot issue tokens; viewers get read-only; write needs an analyst. Issue and revoke are human web-session only.
3. The one-time reveal: the secret is shown once; the `설정 예시 복사` / config-snippet copy yields the `mcpServers` block (`command: bunx`, `args: ["-y", "@co-newbiz/co-newbiz-mcp"]`, `CO_NEWBIZ_API_BASE_URL` and `CO_NEWBIZ_API_TOKEN` pre-filled). Prerequisite is bun only; no `.npmrc`, no install token (the issued token authenticates API calls, not package download).
4. Registering the snippet in the AI client (client config locations as listed in mcp-integration.md §4).
5. What the tools can and cannot do: tools inherit the token owner's role (ADR-0146); `propose_*` tools only draft proposals and a human confirms; MNPI-flagged projects are excluded by default.
6. Troubleshooting: token expired/revoked/over-cap (status chips and D-n expiry badge), 403 `role_forbidden`, bun missing, wrong base URL, secondary GitHub Packages path needs the scope mapping plus a `read:packages` PAT. Tool-visible symptoms only, no invented error text.

### MCP admin guide outline

1. Scope and audience (administrators and release owners).
2. Personal API token policy: who may issue, scopes, expiry options, active cap, role inheritance, revocation, audit (statements limited to mcp-integration.md and the page source).
3. Package release: bump `mcp/co-newbiz/package.json` version, push tag `mcp-vX.Y.Z` (must equal the manifest version; the guard job fails otherwise), guard (tarball allowlist, ADR-0011), then two parallel publish jobs and a smoke job.
4. Dual publish and secrets: `publish-npmjs` (primary, `NPM_TOKEN`) and `publish` (secondary GitHub Packages, `MCP_PACKAGES_PAT`, classic PAT with `write:packages`, owned by a `co-newbiz` org member; the `co-newbiz` org must exist). Same version from the same tag, so registries cannot drift.
5. NPM_TOKEN rotation (see next section).
6. Incident symptoms table: tag/manifest mismatch (guard fails); npmjs job fails E403 while GitHub Packages job succeeds (token expired or insufficient); GitHub Packages job fails (PAT or org precondition); smoke fails (tarball or stub-handshake); consumer cannot install (registry propagation delay is plausible but unverified; not claimed as fact).

### NPM_TOKEN rotation content (admin guide + deployment runbook)

- **Requirement**: `NPM_TOKEN` must be an npm **granular access token** with **Read and write** permission on `@co-newbiz/*` and **bypass 2FA** enabled, expiring at most 90 days after creation. Rotate **every 90 days**, before expiry.
- **Current state**: the token in place was set on 2026-11-18, so it lapses around **2027-02-16**; the operator must confirm the exact expiry date on npmjs.com (Access Tokens page) and record it.
- **Failure signature**: an expired or insufficient token makes the `publish-npmjs` job fail with E403, while the GitHub Packages `publish` job (different secret) still succeeds. The 2026-11-18 first-publish failure (no 2FA bypass) had the same E403 signature, so after confirming the token has not expired, check the bypass-2FA setting.
- **Rotation steps**: (1) on npmjs.com create a new granular token: Read and write on `@co-newbiz/*`, bypass 2FA, 90-day (or shorter) expiry; (2) replace the repository secret `NPM_TOKEN` (GitHub repo Settings, Secrets and variables, Actions); (3) record the new expiry date and the next due date (set a rotation reminder some days before it); (4) revoke the old token on npmjs.com; (5) verify at the next `mcp-v*` release that `publish-npmjs` is green, or, if no release is imminent, treat the next release as the verification and say so in the record.
- **Where to record the next due date**: the guide carries a "Rotation record" table (token created, expires, next rotation due, rotated by) that the operator updates on each rotation, and the deployment runbook release procedure points to it. The secret value itself is never written in any document.

## Accessibility statement

Not applicable. This change is documentation only: no UI, component, color, or interaction is added or changed. The guides use plain headings, ordered steps, and tables with header rows.

## Preview Verification

Exempt. Docs-only change with no rendered application surface; there is nothing to preview in the running app. Verification is the spec/registry audit and a link/claim check of each guide against the grounding sources.

## Out of scope

- Any code, workflow, or API change (the publish workflow, token API, and Connected Apps screen are described, not modified).
- Automating the token rotation or an expiry alert (a possible follow-up for `sre`; not decided here).
- OAuth remote transport changes (ADR-0154 unchanged) and non-MCP manuals.
- Screenshots of the Connected Apps screen.
- Verifying the anonymous `bunx` install from npmjs (not yet confirmed in the distribution design; the guides must not claim it as verified).

## Disclaimer

The guides are operational documentation describing how this system is set up and run. They are decision-support material, not legal advice, security certification, or a substitute for reading the source texts and the ADRs they cite. Where they conflict with the code or the cited architecture documents, the code and those documents govern.
