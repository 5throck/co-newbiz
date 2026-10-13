---
title: "Green Field establishment mode: new business unit vs new legal entity"
status: proposal
date: 2026-10-14
owner: process-governance-manager
lang: ko
lang_reason: source-material
related_adrs: [ADR-0047, ADR-0085, ADR-0100, ADR-0160, ADR-0161, ADR-0165, ADR-0166]
---

# Green Field establishment mode: new business unit vs new legal entity

## 1. Problem

The human decider stated on 2026-10-14 that a Green Field project does not have to create a new legal entity. The company can run the new business as a new business unit (`신규 사업부`) inside the existing company. The product currently assumes a new entity in four places:

- S10 `설립 구조`, through the term `설립 법인 형태`.
- S11 `설립 실행 — 5단계` (`ESTABLISHMENT_STEP_TITLES`, `app/web-next/lib/establishment.ts`).
- `checklists/entity-formation-checklist.yaml` (ef-01..19).
- The S11 completion predicate in `app/web-next/lib/process-flow.ts` (~L662). It requires `done < 5` → blocker whenever `origin ∈ {internal, joint}`.

As a result, a business-unit project cannot finish S11 truthfully. Users must either record entity steps that never happened or leave S11 blocked.

## 2. Proposal: a project-level `establishment_mode`

| Value | UI label | Meaning |
|---|---|---|
| `new_entity` | `신규 법인 설립` | Today's behaviour, unchanged |
| `business_unit` | `신규 사업부 추진` | The business runs inside the existing legal entity |

### 2.1 Relation to other axes

- **Origin (ADR-0047)** remains a separate axis that answers "who initiates". Establishment mode answers "under which legal vehicle".
  - Recommended rule: `business_unit` is allowed only when `origin = internal`.
  - When `origin = joint`, the project stays `new_entity`. An unincorporated contractual JV is out of scope and could be added later as a third value.
  - When `origin = external`, no establishment steps apply, so the mode is ignored and stored as NULL.
- **S9 sub-tracks (ADR-0160)** are not replaced. Expected pairings:
  - `existing_business_rbd` → usually `business_unit`.
  - `intra_venture` → either value.
  - `plain` → either value.
  - The sub-track only proposes a default. It never forces the mode.
- **Brownfield**: not applicable. The column stays NULL and the predicates ignore it.

### 2.2 Who records it, and when

- **Recorded:** a human project lead or the S10 IC owner records the mode at S10 on the structure screen, as part of the `설립 구조` decision.
- **Proposed earlier:** S5 promotion may store a *proposed* value derived from the sub-track. It is shown as `제안` and does not take effect until S10 confirms it.
- **Changed later:** the mode can change until S11 step 1 leaves `pending`. After that, a change requires an audited `establishment_mode_change` event and a reason. It also resets the not-done S11 steps to the new mode's step set. Done steps of the old set are kept read-only as history. If an S10 IC approval exists, the change raises the existing `reopenedAfterGate`-style warning.
- **Agents:** agents may propose a mode through MCP. They may not set it.

## 3. Stage changes

### S10 — structure screen

- Add a top-level choice with two options: `신규 법인 설립` and `신규 사업부 추진`.
- For `new_entity`, show the existing `설립 법인 형태` field unchanged.
- For `business_unit`, replace it with `사업부 신설 형태`:
  - Options: `독립 사업부`, `기존 사업부 내 팀`, `사내 독립 기업(CIC)`.
  - Also capture the host entity (default: our company) and the cost and profit accounting treatment (`독립 손익 관리` yes/no).
- Keep the deal-structure execution conditions (capex tranches, gx-01) identical for both modes.

### S11 — step sets per mode

`new_entity` keeps today's 5 steps unchanged.

`business_unit` uses its own 5 steps, so the "5/5" UX and sequence rule (step 5 only after steps 1–4 are done) are preserved:

1. `사업부 신설 결의(이사회/경영위원회)` — board or management-committee resolution, plus budget and authority delegation.
2. `사업자등록 사업장·업종 추가 또는 변경` — add a place of business or change the business type, or confirm no change is needed.
3. `인허가 명의 확인(기존 법인 명의로 가능한지)` — classify each required permit as held / new under the existing name / not possible under the existing name. If any permit is not possible, escalate.
4. `인력 배치·조직 개편` — internal transfers, org chart, job-description changes, and PIIA or work-for-hire coverage.
5. `완료 확인(조직·예산·권한 기준선)` — org, budget, and delegation-of-authority baseline confirmed by a human, with evidence.

The S11 predicate becomes `done < stepCount(mode)`. The blocker text is mode-specific (`설립 실행 미완료` / `사업부 신설 실행 미완료`).

## 4. Data model (additive sketch, migration 0142)

```sql
ALTER TABLE project ADD COLUMN establishment_mode TEXT
  CHECK (establishment_mode IN ('new_entity','business_unit'));          -- NULL = not applicable / legacy
ALTER TABLE project ADD COLUMN establishment_mode_proposed TEXT;          -- S5 hint, non-binding
ALTER TABLE entity_establishment_step ADD COLUMN mode TEXT NOT NULL DEFAULT 'new_entity'
  CHECK (mode IN ('new_entity','business_unit'));
-- backfill: project.establishment_mode = 'new_entity' WHERE origin IN ('internal','joint') AND track='greenfield'
-- unique key becomes (project_id, mode, step_no)
```

- `ESTABLISHMENT_STEP_TITLES` becomes `Record<EstablishmentMode, Record<number,string>>`. A wrapper `stepTitles(mode)` keeps old call sites working.
- Existing rows default to `new_entity`, so behaviour for every current project is byte-identical.
- The step event table also gets a `mode` column, because event rows reference the step's mode.
- This is a DB schema change, so an ADR is required.

## 5. Governance artifacts

- **Checklists**
  - Keep `entity-formation-checklist.yaml` and tag each item `modes: [new_entity]`:
    - ef-01..08 and ef-10..12 are entity-only.
    - ef-09 is `new_entity` only. For business units, intra-group contracts become internal cost allocation, which is noted only.
    - ef-13..18 are joint-only and therefore entity-only.
    - ef-19 applies to spin-off only.
  - gx-01..03 apply to both modes.
  - Add `checklists/business-unit-formation-checklist.yaml` (bu-01..~08), mirroring the 5 steps:
    - resolution
    - delegation-of-authority (DoA) update
    - VAT registration change
    - permit name check
    - certification holder check
    - staffing and labour consultation
    - accounting segment / internal transfer pricing
    - baseline confirmation
- **Procedures**
  - In `procedures/_shared/entity-establishment-execution/schema.yaml`, add `project.establishment_mode == "new_entity"` (or NULL for legacy) to `applies_when`.
  - Add a sibling `procedures/_shared/business-unit-establishment-execution/schema.yaml` with `applies_when: origin == internal AND establishment_mode == business_unit`.
  - Policy impact analysis and a `project_policy_pin` check are required. In-flight pinned projects stay on the old procedure, which is safe because they are `new_entity`.
- **Validators**: the procedure validator must reject a mode/origin mismatch (business_unit with joint or external).
- **`flow.spec.yaml`**: S10 and S11 text changes from "법인 설립" to "설립 구조 결정(신규 법인 설립 또는 신규 사업부 추진)" and "설립 또는 사업부 신설 실행".
- **IC materials**
  - The S10/S11 IC package shows the mode prominently.
  - For `business_unit`, the package replaces the entity sections (jurisdiction, share structure) with host-entity exposure: liabilities stay on the parent's balance sheet and there is no ring-fencing.
  - The risk section adds "no liability isolation" as a standing item.
- **Glossary**
  - Add `Establishment Mode` (`설립 방식`), `New Legal Entity Formation` (`신규 법인 설립`), and `New Business Unit` (`신규 사업부 추진`).
  - Add `Business Unit Form` (`사업부 신설 형태`).
  - Re-run glossary lint and the four integrations.
- **MCP**
  - Extend `record_establishment` with an optional `mode`. It validates `step_no` against that mode's set.
  - Add `propose_establishment_mode`, which is proposal-only.
  - Human-only boundaries are unchanged:
    - Completion (step 5 done), assignee changes, and reopen stay human-only (ADR-0165).
    - Mode confirmation is added to the human-only set.
- **Wiki**
  - Update `docs/wiki/ko/43-그린필드-S10-실행-기준선.md` (structure choice) and `docs/wiki/ko/44-그린필드-S11-설립-실행.md` (two step sets).
  - Add a short comparison table of the two modes.

## 6. Tests

- Unit tests for `stepTitles(mode)` and for the predicate cases below.

  | Mode | Steps done | Expected S11 result |
  |---|---|---|
  | `business_unit` | 5/5 | complete |
  | `new_entity` | 4/5 | blocked |
  | NULL legacy, origin internal | — | `new_entity` behaviour |
  | external | — | no requirement |
- A migration test confirms the backfill and that existing rows are unchanged.
- The API/MCP rejects `business_unit` together with `origin = joint`.
- After a mode change, old done steps are read-only and the new set starts at pending.
- A procedure `applies_when` fixture test covers both procedures.
- Glossary-lint and design:lint must pass for the S10/S11 screens.
- An e2e test runs one business-unit Green Field project from S10 to S12.

## 7. Rollout

1. ADR plus migration 0142 plus backfill. There is no UI change in this step, and it is invisible to users.
2. Mode-aware predicate and step sets, the S10 selector, and the S11 screen.
3. The business-unit checklist, procedure, glossary, IC package, and wiki.
4. Optional: the S5 proposal hint and the MCP `propose_establishment_mode`.

## 8. ADR needs

- **New ADR-0167, "Green Field establishment mode (new entity vs business unit)".**
  - Amends ADR-0047 A.5: S11 establishment applies only when origin is internal or joint *and* the mode is new_entity; the business-unit set applies when origin is internal and the mode is business_unit.
  - Amends ADR-0100 (S10 IC decides the establishment mode; S11 executes the mode's step set).
  - References ADR-0161: the execution baseline gx-* applies to both modes.
  - References ADR-0165: assignee and reopen rules are unchanged.
- Also triggered by: DB schema change, policy and procedure change, and MCP tool scope change.

## 9. Risks (needs counsel unless noted)

- **Permits:** for a business unit, the permit is held by the same legal entity. The question becomes whether the existing entity's name, business purpose, or registered place covers the new activity. This is not a transfer question.
  - Whether the articles of incorporation need a purpose amendment is a separate item. It may require a shareholders' resolution, which is likely an `정관 변경` special resolution. **Needs counsel.**
- **Certifications:**
  - These are usually site- or scope-specific. Adding a new site or product to an existing certificate is a scope extension with the certifying body, not a change-of-control transfer.
  - Confirm this with the body; inference is not allowed.
  - Keep permits and certifications separate (non-negotiable rule 5).
- **VAT registration** (adding a place of business or changing the business type) and **whether a separate business registration is required for a new site:** needs counsel or a tax adviser. Not verified via k-law in this proposal.
- **Liability:** with no ring-fencing, the parent bears all liabilities. The IC must see this explicitly. The RAG risk input should not treat business_unit as lower risk by default.
- **Labour:** internal reassignment can trigger transfer or work-scope disputes and may require consultation under the rules of employment. **Needs counsel.**
- **Later spin-off:** a business unit may later be spun off into an entity (`분할`, see ef-19). The mode-change path must allow business_unit → new_entity without losing history.
- **Mis-selection risk:** users may pick business_unit to avoid the heavier checklist. Mitigation: human-only confirmation and a required rationale field at S10.

## 10. Recommendation and smallest viable slice

Smallest viable slice, deliverable in one PR plus an ADR:

- ADR-0167.
- Migration 0142 (`project.establishment_mode` with backfill, `entity_establishment_step.mode`).
- Mode-aware `stepTitles` and the S11 predicate.
- A simple S10 radio for the mode with a human-only save.
- The S11 screen rendering the business-unit step set.
- Updated `applies_when` on the existing procedure and a minimal sibling procedure.
- Tests from section 6 (except the e2e test).

Follow-up slices: the business-unit checklist, IC package wording, glossary, wiki, and the S5 hint.

## 11. Decisions for the human (recommended answers)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Value names and labels | `new_entity`/`신규 법인 설립`, `business_unit`/`신규 사업부 추진` |
| D2 | Allowed origins for business_unit | internal only; joint stays new_entity |
| D3 | Where the mode is decided | S10, by a human (S5 only proposes) |
| D4 | Default for new Green Field projects | No default; must be chosen at S10. Legacy rows = new_entity |
| D5 | Changeable after S11 starts? | Yes, via an audited change with a reason; done steps are kept as history |
| D6 | Business-unit step set | The 5 steps in section 3 |
| D7 | Separate checklist vs tags | Both: `modes` tags on ef-*, plus a new bu-* checklist |
| D8 | IC must show "no liability isolation" | Yes, as a standing risk item |
| D9 | Contractual (unincorporated) JV | Out of scope for now |

## 12. Effort and impact

| Area | Effort |
|---|---|
| Smallest viable slice (schema, predicate, S10/S11 UI, procedure gating, tests) | ~3–4 engineer-days |
| Checklist, glossary, IC package, wiki | ~2 days |
| Counsel confirmations | external |

- **Impact:**
  - Removes false "entity formed" records for business-unit projects.
  - Unblocks S11 for those projects.
  - Has zero behavioural change for existing projects because of the backfill to new_entity.
- **Risk level:** medium. Changes are additive, but they touch the S11 gating predicate and MCP scope.

## 13. Legal verification (k-law, 2026-10-14)

Source: the 법제처 Open API (`lawSearch.do` exact-name match, then `lawService.do` by MST), retrieved 2026-10-14. Quotes are short excerpts of the statute text. Interpretation beyond the quoted text is marked as such.

> 법제처 국가법령정보 공동활용 자료 기준 / 법적 자문 아님

### 13.1 Sources

| Law | MST | Effective (시행) | Articles read |
|---|---|---|---|
| 상법 | 273629 | 2026-09-10 | 183, 289, 317, 361, 374, 393, 433, 434 |
| 부가가치세법 | 276117 | 2026-01-02 | 6, 8 |
| 부가가치세법 시행령 | 283641 | 2026-04-01 | 11, 14 |
| 근로기준법 | 285279 | 2026-10-08 | 2, 23, 93, 94 |

### 13.2 Findings by business-unit step

**(1) 사업부 신설 결의 — 상법**

- §289①1: the 목적 (business purpose) is an absolute item of the articles. Quote: "정관을 작성하여 다음의 사항을 적고 … 1. 목적".
- §317②1: the 목적 (items 1–4, 6, 7 of §289①) is a registered item. §317④ applies §§181–183 to stock companies. §183: "변경되었을 때에는 본점의 소재지에서 2주일 내에 변경등기를 하여야 한다." (§183 refers to §180 items. Applying it to the 목적 of a stock company relies on the §317④ cross-reference.)
- §433①/§434: "정관의 변경은 주주총회의 결의에 의하여야 한다". The resolution is a special resolution: 2/3 of the votes present and at least 1/3 of the issued shares.
- §393①: "회사의 업무집행은 이사회의 결의로 한다". §393① also names 지점의 설치ㆍ이전 또는 폐지 and 중요한 자산의 처분 as board matters.
- §374①: a 주주총회 special resolution is needed only for the listed acts. These are a transfer of all or an important part of the business, a lease of the whole business, or an acquisition of another company's business that has a material effect. A company starting a new internal business commits none of these acts, so the provision is not triggered by itself. If the new business is set up by acquiring another company's business, §374①3 can apply.
- **What it means for the step:** If the new business falls outside the current 목적, the company must change its articles by special shareholder resolution and then register the change. Otherwise the board resolves the new business as a matter of business execution. Whether the new business is already covered by the current 목적 is a reading of the company's own articles. No statute answers it.
- **Recommended step wording:** "사업부 신설 결의 — 현행 정관 목적 범위 확인. 범위 밖이면 주주총회 특별결의로 정관 변경(상법 제433조·제434조) 후 2주 내 목적 변경등기(제317조②1·④, 제183조). 범위 안이면 이사회 결의(제393조①). 지점 설치가 따르면 이사회 결의 및 지점 등기(제317조②3의4) 확인."

**(2) 사업자등록 사업장·업종 추가/변경 — 부가가치세법**

- 법 §6①: "사업자의 부가가치세 납세지는 각 사업장의 소재지로 한다".
- 법 §8①: "사업자는 사업장마다 … 사업 개시일부터 20일 이내에 … 사업자등록을 신청하여야 한다". A new place of business therefore needs a **new registration**, not a 정정신고. The exception is 사업자 단위 과세: under §8③, a business with two or more places may register once at head-office level, and §8⑤ sets a 20-day deadline for the change request when a place is added.
- 법 §8⑧: "등록사항이 변경되면 … 지체 없이 … 신고하여야 한다".
- 시행령 §14①: the 정정신고 grounds include no. 3, "사업의 종류에 변동이 있는 경우". They also include no. 4 (moving a place of business) and no. 9 (a 사업자 단위 과세 사업자 opening a 종된 사업장). The deadline is "지체 없이". §14③2 requires the tax office to reissue the certificate within 2 days.
- Correction to the brief: the 정정신고 grounds are in **시행령 제14조**, not 제11조. 제11조 covers the registration application. Its attachment table requires a copy of the permit or registration for businesses that need one by law.
- **Recommended checklist wording:** "새 사업장 개설 시: 사업장별 신규 사업자등록(부가가치세법 제8조①, 개시일부터 20일 이내) 또는 사업자 단위 과세 사업자면 종된 사업장 신설 정정신고(시행령 제14조①9). 기존 사업장에서 업종만 추가 시: 사업자등록 정정신고 지체 없이(법 제8조⑧, 시행령 제14조①3). 인허가 업종이면 허가증 사본 첨부(시행령 제11조③)."

**(3) 인허가 명의 확인**

- The statutes read here do not contain a general rule that a permit belongs to the legal entity or to the place of business. 시행령 §11③ shows only that tax registration expects a permit copy when another statute requires a permit.
- **Status:** could not verify. The answer depends on each permit statute and needs a per-permit check. Each statute decides whether the permit is per person, per facility or per site, and whether it can be extended or must be issued new.
- **Recommended wording:** "인허가 명의 확인 — 허가별 근거 법령에서 명의(법인/사업장/시설) 및 사업장 추가 시 신규·변경 여부 개별 확인. 일반 규칙 없음."

**(4) Certifications (scope extension vs transfer)**

- No statute read here governs certification scope extension or transfer. Most product and management-system certifications follow the certifying body's own rules or a sector statute.
- **Status:** could not verify. Confirm with the certifying body. This matches the design rule against inferring transferability.
- **Recommended wording:** "인증 범위 확인 — 인증기관 규정으로 범위 확대(scope extension) 또는 신규 인증 여부 확인. 추론 금지."

**(5) 인력 배치·조직 개편 — 근로기준법**

- §23①: "정당한 이유 없이 해고, 휴직, 정직, 전직, 감봉, 그 밖의 징벌 … 을 하지 못한다". Moving staff into the new unit is a 전직/전보 within the same employer, and §23① requires a 정당한 이유 for it. The statute does not define what makes a 전직 justified. Courts weigh business necessity against the burden on the worker and look at consultation. That case law was not retrieved here.
- §93: an employer with 10 or more regular workers must report its 취업규칙, "이를 변경하는 경우에도 또한 같다".
- §94①: when changing the 취업규칙, the employer must hear the majority union or the majority of workers. If the change is unfavourable to workers, "그 동의를 받아야 한다". §94② requires the written opinion to be attached to the report.
- The employer stays the same, so no transfer of employment occurs. This follows from §2①2 (사용자 = 사업주), but that is an inference.
- **Recommended wording:** "인력 배치·조직 개편 — 전직·전보는 정당한 이유 및 협의 기록(근로기준법 제23조①). 근무지·근무시간·임금체계 등 취업규칙 사항이 바뀌면 과반수 의견청취, 불이익 변경이면 과반수 동의(제94조①) 후 변경 신고(제93조, 상시 10명 이상)."

**완료 확인 (completion check)** — recommended evidence:

- a board minute, or a shareholder minute plus the registry extract showing the new 목적;
- the business registration certificate showing the new place of business or business type;
- the per-permit confirmations;
- the certifying body's reply;
- 전보 records, and the 취업규칙 report if it changed.

### 13.3 Summary groups

| Group | Items |
|---|---|
| Verified (statute text) | 목적 is a mandatory article item and a registered item (상법 §289①1, §317②1). Changing the articles needs a shareholder special resolution (§433①, §434). Change registration is due within 2 weeks (§183 via §317④). Business execution is decided by the board (§393①). §374① lists only transfer, lease and acquisition acts. Registration is per place of business, within 20 days (부가가치세법 §6①, §8①), unless the business uses head-office-level registration (§8③·⑤). A business-type change triggers a 정정신고 without delay (시행령 §14①3, 법 §8⑧). 전직 needs a 정당한 이유 (근로기준법 §23①). Changing the 취업규칙 needs a majority opinion, or consent if unfavourable (§94①), and must be reported (§93). |
| Could not verify | Any general rule on permit holders (none found; per-permit). Certification scope or transfer (not in statute). Case-law tests for a justified 전직. Whether §183 applies to stock companies through §317④ without further steps (cross-reference only). |
| Needs counsel / judgement | Whether the new business falls within the current 목적 of the articles. Whether the setup includes an acquisition that could trigger §374①3. Whether a given 전보 or rule change is unfavourable. Each permit statute. |

> 법제처 국가법령정보 공동활용 자료 기준 / 법적 자문 아님
