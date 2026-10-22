---
lang: ko
lang_reason: source-material
---

# Project Review — co-newbiz 전체 도메인 (S1–S12 트랙 정합성 + T-20261022-001~021 remediation 검증) — 2026-10-22

- **Date**: 2026-10-22
- **Scope**: co-newbiz (variant) — 전체 도메인 4슬롯 PM 주관(사용자 지시). 공통 렌즈: S1–S12 전 프로세스의 greenfield/brownfield 트랙 구현 정합성 + 전일 리뷰(`2026-10-21-project-review-s1-s12-tracks.md`) 파생 티켓 T-20261022-001~021 remediation(커밋 ebbac854)의 독립 검증
- **Method**: 머신 배터리(변형 프로젝트 기준 `bun scripts/audit.ts` + 전체 단위 테스트 + `procedures/_validate.ts` + 생성기 `--check`) + 읽기 전용 리뷰 에이전트 4슬롯 병렬(A: Architecture+Scaffolding / B: Standards+Lifecycle / C: Automation / D: Documentation+Security) + PM 직접 재검증(SKILLS.md)
- **Analysis only — 이 보고서 작성 외 파일 수정 없음.** 조치 위임은 Action wiring 참조.

## Baseline (Step 0)

| 검증 | 결과 |
|---|---|
| `bun scripts/audit.ts` | ✅ 전체 통과 — WARN 5(셸 패턴 1차 휴리스틱), SKIP 1(design-lint 스캔 루트 부재), ERROR 0 |
| `bun scripts/test-runner.ts unit` | ✅ 전체 통과 (exit 0, 45.2s) — 전일 설계 문서 §3이 지적한 `web-research-diagnostics` 순서 의존 플레이크도 본 실행은 green |
| `bun procedures/_validate.ts` | ✅ 26 procedures, 0 errors (WARN 76 — 공지된 warn-class: skill-lint 게이트 키워드, 선언-비활성 kill criteria) |
| 생성기 드리프트 (`generate-process-flow.ts --check` · `generate-spec-activities.ts --check`) | ✅ clean — CI 드리프트 게이트로도 연결됨 |
| 워크스페이스 거버넌스 백로그 | T-20261022-001~021 전량 `[done]` |

## Remediation 검증 요약 (T-20261022-001~021)

**20/20 착지 확인.** 엔진 술어·쓰기 경로 가드·테스트 고정·ADR 부록/에라타·레지스트리·CHANGELOG 전 계층에서 설계 문서 §1의 결정대로 구현되었음을 4슬롯이 독립 검증(주요 지점: T-001 엔진 `process-flow.ts:750-761` + 4시나리오 테스트, T-002 `gateStageTab(gate, track)` 3표면 통과 + 잔여 s5 참조 전수 감사, T-003 시드 서비스-경로·양트랙 e2e, T-007/016 409 가드 + 라우트 테스트, T-011 순수 헬퍼 + GO 분기 409, T-020 로그인 하드닝, 문서 5건 T-004/005/006/012/015 전부 비파괴 부록). 유일한 예외: **T-001의 결정이 SSOT 계층에 반영되지 않음** (아래 H2).

## Review Results

### 🔴 Critical (즉시 수정 권고)

없음.

### 🟡 High (1주 내)

| # | Issue | Agent | File:Line | Class | Fix |
|---|-------|-------|-----------|-------|-----|
| H1 | **/register·/password-change가 T-020과 동일한 자격증명 URL 노출 결함군에 잔존** — 하이드레이션 전 네이티브 제출이 기본 GET으로 userId·비밀번호를 URL 쿼리에 노출(라우트는 JSON-only라 요청은 실패하지만 노출이 이미 발생). `/login`만 ebbac854에서 시정됨(`method=post action` + `disabled={busy \|\| !hydrated}`); 두 페이지는 `disabled={busy}`뿐이고 method/action 부재 | D | `app/web-next/app/register/page.tsx:59,76` · `app/web-next/app/password-change/page.tsx:47,64` | one-time | 로그인 패턴 복제(또는 공용 컴포넌트 추출) + `login-form-hardening.test.ts`를 두 페이지로 확장 |
| H2 | **T-001의 greenfield-only 결정이 SSOT에 미반영 — 스펙↔엔진 드리프트** — 엔진은 `resolveTrack(project.id).track === "greenfield"`일 때만 스코어카드를 요구하도록 고쳤으나 `flow.spec.yaml` S12는 여전히 `벤처 스코어카드`를 무수식어 필수 산출물로, "리뷰 주기별로 스코어카드 검토"를 completionCriteria로 양 트랙에 요구. 엔진 `STAGES` S12 문자열·재생성 문서(`docs/process-flow.md`·stage-guides)·패리티 테스트도 무수식어를 강제. "spec이 SSOT"인 이 저장소 교리상 향후 정합 감사가 엔진을 비준수로 읽거나 C1을 되살리는 위험 | A | `process/flow.spec.yaml:809-823` · `app/web-next/lib/process-flow.ts:51,750-761` · `tests/unit/process-flow.test.ts:218` | one-time | S12 산출물/기준에 `(greenfield)` 한정자 + 버전 주석 + 투영 재생성 + 엔진 `STAGES` 문자열 동일 변경. T-001 설계 행에 스펙 수정이 누락된 것이 근인 |
| H3 | **트랙 이중 리졸버** — `md_project.track`(승격 시점 스냅샷; S8 subjectScope 분기·S11 PMI 킥오프·`selectTarget`이 소비, `process-flow.ts:980`)과 `resolveTrack`(라이브 case_type 우선; S11 실행 기준선·S12 스코어카드·쓰기 가드가 소비)이 공존. 승격 후 S4 재결정이 기계적으로 도달 가능한데 `classification.repository.ts`는 `md_project.track`을 갱신하지 않아, 재분류 시 엔진이 양 트랙을 동시에 믿음(brownfield→greenfield 전환 시 S8은 stale 스냅샷으로 대상별 술어를, S11/S12는 라이브로 greenfield를 적용) | A | `app/web-next/lib/process-flow.ts:980` vs `lib/project-track.ts:25-40` · `db/repositories/classification.repository.ts:174-187` | systemic | 단일 리졸버 통합(`resolveTrack` 전면 채택 + 기존 classification_conflict 블로커) 또는 스냅샷 원자 갱신 — 어느 쪽이든 ADR-0076에 소유권 기록 |
| H4 | **`skills/SKILLS.md` 레지스트리 부패 (기존 결함)** — 파일 전면 2배 중복(헤더·`## Registry`·`### Workspace Skills`·표 헤더), 디렉터리가 존재하지 않는 스킬 45행(`access-control-review` 등), `## Registry` 밖 고아 행(k-krx·k-ecos), Variant-Exclusive 섹션 뒤 작업공간 스킬 3행. 기계 검증(`audit.ts`)은 `VERSION_MANIFEST.md`↔`skills/`만 보고 SKILLS.md는 검사하지 않음 — PM이 직접 재검증으로 확인 | B + PM | `skills/SKILLS.md:19-28` 외 | script-gap | SKILLS.md 재생성(트리 기준) + 감사에 SKILLS.md↔skills/ 패리티 게이트 추가 |

### 🟢 Moderate (2주 내)

| # | Issue | Agent | File:Line | Class |
|---|-------|-------|-----------|-------|
| M1 | 서버 트랙 가드 미러링 누락(통합): `capability-dd` PUT, brownfield `eval-criteria`/`targets`/`universe-criteria-draft`/`target-proposals`, greenfield `investment-simulation`이 오프-트랙 쓰기를 허용 — 게이트 영향 없음(해당 스테이지가 스킵되므로 데이터 불활성)이나 T-007이 코드에 새긴 "서버는 클라이언트를 믿지 않는다" 패턴과 불일치 | A+D | `app/web-next/app/api/projects/[id]/capability-dd/route.ts` · `app/api/brownfield/[oppId]/*` · `app/api/greenfield/[oppId]/investment-simulation/route.ts:42-60` | systemic |
| M2 | 승격 후 Short List 증가(신규 대상 추가·shortlist 승격)가 S8을 조용히 current로 되감기고 S9–S12를 잠그는데, fs/dd GO 행은 유효한 채로 stale 마킹 없음(재선정 경로의 `gate_decision_stale` 패턴과 불일치). fail-closed라 정직하나 무한·비표시 | A | `app/web-next/lib/process-flow.ts:488-499` · `app/api/brownfield/[oppId]/targets/route.ts:72-89` | systemic(설계 결정) |
| M3 | brownfield `pre_fs` 딥링크가 S4 페이지 기본 탭(`competitive`)에 착륙 — 실제 결정 면은 3번째 "위원회 심의" 탭인데 탭 상태가 `useState`뿐(?tab= 미지원) | A | `components/stages/route-decision/RouteDecisionStage.tsx:108-115` · `useRouteDecision.ts:22` | one-time |
| M4 | `stage-meta.ts`의 `applicableTracks`·정확한 gate 집합이 스펙 미러 테스트에 미고정(존재성 `toContain`만; 여분 게이트·트랙 드리프트를 못 잡음) — `findNextGate`가 이 값을 소비해 load-bearing | A | `tests/unit/process-flow.test.ts:180-198` | script-gap |
| M5 | 라이브 dev DB 재시딩 미실행(remediation 설계 §4 운영자 단계를 추적하는 장치 없음; 실측 0행: s11_pmi_kickoff·venture_transition_decision·project_milestone, demo-gf 부재) + 시드가 S9 도구·PMI 모니터링·project_milestone 행은 fresh DB에도 미포함(술어는 선택라 e2e는 통과, 데모 표면은 공백) | C | `db/data/co-newbiz.sqlite` · `scripts/co-newbiz/seed-s1-s12-demo.ts` | one-time + script-gap |
| M6 | s1-s12 e2e가 7-게이트 원장(`ev.gateStatus`)을 명시 단언하지 않음 — 게이트 픽스처 행을 지워도 테스트가 깨지지 않음(entity_ic/group_ic만 S11 술어로 간접 필수) | C | `tests/unit/s1-s12-demo-e2e.test.ts` | script-gap |
| M7 | S5–S9 트랙 전용 절차에 `applies_when` 부재 — greenfield-capability-assessment, brownfield-target-identification/screening, brownfield-fs-comparative, brownfield-dd가 주석·스테이지 레벨 스코핑뿐(라이브 불일치 없음 — 스테이지 자체가 트랙 스코프돼 통째 스킵). S11/S12에 대해 flow.spec이 스스로 선언한 "절차 applies_when이 강제" 교리보다 약함 | B | `procedures/_shared/greenfield-capability-assessment/schema.yaml` 외 4건 | systemic |
| M8 | `business-unit-establishment-execution`(ADR-0167 자매 절차, 조건 스코핑은 정확)이 스펙 레이어에 비가시 — S11 활동이 참조하지 않고 투영에도 없는데 S11 산출물은 사업부 신설 실행을 약속 | B | `process/flow.spec.yaml:735-738` | one-time |
| M9 | brownfield internal/hybrid/joint에 `portfolio_venture_monitoring` "권장(차단하지 않음)" 칩이 표시되지만 제공 쓰기 경로(POST 스코어카드)가 409 — 전일 C1 삼각형의 잔여 절반(remediation 설계가 비차단으로 수용) | A | `app/web-next/lib/greenfield-execution.ts:662-671,867-869` | systemic(decider) |

### ℹ️ Low / Improvements

| # | Issue | Agent | File:Line | Class |
|---|-------|-------|-----------|-------|
| L1 | 트랙 하드코딩 문구 잔존 — PromotionPanel 확인 대화상체 "S7에서 종결됩니다"(greenfield 실제는 S5→S8, 바로 위 제목은 이미 유도값), StageFrame 미승격 사유 "S7 선정 후 승격"(S7은 brownfield 전용 사건) | A | `components/PromotionPanel.tsx:191` · `components/StageFrame.tsx:44` | one-time |
| L2 | `useSourceOpportunity` 훅(모듈 캐시·인플라이트 취소·`.catch` 폴백 포함)이 소스 문자열 계약 테스트만으로 커버 — 캐시/취소/실패 경로 무커버 | C | `app/web-next/components/StageFrame.tsx:75-92` · `tests/unit/deal-stage-carrier.test.ts:41-50` | systemic |
| L3 | `gate-aging-track.test.ts`가 `db/client.ts` 정적 임포트 후 `beforeAll`에서 env 할당(no-op) + `afterAll` 정리 부재(잔여 sqlite) — e2e/IC-sequence 테스트의 올바른 패턴(env→동적 임포트)으로 통일 필요 | C | `tests/unit/gate-aging-track.test.ts:10,22` | one-time |
| L4 | 재생성 부록의 썩은 행번호 인용 — `generate-process-flow.ts` ADDENDUM이 `process-flow.ts:330/:353`을 인용하나 실제는 `:877/:903`(재생성이 낡은 숫자를 그대로 흘림, 부록 스스로 "행번호는 썩는다"고 경고) | D | `scripts/co-newbiz/generate-process-flow.ts:132,140` | one-time |
| L5 | remediation 설계 문서 §3의 검증 경로(단일 프로세스 `bun test tests/unit`)가 CI 경로(`test-runner.ts` 파일별 프로세스)와 달라 플레이크 재현 시 혼동 가능 — 경로 차이를 문서에 명시 권고 | C | `docs/designs/2026-10-22-review-ticket-remediation-design.md:47` | one-time |

### ✅ Strengths (교차 검증된 강점)

1. **트랙 분기 파리티는 엔진 레벨에서 정확·엄격 고정** — 스펙↔`STAGES`가 `toEqual`(존재성 아님)로 비교되고, 양 트랙 스킵 집합이 scratch SQLite e2e로 행동 수준에서 고정(brownfield S5 skipped / greenfield S6·S7 skipped), 게이트 소유·캐리어 경계(기회 3 게이트/프로젝트 4 게이트)·승격 사전조건(greenfield S5 FACTS / brownfield S7 Short List)까지 단일 경로로 일치.
2. **T-001·T-002가 구조적으로 올바르게 시정됨** — 스코어카드 요구가 쓰기 경로와 동일 리졸버를 쓰고 greenfield 차단·stale 재오픈은 약화 없음(4시나리오 테스트); 딥링크가 `gateStageTab`/`gateHoldHref` 단일 헬퍼로 수렴해 해당 결함군이 앞으로 한 곳에서만 살 수 있음.
3. **T-011이 전형적으로 착지** — 순서 규칙이 순수 헬퍼로 추출되어 뷰와 쓰기 경로가 공유, GO 분기 409 + 라우트 테스트.
4. **절차·참조 무결성 완벽** — 26 절차 0 에러, flow.spec 전 활동의 에이전트 19·스킬 ~47·절차 24 참조에 부재 0; S11/S12 실행 계층의 applies_when(절차·스텝·서브트랙·is_null fail-closed)은 교리대로 정밀.
5. **ADR 부록 4건이 전부 비파괴·정확** — git diff가 순수 추가임을 확인; ADR-0153 부록이 수용된 결과(brownfield 유일 전용 게이트의 human_final 스냅샷 부재)까지 정직하게 기록.
6. **보안 경계 유지** — 대상 트랙 쓰기 가드 전면에서 404/409/403 fail-closed, IDOR 스팟체크 무결, 시크릿 유입 없음(전 diff 스캔), 사람-기록자 경계(#2)가 모든 시정 쓰기 경로에서 유지.

## Domain Summary

- **Architecture(A)**: 트랙 분기·승격·게이트 구조는 건전. 결함은 SSOT 미반영(H2)과 이중 리졸버(H3)라는 '소유권' 계층에 집중.
- **Standards(B)**: 절차·참조 무결성 완벽, 티켓 문서 시정 5건 전부 착지. 유일 구조 결함은 SKILLS.md 레지스트리(H4, 기존).
- **Automation(C)**: 테스트가 행동을 고정(5항목 전부 PASS). 잔여는 커버리지 정밀화(원장 단언·미러 테스트)와 데모 ops(M5)뿐.
- **Documentation+Security(D)**: 문서 패리티·언어 정책·시크릿 무결. 그러나 T-020 결함군이 /register·/password-change에 잔존(H1) — 이번 배치의 최우선 수정 후보.

## Action wiring (Step 5 — 2026-10-22 워크스페이스 거버넌스 백로그 티켓 생성, 전일 보고서 선례 방식)

| Route | 항목 | 티켓 |
|---|---|---|
| Fix now (1주, 패턴 확정) | H1 — /register·/password-change 하드닝 | **T-20261022-034** (high) |
| Fix now (1주, 스펙 수정+재생성) | H2 — flow.spec S12 greenfield-only 한정자 | **T-20261022-035** (high) |
| Decider(ADR-0076 기록) | H3 — 트랙 리졸버 단일 소유권 | **T-20261022-036** (normal) |
| validator-hardening | H4 — SKILLS.md 재생성 + 패리티 게이트 | **T-20261022-037** (normal) |
| Fix now (소규모 묶음) | M1 — 잔여 쓰기 API 트랙 가드 미러링 | **T-20261022-038** (normal) |
| Decider | M2 — 승격 후 Short List 증가 정책(가드 vs stale 마킹) | **T-20261022-039** (normal) |
| validator-hardening | M4+M6 — stage-meta 미러 고정 + e2e 7-게이트 원장 단언 | **T-20261022-040** (normal) |
| 소규모 묶음 | M3+L1+L4 — 위원회 탭 앵커·트랙 중립 문구·행번호 탈착 | **T-20261022-041** (low) |
| 운영자 단계 | M5 — 라이브 DB 재시딩 + 시드 행 확장 | **T-20261022-042** (low) |
| Fix now (문서/스키마 소규모) | M7+M8 — S5–S9 applies_when + 자매 절차 가시화 | **T-20261022-043** (low) |
| Decider | M9 — brownfield internal/hybrid/joint 스코어카드 칩 | **T-20261022-044** (normal) |
| 보고서 기록만 | L2(useSourceOpportunity 커버)·L3(테스트 env 순서)·L5(설계 문서 경로 주석) — 차기 티켓 일괄 처리 시 함께 처리 권고 | (티켓 미발급) |

## Verification

본 세션은 분석 전용(보고서·티켓·메모리 로그 외 코드 수정 없음). H1·H2 수정 시 `bun scripts/audit.ts` + `bun run test:unit` + 생성기 `--check` 재실행으로 마감할 것. H2는 스펙 버전 주석 갱신과 투영 재생성(`docs/process-flow.md`·`mcp/co-newbiz/stage-guides.generated.ts`)을 동반해야 한다.

## Remediation 2차 — Fix-now 배치 시정 완료 (2026-10-22, 같은 날 후속 세션)

사용자 지시("개선을 진행해줘")로 Fix-now 라우트 전체를 실행했다. 설계: `docs/designs/2026-10-22-review-followup-hardening-design.md`(Design Gate 등록 완료).

| 티켓 | 결과 |
|---|---|
| T-20261022-034 (H1 보안) | ✅ /register·/password-change에 T-020 패턴 적용 + 테스트 확장(19 pass) |
| T-20261022-035 (H2 SSOT) | ✅ flow.spec **v2.10.1** — S12 스코어카드 산출물·기준에 greenfield 한정자, 엔진 STAGES 동일 변경, 투영 3종 재생성, 패리티 green |
| T-20261022-037 (H4) | ✅ SKILLS.md 재생성(105 workspace == 105 디렉터리, 45 retired 보존) + `audit-variant.ts` v1.1.0에 패리티 게이트(래칫) |
| T-20261022-038 (M1) | ✅ 공용 `trackConflictResponse` 헬퍼 + 6개 쓰기 표면 409 가드 + 13건 라우트 테스트. 전체 배터리에서 wave0 픽스처 2건이 가드에 걸린 것은 **낡은 테스트 계약**(greenfield 캐리어의 brownfield S6 쓰기)이라 픽스처를 brownfield 캐리어로 수선 |
| T-20261022-040 (M4+M6+L3) | ✅ stage-meta 미러 `toEqual` 고정, e2e 캐리어별 게이트 원장 단언(기회 3+프로젝트 4 = 7게이트 전부), gate-aging 테스트 env-순서·정리 수선 |
| T-20261022-041 (M3+L1+L4) | ✅ brownfield pre_fs href `?tab=committee` + S4 탭 파라미터 배선, PromotionPanel·StageFrame 문구 트랙 유도, 생성기 ADDENDUM 행번호 탈착 + S12 술어 행 v2.10.1 정렬 |
| T-20261022-042 (M5) | ✅ 시드 v1.11.0(S9 도구·PMI 모니터링·project_milestone 양 트랙) + **라이브 dev DB 재시딩 실행·검증**(전일 설계 §4 미추적 항목 소화) |
| T-20261022-043 (M7+M8) | ✅ brownfield-fs-comparative·brownfield-dd `case_type=brownfield` applies_when, 기회-스테이지 3절차 헤더 문서화, flow.spec S11 자매 절차 참조, 라이브러리 투영 재동기화 |
| T-20261022-036·039·044 | ✅ **decider 결정·구현 완료(같은 날 후속 세션)** — 036: `resolveTrack` 단일 소유자(엔진 4읽기 전환, ADR-0076 Addendum a, 트랙 테스트 88/88) · 039: 승격 후 Short List 프리즈 가드(`409 already_promoted`, 회귀 3건) · 044: 옵션 (a) — 권장 칩의 절차-운반체 명시(ADR-0161 Addendum b). 결정-of-record: 후속 설계 문서 §6 |

**검증**: 단위 테스트 326 파일 전체 통과 · tsc ×2 clean · typecheck-baseline OK(신규 0) · `audit.ts` 전체 통과(신규 SKILLS.md 게이트 green) · 절차 검증 0 errors · 생성기 `--check` ×2 clean. 티켓 8건 `done` 처리 완료. 3단계 검토 중 AI 1차(형식·머신 게이트)·AI 2차(교차 도메인 에이전트 구현 보고) 완료 — 사람 최종 승인은 커밋/PR 시점.
