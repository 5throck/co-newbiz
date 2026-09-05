# ADR-0108: Single documentation surface — retire the static knowledge-hub portal, extend `/library`

- Status: Accepted
- Date: 2026-09-06
- Deciders: New Business Review Lead (PM), per user direction
- Related: ADR-0107 (superseded by this ADR), ADR-0105 (navigation SSOT), ADR-0091 (role separation)

## Context

ADR-0107 established three documentation surfaces: the web app's `/library`
screen (live read of repository originals), a separately built static
`knowledge-hub` portal (`knowledge-hub/scripts/generate-portal.ts` → 1,500
pre-rendered HTML pages, copied into `app/web-next/public/knowledge-hub/`),
and the unrelated onboarding `handbook/` site.

In practice the static portal caused exactly the problems a second build
pipeline for the same content tends to cause:

- **No single source of truth.** The same repository files (`policies/*.md`,
  `checklists/*.yaml`, `knowledge-hub/content/*.md`, …) were read live by
  `lib/library.ts` for `/library` **and** re-baked at build time into
  `knowledge-hub/docs/`, which was then copied a second time into
  `app/web-next/public/knowledge-hub/`. Three copies of the same content
  could silently drift; the copy step was a manual `bun run
  knowledge-hub:build && bun run knowledge-hub:copy` that was easy to forget.
- **A second, disconnected web surface.** `public/knowledge-hub/` was served
  as plain static files, entirely outside the Next.js app's layout — its own
  header, its own dark-mode toggle (`dark-mode-toggle.js`), its own language
  switcher (`lang-switcher.js`), none of it sharing `components/AppShell.tsx`
  or `components/ThemeToggle.tsx`. Users experienced it as a second website
  bolted onto the first, with visibly different chrome.
- **Structurally oversized per-chapter navigation.** The generator split each
  document into H2-bounded "chapters" and appended a prev/next card nav
  (`.chapter-nav`) to every one. Below an 800px viewport a media query
  switched that nav to `flex-direction: column`, stacking the prev/next
  cards into a disproportionately tall block relative to the actual content.
  `/library`'s list+detail view has no chapter-splitting concept and cannot
  exhibit this.
- **A broken, mismatched language switcher.** `lang-switcher.js` was a
  generic script (`co-deck` origin) whose convention is "no suffix = default
  language, `_ko`/`_en`/`_ja` = variants." co-newbiz's actual generator
  convention is the reverse ("no suffix = Korean, `_en`/`_ja`/`_es` =
  variants") — so the switcher mislabeled the Korean page as "Default" and
  offered a `_ko` variant that never existed. Meanwhile every variant only
  ever translated the surrounding chrome; the document body was always
  Korean, so the feature was not real localization to begin with, and it did
  not match the reference design's simpler `<select>` + icon-button styling
  either.

## Decision

1. **Repository originals are the only source of truth** — unchanged from
   ADR-0107. `policies/`, `procedures/*.yaml`, `checklists/*.yaml`,
   `docs/manuals/*.md`, `docs/*.md`, `templates/deliverables/*.md`, and
   `knowledge-hub/content/*.md` (design guide + DD methodology, kept in
   place) remain authoritative.
2. **`/library` is the single live documentation surface.** `lib/library.ts`
   is extended from 3 categories (checklist/manual/policy) to 8
   (+ procedure/reference/template/design/dd), covering everything the
   retired portal covered. `app/library/page.tsx` gains matching tabs and
   renders Markdown via `marked` (CommonMark tables included — the doc set
   uses tables extensively and the previous hand-rolled parser did not
   support them).
3. **The static portal generator, its output, and its public copy are
   deleted**: `knowledge-hub/scripts/`, `knowledge-hub/docs/`,
   `knowledge-hub/package.json`, `knowledge-hub/sources-hashes.json`,
   `knowledge-hub/.github/workflows/validate-handbook.yml`,
   `app/web-next/public/knowledge-hub/`, and the root `package.json`
   `knowledge-hub:build`/`knowledge-hub:copy` scripts. `knowledge-hub/content/`
   and `knowledge-hub/research/` are kept — they are real source content and
   citation notes, not build artifacts.
4. **No chrome-only i18n.** The document body was always Korean regardless
   of the chrome language selected; a language switcher over untranslated
   content is not real localization. `/library` uses the app's single
   `components/ThemeToggle.tsx` for dark/light, matching every other screen
   in the app, and has no language switcher.
5. **Navigation**: `lib/navigation.ts`'s `{ href: "/knowledge-hub/" }` entry
   is removed; `/library`'s label changes from "문서·규정" to "문서 허브" to
   reflect its widened scope. `tests/unit/navigation.test.ts`'s
   `STATIC_PUBLIC_HREFS` exemption (added for the static portal) is removed.

## Consequences

- One fewer build step, one fewer place for content to drift, one fewer set
  of UI chrome to keep visually consistent with the rest of the app.
- Procedures are shown as raw YAML text through the same viewer as
  checklists (which already got this treatment) rather than a bespoke
  step-table renderer — consistent with existing `/library` behavior, kept
  deliberately simple rather than porting the retired generator's
  `renderProcedure()` HTML-table logic.
- Any future real localization of document bodies is a separate decision,
  made when translated content actually exists — not before.

## Rejected alternatives

- **Fixing the static portal's bugs in place** (correct the language
  switcher, cap the chapter-nav height, wire its theme to Onyx) — rejected:
  it would leave the three-copy SSOT problem and the disconnected-web-service
  problem untouched, which were the primary complaints.
- **Keeping the static portal for "distributable, app-independent" reading**
  (ADR-0107's original rationale) — rejected by explicit user decision: the
  document set is now large enough (~90 documents) and specific enough to
  co-newbiz's own live process state that a snapshot artifact adds
  maintenance cost without a corresponding audience who needs the app-free
  version.
