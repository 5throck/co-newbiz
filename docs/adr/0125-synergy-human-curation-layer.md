---
lang: ko
lang_reason: source-material
---

# ADR-0125: S3 시너지 화면 — 사람이 편집할 수 있는 큐레이션 레이어 추가

- Status: Accepted
- Date: 2026-09-13
- Deciders: PM (dispatch), backend-engineer (schema/API), frontend-engineer (S3 UI)
- Related: ADR-0094 (경계 #2 — 에이전트 권고/사람 기록), ADR-0014 (additive-only
  migration discipline), ADR-0124 (동일 패턴의 draft/final 분리 선례)

## Context

S3 시너지·전략적 적합성 화면의 "연계 시너지"·"우선 시너지 영역" 데이터는
`synergy_pipeline.ts`가 생성해 `synergy_version.payload`에 append-only로
저장한다(시장분석과 동일한 버전 이력 원칙). 이 payload는 감사 목적의 스냅샷이라
직접 고쳐 쓸 수 없다.

사용자가 지적한 문제:
1. "연계 시너지" 탭은 LLM이 도출한 영역만 보여줄 뿐, 사람이 놓친 영역을
   추가로 등록할 방법이 없었다.
2. "우선 시너지 영역"(Short List)의 판정(선별/보류)과 사유는 LLM 산출값
   그대로 고정되어 있었다 — ADR-0094 경계 #2("최종 판단은 사람")를 이 화면만
   지키지 못하고 있었다.
3. 어떤 영역이 LLM 제안이고 어떤 영역이 사람이 추가한 것인지 구분할 수
   없었다.

## Decision

1. **새 테이블 두 개**를 payload 위에 얹는 큐레이션 레이어로 추가한다
   (payload 자체는 건드리지 않음 — append-only 원칙 유지):
   - `synergy_linkage_item` — 사람이 "연계 시너지" 탭에 추가하는 영역
     (area/synergy_type/rationale/opportunity/risk/sources_json). 항상
     origin='human'이므로 별도 컬럼 없이 존재 자체가 사람 추가를 뜻한다.
   - `synergy_shortlist_curation` — "우선 시너지 영역"의 판정/사유 오버라이드
     + 사람이 새로 추가한 영역. `(analysis_id, area)` UNIQUE. `origin`
     컬럼(`llm`|`human`)으로 그 영역이 애초에 LLM 제안이었는지, 사람이
     새로 만든 것인지 기록한다. LLM 제안 영역의 판정/사유를 사람이 고치면
     origin은 `llm`으로 유지하되 `updated_by`/`updated_at`에 편집 이력이
     남는다(제안 출처와 편집 사실을 모두 보존).
2. **GET `/api/synergy/analyses/{id}`**가 응답 직전에 최신 버전 payload를
   이 두 테이블과 병합한다 — `marketLinkage.synergyAreas`에 사람이 추가한
   행을 `origin:"human"`으로 덧붙이고, `shortList`의 각 항목에 큐레이션이
   있으면 그 판정/사유로 교체하며 `origin`을 채운다(오버라이드 없으면
   `origin:"llm"`, payload에 없던 새 영역은 `origin:"human"`). 과거 버전
   (versions[1..])에는 병합하지 않는다 — 큐레이션은 "현재" 레이어이지
   과거 스냅샷을 소급 수정하는 게 아니다.
3. **새 엔드포인트**:
   - `POST /api/synergy/analyses/{id}/linkage-items` — analyst+, 연계
     시너지에 사람 항목 추가.
   - `PUT /api/synergy/analyses/{id}/shortlist-items` — analyst+, 기존
     영역의 판정/사유를 고치거나 새 영역을 추가(upsert by area).
4. **UI**: 두 탭 모두 각 행에 origin 배지("LLM 추천" / "사람 추가")를
   표시한다. 우선 시너지 영역 탭은 판정 select(선별/보류)와 사유 입력을
   analyst+ 역할에 한해 인라인 편집 가능하게 바꾸고, 새 영역 추가 폼을
   더한다. 연계 시너지 탭에도 동일하게 새 영역 추가 폼을 더한다.
5. **S3→S4 핸드오프 안내**: GateDecisionPanel의 "결정" 버튼 옆에 GO 기록
   시 진출방식 결정(S4)으로 자동 이동한다는 안내 문구와, 기다리지 않고 바로
   이동할 수 있는 링크를 추가한다(ADR-0124에서 "S4로 진행" 전용 버튼을
   제거하고 GO 기록에 흡수시킨 후속 보완 — 이동 경로가 안내 없이 숨어
   있었다는 사용자 피드백 반영).

## Consequences

- LLM 산출 payload는 여전히 불변이다 — 감사·재현성에 영향 없음. 사람의
  편집은 별도 테이블에 쌓이므로 "LLM이 실제로 무엇을 제안했는지"와
  "사람이 최종적으로 무엇을 확정했는지"를 항상 분리해서 조회할 수 있다.
- 재분석(rerun)으로 새 버전이 생성되면 큐레이션은 이전 버전에 대한
  것이므로 새 payload에는 자동 반영되지 않는다 — 재분석 후에는 새 LLM
  출력 기준으로 다시 검토해야 한다(의도된 동작: 소급 자동 승계는
  근거 없는 확신을 만든다).
- `synergy_shortlist_curation`은 `(analysis_id, area)`로 유일하므로 같은
  이름의 영역을 두 번 추가할 수 없다 — 편집은 upsert로 처리된다.
