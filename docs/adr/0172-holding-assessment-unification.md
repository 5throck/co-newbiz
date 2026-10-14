---
lang: ko
lang_reason: proper-noun
---

# ADR-0172 - Holding assessment unification (`보유 판정` relative to the industry, separate `필요 수준`)

- Status: Proposed
- Date: 2026-10-14
- Decider: Human decider (chat 2026-10-14 decisions; formal acceptance pending). Drafted by platform-lead.
- Design-of-record: [docs/designs/2026-10-14-holding-assessment-unification-design.md](../designs/2026-10-14-holding-assessment-unification-design.md)
- Related: ADR-0136 (S5 level fields retired), ADR-0168 (level gap replaced), ADR-0170 (row hash v2), ADR-0171 (S5/S7 read the unified field)
- Slices: 3 (1 scale + compat reader + S3 input + hash v2, 2 consumers + `currentLevel` UI removal, 3 AI draft + wiki/glossary). None implemented by this ADR.

## Context

Each required-capability row carries `held.status` (`충족` / `부분 충족` / `미보유` / `미판정`) and a 5-step `currentLevel` (`보유 수준`). Users read them as one question answered twice. `requiredLevel` shares the 5-step scale, mixing essentiality with proficiency.

## Decision

1. **One held field.** `보유 판정` uses `업계 리딩` / `업계 평균` / `부분 보유` / `미보유` / `미판정`, relative to the industry. Proposed keys `leading` / `average` / `partial` / `none` / `unevaluated`.
2. **Compatible read.** Legacy `met` reads as `average` with a re-assessment hint, `unmet` as `none`; no mass rewrite. Keys are rewritten only on a human save.
3. **`currentLevel` retired** from UI, API writes and the row hash. Stored text is preserved read-only under `legacy`, never dropped or auto-mapped.
4. **`필요 수준`** uses `필수` / `부분 필수` / `선택` (+ unset), S3-owned (decided), edited beside `보유 판정` in the S3 table, read-only in S5/S7/S8; legacy 5-step text shown as out-of-scale input. Optional one-line `필수 범위` for `부분 필수` (recommendation).
4a. **`기대 수준`** (decided): expected industry-relative level once the chosen `해소 방식` is complete, stored in the S5 (Green Field) or S7 per-target (Brown Field) judgement, scale `업계 리딩` / `업계 평균` / `부분 보유` / `미판정`. Residual gap = `필요 수준` vs `기대 수준`, flagged as a caution; resolution-based reachability hints are suggestions only. It feeds the `달성 가능성` draft, the capability-adjusted scenario and the gate brief, and is invalidated with the judgement on S3 change.
4b. **Display order** (decided): `필요 수준` before `보유 판정` on every surface, API, AI output and wiki; canonical per-surface order in the design (section 5A), asserted by tests.
4c. **Placement** (recommendation, awaiting final confirmation): S3 owns `필요 수준` and `보유 판정`; S5 owns `해소 방식` and `기대 수준`; S7 per target owns the target's `보유 판정` (same 4-level scale) and `기대 수준`, with `해소 방식` fixed to `인수 통합`.
5. **Scoring.** Coverage weights `leading` 1, `average` 1, `partial` 0.5, `none` 0; a `필요 수준` x `보유 판정` gap flag is a caution only.
6. **Row hash v2** over capability, required note, required level, held status, holders, evidence. v1 hashes are recomputed on read and re-stamped lazily, so untouched judgements do not go stale.
7. **Decision support only.** No gate block, no grade cap; humans confirm, AI drafts only.

## Consequences

- No schema change and no migration (JSON fields); optional audited rewrite script later.
- About twenty files change (list in the design, section 7); route-advisory keeps `unmet` as a deprecated alias for one release.
- `LevelSelect` and the S5 level columns are removed.

## Honest limits

Proposed, not accepted. Open decisions OD-1..OD-14 are in the design. MCP tool handlers and live data distribution were not inspected. Outputs are decision support, not investment advice.
