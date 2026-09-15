---
lang: ko
lang_reason: source-material
---

# ADR-0129: 수요산업(demand industry) 큐레이션 — `proxy_link` 확장

- Status: Accepted
- Date: 2026-09-13
- Deciders: PM (dispatch), platform-lead (schema/ADR), backend-engineer (schema/API)
- Related: ADR-0025 (proxy_link/value_chain_link 계수 분리 경계, 불변),
  ADR-0126 (`structural` hop type 선례 및 "등록은 사람의 행위다" 경계 #2 —
  이 ADR이 확장하는 대상), ADR-0014 (additive-in-effect migration discipline)

## Context

S1 시장분석 파이프라인의 1단계(`market-sizing-pipeline.ts`)는 LLM이 대상
산업의 전방/전전방/후방/후후방(수요산업) 관계를 도출해 리포트 payload에
`relation`/`hop_distance` 라벨을 붙인 JSON 텍스트로 남긴다. 이 결과는
세그먼트·CAGR 산출에 쓰이지만, 실제 산업 마스터·가치사슬 연계 데이터와
연결되지 않는다 — 파이프라인은 매 실행마다 `name_ko` 문자열 매칭으로 이
JSON을 다시 파싱해야 하고, 사람이 승인한 수요산업 관계를 영속 저장하거나
재사용할 방법이 없다.

ADR-0126은 이미 `proxy_link.hop_type`에 `'structural'`을 추가해 계수 없는
가치사슬 위상 전용 hop을 지원한다 — 이는 개념적으로 이미 "사람이 승인한
수요산업 엣지"다. 사용자는 이 스키마를 재사용하기로 결정했다: 새 테이블을
만들면 거의 동일한 스키마(from/to 산업, hop 종류, 근거)가 두 곳에
중복된다.

또한 ADR-0126 구현 이후 드러난 UX 결함이 있다: structural 링크는 등록만
가능하고 삭제할 방법이 없었다(hard delete는 감사 원칙에 위배되고, 상태
컬럼도 없었다).

## Decision

1. **새 테이블을 만들지 않고 `proxy_link`를 확장한다.** ADR-0126의
   `structural` hop type은 이미 사람이 승인한 수요산업 엣지라는 개념을
   담고 있으므로, 이를 새 테이블로 복제하지 않고 같은 테이블에 컬럼을
   추가해 일급 개체로 승격한다. 이 ADR은 ADR-0126을 대체하지 않고 확장·보완한다.
2. **추가 컬럼** (migration 0093, additive):
   - `relation TEXT CHECK (relation IS NULL OR relation IN ('전방','전전방','후방','후후방'))`
   - `hop_distance INTEGER CHECK (hop_distance IS NULL OR hop_distance IN (1,2))`
   - `source TEXT NOT NULL DEFAULT 'llm_proposed' CHECK (source IN ('llm_proposed','user_added','approved'))`
   - `status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired'))`
   - `retired_at TEXT`, `retired_by TEXT`
3. **`relation`/`hop_distance`는 명시적 컬럼이지 파생값이 아니다.** 1-hop
   엣지 두 개를 읽기 시점에 체이닝해 전전방/후후방을 유도하는 방식은
   채택하지 않는다 — 명시 컬럼이 더 단순하고, LLM의 Step 1이 이미 이
   라벨을 직접 산출하는 방식과도 일치한다.
4. **기존 미태깅 `structural` 행의 백필**: `relation=NULL,
   hop_distance=NULL`로 채우고(자동 추론 없음), `source='approved'`로
   채운다 — 구 플로우에서 이미 사람이 승인했던 행이기 때문이다. 방향
   컬럼만 보고 relation을 추측하는 자동 추론은 위험도가 높아 명시적으로
   거부한다. 대신 새 레거시 검토 큐 UI에서 사람이 한 행씩 relation을
   지정한다.
5. **ADR-0025 경계 재확인**: 이 변경은 `proxy_link`만 건드리며
   `value_chain_link`와 계수·스키마를 공유하지 않는다는 ADR-0025의 경계는
   변함없이 유지된다.
6. **ADR-0126 경계 #2 재확인**: `source='llm_proposed'` 행은 chain-links
   API를 통한 명시적 사람의 행위 없이는 `'user_added'`/`'approved'`로
   자동 승격되지 않는다. LLM은 제안만 하고, 등록·승인은 사람의 행위다.

## Consequences

- **삭제 UX 결함 해소**: structural 링크를 하드 삭제 없이
  `status='retired'`로 은퇴시킬 수 있게 되어, 지금까지 등록 후 되돌릴
  방법이 없었던 문제가 풀린다(`retired_at`/`retired_by`로 감사 추적
  유지).
- **시장분석 파이프라인 개선 여지**: `market-sizing-pipeline.ts`의
  세그먼트/CAGR 도출이 향후 LLM 산출 JSON 텍스트에 대한 취약한
  `name_ko` 문자열 매칭 대신, 실제 큐레이션된 수요산업 행을 조회하도록
  바뀔 수 있는 기반이 마련된다(이 ADR 자체는 파이프라인 코드를 바꾸지
  않는다 — 스키마만 연다).
- **재분석 모달 개선 여지**: `app/market/page.tsx`의 재분석 모달이 이미
  큐레이션된 수요산업을 재실행 시 조용히 누락시키는 대신, 강제로 포함할
  수 있는 기반이 마련된다(마찬가지로 별도 후속 작업).
- 레거시 `structural` 행은 사람이 검토 큐를 통해 한 행씩 relation을
  채우기 전까지 `relation=NULL`로 남는다 — 자동 일괄 처리는 하지 않으므로
  검토가 끝날 때까지 일부 리포트에서 방향 라벨이 비어 보일 수 있다.
- `proxy_link`의 CHECK 제약 확장은 SQLite 테이블 리빌드가 필요하다
  (ADR-0090과 동일한 패턴) — migration 0093이 이를 수행한다(이 ADR의
  범위에는 마이그레이션 작성 자체는 포함되지 않는다).

## Alternatives Considered

1. **새 테이블(`demand_industry_link`) 신설.** 기각 — ADR-0126이 이미
   구축한 `structural` hop 개념과 거의 동일한 스키마(from/to 산업, 근거,
   승인 여부)를 중복 정의하게 되고, 두 테이블 중 어느 것이 진실의
   원천인지 혼란을 야기한다.
2. **`relation`/`hop_distance`를 저장하지 않고 읽기 시점에 1-hop 엣지
   두 개를 체이닝해 파생.** 기각 — 조회 시마다 그래프 탐색이 필요해
   구현이 복잡해지고, LLM의 Step 1 출력이 이미 relation을 직접
   라벨링하는 방식과 맞지 않는다(굳이 분해했다가 재조합할 이유가 없다).
3. **기존 `structural` 행에 방향 컬럼(from/to) 기반으로 relation을 자동
   추론해 백필.** 기각 — 방향만으로 전방/전전방을 정확히 구분할 수
   없는 사례가 존재해 오분류 위험이 높다. 사람이 한 행씩 확인하는
   검토 큐가 더 느리지만 안전하다.
