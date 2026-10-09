# UI fixes: S8 units, default analysis target, S9 subject header and DD table widths

- Date: 2026-10-09
- Status: Implemented
- Related: ADR-0156 (per-target WACC), ADR-0157 (optional per-target DD), ADR-0061 (KRW millions), design 2026-10-09-per-target-wacc-financials

## Problems

1. S8 NPV p05/p50/p95 and p50-difference cells showed bare numbers.
2. On multi-target brownfield projects the WACC and financial-analysis selector offered a "project-level" chip next to the targets, which hides which company the numbers are for.
3. S9 did not say which company the DD is for.
4. The S9 commercial DD table squeezed its judgement, evidence and waiver columns because the item column took the width.

## Decisions

1. **Units.** `npv_krw_m` is stored in KRW millions (ADR-0061). Column headers carry `(백만 원)` through `KRW_MILLIONS_UNIT` and cells use `formatKrwMillionsPlain`, both in `lib/format.ts`. The p50-difference header says `(백만 원, 시장 기반 대비 %)`. IRR headers say `(%)`; growth and sigma cells already print `%`. The S8 scenario table has no BEP column.
2. **Default target.** `lib/target-default.ts` resolves the active chip: the S8-selected target (the target bound on `md_project.company_id`, synced by business-case target selection), else the first shortlisted target. The project-level chip is removed from the shared `TargetSelector`, which now renders the shared `FilterChip` (Onyx tokens, `aria-pressed`, a check mark for the selected state, text badge `게이트 기준`).
   - Gate semantics are unchanged: the bound target maps to the project-level scope, so API calls omit `target_id` and the gate figure (`run.subject_company_id IS NULL`) stays reachable. Any other target sends `target_id` and stays per-target evidence.
   - If no target is bound yet (no S8 selection) the first target is shown per-target, and a one-line note says the gate basis appears after the S8 selection. Legacy project-level rows are therefore still shown at the bound target and never lose a chip.
   - Greenfield and single-target projects: selector hidden, project-level view, as before.
3. **S9 header.** `실사 대상: <name>` with a chip `S8 선정 대상 · 게이트 기준`; a comparison target shows the chip `비교 근거`. With no S8 selection or no shortlist (greenfield) the header states that as text.
4. **DD table widths.** One `.dd-table` rule set (fixed layout above 640px): item column flexible with a minimum, fixed widths for the required, judgement and action (judgement record and waiver) columns, item and waiver text wraps. All three domain tables are the same component, so they now share the rule. Below 640px the existing card layout remains.

## Testing

Unit `tests/unit/target-default.test.ts`; E2E `brownfield-ma` selector scenarios updated (no project chip, gate-basis chip is the default). Evidence screenshots: `docs/evidence/gui-review/ui-2026-10-09-b/`.
