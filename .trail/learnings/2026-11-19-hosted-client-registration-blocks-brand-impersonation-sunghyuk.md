---
title: "Hosted-client registration blocks brand impersonation by tying brand names to their own redirect hosts; proxy port exposure is documented, not changed"
author: SungHyuk
date: 2026-11-19
branch: main
cost: { minutes: 11, tokens: 55646 }
id: l-f6c6fbc5
scope: repo
status: active
src: agent
touches:
  - app/web-next/lib/mcp/reserved-client-names.ts
  - app/web-next/app/api/oauth/register/route.ts
---

## Decided
Anonymous client registration is kept open for hosted AI apps, but a client name that contains a reserved brand (ChatGPT/OpenAI, Claude/Anthropic, Gemini/Google, or the app's own name) is accepted only when every redirect host belongs to that brand. Otherwise registration is refused with a client-metadata error. Production should also set the redirect-host allowlist; the administrator sets it, the app does not. The user chose this over recording a risk acceptance. For the origin server's port being open on all interfaces (forgeable proxy headers), the user chose guidance only: the compose file is not changed in this work; the admin guide explains binding to loopback first and only then trusting the Cloudflare client-IP header.

## Tried and ruled out
- Blocking every reserved brand name outright: dropped, it would break real ChatGPT and Claude.ai registrations, which use those names.
- Recording a risk acceptance for anonymous registration with no allowlist: not chosen, risk grows as registration succeeds more often.
- Changing the published port in the compose file in this change: not chosen, the owner approves port changes.

## Watch out
- Matching is a case-insensitive substring, so a neutral name that merely contains a brand token is refused unless its hosts match.
- The proxy-header trust setting must stay off until the port is bound to loopback, otherwise the client IP and the edge-evidence header can be forged.
- The allowlist values and the audit IP key are set by an administrator in the deployment environment; nothing in the repo sets them.

In the code:
- app/web-next/lib/mcp/reserved-client-names.ts
- app/web-next/app/api/oauth/register/route.ts
- env CO_NEWBIZ_OAUTH_REDIRECT_HOST_ALLOWLIST, CO_NEWBIZ_TRUST_PROXY_HEADERS, CO_NEWBIZ_AUDIT_IP_HMAC_KEY
