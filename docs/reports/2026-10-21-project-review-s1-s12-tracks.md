---
lang: ko
lang_reason: source-material
---

# Project Review — S1–S12 greenfield/brownfield 트랙 정합성 — 2026-10-21

- **Date**: 2026-10-21
- **Scope**: co-newbiz (variant) — S1–S12 파이프라인 전체의 greenfield·brownfield 트랙 구현 정합성 (스코프드: 트랙 도메인 4슬롯)
- **Method**: 머신 배터리(`bun scripts/audit.ts` — 변형 프로젝트 기준) + 읽기 전용 리뷰 에이전트 4슬롯 병렬(트랙 모델·플로우 스펙 / greenfield 경로 / brownfield 경로 / 캐리어·게이트·네비게이션)
- **Analysis only — no files modified in this report.** (변형 프로젝트이므로 후속 조치는 이 보고서 + 메모리 로그에 기록 — `scripts/ticket.ts`는 L0 전용)

## Baseline (Step 0)

| 검증 | 결과 |
|---|---|
| `bun scripts/audit.ts` | ✅ 전체 통과 — WARN 5(셸 패턴 휴리스틱, `scripts/co-newbiz/*`), SKIP 1(design-lint 스캔 루트 부재), ERROR 0 |
| `scripts/review-baseline.ts` | 해당 없음 — 워크스페이스 루트 전용 스크립트(변형 프로젝트는 자체 audit 사용이 스킬 규정) |

머신 배터리에서 트랙 관계 ERROR 없음 → 전량 에이전트 검증으로 커버.

## Review Results

### 🔴 Critical (즉시 수정 권고)

| # | Issue | Agent | File:Line | Class | Fix |
|---|-------|-------|-----------|-------|-----|
| C1 | **외부·내부 brownfield 프로젝트의 S12 완료가 승인된 기록 경로로는 불가능** — S12 완료 조건(`벤처 스코어카드가 필요합니다`)은 트랙 무관 전 프로젝트에 스코어카드를 요구하는데(`lib/process-flow.ts:727-736`), 유일한 기록 경로인 `POST /post-management/scorecard`는 greenfield 전용 409 가드(`lib/greenfield-execution.ts:869`). 그런데 적용성 뷰는 brownfield internal/hybrid/joint에 `portfolio_venture_monitoring: true`(`greenfield-execution.ts:668`)로 "권장" 표시까지 한다(`PostManagementPanel.tsx:76-85`). 절차 정의는 외부 brownfield를 integration/partnership 모니터링으로 대체한다고 명시(`library.generated.ts:1534`) — 조건(전 트랙 요구)·적용성(일부 brownfield 권장)·쓰기 경로(greenfield만 허용) 셋이 서로 모순. 데모 brownfield만 시드가 API를 우회해 직접 INSERT(`seed-s1-s12-demo.ts:467`)로 통과. | C(Brownfield) + B(Greenfield, 교차 확인) | `lib/process-flow.ts:727`, `lib/greenfield-execution.ts:668,869` | script-gap | (a) S12 스코어카드 조건을 `postManagementApplicability().portfolio_venture_monitoring`와 정렬(외부 brownfield 면제), 또는 (b) `jv-lifecycle-governance` 소스의 brownfield/JV 스코어카드 기록 경로 추가(레포지토리는 이미 지원, `venture-scorecard.repository.ts:59`). 어느 쪽이든 설계 게이트 필요 — **즉시 착수 권고** |

### 🟡 High (1주 내)

| # | Issue | Agent | File:Line | Class | Fix |
|---|-------|-------|-----------|-------|-----|
| H1 | **brownfield `pre_fs` HOLD 딥링크가 막다른 길** — 인박스 `GATE_STAGE_TAB.pre_fs = "s5"`(`lib/inbox.ts:121-129`) → `/deals/{id}/s5`는 brownfield에서 TrackGate로 막히고 s6으로 안내하는데, S6(S6/S7 어디에도) brownfield pre_fs 결정 UI가 없음. 유일한 brownfield pre_fs 기록면은 S4 위원회 탭(`RouteDecisionStage.tsx:110-115`)인데 HOLD 알림은 그곳을 가리키지 않음. greenfield는 S5에 정상 호스팅(`GreenfieldStage.tsx:1462`). | D(캐리어) | `lib/inbox.ts:123`, `app/deals/[id]/[stage]/page.tsx:182` | systemic | `gateHoldHref`를 트랙 인지로(brownfield pre_fs → `/deals/{id}/s4` 위원회 탭 앵커) 하거나, flow.spec S6 게이트 소유에 맞춰 brownfield S6에 pre_fs 결정면 추가 |
| H2 | **데모 체인 표류 — 라이브 dev DB가 시드 스크립트보다 낡고, greenfield 트윈은 미실행** — ① 라이브 DB에 `demo-s1-s12-project`의 `s11_pmi_kickoff` process_run 부재·`venture_transition_decision` 전 DB 0행(C: S11 블로커 표시, D: S12 블로커 표시 — 할부 할아버지 규칙으로만 은폐) ② `demo-gf-*` 그린필드 데모 전무(B: 그 시드는 확정된 실행 기준선이 없어 자체 S11 조건도 불충족) ③ brownfield 데모에 S9 도구(CoC·보상·인터뷰)·PMI 모니터링 행 0건 ④ `project_milestone` 0행. 헤더는 "시드가 조건을 충족한다"고 주장(`seed-s1-s12-demo.ts:3-12`). | C + D + B | `scripts/co-newbiz/seed-s1-s12-demo.ts`, 라이브 DB | script-gap | 두 시드 재실행 + 시드 확장(S9 도구·PMI 모니터링·greenfield 확정 기준선) + **양 트랙 데모로 S1→S12 술어 충족을 검증하는 e2e 하드닝**( validator-hardening, 아래 Action wiring) |

### 🟢 Moderate (2주 내)

| # | Issue | Agent | File:Line | Class | Fix |
|---|-------|-------|-----------|-------|-----|
| M1 | `target_screening`(S7)만 3단계 검토 런타임에서 제외 — `REVIEW_GATES`/`GATE_ENTITY`에 없어(`lib/review/gate-artifacts.ts:12,19-27`) brownfield 유일 전용 게이트가 human_final 스냅샷 없이 결정됨. 단, 전 표면에서 일관되게 빠져 있고(`ReviewBuckets.tsx:19-28`, inbox) ADR-0153 §7은 애초 `transition`을 세었으므로 "의도 vs 누락"이 문서화되지 않음. 게이트 브리프·위원회는 포함. | A(트랙 모델), D(반대 해석 병기) | `lib/review/gate-artifacts.ts:12`, `docs/adr/0153` §7 | systemic | 결정 필요: 포함(스냅샷 추가) 또는 ADR-0153에 명시적 예외 기록. 어느 쪽이든 문서화가 본체 |
| M2 | 스펙 S4 완료 문구가 greenfield `sub_track`을 필수로 암시하나 엔진·쓰기 경로는 선택 처리(`flow.spec.yaml:378` vs `process-flow.ts:322`, `route-decision/route.ts:79-81`) | A | `process/flow.spec.yaml:378` | one-time | 스펙 문구를 "brownfield는 Route 유형(sub_track) 필수, greenfield는 선택"으로 정정 |
| M3 | flow.spec이 "entity-ic-review step 3.1이 financing-agent 공동검토를 강제한다"고 하나 절차 스키마에 기계 판독 가능한 financing-agent 할당 없음(서술만) | A | `process/flow.spec.yaml:706-708`, `procedures/_shared/entity-ic-review/schema.yaml:47-56` | systemic | 3.1 하위에 `agent_key: financing-agent` 공동검토 스텝 추가 또는 스펙 문구 완화 |
| M4 | S5 greenfield 기록 API에 트랙 가드 없음 — 클라이언트 TrackGate만 (`app/api/greenfield/[oppId]/route.ts:69-135`, 트랙 참조 0건). brownfield 캐리어에도 API 기록 가능(엔진상 skipped라 무해 데이터) — "클라이언트 숨김·서버 기록 가능" 패턴 | B | `app/api/greenfield/[oppId]/route.ts` | systemic | route_decision 조회 후 brownfield면 409 `not_applicable_track` (execution-baseline 선례 준용) |
| M5 | M&A 지급 조건(딜 페이먼트 마일스톤/언-아웃)의 S10 전용 면 없음 — 트랜치는 greenfield capex 전용 탭(`DealStructureStage.tsx:284,591`), brownfield는 4축 노트·S12 `tranche_condition` 자유 텍스트만 | C | `components/stages/DealStructureStage.tsx:284` | systemic | 제품 결정 필요: brownfield 지급 일정 면 추가 또는 `tranche_condition`을 공식 캐리어로 문서화 |
| M6 | 게이트 라벨 SSOT 이중화 — 레일·결정 패널은 영문("게이트 Screening", `lib/stage-meta.ts:20-28`), 프로세스 페이지·위원회는 용어집 한국어("스크리닝", `lib/labels.ts:41-50`) | D | `lib/stage-meta.ts:20` vs `lib/labels.ts:41` | systemic | `stage-meta.ts`가 용어집 라벨로 위임 — 단일 어휘화 |
| M7 | `/deals/{projectId}/s1~s7`가 승격된 프로젝트 id에서 404 — S3·S8~S12만 캐리어 해석(`resolveDealCarrier`), S1/S2/S4/S5/S6/S7 분기는 raw id 사용 | D | `app/deals/[id]/[stage]/page.tsx:101,119,183,202` | systemic | StageTab에서 1회 해석해 S1–S7 분기에 전달 |
| M8 | IC 순서(entity_ic → group_ic)가 UI 잠금만 있고 서버 미강제 — 직접 POST로 group_ic GO 선행 기록 가능(flow.spec 금지, `flow.spec.yaml:193`) | D | `app/api/projects/[id]/gate-decisions/route.ts:89` | script-gap | `gateGoPrerequisiteGaps`에 선행 GO 검사 추가(GO 한정) + 순서 위반 409 라우트 테스트 |

### ℹ️ Low / Improvements

| # | Issue | Agent | File:Line | Class |
|---|-------|-------|-----------|-------|
| L1 | `flow.spec` v2.10.0 버전 주석 없음(최신 주석 v2.9.1) — `SPEC_VERSION` 소비처 다수 | A | `process/flow.spec.yaml:24` | one-time |
| L2 | 승격 패널 제목 "S7 → S8" 하드코딩(greenfield는 S5→S8이 실제) | A | `PromotionPanel.tsx:206` | one-time |
| L3 | 미승격 기회가 S8을 "current·blockers 0"로 보고 — 소비자 함정, `carrierScopeFinished` 파생 권고 | A | `process-flow.ts:426-430` | systemic |
| L4 | ADR-0074/0076의 "게이트 = 에이전트 결정" 구문이 ADR-0053(경계 #2)으로 대체됐으나 정정 없음 | A | `docs/adr/0074:47-48`, `0076` | systemic |
| L5 | `milestones/import-baseline`이 경로 수준 트랙 가드 없이 불변식 의존 — case_type 재분류 시 과거 기준선 수입 가능 | B | `app/api/projects/[id]/milestones/import-baseline/route.ts:13-26` | one-time |
| L6 | 대상 비교 DD 뷰에서 실사 도구 카운트 섹션 생략(의도적 주석 있음 — 확인 필요) | C | `app/api/projects/[id]/dd/route.ts:31` | systemic |
| L7 | 교차 트랙 안내 페이지의 `StageFrame track` 하드코딩 — 레일과 본문 안내가 상반 표시 | D | `app/deals/[id]/[stage]/page.tsx:176,195` | one-time |
| L8 | `/projects/**` 레일의 S1–S7 링크가 캐리어 없는 플랫 스텁으로 → 최신 기회 자동 선택(출발 프로젝트와 다를 수 있음). `StageTabs`의 원본 기회 브리지와 불일치 | D | `components/StageFrame.tsx:61` | systemic |

### ✅ Strengths (교차 검증된 강점)

1. **트랙 분기 자체는 스펙↔엔진↔라우트↔실데이터까지 일치** — S5 `[greenfield]`, S6/S7 `[brownfield]` `applicableTracks`, 엔진 skip 계산(`process-flow.ts:886-888,956-958`), parity 테스트가 SSOT 드리프트 방지(`tests/unit/process-flow.test.ts:200-240`). 승격은 단일 트랙 인지 경로(greenfield S5→S8 / brownfield S7→S8)로 FACT 사전조건까지 검증.
2. **게이트 배치 정합** — 기회 캐리어 3개(project 4개) 게이트 라우트 파티션이 정확히 분리되고 GO 선행조건(`gateGoPrerequisiteGaps`)이 트랙 인지. 실측 gate_decision 행이 캐리어별 허용 집합과 정확히 일치.
3. **트랙 미적용 단계는 어디서도 죽은 페이지가 아님** — TrackGate 안내+교정 링크, 레일 "미적용"(aria-disabled), 엔진 skipped, 미승격 "승격 후" 표시.
4. **트랙 스코핑이 서버에서 3중 방어** — 실행 기준선(적용성→쓰기 403→리드 확정 403→빈 섹션 409), 설립 모드(ADR-0167), S10 M&A 필드(greenfield 숨김+서버 거부), PMI 킥오프(sub-track 인지+에이전트 금지), S11 완료 술어가 트랙별로 정확히 분기.
5. **S9 brownfield 도메인(CoC·보상)과 리스크 원장** — brownfield 전용 도구 카드, `dd|coc|inc|cov` 4소스 히트맵·append-only 원장이 양 트랙 공통으로 동작.
6. **양 트랙 데모가 스크립트 수준에선 구조 완결** — brownfield S1–S12 전 구간+7게이트 GO, greenfield 트윈도 설립 5단계·게이트 집합까지 스크립트에 존재(문제는 라이브 DB 미갱신 — H2).

## Domain Summary

- **트랙 모델(A)**: 구조 결함 없음. 스펙·엔진·절차의 문서/어휘 일관성 과제(M1~M3, L1~L4).
- **greenfield(B)**: 술어·가드 체계가 가장 단단한 구간. S5 API 가드(M4)와 데모 미충족(H2 일부).
- **brownfield(C)**: S12 스코어카드 모순(C1)이 유일한 구조 결함. S9/S10/S11 brownfield 면은 구현 완료, 데모 데이터만 공백.
- **캐리어·네비게이션(D)**: brownfield pre_fs 딥링크(H1)와 프로젝트-id 해석 공백(M7)이 사용자 도달성 문제. 라벨 이중화(M6).

## Action wiring (Step 5 — 2026-10-22 티켓 생성 완료: 워크스페이스 루트 거버넌스 백로그 T-20261022-001~019)

| Route | 항목 | 티켓 |
|---|---|---|
| Fix now (권고, 설계 게이트 후) | C1 — S12 스코어카드 조건·적용성·쓰기 경로 정렬 (decider 옵션 a/b) | **T-20261022-001** (urgent) |
| Fix now (1주) | H1 — brownfield pre_fs 결정면/딥링크 | **T-20261022-002** (high) |
| validator-hardening | H2 — 양 트랙 데모 시드 갱신 + S1→S12 술어 충족 e2e (API-only writes) | **T-20261022-003** (high) |
| Fix now (2주, 소규모) | M4 — S5 API 트랙 가드 | **T-20261022-007** (normal) |
| Fix now (2주, 소규모) | M7 — S1–S7 분기 캐리어 해석 | **T-20261022-010** (normal) |
| validator-hardening | M8 — IC 순서 서버 강제 + 라우트 테스트 | **T-20261022-011** (normal) |
| Fix now (소규모 묶음) | M2 스펙 문구 / L1 v2.10.0 주석 / L2 승격 제목 / L5 import 가드 / L7 트랙 하드코딩 | **T-20261022-005** · **T-20261022-012** · **T-20261022-013** · **T-20261022-016** · **T-20261022-018** (normal/low) |
| Decider 결정 필요 | M1 target_screening 검토 런타임 | **T-20261022-004** (normal) |
| Decider 결정 필요 | M3 financing 공동검토 기계화 | **T-20261022-006** (normal) |
| Decider 결정 필요 | M5 M&A 지급 조건 면 | **T-20261022-008** (normal) |
| Decider 결정 필요 | M6 라벨 단일화 | **T-20261022-009** (normal) |
| Low / Improvements | L3 carrierScopeFinished / L4 ADR 정정 / L6 대상 비교 도구 카운트 / L8 레일 sourceOppId | **T-20261022-014** · **T-20261022-015** · **T-20261022-017** · **T-20261022-019** (low) |

## Verification

이번 세션은 분석 전용(파일 수정 없음). C1·H1 수정 후 `bun scripts/audit.ts` + `bun run test:unit` 재실행으로 마감할 것.
