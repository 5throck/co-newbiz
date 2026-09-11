---
lang: ko
lang_reason: source-material
---

# 단계 범위 LLM 의사결정 지원 설계 (Stage-Scoped LLM Decision Support) — 2026-09-11

> **근거**: ADR-0118, CLAUDE.md 경계 #2 개정(2026-09-11), `process/flow.spec.yaml`(단계 입력 SSOT)
> **범위**: S1~S12 인간 판단 표면에 LLM 정보 제공·추천을 표준 계약으로 제공. **최종 결정·게이트
> 기록·채택은 사람의 행위**이며, LLM 산출물은 언제나 제안(proposal)이다.
> **검증 게이트**: `bun scripts/test-runner.ts unit` · `bun scripts/audit.ts` · design-lint(app/web-next)

---

## 1. 설계 원칙

1. **단계 범위 컨텍스트 제약 (최우선 제약)** — 각 단계의 LLM 기능이 읽는 컨텍스트는
   `flow.spec.yaml`이 선언한 **해당 단계의 inputs** + **자기 단계의 현재 상태**로 한정된다.
   전수·일괄·교차 단계 덤프는 금지하며, 컨텍스트는 코드상의 **명시적 매니페스트**
   (이름 붙은 산출물 조회 목록)로만 구성한다. UI는 "이 제안이 본 산출물: …"로 매니페스트를 노출해
   검토자가 LLM의 시야를 감사할 수 있게 한다.
2. **표준 계약 단일화** — 모든 단계 LLM 기능은 아래 §3 계약(on-demand POST, 비영속,
   화이트리스트 정규화, 결정론 폴백, 감사, analyst+)을 따른다. 전송 계층(`completeOrFallback`,
   정규화기, 감사)은 공유하되, **컨텍스트 빌더는 단계·게이트별 개별 함수**다.
3. **사람 기록 불변** — LLM 제안은 결정 폼을 *채우는* 것까지이며, 게이트 기록·채택 마커·
   전환 결정을 쓰지 않는다. 기록 버튼 클릭은 항상 사람이다 (경계 #2).
4. **명시적 생성** — 자동 실행 없음. 각 표면은 눈에 띄는 생성 버튼으로 제안을 *제공*한다
   (원칙: decision surfaces should actively offer).
5. **폴백 정직성** — LLM 미구성·실패·파싱 불가 시 결정론 폴백이 응답하되, **파생 불가능한 값은
   절대 위조하지 않는다**(채점 초안 null + 사유). 출처는 항상 `llm | synthesis`로 표기.

## 2. S1~S12 커버리지 매트릭스 (구현 후)

| 단계 | 인간 판단 표면 | LLM 지원 (구현 후) | 구현 |
|---|---|---|---|
| S1 시장분석 | 분석 생성/재실행 (시스템 산출) | LLM이 분석 자체를 생성(기존 market-sizing-pipeline) — 판단 표면 아님 | 기존 |
| S2 기회 발굴 | 매력도 0–100 입력 | 기존: 발굴·스케치·요인 / **신규: 매력도 초안(온디맨드)** | ★ 신규 |
| S3 적합성·게이트 | GateDecisionPanel(screening), 선별/제외 | 기존: 시너지·적합성 LLM 분석 / **신규: 게이트 브리프** | ★ 신규 |
| S4 진출방식 결정 | 결정 폼, pre_fs 게이트 | 라우트 추천 + 게이트 브리프(pre_fs) | 기존+★ |
| S5 역량·진출전략 | 격차 행·B/P/H/I·전략, pre_fs 게이트 | **신규: 역량·전략 추천** + 게이트 브리프 | ★ 신규 |
| S6 후보 발굴 | Universe/Long List 수작업 | 위원회 심의(기존). 후보 추천은 **보류**(Tavily 근거 선행 — 환각 위험) | 보류 |
| S7 대상 스크리닝 | t-01~t-09 판정, 승격, target_screening 게이트 | **신규: 게이트 브리프** (항목별 브리프는 후속) | ★ 신규 |
| S8 사업성 분석 | 채택, fs 게이트 | 기존: BC LLM 실행자 / **신규: 채택 권고 요약 + fs 게이트 브리프** | ★ 신규 |
| S9 실사·WACC | 항목 판정, dd 게이트, WACC 확정 | 기존: DD 맞춤 제안 / **신규: dd 게이트 브리프** (WACC는 계산 확인 표면 — LLM 불가) | ★ 신규 |
| S10 투자구조 설계 | 차량·지분·수단·4축·재원 | **신규: 딜구조 추천** | ★ 신규 |
| S11 투자심사 | entity_ic·group_ic 게이트, IC 패키지 | **신규: IC 게이트 브리프** (IC 구성요소 요약 포함) | ★ 신규 |
| S12 사후 관리 | 전환 결정(5-vocab), 인증·인재 확정 | **신규: 모니터링 브리프** | ★ 신규 |

## 3. 표준 엔드포인트 계약

```
POST <stage-scoped-path>            # analyst+ 역할, 대상 존재 검증, appendAudit("llm_*", target="id:source")
req: {}                             # 컨텍스트는 서버가 flow.spec 매니페스트로 수집 (바디로 컨텍스트 주입 불가)
res: { data: { source, provider, note, manifest: string[], <stage payload> } }
```

- **정규화**: LLM JSON은 화이트리스트 클램프(트랙/라우트/어휘/1–3·0–100)를 거쳐야 하며 원문 신뢰 금지.
- **폴백**: `completeOrFallback` — synthesis 시 `source:"synthesis"`, 파생 불가 값은 `null`+사유.
- **비영속**: 응답 후 저장 없음. 감사 로그(`appendAudit`)만 남긴다. 스키마 변경 없음(ADR 트리거 없음).
- **UI 블록(P3 Decision 패턴)**: 섹션 헤더(SectionToolbar) + 생성 버튼 + 매니페스트 표시 +
  제안 표시(출처 칩) + "폼에 반영"(ConfirmDialog 확인 후 프리필 — 이후 자유 수정).

## 4. 단계별 컨텍스트 매니페스트

| 기능 | 매니페스트 (읽는 산출물) | flow.spec 근거 |
|---|---|---|
| S2 매력도 초안 | S1 최신 sizing 요약(CAGR·규모·요인) / 자기 단계: 기회·위험 요인 | S2 inputs |
| 게이트 `screening` | S1 sizing 요약 / S2 매력도·요인 / S3 적합성·시너지 초안 / gateRecommendation | S1–S3 outputs |
| 게이트 `pre_fs` | screening 매니페스트 + S4 route_decision(+채점) + S5 격차/전략 또는 BF 쇼트리스트 | S4/S5 outputs |
| 게이트 `target_screening` | S4 트랙·라우트 + S6 universe/long list + S7 스크리닝 요약 | S6/S7 outputs |
| S5 역량·전략 추천 | S4 트랙 결정 / S1 시장 정의 / S3 필요 역량(적합성·시너지 초안) | S5 inputs |
| 게이트 `fs` | S4 트랙 결정 + S8 채택 BC(+variant)·밸류에이션 요약 | S8 outputs |
| 게이트 `dd` | S8 채택 BC 요약 + 체크리스트 판정 집계 + dd_finding + waiver | S9 inputs/outputs |
| S10 딜구조 추천 | S8 채택 BC 요약 + S9 dd_finding 요약 + WACC·hurdle + 자기 단계 가설/4축/재원 현황 | S10 inputs |
| 게이트 `entity_ic`·`group_ic` | IC 구성요소(채택 BC·DD 완료·RAG 제안·딜구조 가설) + 선행 게이트 결정 | S11 inputs |
| S12 모니터링 브리프 | 스코어카드 롤업 + 시너지 인증 + 핵심인재 + 전환 이력 (자기 단계) | S12 inputs |
| S8 채택 권고 | 6개 case(variant·시나리오·NPV/IRR) + 킬크라이어리아 상태 (자기 단계) | S8 outputs |

## 5. 구현 명세

### 5.1 게이트 브리프 (S3·S5·S7·S8·S9·S10·S11 게이트 공통)
- `lib/gate-brief.ts`: `buildGateContext(db, entityType, entityId, gate)` — 게이트별 매니페스트
  빌더(§4), `normalizeGateBrief`(recommendation go|hold|kill|null·confidence·rationale_draft·
  key_evidence·cautions 클램프), 결정론 폴백(게이트별 데이터 요약 — 권고는 파생 가능한 경우만,
  아니면 null).
- 라우트: `POST /api/opportunities/[id]/gate-brief {gate}` (screening|pre_fs|target_screening),
  `POST /api/projects/[id]/gate-brief {gate}` (fs|dd|entity_ic|group_ic).
- UI(`GateDecisionPanel`): 폼 위 "🤖 LLM 브리프(제안)" — 생성 버튼, 권고 칩+확신도, 핵심 근거·유의,
  매니페스트 표시, **"근거에 반영"**(rationale 프리필 — 결정 select는 건드리지 않음).

### 5.2 S5 역량·전략 추천
- `POST /api/greenfield/[oppId]/recommendation` → `{ capability_rows:[{name,required_level,current_level,gap,approach,note}], strategy_draft, alternatives_draft, rationale_draft, key_evidence, cautions }`
  — approach는 build|partner|hire|invest 클램프, 수준 불명은 "검증 필요".
- UI: greenfield 페이지 저장 폼 위 섹션 → 반영 시 격차 행·전략·대안·근거 프리필(기존 입력은 확인 대화 후 대체).

### 5.3 S10 딜구조 추천
- `POST /api/projects/[id]/deal-structure-recommendation` → `{ vehicle, stake_type, instrument_mix, four_axis:{tax,liability,financing,exit}, rationale_draft, key_evidence, cautions }`
  — vehicle은 direct|spc|holdco|spinoff|jv 클램프.
- UI: deal-structure 페이지 가설 폼 위 섹션 → 반영은 가설·4축 노트·근거 프리필.

### 5.4 S12 모니터링 브리프
- `POST /api/projects/[id]/monitoring-brief` → `{ assessment_draft, risk_flags, transition_suggestion(next_tranche_released|held_evidence_incomplete|graduate_to_core|reduce_or_divest|kill_with_learning_captured|null), rationale_draft, learning_capture_draft, key_evidence, cautions }`
- UI: portfolio 페이지 전환 결정 폼 위 섹션 → 반영은 결정 select는 유지하고 근거·learning_capture 프리필.

### 5.5 S8 채택 권고
- `POST /api/projects/[id]/business-case/adoption-recommendation` → `{ recommended_model_id, rationale_draft, what_would_change, key_evidence, cautions }` — model_id는 존재 id 검증, 폴백은 결정론 RECOMMENDED echo.
- UI: business-case 페이지 채택 테이블 위 섹션 (결정론 RECOMMENDED 칩과 병기).

### 5.6 S2 매력도 초안
- `POST /api/opportunities/[id]/attractiveness-recommendation` → `{ suggested_score(0–100|null), rationale_draft, key_evidence, cautions }`
- UI: opportunities 확장 행 매력도 입력 옆 "LLM 초안" → 제안 점수·근거 표시 + "반영"(입력 프리필).

### 부수 수정
- `POST /api/opportunities/[id]/screening` 라우트에 `appendAudit` 추가 (감사 일관성).

## 6. 제외·후속

- **S6 후보사 추천**: 라이브 검색 근거(Tavily) 없이 회사명을 생성하면 환각 — 어댑터 착지 후 재검토.
- **S7 항목별(t-01~t-09) 브리프**: 1차로 target_screening 게이트 브리프가 커버. 항목 단위는 후속.
- **S1 분석가 확정/시드 UI**: LLM 갭이 아닌 별도 UX 갭 — 본 설계 범위 외.
- **WACC 확정 화면**: 계산 확인 표면 — LLM 개입 대상 아님(결정론 유지).

## 7. 검증 계획

- 각 엔드포인트 synthesis 강제 단위 테스트(역할·존재·게이트 화이트리스트·폴백 응답 형태·감사 로그).
- openapi.yaml 신규 6개 등록(드리프트 게이트) / tsc / design-lint / audit.ts.
- 수동: 각 화면에서 생성 → 제안 확인 → 폼 반영 → 사람 기록까지 전 흐름.
