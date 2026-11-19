---
title: "MCP setup gets two dedicated guides (user and admin), and the npm publish token must be a 2FA-bypass granular token rotated every 90 days"
author: SungHyuk
date: 2026-11-18
branch: pr/20261118-114850-docs-mcp-align-package-distribution-docs
cost: { minutes: 19, tokens: 201466 }
id: l-e5b666b3
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - docs/README_ko.md
  - docs/VERSION_MANIFEST.md
  - docs/designs/2026-11-18-mcp-package-distribution-design.md
  - memory/2026-11-18.md
  - ".github/workflows/mcp-package.yml"
  - AGENTS.md
  - agents/pm.md
  - docs/governance/agents/execution-plan-templates.md
---

## Decided
MCP setup documentation is two dedicated guides in the manuals area, each with an English and Korean pair: one for users (token issuing, client config, troubleshooting) and one for admins (token policy, package release, secrets). They are linked from the docs hub manuals row and from the existing manuals' Related sections. The 90-day NPM_TOKEN rotation procedure is documented in the admin guide and the deployment runbook. Follow-up work starts only after PR #919 merges (sequential branch rule).

## Tried and ruled out
Adding sections to the existing business/admin/operations manuals instead of new files: dropped because the MCP topic spans both audiences and a standalone page is easier to link from the hub.
Stacking the follow-up on PR #919's branch: dropped to keep PR scope small and obey the one-open-PR-at-a-time rule.

## Watch out
The first npmjs publish of the package failed with E403 because NPM_TOKEN could not bypass 2FA. It must be a granular token with read-write on the package scope and bypass-2FA enabled. Such tokens expire after 90 days; the token set on 2026-11-18 lapses around 2027-02-16 (confirm the exact date on npmjs). An expired token shows up as the npmjs publish job failing while the GitHub Packages job still succeeds.
Registry reads returned 404 for several minutes after the first publish; that was propagation, not failure.

In the code:
- .github/workflows/mcp-package.yml (jobs publish-npmjs, publish)
- docs/designs/2026-11-18-mcp-package-distribution-design.md
- repo secrets NPM_TOKEN, MCP_PACKAGES_PAT
