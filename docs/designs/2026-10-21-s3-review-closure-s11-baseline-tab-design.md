---
lang: ko
lang_reason: source-material
---

# S3 검토 종결(ack 원장 자기 로딩) + S11 실행 기준선 탭 분리 (Implemented)

- **일자**: 2026-10-21
- **상태**: Implemented (decider 2건 — "이미 게이트 결정이 끝난 상태인데도 S3 검토 종결이 안 되는 이유" + "S11 신규 사업 실행 기준선 … 을 별도의 탭으로 구분")
- **관련**: ADR-0182 §5 + addendum(review_claim_ack, migration 0165), ADR-0161 Row 3(실행 기준선), `lib/review/claim-acks.ts`, `components/ReviewBuckets.tsx`, `components/GateDecisionPanel.tsx`, `components/stages/IcReviewStage.tsx`, `components/stages/ExecutionBaselinePanel.tsx`

## 1. 문제

### 1-a. 게이트 결정 후에도 S3 검토가 종결되지 않는다

원인은 두 가지가 겹쳐 있었다.

1. **표시 경로가 원장을 읽지 않음**: 사람 확인(ack)은 `review_claim_ack` 원장에 저장되지만, 그 상태를 로딩하는 것은 `GateDecisionPanel` 하나뿐이었다. S3(시너지) 등 단계 화면·인박스·제안 확인이 렌더링하는 `ReviewBuckets`는 부모가 `judgementChecks`/`ackMeta`를 넘겨주지 않으면 체크박스 자체를 그리지 않고(`!!onToggleJudgement` 가드), 원장에 저장된 확인이 화면 어디에도 반영되지 않았다. 실측(데브 DB): 데이터센터 연료전지 기회에서 screening 게이트 HOLD 결정(10:26) 기록 + 6개 클레임 전부 ack(10:24, 12:43) 후에도 S3 화면은 계속 미확인으로 보였다.
2. **`allReviewed`가 죽은 코드**: 이전 라운드에 "모두 사람 확인 완료" 종결 상태를 계산만 하고 렌더링하지 않았다(구조 재작성 중 유실).

게이트 결정과 검토 종결은 별개 원장이라는 점은 설계대로다(결정 = `gate_decision`, 종결 = 클레임별 ack). 결정 폼에서 체크한 항목만 결정과 함께 확정 스냅샷으로 남고, 나머지는 각자 ack로 닫는다.

### 1-b. S11 실행 기준선이 설립 실행 탭에 묻혀 있다

1차 정비(같은 날)에서 S11 내부 탭 4개(투자심의 자료 / 절차 단계 / 설립 실행·기준선 / 의사결정)로 나눴으나, "신규 사업 실행 기준선 — 트랜치 · 인허가/인증 · 인력/조직 계획 · 가동 KPI · 인센티브 의무" 섹션이 설립 실행과 한 탭에 남아 있다는 2차 지시.

## 2. 결정

### 2-a. ReviewBuckets 셀프 ack (표시 경로 전반 수정)

- 부모가 ack 상태를 주지 않으면(=결정 패널 밖) 컴포넌트가 직접 `GET /api/{carrier}/review-acks?gate=<탭키>` 로 원장을 읽고, 토글 시 `POST`로 즉시 저장한다. 실패 시 낙관 상태를 되돌리고 토스트로 알린다. 탭키는 게이트 id(`screening`…)과 산출물 키(`stage:S3:1`) 모두 유효(`isValidAckGate`).
- 결정 패널은 기존대로 부모 소유 상태를 쓴다(결정 POST에 `judgement_confirmations` 동봉 유지).
- `allReviewed`를 실제로 렌더링: 본문 상단 "✓ 모두 사람 확인 완료 — 사람 확인으로 종결되었습니다" 배너(summary 스트립에는 "✓ 종결" 칩). 원본 버킷 데이터는 그대로 두고 표시값만 0이 된다(기존 방침 유지).
- 경계 #2: 저장 행위는 여전히 사람의 클릭이며, 컴포넌트는 원장을 읽고 쓸 뿐 판단하지 않는다.

### 2-b. S11 탭 5분할

- `IC_VIEWS`: 투자심의 자료 → 투자심사 절차 단계 → **설립 실행**(5단계, brownfield는 PMI 킥오프) → **실행 기준선**(트랜치 대조 + 인허가/인증 + 인력/조직 + 가동 KPI + 인센티브 의무 + 리드 확정) → 의사결정·승인 기록. 업무 절차 순서 유지.
- `ExecutionBaselinePanel`은 이제 전용 탭을 지므로, 미적용(brownfield)일 때 `null` 대신 "○ 적용 대상 아님" 안내 섹션을 렌더링한다(빈 탭 방지). 로딩 중에도 상태 문구 표시.

## 3. 범위 밖

- 게이트 결정 기록 시 미체크 클레임의 자동 ack(사람이 각자 확인하는 현재 원칙 유지 — 결정은 결정, 확인은 확인).
- 인박스의 S3 항목(게이트 결정 제안 row) 정리 — 현재 dev DB에 pending 제안이 없어 재현 불가. 추후 발생 시 `/proposals/[id]/confirm` 경로가 정답.

## 4. 검증

- `tsc -p tsconfig.core.json` 통과(타입 베이스라인 드리프트 44그룹은 변경 전부터 존재 — 무관).
- `bun test tests/unit/s9-depth-routes.test.ts tests/unit/stage-tabs.test.ts tests/unit/review-runtime.test.ts` 59 pass.
- 브라우저 실측: S3 화면에서 산출물 탭 체크 → 즉시 원장 저장, 전부 확인 시 "✓ 모두 사람 확인 완료" 배너 + 스트립 "✓ 종결"; S11 탭 바 5개 확인.
