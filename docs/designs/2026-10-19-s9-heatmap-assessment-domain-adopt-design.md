---
lang: ko
lang_reason: source-material
---

# S9 정비 — 리스크 히트맵 사람 판정·S9 이동, 참고용 실사 탭 사람 옵트인, 조사내역 정정, 검토 배지 절제 (Implemented)

- **일자**: 2026-10-19 / 2026-10-20 (사후 기록 — 구현은 CHANGELOG 2026-10-19·2026-10-20 항목과 PR #672~#677에 먼저 들어갔고, 이 문서는 설계 레지스트리 공백을 메운다)
- **상태**: Implemented
- **원 질의**: decider — "참고용 탭 존재 이유?", "히트맵은 S9 산출물 아닌가", "△ AI 작성·검토 전은 필요한 문구일까?", "조사내역(dd_finding)을 어떻게 반영하는지 알기 어렵다", "CoC 풀네임 병기"
- **관련**: ADR-0122 #2(리스크 히트맵), ADR-0148(S9 7도메인), ADR-0160 addendum c(컷오프 이전 프로젝트의 참고용 도메인), ADR-0099 §4(산업 맞춤 제안), 2026-10-19-brownfield-capability-dd-design

## 1. 리스크 히트맵 — 사람 판정 오버라이드 + S9 더보기로 이동

- **문제**: 히트맵(ADR-0122 #2)은 DD 발견사항·고객 집중·클로백을 가능성×영향 격자에 자동 플로팅했는데, 가능성이 상수(2)로 하드코딩되어 사람이 바로잡을 길이 없었고, 입력의 대부분이 S9 실사 산출물인데 S8 더보기에 있었다.
- **결정**: 사람(분석가+)이 항목별 가능성·영향(1~3)을 기록하면 자동값을 덮어쓴다. 저장은 `md_project.risk_heatmap_assessment_json`(마이그레이션 0156), 라우트 `GET/PUT /api/projects/{id}/risk-assessment`, 감사 `risk_assessment.recorded`, 경계 #2(사람만). 항목 키는 안정 식별자(`dd:<finding id>` / `coc:<id>` / `inc:<id>`)로 바꿔 설명 변경에 흔들리지 않게 했다. 탭 위치는 S8 더보기 → **S9 더보기**(고객 CoC·보상·형평 옆). 완화 판단은 여전히 사람(경계 #2)이며 스냅샷은 투자심의 자료에 첨부 가능.

## 2. 참고용 실사 탭 — 사람 옵트인으로 판정에 반영

- **문제**: ADR-0160 addendum c에 따라 2026-10-01 이전 생성 프로젝트는 재무·인사·시장·자금조달 도메인을 "참고용"(`counted: false`)으로만 기록했는데, 실제로 그 실사를 수행한 딜에서는 판정에 반영할 길이 없었다.
- **결정**: 분석가+가 근거(10자 이상)를 적고 확정하면 해당 도메인들이 완료 집계와 게이트 판정에 들어간다(`dd_domain.adopted`), 되돌릴 수 있다(`dd_domain.reverted`). 저장 `md_project.dd_domain_adopt_json`(마이그레이션 0155), 라우트 `GET/POST/DELETE /api/projects/{id}/dd-domain-adopt`. 집계 규칙 `newerDomainsCounted` = 생성일 컷오프 **또는** 사람 채택. 산업 맞춤 제안 대상 도메인은 7개 전부(`DD_TAILOR_DOMAINS = DD_DOMAINS`)로 넓혔고 폴백 템플릿은 한국어다.

## 3. 조사내역(dd_finding) 정정·삭제, CoC 플래그→조사내역

- **결정**: 분석가+가 조사내역을 정정(`PUT /dd/findings`, 감사 `dd_finding.update`)·삭제(`DELETE`, `dd_finding.delete`)할 수 있고, 삭제도 감사 로그로 추적된다(S10/IC가 이력 참조). 고객 집중·CoC 화면은 Change of Control 풀네임을 병기하고, 플래그된 계약 건은 조사내역으로 등록되어 S9 흐름에 들어간다.

## 4. 검토 배지 절제

- **결정**: 체크리스트 행의 인라인 `△ AI 작성·검토 전` 칩을 제거하고 항목 id의 툴팁에만 남긴다. 법무 검토됨/확정 칩과 3단계 검토 스트립의 건수는 유지. 어휘(`checklist-review-status.ts`, 용어집)는 변경 없음.

## 5. 검증

- 유닛: `risk-assessment.test.ts`, `dd-domain-adopt` 관련 테스트, `brownfield-dd-view.test.ts`(배지 절제 소스 핀), `stage-tabs.test.ts`(히트맵 S9 더보기 소속).
- 브라우저: 히트맵 S9 더보기 노출·S8 더보기 소실, 판정 저장 토스트와 "판정됨" 칩, 체크리스트 행 배지 0건·툴팁 유지.

## 6. 범위 밖

- 히트맵 완화 조치(mitigation) 기록 — 별도.
- 참고용 탭 옵트인의 게이트 규칙 변경 알림(결정 대기함 연동) — 별도.
