---
lang: ko
lang_reason: source-material
---

# S1 정량 단계의 웹 검색 그라운딩 (Quantitative Web Grounding)

- Spec ID: `2026-11-06-s1-quantitative-web-grounding`
- Date: 2026-11-06
- Status: implemented
- 관련 설계: `2026-09-18-s1-growth-gap-calibration-design.md` (보정 루프 v1.2.0,
  추가endum 2026-11-06 step-5 컨센서스 연동)

## Problem

S1 마켓사이징 파이프라인(`app/web-next/lib/market-sizing-pipeline.ts`)은
정성 섹션(체인 리서치 ~L462, 정성 분석 ~L934, 수요 파이프라인 ~L967,
규제 환경 ~L990)에서 이미 웹 검색(`researchSources`)으로 근거를 수집하고,
`sectionConfidence`에서 리서치 유무로 등급(B- vs D)을 구분한다.
반면 **정량 단계는 전부 one-shot LLM 선험 질의(`askJsonTracked`)에만
의존한다**:

- step 2 앵커 규모(~L638) — 출처는 LLM이 부르는 이름뿐, URL 없음.
- step 4 셀별 CAGR(~L701) — 산업 성장 전망 근거가 프롬프트에 없다.
- step 5 탑다운 컨센서스(~L773) — 공개 컨센서스를 검색하지 않고 LLM 지식만.
- step 5-B 외부 전망(~L807) — 마찬가지.

사용자 요구: 분석 및 재분석 시 외부 검색으로 필요한 자료를 반영해라.
즉 정량 수치의 산출 근거를 웹 검색에 접지(ground)하되, 검색 실패가
새로운 고장 경로가 되어서는 안 된다.

기반 인프라는 이미 있다: `app/web-next/lib/web-research.ts`의 프로바이더
체인(Tavily → Brave → Serper → DuckDuckGo, 선택적 Playwright), 쿼터·차단
서킷브레이커(10분), `researchSourcesDetailed(queries, limit, opts)` →
`{ sources, quotaExceeded, providers }`, `WebSource { title, url, snippet }`.

## Requirements (ASD-STE100)

- R1 (우선순위): 출처가 붙는 각 값은 사람 기록 참조(1순위) > 출처 URL이
  붙은 웹 검색 증거(2순위) > LLM 선험(3순위) > 미입력 순으로 채운다.
  발췌에 없는 값을 만들어내지 않는다 — 기존 no-fabrication 원칙의 확장이다.
- R2 (엄격 추출 프로토콜): 검색 발췌(`researchSources` 결과)를 받아
  단계별로 **추출 전용 LLM 호출 1회**를 `askJsonTracked`로 실행한다.
  추출 호출은 발췌에 실제로 존재하는 값만, 값마다 발췌 인덱스와 원문 URL을
  붙여서만 출력할 수 있다. 검증(값 존재 + 발췌 인덱스가 실제 발췌를 가리킴)
  통과분만 provenance와 함께 반영한다. 추출 실패 또는 검색 공백은
  다음 우선순위로 폴백하고, provenance를 솔직하게 표기한다.
- R3 (step 2 앵커): 시장규모 추정치를 여러 명명된 출처에서 검색한다.
  추출이 성공한 분에 한해 `anchor.sources`를 URL로 접지한다.
- R4 (step 5 탑다운 컨센서스): 공개 성장률 컨센서스(시장조사 보고서)를
  검색한다. 추출된 CAGR이 컨센서스가 되며, 출처 `{label, url}`을 함께
  기록한다.
- R5 (step 5-B 외부 전망): 공표된 시장규모 전망(연도 + 규모)을 검색한다.
  추출된 전망은 발견한 출처를 사용한다.
- R6 (step 4 셀별 CAGR): 검색으로 셀별 값을 배정하지 않는다 — 가짜
  정밀도다. 대신 산업 성장 전망 발췌를 기존 보정 제약과 함께 프롬프트
  **맥락**으로 주입한다.
- R7 (비용 통제): 단계별 검색 질의는 2–3개로 제한한다. 기존 서킷브레이커·
  쿼터 처리를 재사용한다. 검색 실패 시 현재 동작(순수 LLM 선험)으로
  정확히 열화한다 — 새 고장 경로 없음.
- R8 (provenance·등급): 매트릭스에 출처 참조를 실는다 — `consistency`는
  컨센서스 출처 필드 `{label, url}`을, `externalForecast`는 출처 url을,
  `anchor.sources`는 url을 가진다. 검색 접지된 정량 섹션의
  `sectionConfidence`는 한 계단 상승한다(예: C → B-)하며 노트를 솔직하게
  쓴다("웹 검색 N건 기반 — 원문 확인 전"). 폴백 시 등급은 현재 그대로다.
  데이터 신뢰도 등급 / RAG 캡 프레이밍을 재사용한다 — 검색 접지는
  미검증 웹 출처가 허용하는 수준을 넘지 못한다(웹 스니펫 = 최선이어도
  B-, 결코 A가 아니다).
- R9 (출처 유형 표기): 컨센서스·전망의 `captured_from` 계열 provenance를
  확장해 UI가 user / web-search / llm_prior 기원을 구분할 수 있게 한다.
  저장소 CHECK는 이미 `'user','web_research','llm_prior'`를 허용한다
  (`lib/market-calibration.ts`, 마이그레이션 0113) — `web_research`
  시맨틱을 웹 검색 추출 경로에 그대로 사용한다.

## Design

### 단계별 흐름 (파이프라인)

공통: 각 정량 단계 앞에 검색 구간을 둔다. 질의 2–3개, limit은 기존
정성 섹션과 동일한 상한. 검색은 `researchSources` (기존 임포트) 또는
`researchSourcesDetailed`로 실행하고, 기존 쿼터/차단 서킷브레이커가
그대로 적용된다. 검색 결과가 비면(`sources` 빈 배열 또는
`quotaExceeded`) 해당 단계는 검색 구간을 건너뛰고 **현재 동작 그대로** —
R7의 열화 보장이다.

- **step 2 (앵커)**: 질의 2–3개(예: `"{industry} market size 2025 estimate"`,
  `"{industry} 시장 규모 보고서"`). 발췌를 step 2 추출 호출에 입력하고,
  추출 스키마는 `[{source_label, url, excerpt_index, size_b, year}]` —
  모든 항목은 발췌에 있는 값만. 검증을 통과한 항목으로 `anchor.sources`를
  채운다(기존 `AnchorSource { title, url, snippet? }` 형태 유지,
  `url`은 발췌의 것). 추출 실패 시 기존 LLM 선험 앵커를 그대로 쓴다.
- **step 5 (탑다운 컨센서스)**: 질의 2개(예: `"{industry} market CAGR forecast"`,
  `"{industry} 성장률 전망 컨센서스"`). 사람 기록 참조
  (`resolveExternalReference`, R1 1순위)가 있으면 검색·추출을 하지 않고
  기존 추가endum D1 경로를 그대로 쓴다. 없을 때만 검색 후 추출하고,
  추출 성공분이 `consistency.topDownCagr`가 된다. `consistency`는
  선택 필드 `source: { label, url, origin }`을 새로 가진다 — origin은
  `'user' | 'web_research' | 'llm_prior'` (R9). 폴백 순서:
  기록 참조 > 웹 검색 추출 > LLM 선험 > 0 (기존 추가endum D2의 확장).
- **step 5-B (외부 전망)**: 질의 2–3개(예: `"{industry} market size 2030 forecast $B"`).
  기록 참조가 1순위(기존 R1), 웹 검색 추출이 2순위, LLM 선험이 3순위.
  추출 스키마는 `[{source_label, url, excerpt_index, target_year, size_b}]`.
  성공분으로 `externalForecast`를 채우고 `sourceLabel`은 발췌의 출처,
  신규 선택 필드 `sourceUrl`에 발췌 URL을 실는다. 웹 검색 추출로 채워진
  전망은 `captured_from='web_research'`로 `market_external_reference`에
  1회 저장한다(기존 llm_prior 저장과 같은 안정화 이유) — 재분석 시
  재검색 노이즈를 멈춘다.
- **step 4 (셀별 CAGR)**: 검색값 배정 없음(R6). 질의 2개로 산업 성장
  전망 발췌를 모아 step 4 프롬프트에 `buildCalibrationConstraints`와
  함께 **맥락 블록**으로 주입한다. 프롬프트는 발췌를 참고 자료로만
  쓰도록 명시하고, 셀별 값의 산출 책임은 기존대로 LLM+보정 제약에 둔다.
  셀 값에 provenance를 붙이지 않는다(가짜 정밀도 방지).

### 추출 프로토콜 (R2 공통 규격)

1. 발췌 배열을 번호 매겨 추출 프롬프트에 첨부한다(인덱스 0-based).
2. 추출 호출은 `askJsonTracked` 1회 — 추적·다이어그노스틱스 기존 경로.
3. 출력 계약: "발췌에 나타난 값만. 각 값에 발췌 인덱스와 URL. 발췌에
   없으면 null을 출력해라."
4. 검증: 값 존재 + `excerpt_index`가 발췌 배열 범위 내 + URL이 해당
   발췌의 URL과 일치. 하나라도 어기면 그 항목은 버린다(전체를 버리지
   않는다 — 항목 단위 폴백).
5. 반영: 검증 통과분만 provenance와 함께 매트릭스에 실는다.

### Provenance·등급 (R8/R9)

- 스키마 변화는 모두 **선택 필드 추가**(payload JSON) — 마이그레이션
  불필요, 구형 매트릭스 역직렬화 영향 없음:
  - `consistency.source?: { label: string; url?: string; origin: "user" | "web_research" | "llm_prior" }`
  - `externalForecast.sourceUrl?: string`
  - `anchor.sources[].url` — 기존 타입에 이미 있던 선택 필드를 채우는 것.
- `sectionConfidence`: 검색 접지 성공 시 정량 섹션 등급 한 계단 상승
  (C → B-) + 노트 `"웹 검색 N건 기반 — 원문 확인 전"`; 폴백 섹션은
  현재 등급·노트 유지("LLM 지식만 사용"). 웹 스니펫은 미검증 출처므로
  B- 상한 — A 절대 불가(RAG 캡 프레이밍 유지).
- `verificationLedger`: 컨센서스·전망 항목에 출처 참조를 실어
  확인 대상으로 남긴다(사람이 원문 확인하면 등급 상향 여지 — 본 설계
  범위 밖의 후속 절차).
- `captured_from` 저장 시점: `web_research` 저장은 step 5-B 추출 성분에
  1회만(사람 기록이 이미 있으면 저장하지 않는다). step 5 컨센서스는
  `consistency.source.origin`으로만 표기하고 별도 저장하지 않는다 —
  step 5-B 전망이 같은 출처에서 저장되어 R9 표기가 겹치는 것을 피한다.

### 폴백 경로 요약

| 상황 | 동작 |
|---|---|
| 검색 실패/쿼터 초과 | 검색 구간 생략, 기존 LLM 선험 경로 그대로 (R7) |
| 추출 호출 실패 | 다음 우선순위 폴백 (기록 참조 > 웹 > LLM 선험) |
| 추출 출력이 계약 위반 | 항목 단위 폐기, 통과분만 반영 |
| 발췌에 유효 값 없음 | 다음 우선순위 폴백, provenance 솔직 표기 |
| 사람 기록 참조 존재 | 검색·추출 생략, 기록 참조 우선 (R1) |

### 비용 통제 (R7)

- 단계별 질의 2–3개, 총 4단계(step 2/4/5/5-B)라 최대 ~10회 검색/런.
- 기존 `isWebResearchConfigured` 가드와 서킷브레이커·쿼터 처리 재사용 —
  웹 리서치 미설정 환경에서는 검색 구간 전부 생략(=현재 동작).
- 추출 호출은 단계당 1회, `askJsonTracked` 기존 예산 추적에 합산.

### 방법론 문서

`.agents/skills/systematic-market-sizing/SKILL.md`: step 2/4/5/5-B에
검색 접지 구간과 우선순위(기록 참조 > 웹 검색 추출 > LLM 선험)를
반영한다. 파이프라인 methodology 문자열은 v1.2.0 → v1.3.0으로 상향한다.
`schemaVersion` 유지.

## Non-goals

- 셀별 CAGR를 검색값으로 배정하지 않는다 — 가짜 정밀도(R6).
- 자동 재분석 없음 — 웹 접지는 분석·재분석 런 내부에서만 일어난다.
- 기존 폼 외에 새 UI 폼 없음 — provenance 표기는 기존 리포트/패널의
  렌더링 확장에 그친다(신규 화면 설계 아님).
- 게이트 시맨틱·`schemaVersion`·킬 크라이테리아 변경 없음.
- 웹 출처 원문 확인 워크플로(사람 검증 → 등급 상향)는 본 설계 범위 밖.

## Test plan

- `tests/unit/market-sizing-web-grounding.test.ts` (신규): 항목 단위
  검증 규칙(값 존재 + 인덱스 범위 + URL 일치), 우선순위 해석
  (기록 참조 > 웹 추출 > LLM 선험 > 미입력), 검색 공백/쿼터 시
  현재 동작 열화, `captured_from='web_research'` 1회 저장, 등급 한 계단
  상승 + 폴백 등급 유지 — lib 레벨, scratch SQLite.
- 기존 `tests/unit/market-calibration.test.ts` 회귀: 기록 참조 우선
  경로가 검색 구간 추가로 변하지 않는지.
- 전체 게이트: `bun run test:unit`, design-lint, migrate + integrity.

## Out of scope (후속 결정 사항)

- 웹 스니펫 출처의 사람 원문 확인 → 등급 상향 절차.
- 검색 실패 시 재시도 백오프(서킷브레이커 존중, 재시도 추가 안 함).
