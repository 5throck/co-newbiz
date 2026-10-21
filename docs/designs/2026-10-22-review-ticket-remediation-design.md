---
lang: ko
lang_reason: source-material
---

# S1–S12 트랙 리뷰 파생 결함 20건 일괄 시정 — 워크스페이스 거버넌스 티켓 T-20261022-001~021 (Implemented)

- **일자**: 2026-10-22
- **상태**: Implemented (2026-10-21 프로젝트 리뷰 `docs/reports/2026-10-21-project-review-s1-s12-tracks.md`와 in-app 브라우저 결함에서 파생된 워크스페이스 거버넌스 티켓 20건의 일괄 처리)
- **원 질의**: decider — "티켓을 모두 처리해줘" (워크스페이스 `list --ready --kind manual`의 잔여 전량)
- **관련**: ADR-0053(경계 #2), ADR-0074, ADR-0076, ADR-0150, ADR-0151, ADR-0153, ADR-0157, `process/flow.spec.yaml`, `procedures/_shared/entity-ic-review`, `lib/process-flow.ts`, `lib/gate-sequence-view.ts`

## 1. 결정

| # | 티켓 | 결정 |
|---|---|---|
| 1 | 001 (Critical) | S12 벤처 스코어카드 요구는 **greenfield에만** 요구된다(`resolveTrack` 기준 — 유일한 승인된 쓰기 경로 `POST post-management/scorecard`가 greenfield-only이고, brownfield의 applicability는 "권장(차단하지 않음)"). greenfield의 미달/지연 사이클은 기존과 동일하게 차단(약화 없음, 테스트 고정). 전환-결정 요구(ADR-0150 2~6)는 트랙 무관 유지. |
| 2 | 002 (High) | brownfield `pre_fs` HOLD 딥링크 → **S4 위원회 탭**으로 라우팅(`gateStageTab(gate, track)` — track-aware 해소; greenfield/unknown은 기존 s5). flow.spec이 pre_fs 판정 기록을 S6에 배정하지 않으므로 최소 라우팅 수정. `lib/gate-aging.ts`가 HOLD 행별 track을 해소해 파이프라인과 `lib/deal-overview.ts` href까지 동일 적용. |
| 3 | 003 (High) | 양 트랙 데모 시드가 S1–S12 술어를 전부 충족하도록 보강 — greenfield: 서비스 함수 경로(`recordBaselineEntries`+`confirmExecutionBaseline`, `recordGreenfieldScorecardFromRequest`)로 **확정 실행 기준선**(부재 격차)·스코어카드·`establishment_mode='new_entity'` 보강, CLI가 양 트랙 모두 시딩. e2e `tests/unit/s1-s12-demo-e2e.test.ts`가 스크래치 SQLite에서 양 트랙 S1→S12 전 구간 술어를 걷는다. 실 dev DB 재시딩은 운영자 단계(아래 §4). |
| 4 | 004 (M1) | **ADR-0153 배제 문서화** — target_screening을 3단계 리뷰 런타임에 넣는 것은 AI-1st/2nd/human-final 스냅샷+LLM 지출을 유발하는 신규 롤아웃이라 사소한 추가가 아님. ADR-0153 부록으로 배제의 결정-of-record화 + `gate-artifacts.ts`의 `REVIEW_GATES` 블록에 사유 주석(주석만). |
| 5 | 005 (M2) | flow.spec S4 완료 기준 문구를 "track 필수; brownfield는 Route 유형(sub_track) 필수, greenfield의 sub_track은 선택"으로 시정(엔진·라우트와 일치). 파생 프로젝션(`docs/process-flow.md`, `mcp/co-newbiz/stage-guides.generated.ts`) 재생성. |
| 6 | 006 (M3) | **flow.spec 주장 완화** — 절차 스키마는 단일 `agent_key`만 지원(공동-검토 키/소비자 부재, `_validate.ts`는 무결성만 검사). 기계화는 미사용 키라는 임기응변이 되므로, 3.1 정의가 공동-검토를 기록한다는 절차-정의 계약임을 명시하는 쪽으로 시정. |
| 7 | 007 (M4) | `POST /api/greenfield/[oppId]`가 현재 route_decision을 읽어 **brownfield 캐리어에 409 `not_applicable_track`**(S11/S12 가드와 동일 코드 모양). route_decision 부재 기회는 기존 스위트 호환을 위해 쓰기 가능 유지. |
| 8 | 008 (M5) | **`venture_transition_decision.tranche_condition`을 brownfield 지불조건의 공식 캐리어로 문서화** — ADR-0151 부록(컬럼 소유자이자 S12 fail-closed 술어가 이미 이를 강제), 한계(초안은 S10 노트, 강제는 S12) 기록. 신규 UI 없음. |
| 9 | 009 (M6) | 게이트 라벨 단일화 — `lib/stage-meta.ts`가 `lib/labels.ts`(글로시ary 한국어 SSOT)의 `GATE_LABEL`을 키 참조로 소비(값 복제 없음). `transition` 의사-게이트는 flow.spec 게이트 어휘에 유입되지 않게 배제. 영어 고정 테스트 갱신 + 신규 `stage-meta.test.ts`. |
| 10 | 010 (M7) | `CarrierStageBody`가 `resolveDealCarrier`로 한 번 해소해 S2/S4/S5/S6/S7 본문에 source opportunity id 전달(S3/S8–S12와 동일 패턴). source 부재 프로젝트는 정직한 빈 상태. |
| 11 | 011 (M8) | IC 순서 잠금을 **서버 측으로** — 순수 `gateSequenceBlocker` 헬퍼로 추출(패널 뷰가 위임)하고 게이트 결정 라우트의 GO 분기에서 entity_ic GO 선행 없는 group_ic GO를 `409 gate_prerequisites_incomplete`으로 거부. HOLD는 순서 구속 없음. 신규 라우트 테스트 + 기존 뷰 테스트 유지. |
| 12 | 012 (L1) | flow.spec 헤더에 v2.10.0 어노테이션 추가(S9 `capability-dd` 활동 — commit 6561bf6c 기준). `meta.version` 불변. |
| 13 | 013 (L2) | 승진 패널 헤딩을 `promotionHandoffLabel(track)`(finalStageOf 래퍼: greenfield "S5 → S8")로 도출 — `PromotionPanel.tsx` 양 렌더 사이트 + `app/opportunities/[id]`가 `headingName` prop으로 전달. 순수 헬퍼 테스트 신설. |
| 14 | 014 (L3) | `ProcessEvaluation`에 필수 `carrierScopeFinished: boolean` 추가(기회·track 확정·`projectId===null`·≤7 전 단계 완료/생략). `pipeline.ts` 승진 규칙과 `PromotionPanel` ready가 특수-케이스 대신 마커를 소비(명시적 `project_id===null` 프로브는 경쟁 가드로 유지). |
| 15 | 015 (L4) | ADR-0074 결정 3·ADR-0076 결정 2에 **Errata (2026-10-22)** 부록(이력 미수정) — 게이트 결정의 사람-기록 사실과 ADR-0053 경계 #2 지시. |
| 16 | 016 (L5) | milestones `import-baseline` 라우트에 `resolveTrack` 가드 — greenfield 아님(미해소/충돌 포함, `baseline-variance` 선례) → `409 not_applicable_track`. 라우트 테스트(재분류 회귀 포함). |
| 17 | 017 (L6) | **의도된 동작으로 확정·문서화** — 카운트되는 도구는 전부 프로젝트-스코프(target 축 없음, ADR-0157 migration 0132 범위)라 per-target 카운트는 동일 값 반복이고 ADR-0157의 "비교 근거는 요약 아님" 원칙과 충돌. 라우트 doc 주석으로 기록(동작 불변). |
| 18 | 018 (L7) | S5/S6/S7 `StageFrame`/`TrackGate`에 하드코딩 track prop 대신 캐리어의 실제 트랙을 전달(null이면 기존 `useCarrierTrack` 폴백) — 레일과 안내가 캐리어 트랙과 일치. |
| 19 | 019 (L8) | StageTabs의 `useSourceOpportunity`를 `StageFrame`으로 끌어올려(시그니처 `string \| undefined` 확대) S1–S7 링크가 `/deals/{sourceOppId}/sN`을 가리킴 — 미해소 시 기존 플랫 스텁 폴백(회귀 없음). |
| 20 | 020 (High, 보안) | 로그인 폼 선-하이드레이션 네이티브 제출이 GET으로 자격증명을 URL에 노출 — `<form method="post" action="/api/auth/login">`(네이티브 제출은 POST → 라우트가 JSON-only라 400 거부, 쿼리 노출 없음) + 제출 버튼 `disabled={busy \|\| !hydrated}`. 하이드레이션 플로우 불변. 회귀 테스트(마크업 + 라우트 400/405/200). |

## 2. 교차 조정 (클러스터 통합 시점)

- **wave-f6-predicates 재조정**: 001의 새 규칙에 맞춰 "stale scorecard reopens"를 greenfield 변형으로 이동(재개 단정)하고 brownfield는 "stale 사이클도 재개하지 않음"(S12 자체가 블로커 없이 완료 → currentStage null)을 문서화. `run()` 헬퍼에 run/industry/company id 파라미터화(gf FK).
- **`promotion-heading.test.ts` TS6142**: .tsx 정적 임포트를 계산된 지정자 동적 임포트로 전환(타입-베이스라인 드리프트 소거; `bun scripts/typecheck-baseline.ts` OK — 89 베이스라인, 신규 0).
- **`app/deals/[id]/[stage]/page.tsx` ProcessView**: `resolveDealCarrier`의 `CarrierProcess` 계약에 맞춰 `opportunity?: { id: string } \| null` 추가(형제 `app/deals/[id]/page.tsx`와 동일 모양).

## 3. 검증

- `bunx tsc -p tsconfig.core.json --noEmit` — clean. `app/web-next` `tsc -p tsconfig.json --noEmit` — 0 errors. `bun scripts/typecheck-baseline.ts` — OK (신규 0).
- `bun test tests/unit` 전체 — 3,941 pass / 2 fail(네트워크 프로브 순서 의존 플레이크, `web-research-diagnostics.test.ts` 소속 — 단독 실행 17/0으로 회복 확인, 본 배치 무관).
- 신규/확장 테스트: `stage-meta`, `gate-aging-track`, `deal-stage-carrier`, `promotion-heading`, `greenfield-route-track-guard`, `milestones-import-baseline-track`, `gate-decisions-ic-sequence`, `login-form-hardening`, `s1-s12-demo-e2e`, 확장 `inbox`·`gate-sequence-view`·`process-flow`·`ic-gap-rationale`·`wave-f6-predicates`.
- `bun procedures/_validate.ts` — 0 errors (26 procedures).

## 4. 운영자 단계 (이번 변경에 포함되지 않음)

- 실 dev DB 재시딩: `bun scripts/co-newbiz/seed-s1-s12-demo.ts`(양 트랙; `--db-path <path>`로 대상 지정). brownfield 데모의 `venture_scorecard` 직접 INSERT는 001 결정 하에 술어 요건은 아니지만 시나리오 의도(사람이 짝 전환-결정을 기록할 사이클 존재)를 위해 유지.
