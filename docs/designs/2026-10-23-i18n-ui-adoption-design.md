---
title: UI i18n adoption (ko/en message catalogs) — design
date: 2026-10-23
status: implemented
owner: platform-lead
reviewers: unassigned (assigned at three-stage review)
lang: ko
lang_reason: source-material
---

# UI i18n adoption (ko/en message catalogs) — design

- **Spec ID**: `2026-10-23-i18n-ui-adoption-design`
- **Status**: implemented per this design (T1–T6 rollout, §6). The "approval record" wording describes the approval-time state.
- **Related documents**: ADR-0184 (this design's decision record at ADR level; supersedes decision 4 of ADR-0108 only), ADR-0108 (single documentation surface — otherwise remains in force), ADR-0061 (integer KRW-millions storage), ADR-0181 (entry-market FX seam), ADR-0082/0083/0086 (CRUD/visual/stage UI standards), `docs/context.md` (language policy, accessibility standards), `skills/i18n-locale-config/SKILL.md` (16-locale baseline), `skills/i18n-audit` (workspace parity methodology)
- **Gate-moment record**: `docs/decisions/DEC-20261023-02.md`

## 1. Context and problem

The web app (`app/web-next/`, Next.js App Router) is single-locale Korean **by construction**:

- No i18n framework is installed (`next-intl` absent from `app/web-next/package.json`); Korean string literals appear in 292 of 308 `.tsx` files.
- `<html lang="ko">` is hard-coded at `app/web-next/app/layout.tsx:26`.
- Number/date formatting is scattered: ~15 lib/component modules call `toLocaleString("ko-KR")` (or `"en-US"` mixed with hard-coded Korean unit suffixes — 만/억/조) independently, e.g. `lib/npv-format.ts`, `lib/staffing-plan.ts`, `components/stages/BepAnalysisPanel.tsx`. The `"en-US"` + Korean-suffix mixes in `lib/entry-market-flow-state.ts`, `lib/investment-uncertainty-s8.ts`, and `lib/capability-holding-context.ts` render numerals in an English grouping with Korean units — inconsistent in either locale.
- API error messages are KO/EN mixed: some handlers return Korean human prose, others English developer prose, all through the same `{code, message}` envelope.
- Governance machinery references i18n that does not exist here: `docs/context.md` defines a language policy and the workspace `i18n-locale-config` skill assumes a locale-config file and locale-aware surfaces; the workspace `i18n-audit` skill defines a parity methodology with no project-runnable implementation.

ADR-0108 (decision 4) rejected "chrome-only i18n": the document body was always Korean regardless of chrome language, so a language switcher over untranslated content was not real localization. That rejection premise is now obsolete for UI chrome: this design introduces translated catalogs plus translated surfaces, so chrome localization becomes real. ADR-0108's other decisions (single documentation surface, knowledge-hub retirement) are unaffected; document/wiki/PDF body translation remains a separate future decision exactly as ADR-0108 §Consequences states.

Goal: UI-chrome internationalization with ko + en, extensible to the workspace 16-locale baseline, without touching URLs, storage units, or business semantics.

## 2. Decisions (user-approved 2026-10-23; transcribed, not relitigated)

### D1. Locales: ko + en now, extensible to 16

`locales = ["ko", "en"]` in the active set; the config module documents the full 16-locale baseline of `skills/i18n-locale-config/SKILL.md:129` (`en`, `ko`, `ja`, `zh-CN`, `zh-TW`, `de`, `es`, `fr`, `pt`, `vi`, `ms`, `id`, `th`, `ru`, `it`, `ar`) as the extension surface. Adding a locale later is a catalog file + a config-array entry — no code restructure. BCP 47 canonical tags only (no `zh_Hans`-style variants).

### D2. Master locale: ko

`masterLocale = "ko"`. `ko.json` is the source-of-truth catalog; `en.json` missing a key fails closed to the ko value (next-intl fallback via `defaultLocale`), never to a raw key or an empty string. This is a deliberate, documented **deviation** from the workspace `i18n-locale-config` skill's "en.json is the source of truth" rule: the product's user base and all existing content are Korean; authoring in ko and translating to en matches the real content flow. Recorded in ADR-0184 and `DEC-20261023-02`.

### D3. Locale negotiation: cookie-based, no route restructure

next-intl's "without i18n routing" pattern: `getRequestConfig` resolves the locale per request as cookie `NEXT_LOCALE` → `Accept-Language` header → `defaultLocale`. There is no `[locale]` route segment; every URL is unchanged. Rationale: this is a login-gated internal tool (no SEO surface), and restructuring ~90 routes under a locale segment is risk without benefit. Locale switching is the cookie; the in-app switcher control (`components/LocaleSwitcher.tsx`, mounted in the AppShell) is in scope — included per the approved execution plan 2026-10-23 (the user approved the plan containing it; §7 records the amendment).

## 3. Architecture

### 3.1 Framework and modules

| Module | Content |
|---|---|
| `app/web-next/i18n/config.ts` | `locales = ["ko", "en"]`, `defaultLocale = "ko"`, `masterLocale = "ko"`, the 16-locale extension list, and the `localeDirection(locale)` map (`ko`/`en` → `"ltr"`). Single import point for all locale knowledge. |
| `app/web-next/i18n/request.ts` | `getRequestConfig` implementing the D3 negotiation order; used by `next-intl/plugin` + `NextIntlClientProvider`. |
| `app/web-next/locales/ko.json`, `app/web-next/locales/en.json` | Message catalogs (§3.2). |

Server components read messages through `getTranslations()`; client components consume the `NextIntlClientProvider` scope (per-page namespace selection keeps bundles small).

### 3.2 Catalogs and namespace convention

Flat dot-namespaced keys in both files. Namespaces:

- `common.` — shared chrome (buttons, confirm/cancel, empty states, ADR-0082 labels: `common.delete` = `"삭제"`)
- `nav.` — sidebar/topbar labels (ADR-0105 SSOT labels become keys; hrefs unchanged)
- `auth.` — login/session surfaces
- `admin.` — admin console
- `errors.` — localized API error text keyed by error code (§3.4)
- `format.` — unit suffixes and formatter labels (만/억/조 vs compact, §3.3)
- `stages.<stageId>.` — per-stage screen text (S1–S12)
- `pages.<page>.` — non-stage pages (library, wiki, benchmarks, glossary, …)
- `components.<name>.` — shared component text

`ko.json` is authoritative; the parity test (§5) makes en's key tree a strict mirror of ko's.

### 3.3 Document language and direction

`app/layout.tsx` resolves `getLocale()` and renders `<html lang={locale} dir={localeDirection(locale)}>`. Static `lang="ko"` is retired. The direction map ships ltr for ko/en; the map (not special-cased branches) is the RTL seam so a future `ar` addition needs no layout rework. `ar` itself is not in scope.

Accessibility: correct `lang`/`dir` are the i18n-relevant WCAG obligations (screen-reader pronunciation and reading order, WCAG 3.1.1/3.1.2); `suppressHydrationWarning` on `<html>` is kept for the theme attribute writer. Extracted strings must not break the existing keyboard/ARIA contracts — labels move into catalogs verbatim, `aria-label` values become catalog keys like visible labels. No contrast/motion/touch impact. Verified by the Playwright smoke (§5) plus existing axe coverage.

### 3.4 Formatter centralization (display layer only)

`lib/format.ts` gains locale-aware Intl-based helpers (currency, compact magnitude, percent, date) taking the active locale. Locale conventions:

- **ko**: Korean grouping 만/억/조 remains the ko display convention (e.g. `1억 2,500만원`).
- **en**: `Intl.NumberFormat` compact notation (`KRW 120M`).
- Storage is untouched: INTEGER KRW-millions per ADR-0061, and the ADR-0181 FX seam (per-currency reference rates on `entry_market_fx`, conversion only at display/computation boundaries) is unaffected. Localization is display-layer only; no DB column, no stored derived string changes.

Absorbed call sites (their local formatting collapses into `lib/format.ts` helpers; each batch keeps byte-identical ko output as the regression bar):

`lib/npv-format.ts`, `lib/post-management-view.ts`, `lib/brownfield-financial-rubric.ts`, `lib/greenfield-tabs.ts`, `lib/business-targets-format.ts`, `lib/capability-cost-lines.ts`, `lib/execution-baseline-view.ts`, `lib/report-composer.ts`, `lib/staffing-plan.ts`, `components/EntryMarketContextStrip.tsx`, `components/SourceTooltip.tsx`, `components/stages/BepAnalysisPanel.tsx`, `components/stages/StaffingPlanSection.tsx`, and the `"en-US"` + Korean-suffix mixes in `lib/entry-market-flow-state.ts`, `lib/investment-uncertainty-s8.ts`, `lib/capability-holding-context.ts` (the mixes normalize to the locale-aware helper — the ko rendering of these three must stay identical to today's).

### 3.5 API errors

The `{code, message}` envelope (ADR-0109 shape) keeps `code` as the stable contract. Server-side `message`s are normalized to English developer-facing text (one voice, greppable); user-facing localized text renders on the client from `errors.<code>` catalog keys. Zod validation messages map to codes at the route boundary (`route()` wrapper) instead of leaking English schema prose. Unknown codes fall back to `errors.unknown` in the active locale plus the server message in the detail slot.

### 3.6 Regression prevention (the re-liquefaction guard)

`scripts/co-newbiz/i18n-lint.ts` scans `app/web-next` sources for Korean-character (`\uAC00-\uD7A3`) string literals. A checked-in baseline allowlist file records every literal present at extraction start; literals inside the baseline pass, any new literal outside it fails. The allowlist only shrinks — extraction batches delete their entries, never add. Wired as `tests/unit/i18n-lint.test.ts` so the existing `bun test` unit suite (which `/sync` runs) fails the PR that reintroduces a hard-coded string.

Design-lint coexistence: `design-lint` R6 matches raw `>제거<` in TSX; after extraction the labels come from catalogs (`common.delete` = `"삭제"`), so R6's rule is enforced on the ko catalog values and screen TSX passes trivially. R1–R4 are unaffected. One correction: rule 5 of `scripts/co-newbiz/design-lint.ts` (headed actions column) was relaxed by this change set to also accept the shared `("actions")` catalog key call, because the actions header labels moved to catalog keys like every other label and the key resolves to the same 작업 value; the guard stays narrow — a literal `<th>Actions</th>`, an unrelated key such as `t("common.delete")`, or an empty `<th>` still violate.

## 4. What is NOT changed

- URLs and routing (no `[locale]` segment; `lib/navigation.ts` hrefs unchanged, only labels key-ified)
- Storage units and FX semantics (ADR-0061, ADR-0181)
- CRUD interaction semantics (ADR-0082), visual standard (ADR-0083), StageFrame/stage pattern (ADR-0086) — only the literal text moves into catalogs
- Business/analysis content: stage payloads, reports, wiki/docs bodies stay Korean (their translation is the ADR-0108 §Consequences future decision)

## 5. Verification plan

1. **Catalog parity** — `tests/unit/i18n-parity.test.ts`: en's key tree must equal ko's key tree exactly (missing and extra keys both fail), and every ko value must be non-empty. This is the project-runnable form of the workspace `i18n-audit` skill's parity methodology — the skill becomes executable in this repo through this test.
2. **Literal guard** — `tests/unit/i18n-lint.test.ts` runs the §3.6 scanner and asserts no non-baseline Korean literals (§3.6).
3. **Formatter regression** — ko output of the absorbed `lib/format.ts` helpers must be byte-identical to the pre-extraction rendering for representative fixtures (per §3.4 batch bar); unit tests pin both ko and en renderings.
4. **E2E smoke** — Playwright ko/en smoke: set `NEXT_LOCALE` cookie → shell labels render in the target locale, `<html lang>`/`dir` correct, one stage screen and one API-error rendering per locale.
5. **Type and design gates** — `tsc --noEmit`, `design-lint`, full unit suite green; spec-check passes with this doc registered.

### Verification record (2026-10-24)

Executed at T6 by i18n-specialist (PM-dispatched); full results and the L10N Parity Certificate: `docs/audits/2026-10-24-i18n-audit.md`.

- §5.1–5.2 PASS — ko/en key trees identical (7,459 keys each); generalized harness `tests/unit/i18n-audit.test.ts` iterates `i18n/config.ts` locales and adds param parity, ICU parse validity, quote discipline, and the Hangul allowlist (2 endonyms).
- One audit fix: `en.stages.s11.executionBaseline.aReferenceValueForSetting` now ICU-escapes `goal:'<metric key>'` (bare `<…>` threw `INVALID_TAG`).
- Glossary adherence: 274 drift entries across 26 of 87 terms (dominated by 확정/게이트 granularity, referred to glossary-curator); baseline 274 recorded as a ratchet-down ceiling in CI.
- §5.3–5.5 PASS — lint baseline 259 files / 3,798 Korean lines, 0 violations; Playwright ko/en smoke (`tests/scenarios/locale-smoke.test.ts`) green in a real browser; `tsc --noEmit` 0 errors, design-lint 0, `test:unit` 0 fail, build compiles.

## 6. Translation flow and phased rollout

Termbase: `glossary/*.yaml` (87 approved ko/en term pairs) is the authoritative term mapping; en catalog drafts follow it, and the i18n-specialist persona reviews en translations before they are treated as complete (machine-drafted translation is a proposal, human/persona review gates it — three-stage review applies).

| Phase | Content | Acceptance criteria |
|---|---|---|
| T1 | Infrastructure: next-intl install, `i18n/config.ts`, `i18n/request.ts`, empty catalogs, plugin wiring, `<html lang/dir>` dynamic | App boots ko as today; cookie switch renders shell with (still-few) catalog keys; parity + lint tests in place with full baseline |
| T2 | Shell pilot extraction: AppShell/nav/topbar/auth surfaces | Sidebar and login fully catalog-keyed; ko pixel-identical; Playwright smoke green for both locales |
| T3 | Stages/pages/lib batches: `stages.*`/`pages.*` namespaces and the §3.4 formatter call-site absorption, allowlist shrinking per batch | Each batch: ko output unchanged, allowlist entries deleted, `bun run test:unit` green |
| T4 | API error keying (§3.5): server messages normalized to English, `errors.*` keys, Zod mapping | Error paths render localized text from codes; envelope contract test unchanged |
| T5 | en translation review against the glossary termbase (i18n-specialist review) | en catalog complete for all extracted keys; parity test green with non-empty values |
| T6 | Parity harness + audit closure: i18n-audit skill linkage documented, lint baseline review, audit record | §5 items 1–5 all green; remaining baseline size reported |

## 7. Out of scope (exactly as approved; one amendment recorded inline)

- Translation of docs/wiki content, PDF reports, and email bodies (stays Korean; ADR-0108 §Consequences future decision)
- DB `name_ko`-style schema changes (no stored-name localization)
- Translations beyond ko/en
- ja/zh (and other CJK) font work
- ~~In-app language switcher UI control~~ — scope amendment: brought INTO scope per the approved execution plan 2026-10-23 (the user approved the plan containing it); ships as `components/LocaleSwitcher.tsx` in the AppShell on the same `NEXT_LOCALE` cookie seam (D3), with catalog endonym labels (`common.locale.*`)
- RTL layout verification (the direction map is infrastructure only)

## 8. Governance notes

- **ko-master deviation**: D2 deviates from `skills/i18n-locale-config` ("en.json is source of truth"). Ruled as a documented project deviation in ADR-0184 and `DEC-20261023-02`; the deviation travels with this doc, and revisiting it (e.g. an en-primary audience emerging) is a new decision record, not a silent flip.
- **i18n-audit executability**: the workspace `i18n-audit` skill previously had no project-runnable implementation; the §5 parity test is that implementation — governance suite references now resolve to real machinery.
- **Design-review checklist applicability**: no new screens/patterns (P1–P5 usage unchanged), no new tokens or components (§2 DESIGN-CHECKLIST items 1–2: none), CRUD interactions untouched (item 3), no new icons (item 4). The R6 label standard lives on in the ko catalog (`common.delete` = `"삭제"`).
- **Approval record**: plan approved by the user 2026-10-23; that approval constitutes the design approval for the transcribed decisions (`DEC-20261023-02`).

## 9. Rejected alternatives

- **`[locale]` route segment (next-intl with routing)** — restructures ~90 routes, changes every URL, adds redirect/locale-detection complexity, for zero SEO benefit on a login-gated internal tool. Rejected (D3).
- **en as master locale** — follows the workspace skill default but inverts the real authoring flow (product and content are Korean; en is the derived translation). Fails closed in the wrong direction for this product. Rejected (D2); recorded as a governed deviation, not an oversight.
- **i18next / react-intl / hand-rolled context** — next-intl is the App Router-native option (RSC support, `getRequestConfig`, per-request locale without routing); hand-rolling re-implements negotiation + fallback + plural handling. Rejected.
- **Persisting locale server-side per user** — adds a user-profile column and write path for a preference a cookie already carries; revisit only if cross-device locale persistence becomes a real request. Rejected for now.
- **Big-bang string extraction** — 292 files at once; the phased T2–T3 batches with the shrinking lint baseline keep every PR reviewable and ko output pinned. Rejected.
