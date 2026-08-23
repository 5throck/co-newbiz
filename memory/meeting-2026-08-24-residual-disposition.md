# 미팅 — D-라운드 잔여 사항 처분 (2026-08-24)

## 아젠다 및 목적

D-라운드(PR #102–#104: kill-criteria 분류 + E.4 스코어카드 풀체인) 완료 후 남은 잔여 3범주의 처분 방향을 리드 회의로 결정지원한다:

1. **R9** 절차 실행 오케스트레이터 (유일 class-D 개발 잔여)
2. **class C** 사용자 결정 대기 항목
3. **선택 백로그** (class (iii) 25변수 파종 · 템플릿 8/59 · R6)

세션 구성: PM(의장) + process-governance-manager(기능 도메인) + platform-lead(기술 도메인). 산업·지역 리드는 본 안건과 무관해 불소집. 결정지원 회의 — 판정은 인간(경계 #2).

---

## 관점별 발언 (round 1)

### 1. platform-lead (기술/build-run 도메인)

- **R9 지금 착수**: `newbiz.ts` CLI는 결정적 계산만(proc:resolve/rag/watch:run/scorecard:rollup) 하고 절차의 단계별 실행은 전부 수동. D-round 이후 실행기계가 절차 YAML·평가 스키마를 신뢰할 수 있게 된 지금이 실행 계층을 얹을 최저리스크 시점.
- **R9 MVP 스코프**: (1) run lifecycle 지속(procedure_run), (2) step 상태머신(pending/in_progress/blocked/done), (3) agent-dispatch 루프(step의 agent_key/skill_key/output_type 읽어 산출물 링크 기록), (4) 인간 단계 pause/resume. **과잉 배제**: 자동 재시도/스케줄러, 다중 run 동시성 최적화, UI 절차 뷰어, 에이전트 계정화, kill-criteria 자동 트리거링(0023 평가 결과를 읽어 상태 반영만).
- **런타임 리스크 3종**: run 중복 생성(resolve 결과 시점 변동 → run에 resolved snapshot JSON 고정 필요), 부분완료 run의 재개 의미론, 재개 권한 경계(아무나 resume하면 경계 #2 훼손).
- class (iii) 파종은 R9과 같은 파일(db/lib·migrations·proc-resolve)을 만져 경합이 실재 → 보류 권고.

### 2. process-governance-manager (기능/절차·정책 도메인)

- **R9 순서 변경(지금 하지 말 것)**: 병목은 "실행 주체 부재"가 아니라 "판정 기준 부재". 임계값 없는 오케스트레이터 = ILLUSTRATIVE 값으로 게이트를 통과시키는 의사-자동화. 착수 조건: class C 패키지 결정 + 실딜 1건 수작업 전 절차 통과(axis C가 A/B의 품질 검증).
- **class C가 유일한 실작업**(단, 에이전트가 할 수 있는 건 결정 패키지 조립뿐 — 경계 #2). `docs/decisions/` 4초안 + ADR-0052 (a)–(d)를 단일 안건집으로. (감사의 `docs/decisions/open/` 경로 표기는 실재하지 않음 — 정정 요청.)
- **25개 파종은 조건부**: 임계값이 wording에 이미 결론난 항목(#18 ip_assignment 등 completeness fact)은 상류 결정 없이 파종 가능 — "전부 임계값 이후" 일괄 미루기에 반대. ADR-0060 §3의 차원별 ADR 규율은 준수.
- **함정 2개 채택**: `is_null`-over-routing-var 금지(`project.origin` 등 — 스냅샷 미러링 결정 전까지), `market.bargaining_power_hhi` 독점금지 변수 재사용 금지. 임계값 반영 PR은 `_validate.ts` anti-tamper 게이트(`enabled:true` ⇒ `policy_id`+`thresholds_source`) 통과 명시 확인 — ILLUSTRATIVE 자동 승격의 유일한 방어선.

---

## 의장 종합 (PM)

**수렴**: class C 패키지 조립이 지금 에이전트가 할 유일한 실작업 / 템플릿 확대·R6 하지 말 것 / 25개 일괄 파종 금지 / R9 설계 게이트 공통 조건(human-authority pin 4개 우회 불가·판정승인 자동화 금지·계정화 금지·ILLUSTRATIVE 승격 차단).

**분기(R9 시점) 판정**: 기능 리드 측에 무게를 두고 조건부 절충 — "임계값 → 파종 → R9 설계 → (실딜 1건 or 사용자 명시 GO) → R9 구현". 근거: ① evaluator+ledger(0023)+rollup 체인이 이미 랜드되어 임계값 가치 실현에 오케스트레이터 불필요(기술 리드 주장의 사실 반박 성립) ② 실딜 1건도 통과한 적 없는 상태의 자동화는 잘못된 것의 자동화 ③ 기술 리드의 MVP 골격·리스크 3종은 R9 설계 ADR 기본골격으로 채택(설계는 반영 라운드와 병행 가능) ④ "실딜 1건" 전제는 무기한 대기 위험 → 사용자 명시 GO로 대체 가능.

---

## 회의 후 전제 정정 (PM, 2026-08-24 — 기록 필수)

회의는 감사 보고서의 class C 서술을 전제로 진행됐으나, 회의 후 git 이력 검증으로 **그 전제의 절반이 오류였음**이 확인됐다:

- market/risk/technical-execution RAG 임계값 + substitution 어휘는 **이미 2026-08-23 사용자 승인 완료**("go", #86 `dbed8f1` — 감사 베이스라인 `2b61403`에 선행). 룰 레이어 활성(마이그레이션 0022, 18/19행 enabled=1)까지 랜드. Green 상한은 승인 기록이 명시적으로 유지.
- 감사 §4 R7·§5-2의 "awaiting approval" 서술은 **stale-on-arrival** — 같은 PR에서 정정 마커로 수정. ADR-0052 open questions 헤더도 상태 동기화.
- 기능 리드가 제안한 안건 순서 1번(RAG 3+1)은 **이미 결정 완료로 무효**. 남은 진짜 class C: **(a) TRL/MRL 게이트별 컷오프 · (b) JV 가중치/주기 · (c) 시너지 인증+90일 이탈 · (d) 딜쉐이프 선택 임계값 · 캘리브레이션 코퍼스(→Green 상한) · 안트러스트 #13 역전 yes/no**. (b) 우선 논리(E.4 체인에 값만 채우면 즉시 효용)는 유효.
- 파생 효과: RAG 승인으로 class (iii) 중 "임계값 미결"이 블로커였던 변수들이 **이제 파종 가능** — 결정 팩의 "what each decision unlocks" 섹션 + ADR-0060 표에서 변별.

---

## 결정 및 행동 항목

| # | 항목 | 소유자 | 상태 |
|---|---|---|---|
| 1 | 결정 팩 조립(`docs/decisions/2026-08-24-residual-decisions-pack.md`) — (b) 우선 (a)(c)(d)·코퍼스·안트러스트 + "RAG 이미 승인" 명시 | docs-writer → PM 게이트 | 이번 PR |
| 2 | 감사 R7/§5-2 stale 정정 + ADR-0052 상태 동기화 | PM | 이번 PR |
| 3 | 사용자 결정(회의 또는 비동기) — 팩 기반 | 사용자 | 패키지 수령 후 |
| 4 | 임계값 반영 PR(anti-tamper 게이트 명시) → unlock 변수 차원별 ADR 파종 → executable 재기준화 | PM + specialists | 결정 후 |
| 5 | R9 설계 ADR(MVP 골격 + 게이트 조건 + 리스크 3종) — 4와 병행 가능 | platform-lead 설계, PM 게이트 | 별도 승인 |
| 6 | R9 구현 — 전제: 실딜 1건 수작업 통과 or 사용자 명시 GO | build/run 클래스 | 조건 충족 시 |

**명시적 제외**: R6 검증 · 템플릿 확대 · 25개 일괄 파종 · 안트러스트 역정(회의 yes 전까지) · 임계값 없는 R9 착수.
