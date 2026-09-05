---
lang: ko
lang_reason: source-material
counterpart: k-dart-benchmarking-2026-09-01.md
---

# Research: k-dart 스킬 벤치마킹 및 고도화 방안 — 2026-09-01

> **언어**: [English](k-dart-benchmarking-2026-09-01.md) · **한국어**

**Scope**: `skills/k-dart/SKILL.md` v2.0.0 + `app/web-next/lib/dart-client.ts`·`corp-code-fallback.ts` 구현
**Benchmark sources**: dart-fss (Python), korean-dart-mcp (83 API → 15 tools), snaiws/DART-mcp-server, OpenDART 공식 가이드
**목적**: 유사 오픈소스·MCP 서버 벤치마크를 통한 k-dart 고도화 로드맵 도출

---

## 1. 벤치마크 대상 요약

| 대상 | 형태 | 강점 | 시사점 |
|---|---|---|---|
| **dart-fss** (Python, 사실상 표준 라이브러리) | 라이브러리 | corp 리스트 캐싱, 공시·재무·XBRL 추출, 재무제표 일괄 추출 | corp_code 캐시 선적재 패턴, XBRL 파싱 성숙도 |
| **korean-dart-mcp** (Node/TS, MIT) | MCP 서버 | 83개 API → 15개 도구 압축, SQLite FTS corp_code(11.6만사, 24h TTL), 90일 자동 청킹, 동시성 5 제한, **애널리스트 프레임(시그널·점수) 사전 집계**, HWP/PDF→마크다운, ZIP slip/bomb 방어 | LLM 네이티브 설계 — 원문이 아니라 판정 준비된 시그널 반환 |
| **snaiws/DART-mcp-server** | MCP 서버 | AI가 분석하기 쉬운 형태로 재구성 | 데이터 제공 ≠ 분석 제공 |
| **OpenDART 공식 제약** | — | 분당 1,000건·일 20,000건, corpCode.xml은 1회 다운로드 후 자체 캐시 전제 | 캐싱+백오프가 정석, 우회 아님 |

## 2. 현행 k-dart vs 벤치마크 — 갭 분석

| 영역 | 현행 | 벤치마크 수준 | 갭 |
|---|---|---|---|
| corp_code 해소 | corpCode.xml.zip(차단됨) + 웹 폴백 + company.json 역조회 | SQLite FTS 11.6만사 선적재 + 24h TTL | **최대 갭** — 이름→코드가 안정적이지 않음 |
| 재무제표 | fnlttSinglAcntAll 6계정 3개년(2026-09 버그 수정 완료) | BS/IS/CFS 전체 + 다년 일괄 + XBRL 계층 | 항목 확장·검증(summation check) 없음 |
| 공시 검색 | list.json 조각 수준 | 22프리셋 + 90일 청킹 + 페이지 병렬 | 공시 본문·정정 이력 추적 없음 |
| 첨부파일 | 없음 | HWP/HWPX/PDF/DOCX→마크다운 | 프로젝트의 hwp-document-processing 스킬과 미연동 |
| 분석 프레임 | 없음(원시 데이터만) | 내부자 시그널·회계 리스크 0-100·퀄리티 체크리스트 | S3/S8에 필요한 "판정 준비 데이터" 미제공 |
| 레이트리밋·보안 | timeout만 | 동시성 캡·백오프·ZIP 폭탄 방어·TTL 캐시 | 무제한 호출·캐시 TTL 없음 |
| 지분·이벤트 | 없음 | 5%룰 지주·임원 보유·36 이벤트 타임라인 | S9 실사·S7 스크리닝 입력 부족 |

## 3. 고도화 방안 (우선순위 로드맵)

### P1 — corp_code 해소 안정화 (최우선, 현행 최대 취약점)
1. **정기 덤프 캐시**: corpCode.xml.zip 성공 시(차단 해제 시점) SQLite FTS 또는 JSON으로 영구 캐시 — 현행 dart-corpcode-cache.json에 **24h TTL + 수동 갱신 CLI**(`bun scripts/dart-sync-corp-codes.ts`) 추가. korean-dart-mcp의 24h TTL 선적재 패턴 이식.
2. **다중 폴백 체인 공식화**: 캐시 → corpCode.xml 재시도(백오프) → 웹 폴백(naviCrpCik/corpCode 패턴 — 2026-09-01 구현됨) → company.json 역조회 검증. 체인 각 단계의 성공·실패를 로그로 남겨 어떤 경로로 해소됐는지 provenance 기록(RAG 데이터 신뢰도 캡과 연동).
3. **종목코드 경로 추가**: 6자리 종목코드로도 company.json 역조회 가능한지 검증(corp_code 미지원 시 공시검색 stock_code 필드 활용).

### P2 — 재무제표 고도화 (S3·S8 품질 직결)
4. **계정과목 확장 + 정규화**: 현재 6계정(wanted) → K-IFRS 표준 계정 사전으로 확장(매출원가, 판관비, EBITDA 환산 등) — 스킬의 "Parsing Rules" 절이 이미 문서화한 정규화를 코드로 구현.
5. **연도 간 검증(합산 체크)**: 자산=부채+자본 대조 같은 summation 검증으로 공시 오류·파싱 오류 탐지(korean-dart-mcp의 calculation 링크베이스 검증의 경량판). 실패 시 데이터 신뢰도 하향 플래그.
6. **개별/연결 구분 명시**: fs_div=CFS 고정 사용 중 — 개별(BFS) 폴백과 출처 표기(연결/개별)로 프로파일·시너지 리포트 정확도 개선.

### P3 — 공시·지분·이벤트 확장 (S7·S9 입력 강화)
7. **공시 검색 프리셋**: 대상 회사의 정정공시·감사의견·자본변동 조회 함수 추가 — S7 t-02 규제 스크리닝·S9 실사의 증적 자동 수집.
8. **지주·내부자 거래 합성 래퍼**: majorshareholders·executive compensation를 "지분 안정성 시그널"로 사전 집계 — 벤치마크의 insider_signal 개념을 S7 스코어카드 입력으로.

### P4 — 문서 원문 처리 (인프라 연동)
9. **HWP/PDF 첨부 → 텍스트**: korean-dart-mcp의 kordoc 접근을 벤치마크해, 기존 `hwp-document-processing` 스킬·tesseract OCR 경로와 연동 — 사업보고서 본문·감사보고서를 S3 리서치 소스로 직접 인입.

### P5 — 운영 안전장치
10. **호출 예산 + 백오프**: 분당/일 호출 카운터와 429/020 코드 백오프(지수 백오프, 동시성 ≤5) — 파이프라인 다중 조회 시 차단 예방.
11. **캐시 보안**: ZIP 파싱 시 slip/bomb 방어와 캐시 무결성 체크 — corpCode.xml.zip 수동 갱신 절차에 필수.

## 4. 실행 제안 (이번 사이클)

- 즉시 가능: P1-1(캐시 TTL+CLI), P1-2(폴백 체인 provenance 로그), P5-10(백오프·카운터) — 순수 로직 변경, 외부 의존 없음.
- 다음 사이클: P2-4~6(재무 고도화), P3-7(공시 프리셋).
- 검토 필요: P3-8·P4-9는 신규 API 영역이라 절차·게이트 연계 설계 후 착수.

## 출처
- [dart-fss (PyPI)](https://pypi.org/project/dart-fss/) · [dart-fss 문서](https://dart-fss.readthedocs.io/)
- [chrisryugj/korean-dart-mcp](https://github.com/chrisryugj/korean-dart-mcp/) · [glama.ai 소개](https://glama.ai/mcp/servers/chrisryugj/korean-dart-mcp)
- [snaiws/DART-mcp-server](https://github.com/snaiws/DART-mcp-server)
- [OpenDART 공식 가이드 — 고유번호 API(020 요청제한)](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019018) · [영문 가이드(20,000건 제한)](https://engopendart.fss.or.kr/guide/detail.do?apiGrpCd=DE002&apiId=AE00032)
