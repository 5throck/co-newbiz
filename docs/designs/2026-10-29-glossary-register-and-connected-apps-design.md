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

## 3. Accessibility (ADR-0065)

- **Target**: WCAG 2.1 AA.
- **Affected interactions**: register form fields and validation errors (associated via `aria-describedby`, error summary focus on submit failure); alias chips (keyboard add/remove, labelled remove buttons); key suggestion (no focus steal); preview (`aria-live="polite"`); token status chip (icon + text, 1.4.1); status filter and revoked/expired disclosure (`aria-expanded`); copy-URL button (status announced); 4.5:1 contrast for all text including the enlarged table.
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
- UI: `design:lint`, axe-core, Preview Verification per §4.
- Gate: `bun scripts/audit.ts` and `/sync` spec-check.
