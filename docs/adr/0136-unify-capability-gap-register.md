---
lang: ko
lang_reason: source-material
---

# ADR-0136 — S3 역량 갭 레지스터를 S5 필요 역량의 유일 출처로 단일화

- Date: 2026-09-15
- Status: accepted (implemented same day)

## Context

S3(시너지·전략적 적합성)는 이미 "필요 역량 정의 + 보유 판정" 레지스터를 갖고 있다
(`opportunity.capability_gap_json`, 마이그레이션 0098, `app/web-next/lib/capability-gap.ts`
의 `CapabilityGapRow{capability, source, requiredNote, held:{status,holders,evidence},
resolution, note}`). Greenfield S5("역량 평가·진출전략")는 이 레지스터를 읽지 않고
완전히 별도의 테이블(`greenfield_assessment.capability_gaps_json`, 마이그레이션 0056,
행 shape `{capability, required_level, current_level, gap, resolution, note}`)에 사용자가
필요 역량을 처음부터 다시 입력하도록 되어 있었다. 두 레지스터는 이름만 비슷할 뿐 서로
연결이 없고(외래키·참조 없음), S5의 LLM 추천 기능만 참고용으로 S3 데이터를 곁눈질할
뿐 실제 저장은 독립적이었다. 마이그레이션 0098의 작성 당시 주석("해소 어휘는 S5
capability_gaps_json과 동일 — 승계 가능")이 이미 이 통합 가능성을 예견하고 있었다.

이는 ADR-0134가 지적한 "S1~S3 근거를 각자 따로 재수집하는 여러 개의 화면" 패턴과
같은 문제이며, 사용자가 "필요 역량 정의 및 보유 판정을 통해 역량의 수준을 결정했는데
그린필드가 이와 다르게 필요 역량을 정의하는 건 로직적으로 잘못됐다"고 지적한 부분이다.

## Decision

1. **S3 레지스터가 유일한 필요 역량 출처**가 된다. `CapabilityGapRow`
   (`app/web-next/lib/capability-gap.ts`)에 `requiredLevel`/`currentLevel` 필드를
   추가해, S5가 필요로 하던 정보를 같은 레지스터 안에서 표현할 수 있게 확장한다.
   `resolution`(build/partner/hire/invest)·`note`는 이미 존재하므로 그대로 재사용한다.
2. **S5는 재정의가 아니라 확장만 한다.** Greenfield 페이지는 S3 레지스터를 읽어와
   `capability`/`held.*`/`requiredNote`를 읽기 전용으로 표시하고, `requiredLevel`/
   `currentLevel`/`resolution`/`note`만 편집해 같은 엔드포인트
   (`/api/opportunities/[id]/capability-gap`)로 저장한다. S5 전용 CRUD 엔드포인트를
   새로 만들지 않는다.
3. **entry_strategy·투자비 검토 요건(구 Business Case 라인)은 이번 범위 밖.**
   `greenfield_assessment` 테이블은 그대로 두되, `capability_gaps_json` 컬럼은 더
   이상 채우지 않는다(컬럼 자체는 삭제하지 않음 — 파괴적 변경 회피, ADR-0014
   additive-only 원칙).
4. **기존 데이터는 백필한다.** `greenfield_assessment.capability_gaps_json`에 이미
   값이 있던 오퍼튜니티는 `capability` 텍스트 매칭으로 S3 레지스터에
   `requiredLevel`/`currentLevel`/`resolution`/`note`를 병합한다. 매칭되지 않는 행은
   `source: "manual"`로 S3 레지스터에 새로 추가한다(데이터 유실 방지 우선).
5. **용어 정리.** S5의 `resolution` 라벨 중 `partner`를 S4 브라운필드 sub_track 라벨
   (`RouteDecisionStage.tsx`의 `partnership: "파트너십"`)과 맞춰 "파트너십"으로
   통일한다. `build`/`hire`/`invest`는 S4에 대응 개념이 없어 그대로 둔다 — S4
   sub_track(전체 진출 메커니즘)과 S5 resolution(역량 갭별 해소 수단)은 축이 다른
   개념이므로 전체 어휘를 강제로 병합하지 않는다.
6. **"Business Case 라인" 사용자 노출 라벨을 "투자비 검토 요건"으로 변경.** 내부
   변수/필드명(`bcLines`, `business_case_lines[_json]`)은 스키마 식별자이므로 그대로
   둔다.

## Alternatives considered

- **두 레지스터를 그대로 두고 참조(FK)만 추가** — 기각. 두 화면이 같은 개념(필요
  역량)에 대해 서로 다른 값을 가질 수 있는 구조적 위험이 남고, "무엇이 진실인가"에
  대한 답이 여전히 두 곳으로 나뉜다.
- **S5 자유 입력을 그대로 두고 S3 값을 초기값으로만 복사** — 기각. 복사 이후
  두 값이 갈라지면(S3 재판정 vs S5 스냅샷) 다시 같은 문제가 재발한다. 읽기 전용
  참조여야 단일 출처가 유지된다.

## Consequences

- Greenfield S5는 더 이상 필요 역량을 처음부터 입력받지 않는다 — S3에서 먼저
  정의·판정이 끝나야 S5 진입이 의미를 가진다(안내 문구로 유도).
- `greenfield_assessment.capability_gaps_json`은 사용되지 않는 컬럼으로 남는다(과거
  데이터 조회는 가능, 신규 기록 없음).
- 이번 ADR은 S5→S8 투자비 연계(Phase B), 브라운필드 재무·기술 평가 레이어(Phase C),
  S6 롱리스트 목표 수 근거(Phase D)는 다루지 않는다 — 별도 후속 ADR 대상.

## Related

ADR-0134 (겹치는 S1~S3 근거를 재수집하는 화면들에 대한 이전 감사), ADR-0014
(additive-only 마이그레이션 원칙).
