---
lang: ko
lang_reason: source-material
---

# ADR-0126: S1 산업 사슬 방향 → 가치사슬 연계(proxy_link) 브릿지

- Status: Accepted
- Date: 2026-09-13
- Deciders: PM (dispatch), backend-engineer (schema/API), frontend-engineer (S1 UI)
- Related: ADR-0094 (경계 #2 — 제안/승인 분리), ADR-0014 (additive-in-effect
  migration), ADR-0004 계열 (proxy_chain 보정 규율), ADR-0125 (동일 제안→승인
  패턴 선례)

## Context

S1 시장분석의 시장 구조 정의 단계가 LLM으로 가치사슬 위치와 인접 산업
(전방/후방 3~5개)을 도출하지만, 이 결과는 리포트 payload 텍스트로만 존재하고
실제 가치사슬 연계 데이터(`proxy_link`/`proxy_chain`)와 연결되지 않는다.
`proxy_link`에 쓰는 경로는 수동 보정 스크립트(`calibrate.ts`) 하나뿐이라 신규
분석 산업의 S1 "가치사슬 연계" 테이블은 항상 비어 있다. 사용자 확인 사실.

## Decision

1. **`proxy_link.hop_type`에 `'structural'` 추가** (migration 0090, CHECK
   재정의 테이블 리빌드). structural hop은 변환 계수가 없다(coefficient/beta/r2
   NULL CHECK 강제) — 가치사슬 위상만 기록하며, 계수가 필요한 변환
   (convertViaProxyChain)은 이런 hop에서 의도적으로 실패한다(없는 데이터를
   있는 것처럼 변환하지 않는다). 통계 보정(calibrate)을 거치면 statistical로
   승격된다.
2. **제안 생성 (읽기 시점 계산, 별도 테이블 없음)**: `GET
   /api/market-overview/industry/{id}`가 최신 분석 payload의
   `chainDirection.relatedIndustries`를 `md_industry.name_ko`와 매칭해
   `proposals`(matched)와 `unmatchedProposals`(산업 마스터에 없는 이름)로
   반환한다. 제안은 LLM 산출이므로 영속화하지 않고 매번 payload에서 파생한다 —
   승인 전까지는 데이터가 아니다.
3. **승인 엔드포인트**: `POST
   /api/market-overview/industry/{id}/chain-links` (analyst+). body
   `{direction: 'upstream'|'downstream', industry_id, evidence_ref}` →
   `hop_type='structural'`인 `proxy_link` 행을 삽입하고 감사 로그를 남긴다.
   중복(from/to 동일 링크)은 거부한다. evidence_ref는 필수 — 무근거 링크 등록
   금지.
4. **S1 UI**: "가치사슬 연계" 섹션에 제안 칩(승인 버튼)과 미매칭 이름 후보를
   표시한다. 승인은 사람의 행위다(경계 #2).
5. **명칭 변경**: 사용자 화면의 "프록시 체인" → "가치사슬 연계"로 통일한다
   (S1 섹션 제목, 프로젝트 서브내비, 프록시 체인 탭 제목, 위원회 스탠스 문구,
   파이프라인 pendingInputs). 테이블·API 경로 등 기술 식별자는 유지한다.

## Consequences

- S1에서 도출한 가치사슬 구조가 사람의 승인을 거쳐 실제 연계 데이터로
  흘러간다 — S1 링크 테이블이 더 이상 시드 산업에서만 빈 값이 아니다.
- structural hop은 등급 산정의 통계 hop 가산 대상이 아니다 — 체인 신뢰도
  등급은 여전히 통계 hop 수만 가산한다(데이터 신뢰도가 등급을 상한하는 원칙
  유지).
- LLM이 제안한 산업명이 마스터에 없으면 후보로만 표시된다 — 임의 산업
  생성은 하지 않는다.
