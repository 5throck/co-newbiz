# Portfolio View Overlap Detection on Industry Keys — Design

- **Date**: 2026-10-11
- **Status**: draft (Design Gate Row 0)
- **Owner**: platform-lead
- **ADR**: none required (verified — see section 8)
- **Scope**: `/portfolio-view` strengthening per the 2026-10-11 decision to KEEP the screen as the group-oversight surface for group-review-agent / Group IC (ADR-0122 item 4), not merge it into `/deals`

## 1. Problem

`app/web-next/app/portfolio-view/page.tsx` (ADR-0122 #4) currently detects duplicate
market exposure by **exact string equality on `opportunity.market_scope`**, client-side.
Two defects:

1. **Weak key**: `market_scope` is free text. Two opportunities in the same industry
   with differently-worded scopes are missed; two coincidentally-identical strings in
   different industries are falsely grouped.
2. **Project exposure is invisible**: the project-side matching is a commented-out
   name-prefix approximation, correctly abandoned (per its own comment) as too
   error-prone. So S8+ promoted deals — the ones with real capital deployed — never
   appear in the overlap view.

## 2. Data-availability findings (verified)

| Carrier | Industry linkage | Source |
|---|---|---|
| Opportunity | `opportunity.industry_id` FK to `md_industry(id)` | migration `db/migrations/0126_opportunity_industry_fk.sql`. Backfilled **exact-match only** (one unique `md_industry.name_ko` = `market_scope`); anything unmappable is listed in `opportunity_industry_backfill_report` (`no_match` / `ambiguous`) — never guessed. Two triggers keep the FK derived for writers that still set only `market_scope`; an explicit `industry_id` write is never overwritten; a non-matching scope change resets the FK to NULL so a stale link cannot outlive its scope. |
| Project | `project_industry` binding rows | migration `db/migrations/0021_project_industry_binding.sql`. `project_id` x `industry_id`, `bound_by` / `bound_at` / `rationale`, `superseded_by` self-FK, live-rows unique index (`WHERE superseded_by IS NULL`). Binding is a **judged act** — no seed, no backfill, and live pilots may simply have none yet. |
| Industry | `md_industry` (`id`, `ksic_code` nullable per ADR-0111, `name_ko`, `name_en`) | migrations 0001 / 0078. `ksic_code` is unique when present but **may be NULL** — group by `md_industry.id`, not by KSIC code. |
| `GET /api/opportunities` | already returns `industry_id` | `app/web-next/app/api/opportunities/route.ts` SELECT. |
| `GET /api/projects` | returns only `listVisibleProjects` rows + `is_lead`; **no industry** | `app/web-next/app/api/projects/route.ts`. |

Consequences:
- The overlap key `md_industry.id` works on both carriers **today**. **No migration is
  needed**, hence no ADR.
- Opportunities can lack a pinned industry (NULL `industry_id` — e.g. `no_match`
  backfill rows or a scope written since without an exact match). These are honestly
  reported as N/A, never force-grouped.
- Projects without a live `project_industry` row are likewise N/A.
- Visibility: any portfolio-overlap read MUST respect `listVisibleProjects`
  (deny-by-default, `lib/project-visibility.ts`) on the project side; opportunities
  are visible to every authenticated business actor (existing list-route contract).

## 3. Overlap key and rule

**Primary key: `md_industry.id`** (shared between `opportunity.industry_id` and
`project_industry.industry_id`). Grouping is by industry id, not by KSIC code
(nullable) and not by name (not stable across locales/curation).

Precision tiers, kept **explicitly separated** in the response so consumers
(UI and group-review-agent) never blur them:

| Tier | Rule | Precision |
|---|---|---|
| `exact` | same `industry_id` on 2+ members | high — FK-verified identity |
| `name_prefix` | fallback: opportunities whose `industry_id` IS NULL but whose trimmed `market_scope` strings are identical, case- and whitespace-insensitively | low — free-text coincidence; the pre-existing behavior, demoted to a clearly-labeled fallback tier |
| n/a | single member, or no key at all | excluded from groups; surfaced in `na` bucket |

The fallback tier exists only so the current exact-scope dedup does not silently
regress; it is a separate array, never merged into the `exact` groups.

**Amendment (2026-10-11, Row 1 decision)**: the project side uses `includeClosed: true` — closed projects stay in exposure monitoring because they still carry deployed capital.

**Exposure filter**: `status != 'dropped'` opportunities (deleted_at NULL, following
the list route); all visible non-archived projects. One opportunity promoted to a
project (opportunity with `project_id` set, not deleted) counts on the **project**
side only, via its project's live bindings, to avoid double-counting the same case.

## 4. API: `GET /api/portfolio/overlap`

New read-only route (analyst+ read, `requireBusinessActor(ctx, "read")`; same
`authenticate` + `ok()` envelope as sibling routes). Rule lives server-side so it is
unit-testable and callable by group-review-agent (Row 1 also exposes the grouping
function from `app/web-next/lib/portfolio-overlap.ts` for direct reuse).

Response shape:

```jsonc
{
  "groups": [
    {
      "tier": "exact",                       // "exact" | "name_prefix"
      "industry": {                          // null for name_prefix tier
        "id": "ind_01J...",
        "name_ko": "...", "name_en": "...",
        "ksic_code": null                     // null = unpinned, shown as such
      },
      "key_label": "exact scope text",        // name_prefix tier only
      "members": [
        {
          "kind": "opportunity",              // "opportunity" | "project"
          "id": "01J...",
          "name": "...",
          "href": "/opportunities?opportunity=01J...",
          "status": "assessed",
          "industry_pinned": true             // false only in name_prefix tier
        }
        // project members: href "/projects/<id>/process", plus project_no/track
      ]
    }
  ],
  "na": {
    "opportunities_without_industry": [
      { "id": "01J...", "name": "...", "reason": "no_pinned_industry" }
    ],
    "projects_without_industry": [
      { "id": "01J...", "project_no": "...", "reason": "no_live_binding" }
    ]
  },
  "counts": {
    "active_opportunities": 0, "projects": 0,
    "exact_groups": 0, "name_prefix_groups": 0,
    "na_opportunities": 0, "na_projects": 0
  }
}
```

Implementation notes:
- One SQL pass for opportunities (id, name, market_scope, industry_id, status,
  project_id) and one for projects (`listVisibleProjects`) plus one for live
  `project_industry` rows restricted to those visible project ids; join `md_industry`
  for labels. No N+1.
- Promotion rule from section 3 applied in the query (`project_id IS NULL` for the
  opportunity pass).
- Route file: `app/web-next/app/api/portfolio/overlap/route.ts` (new sibling of the
  existing `backtest` / `pipeline` subroutes — no change to them).

## 5. UI changes on `/portfolio-view`

- Summary cards stay (three cards; the "market duplicate candidates" card now counts
  `exact_groups + name_prefix_groups` from the API).
- The duplicate section is replaced by a per-group list fetched from
  `/api/portfolio/overlap` (no more client-side grouping):
  - Group header: industry label via the glossary-backed helpers in
    `app/web-next/lib/labels.ts` (`name_en` primary, Korean name secondary where
    appropriate); KSIC code shown only when non-null, otherwise an explicit
    "KSIC unpinned" note.
  - Tier badge: `exact` groups and `name_prefix` groups visually separated, with a
    one-line precision note on the fallback tier (string-coincidence match, verify
    before acting).
  - Members: links to `/opportunities?opportunity=<id>` and
    `/projects/<id>/process`, same link style as today.
  - Framing line per group (proposal-only wording, boundary #2 — individual
    judgements remain Group IC's): "This group suggests a combined synergy review or
    timing coordination; the judgement belongs to Group IC." — English design text;
    rendered strings stay in the existing UI language.
- States: loading (PageState), empty (no groups — explain that no same-industry
  overlap exists among currently visible cases), and an N/A explainer listing
  opportunities/projects that could not be keyed (why: no pinned industry / no live
  industry binding), each with a pointer to where pinning happens (S1 industry
  pinning; S8+ project-industry binding) — never fabricate a group.
- Accessibility: section headings hierarchical (h1 page, h2 group section, h3 per
  group); tables keep `caption` / `aria-label`; tier badge conveys tier via text,
  not color alone; the horizontal-scroll table region keeps its `role="region"`,
  `aria-label`, and `tabIndex={0}` pattern; group list is keyboard-reachable with
  visible focus (existing tokens). Contrast per Onyx 3.0 tokens only (no hardcoded
  colors).

## 6. OpenAPI and tests

- OpenAPI: add `GET /api/portfolio/overlap` with the response schema of section 4
  (following wherever the sibling portfolio routes document themselves).
- Unit tests (`tests/unit/`, pattern of existing portfolio tests):
  - grouping: exact-tier multi-member group from shared `industry_id` across an
    opportunity and a project;
  - fallback separation: identical `market_scope` strings with NULL industry land in
    `name_prefix`, never merged into an exact group; case/whitespace-insensitive
    match;
  - promotion dedup: an opportunity with `project_id` set counts once (project side);
  - N/A: opportunity with NULL industry + non-matching scope; project with no live
    binding; empty input yields empty groups + counts;
  - `dropped` opportunities and `superseded_by`-set bindings excluded.
- Route tests: auth (401 unauthenticated, 403 viewer-write gate irrelevant — read
  allowed for business actors), envelope shape, visibility: a project not in
  `listVisibleProjects` for the caller never appears as a member.

## 7. Task split

| Row | Agent | Work |
|---|---|---|
| 1 | backend-engineer | `lib/portfolio-overlap.ts` grouping rule + `GET /api/portfolio/overlap` route + unit/route tests + OpenAPI entry |
| 2 | frontend-engineer | `/portfolio-view` wiring to the route, group list UI, labels/tier/N-A/empty states, preview verification |

## 8. ADR assessment

**No ADR required.** Verified: the opportunity-industry FK exists (migration 0126)
and the project-industry binding table exists (migration 0021). This design adds a
read-only route and a pure grouping function — no schema change, no auth-model
change, no MCP scope change; none of the project ADR triggers apply.

**Stop condition**: if implementation discovers either linkage table is missing or
unusable in the target environment, a migration becomes necessary — that makes an
ADR **mandatory**, and the design halts at that decision point for the human.

## 9. Non-goals

- No changes to `/deals` (the screens stay distinct by decision).
- No automatic judgements, scores, or RAG effects from overlap — the view is
  decision support; Group IC judges.
- No cross-project effect analysis beyond same-industry exposure (no synergy
  computation, no chain-propagation here).
- No backfill or auto-pinning of missing industry links (that is S1/S8 judged work).

## 10. Open questions

1. Should `name_prefix` fallback be kept at all after one release cycle, or dropped
   once the backfill report is cleared? (Default: keep, tier-separated; revisit.)
2. Should the group-review-agent consume the route via MCP or call
   `lib/portfolio-overlap.ts` directly? (Default: the lib is importable; MCP exposure
   is out of scope here.)
3. Does the summary card set need a fourth card for N/A counts, or is the N/A
   explainer section enough? (Default: enough; decide at Row 2 review.)
   Amendment: no fourth card was added; the N/A section lists every item and the
   hidden-promoted notice, empty-state branches and limits note carry the signal.

## 11. Preview verification note

Row 2 must verify the screen at >= 2 breakpoints (desktop and one narrow viewport)
including the tier badge wrap behavior, member-link list wrapping, and the
horizontal-scroll table region fallback; capture both the populated and empty/N-A
states.

## 12. Accessibility

Covered in section 5 (heading hierarchy, table captions, text-not-color tier badges,
keyboard reachability, visible focus, Onyx 3.0 token contrast only).
