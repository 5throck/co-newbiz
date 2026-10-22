---
lang: ko
lang_reason: source-material
---

# S1–S12 트랙 리뷰 2차 시정 — T-20261022-034~044 Fix-now 배치 (Implemented)

- **일자**: 2026-10-22
- **상태**: Implemented (2026-10-22 전체 도메인 프로젝트 리뷰 `docs/reports/2026-10-22-project-review-full.md`의 Action wiring 중 Fix-now 라우트 일괄 수행)
- **원 질의**: 사용자 — "개선을 진행해줘" (리뷰 보고서의 권고 순서대로)
- **관련**: ADR-0053(경계 #2), ADR-0074, ADR-0076, `process/flow.spec.yaml`, `app/web-next/lib/process-flow.ts`, `lib/greenfield-execution.ts`, 전일 remediation 설계 `docs/designs/2026-10-22-review-ticket-remediation-design.md`

## 1. 결정

| # | 티켓 | 결정 |
|---|---|---|
| 1 | 034 (High, 보안) | T-020에서 확정된 하드닝 패턴(`<form method="post" action="/api/auth/...">` + 제출 버튼 `disabled={busy \|\| !hydrated}` + 하이드레이션 effect)을 `/register`·`/password-change`에 동일 적용한다. action 경로는 각 페이지가 실제 호출하는 API 라우트와 일치시키고, `login-form-hardening.test.ts`의 마크업 계약 + 라우트(폼-인코딩 네이티브 POST → 400/405, 세션 쿠키 부재, JSON 경로 200) 테스트를 두 페이지로 확장한다. |
| 2 | 035 (High) | T-001의 greenfield-only 결정을 SSOT에 반영한다. flow.spec S12 requiredArtifacts의 스코어카드 산출물과 completionCriteria의 스코어카드 기준에 `(greenfield — brownfield은 integration/partnership 모니터링, 권장·비차단)` 한정자를 붙인다(v2.4.1·v2.8.0 문구 정정 선례). 엔진 `STAGES` S12 동일 문자열 갱신 + 스펙 버전 주석 갱신 + 투영(`docs/process-flow.md`, `mcp/co-newbiz/stage-guides.generated.ts`, `spec-activities.generated.ts`) 재생성. 차단기 문자열("벤처 스코어카드가 필요합니다")은 변경 없음. |
| 3 | 036 (High, decider) | **본 배치 제외** — 트랙 리졸버 단일 소유권은 ADR-0076 기록을 수반하는 설계 결정. 사람 결정 대기. |
| 4 | 037 (High) | `skills/SKILLS.md`를 skills/ 트리 기준으로 재생성한다(중복 헤더/섹션 제거, Workspace Skills = 실제 디렉터리와 양방향 일치, 디렉터리 없는 행은 별도 Retired/Tracked-elsewhere 섹션으로 이동해 이력 보존). 재발 방지로 `scripts/co-newbiz/audit-variant.ts`(변형 감사 훅 — 표준 준수 위치)에 SKILLS.md↔skills/ 패리티 게이트를 추가한다. `layer-filter.ts`는 SKILL.md frontmatter를 직접 읽으므로 소비처 영향 없음. |
| 5 | 038 (Moderate) | T-007 가드 패턴(현재 route_decision 조회 → 반대 트랙 확정 시 `409 not_applicable_track`, 결정 부재는 기존 스위트 호환을 위해 쓰기 가능)을 미러링한다: brownfield S6/S7 쓰기 라우트(eval-criteria·targets·universe-criteria-draft·target-proposals — greenfield 확정 시 409), greenfield `investment-simulation`(동일), 프로젝트-캐리어 `capability-dd` PUT(`resolveTrack` 기반 — T-016 선례, GET은 읽기로 개방). 라우트 테스트로 고정. |
| 6 | 039 (Moderate, decider) | **본 배치 제외** — 승격 후 Short List 증가 정책(쓰기 가드 vs stale 마킹)은 제품 결정. |
| 7 | 040 (Moderate+L3) | 테스트 경질화: ① `process-flow.test.ts` 스테이지-미러 테스트가 `applicableTracks`(`toEqual`)과 게이트 집합 정확 일치(`toEqual`)를 단언 ② `s1-s12-demo-e2e.test.ts`가 양 트랙의 게이트 원장(`gateStatus`) 전체를 단언(brownfield 7게이트, greenfield 6게이트 — target_screening 부재 포함) ③ `gate-aging-track.test.ts`를 env-설정→동적 임포트 패턴으로 정렬하고 `afterAll` 임시 파일 정리 추가. |
| 8 | 041 (Moderate+Low) | UX 번들: ① brownfield `pre_fs` 딥링크가 S4 위원회 탭에 착륙하도록 `gateStageTab`/`gateHoldHref` href에 `?tab=committee`를 실어 S4 route-decision 화면이 쿼리 파라미터로 초기 탭을 설정 ② `PromotionPanel` 확인 대화상체·`StageFrame` 미승격 사유 문구를 `promotionHandoffLabel`/`finalStageOf` 유도값으로 교체(트랙 하드코딩 제거) ③ `generate-process-flow.ts` ADDENDUM의 썩은 행번호 인용을 기호 참조로 대체(부록 자체 권고 준수) + 재생성. |
| 9 | 042 (Moderate) | 데모 운영: 시드에 술어-선택형 데모 표면 행을 보강한다 — S9 도구(dd_interview·CoC·보상), PMI 모니터링(pmi_key_talent·pmi_synergy_certification), `project_milestone`(양 트랙). 멱등 유지(안정 id·INSERT OR IGNORE 또는 서비스 경로), 술어 변경 없음. 검증 후 **운영자 단계로 라이브 dev DB 재시딩을 실행**한다(전일 설계 §4의 미추적 항목 소화). |
| 10 | 043 (Moderate) | 절차 스코핑 이원화: 프로젝트-스테이지 절차 2건(`brownfield-fs-comparative`, `brownfield-dd`)에 `case_type=brownfield` `applies_when`을 기계 판독 가능하게 추가(`greenfield-execution-baseline` 스키마 선례). 기회-캐리어 절차 3건(`greenfield-capability-assessment`, `brownfield-target-identification`, `brownfield-target-screening`)은 스테이지 레벨 스코핑이 유일한 강제인 현재 어휘(case_type이 프로젝트 귀속)상 헤더에 스코핑 근거를 문서화하고, 기회-스테이지 트랙 조건자 확장은 후속 과제로 기록한다. flow.spec S11 활동에 `business-unit-establishment-execution` 자매 절차 참조 주석을 추가한다(스펙 레이어 가시화). |
| 11 | 044 (Moderate, decider) | **본 배치 제외** — brownfield internal/hybrid/joint 스코어카드 칩은 C1 옵션 (b) 착수 여부의 제품 결정. |

## 2. 실행 구성

- **PM 직접**: 035(스펙↔엔진 맞물림), 040, 041, 043의 flow.spec 주석, 투영 재생성, 전체 QA.
- **병렬 전문 디스패치**(파일 비겹침): A=034, B=038, C=037, D=043 절차 yaml, E=042 시드.
- 공통 제약: git 커밋 금지(사용자 지시 대기), 본인 꾸러미 파일만 수정, 대상 테스트 파일 개별 실행으로 자체 검증.

## 3. 검증 계획

- `bun scripts/test-runner.ts unit` 전체 + `bunx tsc -p tsconfig.core.json --noEmit` + `app/web-next tsc` + `bun scripts/audit.ts` + `bun procedures/_validate.ts` + 생성기 `--check` ×2 + `typecheck-baseline`.
- 완료 후 워크스페이스 백로그 티켓 상태 갱신(034·035·037·038·040·041·042·043 → done; 036·039·044 유지) + 리뷰 보고서·메모리 로그 갱신.

## 4. 운영자 단계 (배치 내 수행)

- 라이브 dev DB 재시딩은 042의 시드 보강이 스크래치 검증을 통과한 뒤 `bun scripts/co-newbiz/seed-s1-s12-demo.ts`(기본 경로 = 라이브 DB, 멱등)로 실행한다. 시드는 양 트랙을 모두 심고, 기존 확정 기준선을 치환하지 않는다(1.10.0의 멱등 가드 유지).

## 5. 검증 결과 (2026-10-22 실행)

- `bun scripts/test-runner.ts unit` — **326 파일 전체 통과** (1차 실행에서 `wave0-data-contract` 2건 실패 → T-038 가드가 greenfield 캐리어의 brownfield S6 쓰기를 올바르게 거부한 것으로, 픽스처를 brownfield 캐리어로 수선 후 green. 신규 결함 아님 — 가드가 잡은 낡은 테스트 계약).
- `bunx tsc -p tsconfig.core.json --noEmit` / `app/web-next tsc` — 양쪽 0 errors. `typecheck-baseline` — OK(89 베이스라인, 신규 0, 1 그룹 개선).
- `bun scripts/audit.ts` — **전체 통과**, 신규 `SKILLS.md registry parity` 게이트 green(105 rows == 105 dirs, 45 retired). `bun procedures/_validate.ts` — 0 errors.
- 생성기 `--check` ×2 clean, `library.generated.ts` 재동기화(043의 schema 변경 반영), `docs/VERSION_MANIFEST.md` 재생성(감사-변형 1.1.0·시드 1.11.0 반영; drift 경고 1건은 기존 `README_ko` 정보성 항목).
- 워크스페이스 티켓: 034·035·037·038·040·041·042·043 → `done`(result 기록). 036·039·044는 decider 결정 대기로 backlog 유지.
- 운영자 단계 실행: 라이브 dev DB 재시딩 완료 — s11_pmi_kickoff 0→1, venture_transition_decision 0→2, project_milestone 0→6, dd 도구·PMI 모니터링 표면 0→각 2~4행, demo-gf 프로젝트 생성. read-only sqlite 검증으로 확인.

## 6. Decider 후속 결정 (2026-10-22, 후속 세션 — 036·039·044)

사용자 지시("잔여 작업을 진행해 줘")로 §1에서 제외했던 decider 3건을 PM 권한(ADR 승인) 내에서 결정·구현한다.

| # | 티켓 | 결정 |
|---|---|---|
| 1 | 036 (H3) | **`resolveTrack`(라이브 리졸버)이 승격 후 트랙 의미론의 단일 소유자다.** 엔진의 4개 스냅샷 읽기(프로젝트 분기 `track`, S8 subjectScope 분기, S11 PMI 요구, `selectTarget`)를 전부 리졸버 경유로 전환했다. case_type↔route 충돌/미해소는 null(fail-closed)이며 기존 S11 `classification_conflict` 블로커가 그 모호성을 표면화한다. `md_project.track`은 승격 시점 표시 스냅샷으로 강등 — 리졸버의 최후 폴백과 레거시 표시에만 쓰인다. ADR-0076 Addendum (2026-10-22, a)로 기록. |
| 2 | 039 (M2) | **승격 후 Short List 프리즈(쓰기 가드)** — S6/S7 Short List는 S8 subjectScope 집합(ADR-0143)이므로, `opportunity.project_id`가 설정된 뒤 대상 등록·shortlist 승격을 `409 already_promoted`로 거부한다(`promotedCarrierResponse` 공용 헬퍼). 승격 후 확장은 기존 Short List 구성원에 대한 ADR-0157 대상별 DD 경로(이미 산재)로 수행한다. stale 마킹 대안은 채택하지 않음 — 가드가 원천 차단하는 것이 재개 의미론을 오염시키지 않는다. |
| 3 | 044 (M9) | **옵션 (a) 채택 — 권장의 운반체를 절차로 명시.** brownfield internal/hybrid/joint의 `portfolio_venture_monitoring` 권장은 앱 밖 `portfolio-venture-monitoring` 절차 수행으로 충족되며, S12 칩은 "권장 (차단하지 않음 — 기록은 절차 수행, 앱 기록 화면 없음)"으로 정직 표시한다(greenfield는 기존 "권장 (차단하지 않음)" 유지). JV/브라운필드 스코어카드 기록 경로 신설(옵션 b)은 미예정 future work로 ADR-0161 Addendum (2026-10-22, b)에 기록. |
