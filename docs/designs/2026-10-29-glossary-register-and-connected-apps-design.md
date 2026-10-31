---
lang: ko
lang_reason: proper-noun
---

# Glossary Register Form, Term Decisions, and Connected Apps UI

- **Date**: 2026-10-29
- **Status**: Approved (owner, 2026-10-29)
- **Author**: platform-lead (technical domain lead), under PM dispatch
- **Related**: ADR-0065 (accessibility), ADR-0070 (preview verification / MCP enforcement), ADR-0146 item 6 (personal tokens, amended 2026-10-29), ADR-0154 (hosted connector OAuth), ADR-0184 (ko/en i18n), `docs/designs/2026-10-11-self-service-api-tokens-design.md`, Onyx 3.0 design system

## 1. Problem and scope

### 1.1 Glossary register (`/admin` glossary)

- The register form is cramped (single narrow column, no grouping).
- No key suggestion from the term name; owners type keys by hand.
- The owner shows as a raw user id instead of a display name.
- No alias UX (aliases are a raw comma string).
- No duplicate check against existing keys, terms, or aliases.
- No preview of how the term renders (tooltip / appendix).
- Generated glossary data is not regenerated after registration, so the tooltip and `lookup_term` stay stale.
- Registration writes YAML in the repo; nothing blocks it in production (Docker on 7749).
- The list table uses 12px fonts, below the Onyx body size.

### 1.2 Korean term decisions (owner, 2026-10-29)

| Current | Decided ko label |
|---|---|
| 프록시 체인 | 연관 산업 추정(프록시 체인) |
| 앵커 참조 | 기준값 참조(앵커) |
| 귀인분석 | 변화 요인 분해 |
| 기저율 | 기준 비율 |
| 리스크 히트맵 | 위험 지도(히트맵) |
| 오버라이드 | 직접 지정 |
| 드라이버 | 핵심 동인 |
| 퍼널 / 에이징 / 티어 | 단계별 현황 / 경과 기간 / 등급 |
| hTightestPeriod (ko) | 한계 시점 |
| Stage Gate (glossary label) | 단계별 심사 체계(스테이지 게이트), alias 게이트 |

Kept unchanged: 지배구조 변경, 수요 파이프라인, 스냅샷. In tight labels (table headers, chips, nav) the short form without the parenthetical is used (e.g. 연관 산업 추정, 위험 지도).

### 1.3 India disambiguation

`인도` is ambiguous between India (country) and Delivery (handover). As implemented (owner-confirmed amendment, 2026-10-30): the plain labels are kept — the glossary Delivery term stays `인도` and the country/currency catalogs keep `인도` / `인도 루피` — and the ambiguity is resolved through the glossary disambiguation fields: the Delivery entry carries `exclude_phrases: [인도 루피]` and `exclude_paths` covering `admin.masterData.countryNames.` / `admin.masterData.currencyNames.`, so the i18n glossary-adherence audit and term lookups can never collide the Delivery term with the country or currency. The two are distinct keys and neither is an alias of the other.

### 1.4 Connected apps (`/settings/connected-apps`)

- Information hierarchy does not separate the hosted connector (OAuth, ADR-0154) from personal tokens (ADR-0146 item 6).
- Connector copy is terse; no step-by-step how-to.
- Token table lacks remaining-days (D-n) and an expiring-soon signal.
- No status filter; revoked/expired rows clutter the list.
- TTL options are 7/30/90; owner requested a 180-day (6 months) option.
- **Amendment (2026-10-31, owner Row 0 directive)**: the personal-token items' structure itself needs a usability pass — see the diagnosis and decision in §2.4 (C7–C10).

## 2. Design decisions and acceptance criteria

### 2.1 Glossary register form

| # | Decision | Acceptance criterion |
|---|---|---|
| G1 | Two-column grouped form (identity / definition / relations), single column below md breakpoint | Renders without horizontal scroll at 375px and 1280px |
| G2 | Key suggested from the en term (kebab/snake per `_schema.yaml`), editable | Typing an en term fills an empty key field; a manually edited key is never overwritten |
| G3 | Owner shown as display name (fallback id) | No raw id visible when a display name exists |
| G4 | Alias chip input (add on Enter/comma, remove button with label) | Aliases saved as array; each chip removable by keyboard |
| G5 | Duplicate check across keys, ko/en terms, aliases (case/space-insensitive) | Duplicate blocks submit with an inline error naming the conflicting key |
| G6 | Live preview of tooltip text | Preview updates as definition changes |
| G7 | After a successful registration the glossary data is regenerated (`generate-glossary-data` logic) | A newly registered term resolves in tooltip / `lookup_term` without a manual script run |
| G8 | Registration blocked in production (see §5.3) | POST in prod returns 403 with a clear message; the form shows read-only notice |
| G9 | List table uses Onyx body type size (no 12px) | `design:lint` passes; no `font-size: 12px` in the table styles |

### 2.2 Term decisions and India

| # | Acceptance criterion |
|---|---|
| T1 | Every row of §1.2 is applied to `glossary/*.yaml` ko labels and matching `locales/ko.json` strings; replaced terms remain as aliases so lookups by the old term still resolve |
| T2 | Kept terms unchanged |
| T3 | Tight labels use the short form; full form appears in tooltip/definition |
| T4 | `glossary/_validate.ts` and glossary lint pass; the i18n audit test passes |
| T5 | India (country) and Delivery are separate keys with distinct ko labels; no shared alias |

### 2.3 Connected apps

| # | Decision | Acceptance criterion |
|---|---|---|
| C1 | Two clearly headed sections: "Hosted connector (recommended)" then "Personal API tokens" | Sections are landmarks with headings (h2) in that order |
| C2 | Connector copy with numbered how-to and copyable MCP URL; explicit "never paste a personal token into a hosted connector" | Copy button announces success; text present in ko and en |
| C3 | Token table shows D-n remaining; expiring soon (≤7 days) shows an icon + text chip, not colour only | Chip contains text; screen reader reads the state |
| C4 | Status filter (active / expiring soon / revoked / expired / all), default active | Filter is a labelled control; counts update |
| C5 | Revoked/expired rows collapsed under a disclosure | Disclosure uses `aria-expanded`; collapsed by default |
| C6 | TTL options 7/30/90/180 days, default 30, max 180 | API accepts 180 and rejects 365 with 400; UI lists 180 labelled "180 days (6 months)" |

### 2.4 Connected-apps token UX amendment (2026-10-31, ux-designer-agent)

Owner Row 0 directive (2026-10-31): the personal API token items' UI structure needs a usability
improvement. Browser diagnosis (dev 7748; issue → reveal → filter → revoke exercised live in an
admin session, list also inspected in an analyst session):

| Observed | Detail |
|---|---|
| Row structure | 8 flat columns at widths 18/15/10/10/12/17/12/6% — label, masked identifier, scopes, status chip, created, expiry (date + D-n + expiring-soon chips), last used, actions. The identifier and scope columns are sparse; the table carries `tmin-64` horizontal scroll at common widths |
| Actions | the only action is the danger-styled 해지 button, always visible and the most prominent control in every active row |
| Reveal modal | fires correctly with the one-time warning, focused read-only input, copy button, MCP JSON snippet and the "저장했습니다" primary — but at a 720 px viewport the panel overflows and the primary button is clipped out of view; there is no copy action for the JSON snippet itself |
| Expiry | a freshly issued 7-day token is born "곧 만료" (D-7) — the ≤7-day threshold applies immediately; true signal, and the option label ("7일 — 짧은 테스트용") already flags it |
| States | filter chips with counts, filtered-empty text, inactive-tokens disclosure, slot-remaining status, revoke confirm (alertdialog, irreversible warning) and success toast all work |

Security invariant verified in code and left untouched: the full token exists only in the POST 201
response (`cache-control: no-store`, "Store this token now — it is never shown again"); `GET /api/tokens`
returns `display_id` only, and the list renders the masked `cnb_pat_••••` + last 6. Nothing in this
amendment proposes storing or re-displaying the full secret.

**Decision — direction (a): keep the table, restructure the row hierarchy.** JTBD: the operator's
recurring job here is small-batch housekeeping ("which tokens are active, which are stale, kill the
one I retired"), and the rare setup job is "issue once, copy, paste into the client". The list is
capped (5 active + disclosed inactive) and is never bulk-scanned, so cards (direction b) would spend
vertical space pushing the how-to and issue form further down without adding information, and a
master-detail split (direction c) adds a selection state whose detail panel would repeat what one
row already shows. Restructuring the row inside the existing `list-table` keeps C1–C6 intact and
gives the name room to carry recognition.

| # | Decision | Acceptance criterion |
|---|---|---|
| C7 | Row hierarchy: columns 8 → 5. `토큰` cell = label (primary, `cell-truncate` with `title`) + status chip inline + a secondary caption line with the scope label and the masked identifier in mono; `만료`, `마지막 사용` keep their current content in wider columns; no `tmin-64` overflow at 1280 px | All row content visible at 1280×720 without horizontal scroll; secondary line is text, not colour-only; the sr-only table caption and headers updated (`colToken` 토큰) |
| C8 | Row actions move into the established `RowMenu` (`components/crud.tsx`, "더 보기", `aria-label="{name} 작업 메뉴"`): active rows carry the 해지 item (`danger: true`); revoked/expired rows show "—" | Revocation still requires the C-series confirm dialog (`ConfirmDialog`, danger tone) before any change; the danger styling lives at the commitment point, not on every row; keyboard: menu items reachable and labelled (existing RowMenu focus management) |
| C9 | Reveal modal fits short viewports: panel `max-height: min(85dvh, 48rem)` with internal scroll and a pinned footer so "저장했습니다" is always visible; add a "설정 예시 복사" ghost button beside 토큰 복사 that copies the JSON snippet | At 720 px height the primary button is visible without scrolling the page; both copy actions announce success via the existing `aria-live` status |
| C10 | Expiry presentation unchanged (date + D-n chip + ≤7-day "곧 만료" chip, all aria-labelled); empty/filtered states, slot status and the inactive disclosure unchanged — verified working in the Row 0 diagnosis | C3–C5 acceptance criteria continue to pass; no regression in `connected-apps-page.test.ts` |

i18n keys (`pages.connectedApps`, ko drafted): `colToken` "토큰", `rowMenuAria` "{p1} 작업 메뉴",
`revealSnippetCopy` "설정 예시 복사", `revealSnippetCopiedOk` "설정 예시를 복사했습니다.",
`revealSnippetCopyFail` "복사에 실패했습니다. 직접 선택해 복사해 주세요."; en mirrors in
`locales/en.json`. The hosted-connector section (C1/C2: connector box, numbered how-to, MCP URL
copy) is untouched.

## 3. Accessibility (ADR-0065)

- **Target**: WCAG 2.1 AA.
- **Affected interactions**: register form fields and validation errors (associated via `aria-describedby`, error summary focus on submit failure); alias chips (keyboard add/remove, labelled remove buttons); key suggestion (no focus steal); preview (`aria-live="polite"`); token status chip (icon + text, 1.4.1); status filter and revoked/expired disclosure (`aria-expanded`); copy-URL button (status announced); 4.5:1 contrast for all text including the enlarged table. **Amendment (§2.4)**: token row secondary caption line is text (never colour-only); `RowMenu` per row is keyboard-operable with a labelled trigger; the reveal modal keeps `useModalFocus` trapping and both copy buttons announce through `aria-live`; the pinned footer stays inside the focus order.
- **Verification**: `design:lint`, axe-core via the accessibility-audit skill on both pages, keyboard-only pass through each form and the filter/disclosure, unit tests asserting labels and `aria-*` attributes.

## 4. Preview Verification (ADR-0070)

Both screens must be checked rendered on the dev server (7748) at ≥2 breakpoints (375px mobile and 1280px desktop) with ≥1 key interaction each: (a) glossary — enter a term, see key suggestion and preview, trigger a duplicate error; (b) connected apps — choose the 180-day TTL in the issue dialog and toggle the status filter / revoked disclosure. Evidence (screenshots or accessibility-tree snapshots) is attached to the PR. The production container (7749) is not touched.

## 5. Security

### 5.1 ADR decision for the 180-day TTL

**No new ADR.** Reasoning: the project ADR trigger list (DB schema, auth, MCP tool scope) is not hit — no schema change (`expires_at` reused), no change to scopes, auth flow, or MCP tools; only the allowed constant set changes (`TOKEN_TTL_DAYS`/`MAX_TTL_DAYS` in `db/lib/api-tokens.ts`, mirrored in `app/web-next/lib/token-issue-access.ts`). Because a longer credential lifetime relaxes the stolen-token mitigation, it is recorded as a dated amendment note on ADR-0146 item 6, exactly as `docs/designs/2026-10-11-self-service-api-tokens-design.md` (TTL set section) already prescribes. Compensating controls stay: per-user active-token cap, revoke, hourly-throttled use audit, read-only for viewer/admin, hosted connectors still OAuth-only (ADR-0154). The amendment note still needs human review (ADRs cannot pass on AI review alone).

### 5.2 Token display

D-n and status are derived from `expires_at` / `revoked_at` only; no token material or prefix beyond what is already shown is exposed.

### 5.3 Glossary production block

Registration mutates repo YAML and generated data; in production that would diverge the container from git and bypass review. The glossary POST route returns 403 when running in production (`NODE_ENV=production` or the deployment environment flag), checked server-side before any write; the UI hides/disables the form with an explanatory notice. Admin authorization and audit logging remain as-is (append-only `audit_log`, ADR-0012). Inputs are validated against `glossary/_schema.yaml` server-side; the client duplicate check is advisory and repeated on the server.

## 6. Out of scope

- Glossary editing/deletion workflow and curator approval queue.
- Translating term decisions into en labels beyond existing entries.
- Any TTL above 180 days, non-expiring tokens, token rotation, `token_prefix`, or `propose` scope.
- Hosted connector OAuth flow changes.
- Production deployment of these changes (separate release step).

## 7. Test plan

- Unit: key suggestion, duplicate detection (key/term/alias normalization), alias parsing (`glossary-form.ts`); regeneration call after register (`glossary-generate.ts`); prod block returns 403; `isAllowedTtl(180)` true, 365 false; token status/D-n derivation and expiring-soon threshold.
- Existing suites updated: `tests/unit/api-tokens.test.ts`, `token-issue-access.test.ts`, `connected-apps-page.test.ts`, `i18n-audit.test.ts`.
- Data: `bun glossary/_validate.ts`, glossary lint, `generate-glossary-data.ts` output diff reviewed.
- UI: `design:lint`, axe-core, Preview Verification per §4. **Amendment (§2.4)**: `connected-apps-page.test.ts` updated for the 5-column row (label + status chip + scope/identifier caption line), the RowMenu action path, and the snippet-copy button; keyboard pass through a token row menu and the reveal modal at a 720 px-tall viewport.
- Gate: `bun scripts/audit.ts` and `/sync` spec-check.
