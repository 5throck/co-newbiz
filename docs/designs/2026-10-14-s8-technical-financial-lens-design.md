---
lang: ko
lang_reason: source-material
doc_type: design
stage: S8
status: draft
date: 2026-10-14
owner: platform-lead
---

# S8 business case in two lenses: technical feasibility and financial feasibility

Korean appears only as UI labels in backticks. All prose is English.

## 0. Decision input and baseline

Human decider, chat 2026-10-14, approved these recommended answers:

- Two primary lenses with tab names `기술적 타당성` and `재무적 타당성`.
- Technical lens items: required-capability attainability (ADR-0168 panel), technology readiness level (TRL) with roadmap and risk, key people / equipment / facilities, IP and license dependence, permit / certification attainability, link to the S9 technical DD.
- A person judges each item. AI drafts evidence only.
- A summary strip at the top shows both lenses side by side as `충족` / `주의` / `미판정`.
- No cap on the overall grade for now. Warning only.

Addendum (same chat, 2026-10-14): for Brown Field, the S8 technical review and the S9 technical verification are carried out **together (paired)**. See §15. It replaces T6 for Brown Field.

**Summary.**
- S8 gets two lens tabs with a status strip shared by both. Technical items T1-T6 are judged by people and drafted by AI.
- Storage is a JSON key. There is no migration and no grade cap.
- In Brown Field, every S8 item T1-T5 judged for a target gets a paired S9 verification row: `검증됨` / `S8과 다름` / `확인 못함`. The S9 row references the S8 entry by id.
- The link works both ways:
  - S8 shows the S9 status next to each item.
  - S9 shows the S8 judgement as its starting hypothesis.
  - A mismatch raises a warning in S8, in the target comparison table, and in the IC materials. It never changes numbers.
- Before the dd gate, verification is mandatory only for T2 (TRL) and T5 (permits/certifications) of the selected target. Other items only warn.
- Certification transferability links to the existing ma-12/bf-03 validators and is not duplicated.

**Baseline.** ADR-0167/0168 and the capability code are now on `main` (PR #535, `f080938a`). Lines marked `@1ce06d26` below were re-checked on `main` and are unchanged: `lib/capability-gap.ts:31`, `:34`, `:50`; `capability-gap/route.ts:77`, `:80`. Other line numbers were taken at `ee87c216` and still hold for the files PR #535 did not touch.

## 1. Current state (facts)

### 1.1 S8 tabs

- Tab keys: `goals, scenarios, targets, wacc, financial-analysis, overview, params, target-costing, decision` (`app/web-next/lib/business-goals-view.ts:29`). Primary order: `goals, scenarios, targets, wacc, financial-analysis` (`:33`). Green Field drops `targets` (`:40-41`). Unknown `?tab=` falls back to `scenarios` (`:46-48`). Green Field `?tab=targets` redirects to `scenarios` (`:53-54`).
- Stage tab row (project pages): S8 primary tabs at `app/web-next/lib/stage-tabs.ts:31-35`. `사업 목표` is marked `INTERIM-WORDING (ADR-0159)` (`:31`). The more-menu holds `요약`, `설명·생성·권고`, `파라미터·스냅샷`, `타겟코스팅`, `결정`, `리스크 히트맵` (`:37-44`). The limit is `MAX_PRIMARY_TABS = 5` (`:25`). Green Field filters out the `targets` tab (`:127`).
- `WACC` and `재무분석` are separate routes (`/wacc`, `/financial-analysis`, `stage-tabs.ts:34-35`). An old `?tab=wacc` / `?tab=financial-analysis` link is redirected to them (`components/stages/BusinessCaseStage.tsx:193-194`).
- Tab state is synced to `?tab=` on the standalone page and kept in local state when embedded (`BusinessCaseStage.tsx:179-188`). The embedded deal view renders its own `TabNav` (`:550-567`). The project page relies on the stage tab row (`:542-549`).
- Green Field detection is `targets.length === 0` (`BusinessCaseStage.tsx:276`). The target comparison row type is `TargetComparisonRow` (`:86-100`). The tab is at `:584` and the target loop at `:654`.
- @1ce06d26: the ADR-0168 panel is mounted in `overview` (full) and in `scenarios` (compact, opens `overview`) (`BusinessCaseStage.tsx` diff hunks at `:779-782` and `:876-879`).

### 1.2 Capability attainability (ADR-0168, @1ce06d26)

- Shared 5-step scale `없음 / 기초 / 실무 / 숙련 / 선도` (`lib/capability-gap.ts:50-57` @1ce06d26). Attainability grade `high | medium | low`, plus `null` shown as `미판정` (`:31`, `:78-79`).
- Per-row `attainability` object `{ closingCostKrwM, monthsToAttain, grade, rationale, evidence[], draftedBy, confirmedBy, confirmedAt }` (`:34-46`) on the S3 register `opportunity.capability_gap_json` (`db/migrations/0098_opportunity_capability_gap.sql:10`).
- The register PUT writes **only** `{ rows, updatedAt }` (`app/api/opportunities/[id]/capability-gap/route.ts:80` @1ce06d26). It carries over `attainability` per row (`:77`).
- `attainabilitySummary` (`lib/capability-attainability.ts:44-75` @1ce06d26) and human-only confirm (`:252-273`).

### 1.3 Grading and gate

- RAG already has six dimensions, including `financial` and `technical_execution` (`packages/core-scoring/src/rag-engine.ts:17-33`; UI order `app/web-next/lib/labels.ts:137`). `regulatory_permit` is a separate dimension (`rag-engine.ts:22`). On recompute, `technical_execution` is carried from the prior assessment (`db/lib/rag-service.ts:149-150`).
- Technical inputs for the RAG snapshot come from S9 `dd_finding`: `tech.trl_grade` is the minimum TRL across findings (`db/lib/snapshot-filler.ts:363-379`), and `tech.ip_ownership_status` is the worst IP status (`:381-390`). `dd_finding.trl_grade` is constrained to `TRL1..TRL9` and `ip_ownership_status` to five values (`db/migrations/0019_*.sql:91-92`).
- The FS gate criteria are a quantified business case, goal attainment, and (Brown Field) target comparison plus a human target selection (`process/flow.spec.yaml:149-157`). No technical criterion exists.
- The S8 completion predicate checks only models, simulations, and the Brown Field per-target and selection record (`app/web-next/lib/process-flow.ts:420-445`). The `fs` gate requires S8 (`:1017`). The S8 required artifacts include no technical item (`:47`).
- The FS gate brief includes the S4 track decision and the S8 adopted business case (`app/web-next/lib/gate-brief.ts:40`).

### 1.4 Existing technical content

- S9 technical DD checklist: site visit, evidence, production-process TRL (`tdd-03`), bottleneck, remaining equipment life, EHS, CAPEX verification, certification status (`checklists/technical-dd-checklist.yaml:12-43`).
- R&BD checklist: core-technology TRL, distinct from process TRL (`checklists/rbd-technology-checklist.yaml:32-33`). TRL/MRL evidence matrix (`:11-15`).
- Brown Field DD covers site visit, equipment life, TRL, and EHS (`procedures/_shared/brownfield-dd/schema.yaml:29`, `:41`).
- Permits and certifications are separate project-scoped tables `permit` and `certification`, each with a `status` column (`db/migrations/0011_dd_finding_and_remaining_tables.sql:275-299`).
- Agents: `agents/ip-agent.md`, `agents/technical-dd-agent.md`. Skill `skills/technical-due-diligence` exists. **No `technical-feasibility` skill exists** (`ls skills`). Feasibility skills are `greenfield-feasibility`, `brownfield-feasibility`, and `investment-feasibility-modeling`.
- Assumptions: `assumption(run_id, assumption_key, kind, value REAL NOT NULL, rationale, anchor_ref, ...)` (`db/migrations/0003_fact_and_assumptions.sql:40-53`). They are read per project through `run.project_id` (`app/web-next/lib/business-case-generator.ts:609-619`). There is no `target_id` column and no text value.

## 2. Information architecture

### 2.1 Primary tabs

The S8 stage row gets two lens tabs in front of the existing ones. The stage-row limit (`MAX_PRIMARY_TABS = 5`, `stage-tabs.ts:25`) is respected by turning the current five tabs into **sub-tabs** inside the financial lens, not by adding siblings.

| Stage-row tab (`stage-tabs.ts` S8 group) | Key | Content |
|---|---|---|
| `기술적 타당성` | `?tab=technical` | Summary strip + technical items (§3), sub-tabs below |
| `재무적 타당성` | `?tab=financial` (umbrella) | Summary strip + sub-tab row: `사업 목표`, `시나리오 비교`, `대상 비교·선정` (BF), `WACC`, `재무분석` |
| `대상 비교·선정` (BF only) | `?tab=targets` | Kept as a primary tab for BF, because selection is an FS-gate artifact. It shows both lens columns (§2.4). |
| `결정` | `?tab=decision` | Moved from the more-menu to primary. The gate is the end point of both lenses. |

The more-menu keeps `요약`, `설명·생성·권고`, `파라미터·스냅샷`, `타겟코스팅`, `리스크 히트맵`.

Technical sub-tabs (one page, anchored sections, no extra routes): `역량 달성 가능성`, `기술 성숙도(TRL)`, `핵심 인력·설비·시설`, `지식재산·라이선스`, `인허가·인증`, `S9 기술 실사 연결`.

`WACC` and `재무분석` stay as their own routes (`/wacc`, `/financial-analysis`). The financial sub-tab row renders the same `StageTabs` sub-row on those pages, so the lens stays visible after navigation. This needs a `lens` field on `StageTabDef` (a new optional `group: "technical" | "financial"`).

### 2.2 Summary strip

The `S8LensStrip` component renders above every S8 page (business-case, wacc, financial-analysis), below `StageTabs`. It has two cards side by side:

- `기술적 타당성`: status chip + counts (`판정 n/6`, `주의 n`) + the worst item name.
- `재무적 타당성`: status chip + base-scenario NPV p50 / IRR vs hurdle + goal attainment summary (`summarizeAttainment`, `business-goals-view.ts:113`).

Status values are `충족` / `주의` / `미판정`. Each chip has an icon and text, never color alone (Onyx 3.0).

Lens status rules (deterministic, in `lib/s8-lens-status.ts`):

- **Technical:** `미판정` if any of the six items has no human-confirmed judgement. Otherwise `주의` if any confirmed item is `주의` (or an attainability row is `low`). Otherwise `충족`.
- **Financial:** `미판정` if there is no adopted base case or no simulation. Otherwise `주의` if base IRR < hurdle, any goal is `missed`, or the downside NPV p50 < 0. Otherwise `충족`. The status reuses existing values only (FS kill criterion "hurdle miss on base", `flow.spec.yaml:155`). It is a view, not a grade.

The strip carries the caption `판단 보조 — 최종 판단과 게이트 승인은 사람이 합니다`. A technical `주의` shows the warning `기술적 타당성 주의 — 재무 수치는 필요 역량·기술 확보를 전제로 합니다`. Per the decision, it does **not** cap any grade.

### 2.3 Deep-link compatibility

`resolveS8Tab` (`business-goals-view.ts:46`) is extended. Old keys keep working and imply the lens:

| Incoming `?tab=` | Lands on |
|---|---|
| none / unknown | `financial` → sub-tab `scenarios` (unchanged default, `:47`) |
| `goals`, `scenarios` | financial lens, that sub-tab |
| `targets` | BF: targets tab. GF: financial lens → `scenarios` (existing redirect `:53-54`) |
| `wacc`, `financial-analysis` | existing route redirects (`BusinessCaseStage.tsx:193-194`) |
| `overview`, `params`, `target-costing`, `decision` | unchanged |
| `technical`, `technical#<item>` | technical lens, anchored item |
| `capability` (new alias) | technical lens → `역량 달성 가능성` |

`S8_TAB_KEYS` gains `technical` and `financial`. `S8_PRIMARY_TAB_ORDER` becomes `technical, financial, targets, decision`. The financial sub-order is a new constant `S8_FINANCIAL_SUBTABS = goals, scenarios, targets, wacc, financial-analysis`. In the BF case, `targets` appears both as a primary tab and as a financial sub-tab. Both have one key, so they share one panel.

The embedded `TabNav` (`BusinessCaseStage.tsx:551-567`) gets the same two lens entries first.

The ADR-0168 panel moves from `overview` and the compact `scenarios` mount to `technical`. `scenarios` keeps a compact one-line link (`역량 달성 가능성: 미판정 n — 기술적 타당성에서 보기`).

### 2.4 Green Field vs Brown Field

- **Green Field:** one technical lens for the project itself (current level = our company).
- **Brown Field:** a per-target technical lens, keyed by `brownfield_target.id` (shortlisted targets per `process-flow.ts:441-444`). The technical tab has a target selector that reuses the scenarios target filter pattern (`BusinessCaseStage.tsx:426-431`), defaulting to the selected target. The `대상 비교·선정` table (`TargetComparisonRow`, `:86`) gets two columns: `기술적 타당성` (status chip + `판정 n/6`) and `재무적 타당성` (derived from the row's existing p50/IRR). The selection record still needs a human rationale. A technical `주의` on the selected target shows an inline warning, not a block.

## 3. Technical items

All six items share one envelope:

```
{ status: "met" | "caution" | null,   // UI: 충족 / 주의 / 미판정
  rationale: string,                  // mandatory when status set
  evidence: string[],                 // refs: URL, doc id, dd_finding id, file name
  draftedBy: "human" | "ai" | null,
  confirmedBy: string | null, confirmedAt: string | null,
  ...item-specific fields }
```

The rules follow ADR-0168 D1. AI may save fields and `draftedBy: "ai"` only. `status` may be proposed by AI but shows as `AI 초안` until a person confirms. Confirm is human-only (403 `human_only` for bearer / OAuth-MCP / agent callers, route added to `HUMAN_ONLY_ROUTES`). Any content change clears the confirmation. The review surface shows `검증됨` / `확인 못함` / `판단 필요`, never a PASS stamp.

| # | Item (UI label) | Item fields | Scale | Evidence minimum for `충족` |
|---|---|---|---|---|
| T1 | `역량 달성 가능성` | Reuses ADR-0168 rows (no new fields) | 5-step level + grade `높음/중간/낮음` | Derived. `충족` if all rows are judged and none is `low`. `주의` if any row is `low`. `미판정` otherwise. No separate confirm, rows are confirmed individually. |
| T2 | `기술 성숙도(TRL)` | `trlCurrent` 1-9, `trlRequiredAtSop` 1-9, `basis: "core_technology" \| "production_process"` (mirrors `rbd-01` vs `tdd-03`), `roadmap[]` {milestone, targetTrl, month}, `keyRisks[]` | TRL select 1-9 | ≥1 evidence ref. `주의` suggested when `trlCurrent < trlRequiredAtSop` and the roadmap is empty. |
| T3 | `핵심 인력·설비·시설` | `resources[]` {kind: `people` / `equipment` / `facility`, name, required level (5-step), secured: `secured` / `planned` / `unsecured`, leadMonths, costKrwM} | 5-step + secured state | Every `unsecured` row has a plan or a `주의`. |
| T4 | `지식재산·라이선스` | `dependencies[]` {asset, ownership: same five values as `dd_finding.ip_ownership_status` (`0019:92`), licensor, exclusivity, term/expiry, royaltyNote, ftoChecked: bool} | Ownership enum | `licensed_in`, `jointly_owned`, or `disputed` requires a rationale. `disputed` suggests `주의`. |
| T5 | `인허가·인증 확보 가능성` | Read-only roll-up of the `permit` and `certification` rows for the project (`0011:275-299`), split into two lists (boundary #5), plus `criticalPathMonths` and a free note | Read-only counts by status | ≥1 permit or certification row, or an explicit `해당 없음` rationale |
| T6 | `S9 기술 실사 연결` (Green Field; Brown Field uses §15 pairing instead) | `handoff[]` {question, checklistItem: `tdd-xx` / `rbd-xx`}. Read-only: S9 `tech.trl_grade` / `tech.ip_ownership_status` when present (`snapshot-filler.ts:363-390`) | — | ≥1 handoff question per `주의` item in T2-T5 |

TRL select labels (plain Korean, shown with the number):

| TRL | Label |
|---|---|
| 1 | `1 — 기본 원리 확인` |
| 2 | `2 — 기술 개념 정립` |
| 3 | `3 — 실험으로 개념 확인` |
| 4 | `4 — 실험실 환경 부품 검증` |
| 5 | `5 — 유사 환경 부품 검증` |
| 6 | `6 — 유사 환경 시제품 시연` |
| 7 | `7 — 실제 환경 시제품 시연` |
| 8 | `8 — 완성품 시험·인증 완료` |
| 9 | `9 — 실제 운용으로 검증` |

The stored value is an integer 1-9. The S9 `dd_finding` keeps its own `TRLn` text (`0019:91`). The UI compares them as numbers.

**AI drafting.** AI drafting reuses existing agents through the PM gateway, not a new skill: `technical-dd-agent` drafts T2/T3, `ip-agent` drafts T4, and `certification-agent` / `legal-counsel` drafts T5 notes. Each draft cites sources. Missing evidence is listed under `확인 못함`.

## 4. Relationship to S9 technical DD (non-duplication)

- S8 answers a first-pass, plan-level question: **is the plan technically feasible?** It uses declared and desk evidence. S9 answers whether the plan is **verified**, using a site visit, measurements, and the checklist (`technical-dd-checklist.yaml:12-43`).
- S8 never writes `dd_finding` and never resolves a checklist item. S9 never edits S8 lens rows.
- T6 is the only bridge. S8 `주의` items become proposed S9 questions. The S9 workspace shows them read-only as `S8에서 넘어온 확인 질문` with a link back to the S8 item. When S9 records a TRL or IP status, S8 T2/T4 shows it next to the S8 value as `S9 실사 값`. A larger gap (S9 TRL below S8 `trlCurrent`) is flagged `S8 판단과 실사 결과가 다릅니다`. S8 rows are not changed.
- RAG `technical_execution` keeps its S9 inputs (`snapshot-filler.ts:351-390`). The S8 lens does **not** feed RAG in this phase.

## 5. Gate and completion (informational only)

- The FS gate brief (`gate-brief.ts:40`) gains one line: `기술적 타당성: 충족/주의/미판정 (판정 n/6, 주의 항목 …)`. The gate decision panel shows the strip. Nothing blocks.
- The S8 completion predicate (`process-flow.ts:420`) is **unchanged**. A `missing` hint is not added either, because a hint would read like a requirement. Once the decider wants it, a separate ADR can make `기술적 타당성 판정` an FS criterion.
- `flow.spec.yaml` is unchanged in this phase. `S8 requiredArtifacts` (`process-flow.ts:47`) is unchanged.

## 6. Data model

**No migration.** Storage reuses the S3 register JSON, `opportunity.capability_gap_json` (`0098:10`), which already holds T1. A new optional top-level key is added:

```
{ rows: [...],                     // unchanged, T1
  updatedAt: "...",
  technicalLens: {
    version: 1,
    subjects: {
      "project": { trl: {...}, resources: {...}, ip: {...}, permits: {...}, s9Link: {...} },   // GF
      "target:<brownfield_target.id>": { ... }                                                // BF, per target
    },
    updatedAt: "..."
  } }
```

T1 for BF per target stays as planned by ADR-0168 slice 5 (`bc.capability.*` assumptions). This design does not change that.

Why this JSON and not `assumption`: `assumption.value` is `REAL NOT NULL` with no target column (`0003:40-53`), so the item lists, text, and confirmation fields do not fit. Why not `md_project.charter_json`: it holds charter versions (`lib/project-charter.ts:105-110`).

**Mandatory writer change.** The register PUT rewrites the column as `{ rows, updatedAt }` (`capability-gap/route.ts:80` @1ce06d26) and would drop `technicalLens` on any S3/S5 save. It must carry over `technicalLens` verbatim, using the same pattern as `carryOverAttainability` (`:77`). A round-trip test is required. This is slice 1.

If the decider prefers a clean column instead, the fallback is `ALTER TABLE opportunity ADD COLUMN technical_lens_json TEXT` (migration 0143). This needs the DB-schema ADR trigger.

## 7. API / MCP

- `GET /api/projects/:id/technical-lens?subject=project|target:<id>` returns items, derived T1 summary, read-only T5 roll-up, S9 values, and lens status.
- `PUT /api/projects/:id/technical-lens` applies a per-item patch with the same role rules as ADR-0168 (analyst+ member, viewer 403, outsider/admin 404). Validation: TRL 1-9, enums, rationale required when status is set, cost/months ≥ 0. Writes an `audit_log` entry `technical_lens.save`.
- `POST /api/projects/:id/technical-lens/confirm` is human-only and writes `technical_lens.confirm`.
- `GET /api/projects/:id/s8-lens-summary` returns both lens statuses for the strip, gate brief, and target comparison.
- MCP: a read tool `get_s8_lens_summary` (parity with REST) and a draft tool `draft_technical_lens` (saves with `draftedBy: "ai"` only). No confirm tool, by design. Update `scripts/co-newbiz/mcp-coverage.exclusions.yaml` for the confirm route.
- OpenAPI, `docs/architecture/api-spec.md`, and `ui-spec.md` are updated.

## 8. Tests

- Unit `s8-lens-status.test.ts`: status matrix for both lenses (all `미판정`, mixed, `주의` precedence, T1 derived from ADR-0168 rows, financial thresholds).
- Unit `technical-lens.test.ts`: patch validation, AI cannot confirm, a content change clears the confirmation, BF subject isolation, unknown subject 400.
- Unit regression: S3/S5 register save preserves `technicalLens` (and `attainability`).
- Unit `business-goals-view`: deep-link table in §2.3, including GF `targets` and the `capability` alias.
- Route tests: role matrix, `human_only` 403 for bearer/MCP.
- MCP parity test and stage-tools count update.
- Scenario: greenfield and brownfield S8 flows still complete with the lens empty (non-blocking proof).
- Gate brief snapshot includes the technical line.
- E2E: tab navigation, strip render, a11y (chips carry text).

## 9. Wiki impact

- `docs/wiki/ko/30-공통-S8-사업성-분석.md`: new section on the two lenses, the strip, `충족/주의/미판정`, human confirmation, and the old-link note. `verified_on` is bumped.
- `41-그린필드-S8-사업성-분석.md`: the six technical items for our company, the TRL table, and T6 handoff to S9.
- `52-브라운필드-S8-사업성-분석.md`: per-target lens, the two new columns in `대상 비교·선정`, and warning-only behavior on selection.
- Glossary (other agents own the files, so this is only flagged): `기술적 타당성`, `재무적 타당성`, `기술 성숙도(TRL)`, `확인 질문(S9 연결)`.

## 10. ADR

**ADR-0169**: S8 two-lens view, technical lens items, JSON storage, human-only confirm, warning-only. `docs/adr/` on `main` ends at 0166. 0167 and 0168 are taken on the unmerged PR branch. No ref in the repo holds 0169 (checked all local and remote refs). Triggers: MCP tool scope (new tools), the register JSON contract, and gate-brief content. If the decider later chooses the column fallback, the same ADR covers the DB schema. A grade cap or FS-criterion change needs a separate later ADR.

## 11. Slices

| Slice | Content | Effort |
|---|---|---|
| 0 | Merge the ADR-0168 PR (prerequisite) | — |
| 1 | Register writer preserves `technicalLens` + round-trip test, `lib/technical-lens.ts` parser/validator, ADR-0169 | 1 d |
| 2 | IA: lens tabs, financial sub-tab row, `resolveS8Tab` aliases, embedded `TabNav`, move the ADR-0168 panel | 1.5 d |
| 3 | `S8LensStrip` + `lib/s8-lens-status.ts` + summary route (all S8 pages) | 1 d |
| 4 | Technical items T2-T6 UI + GET/PUT/confirm routes + audit | 2.5 d |
| 5 | BF per-target subjects + two columns in `대상 비교·선정` + selection warning | 1.5 d |
| 6 | Gate brief line, S9 read-only handoff list, MCP read/draft tools, OpenAPI | 1.5 d |
| 7 | Wiki 30/41/52, glossary hand-off, E2E | 1 d |

The total is about 10 working days. Slices 1-3 already give the decider the two-lens view (with T1 as the only technical item populated).

## 12. Risks

- **Silent data loss** if any other writer rewrites `capability_gap_json` without the new key. Mitigation: slice 1 first, plus a grep test over `capability_gap_json` writers.
- **Primary tab overload**: moving the five financial tabs to a sub-row adds one click. Mitigation: deep links keep working and the strip links straight to sub-tabs.
- **Strip read as a grade**: wording keeps it a view. There is no RAG coupling and no PASS. The caption states that a person decides.
- **Financial `주의` thresholds duplicate gate logic**: they reuse the existing kill criterion and goal attainment only. The thresholds sit in one constant.
- **Opportunity-scoped storage for project data**: S8 is project-carried (ADR-0095), but the register lives on the source opportunity. This is the same choice as ADR-0168. Projects without `source_opportunity_id` return 409 `no_source_opportunity` (BF already requires it, `process-flow.ts:435-439`).
- **S8 vs S9 TRL basis confusion** (core technology vs production process). Mitigation: the `basis` field is mandatory and shown next to S9 values.

## 13. Open decisions (resolved as recommended, ADR-0169 accepted 2026-10-14)

1. Primary tabs: lens tabs plus `대상 비교·선정` (BF) plus `결정`, with the current five tabs as financial sub-tabs? **Yes.**
2. Storage: `technicalLens` key in the S3 register JSON (no migration) or a new column? **JSON key, no migration.** The column is the fallback.
3. Is the T1 status derived (no separate confirm)? **Yes, derived from the confirmed ADR-0168 rows.**
4. Does the financial lens status use base IRR vs hurdle, missed goals, and downside NPV p50 < 0? **Yes, view only.**
5. Does a technical `주의` on the selected BF target block selection? **No, inline warning only.**
6. S8 completion / FS criterion? **Unchanged now. Revisit with a separate ADR after pilot use.**
7. Does `결정` become a primary tab? **Yes.** It is the shared end point of both lenses.
8. Who drafts with AI? **Existing agents (technical-dd, ip, certification) through PM. No new skill.**

## 15. Brown Field: paired S8 technical lens and S9 technical verification

### 15.1 Existing S9 Brown Field DD structure (facts)

- S9 has standard checklist tabs plus an industry-tailored proposal panel (`components/stages/DdStage.tsx:37`). It also has a target comparison evidence section (`:432-438`), a section for targets with no DD opened (`:471`), plan readiness (`:506-512`), the per-domain checklist table (`:579-580`), and the `dd_finding` list (`:740`).
- Tailoring maps the `technical` domain to `technical-dd` and `technical-dd-agent` (`lib/dd-checklist-tailor.ts:8`, `:90`). Rows are target-aware (ADR-0157, `:120`, `:301`, `:334`), and the selected target comes from `dd-target.ts` (`:64`).
- Checklist judgements are stored in `project_checklist_item_state(project_id, checklist_id, item_id, status pending|pass|fail|na|waived, note, evidence_ref, waiver_id, assessed_by, assessed_at, target_id)` (`db/migrations/0132_dd_target_axis.sql:22-34`). `dd_finding.target_id` and `project_checklist_item_custom.target_id` are added at `:57-58`.
- The S9 completion predicate counts only the selected/legacy scope (`target_id IS NULL`) and requires zero open mandatory items (`lib/process-flow.ts:538-544`).
- The technical checklist covers site visit, evidence, process TRL (`tdd-03`), bottleneck, remaining equipment life, EHS, CAPEX verification, and certification status (`checklists/technical-dd-checklist.yaml:12-43`).
- The Brown Field validators are:
  - `bf-01`: all six M&A validators recorded (`checklists/brownfield-feasibility-checklist.yaml:12-13`).
  - `bf-03`: certification transferability on change of control (`:20-21`).
  - `ma-12`: transferability checked last, against the certifying body's rules (`checklists/ma-special-topics-checklist.yaml:61-62`).

### 15.2 Pairing model

Every S8 Brown Field item T1-T5 that has an S8 judgement for target X gets exactly one counterpart **verification row**. Rows exist for the selected target and, optionally, for opened comparison targets (ADR-0157 axis).

| S8 item | Verified in S9 by | Existing checklist anchor (linked, not duplicated) |
|---|---|---|
| T1 capability attainability (per row) | Interviews, org chart, key-talent check | `ma-*` HR validators via hr-integration-agent (informative) |
| T2 TRL | Site visit and evidence | `tdd-01`, `tdd-02`, `tdd-03` (process TRL); `dd_finding.trl_grade` |
| T3 people / equipment / facilities | Site visit, remaining equipment life, CAPEX verification, EHS | `tdd-05`, `tdd-06`, `tdd-07` |
| T4 IP / licenses | ip-agent + legal DD | `dd_finding.ip_ownership_status` (`0019:92`) |
| T5 permits / certifications | Permit status check + transferability | `tdd-08`. Transferability = **`ma-12` / `bf-03` judgement, read through, not re-recorded** |

Verification row fields:

```
{ s8Ref: "<subject>/<itemId>[/<rowId>]",   // S8 lens entry id, never a copy of its content
  s8RevisionAt: "<S8 confirmedAt seen>",    // detects S8 changes after verification
  result: "verified" | "different" | "unverifiable" | null,   // UI: 검증됨 / S8과 다름 / 확인 못함 / 미검증
  observed: string,                         // what S9 found, mandatory for different
  evidence: string[],                       // dd_finding ids, photo/log refs
  checklistRefs: string[],                  // e.g. "chk-technical-dd:tdd-03"
  verifiedBy, verifiedAt, draftedBy }
```

Rules:

- A person records the result. technical-dd-agent may draft it (`draftedBy: "ai"`), and the draft shows as `AI 초안`. Confirming is human-only, like ADR-0168 D1.
- `different` and `unverifiable` require `observed` and a rationale. Silence is not verification.
- If S8 is re-confirmed after verification (`s8RevisionAt` older than S8 `confirmedAt`), the row reads `재검증 필요`.

### 15.3 Where the rows live

**UI.** A new section `S8 판단 검증 (기술)` sits at the top of the S9 technical domain tab, above the checklist table (`DdStage.tsx:579`). For each item it shows the S8 judgement, rationale, and evidence (read-only, as the starting hypothesis `S8 가설`), the S9 result control, and links to the anchored checklist rows and `dd_finding`s. A target selector follows the existing S9 target axis.

**Storage.** Recommended: no migration. Use a sibling key in the same register JSON, `technicalLens.subjects["target:<id>"].verification[<itemKey>]`.
- Only the S9 route writes it, and only S8 routes write the judgement keys. The route boundary enforces this ownership split.
- The S3/S5 writer carry-over from slice 1 preserves it.

The alternative was `project_checklist_item_state` rows with a synthetic `checklist_id = "chk-s8-pairing"` (`0132:22-34`). It was rejected because its `fail` status means "mandatory not met" to the S9 predicate (`process-flow.ts:538-544`), and `different` is not a failure. A finding that S8 was wrong is a valid DD outcome.

### 15.4 Two-way link

- **S8 → S9 status (read-only).** Each S8 item shows a chip `검증됨` / `불일치` / `미검증` (`확인 못함` counts as `미검증`, with its reason shown on hover/expand).
- **S9 → S8 hypothesis.** The S8 judgement is shown verbatim, by reference, in the S9 section.
- **Mismatch (`different`).** It raises three warnings:
  - In the S8 technical lens: the item and the strip show `주의 — 실사 결과와 다름`.
  - In `대상 비교·선정`: the technical column shows a mismatch count.
  - In the IC package / gate brief (`lib/gate-brief.ts:41` dd line, and the entity_ic brief): a `S8 판단과 실사 불일치` list.

  A mismatch also *proposes* revisiting S8 assumptions (`S8 가정 재검토 제안`, linking to `파라미터·스냅샷` and the relevant item). It never edits S8 judgements or case numbers. Any change goes through the normal S8 human edit, which clears the S8 confirmation and so marks the S9 row `재검증 필요`.

### 15.5 Sequencing and dd gate

1. The S8 judgement comes first. It is plan-level and done before target selection, per target.
2. S9 verification runs on the selected target before the dd gate. Comparison targets are optional.
3. The dd gate stays human.
4. **Completion rule (recommended).**
   - **Mandatory, selected target only:**
     - T2 TRL must be `verified` or `different`. `unverifiable` needs a waiver through the existing waiver flow.
     - T5 must be verified for permits. Certification transferability is satisfied by the existing `ma-12` / `bf-03` judgement. The pairing row reads that judgement and has no separate input.
   - **Informational warning only:** T1, T3, T4, and comparison targets.
   - **Implementation:** the S9 predicate (`process-flow.ts:538`) gets one blocker string, `S8 판단 검증 필수 항목(TRL·인허가) 미완료`. This is a gate-criterion change, so it is an ADR item (§15.8).

### 15.6 Green Field comparison

Green Field has no target. The S9 technical DD covers the new site or plant (feasibility verification, `process-flow.ts:48`). Pairing is lighter there:
- T6 stays as a list of handoff questions.
- Verification rows are optional and never block.
- There is no transferability (no change of control).
- T2 maps to `rbd-01` for R&BD deals (`checklists/rbd-technology-checklist.yaml:32-33`).

### 15.7 API / MCP / tests / wiki

- **API.**
  - `GET /api/projects/:id/technical-lens/verification?target=<id>` returns the S8 hypothesis by ref, the verification rows, and the resolved checklist/finding links.
  - `PUT` saves a draft or a human edit (analyst+).
  - `POST .../verification/confirm` is human-only.
  - `GET s8-lens-summary` gains `verification: {verified, different, unverified}` per subject.
- **MCP.** `draft_technical_verification` (AI draft only) and a read in `get_project_dd_workspace`. There is no confirm tool.
- **Tests.**
  - Ref integrity: deleting or changing an S8 item flags the row `재검증 필요` and does not drop it.
  - Mismatch propagation to the strip, the comparison table, and the gate brief.
  - No numeric side effects (snapshot of the case before and after a mismatch).
  - S9 predicate: mandatory T2/T5 on the selected target only; comparison targets never block; ma-12 read-through.
  - Writer carry-over.
  - Human-only confirm (403 for agent/MCP).
  - Green Field rows never block.
- **Wiki.**
  - 30: the two-way chips.
  - 41: Green Field T6.
  - `42-그린필드-S9-실사.md`: optional verification.
  - 52: S8 mismatch warnings.
  - `53-브라운필드-S9-실사.md`: the new section, the mandatory T2/T5 rule, and the ma-12 link.

### 15.8 ADR, slices, open decisions

- **ADR.** Fold the pairing into ADR-0169 if it is still unwritten. Otherwise write ADR-0170. Triggers: the dd completion criterion change, the JSON contract, and MCP scope.
- **New slice 6b, S9 pairing** (after the lens slices 1-5, before slice 6): verification JSON, the S9 section, two-way chips, mismatch warnings in the strip, table, and gate brief, the S9 predicate blocker, and tests. **About 3 days.** Wiki 42/53 is added to slice 7 (+0.5 d). The new total is about 13.5 days.
- **Open decisions (resolved as recommended, ADR-0169 accepted 2026-10-14):**
  1. Storage as a JSON sibling key, not checklist rows? **Yes.**
  2. Make T2 and T5 mandatory before dd completion for the selected target only? **Yes.** Everything else warns.
  3. Does `unverifiable` on a mandatory item require a waiver? **Yes, using the existing waiver flow.**
  4. Does certification transferability use the existing `ma-12` / `bf-03` judgement, with no new input? **Yes.**
  5. Is pairing for comparison targets optional and non-blocking? **Yes.**
  6. Does a mismatch only propose an S8 revisit, never auto-edit? **Yes.**
  7. Does pairing in Green Field stay optional and non-blocking? **Yes.**

## 14. Honest limits

This is a design draft. Line references for the ADR-0168 code point to an unmerged commit and may shift when it merges. Lens statuses are decision support, not investment advice, and every confirmation is a human act.
