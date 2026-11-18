---
lang: en
counterpart: mcp-user-guide_ko.md
---

# MCP User Guide — Connecting an AI Client

> **Language**: **English** · [한국어](mcp-user-guide_ko.md)

**Audience**: analysts and viewers who want an AI client (Claude Code, Claude Desktop, Gemini CLI, Codex, Claude.ai, ChatGPT) to work with co-newbiz
**Not for**: administrators and release owners (see `mcp-admin-guide.md`)

## What This Guide Covers

How to connect an AI client to co-newbiz through MCP: which path to pick, how to issue a personal API token, how to register the config snippet, what the tools can do, and what to check when a connection fails. Architecture detail lives in `docs/architecture/mcp-integration.md`; this guide only describes use.

## 1. Pick a Path

| Path | Use it for | Credential |
|---|---|---|
| Hosted-app connector (OAuth) | Hosted AI apps such as Claude.ai or ChatGPT | The connector address shown on the Connected Apps screen; no personal token |
| Personal API token | A local stdio MCP server (Claude Code, Claude Desktop, Gemini CLI, Codex) or your own scripts | A token you issue on the Connected Apps screen |

**Never paste a personal API token into a hosted AI app.** A personal token is for software that runs on your own computer.

## 2. Issue a Token

1. Open `연결된 앱` / Connected Apps in the left menu (`/settings` redirects to it).
2. In the personal API token form, enter a **label** (`Label (required)`).
3. Choose a **permission**: `read-only` (default) or `read-write`.
4. Choose an **expiry**: 7, 30, 90 or 180 days (default 30).
5. Press **Issue token**.

Limits enforced by the application:

- You can hold at most **5 active tokens**. Revoke one to free a slot.
- **Administrators cannot issue tokens.** Analysts and viewers can.
- **Viewers get read-only tokens.** A `read-write` token needs the analyst role.
- Issuing and revoking happen **only in a signed-in web session**. A token or an agent cannot create or revoke tokens.

The token list shows a status chip (active, expired, revoked) and a `D-n` badge counting the days left before expiry.

## 3. The One-Time Reveal

1. After you issue a token, a dialog shows the secret **once**. Closing the dialog removes it; the secret cannot be shown again.
2. Copy it now. Two copy actions exist: copy the token itself, or copy the config snippet (`Copy config example`; Korean UI `설정 예시 복사`).
3. The config snippet is an `mcpServers` block with `command: bunx` and `args: ["-y", "@co-newbiz/co-newbiz-mcp"]`. `CO_NEWBIZ_API_BASE_URL` and `CO_NEWBIZ_API_TOKEN` come pre-filled.

The only prerequisite on your computer is **bun**. You need no `.npmrc` and no install token. The token you issued authenticates API calls; it does not download the package. The package installs anonymously from npmjs: `npm view @co-newbiz/co-newbiz-mcp` returned `1.0.1` and the tarball downloaded without credentials (HTTP 200, checked 2026-11-18).

## 4. Register the Snippet in Your AI Client

Paste the `mcpServers` entry into the client's config file:

| Client | Config location |
|---|---|
| Claude Code | project `.mcp.json` |
| Claude Desktop | `claude_desktop_config.json`, under `mcpServers` |
| Antigravity / Gemini CLI | `.gemini/settings.json` |
| Codex App / CLI | `~/.codex/config.toml`, under `[mcp_servers.*]` |

Codex uses TOML, so translate the entry into a `[mcp_servers.co-newbiz]` table with the same command, args and env values. Restart the client after you save the file. Treat the file as a secret: it now contains your token.

## 5. What the Tools Can and Cannot Do

- **Tools inherit your role** (ADR-0146). The server only relays your token to the REST API, so a tool can do what you can do and nothing more. Write tools and `propose_*` tools need an analyst token.
- **`propose_*` tools only draft proposals.** A proposal returns a confirm link (`/proposals/{id}/confirm`). A human opens it in their own web session, reviews it and confirms. The decision of record is always the human's. Proposals expire after 72 hours.
- **MNPI-flagged projects are excluded by default** from tool responses.
- **Admin functions are never exposed**: user management, database administration, batch and schedule management, regulation and procedure authoring, master-data correction.
- Each tool call becomes a REST call and an `audit_log` entry, read-only calls included.

AI output from these tools is decision support. It is not investment advice or a legal opinion.

## 6. Troubleshooting

| Symptom | What to check |
|---|---|
| Client shows an authentication error | Open the token list. A status chip of expired or revoked, or a `D-n` badge at expiry, means you must issue a new token and update the client config |
| Cannot issue a token | You already hold 5 active tokens, or your role is admin (admins cannot issue tokens), or your web session has ended |
| A write tool fails with 403 `role_forbidden` | Your token or role lacks write access. Viewers are read-only; writes need an analyst token with `read-write` permission |
| `bunx` is not found | Install bun, then restart the client |
| Tools return no data or connection errors | Check that `CO_NEWBIZ_API_BASE_URL` matches the address you use for the web app |
| A freshly published package version cannot be found | A registry read can lag shortly after a first publish. On 2026-11-18 a read returned 404 for a few minutes. This was observed once and is not a guarantee. Retry after a few minutes |
| You need the secondary GitHub Packages path | Add the scope mapping `@co-newbiz:registry=https://npm.pkg.github.com` and a `//npm.pkg.github.com/:_authToken=` line holding a `read:packages` PAT to `~/.npmrc`. Any GitHub account's own PAT works |

If a problem persists, send the masked token identifier from the token row menu (`Copy identifier`) to your administrator. The identifier is not secret; the token itself is.

## Related Screens

- `연결된 앱` / Connected Apps (`/settings`) — token issue, list and revoke; connector address for hosted apps.
- `/wiki` — in-app viewer for the user-manual wiki; the connected-apps walkthrough is in `docs/wiki/ko/12-공통-화면-둘러보기.md` §6.
- `docs/architecture/mcp-integration.md` — architecture, tool catalog and client registration.
