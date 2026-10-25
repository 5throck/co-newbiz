---
title: "Follow-up hardening batch — typecheck ratchet restore, CSS font floor, documentation follow-ups — design"
date: 2026-10-25
status: implemented
owner: process-governance-manager
reviewers: unassigned (AI 2nd performed in-batch; human final at PR merge)
lang: en
---

# Follow-up hardening batch — design

- **Spec ID**: `2026-10-25-followup-hardening-ratchet-css-docs-design`
- **Status**: implemented — all three rows landed in the working tree before this registration; gates green.
- **Related documents**: CHANGELOG.md [2026-10-25] entries (the /library batch that recorded these residuals as follow-ups), design `2026-10-08-wave-u-ux-overhaul-design.md` (0.875rem floor + token-sweep doctrine — governs the CSS row), `quality/typecheck-baseline.json` (the ratchet this batch restores), `docs/adr/0160/0161/0162` (Accepted — the statuses the docs row pins).

## 1. Background

Three recorded debts converged into one follow-up batch:

1. **Root typecheck ratchet red (9 error groups)** — merge residue from the 2026-10-24 bulk sync: duplicate imports, dead spread overrides, call-signature casts, and two `.tsx` imports in `useRouteDecision.ts` that the module-graph test drags into the jsx-less root program (TS6142 there only).
2. **CSS font floor residuals** — four off-token body-size literals (`.dd-item-text`, `.activity-label`, `.funnel-card-name` at 0.88rem; `.process-card strong` at 0.92rem) outside the /library batch's `.library-doc-body` scope.
3. **Documentation follow-ups** recorded by the /library batch: `process-map_ko.md` parity gaps (ADR-0160/0161/0162 sections), `archive-manual.md` Korean FAQ, malformed `_ko` manual frontmatter, two stale ADR-0161 comment flips, one mislabeled projection language.

## 2. Decisions

- **D1 (ratchet)**: fix at source, not baseline-suppress — the TS6142 imports get paired `biome-ignore lint/suspicious/noTsIgnore` + `@ts-ignore` (comments only; the runtime import graph is unchanged), the dead-arg `loadBaseline()` call drops the argument, and the seven test files get duplicate-import removals, dead-property removals, corrected casts, and a typed fixture helper. The ratchet then improved one further group (`process-flow.test.ts|TS2352` 2→0); the baseline is shrunk via `--update` (allowlist only ever shrinks).
- **D2 (CSS)**: fold the four literals to `var(--fs-body)` (0.875rem) per the wave-U floor doctrine. Residual `.market-sub-section h3` (0.92rem, line 3222) is recorded for PM — outside the four named sites. (resolved 2026-10-25 by the design-lint rule-6 stream — see its CHANGELOG entry)
- **D3 (docs)**: translations match the English source line-for-line with UI strings kept parenthetical; `_ko` frontmatter normalizes to the single-fence `lang`/`counterpart` convention; the checklist ADR-0161 flips are comment-only (statuses match `docs/adr`); the projection `proc-greenfield-capability-assessment` relabels lang en→ko (25.9% Hangul body).

## 3. Scope

Row 1: `useRouteDecision.ts`, `i18n-lint.ts`, 7 test files, `quality/typecheck-baseline.json`. Row 2: `app/web-next/app/styles.css`. Row 3: `process-map_ko.md`, `archive-manual.md`, 3 `_ko` manuals, 2 checklists, `library.generated.ts`.

## 4. Verification gates

`bun run test:unit`; `bun run typecheck` (baseline shrunk, no new errors); `bunx tsc --noEmit` in app/web-next; `bun scripts/audit.ts`; `bun scripts/co-newbiz/sync-library-projection.ts --check`; `bun scripts/design-lint.ts`; `bun scripts/validate-docs-links.ts --dir docs/governance --dir docs/manuals`. AI 2nd review (process-governance-manager): three sub-rows PASS, five factual flips spot-verified.
