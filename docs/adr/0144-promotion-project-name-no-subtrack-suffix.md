---
lang: ko
lang_reason: source-material
---

# ADR-0144 — 프로모션 프로젝트명은 기회명 그대로 (서브트랙 접미사 금지)

- Status: Accepted
- Date: 2026-09-23
- Deciders: New Business Review Lead (PM), 사용자 지시에 따름
- Related: ADR-0104 §2 (project charter — 이 결정이 그 구현 동작을 규정), ADR-0135 (route_decision 권위 행), ADR-0095 (프로모션 1:1 — 변경 없음)

## Context

`lib/project-charter.ts`의 `buildProjectCharter`는 승격(S7→S8) 시 프로젝트
표시명을 `${기회명} — ${route.sub_track}`으로 조합해 왔다. 이 동작은 어디에도
문서화되지 않은 코드만의 암묵적 규칙이었고, 사람이 읽는 제목에 기계 분류값이
붙는 결과를 낳았다 — 실제 데이터에서 `유압식 브레이커 — 유럽 Stage V 시장
공략 (전략 검토) — existing_business_rbd`,
`휴머노이드 로봇 사업 진출 (전략적 투자 경로) — strategic_investment` 같은
이름이 프로젝트 목록·보고서·브리핑에 그대로 노출됐다(사용자 지적,
2026-09-23). 거래 형태 정보는 이미 `route_decision.sub_track`(ADR-0135 권위
행)과 charter의 `subTrack` 필드에 구조화돼 있으므로 제목의 접미사는 중복
노출이었다.

## Decision

1. **프로모션 프로젝트명(`md_project.project_name`)은 기회명(`opportunity.name`)
   을 그대로 사용한다.** `buildProjectCharter`는 더 이상 서브트랙을 제목에
   덧붙이지 않는다.
2. **거래 형태(sub_track)는 분류 필드에만 기록한다** — `route_decision.sub_track`
   과 charter의 `subTrack`. 화면·보고서가 거래 형태를 표시할 필요가 있으면
   제목이 아니라 이 필드를 읽는다(기존 UI는 이미 트랙 칩으로 표시하므로
   소비처 변경은 없었다).
3. **회귀 테스트로 고정한다** — `tests/unit/project-promotion.test.ts`는
   `sub_track = 'existing_business_rbd'` 경로 의사결정 하에서도 이름이
   기회명과 동일하며 `charter.subTrack`이 분류를 유지함을 단언한다.
4. 이 결정은 ADR-0104 §2의 구현 동작을 규정할 뿐 그 결정 자체를 바꾸지
   않는다(0104는 명명 규칙을 명시한 적 없음). ADR 인덱스 규칙에 따라
   기존 기록을 수정하지 않고 본 ADR로 보강한다.

## Consequences

- 기존 데이터 정합화: dev DB의 PRJ-QGB2W5·PRJ-DSE4PW 두 행은 2026-09-23
  접미사를 제거해 수리했다(런타임 데이터, 저장소 밖). 운영 컨테이너 DB에
  접미사가 붙은 승격 행이 있다면 동일한 수동 rename이 필요하다(표시 전용
  데이터, 마이그레이션 불요).
- 접미사 문자열로 프로젝트를 식별하던 소비처는 없었다(저장소 전수 검색
  확인). 향후 신규 승격물은 규칙이 코드와 테스트 양쪽에 고정된다.
