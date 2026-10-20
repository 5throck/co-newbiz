---
lang: ko
lang_reason: source-material
---

# S10 자금 확정성 증빙·4축 완결성 + S11 투자심사 절차 단계 표면화 (Implemented)

- **일자**: 2026-10-21
- **상태**: Implemented (슬라이스 2/3 — 선행: 2026-10-21-s9-s10-depth-…-design; 후속: S12 완결)
- **원 질의**: decider — "S10 투자구조 설계도 제대로 구현이 되어있는지 점검해 줘", "S11 투자심사/실행 … 제대로 구현이 안된 듯"
- **관련**: `procedures/_shared/deal-structuring` step 2·3·5(ADR-0045 4축, "Certainty of funds is evidenced, never assumed"), `procedures/_shared/entity-ic-review` v1.3.0(step 1~5), `procedures/_shared/group-investment-review` v1.2.0, ADR-0100 §2(투자심의 자료 읽기 전용), ADR-0053(사람 결정), ADR-0060/마이그레이션 0023(kill_criteria_evaluation 원장), R2-B item 3(GO 누락 산출물 예외 근거)

## 1. 문제

S10 점검 결과 완료 기준(4축 완료 + sources=uses>0)은 스펙과 1:1이었으나 "증빙"이 자유 텍스트에만 있어 검증·전달이 되지 않았고, S11은 `entity-ic-review` 8단계 중 첫 단계(AI 종합 등급 제안)와 마지막 단계(사람 게이트 결정)만 화면·원장이 있었다.

| # | 격차 | 근거 |
|---|---|---|
| S10-1 | `financing_sources_uses`에 자금 확정성 증빙 필드 없음 → S11 step 4(자금확정성 선결, 커밋먼트 없으면 FAIL)의 사실 원천 부재 | 마이그레이션 0075, deal-structuring step 3 "referenced in the note column" |
| S10-2 | 4축 노트 4개가 모두 비어도 `completeFourAxisReview` 가능 | repository는 artifact_ref·이중 완료만 검사 |
| S10-3 | 4축 완료의 아티팩트 참조가 `audit_log.target`에만 있어 화면·투자심의 자료에서 보이지 않음 | repository 헤더 주석(설계상 의도) |
| G5 | step 2 Kill 체크·3 IC 메모·4 자금확정성·4.5 통합 인사이트·4.6 의사결정 덱, 그룹 검토 2~4.5의 표면·원장 전무 | `grep ic_memo\|financing_readiness\|kill_criteria_check` → 생성 라이브러리만 |

## 2. 결정

### 2.1 S10-1 자금 확정성 증빙 (마이그레이션 0162)
- `financing_sources_uses.evidence_kind` (`commitment_letter | internal_approval | term_sheet | subsidy_grant | other`) + `evidence_ref`. 둘은 **함께** 기록된다(종류만·참조만은 증빙이 아니다 — 리포지토리 거부).
- `financingCertainty()`: 조달(source) 행 중 증빙 있음/없음 건수·금액, `all_sources_evidenced`. `GET deal-structure`·투자심의 자료 `deal_structure.financing.certainty`에 노출.
- **S10 완료 기준은 그대로 '균형'**이다. 확정성은 S11 step 4의 선결 사실이며 S10에서 차단하지 않는다(스펙: 완료 기준 2개 불변).

### 2.2 S10-2 4축 노트 완결성
- `completeFourAxisReview`가 4축 노트 중 빈 축이 있으면 `four_axis_note_missing:<axis>`로 거부. 화면은 빈 축을 표시하고 완료 버튼을 비활성화한다. 기존 테스트 픽스처는 네 축을 채워 완료한다.

### 2.3 S10-3 아티팩트 참조 파생
- `getHypotheses()`가 `audit_log(action='four_axis_review_completed', target='<id>:<ref>')`에서 `four_axis_artifact_ref·reviewed_by·reviewed_at`을 **읽어서** 반환(쓰기 변경 없음 — 감사 로그가 여전히 유일한 저장소). 투자구조 화면·IC 메모에 표시.

### 2.4 G5 투자심사 절차 단계 (마이그레이션 0163 `ic_review_step_record`, append-only)
- `lib/ic-review-steps.ts`가 단계 정의(entity 1·2·3·4·4.5·4.6·5, group 1·2·3·4·4.5·5)와 상태를 산정한다.
  - **파생**(여기서 기록 불가): step 1 = `rag_assessment` 등급 유무, step 5/그룹 5 = `gate_decision`, 그룹 1 = 법인 결정이 GO인가, step 4의 **사실** = 균형 ∧ 조달 전부 증빙.
  - **원장**: step 2 Kill Criteria — 적용 절차(`entity-ic-review` + 트랙별 `brownfield-fs/-fs-comparative/-dd` 또는 `greenfield-dd` + 설립 방식별 establishment 절차)의 `procedures/_kill-criteria/*.json` 전부에 사람의 `pass|fail|na`가 있어야 기록되며, 엔진의 `kill_criteria_evaluation` 결과는 **제안**으로 나란히 표시된다. step 3 IC 메모 = 채택 케이스·등급 제안·DD 요약·투자구조(아티팩트 참조 포함)·자금 확정성·Kill 판정·리스크 히트맵 스냅샷을 묶어 sha256 앞 16자와 함께 기록. step 4 기록 = 파생 사실의 사람 확인(덮어쓰기 불가). 4.5·4.6·그룹 2~4.5 = 근거 참조 또는 10자 이상 메모.
- `GET/POST /api/projects/{id}/ic-review-steps`(record | snapshot_ic_memo), 투자심의 자료에 `ic_steps{entity, group, procedure_gaps}` 요약, `IcReviewStepsPanel`을 S11 화면 투자심의 자료 요약 바로 아래에 장착.

### 2.5 절차 격차의 지위 — **참고 표시** (열린 결정)
- 계획은 절차 격차를 `icGoGapItems`(GO 예외 근거 대상)에 넣는 것이었다. 그러나 게이트 라우트는 열린 격차가 있으면 `gap_rationale` 없는 IC GO를 422로 거부하므로, 넣는 즉시 **진행 중인 모든 프로젝트의 IC GO 계약이 바뀐다**(5개 테스트 스위트도 그 경로로 GO를 기록). ADR-0150의 전례(진행 중 프로젝트에 대한 기준 변경은 사람 결정)에 따라 이번 슬라이스는 `procedure_gaps`를 **별도 참고 목록**으로 화면·투자심의 자료에 표시만 한다.
- **사람 결정 필요**: 절차 격차를 GO 예외 근거 대상에 포함할지, 포함한다면 컷오프(생성일 또는 명시적 채택)를 둘지. 결정되면 `icGoGapItems`에 `icStepGapItems` 한 줄을 더하면 된다(`lib/ic-review-steps.ts`에 이미 준비).

## 3. 범위 밖
- 4.5 통합 인사이트·4.6 덱의 LLM 생성(현재는 사람 기록만), 그룹 검토 2~4의 자동 산출(portfolio-overlap 등 기존 lib 연결), 제안자≠승인자 규칙.

## 4. 검증
- 유닛: `ic-review-steps.test.ts`(초기 상태·Kill 전수 판정 강제·fail/pass 전환·자금확정성 사실 전환·사람 확인·메모 해시·4.5 근거 요구·파생 단계 거부·격차 0 수렴·투자심의 자료 요약), `deal-structure-hypothesis-write.test.ts`(빈 축 거부 추가, export 목록 갱신), `deal-structure.test.ts`·`ic-package.test.ts`·`ic-gap-rationale.test.ts`·금지 용어·테이블 사이징·OpenAPI 드리프트 가드 통과.
- 타입: `bunx tsc --noEmit -p app/web-next/tsconfig.json` 무오류.
