---
title: "Dynamic client registration registers every hosted client as a public client, whatever auth method it asks for"
author: SungHyuk
date: 2026-11-19
branch: main
cost: { minutes: 16, tokens: 176500 }
id: l-31b4a23b
scope: repo
status: active
src: agent
touches:
  - app/web-next/app/api/oauth/register/route.ts
  - AGENTS.md
  - agents/pm.md
  - app/web-next/lib/mcp/cors.ts
---

## Decided
When a hosted AI app (ChatGPT, Claude.ai) registers itself and asks for a client-secret auth method, the server still registers it as a public client (PKCE required, no secret issued) and answers with auth method "none". The user chose this over refusing, because refusing breaks the default connector flow. Fixing registration itself comes first; a manual "register a client" screen is deferred until the registration fixes are seen working.

## Tried and ruled out
- Keep refusing non-"none" auth methods with HTTP 400: dropped, hosted clients that send a secret-based method would fail registration and need a manual path.
- Build the manual registration API and screen in the same change: deferred by the user, to see whether the registration fixes resolve the failure first.

## Watch out
- The HTTP 403 ChatGPT reported is not produced by the app: the registration, token, revoke and discovery routes never return 403. It most likely comes from the Cloudflare edge; confirm in Cloudflare Security Events. The app now writes a refusal audit row per refusal, so a 403 with no such row came from the edge.
- Nothing was tested against a live ChatGPT or Claude.ai request yet.

In the code:
- app/web-next/app/api/oauth/register/route.ts
- docs/adr/0203-amend-adr-0154-dcr-registers-public-client-for-any-auth-method.md
- env CO_NEWBIZ_TRUST_PROXY_HEADERS=cloudflare for the rate-limit client IP
