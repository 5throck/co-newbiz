---
title: S8 capability attainability review (required capability level from S3)
status: proposal
date: 2026-10-14
owner: platform-lead
lang: ko
lang_reason: source-material
---

# S8 capability attainability review

Korean appears only as UI labels in backticks. All prose is English.

## 1. Problem statement

The human decider asked (chat 2026-10-14) that S8 business-case analysis check whether the capability **level** required by S3 can actually be reached. The current code does not do this.

Evidence (paths relative to `app/web-next/`):

- The S3 register shape is `CapabilityGapRow` with `capability`, `source`, `requiredNote`, `held {status, holders, evidence}`, `resolution`, `note`, `requiredLevel`, `currentLevel` (`lib/capability-gap.ts:15-27`). Status is `met | partial | unmet | unevaluated` (`:11`) and resolution is `build | partner | hire | invest` (`:12`). `requiredLevel`/`currentLevel` are free text capped at 120 chars (`:89-90`) and are filled by S5 per ADR-0136 (`:23-24`).
- Storage: `opportunity.capability_gap_json` (`db/migrations/0098_opportunity_capability_gap.sql:10`). The legacy S5 `greenfield_assessment.capability_gaps_json` (`db/migrations/0056_greenfield_assessment.sql:11`) is no longer written (`lib/gate-brief.ts:162-163`). `lib/project-charter.ts:56` still reads the legacy column.
- Consumers today: S4 route advisory coverage signal (`lib/track-advisory.ts:129-168`), the gate brief S3 summary and S5 gap line (`lib/gate-brief.ts:84-88`, `:164-168`), Brown Field evaluation criteria (`lib/brownfield-eval-criteria.ts:106-111`), and the S5 `필요 역량(S3) 확인` table (`components/stages/GreenfieldStage.tsx:99`, `:252-259`). Writes go through `PUT /api/opportunities/[id]/capability-gap` with an audit entry under the calling user (`app/api/opportunities/[id]/capability-gap/route.ts:65`, `:78`).
- **S8 has no capability input.** No file among `lib/business-case*.ts`, `lib/business-goals*.ts`, `components/stages/BusinessCaseStage.tsx` mentions capability or `역량` (case-insensitive grep, empty result). `CaseInputs` (`lib/business-case-generator.ts:404-440`) has market size, growth, WACC, revenue anchor, acquisition pricing and `bcParams` (capture rate and ramp-up), but nothing about capability. The simulation charges a year-0 investment (`:361`, `:367`) and applies a utilization ramp (`:364`, `:374`). Both silently assume that every required capability exists from day one.
- Scenarios are fixed to `base | upside | downside` (`:56-57`). S8 tabs are `goals, scenarios, targets, wacc, financial-analysis, overview, params, target-costing, decision` (`lib/business-goals-view.ts:29`). The Brown Field target comparison is `TargetComparisonRow` (`components/stages/BusinessCaseStage.tsx:86`, tab `대상 비교·선정` at `:559`).
- Grade rule: data confidence caps the overall grade (`db/lib/rag-service.ts:16-18`; `packages/core-scoring/src/data-confidence.ts:4`). Capability attainability does not feed RAG today.

As a result, a case can show an attractive NPV/IRR while S3 still records `unmet` capabilities with no closing cost, no closing time and no attainability judgement.

## 2. Proposal

### 2.1 Shared 5-step level scale

`requiredLevel` and `currentLevel` move from free text to a shared scale. Legacy free text is kept as a note.

| Step | UI label | Meaning |
|---|---|---|
| 1 | `없음` | No capability held |
| 2 | `기초` | Can do it with outside help |
| 3 | `실무` | Can do it alone at normal quality |
| 4 | `숙련` | Steady quality at scale |
| 5 | `선도` | Industry-leading, a source of advantage |

Gap = required - current (0 to 4). Values that are not on the scale read as `미판정`.

### 2.2 S8 panel `필요 역량 달성 가능성`

This is a new section in the S8 `overview` area. It also appears as a summary strip beside the results in `scenarios` and `financial-analysis`. Each row is one S3 register row:

| Column | Source |
|---|---|
| `필요 역량` | S3 `capability` |
| `필요 수준` / `보유 수준` | 5-step scale (inherited from S5 for GF, from target evaluation for BF) |
| `해소 방식` | `resolution` (build/partner/hire/invest) |
| `해소 비용` (KRW M) | human input; AI may draft |
| `달성 기간` (months) | human input; AI may draft |
| `달성 가능성` | `높음` / `중간` / `낮음` / `미판정` |
| `근거` / `증빙` | rationale text and evidence refs |
| `판정자` / `판정일` | set on human confirmation only |

Header: a summary count chip row (`충족` / `부분` / `미충족` / `미판정`, reusing `summarizeGap` at `lib/capability-gap.ts:117`). A warning banner shows when any row is `낮음`, any row is `미판정`, or any `unmet` row has no cost or time: `필요 역량 달성 가능성이 확인되지 않은 항목이 있습니다 — 사업성 수치는 역량 확보를 전제로 합니다`.

### 2.3 Feed into the business model (opt-in, never silent)

- **Closing cost becomes investment line items.** Cost is shown as separate `역량 확보 투자` items next to the year-0 investment (`initialInvestmentOf`, `lib/business-case-generator.ts:361`). It is added to the base case only when a human ticks `기본 시나리오에 반영`. It is never added automatically.
- **Time to attain becomes a ramp-up delay.** The longest confirmed `달성 기간` on a critical row (gap ≥ 2) shifts the `rampUp` curve (`:364`, `:574`) by whole years, but only in the adjusted scenario.
- **`역량 조정 시나리오` (capability-adjusted scenario).** This is a fourth selectable variant, kept beside `base/upside/downside` and never replacing them. Its explicit haircuts are listed in the panel: closing cost added, ramp shifted, and for `낮음` rows a human-entered capture-rate haircut (no default). Every number carries its source row. Stored base/upside/downside results are untouched.

### 2.4 Green Field vs Brown Field

**Green Field.** Required/current level and resolution are inherited from the S5 entries on the S3 register (`GreenfieldStage.tsx:252-259`). Route-specific cost/time prompts:

| Route | Cost drivers | Time driver |
|---|---|---|
| build | R&D, equipment, training | development + validation months |
| partner | licence/royalty, JV contribution | partner search + contract months |
| hire | headcount × loaded pay + search fee | hiring + onboarding months |
| invest | stake/asset price | deal + integration months |

**Brown Field.** Current level is the **target's** coverage, taken from the S6/S7 evaluation rubric. Capability rows already become rubric criteria (`lib/brownfield-eval-criteria.ts:106-111`). Each target gets its own attainability judgement, keyed by `targetId` per ADR-0143. The `대상 비교·선정` table (`TargetComparisonRow`, `BusinessCaseStage.tsx:86`) gets a column `역량 달성 가능성` (worst row grade plus a count of gaps covered). Closing assumptions become PMI items (integration cost, key-talent retention, certification transfer). The panel shows, read-only, the acquisition price (`acquisition.evRevenue`, generator `:24-30`) and the synergy assumptions that depend on each capability, so reviewers can see where a premium relies on an unattained capability.

### 2.5 Data model

Options:

- **A. Reuse the S3 register JSON and add S8 fields (recommended for GF).** Add an optional `attainability` object to each row: `{ requiredStep, currentStep, closingCostKrwM, monthsToAttain, grade, rationale, evidence[], draftedBy: "ai"|"human", confirmedBy, confirmedAt }`. `normalizeGapRows` (`lib/capability-gap.ts:66-90`) rebuilds rows field by field, so it has to round-trip the new object. Otherwise the existing S3 and S5 saves would drop it. This needs no migration because the column is TEXT JSON.
- **B. Per-target judgements for BF.** Store these as `assumption` rows under keys `bc.capability.<rowId>.*` scoped to project and target, in the same way as `bc.*` params (`resolveBusinessCaseParams`, generator `:609-630`). This needs no migration and gives run provenance.
- **C. New table `capability_attainability`.** Cleaner querying, but it needs a migration and an ADR under the DB-schema rule. Not recommended for phase 1.

**Recommendation:** A for the opportunity-level judgement, plus B for BF per-target overrides. No migration. This still changes a JSON contract, so it is recorded in the ADR.

### 2.6 API / MCP surface

- `GET/PUT /api/projects/[id]/capability-attainability`: read the merged view, save drafts. Every save writes `appendAudit` under the calling user (boundary #1).
- `POST .../capability-attainability/confirm`: human-only. It sets `confirmedBy`/`confirmedAt` and rejects AI/MCP callers.
- `POST .../capability-attainability/llm-draft`: proposal only. It fills `draftedBy: "ai"` fields and cannot confirm. It mirrors `app/api/opportunities/[id]/capability-gap/llm-draft/route.ts`.
- MCP: a new `draft_capability_attainability` tool, proposal only, alongside the existing `draft_capability_gap`. There is no confirm tool. `get_business_case` returns the summary counts and banner state.
- The AI draft must list what it could not verify (review model: no PASS stamp).

### 2.7 Grade cap

- **Phase 1:** warning only. The banner and counts sit beside the S8 results and in the gate brief, and RAG is unchanged.
- **Phase 2 (optional, separate ADR):** cap the overall grade at Amber when any critical row is `낮음` or still `미판정` at the S8 gate. This mirrors the data-confidence cap (`db/lib/rag-service.ts:16-18`).

### 2.8 Backward compatibility

Existing projects have no `attainability`, so every row reads `미판정` and the banner shows. Stored case numbers, runs and grades stay as they are. Legacy free-text levels stay visible as notes until someone picks a step. No backfill.

## 3. Tests

- `capability-gap` unit: `normalizeGapRows` round-trips `attainability`; invalid steps go to `미판정`; S3/S5 saves keep S8 fields.
- Pure helper `attainabilitySummary(rows)`: counts, banner triggers, critical-row rule.
- Generator: the adjusted scenario adds cost items and shifts ramp deterministically (seeded). Base/upside/downside outputs are byte-identical with and without attainability data.
- API: confirm rejects MCP/AI actor; draft never sets `confirmedAt`; audit row written.
- BF: per-target assumption override wins over the opportunity-level value; the comparison column renders the worst grade.
- UI: banner shown for a legacy project; design:lint and a11y pass (status chips not color-only).

## 4. Wiki / manual impact

- `docs/wiki/ko/41-그린필드-S8-사업성-분석.md`: panel, route cost/time mapping, adjusted scenario.
- `docs/wiki/ko/52-브라운필드-S8-사업성-분석.md`: per-target column, PMI closing items, price/synergy link.
- `docs/wiki/ko/30-공통-S8-사업성-분석.md`: 5-step scale, human confirmation, `미판정` banner.
- Glossary: `달성 가능성`, `역량 조정 시나리오`, the five step labels.

## 5. ADR

- **ADR-0168** (next free after 0167): S8 capability attainability review. Covers the 5-step scale, the register JSON extension, human-only confirmation, the opt-in adjusted scenario, and warning-only grading.
- **ADR-0169** (phase 2, optional): capability attainability caps the overall RAG grade.

## 6. Effort and slices

| Slice | Content | Est. |
|---|---|---|
| 1 | Scale + `attainability` type + `normalizeGapRows` round-trip + S5 level pickers + ADR-0168 | 1 d |
| 2 | S8 panel, summary counts, banner (GF), GET/PUT/confirm API + audit | 2 d |
| 3 | AI draft route + MCP tool (proposal only) | 1 d |
| 4 | `역량 조정 시나리오` in generator + scenario UI | 2 d |
| 5 | BF per-target assumptions, comparison column, PMI/price/synergy link | 2 d |
| 6 | Wiki 30/41/52, glossary, gate-brief line | 1 d |

Total about 9 working days. Slices 1–2 deliver the requested review on their own.

## 7. Risks

- `normalizeGapRows` silently drops unknown fields, so S8 data could be lost on an S3 save if slice 1 is skipped. Mitigation: slice 1 goes first, with a round-trip test.
- Reviewers may read the adjusted scenario as the decision case. Mitigation: label it clearly and keep it off by default.
- BF evaluation rubric scores may not map cleanly to the 5 steps. Mitigation: a human picks the step and the rubric score is shown only as evidence.
- `lib/project-charter.ts:56` still reads the legacy column. That is out of scope here, but it should be noted.

## 8. Open decisions (recommended answers)

1. Who judges attainability? **Humans confirm. AI drafts and gathers evidence only.**
2. Level scale? **A shared 5-step scale for both required and current level.**
3. Model effect? **The capability-adjusted scenario is optional, with no automatic haircut.**
4. Grade cap? **Deferred. Phase 1 is warning only; phase 2 needs a separate ADR.**
5. Storage? **Reuse the existing S3 register, add S8 judgement fields, and use the `bc.capability.*` assumptions for BF per target. No migration.**
