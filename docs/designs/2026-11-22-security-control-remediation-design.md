---
lang: en
date: 2026-11-22
status: implemented
owner: backend-engineer-agent (dispatched on project-review findings F-1/F-2/F-11; F-1 amendment of record DEC-20261122-01)
related: docs/decisions/DEC-20261122-01.md, scripts/co-newbiz/lint-server-boundary.ts, scripts/co-newbiz/audit-variant.ts, app/web-next/lib/carrier-resolve.ts, app/web-next/lib/project-visibility.ts, app/web-next/app/api/projects/[id]/share-links/route.ts, docs/security/security-model.md
spec: security-control-remediation
---

# Design — Security control remediation (F-1 / F-2 / F-11, review 2026-11-22)

One dispatch, three security-control findings from
`docs/reports/2026-11-22-project-review-full.md`. F-1 is executed under the
ruling of record `docs/decisions/DEC-20261122-01.md` (ADR-0070 amendment,
ACCEPTED, recorded before this implementation dispatch) — this doc records the
implementation, it does not re-litigate the ruling.

## F-1 — ADR-0070 boundary per DEC-20261122-01 (AMEND + closed allowlist)

**Current state.** `planCarrierPage` (app/web-next/lib/carrier-resolve.ts:130)
resolved rows for ANY valid session while all three carrier APIs deny admin
(`requireBusinessActor(auth, "read")` → 403 `role_forbidden`, FR-SEC-02) — the
CR-1 drift. The lint existed but was wired to nothing (the audit.ts 2.15.0
wiring died in the 2026-08-29 upgrade wave), Rule 2 was zero-violation mode
(permanently red over the 5 sanctioned pages), and ADR-0070:3 / SCRIPTS.md:95
still claimed the dead wiring.

**Change.**
1. **CR-1** — `planCarrierPage` skips server-side resolution for `admin`
   sessions (`carrier-resolve.ts`): rows stay null, the client fallback fetches
   through the API and receives the pre-#862 `role_forbidden`. Viewer/analyst
   parity untouched.
2. **Allowlist lint** — `scripts/co-newbiz/lint-server-boundary.ts` v1.1.0:
   Rule 1 ("use server" + data access) absolute, unchanged; Rule 2 =
   violation UNLESS the file is in `SANCTIONED_PAGE_ALLOWLIST` (exactly the
   five carrier page.tsx per the DEC) AND every data-access import stays in
   the frozen module set {`db/client.ts` (getDb), `lib/carrier-resolve.ts`,
   `lib/rsc-session.ts`} (any `db/lib/**`, `db/repositories/**`,
   `@prisma/client`, or non-frozen `lib/**` import in an allowlisted page is a
   violation) AND the file carries no write-SQL shape (INSERT INTO / UPDATE␠ /
   DELETE FROM / PRAGMA / ATTACH). Allowlist grows only via a recorded DEC.
3. **Blocking wiring** — `scripts/co-newbiz/audit-variant.ts` v1.11.0 gains the
   `runServerBoundaryGate` subprocess check (route-audit-scan pattern; missing
   script = visible skip for non-web contexts), so the gate blocks dev-sync +
   audit from the variant-owned hook that survives upgrade waves.
4. **CR-3 pin** — `tests/unit/carrier-resolve.test.ts` CR-3 describe: live
   dispatch to the real Route Handlers on the same scratch SQLite asserts
   `resolveCarriers` row-set (and distinct-timestamp order) identity with
   GET `/api/opportunities?status=selected&includePromoted=1` and the
   greenfield/brownfield GETs; a CR-1 describe pins the admin behavior and the
   API-side 403.
5. **CR-5 truth** — ADR-0070:3 rewritten (loss + amendment + audit-variant.ts
   re-homing recorded); SCRIPTS.md lint row → v1.1.0 allowlist-mode text wired
   via audit-variant.ts; audit-variant row → v1.11.0 changelog appended.

**Acceptance.** Lint exits 0 on the live tree (1147 files, 5 sanctioned
pages); audit-variant.ts passes with the gate listed as a check; synthetic
violations (6th page import, `db/lib` import in an allowlisted page, write-SQL
shape, "use server" + data access) each fail; carrier suite 23/23 green.

## F-2 — MNPI MCP default-exclusion (FR-SYS-02 / ADR-0040)

**Current state.** Every production call site passed `excludeMnpi:false`; the
audited `mnpiScopeOverrideBy` hook had no production caller; security-model §7
evidence cited tests/paths that do not exist (api.test.ts / mcp.test.ts have
zero MNPI references; app/server/ removed by ADR-0069).

**Change.** The exclusion is wired BY PRINCIPAL at the one seam every project
read already crosses — `app/web-next/lib/project-visibility.ts`:
`mnpiExclusionFor(ctx, override)` returns `excludeMnpi:true` for machine
principals (in-process MCP port, `callPathOf(ctx) === "mcp"`, and any bearer
caller `auth.via === "bearer"` — the stdio MCP server's REST client presents
exactly this) and `false` for cookie sessions (unchanged: membership + MNPI
banner, security-model §6). `visibleProject` (all ~120 project routes) and the
new `listVisibleProjectsFor(ctx)` (the two list call sites:
`api/projects/route.ts`, `api/portfolio/overlap/route.ts`) consume it.

The override is the review's "scoped override" option, implemented as an
explicit per-call flag (`mnpiScopeOverride`) reachable from production via
`GET /api/projects?include_mnpi=1` — machine-principals only (a cookie request
carrying the param is ignored, no audit); when it fires, every disclosed
flagged project lands the audited `mnpi_scope_override` row
(`mnpiScopeOverrideBy = ctx.userId` through the existing repository hook,
project.repository.ts:448) plus the FR-SEC-06 `data_access_log` read rows. No
new token-scope vocabulary was added: the audit row + read log make each
disclosure traceable, which is the control FR-SEC-06 requires; widening
`api_token.scopes` is a schema-adjacent change left to a future decision if
per-token MNPI grants are ever needed.

**Live control test** — `tests/unit/mnpi-mcp-exclusion.test.ts` (real HTTP
server + nextFetch dispatch, real bearer tokens, MCP dispatch over the wire,
in-process "mcp" path through principal-context's documented
`runAsPrincipal` seam): (a) flagged project absent from bearer listing,
404 `not_found` on the `get_portfolio_scorecard` MCP detail dispatch, absent
from the runAsPrincipal listing — and zero `mnpi_scope_override` rows;
(b) present under `?include_mnpi=1` with the audit row (actor + target) and a
`data_access_log` read row; (c) cookie session still sees it, param ignored
machine-only. The test header records the pre-fix behavior (flagged project
served to machine principals with no audit — control (a) fails on the old
tree).

**security-model.md** — §7 evidence rows 1/2/4/7 regenerated against the live
tree (new control test + admin-business-read-guard + GET-only audit-log
route); the pre-existing mojibake in untouched rows is out of scope.

**Acceptance.** mnpi-mcp-exclusion.test.ts 7/7; mcp.test.ts 15/15 (ADR-0011
import-scan backstop included); security.test.ts 48/48 (§7-4 repository-layer
pins intact).

## F-11 — share-link MNPI gate

**Current state.** POST `/api/projects/[id]/share-links` checked role +
visibility only; `GET /api/share/[token]` serves flagged-project snapshots
unauthenticated — the leak class the review flagged.

**Change (tier-consistent option).** Of the two options the review offered —
(a) blanket refusal `403 mnpi_share_blocked`, or (b) live-insider-status +
audit — the gate implements (a), the stricter one, per security-model §6's
posture that MNPI never leaves the wall through unauthenticated external
delivery regardless of insider status: the check reads
`project_classification.mnpi_flag` after the visibility gate and before body
validation; (b) would re-admit an external, non-watermark-guaranteed channel
for insiders and needs an insider-list read on every mint for strictly less
protection. The rule is stated in security-model §6 (one line) and the
api-spec §3 share-links row (one line; the finding's "§4" pointer resolves to
§6 MNPI Handling, the section that owns MNPI rules); openapi.yaml's
`createProjectShareLink` gains the 403 response.

**Test** — `tests/unit/share-link-mnpi-gate.test.ts`: flagged → 403
`mnpi_share_blocked` with no share_link row and no `share_link.create` audit;
non-flagged → 201 unchanged (row + audit land); bearer POST on a flagged
project → 404 (F-2 layer in front — defense in depth, documented).

**Acceptance.** share-link-mnpi-gate.test.ts 3/3.

## Non-goals

- No refactor of the carrier SQL into a shared repository module (DEC
  alternative 4 — discretionary; CR-3's test pin secures the property).
- No new token scope vocabulary for MNPI (see F-2).
- No changes to memory/*.md, CHANGELOG.md, process/flow.spec.yaml; no commits
  (/sync owns the branch).
