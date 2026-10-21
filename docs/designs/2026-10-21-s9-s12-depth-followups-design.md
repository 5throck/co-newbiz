---
lang: ko
lang_reason: source-material
---

# S9–S12 깊이 보완 후속 — 절차 격차의 GO 예외 근거 편입, 2인 승인, 사이드카 폐기, 인센티브→자금조달, IC 4.5/4.6 생성 (Implemented)

- **일자**: 2026-10-21
- **상태**: Implemented (슬라이스 1~3의 "범위 밖·열린 결정" 5건을 decider 지시로 마감)
- **원 질의**: decider — "잔여 작업을 진행해줘" (직전 보고의 열린 결정 목록에 대한 진행 지시)
- **관련**: 2026-10-21-s9-s10-depth-…-design, 2026-10-21-s10-funding-certainty-s11-ic-review-steps-design(§2.5 갱신), 2026-10-21-s12-baseline-variance-and-learning-corpus-design, ADR-0122 #2, ADR-0123 #3, ADR-0104(브리핑 팩 E1), `procedures/_shared/deal-structuring` step 7, `procedures/_shared/entity-ic-review` step 4.5·4.6, `prompts/prompts.json`

## 1. 결정

| # | 항목 | 결정 |
|---|---|---|
| A | S11 절차 격차 → GO 예외 근거 | `icGoGapItems`에 `icStepGapItems`를 더한다. Kill Criteria 미기록/미판정/미충족·IC 메모 미기록·자금확정성 미충족이 누락 산출물로 나열되고, IC GO 기록 시 사람의 `gap_rationale`을 요구한다(R2-B item 3 — **차단이 아니라 근거 요구**). 쓰기 시점 검사이므로 기존 결정 행은 영향 없음. |
| B | 신뢰도 등급 조정 2인 규칙 | 제안자는 자신의 제안을 승인·반려할 수 없다(`self_decision_not_allowed`, 400). 화면은 제안자에게 결정 버튼 대신 안내 문구를 보인다. 캡 **상향**은 경계 #4에 반하므로 여전히 범위 밖. |
| C | 0156 사이드카 폐기 | 마이그레이션 0164: 사이드카 항목 중 원장에 없는 키를 `risk_assessment_ledger`로 복사(`by`/`at` 보존, 없으면 `migration-0164`/현재 시각)한 뒤 `md_project.risk_heatmap_assessment_json` 컬럼을 삭제. `lib/risk-assessment.ts` v2.0.0은 원장만 읽고 쓴다(parse/merge 헬퍼 제거). |
| D | 인센티브 → 자금조달 sources | `incentive.evidence_ref`(적격 증빙)를 등록 라우트·화면에 추가. 증빙과 NPV가 있는 행만 "→ 자금 조달" 버튼으로 `financing_sources_uses`에 `evidence_kind=subsidy_grant`, `evidence_ref="incentive:<id> · <증빙>"`으로 들어간다(step 7 "evidenced eligibility"). 화면 단위 억원 → 백만 KRW(×100) 환산을 토스트에 명시. |
| E | IC step 4.5 · 4.6 | 4.5: 프롬프트 `s11.integrated_insight`(process-governance-manager) 등록·레지스트리 재생성; `draft_insight_review` 액션이 IC 메모 컨텍스트로 LLM 초안(JSON: synthesis·tensions·open_questions·recommendation_note)을 반환 — **저장하지 않으며** 사람이 4.5 메모로 기록(LLM 미구성 시 결정론 폴백). 4.6: `attach_decision_deck`이 브리핑 팩(E1)을 생성·해시해 4.6 기록(`evidence_ref=briefing-pack:<hash>`) — 이 워크스페이스의 의사결정 덱은 브리핑 팩이다. |

## 2. 범위 밖
- 신뢰도 캡 상향(경계 #4), 기준선 차이의 분기 추세·알림, KPI 방향 메타데이터, 그룹 검토 2~4의 자동 산출.

## 3. 검증
- 유닛: `ic-review-steps.test.ts`(go_gaps에 절차 항목 포함, 4.5 초안 비영속·viewer 403, 4.6 덱 해시 기록, 인센티브 증빙 저장), `s9-depth-routes.test.ts`(2인 규칙 — 자기 승인 400·타인 승인 200), `risk-assessment.test.ts`(검증 함수만), `migration-0013.test.ts`(컬럼 목록 갱신), `ic-package.test.ts`(GO 기록에 `gap_rationale` 동반), `prompt-registry`·`mcp-prompts` 가드, OpenAPI·테이블 사이징·금지 용어 가드 통과.
- 타입: `bunx tsc --noEmit -p app/web-next/tsconfig.json` 무오류.
