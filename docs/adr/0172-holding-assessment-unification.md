---
lang: ko
lang_reason: proper-noun
---

# ADR-0172 - Holding assessment unification (`보유 판정` category, narrative levels, `필요도`)

- Status: Accepted (2026-10-14)
- Date: 2026-10-14
- Decider: Human decider (chat approval 2026-10-14, "ADR-0171 / 0172 승인"). Drafted by platform-lead.
- Design-of-record: [docs/designs/2026-10-14-holding-assessment-unification-design.md](../designs/2026-10-14-holding-assessment-unification-design.md)
- Related: ADR-0136 (S5-fills-levels superseded), ADR-0168 (5-step scale superseded), ADR-0170 (row hash v2; correction on level ownership reversed), ADR-0171 (S5/S7 judgement fields)
- Slices: 3 (1 S3 model and UI + hash v2, 2 S5/S7 read-only + `기대 수준` + consumers + 5-step retirement, 3 AI drafts + wiki/glossary). None implemented by this ADR; implementation begins after acceptance (slice 1 starts now).

## Context

Required-capability rows carry `held.status` (`충족` / `부분 충족` / `미보유` / `미판정`) and `requiredLevel` / `currentLevel`, which hold narrative text but were given a 5-step dropdown in S5/S8 that hides that text. `충족` does not say average vs above the industry, and no field records how essential a capability is.

## Decision

1. **`보유 판정`** is a simple industry-relative category `업계 리딩` / `업계 평균` / `부분 보유` / `미보유` / `미판정` (keys `leading` / `average` / `partial` / `none` / `unevaluated`). Legacy `met` reads as `average` with a re-assessment hint, `unmet` as `none`; keys are rewritten only on a human save.
2. **`필요 수준` and `보유 수준`** are narrative text (`requiredLevel`, `currentLevel`), S3-owned, entered through a shared modal with a two-line preview. The 5-step scale is retired from the UI; existing text is valid data.
3. **`필요도`** (`필수` / `부분 필수` / `선택`, unset) is a new S3 field after `필요 역량`.
4. **Display order** everywhere: `필요 역량`, `필요도`, `필요 수준`, `보유 판정`, `보유 수준`, `보유 주체·근거`, then S5/S7 `해소 방식`, `기대 수준`, cost, months, `달성 가능성`, evidence.
5. **Placement.** S3 owns the definition fields. S5 owns `해소 방식`, narrative `기대 수준`, cost, months, grade, rationale. S7 per target owns the target's `보유 판정` and `보유 수준` and `기대 수준` after integration, with `해소 방식` fixed to `인수 통합` (recommendation). S8 is read-only.
6. **Caution only** from `필요도` x `보유 판정` and from empty narrative on `필수` rows; no automatic comparison of narrative fields. Coverage `보유율` weights 1/1/0.5/0.
7. **Row hash v2** over capability, required note, `필요도`, required level text, held status, current level text, holders, evidence. v1 hashes are recomputed on read and re-stamped lazily.
8. **Decision support only.** No gate block, no grade cap; humans confirm; AI drafts only.

## Consequences

- No schema change and no migration (JSON fields).
- About twenty-five files change (design section 11); `LevelSelect` and the 5-step helpers are removed.
- Route advisory keeps `unmet` as a deprecated alias for one release.

## Honest limits

Accepted by chat; open decisions OD-1..OD-11 are resolved as recommended in the design. MCP tool handlers and live data distribution were not inspected. Outputs are decision support, not investment advice.

## Acceptance record

- Approver: the human decider (user, account techcross), chat 2026-10-14: "ADR-0171 / 0172 승인". Recorded in DEC-20261014-09.
- Basis: chat approval of the ADR as written, including the design's recommended resolutions of OD-1..OD-11. Acceptance is by chat instruction; the decider did not review a per-item checklist, and this record does not claim the approver read specific items.
- Scope: acceptance covers the decision. Nothing of slices 1-3 is implemented yet; implementation begins after acceptance, with slice 1 starting now.
- Known limitations (owner: platform-lead): MCP tool handlers and live data distribution were not inspected.

## Amendment 2026-10-14 - AI proposals for necessity, required level and holding status

- Change: the earlier rule that the AI proposal never proposes `필요도` or `필요 수준` is reversed by the decider (chat 2026-10-14). There are now two separate AI actions in the S3 section. (1) "필요 역량 제안 (AI)" (requirement side) proposes extra rows from synergy areas and drafts `필요도` (with a scope note for `부분 필수`) and `필요 수준` for proposed rows and for existing rows where the field is empty; it no longer drafts holding fields. (2) "보유 판정 확인 (AI)" (holding side) drafts `보유 판정`, `보유 수준` and `보유 주체·근거` from company information (group/affiliate profiles) AND bounded external web search; the AI may use external search for these drafts.
- Guardrails kept: drafts only. A non-empty human value is never overwritten (fill-empty-only). Routes write nothing to the database; the human reviews, edits, and presses 저장. Filled fields show an "AI 초안" chip until edited or saved, with a short basis (and source links for holding drafts). Values the inputs do not support stay empty or `미판정`; holding drafts require citations (a profile field or a valid search source number), `업계 리딩` needs comparative evidence, `부분 필수` is only kept with a stated scope. Web text is treated as untrusted data (tags stripped, capped, never followed as instructions). Search gating follows the S6 web-search proposal; any search failure degrades to profile-only with an explicit note. Without an LLM the fallbacks leave all of these fields empty.
- Also reversed (UI only): the earlier "narrative fields via modal" decision no longer applies to `필요 수준` and `보유 수준`, which are edited inline in the table; the modal remains for `보유 주체·근거`.
- Scope: `llm-draft` and new `holding-check` routes, their normalizers (`capability-gap-necessity-draft.ts`, `capability-holding-check.ts`), the S3 linkage tab. Gate approval and the investment decision remain human.
- Not verified by the AI: nothing exercised in a browser.

## Amendment 2026-10-14 (2) - 해소 힌트 and 보유 주체 removed from S3

- Decider decisions (chat 2026-10-14, binding): (1) The `해소 힌트` column is removed from the S3 required-capability table. The same `resolution` field is owned by S5 (`해소 방식`, ADR-0171) and S7; S3 must not edit it. (2) The `보유 주체` field is removed (option B): holders are folded into the `보유 수준` narrative and the evidence text; the column `보유 주체·근거` becomes `보유 근거` (evidence only).
- Canonical order is now `필요 역량`, `필요도`, `필요 수준`, `보유 판정`, `보유 수준`, `보유 근거`, then S5/S7 `해소 방식`, `기대 수준` (constant `CAPABILITY_COLUMN_ORDER` ends in `evidence`). The `보유 근거` modal has a single evidence textarea (400 characters).
- Data safety: nothing is deleted or rewritten silently. `held.holders` stays in the stored JSON and in the normalize round-trip as legacy read-only data; `resolution` keeps being stored. Rows that carry legacy holders show a read-only caption `기존 보유 주체: …` under the evidence preview (S3, S5, S8); it is never auto-merged into the evidence. The S3 PUT merges `resolution` and `held.holders` from the current stored row by row id, inside the same transaction, when the client omits them, so an S3 save can never wipe or overwrite the S5 `해소 방식` or a judgement.
- Row hash v2 is unchanged: holders stay in the hash. Their value cannot change any more (not editable), so no judgement goes stale and there is no hash version bump.
- AI: the requirement proposal never touched holders. The holding check no longer produces holders; it proposes `보유 판정`, `보유 수준` and `보유 근거` (evidence text with citations). A judged status survives with "a profile basis or a cited source" (previously "a scoped holder plus a profile basis"). The per-row re-check dialog shows these three only.
- Cell rule (decider, same day): the `보유 근거` cell holds only the button. No preview text and no `미입력` marker; the label is `입력` (empty), `수정` with a check icon (filled) or `보기` (read-only), with a `title` of the first ~60 characters of the evidence and an aria-label that states whether it is filled. The legacy-holders caption stays, small, below the button.
- Removed (decider, same day): the per-row `다시 확인` re-check (row button, `HoldingRecheckDialog`, the `rowId` single-row mode and `proposals[rowId]` response of the holding-check route). Only the batch `보유 판정 확인 (AI)` remains and it fills empty fields only; a person refreshes a non-empty row by editing it by hand.
- Renamed (decider, same day): the button `필요 역량 추가 제안` is now `필요 역량 제안 (AI)`, next to `보유 판정 확인 (AI)`.
- Requirement proposal hardened: rows with a missing `필요도` or `필요 수준` are always detected (header chip `필요도·필요 수준 누락 N건`, per-cell `누락` marker) and proposed, new rows arrive with both fields, and the note reports filled and still-missing cells with the reason. LLM output is handled in batches of 6 rows with per-item validation, salvage of truncated/fenced JSON, and one stricter retry; failures are reported by category without the raw response. The holding check uses the same path.
- Holding check diagnosis: rows a person already judged are kept (counted), dropped rows carry a specific reason, a judged status needs a profile basis or a cited source (never fabricated), and missing search configuration or missing profiles are named in the note.
- Unsaved AI drafts no longer vanish on a refetch: the screen state merges server rows with unsaved drafts, shows `저장하지 않은 AI 초안 N건` and offers `AI 초안 버리기`.
- Not verified by the AI: nothing exercised in a browser; no live data inspected.
