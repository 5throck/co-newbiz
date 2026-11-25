---
lang: ko
lang_reason: proper-noun
---

# S8 Excluded-Target Handling (hide excluded cases, surface stale selection/adoption)

- Spec ID: `2026-11-24-s8-excluded-target-handling-design`
- Date: 2026-11-24
- Status: Approved (user + PM, 2026-11-24)
- Author: platform-lead (technical domain lead), under PM dispatch
- Decision record: `docs/decisions/DEC-20261124-02.md`
- ADR: `docs/adr/0206-s8-stale-target-go-block.md` (Accepted) — required, adds a gate-integrity rule family
- Related: ADR-0143 (S8 target axis), ADR-0157 (optional per-target DD), ADR-0186 (gate integrity, rule families), ADR-0053 / boundary #2 (humans own decisions), PR #973 (`activeTargetCases`, `shortlistedTargetIds`)

## 1. Why a new spec and not an amendment

`2026-09-22-s8-multi-target-feasibility` is **Implemented** and defined the target axis assuming the
Short List is stable after S7. This spec adds two behaviors that design did not cover: (1) list
filtering when a target leaves the Short List, and (2) a new FS GO hard block. (2) is a gate rule
change (ADR trigger: "Stage Gate/Kill Criteria changes"), so it gets its own spec and ADR instead of
an amendment block on an implemented design.

## 2. User decisions (2026-11-24, authoritative)

- **A.** Cases of excluded targets are hidden from every S8 surface. No "reference" section.
- **B.** Selection (`target_selection`) and adoption (`business_case_adoption`) records are never
  auto-invalidated. The system shows a warning, blocks the FS GO, and stops downstream consumers from
  using the stale adopted case until a human re-selects or re-adopts.

Shortlist rule (unchanged, PR #973): `brownfield_target.status = 'shortlisted'` under
`md_project.source_opportunity_id`. Cases with `target_id IS NULL` (greenfield, legacy) are always active.

## 3. (a) Server-side filtering point

**Decision: filter at the source, with an explicit opt-out.**

- `listBusinessCases(projectId, opts?: { includeExcludedTargets?: boolean })`. Default `false`:
  `cases` (and `archived`) pass through `activeTargetCases(..., shortlistedTargetIds(projectId))`.
- `recommendedScenario` and the goal-judged case are derived from the filtered list.
- `adoption` is returned **as recorded** (never filtered: it is a human record). It gains
  `adoption.stale: StaleReason | null` from §4 so every caller sees the stale state without a second query.
- Opt-out callers (`includeExcludedTargets: true`) are allowed only where history is the point:
  audit/data-change views, archive/export, and `adoptBusinessCase`'s own lookup at
  `lib/business-case.ts:442` (it must find the case to reject it with a clear 409, not a 404).
  Each opt-out call carries a one-line comment naming why.
- PR #973's call sites (`gate-brief.ts:406`, `adoption-recommendation/route.ts:64`) drop their
  local `activeTargetCases` wrapper once the source filters (idempotent if left; removal is cleanup).

Weighed alternative: filter per consumer (status quo after #973). Rejected — 9 call sites today, and
every new one would leak by default. Source filtering inverts the default; history is the exception.

Individual GET by id (`get_business_case`, run detail) for an excluded-target case: returns 200 with
`target_excluded: true` rather than 404, so deep links and audit stay readable; S8 UI never links to them.

## 4. (b) Stale-state computation

New pure helper in `lib/business-case.ts` (no DB access; callers pass inputs):

```ts
type StaleReason = "selected_target_excluded" | "adopted_target_excluded" | "adopted_target_mismatch";
function staleS8Records(input: {
  selection: { target_id: string } | null;          // latestTargetSelection
  adoptedCase: { target_id: string | null } | null; // case behind latestAdoption (unfiltered lookup)
  shortlistedIds: ReadonlySet<string>;
}): { selection: StaleReason | null; adoption: StaleReason | null; any: boolean };
```

Rules:
- `selection` stale when `selection.target_id` not in `shortlistedIds` → `selected_target_excluded`.
- `adoption` stale when the adopted case has a `target_id` not in `shortlistedIds` → `adopted_target_excluded`;
  or when both exist and `adoptedCase.target_id !== selection.target_id` → `adopted_target_mismatch`
  (can arise after a human re-selects; re-adoption is then required).
- `target_id NULL` adoption is never stale. No selection + no adoption → not stale.

A thin DB wrapper `resolveS8Staleness(projectId)` loads the three inputs and calls the helper; all
server consumers use the wrapper. Records covered: latest `target_selection`, latest adoption. Older
rows are history and are not evaluated.

## 5. (c) UI warning (Korean UI, INTERIM-WORDING)

Rendered from `adoption.stale` / a `staleness` field on the business-case GET; one shared
`StaleTargetBanner` component (Onyx 3.0 warning callout, icon + text, not color-only, `role="status"`).

| Location | Copy (INTERIM-WORDING, catalog keys under `s8.staleTarget.*`) |
|---|---|
| S8 결정 탭, top of the tab (above GateDecisionPanel) | 선택된 대상 기업 ‘{name}’이(가) 더 이상 Short List에 없습니다. 대상을 다시 선택하고 사업성 분석안을 다시 채택해야 FS 게이트 GO를 기록할 수 있습니다. |
| S8 대상 비교 (target comparison) header | 채택된 분석안의 대상 기업 ‘{name}’이(가) Short List에서 제외되었습니다. 기록은 그대로 보존됩니다. |
| Mismatch case | 채택된 분석안의 대상 기업이 현재 선택된 대상과 다릅니다. 분석안을 다시 채택해 주세요. |
| GateDecisionPanel GO option disabledReason (FS) | Short List에서 제외된 대상이 선택·채택되어 있어 GO를 기록할 수 없습니다. HOLD·KILL은 기록할 수 있습니다. |

The banner names the target (company name from `brownfield_target`) and links to the selection
control. Strings go through next-intl ko/en (ADR-0184); `// INTERIM-WORDING` marks the ko keys.

## 6. (d) FS GO block

Reuse the ADR-0186 rule-family mechanism in `lib/gate-write-checks.ts` (same shape as `goWaccCheck`):

- New `goStaleTargetCheck(ctx)`, family **`target`**, env `CO_NEWBIZ_GATE_INTEGRITY_TARGET = off|shadow|enforce`
  Default **`enforce`** in every environment, with no shadow release (user decision 2026-11-24). The env var
  stays as an operator escape hatch, the same way the other ADR-0186 families work.
- Gates: `fs` (hard block when `any`), and re-read at `dd`, `entity_ic`, `group_ic` (block on stale too —
  user decision B says downstream must not proceed on a stale record).
- Failure: 409 `target_not_shortlisted`, message "GO is not allowed — the selected/adopted target is no
  longer on the Short List; re-select the target and re-adopt a business case. HOLD or KILL can be
  recorded at any time.", `details: { selection, adoption, target_ids }`.
- Wire-in: `app/api/projects/[id]/gate-decisions/route.ts` after `goWaccCheck` (~line 260), before
  `gateGoPrerequisiteGaps`. Also re-check inside the decision write transaction like the wacc family.
- Panel: GateDecisionPanel already disables GO options from server-provided reasons
  (`submitReason`, line ~1312; sequence lock, line ~1205). Add the stale reason to the same
  disabled-reason path, sourced from the business-case GET `staleness` (no client-side recomputation).
- HOLD and KILL stay allowed. Existing gate rows are untouched (new writes only).
- MCP `propose_gate_decision` goes through the same route → same 409. No MCP scope change.

## 7. (e) Downstream consumers

| # | Consumer | Behavior |
|---|---|---|
| 1 | `GET business-case`, `GET business-case/generate/[runId]` | Filtered `cases` via §3; add `staleness`. UI scenario comparison and case list need no own filter. |
| 2 | `ic-package/route.ts:66`, `report-composer.ts:36/54` sibling pick | Sibling = `scenario === adopted.scenario && id !== adopted.id && target_id === adopted.target_id` over the filtered list. If adoption stale: return the package/report with `stale: StaleReason` and **no adopted-case figures** (section shows the stale notice), never the stale numbers. |
| 3a | `lib/s8-lens-summary.ts:100` | Stale → lens summary returns `{ state: "stale_target" }`; UI renders the banner instead of lens figures. |
| 3b | `target-check/route.ts:28` `goalJudgedCase` | Computed on filtered list; if selection stale, respond `stale` with no judged case. |
| 3c | `deal-structure-recommendation/route.ts:58` | Stale → 409 `target_not_shortlisted` (LLM recommendation is not generated on a stale basis). |
| 3d | `milestones/suggest/route.ts:32` | Stale → 409 `target_not_shortlisted`. |
| 3e | `lib/ic-gap-override.ts:26` | Stale adoption is a gap: push "채택된 Business Case의 대상이 Short List에서 제외됨 (S8)". |
| 3f | `lib/ic-review-steps.ts:368` `buildIcMemo` | Stale → memo omits adopted-case financials and lists the stale state under "could not verify". |
| 4 | `adoptBusinessCase`, `selectTarget` | Unchanged write-time rejection; uses `includeExcludedTargets: true` for lookup so the 409 is precise. |

Error code `target_not_shortlisted` is shared across API, envelope-shaped per existing `fail()`.

## 8. Seams and landing order

API/lib only — **no DB schema change, no migration** (all inputs exist). Order: lib helper + source
filter (backend-engineer) → gate family + route wiring (backend-engineer) → consumers (backend-engineer)
→ banner + panel reason (frontend-engineer) → i18n keys. security-engineer: no auth change; confirm
opt-out callers don't widen visibility (filter is narrowing only).

## 9. (f) ADR

Required. Trigger: "Stage Gate/Kill Criteria changes" (`docs/adr/README.md` trigger list) — a new
GO hard block. Recorded as `docs/adr/0206-s8-stale-target-go-block.md` (Accepted 2026-11-24), amending ADR-0186
(new family `target`) and ADR-0143 (Short List exits after S8 entry). PM approves; humans own the gate.

## 10. (g) Test plan and acceptance criteria

Unit (bun test):
- `staleS8Records`: matrix — none/none, selection shortlisted, selection excluded, adopted excluded,
  adopted null-target, mismatch, both excluded.
- `listBusinessCases`: default excludes excluded-target cases (fixture: 6 excluded + 6 shortlisted → 6);
  `includeExcludedTargets` returns 12; null-target cases always present; `adoption` never filtered.
- `goStaleTargetCheck`: off/shadow/enforce; fs blocks; dd/entity_ic/group_ic block on stale; HOLD/KILL pass.
- Sibling pick never crosses `target_id`.

Route/integration: gate-decisions POST fs GO → 409 `target_not_shortlisted` when stale; 201 after
re-select + re-adopt. ic-package / report return `stale` and no figures. deal-structure & milestones → 409.

UI (manual + design:lint): project `01M7YG6YG16FTJRCYZMD4Z6AGY` shows 6 태웅 cases only; after
excluding the selected target, 결정 탭 and 대상 비교 show the banner, FS GO option is disabled with reason.

Acceptance:
1. No S8 screen, API list response, AI input or composed document contains an excluded target's case.
2. Selection/adoption rows are byte-identical before and after exclusion (no auto-invalidation).
3. FS GO is refused (enforce) while stale; HOLD/KILL accepted; GO accepted after human re-select/re-adopt.
4. No downstream consumer emits figures from a stale adopted case; each surfaces the stale state.
5. `bun scripts/audit.ts`, design:lint, i18n-lint pass.

## 11. Verified / could not verify / needs judgement

- Verified: call-site list (`grep listBusinessCases(`), gate route order and ADR-0186 family mechanism, write-time rejections.
- Could not verify: exact GateDecisionPanel prop path for the disabled reason; whether any export/archive job calls `listBusinessCases` outside `app/web-next` (none found in `scripts/`).
- Needs judgement: none open. Resolved 2026-11-24 by the user: (1) GO is blocked at fs, dd, entity_ic and
  group_ic while stale, and HOLD/KILL stay allowed; (2) `target` ships straight to `enforce` (default), with the env var kept as an escape hatch.
