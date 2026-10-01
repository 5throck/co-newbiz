---
title: Route Cleanup Follow-up Design (F4 legacy routes)
date: 2026-10-02
status: approved
owner: platform-lead
design_gate: Row 0 (platform-lead acts as Design Gate owner)
---

# Route Cleanup Follow-up Design

## 1. Purpose and Scope

This design cleans up the legacy flat routes found in the F4 route audit of
`docs/designs/2026-10-01-s1-s12-process-alignment-design.md` (Row 5 audit, dated 2026-10-01).
It has two work items: dead code removal and flat-route redirect unification.
It implements no policy change and no data change.

| Item | In scope | Out of scope |
|---|---|---|
| `STAGE_LINK` map removal in `/deals/[id]/[stage]/page.tsx` | Yes | Any stage page logic change |
| `STAGE_ROUTES` twin map in `/deals/[id]/page.tsx` | Consumer check, then removal if dead | Overview page redesign |
| Redirect of `/market`, `/opportunities`, `/synergy`, `/greenfield`, `/brownfield` | Yes | Keeping the flat screens |
| Carrier-resolution rule for redirect targets without a deal id | Yes (rule specified here) | New backend endpoints |
| `/route-decision` entry path | Unchanged in this spec | Future decision (open decision 3) |
| `/opportunities/[id]` standalone S2 detail | Unchanged (ADR-0127) | — |

## 2. Input Evidence (cited, not redone)

The Row 5 audit in `2026-10-01-s1-s12-process-alignment-design.md` (F4) found:

| Finding | Evidence |
|---|---|
| `STAGE_LINK` is dead code | `app/web-next/app/deals/[id]/[stage]/page.tsx:30-37` (map). Sole consumer is `StageGuidanceTab` at `:234`, reachable only for valid stage ids. Valid stage ids never render the legacy targets, because the stage tab already renders the stage component itself. |
| Twin map `STAGE_ROUTES` exists | `app/web-next/app/deals/[id]/page.tsx:25-33`. Same shape as `STAGE_LINK`. Consumer: `routeFor` at `:53`. |
| `/route-decision` already redirects | `app/web-next/app/route-decision/page.tsx:34-37` (`?opportunity=` links redirect to `/deals/{id}/s4`); bare entry shows a picker of selected opportunities. |

## 3. Work Item 1 — Dead Code Removal

### 3.1 STAGE_LINK (removal confirmed)

Remove the `STAGE_LINK` map and the `StageGuidanceTab` consumer block in
`app/web-next/app/deals/[id]/[stage]/page.tsx` (~lines 30-37, ~234).
The map duplicates route knowledge that the deal-carrier tabs now own.
No other file references `STAGE_LINK` (verified 2026-10-02 with repo-wide grep).

### 3.2 STAGE_ROUTES (consumer check first)

The task mandates a consumer check before proposing removal.
`STAGE_ROUTES` feeds `routeFor` at `app/web-next/app/deals/[id]/page.tsx:53`,
and `routeFor` renders a link on the deal overview page. The check is:

1. Find every render site of `routeFor` in `app/deals/[id]/page.tsx`.
2. If `routeFor` renders a navigation link to a flat route, the link is stale
   the moment Work Item 2 removes the flat routes.
3. Outcome A: if the only consumer is a legacy "go to current stage" link,
   remove `STAGE_ROUTES`, `routeFor`, and that link in PR B.
   Outcome B: if the overview needs the link, repoint it to
   `/deals/{id}/s{currentStage}` (the deal-carrier form) and drop `STAGE_ROUTES`.

The implementation row records the check result in the PR description before editing.

## 4. Work Item 2 — Flat-Route Redirect Unification

### 4.1 Problem

The five flat routes render the same shared `components/stages/*Stage.tsx`
components as the `/deals/{id}/sN` tabs. Two copies of navigation state exist.
The tabs are per-deal; the flat routes are global pages. A redirect needs a
deal carrier, but a flat-route visitor (bookmark, sidebar, old link) carries
no deal id.

### 4.2 Carrier-Resolution Rule (specified)

Reuse the pattern proven in `/route-decision/page.tsx`: redirect when a carrier
is known; show a picker when it is not. The exact rule:

1. Query-string carrier: if the request carries `?opportunity=<id>` (or
   `?deal=<id>`), redirect straight to `/deals/<id>/sN` (preserving any extra
   query params, as `/route-decision` does with `rationale`).
2. Auto-resolution: otherwise fetch the visitor's opportunities. Pick the
   single most recent in-progress opportunity per track:
   - status `selected` or later (promoted projects included, matching the
     `includePromoted=1` query in `/route-decision`),
   - `deleted_at` null,
   - newest `updated_at` first.
   - Track mapping: `/greenfield` picks a greenfield-track carrier;
     `/brownfield` a brownfield-track carrier; `/market`, `/opportunities`,
     `/synergy` accept any track (they precede track branching in S1-S3).
3. Redirect: if exactly one carrier resolves, redirect (HTTP-level for a
   server component, `router.replace` for a client component) to
   `/deals/<id>/sN`.
4. Picker fallback: if zero or multiple carriers resolve, render a picker page
   in the `/route-decision` style (reuse its list markup and empty state).
   Keyboard focus lands on the first row. Each row links to `/deals/<id>/sN`.
5. No redirect loop: `/deals/<id>/sN` must never link back to the flat route.
   The sidebar (Work Item 2.3) removes those links in the same PR.

| Flat route | Stage tab target | Track rule |
|---|---|---|
| `/market` | `/deals/<id>/s1` | any track |
| `/opportunities` | `/deals/<id>/s2` | any track |
| `/synergy` | `/deals/<id>/s3` | any track |
| `/greenfield` | `/deals/<id>/s5` | greenfield |
| `/brownfield` | `/deals/<id>/s6` (S7 reachable from the tab bar) | brownfield |

### 4.3 Inbound Link Updates (same PR, coordinated)

Every live inbound link to a flat route changes to the deal-carrier form, or
to the redirecting page when no carrier exists at authoring time:

| File | Link to update |
|---|---|
| `lib/navigation.ts` (sidebar, ~lines 41-50) | Sidebar entries point at `/deals` list or a picker route, not `/market` etc. |
| `lib/pipeline.ts` (`nextAction`) | Point `nextAction` hrefs at `/deals/<id>/sN`. |
| `components/StageFrame.tsx` (link map) | Replace flat targets with carrier tabs. |
| `components/AppShell.tsx` (icon map, fullscreen map) | Update keys for removed routes; remove entries only if the routes are deleted, never silently. |
| `components/stages/MarketAnalysisStage.tsx`, `SynergyStage.tsx`, `RouteDecisionStage.tsx`, `OpportunityFunnelStage.tsx`, `OurCompanyStage.tsx` | Cross-links to sibling flat routes become carrier-tab links. |
| `components/PromotionPanel.tsx` | Same treatment. |
| `app/deals/page.tsx`, `app/onboarding/page.tsx`, `app/process/[stage]/page.tsx`, `app/opportunities/[id]/page.tsx` | Same treatment. |

### 4.4 Unchanged Routes

| Route | Reason |
|---|---|
| `/route-decision` | No-deal-id entry path by design. Its picker is the reused pattern. Its future is open decision 3. |
| `/opportunities/[id]` | Standalone S2 detail surface per ADR-0127. |
| `/projects/[id]/...` | Out of scope (S8+ already deal/project-carried). |

## 5. PR Split (recommendation)

**Recommendation: two PRs, sequential — PR A then PR B, each merged before the next branches.**

| PR | Content | Files |
|---|---|---|
| A | `STAGE_LINK` removal (+ `STAGE_ROUTES` per the §3.2 check outcome) | `app/deals/[id]/[stage]/page.tsx`, `app/deals/[id]/page.tsx` |
| B | Five flat-route redirects, carrier-resolution rule, inbound link updates | `app/market|opportunities|synergy|greenfield|brownfield/page.tsx`, `lib/navigation.ts`, `lib/pipeline.ts`, `components/**`, four app pages |

Rationale: the Row 1 file set (deal pages) and the Row 2 file set (flat routes,
nav, components) barely overlap, so each PR is small and reviewable.
The sequential-branch rule (CONSTITUTION.md §3.3) makes parallel branching
costly; two sequential PRs cost one extra merge cycle and buy clean revert
boundaries. PR A is pure dead code — zero behavior change — so it is safe to
land first and de-risks PR B's diff.

## 6. Accessibility (per ADR-0065)

Redirects are navigation-only; no new interactive components exist except the
picker fallback, which reuses the `/route-decision` picker pattern.

| Interaction area | Requirement |
|---|---|
| Focus loss on redirect | After `router.replace`, move focus to the stage tab heading (`tabIndex={-1}` + `focus()`), so keyboard users do not lose their place. Server redirects preserve normal focus flow to the new document. |
| Screen-reader announcement of page change | Client-side `router.replace` must trigger a route-change announcement (the app's existing route-announcement mechanism); verify the stage tab `<h1>` updates. |
| Keyboard reachability of the picker | Picker rows are real links in DOM order, reachable with Tab, with a visible focus ring per Onyx 3.0; the empty state is plain text, no interactive dead ends. |
| Redirect loop safety for AT users | Loops are also an accessibility failure; the no-loop rule in §4.2.5 is verified in the rendered check. |

## 7. Preview Verification (per ADR-0070)

Rendered checks at >=2 breakpoints (e.g. 1280px and 390px), >=1 key interaction:

1. Carrier-resolution rendered check (the key interaction): with two seeded
   opportunities, hit `/market` and confirm the redirect lands on the
   newest in-progress carrier's `/deals/<id>/s1` tab; with zero carriers,
   confirm the picker renders.
2. Confirm each of the five flat routes resolves or picks (desktop + mobile widths).
3. Confirm no console error and no redirect loop.
4. Confirm `/route-decision` and `/opportunities/[id]` render unchanged.

## 8. Execution Plan

PM running on: GLM-5.3-Flash[1m]

| # | Task | Agent | Tier | Model | Spec |
|---|------|-------|------|-------|------|
| 0 | This design doc (Design Gate) | platform-lead | High | opus | NEW |
| 1 | PR A: `STAGE_LINK` removal; run and record the §3.2 `STAGE_ROUTES` consumer check; remove per outcome A or B | frontend-engineer | Medium | sonnet | 2026-10-02-route-cleanup-followup-design |
| 2 | PR B: five redirects with the §4.2 carrier-resolution rule; coordinated inbound link updates (§4.3); picker fallback | frontend-engineer | Medium | sonnet | 2026-10-02-route-cleanup-followup-design |
| 3 | Rendered checks per §7; record results in the PR description | frontend-engineer | Medium | sonnet | 2026-10-02-route-cleanup-followup-design |
| 4 | Update `docs/designs/2026-09-12-implementation-matrix.md` route table with the post-cleanup state | docs-writer | Medium | sonnet | 2026-10-02-route-cleanup-followup-design |
| N | `/sync` per PR — lifecycle + audit + commit + push + PR | pm | Medium | sonnet | |

**Execution Order**: Sequential. Row 1 (PR A) merges before Row 2 (PR B) branches.
Row 3 rides PR B. Row 4 follows Row 2. Row N runs once per PR.

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Broken deep links to flat routes | Users hit 404 | Redirect pages remain at the same URLs; grep-verify zero remaining internal links before merge. |
| SEO/bookmarks of flat routes | Stale external entries | Server-side or `router.replace` redirect preserves the URL contract; no 404. |
| AppShell fullscreen map misses | Wrong chrome on redirected tabs | The map update is in the same PR; rendered check at both breakpoints catches a miss. |
| Redirect loops | Unusable page; AT failure | §4.2.5 rule: tabs never link back; rendered check 3 verifies. |
| Wrong auto-resolved carrier | User lands on another deal's stage | Picker shows whenever the carrier is ambiguous; track mapping limits false picks. |

## 10. Open Decisions (for the human)

1. Approve the PR split (two sequential PRs: A dead code, B redirects) — §5.
2. Approve the carrier-resolution rule (query-string carrier, else most
   recent in-progress per track, else picker) — §4.2.
3. Decide the future of the `/route-decision` entry path: keep as the
   permanent no-carrier entry, or fold its picker into a shared carrier-picker
   route later. This spec keeps it unchanged.
