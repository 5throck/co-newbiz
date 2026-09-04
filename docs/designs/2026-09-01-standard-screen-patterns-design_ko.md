---
lang: ko
lang_reason: source-material
---

# Design: 표준 화면 패턴 체계 (Standard Screen Patterns) — 2026-09-01

**Status**: Proposed (구현 착수 전 설계 확정 대기)
**Scope**: co-newbiz web S1~S11 전 단계 화면
**Design of record**: 본 문서
**선행 결정**: ADR-0082 (CRUD 상호작용 표준), ADR-0083 (시각 표준 — SectionToolbar·2-size 버튼·삭제 위계)
**SSOT**: `process/flow.spec.yaml` v2.0.0 — 단계·게이트·산출물·트랙은 화면 골격의 입력값

---

> **선행·상위 프로세스**: 본 문서는 디자인 프로세스 파이프라인(ADR-0087)의 ⑥ 단계에
> 해당한다. 토큰·스타일 가이드·아이콘 어휘표 산출물은
> `2026-09-01-design-process-establishment_ko.md`를 따른다.

## 1. 목적과 문제 정의

S1~S11은 단계마다 화면 성격이 다름(목록, 리포트, 채점, 체크리스트, 모니터링)에도
불구하고, 지금까지는 단계마다 페이지를 새로 구성해 왔다. ADR-0082/0083으로 버튼·헤더
수준의 일관성은 확보했지만, **페이지 구조 자체의 반복 재발명**은 남아 있다. 매번
"어디에 무엇을 둘지"를 새로 결정하는 비용과, 화면마다 다른 학습 비용이 계속 발생한다.

해법은 **소수의 화면 패턴(archetype)을 정의하고 모든 단계 화면을 패턴의 조합으로
귀결시키는 것**이다. 패턴은 고정된 템플릿이 아니라, **공통 골격 + 슬롯(slot)** 구조로
정의해 단계별 특수 요구는 슬롯을 채우는 방식으로 확장한다.

## 2. 설계 철학 (Design Philosophy)

1. **프로세스가 화면을 만든다 (Spec-driven)** — 화면 골격은 flow.spec의 단계
   메타데이터(이름·목적·게이트·requiredArtifacts·applicableTracks)에서 유도된다.
   스펙이 바뀌면 화면 골격이 따라가고, 화면만 단독으로 변하지 않는다.
2. **하나의 정신 모델 (One mental model)** — "목록 → 선택 → 상세/행동 → 기록"의
   흐름과 등록·수정·삭제·판정의 위치는 어떤 단계에서도 같다. 사용자는 단계 이름만
   바뀐 같은 화면을 경험한다.
3. **구조는 고정, 내용은 확장 (Fixed skeleton, extensible slots)** — 패턴은
   레이아웃·위계·상호작용만 고정한다. 콘텐츠 영역은 명시된 슬롯을 통해 단계별
   위젯(차트·채점표·체크리스트)을 받는다. 슬롯 밖의 자유 구성은 금지한다.
4. **판정은 사람, 구조는 시스템** — 채점·스코어카드는 결정을 구조화할 뿐 대신하지
   않는다(경계 #2). 모든 게이트·판정 화면은 사람 최종 승인 지점과 근거 필수 입력을
   화면 구조 자체에 내장한다.
5. **심미성은 절제에서 나온다 (Aesthetic restraint)** — 하나의 타이포 스케일,
   두 개의 버튼 크기, 정해진 간격 토큰, 저자극 색(상태 칩만 채도 사용)으로 통일한다.
   장식 요소를 추가하지 않고 반복 구조의 리듬으로 질서감을 만든다.

## 3. S1~S11 단계 분석

| 단계 | 질문 | 본질적 화면 행위 | 트랙 | 게이트 | 화면 성격 |
|---|---|---|---|---|---|
| S1 시장분석 | 시장인가? | 8단계 분석 실행 → 리치 리포트 열람 | GF/BF | Pre-FS | 목록 → 탭 리포트 |
| S2 기회발굴 | 사업인가? | 발굴·요인 도출·매력도 평가·퍼널 관리 | GF/BF | Screening | KPI + 목록 + 행 확장 |
| S3 시너지·적합성 | 우리에게 맞는가? | 시너지/적합성 분석 → Go/Hold/Kill 판정 | GF/BF | Screening | 목록 → 탭 리포트 + 판정 |
| S4 진출방식 결정 | 어떻게? | 의도 분기 → 5기준 채점 → 트랙·라우트 확정 | GF/BF | Screening·Pre-FS | 단계 폼(채점) + 이력 |
| S5 역량 평가 | 스스로 가능? | 격차 평가 → Build/Partner/Hire/Invest | GF | Pre-FS | 체크리스트·전략 선택 |
| S6 대상 후보 발굴 | 누구와? | Universe 정의 → Long List 관리 | BF | Pre-FS | 목록 관리 |
| S7 대상 스크리닝 | 유망한가? | knock-out + 스코어카드 → Short List 승격 | BF | Target Screening | 목록 + 판정 |
| S8 사업성 분석 | 돈이 되는가? | 밸류에이션·Business Case 정량 분석 | GF/BF | FS | 분석 실행 → 리포트 |
| S9 실사·검증 | 사실인가? | DD 체크리스트·증적 수집 | GF/BF | DD | 탭 리포트 + 체크리스트 |
| S10 투자심사·실행 | 투자할 것인가? | IC 패키지 심사·승인 → 설립 실행 | GF/BF | Entity IC·Group IC | 판정 + 실행 체크리스트 |
| S11 사후 관리 | 궤도에 올랐는가? | 분기 스코어카드·포트폴리오 전환 | GF/BF | — | 모니터링 대시보드 |

분석 결과, 11단계의 화면 행위는 **5가지 동형(同型) 클래스**로 수렴한다.

## 4. 패턴 인벤토리 (5 + 1)

> 패턴 수는 5개. 새 단계가 추가되어도 조합으로 대응하고, 정말 새로운 행위 클래스가
> 나타날 때만(예외적 절차로 ADR 승인 시) 패턴을 추가한다.

### P0 공통 골격 — StageFrame (모든 패턴의 외피)

```
┌ PageHeader: S{번호} {단계명} + objective 한 줄
├ StageRail: S1→S11 진행 위치 · 현재 트랙 · 통과/대기 게이트 칩
├ ── 패턴 본문 (P1~P5 중 1) ──
└ FooterSlot: 관련 절차·체크리스트·스킬 링크 (flow.spec 참조)
```

- StageRail은 `flow.spec.stateTransitions`와 `gates`에서 자동 유도 — 단계 진행
  표시를 각 페이지가 따로 만들지 않는다.
- 트랙에 해당 없는 단계(GF에서 S6·S7)는 레일에서 비활성 + "트랙 미적용" 처리.

### P1 Registry — 목록·퍼널형 (S2, S6, S7의 목록 부분)

```
KPI 요약 카드(선택) ─ SectionToolbar(제목·건수 · 검색/필터 슬롯 · 액션)
└ data-table: 행 = 엔티티, 액션 셀(우측·btn-sm) , 행 확장 패널(선택)
```

- 행 확장 패널: 채점·평가 같은 경량 편집을 행 아래에서 (S2 매력도·요인).
- 확장 슬롯: `kpiCards`, `filters`, `rowExpansion`.

### P2 Report — 리포트형 (S1, S3 리포트, S8, S9)

```
마스터: Registry 또는 칩 선택 ─ 디테일: DataTab 탭 리포트
└ 탭 = 개요/본문(단계별) / 근거·출처 / 검증·한계 (+ 재분석 액션)
```

- 모든 리포트는 **출처·검증 탭을 의무 포함**(RAG·출처 표기 원칙의 화면 반영).
- 분석 파이프라인이 있는 경우 재분석 버튼(툴바 액션)과 버전(vN) 표시.
- **데이터 표현 표준 (ADR-0088)**: 시계열 수치는 차트+피벗 테이블 병기, 장문 나열은
  블릿 목록, 4열 이상 장문 표는 스크롤 래퍼+열 최소폭, 수치에 단위·출처 병기,
  무결성 경고는 배너 노출. (CSS: `report-chart-card` / `report-bullet-list` /
  `table-scroll` + `report-table`)
- 확장 슬롯: `tabs`(순서 보존 추가 가능), `reportHeader`(버전·분석일·메타).

### P3 Decision — 결정·채점형 (S3 판정, S4, S7 판정, S10 IC)

```
Stage 1 분기/선택(카드) ─ Stage 2 채점·판정 폼(근거 필수) ─ 결정 이력 테이블
└ 실시간 합산·규칙 배너(배제·권고) · 사람 최종 확인 버튼
```

- 채점표는 기준×점수×근거 3열이 표준(근거 없는 채점은 제출 불가 — S4 선례).
- 규칙 결과(사전배제·스테이징 권고)는 배너로 노출하되 판정을 대체하지 않는다.
- 이력은 append-only: 재결정은 새 행. 채점 근거는 hover 상세로 열람.
- 확장 슬롯: `stageOne`(분기 UI), `criteria`(채점 기준 정의), `rules`(배너).

### P4 Execution — 실행·체크리스트형 (S5, S9 체크리스트, S10 설립 실행, S8 파이프라인 진행)

```
진행 헤더(n/m 단계 · 상태 칩) ─ 단계별 카드(상태 어휘: pending/in_progress/
done/halted/escalated) ─ 각 단계: 증적 링크 + 담당 + 비고
```

- 상태 어휘는 절차 kill criteria의 액션과 1:1(halt→halted, escalate→escalated).
- 완료 강제 규칙이 있으면 화면에서도 동일 적용(선행 단계 미완료 시 done 불가 — S10 선례).
- 확장 슬롯: `steps`(단계 정의), `evidence`(증적 위젯).

### P5 Monitoring — 모니터링형 (S11, 대시보드)

```
KPI/스코어카드 카드 ─ 추이 차트 ─ 주기 갱신 기록(분기) ─ 전환 결정 어휘 액션
```

- 결정 어휘(예: portfolio 5종)는 flow.spec의 어휘와 1:1로 버튼화.
- 확장 슬롯: `metrics`, `trend`, `cycleActions`.

## 5. 단계 → 패턴 매핑

| 단계 | 패턴 | 조합 비고 |
|---|---|---|
| S1 | P2 Report | 마스터=P1 산업 목록, 탭=8단계 |
| S2 | P1 Registry | kpiCards + rowExpansion 사용 |
| S3 | P2 Report + P3 Decision | 회사 등록·리포트(P2) + Go/Hold/Kill 판정(P3) |
| S4 | P3 Decision | stageOne=의도 분기, criteria=5기준 |
| S5 | P4 Execution | 격차 평가 단계 + 진출전략 선택(P3 경량) |
| S6 | P1 Registry | Universe 정의 문서 카드 + Long List |
| S7 | P1 Registry + P3 Decision | 목록 + knock-out/스코어카드 판정 |
| S8 | P4 Execution + P2 Report | 파이프라인 진행 → 결과 리포트 |
| S9 | P2 Report + P4 Execution | DD 리포트 + 체크리스트 |
| S10 | P3 Decision + P4 Execution | IC 판정 + 설립 실행 5단계 |
| S11 | P5 Monitoring | 분기 스코어카드 |

**복합 단계 규칙**: 한 단계가 복수 패턴이면 본문을 위→아래 순서로 배치하고,
섹션 사이에 `market-section` 간격 표준을 유지한다. 패턴 전환 지점은 항상
SectionToolbar로 구분한다.

## 6. 확장 메커니즘

1. **프리미티브 조합**: 패턴은 `components/layout.tsx`(SectionToolbar 등)와
   `components/crud.tsx`(ConfirmDialog·RowEdit) 프리미티브의 합성으로만 정의된다.
   패턴 내부에서 자유 마크업을 만들지 않는다.
2. **슬롯 계약**: 각 패턴은 문서화된 슬롯만 노출한다. 슬롯 props는 문자열이 아니라
   위젯 자리이며, 새 위젯을 넣는 것은 패턴 수정이 아니다.
3. **스펙 구동**: StageFrame은 flow.spec 메타데이터를 props로 받는다
   (`stageId` → name/objective/gates/stateTransitions). 로컬 하드코딩 금지.
4. **패턴 신설 절차**: 새 행위 클래스가 필요하면(기존 5패턴으로 불가) 설계 문서
   개정 + ADR로만 추가한다. 이는 "수십 개로 늘어나는 것"을 구조적으로 막는 장치다.
5. **위반 검출(후속)**: design-lint로 "패턴 컴포넌트 없이 헤더/액션 셀을 직접
   구성하는 페이지"를 검출하는 스크립트를 추가할 수 있다(별도 작업).

## 7. 구현 로드맵 (순서)

1. **StageFrame + StageRail** 신설 → 기존 페이지 3종(market, opportunities, our-company)에 적용해 골격 검증.
2. **P3 Decision** — S4(이미 구현)를 기준 구현으로 문서화하고, S7 판정·S10 IC를 동일 구조로 재편.
3. **P4 Execution** — S10 설립 실행 API(구현됨)를 기준으로 S5·S9 적용.
4. **P1/P2 정리** — 기존 Registry·Report 화면을 슬롯 계약에 맞게 리팩터링(신규 코드 최소).
5. **P5 Monitoring** — S11 화면 재구축 시점(ADR-0078 연기 결정 해제 시)에 적용.
6. 각 단계마다 tsc·build·스펙 테스트 통과를 게이트로.

## 8. 거버넌스

- 본 설계의 채택·첫 적용은 **ADR-0086**으로 기록한다.
- 패턴 정의 변경(슬롯 추가 포함)은 본 문서 개정 + ADR, 위젯 단위 추가는 컴포넌트
  문서화만으로 가능하다 — 변경 비용의 비대칭이 확장성의 핵심이다.
- 사용자 경험 회귀 테스트: 패턴 골격이 flow.spec과 일치하는지 검사하는 unit test를
  process-flow 테스트에 추가한다(단계 id ↔ 라우트 매핑, 게이트 칩 표시).


## 개정 2026-09-04 — 내비게이션 등록 규칙 (ADR-0105)

표준 화면은 "만드는 것"으로 완료되지 않는다. 모든 신규 화면(page.tsx)은 같은
PR에서 다음을 만족해야 한다:

1. `app/web-next/lib/navigation.ts`(내비게이션 SSOT)에 등록 — 섹션·순서는
   flow.spec 단계 순서를 따른다. 상세 화면(프로젝트 하위 등)은 NON_MENU_ROUTES
   에 명시적으로 기재하고 ProjectSubNav 등 상위 진입점을 제공한다.
2. `tests/unit/navigation.test.ts` 패리티/순서 검증을 통과한다.
3. 문서(ui-spec as-built)에 화면을 반영한다.

근거: 메뉴 하드코딩으로 신규 화면이 메뉴에서 누락되고 순서가 드리프트한
2026-09-04 프로젝트 리뷰finding.


### 개정 2026-09-05 — 목록 테이블 정렬 정합 + 목록 복귀 버튼 단일 패턴

1. **테이블 정렬 정합**: 헤더(th)와 셀(td)의 정렬은 반드시 일치시킨다. 텍스트
   목록형 컬럼은 th·td 모두 좌측 정렬(ADR-0088의 기본 중앙정렬은 코드·짧은
   열에 한해 적용). 식별 컬럼(이름/번호)을 반드시 첫 열로 두고, colgroup 또는
   minWidth로 과대 분산을 막는다. 헤더 수와 셀 수는 항상 1:1이다.
2. **목록 복귀 버튼 단일 패턴**: 상세 화면의 목록 복귀는
   `components/ListBackButton.tsx`로 통일한다 —
   - URL 기반 상세: Topbar 좌측 back-link(공용, AppShell이 렌더링);
   - 상태 기반 상세: SectionToolbar actions 좌측의 ListBackButton(onClick).
   화면별 자체 구현·자체 라벨 금지. 뒤로가기 버튼은 화면 상단(topbar)에 위치한다.

### 개정 2026-09-04 — 단계 설명 문구 표준 (StageFrame children 서식)

StageFrame의 children은 "단계 설명 문구" 슬롯이다. 프레임이 서식을 표준화하므로
페이지별 클래스·마크업 금지:

1. **서식(프레임 책임)**: 0.9rem · muted-fg · leading-relaxed · 하단 간격 mb-4 —
   StageRail과 본문 첫 컴포넌트 사이 간격이 모든 단계 화면에서 동일하다.
2. **마크업 금지**: `<strong>` 등 강조·별도 `<p>` 분리 금지. 기술 식별자
   (체크리스트 ID 등)만 `<code>` 허용.
3. **문체**: 종결어미 "~합니다." 통일, 1~3문장, 절차·ADR 참조는 문미 괄호
   (예: "(ADR-0090)")로 배치한다.
4. 위반 예(수정 전): S1은 프레임 밖 `<p>`로 분리(폰트·간격 불일치),
   S3·S5는 `<strong>` 리드(강조 불일치) — 2026-09-04 일괄 정정.
