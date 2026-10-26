---
title: "Axe sweep remediation (R2-C light/dark/390px) — design"
date: 2026-10-26
status: approved
author: design-system-agent
design_of_record:
  - "docs/design-system/design-accessibility.md"
  - "docs/design-system/design-tokens.md"
  - "tests/scenarios/axe-sweep.test.ts"
lang: en
---

# Axe sweep remediation (R2-C light/dark/390px) — design

## Background and scope

`tests/scenarios/axe-sweep.test.ts` (R2-C) is red on three of four tests (run 2026-10-26, command `bun test tests/scenarios/axe-sweep.test.ts`, 70 routes per theme, 390px overflow over 69 routes). The h1/title contract test passes. This document gives the root cause, fix, affected surfaces and acceptance criteria for every failure. All four findings are violations of the existing system (not gaps): the existing tokens and components already cover each fix, so **no new token is proposed and no owner input on tokens is needed**. Scope is conformance only; implementation is by `frontend-engineer`. Out of scope: redesign of any screen, new components.

## Current complete violation list (2026-10-26)

| ID | Test | Route | Rule | Nodes | Values |
|---|---|---|---|---|---|
| F-1 | light + dark axe | `/projects/<P>/dd` | `label-content-name-mismatch` (serious) | 5 | `.btn-ghost.btn-sm` carrying the ko `judgement` title (the not-applicable judgement tooltip) in the judgement-record cell (`td[data-label]`) |
| F-2 | light + dark axe | `/projects/<P>/business-case` | `color-contrast` (serious) | 1 | `.text-[color:var(--warning)]`, #b86f0a on #ffffff = 3.95; on #171b22 = 4.37 (bold 13px) |
| F-3 | light + dark axe | `/projects/<P>/risk-heatmap` | `color-contrast` (serious) | 2 | `.status-chip` inside the risk list section (`section[aria-label]`), fg #ffffff on #f6f7f9 = 1.07 (light); fg #171b22 on #0a0c10 = 1.13 (dark) |
| F-4 | 390px overflow | `/projects/<P>/portfolio` | horizontal overflow | scrollWidth 418 vs 390 (+28px) | one unbreakable string in the transition-decision form |

No other routes fail (light: 3 rules / 8 nodes; dark: 3 rules / 8 nodes; 390px: 1 offender).

## F-1: DD "not applicable" buttons — label-content-name-mismatch

- **Root cause.** `app/web-next/components/stages/DdStage.tsx:825` (checklist rows) and `:862` (custom rows) render visible text `t("notApplicable2")` / `t("notApplicable3")` = the ko not-applicable button label, written without an inner space (`app/web-next/locales/ko.json:5801-5802`) but set `aria-label={t("markP1NotApplicable"/"markP1NotApplicable2", { p1 })}` = the ko "{p1} not applicable judgement" string, written with a space inside the not-applicable phrase (`ko.json:5780-5781`). The visible phrase (no space) is not a substring of the accessible name (phrase with space), so WCAG 2.5.3 Label in Name fails. The sibling met / not-met buttons pass because their visible and accessible text agree. English already passes ("not applicable" is contained in "Mark {p1} not applicable").
- **Fix (text-only, no token).** Make the Korean accessible name contain the visible text verbatim: `markP1NotApplicable` and `markP1NotApplicable2` (ko) to the same sentence with the not-applicable phrase written without the space, matching the visible label verbatim. Keep the visible text unchanged. Keep `title={t("judgement")}`/`t("judgement2")` (the spaced not-applicable judgement phrase) as the tooltip; a title does not form the accessible name when aria-label is present. If axe still reports the leading "— " glyph as visible text, drop the glyph from `notApplicable2`/`notApplicable3` in both `ko.json` and `en.json` (the same 3 keys) rather than adding it to the label. en.json needs no change on the first attempt.
- **Affected surfaces.** DD workspace `/projects/<id>/dd` (both checklist and custom rows); `/deals/<id>/s9` tab if it reuses `DdStage` (same component). Locale keys are shared; check `grep -rn "markP1NotApplicable" app/web-next` for any other consumer before editing.
- **Acceptance.** (a) axe reports 0 `label-content-name-mismatch` on `/projects/<P>/dd` in light and dark; (b) the accessible name still starts with or contains the item text (screen-reader context preserved); (c) ko/en locale key parity test stays green.

## F-2: `--warning` used as a text color — color-contrast

- **Root cause.** `--warning` is `hsl(35, 90%, 38%)` = #b86f0a (`app/web-next/app/styles.css:32-34,45`). It is a status accent/rail color (borders at `:2776, 3025, 3182, 4175`), defined in light and **not overridden in dark** (the `[data-theme="dark"]` block, `:163+`, sets only the `--amber-*` family). As text it measures 3.95:1 on white (light) and 4.37:1 on #171b22 (dark), below the 4.5:1 AA bar for 13px text. Text uses of `--warning` bypass the text-safe token that already exists: `--amber-fg` (#7a4c05 light, #ffcf7a dark; `styles.css:83, 210`), and `design-tokens.json` already defines semantic `warning-fg` as amber-600/amber-400 for exactly this purpose. Offenders: `app/web-next/components/stages/BusinessCaseStage.tsx:932` (the failing node), `app/web-next/components/wacc/WaccPanel.tsx:790` (same pattern, not yet hit by the sweep because the sweep's data does not render it), and `.dd-progress-note` at `styles.css:2486` (same pattern, caption size).
- **Fix (use the existing text token; no new token).** Replace `text-[color:var(--warning)]` with `text-[color:var(--amber-fg)]` at the two TSX sites, and `color: var(--warning)` with `color: var(--amber-fg)` at `styles.css:2486`. Computed contrast with `--amber-fg`: light #7a4c05 on #ffffff = 7.3:1 (on `--surface-2` #f1f3f6 about 6.6:1); dark #ffcf7a on #171b22 = 11.9:1. Both clear 4.5:1 (text) with margin. Do **not** darken `--warning` itself: it is the shared rail/border color and a global change would alter every callout; and do not change `--warning-l` (it feeds `--warning-bg`). Guide rule to record in `docs/design-system/design-tokens.md` (one sentence, with the implementing PR): `--warning`/`--danger`/`--success` are fill/border colors; text on a neutral surface uses `--amber-fg`/`--red-fg`/`--green-fg`.
- **Affected surfaces.** Business case progress line (S5/S8 stage views), WACC panel missing-input note, DD progress note. Any future `text-[color:var(--warning|--danger|--success)]` use.
- **Acceptance.** (a) axe 0 `color-contrast` on `/projects/<P>/business-case` in both themes; (b) `grep -rnE "text-\[color:var\(--(warning|danger|success)\)\]|color: var\(--(warning|danger|success)\)" app/web-next --include=*.tsx --include=*.css` returns no text-color uses; (c) `bun run design:lint` clean on touched files. Optional hardening (separate small PR, needs `design-lint.ts` change under PM dispatch): add a lint rule flagging those patterns.

## F-3: risk list severity chip — color-contrast 1.07 / 1.13

- **Root cause.** `app/web-next/app/projects/[id]/risk-heatmap/page.tsx:103` builds the severity color from `var(--red)`, `var(--amber)`, `var(--green)`, and `:161+` applies it inline: `style={{ background: color(it.severity), color: "var(--surface)" }}`. **Those three custom properties are not defined anywhere in `styles.css`** (only `--red-bg/-fg/-border`, `--amber-*`, `--green-*` exist). `background: var(--undefined)` is invalid at computed-value time and resolves to transparent, so the chip text (`--surface` = #ffffff light / #171b22 dark) renders on the page background (#f6f7f9 / #0a0c10): 1.07 and 1.13. It is also a design-lint concern (inline color on a status chip, bypassing the tone classes).
- **Fix (reuse the existing component tone classes).** Delete the inline `style` and the `color()` helper at line 103; render `<span className={`status-chip ${SEV_TONE[it.severity]}`}>` with `SEV_TONE = { high: "status-red", mid: "status-amber", low: "status-green" }` (defined at `styles.css:2545-2548`, background `-bg` + text `-fg`, already used and axe-clean elsewhere). Contrast of these pairs: red #b32318 on its tint about 5.8:1 (light), amber about 6.9:1, green #0a6d43 about 5.7:1; dark pairs use #ff9d97, #ffcf7a, #7fe0a0 on their dark tints and are well above 4.5:1. The chip already carries a text label (the ko high/mid/low severity labels), so it is not color-only (FR-SYS-05); add the standard severity glyph prefix (as `PortfolioStage` does with `●/◐/○`) if the screen's other chips use icons. Keep `marginRight`/`mr-1` as a spacing utility class rather than inline.
- **Affected surfaces.** `/projects/<id>/risk-heatmap` list. Latent same bug (non-text, so not flagged by axe, but wrong): `app/web-next/app/projects/[id]/timeline/page.tsx:49` uses `var(--red)`/`var(--green)` as a background (renders transparent), and `styles.css:3860, 3869` use `var(--green)`/`var(--red)` for a toast rail with no fallback. Fix in the same PR with the `*-fg` / `--danger` / `--success` token that matches intent, or `--red-border`/`--green-border`. Note `styles.css:3749,3776` already carry `var(--amber-fg, var(--amber))` fallbacks, which is the safe pattern.
- **Acceptance.** (a) axe 0 `color-contrast` on `/projects/<P>/risk-heatmap` in both themes; (b) `grep -rnE "var\(--(red|amber|green)\)" app/web-next --include=*.tsx --include=*.css` returns no matches; (c) no inline `style` colors remain in `risk-heatmap/page.tsx`; (d) design:lint clean.

## F-4: 390px overflow on `/projects/<id>/portfolio` (+28px)

- **Root cause.** `app/web-next/components/stages/PortfolioStage.tsx:82-87` defines `RECORD_FIELD` returning `label: "stages.s12.stage.nextExecutionStageConditionRequired"` (and 3 siblings) as **raw message keys**, but `:453` renders `{recordField.label}` without translating (the `tr` translator is closed over but never applied). The label therefore shows the literal dotted key (about 60 unbreakable characters, no spaces), which is 28px wider than the 390px viewport inside the portfolio transition decision form. This is a double defect: an i18n bug (the user sees a developer key) and a layout overflow. The four keys exist in `locales/ko.json:3345` and sibling keys and in `en.json`; only the call is missing.
- **Fix.** Wrap the four labels with the translator: `label: tr("stages.s12.stage.nextExecutionStageConditionRequired")` etc. (lines 83-86), so the localized, wrappable label renders. Defense for the generic case (long unbroken tokens in form labels), optional and token-level: add `overflow-wrap: anywhere` to the shared form label rule used by `.sizing-new-form label` in `styles.css` so any future raw/long string wraps instead of widening the page. Do not add `overflow-x: hidden` on `body`/`main` (it hides, not fixes, and breaks the keyboard-reachable scroll regions required by design-accessibility).
- **Affected surfaces.** S12 portfolio stage in both `/projects/<id>/portfolio` and `/deals/<id>/s12`; all four transition decisions whose record field label was a raw key (next_tranche_released, held_evidence_incomplete, graduate_to_core, reduce_or_divest). Raw-key leak risk elsewhere: after the fix, add a quick scan `grep -rnE "label: \"[a-z0-9]+(\.[A-Za-z0-9]+){2,}\"" app/web-next/components` to find other untranslated key literals.
- **Acceptance.** (a) `no horizontal overflow at 390px` test passes (0 offenders); (b) the form shows localized labels in ko and en (no dotted keys visible); (c) `document.documentElement.scrollWidth <= innerWidth` on the route at 390px.

## Implementation notes

- One PR by `frontend-engineer` covers F-1 to F-4 (about 8 files: `ko.json`, optionally `en.json`, `BusinessCaseStage.tsx`, `WaccPanel.tsx`, `styles.css`, `risk-heatmap/page.tsx`, `timeline/page.tsx`, `PortfolioStage.tsx`). Locale edits require ko/en parity.
- Verification order: `bun run design:lint`, then `bun test tests/scenarios/axe-sweep.test.ts` (about 5 minutes; it starts its own isolated server and never uses ports 7748/7749).
- Token decisions: none new. Existing tokens used: `--amber-fg`, `--red-bg/-fg`, `--amber-bg/-fg`, `--green-bg/-fg`. Owner input needed on tokens: **none**. Optional owner call: whether to add the design-lint rule from F-2(b) (requires a lint script change).

## Result

- axe-sweep 4/4 pass: light and dark report 0 blocking violations across 70 routes; the 390px viewport reports 0 offenders.
- Same-pattern sites fixed: `WaccPanel`, `.dd-progress-note`, heatmap dots, timeline bar, and the toast rails.
- `design-tokens.md` note added.
- The optional design-lint rule for status colors used as text (F-2(b)) is deferred.
