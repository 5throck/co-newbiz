---
lang: ko
lang_reason: source-material
---

# ADR-0139 — S7 Long List 재무·기술 평가 레이어 (chk-target-screening 병행)

- Date: 2026-09-15
- Status: accepted (implemented same day)

## Context

S7 "대상 선정"(Long List → Short List)은 지금까지 워크스페이스 공통
지배문서인 `chk-target-screening`(t-01~t-09, ADR-0081) 하나로만 판정됐다.
사용자가 처음 이 세션에서 지적한 내용: 브라운필드는 "S3에서 확인된 역량
갭(필요 역량인데 자사가 못 채우는 것)을 대상 기업 인수·제휴로 메우는" 경로이므로,
Long List 후보를 그 역량 갭을 실제로 채울 수 있는지(기술 평가)와 재무적으로
타당한지(재무 평가)로 심사해 Short List로 좁히는 절차가 있어야 한다. 이
평가는 t-01~t-09와는 다른 질문에 답하므로 그것을 대체하지 않고 병행한다.

## Decision

1. **관계형 스키마로 만든다** — `screening_json` 블롭 방식(0055) 대신
   `project_checklist_item_custom`/`project_checklist_item_state`
   (0069/0039) 패턴을 오퍼튜니티 단계로 축소 적용: 카탈로그
   (`brownfield_eval_criterion`, opportunity 단위)와 판정
   (`brownfield_target_eval_state`, target 단위) 분리 — 근거·감사이력이
   행 단위로 조회 가능해야 하기 때문(마이그레이션 0103).
2. **기술 평가는 S3 레지스터에서 항목별로 시딩한다** — 시너지 payload를
   블롭 하나로 뭉치지 않고, `opportunity.capability_gap_json`(ADR-0136)의
   gap row 하나당 시딩 항목 하나(`source='seeded'`, `is_mandatory=1`,
   `is_deletable=0`). 레지스터가 비어 있으면 시딩하지 않고 "S3에서 먼저
   정의하라"는 안내만 표시한다(내용을 지어내지 않는다).
3. **재무 평가는 고정 빌트인 5항목**(매출성장률/영업이익률/순이익률/
   부채비율/영업부문) + 사람이 추가하는 커스텀 항목. DART 동기화 값이
   있으면 참고 숫자만 표시하고, 판정(pass/fail/na/waived)은 항상 사람이
   내린다 — DART 데이터가 자동으로 verdict를 쓰지 않는다.
4. **게이트 영향 없음** — 이 레이어는 표시·기록용이며, `target_screening`
   게이트의 pass/fail 조건(t-01/t-02 knock-out)을 바꾸지 않는다. 재무/기술
   진행률은 t-01~t-09 퍼센트와 별도 줄로만 보여준다 — 합산은 이번 범위 밖.
5. **영업부문(사업부문별 실적)은 v1에서 수기 입력 전용** — 기존 DART
   연동(`dart-client.ts`)에 세그먼트 데이터를 주는 엔드포인트가 없어,
   자동 파싱은 만들지 않는다(스코프 확대 방지).

## Alternatives considered

- **`screening_json`을 확장해 재무·기술 판정도 같은 블롭에 넣기** — 기각.
  거버넌스 문서(t-01~t-09)와 오퍼튜니티별 카탈로그를 한 컬럼에 섞으면
  조회·감사가 어려워진다.
- **DART 영업부문 자동 파싱 지금 구축** — 기각. 별도 API/문서 파싱이
  필요한 신규 통합이라 이번 범위를 벗어난다.

## Consequences

- Long List 후보 행에 재무/기술 평가 카드 2개가 추가된다 — 기존
  t-01~t-09 스트립은 그대로.
- 기술 평가 항목은 S3가 먼저 정의돼 있어야 의미가 있다 — S3 없이 S7에
  들어오면 "필요 역량 없음" 안내만 보인다.
- 재무/기술 평가 결과가 Short List 승격의 실제 게이트 조건이 되는 것,
  또는 t-01~t-09와 합산되는 것은 후속 ADR 대상이다.

## Related

ADR-0136 (S3 역량 갭 레지스터 단일화 — 이 ADR의 기술 평가 시딩이
그 레지스터를 그대로 소비한다), ADR-0081 (chk-target-screening 고정
체크리스트), ADR-0099 (project_checklist_item_custom/state 원형 패턴).


## Addendum (2026-10-20, a) — explicit per-category save, judged/total basis on the score, flow.spec-aligned gate hint

Status at time of writing: Proposed. Accepted 2026-10-20 by the human decider (chat instruction "진행해줘" after the documentation-audit report; recorded as DEC-20261020-01), covering this addendum. Direction given by the human decider in chat on 2026-10-20 (S6/S7 evaluation round); acceptance of this addendum text is pending.

1. **Explicit save.** Verdict and weight edits on the target evaluation tab are LOCAL until the person presses the category's `저장` button (bottom-right, after the 항목 추가 row; a pending-changes count and `변경 취소` sit beside it). The previous save-on-every-change behaviour is retired. A visible AI draft's evidence note still rides along at save time, and the bulk `초안 저장` flow is unchanged.
2. **Score basis on the chip.** The category score chip states `판정 N/M 항목` — the weighted mean covers judged items only (`충족 1 · 부분충족 0.5 · 미충족 0`, `해당없음·예외` excluded, pending not yet counted), so the basis is visible while items remain unjudged. The formula itself is unchanged (re-verified against the database: the earlier `기술 58` was the same formula over fewer judged items).
3. **Gate hint follows flow.spec.** The S7 `target_screening` kill hint fires only on the spec's kill criterion — no knock-out survivor (no non-excluded candidate). The former proxy ("no candidate has EVERY evaluation item judged") is retired; evaluation completeness is an informational note (candidate names + a pointer to the eval tab), never kill language. The ADR-0171 addendum-b readiness notice/route are removed in the same window.

Honest limits: per-item judgement completeness is still what `eval_summary.complete` means (promotion precondition unchanged); the informational note does not rank candidates.
