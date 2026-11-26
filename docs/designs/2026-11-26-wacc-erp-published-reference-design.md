---
lang: ko
lang_reason: proper-noun
---

# WACC ERP published reference suggestion — design

- Status: Draft (design only, no implementation)
- Date: 2026-11-26
- Owner: valuation-agent (design author); reviewers: quant-methodologist (method, registry maintainer), region-lead (region-profile contract), design-system-agent (UI, per DESIGN-CHECKLIST)
- Related: ADR-0115 (WACC component decomposition), ADR-0116 Phase 4 (WACC reference suggestions), ADR-0058 §2 (evidence-ref `https://` anchor shape), proposed ADR-0207 (this change, amends ADR-0115)

## 1. Problem

ADR-0115 fixes the CAPM source-kind convention: risk-free = live, ERP and target D/E = user, beta = derived. The reference-suggestion route (`app/web-next/app/api/projects/[id]/wacc/suggestions/route.ts`, rendered as "WACC 참조값" in `WaccPanel`) offers `risk_free`, `credit_spread` and `observed_de` with `source_label` / `as_of` / `anchor_ref`. A human applies a suggestion and confirms it; the confirmed row is written as `kind='user'`.

`wacc.erp` gets no suggestion, because the ERP cannot be collected automatically. Every analyst types an ERP from memory or from a document they found themselves, so ERPs are inconsistent across projects, uncited, and not comparable by reviewers.

Approach: show **published** ERP figures as cited reference values that the user can apply. They are proposals only. Agents propose; humans decide and confirm.

## 2. Decisions (fixed by the user, 2026-11-26)

| # | Decision |
|---|---|
| D1 | Several sources are listed side by side. Exactly one is designated the **default source**; only the default source takes part in "apply all applicable". |
| D2 | **Free, publicly accessible sources only.** Candidates: Damodaran country risk / implied ERP tables (NYU Stern); KICPA (한국공인회계사회) market risk premium guidance, only if freely published. No paid data (no Kroll / Duff & Phelps subscription, no Bloomberg, no licensed survey). Each entry carries source name, URL, value and as-of date. |
| D3 | Values live in `region-profiles/KR.yaml` as a new ERP reference block, under the profile provenance contract: every field carries `source` / `verified_on` / `maintainer`, and `region-profiles/_validate.ts` rejects unsourced fields. |
| D4 | **KR only** for now. A reference whose `verified_on` or `as_of` is older than **12 months** shows a stale warning and is excluded from "apply all applicable" (counted as missing, with a reason, in the existing missing-item list). It can still be applied individually. |

## 3. Scope

In scope: the KR ERP registry block and its validator rules, an `erp` suggestion plus alternatives in the existing route, WACC panel display (rows, default marker, stale badge), apply and apply-all behaviour, audit, lifecycle, tests.

Out of scope: fetching or scraping ERP publications; computing an implied ERP from market data; size or country risk premium references; ERP for US / EU / CN / SEA profiles; DB schema changes; any effect on gates, RAG grades or kill criteria.

## 4. Registry — `region-profiles/KR.yaml`

`erp_references` is a new **optional** top-level section, handled like `payment_practice` in `_schema.yaml`: skipped when absent, held to the provenance rules when present. The section carries `source` / `verified_on` / `maintainer` / `data` as every section does, and each entry carries its own provenance as well. Dates are quoted strings (the validator checks `typeof === "string"`). Values below are placeholders — no ERP number is asserted in this document; the maintainer transcribes each value from the publication.

```yaml
erp_references:
  source: "Registry of published ERP figures — free, publicly accessible publications only (entries cite each)"
  verified_on: "<ISO date of last registry check>"
  maintainer: quant-methodologist
  data:
    default_source_id: damodaran-kr-<edition>   # exactly one; must name a non-superseded entry
    entries:
      - id: damodaran-kr-<edition>              # unique slug
        source: "<publication name, edition, table/page>"   # shown as source_label
        url: "https://<deep link to the page or file>"      # ADR-0058 §2 shape
        value_pct: <ERP in percent points, as published>
        basis: implied | historical | survey | recommended
        as_of: "<date the publication says the figure applies to>"
        published_on: "<publication date>"
        verified_on: "<date the maintainer checked the figure against the source>"
        maintainer: quant-methodologist
        note: "<free access confirmed (no login/payment); caveats such as 'includes country risk premium'>"
        superseded_by: <id of newer edition>    # optional
      - id: kicpa-kr-<edition>                  # only if KICPA guidance is freely published
        # same fields
```

Rules:

- `value_pct` is in percent points, as `risk_free` / `credit_spread` are today; the existing `suggestionToInputValue` conversion turns it into a ratio on apply.
- Each entry names exactly one publication edition. A figure inferred, averaged or adjusted by an agent is not a published reference and must not be registered.
- The maintainer confirms free access when registering and records it in `note`. A source needing login, payment or a licence is not registered.
- On a new edition the maintainer adds a new entry and sets `superseded_by` on the old one; entries are never deleted, so past confirmations can still resolve their citation. If the default entry is superseded, the same PR repoints `default_source_id`.

Validator additions (`_validate.ts`, `_schema.yaml` bumped to a new minor version, `erp_references` added to `optional_top_level`): section provenance as for any section; per entry `id` unique, `source` / `verified_on` / `maintainer` non-empty, `url` starts with `https://`, `value_pct` numeric within a schema sanity band (0 < v < 25, a guard not a judgment), `basis` in the enum, `as_of` / `published_on` / `verified_on` valid ISO dates not in the future, `superseded_by` resolves, at least one entry, `default_source_id` resolves to exactly one non-superseded entry. The validator never fetches URLs.

Registration process: the maintainer transcribes value and fields and opens a PR; `bun scripts/audit.ts` runs the validator; region-lead (a different domain from the maintainer) gives the AI second review of provenance and a person confirms the value against the source before merge. Refresh: on each new edition of a listed source, and at the latest before any entry reaches 12 months (see §6).

The confirmed project value is unchanged: a `wacc.erp` assumption row on the project run (ADR-0115), no schema change.

## 5. Route and WACC panel

### 5.1 Route

`GET /api/projects/[id]/wacc/suggestions` adds ERP entries read (read-only) from `KR.yaml`:

```
{ key: "erp", value, as_of, anchor_ref: url, source_label, note, basis,
  source_id, is_default: true, age_months, stale, stale_reason }          // default source
erp_alternatives: [ { same shape, is_default: false }, ... ]              // other current sources
```

- The default entry uses `default_source_id`. Non-superseded entries other than the default go to `erp_alternatives`; they never take part in apply-all.
- Offered only when the project market resolves to KR; otherwise `{ key: "erp", value: null, reason: "KR 외 시장 — 등록된 공표 ERP 없음" }`. No record or a YAML parse error also gives `value: null` with a reason; never a placeholder, and the other suggestion keys are unaffected.
- ERP does not depend on the subject company, so the ERP entry must survive the route's early return when no company is bound.

### 5.2 Panel presentation (DESIGN-CHECKLIST)

1. Pattern: P4 Execution (the existing WACC session in the S8 stage frame); no new pattern.
2. The default source appears as an `erp` row in the existing "WACC 참조값" card and reference table, with a **기본** marker (existing status-chip tokens). Alternatives appear as indented rows under it, each with source chip + external link, value in percent, `basis` label and as-of date. Rows reuse the existing per-row apply button (`btn-ghost btn-sm`); no new tokens or components, no new icons.
3. Stale rows carry a warning chip next to the as-of date ("기준일 N개월 경과" or "검증 N개월 경과 — 최신 판 확인 필요"; status conveyed by text, not colour alone). The row stays visible and applicable.
4. No in-app CRUD for references; the registry is governed by PR.
5. ko/en locale keys for the new labels; design-lint must pass.

## 6. Staleness, apply and apply-all

- `stale = true` when `as_of` or `verified_on` is more than **12 months** before today (constant `ERP_STALE_MONTHS = 12` in the route, not a per-entry setting); `stale_reason` says which date.
- **Apply (individual)** fills the ERP input with the value and carries `source_label`, `anchor_ref`, `as_of` into the pending component, as risk-free does today. It works for any row, default or alternative, fresh or stale, and replaces any earlier applied ERP citation.
- **Apply all applicable** applies the default ERP only when it is non-stale. A stale default is excluded and shown in the existing missing-item list (`wacc-reference-missing`) with the reason ("기준일/검증일 12개월 경과 — 개별 확인 후 적용"); the "n / total" count treats it as not applicable. Alternatives are never included.
- Applying is not confirming. The ERP is confirmed only through the existing CAPM confirmation and persisted as `wacc.erp`, **`kind='user'`**, carrying `source_label` / `anchor_ref` / `as_of`, with `rationale` recording `erp_reference_id`. If the human edits the number after applying, the citation is kept and the note flags `edited_from_reference: true`.

## 7. Audit

- Apply is client-side only (no server write), so it creates no audit row.
- The audited event is the existing WACC confirmation: its detail payload gains `erp_reference_id` (`null` if typed manually), `erp_reference_default` (boolean) and `erp_reference_stale` (boolean), so a stale or non-default reference that reached a confirmed WACC is traceable. No new event type.
- Registry changes are audited by git history and PR review.

## 8. What stays human

- Whether to use a published reference at all, and which source.
- Confirming the ERP and the WACC; `kind` stays `user`.
- No gate, RAG grade, kill-criteria or data-confidence effect: a suggested ERP does not raise an evidence tier and is not a `live` value. Outputs remain decision support, not investment advice.

## 9. Failure modes

| Failure | Handling |
|---|---|
| No entry / non-KR market | null entry with reason; manual entry still possible |
| Default entry stale | shown with warning, excluded from apply-all (listed as missing with reason), individually applicable |
| Source URL dead | entry still shown (value verified at `verified_on`); maintainer fixes at next check; validator does not fetch URLs |
| Mis-transcribed value | caught at review; fixed by a superseding entry with correction note; past confirmations keep `erp_reference_id` so affected projects can be listed |
| Basis mismatch (e.g. source ERP already includes country risk premium) | `basis` and `note` displayed; double counting is a human judgment |
| Source turns out to be paywalled or login-gated | not registered (D2) |
| YAML parse error at runtime | route fails soft for ERP only; the validator in `audit.ts` should stop it reaching main |

## 10. Lifecycle

- `region-profiles/**` rule (project CLAUDE.md): `source` / `verified_on` / `maintainer` mandatory on every field, `_validate.ts` rejects unsourced fields. The maintainer of `erp_references` (quant-methodologist) updates the block on each new edition and re-verifies at least every 12 months, ahead of the stale threshold.
- `_schema.yaml` / `_validate.ts` change: region-lead reviews as profile-contract owner.
- ADR trigger list: no DB schema, auth or MCP tool-scope change, so no schema ADR. ADR-0207 is required because it amends the ADR-0115 source-kind convention. Moving the registry into a DB table later would need its own ADR.
- `agents/**` and `skills/**` are untouched; if the `wacc-input-session` skill text lists the ERP as user-only, align its wording in the implementing PR (skill-existence bar unaffected).

## 11. Test plan

- Validator unit tests: missing each mandatory section and entry field, non-https URL, future `as_of` / `verified_on`, value outside band, duplicate id, dangling `superseded_by`, `default_source_id` missing / dangling / pointing at a superseded entry, empty `entries`; an absent `erp_references` section still passes (other profiles unaffected).
- Route unit tests: default entry chosen via `default_source_id`; alternatives listed and never default; stale boundary at 11 / 12 / 13 months for both `as_of` and `verified_on`; no-entry and non-KR null entries; ERP entry present with no subject company bound; other suggestion keys unchanged (snapshot).
- Panel tests: default marker and stale badge render; stale default is listed in `wacc-reference-missing` and excluded from apply-all (count n / total); fresh default is included; alternatives never included; individual apply works on a stale row.
- Confirm route test: persisted `wacc.erp` row `kind='user'` with citation and `erp_reference_id`; manual entry gives `null`; audit detail carries `erp_reference_default` / `erp_reference_stale`; edited-after-apply flag.
- Regression: `snapshot-filler.ts` exact keys (`wacc`, `hurdle_irr`) byte-identical; `assembleDerivation()` output unchanged for identical inputs.
- design-lint pass; ko/en locale keys present.

## 12. Statutory marginal tax rate (addendum 2026-11-26)

The WACC suggestion list also offers `wacc.tax_rate`, mirroring the ERP reference: a read-only registry in `region-profiles/KR.yaml`, a route-level proposal, a confirmation that stays `kind='user'`. ADR-0207 decision 10 records the decision.

### 12.1 Statute (verified 2026-11-26 through the k-law Open API; effective 2026-01-01, amended 2025-12-23 / 2025-12-31)

| Schedule | Statute | Taxable income (KRW) | National | Local (1/10) | Combined |
|---|---|---|---|---|---|
| `general-domestic` (default) | Corporate Tax Act Art. 55(1)1 | up to 200 million | 10% | 1.0% | 11.0% |
| | | over 200 million, up to 20 billion | 20% | 2.0% | 22.0% |
| | | over 20 billion, up to 300 billion | 22% | 2.2% | 24.2% |
| | | over 300 billion | 25% | 2.5% | 27.5% |
| `sincere-filing-corp` | Art. 55(1)2 (corporations under Art. 60-2(1)1) | up to 20 billion | 20% | 2.0% | 22.0% |
| | | over 20 billion, up to 300 billion | 22% | 2.2% | 24.2% |
| | | over 300 billion | 25% | 2.5% | 27.5% |

Local corporate income tax is 1/10 of the national rate (Local Tax Act Art. 103-20(1)); municipalities may adjust it by +/-50% by ordinance (Art. 103-20(2)). The registry carries the standard 1/10 rate and the adjustment band is stated in every note. Only the default schedule is suggested; the second schedule is registered so a later selector does not need a schema change.

### 12.2 Registry and validator

`corporate_tax_rates` is a new optional top-level section (schema 1.3), a sibling of `erp_references` rather than a block under the free-text `tax` section, because it is a machine-read table with its own contract. `data` = `effective_from`, `default_schedule_id`, `local_rate_ratio`, `schedules[]`; a schedule = `id`, `statute_ref`, `local_statute_ref`, `url` (https), `brackets[]` with `lower_krw`, `upper_krw` (null = open top), `national_rate_pct`, `local_rate_pct`, `combined_rate_pct`. Section provenance (`source`, `verified_on`, `maintainer` = financial-analyst) follows the generic rule. `_validate.ts` additionally requires: `effective_from` a valid date not in the future (in-force figures only); unique schedule ids; brackets contiguous from 0 with exactly one open bracket, last; non-decreasing combined rates inside (0, 50); `local = national x local_rate_ratio` and `combined = national + local` within 0.0005. It cannot re-verify the statute; `verified_on` / `maintainer` remain the human attestation. A statutory amendment is a PR that replaces the schedule and bumps `effective_from` / `verified_on`.

### 12.3 Suggestion logic (`db/lib/tax-rate-reference.ts`, suggestions route)

- Market: same resolution as ERP (`resolveProjectMarket`). Non-KR, missing registry or parse error give `{key:"tax_rate", value:null, reason, reason_code}` with `tax_rate_market_not_kr` / `tax_rate_no_registry` / `tax_rate_registry_error`.
- Income figure: the subject company's latest fiscal year in `fact_financial` that has either account, preferring pre-tax income (`ifrs-full_ProfitLossBeforeTax`) within that year, else operating income (`ifrs-full_ProfitLossFromOperatingActivities`). Pre-tax income is NOT collected today: `WANTED_ACCOUNTS` (dart-client) and the md_account seed (migration 0083) carry only 8 accounts, so operating income is the proxy in practice. Adding pre-tax income to the collector is a separate change (migration + collector); the lookup picks it up automatically once its account row exists. Values are raw KRW as filed.
- Bracket: the first bracket whose `upper_krw` is null or at least the income (upper bound inclusive, matching "X or less"). The rate is that bracket's combined rate. A deduction such as interest lowers the last won of income, so the bracket's own rate is the marginal rate for the debt tax shield.
- Fallback to the top bracket (27.5) with `basis: "top_bracket_fallback"` and `fallback_reason_code`: `tax_income_no_company` (no subject bound), `tax_income_no_financials`, `tax_income_not_positive` (zero or loss). The top bracket is a conservative upper bound, and it is labelled as a fallback rather than presented as an estimate.
- Response fields (value in percent points like `risk_free`; money in integer KRW millions per ADR-0061): `value`, `as_of` (= `effective_from`), `anchor_ref`, `source_label`, `note`, `basis` (`bracket_estimate` | `top_bracket_fallback`), `schedule_id`, `bracket_id`, `bracket{lower_krw_million, upper_krw_million, national_rate_pct, local_rate_pct, combined_rate_pct}`, `statute_ref`, `local_statute_ref`, `effective_from`, `verified_on`, `local_rate_adjustment_pct`, `income_account`, `estimated_income_krw_million`, `income_period`, `fallback_reason_code`, `fallback_reason`. The note always says accounting income is not taxable income and the local rate may vary by +/-50%.
- Apply-all: eligible whenever `value` is not null. A statute has no staleness window like an ERP edition, so nothing is added to `apply_all_excluded`; the registry's `verified_on` is shown instead. The entry is market-common and survives the no-company early return (as a top-bracket fallback).
- The panel's ratio conversion treats `tax_rate` as percent points (`suggestionToInputValue`). Panel wiring of the new key (apply handler, label, basis chips, bracket citation on confirm) is a frontend follow-up.

### 12.4 Confirmation audit

`wacc.tax_rate` may carry optional `tax_reference_bracket_id` (`<schedule_id>.<lower_krw>`), `tax_reference_basis` and `edited_from_reference`. The server resolves the bracket id against the registry (unknown id: 400, no run created) and derives `edited` by comparing the confirmed ratio with the bracket's combined rate, so the client flag is ignored. The basis is validated as an enum and recorded as cited (the server cannot re-derive it: it depended on the income figure at suggestion time). The row stays `kind='user'`, the rationale gains `tax_reference_bracket=<id>`, `tax_reference_basis=<basis>` and, when edited, `edited_from_reference: true`, and the existing `assumption_set` audit target is extended to `<run>:wacc.tax_rate:user:tax_reference_basis=<basis|null>:tax_reference_bracket=<id>:edited_from_reference=<bool>`. A manual tax rate audits exactly as before.

### 12.5 Failure modes and tests

| Failure | Handling |
|---|---|
| Accounting income differs from taxable income (permanent differences, loss carry-forward, tax credits) | stated in the note; the estimate only picks a bracket, the human confirms the rate |
| Operating income used as the proxy | `income_account` says so and the note states pre-tax income is not collected yet |
| Municipal local-rate adjustment (+/-50%) | stated in the note; registry carries the standard 1/10 |
| Statute amended | registry replaced by PR with new `effective_from` / `verified_on`; past confirmations keep the bracket id they cited |

Tests: `tests/unit/wacc-tax-rate-reference.test.ts` (bracket boundaries, income lookup incl. revisions and pre-tax preference, fallbacks, non-KR, malformed registries, suggestions route, confirmation audit) and `tests/unit/region-tax-rates-validator.test.ts` (validator rules).
