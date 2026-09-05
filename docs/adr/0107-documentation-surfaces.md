# ADR-0107: Documentation surfaces — knowledge-hub portal, platform handbook, and web library role separation

- Status: **Superseded by ADR-0108** (2026-09-06) — the knowledge-hub static portal this ADR carved out as a distinct surface was retired; `/library` is now the single documentation surface. Kept for history.
- Date: 2026-09-05
- Deciders: New Business Review Lead (PM), per user direction
- Related: ADR-0091 (role separation), ADR-0105 (navigation SSOT), ADR-0106 (deal structuring stage), governance-document-hierarchy (skills/), CLAUDE.md "procedures/*.yaml is authoritative"

## Context

The workspace now has three documentation surfaces, and without an explicit
decision their overlap caused confusion (observed during the knowledge-hub
pilot review, 2026-09-05):

- **Web app library screen** (`/library`, `app/web-next/lib/library.ts`) —
  reads repository originals live for operators mid-deal.
- **knowledge-hub portal** (`knowledge-hub/`, PRs #216~#226) — version-pinned
  static snapshot site generated from the same originals, intended for
  onboarding and distribution.
- **handbook site** (`handbook/`, PR #213) — a narrative onboarding handbook
  built from the manuals, predating the portal.

Additionally the portal's menu is category-centric (8 categories) while the
web app menu keeps its own grouping (ADR-0105), and the user asked for this
relationship to be explicit.

## Decision

1. **Three surfaces, three roles:**
   - **Repository originals** (procedures/*.yaml, checklists/*.yaml,
     policies/, docs/, templates/) are the ONLY authority. In any conflict
     the original prevails.
   - **Web app library screen** = live read for operators during a deal.
     Always current; part of the working UI.
   - **knowledge-hub portal** = version-pinned static snapshot for onboarding
     and distribution. Every page stamps governance_doc_id, version, source
     path, and a source SHA-256 short hash; the build fails on stale sources
     (`--check`). Its menu is category-centric (8 categories), per user
     decision — distinct from the web app menu's grouping, which stays as-is
     (ADR-0105).
   - **handbook site** = narrative platform onboarding guide (concepts,
     screens, first walkthrough). It does not attempt to mirror the corpus.
2. **Portal generation is generator-only**: pages under knowledge-hub/docs
   are build artifacts of `knowledge-hub/scripts/generate-portal.ts` and are
   never hand-edited.
3. **Cross-surface navigation**: the web app "문서·규정" menu links to the
   portal distribution path; the portal links back to the web app screen for
   the live view.

## Consequences

- Docs authors follow `manual-authoring`; rendering is handbook-toolkit only.
- Original changes require portal regeneration in the same PR (hash gate).
- The web app library screen remains the "latest" surface; the portal's
  banner says so explicitly.

## Rejected alternatives

- Merging the portal into the web app library screen — rejected: the portal
  must be distributable/readable without running the deal platform.
- Keeping two independent grouping schemes inside the portal — rejected by
  user decision (category-centric only).
