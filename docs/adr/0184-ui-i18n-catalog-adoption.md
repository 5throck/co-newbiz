---
lang: ko
lang_reason: source-material
---

# ADR-0184: UI i18n catalog adoption — ko/en message catalogs, ko master, cookie negotiation

- Status: Accepted (2026-10-23)
- Date: 2026-10-23
- Decider: human decider (plan approval in chat 2026-10-23 — locales ko+en extensible to the 16-locale workspace baseline, ko as master locale with fail-closed fallback, cookie-based negotiation without route restructuring). Drafted by platform-lead.
- Design-of-record: [docs/designs/2026-10-23-i18n-ui-adoption-design.md](../designs/2026-10-23-i18n-ui-adoption-design.md)
- Gate-moment record: [docs/decisions/DEC-20261023-02.md](../decisions/DEC-20261023-02.md)
- Related: ADR-0108 (superseded in part — decision 4 only, see Supersedes), ADR-0105 (navigation SSOT — labels key-ified, hrefs unchanged), ADR-0082/0083/0086 (CRUD/visual/stage UI standards — semantics unchanged), ADR-0061 (integer KRW-millions storage — untouched), ADR-0181 (entry-market FX seam — display-only localization), `skills/i18n-locale-config` (16-locale baseline; ko-master deviation recorded here), `skills/i18n-audit` (made project-runnable via the parity test)

## Supersedes (explicit and partial)

**ADR-0108 decision 4 ("No chrome-only i18n") is superseded; the rest of ADR-0108 remains in force.** ADR-0108's decision 4 rejected a language switcher because "the document body was always Korean regardless of the chrome language selected; a language switcher over untranslated content is not real localization." That premise no longer holds for UI chrome: this decision introduces translated message catalogs (ko/en) and translated surfaces, so chrome localization becomes real localization rather than a switcher over untranslated content. ADR-0108's remaining decisions — repository originals as SSOT, `/library` as the single documentation surface, knowledge-hub retirement — are unchanged. Its Consequences clause ("any future real localization of document bodies is a separate decision, made when translated content actually exists") stays exactly as written: document/wiki/PDF body translation remains out of scope and remains a separate future decision.

## Context

The web app is single-locale Korean by construction: no i18n framework, Korean literals in 292 of 308 `.tsx` files, static `<html lang="ko">` (`app/layout.tsx:26`), ~15 modules calling `toLocaleString("ko-KR")` (some mixed `"en-US"` grouping with hard-coded Korean 만/억/조 suffixes), and KO/EN-mixed API error messages through one `{code, message}` envelope. Governance machinery (the language policy in `docs/context.md`, the `i18n-locale-config` and `i18n-audit` workspace skills) references locale configuration and parity checking that had no implementation in this project. An internal audit (2026-10-23) concluded the app needs UI i18n infrastructure before any multilingual surface can exist.

## Decision

1. **Locales ko + en now, extensible to 16.** The active set is `["ko", "en"]`; `app/web-next/i18n/config.ts` documents the 16-locale baseline of `skills/i18n-locale-config` (`en`, `ko`, `ja`, `zh-CN`, `zh-TW`, `de`, `es`, `fr`, `pt`, `vi`, `ms`, `id`, `th`, `ru`, `it`, `ar`) as the extension surface. A future locale is a catalog file plus a config entry. BCP 47 canonical tags only.
2. **Master locale: ko (documented deviation).** `ko.json` is the source-of-truth catalog; missing `en.json` keys fail closed to ko. This deviates deliberately from the workspace skill's "en.json is source of truth" default: the product, its content, and its user base are Korean; authoring in ko and translating outward matches the real content flow. The deviation is governed here and in DEC-20261023-02 — reversing it is a new decision record.
3. **Cookie-based negotiation, no route restructure.** next-intl "without i18n routing": locale resolves per request as cookie `NEXT_LOCALE` → `Accept-Language` → `ko`. No `[locale]` segment; every URL unchanged. This is an internal, login-gated tool with no SEO surface; restructuring ~90 routes for locale segments buys nothing here.
4. **Display-layer-only localization.** Formatter logic centralizes into locale-aware Intl helpers in `lib/format.ts` (ko keeps the 만/억/조 display convention; en uses Intl compact notation). Storage stays INTEGER KRW-millions (ADR-0061) and the ADR-0181 FX seam is untouched — no DB schema change, no stored derived strings.
5. **Enforced discipline, not conventions.** (a) `scripts/co-newbiz/i18n-lint.ts` fails any new Korean string literal outside a checked-in, only-shrinking baseline allowlist, wired into the unit suite via `tests/unit/i18n-lint.test.ts`; (b) `tests/unit/i18n-parity.test.ts` requires en's key tree to mirror ko's exactly — the project-runnable form of the `i18n-audit` skill; (c) API error `code`s stay the stable contract, server messages normalize to English developer text, and localized user text renders from `errors.<code>` keys.

## Consequences

- **Catalog discipline becomes a merge gate**: UI text lands in catalogs or CI (lint + parity tests) rejects it. The baseline allowlist is debt by design — it only shrinks as extraction proceeds, and its size is the remaining-work meter.
- **Two catalogs must move together**: every new ko key needs an en key in the same change (parity test enforces it), so string changes carry a small translation cost at write time instead of a localization backlog later.
- **en quality is gated on the glossary termbase** (`glossary/*.yaml`, 87 ko/en term pairs) and i18n-specialist review; en translations start as drafts and are proposals until reviewed — machine-drafted text is never silently final.
- **Future locales are cheap**: a 17th locale is a catalog file, a config entry, and (for RTL scripts) a direction-map entry; no routing, storage, or layout rework.
- **No SEO/multi-tenant surface is created**: cookie negotiation means shareable URLs carry no locale; cross-device locale persistence would need a follow-up decision (out of scope).
- **Accessibility improves mechanically**: dynamic `<html lang>`/`dir` give screen readers correct pronunciation and reading order per locale (WCAG 3.1.1/3.1.2), which the static `lang="ko"` could not.
- **ADR-0108's boundary stays honest**: this decision localizes chrome only; docs/wiki/PDF/email bodies remain Korean until someone makes ADR-0108's reserved "translated content exists" decision.

## Rejected alternatives

- **Keep ADR-0108 decision 4 as-is** (no chrome i18n): its premise is obsolete once translated catalogs exist; keeping it would leave the audit-identified inconsistencies (`en-US` numerals with Korean units, mixed-language errors) permanent.
- **Full supersession of ADR-0108**: rejected — its documentation-surface decisions are independent of chrome language and remain correct.
- **en-master per workspace skill default**: rejected for this product's authoring flow; recorded as a governed deviation instead of a silent non-compliance.
- **Route-segment i18n** (`[locale]`): rejected — URL restructure of ~90 routes with no SEO payoff on an authenticated internal tool.
- **Server-persisted user locale preference**: rejected for now — a cookie already carries the preference; a profile column is a write path for something the client can hold.
