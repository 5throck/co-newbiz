# ADR-0207: WACC ERP — cited published reference may be suggested; confirmation stays kind=user

- Status: Accepted (2026-11-26)
- Date: 2026-11-26
- Deciders: New Business Review Lead (PM); method review quant-methodologist; profile-contract review region-lead
- Amends: ADR-0115 (source-kind convention, decision 2)
- Related: ADR-0116 Phase 4 (WACC reference suggestions), ADR-0058 §2 (anchor shape), design `docs/designs/2026-11-26-wacc-erp-published-reference-design.md`

## Context

ADR-0115 fixes the CAPM source kinds: risk-free = live, ERP / target D/E = user, beta = derived. The reference-suggestion route offers cited `risk_free`, `credit_spread` and `observed_de` values that a human applies and confirms. The ERP cannot be collected automatically and has no suggestion, so each analyst supplies an uncited figure and projects drift apart. The user decided to show published ERP figures as reference values that the user can apply; humans still decide.

## Decision

1. **Convention change.** ERP (`wacc.erp`) remains `kind='user'` at confirmation. In addition, cited **published references** may be offered as suggestions. A suggestion is a proposal only: it does not change the kind, does not count as `live`, and does not raise any evidence tier or data-confidence cap.
2. **Multiple sources, one default.** Several published sources are listed side by side. Exactly one is designated the default source (`default_source_id`); only the default takes part in "apply all applicable". Other sources are applied individually.
3. **Free, publicly accessible sources only.** Candidates: Damodaran country risk / implied ERP tables, and KICPA market risk premium guidance if freely published. No paid data (no Kroll / Duff & Phelps, no Bloomberg, no licensed survey). Each entry carries source name, URL (`https`), value and as-of date. Values are transcribed from the source by the named maintainer and reviewed by a different domain; agents must not infer, average or invent values.
4. **Storage: `region-profiles/KR.yaml`.** A new optional `erp_references` section (default source id plus entries) follows the profile contract: the section and every entry carry `source` / `verified_on` / `maintainer`, and `region-profiles/_validate.ts` rejects unsourced or incomplete fields (schema and validator extended accordingly). Entries are superseded, never deleted. KR only for now; other region profiles are unchanged.
5. **No DB schema change.** The confirmed value stays a `wacc.erp` assumption row on the project run (ADR-0115).
6. **Staleness.** An entry whose `verified_on` or `as_of` is older than 12 months shows a stale warning and is excluded from "apply all applicable": it is counted as missing, with a reason, in the existing missing-item list of the WACC panel. It can still be applied individually. The warning never blocks.
7. **Audit.** Apply is client-side and writes nothing. The existing WACC confirmation audit detail records `erp_reference_id` (or null), whether the source was the default, and whether it was stale; edits after applying are flagged in the row note.
8. **Human boundary.** Choosing a source and confirming the ERP stay human. No gate, RAG grade or kill-criteria effect.
9. **Lifecycle.** The `erp_references` maintainer (quant-methodologist) updates the block on each new edition and re-verifies at least every 12 months, under the `region-profiles/**` lifecycle rule. No schema ADR is triggered (no DB, auth or MCP scope change).
10. **Addendum 2026-11-26 - statutory marginal tax rate.** The same suggestion mechanism offers `wacc.tax_rate` as a `tax_rate` reference: the statutory combined rate (Corporate Tax Act Art. 55(1)1 national rate plus Local Tax Act Art. 103-20(1) local income tax at 1/10, effective 2026-01-01: 11.0 / 22.0 / 24.2 / 27.5 percent), stored in a new optional `corporate_tax_rates` section of `region-profiles/KR.yaml` (maintainer financial-analyst; schema 1.3 and `_validate.ts` check bracket contiguity and arithmetic). The bracket is an estimate selected from the subject's latest DART income figure (operating income until pre-tax income is collected); with no company, no income or income of zero or below it falls back to the top bracket (27.5) with a stated reason. Confirmation stays `kind=user`; an applied bracket is cited by `tax_reference_bracket_id` and the server derives the edited flag. It is eligible for apply-all (a statute is not a time-stale estimate), non-KR gets a null entry with a reason, and no DB schema change is made.
11. **Addendum 2026-11-26 - implementation record (as built, PR #981).**
    - *Market resolution.* The reference market comes from the declared scope on the project's source opportunity (`target_scope_json.regions`, ADR-0179; `resolveProjectMarket` in `db/lib/erp-reference.ts`, reused by the tax-rate offer): exactly `["kr"]` resolves to KR; no declared scope (or an unparsable one) also resolves to KR, because every WACC reference series is Korean (ECOS, DART); any other declared scope resolves to non-KR and the ERP and tax-rate entries are null with `erp_market_not_kr` / `tax_rate_market_not_kr`. A project that declared another market is never defaulted to KR.
    - *Kind.* `wacc.erp` and `wacc.tax_rate` are always written `kind='user'` (the panel forces it; applying or editing a reference never changes it). A cited reference is a citation on a user judgment, not a live value.
    - *Observed-to-target D/E.* The panel adds an "apply observed as target" button (`data-testid="apply-observed-de-as-target"`) beside the target D/E input. It copies the observed D/E (the form value, else the `observed_de` suggestion) into the target D/E with a source text of the form "observed D/E carried over (<source> · <as of>)" in the UI language. It is client-side, fills the input only, is never part of "apply all applicable", is disabled when no observed value exists, and the human still confirms; the stored row stays `wacc.target_de`, `kind='user'`. No API or schema change.
    - *Citation payload.* The WACC confirmation request uses the snake_case contract (`source_label`, `anchor_ref`, `as_of`, `erp_reference_id`, `tax_reference_*`, `edited_from_reference`) built by `toWaccComponentPayload`. Before this fix the panel sent the component keys in camelCase, which the route (snake_case only) does not read, so citation fields were not stored. The server validates a non-empty `anchor_ref` with the ADR-0058 section 2 shape (`https://...`, `doc:<id>` or `src:<code>`, no whitespace); anything else fails the whole confirmation with `400 ref_invalid` and no run is created. A typed source URL therefore has to be one of those shapes or the confirmation fails; registry URLs are `https://` by validator rule and always pass.
    - *Display.* The 390px wrapping of the reference summary items is presentation only and carries no decision.

## Consequences

- Consistent, citable ERP across KR projects; reviewers see source, URL and as-of date, and can tell default from non-default and stale from fresh.
- A standing maintenance duty on the registry; an unrefreshed entry degrades to a stale warning and drops out of apply-all rather than silently misleading.
- Free-only sources limit coverage to what is publicly published; a Korean professional-body figure appears only if it is freely accessible.
- ERP suggestions exist for KR projects only; other markets show a null entry with a reason.

## Alternatives considered

- Auto-set ERP from a published source: rejected — ERP is a judgment input under ADR-0115; auto-setting removes the human choice.
- Mark a cited ERP as `kind='live'`: rejected — publications are periodic estimates, not market observations.
- Paid or licensed sources (Kroll, Bloomberg, paid surveys): rejected — licence and transcription limits, and cost.
- Single source only: rejected — hides legitimate methodological spread; side-by-side with one default keeps bulk apply deterministic.
- Stale values blocked, or included in apply-all with only a warning: rejected — blocking removes a usable reference; bulk inclusion lets a click carry an old figure silently.
- DB table registry: rejected for now — needs a schema ADR and duplicate review machinery; YAML gets PR review and the existing provenance validator.
