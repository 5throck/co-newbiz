---
lang: ko
lang_reason: source-material
---

# 플로우 콘솔 UX 벤치마크 노트 (Flow Console UX Benchmark) — 2026-10-24

> **근거**: `docs/designs/2026-09-15-runtime-pm-agent-orchestration-design.md` §6.5의
> "UX 벤치마크 노트 예약 슬롯 (Row 2 산출물)". 본 문서는 그 슬롯을 채우는 부록
> (addendum)이며, 화면 설계는 이 노트의 근거를 인용하는 형제 문서
> [`2026-10-24-flow-console-screen-design.md`](2026-10-24-flow-console-screen-design.md)에 둔다.
> **조사 방법**: 아래 나열한 공식 문서 URL을 실제로 패치(WebFetch/curl)해 읽은 내용만
> 기록했다. 패치에 실패한 소스는 §5에 명시하며, 문서화되지 않은 제품 기능을 추측해
> 쓰지 않았다. **작성 주체**: ux-designer-agent (Row 2, PM 디스패치).

---

## 1. 조사 대상과 분류

3개 카테고리, 8개 제품(실패 2개 별도 기록). 각 항목: **패턴 → 해결하는 문제 → 관찰된 UI 어포던스 → 출처**.

### 1.1 카테고리 A — LLM 관찰가능성 콘솔

#### A1. LangSmith (LangChain)

| # | 패턴 | 해결하는 문제 | 관찰된 UI 어포던스 |
|---|---|---|---|
| A1-1 | **Threads / Traces / Runs 탭 분할 + 사이드 패널 상세** | 실행 목록(밀도)과 단일 실행 심층(맥락)을 한 화면에서 오가게 한다 | 프로젝트 표에서 행 클릭 → 사이드 패널 열림. 패널 안에 Trajectory / Turns / Details 3개 뷰 |
| A1-2 | **Trajectory 뷰 (대화 계층)** | 멀티스텝 실행을 사람이 읽는 순서로 본다 | 턴별 블록에 모델 응답·도구 호출·결과를 묶어 렌더. 블록 메타 행에 토큰·비용·모델명, "LLM call" 링크로 Details 점프. 확장 사고(Thought) 블록은 기본 접힘, 서브에이전트는 인라인 + 중첩 뷰, 병렬/반복 도구 호출은 하나의 확장 행으로 그룹핑 |
| A1-3 | **Details 뷰 (디버깅 계층)** | 특정 런의 원시 입출력·타이밍·오류·토큰·자식 런을 확인 | `run_type`에 따라 렌더 분기(llm=토큰/지연, retriever=문서 인라인, tool=자동 확장). 단축키 T/D로 뷰 전환 |
| A1-4 | **실험 비교 표: Compact / Full / Diff 뷰 전환** | 여러 실험의 결과를 같은 예제 축에서 비교 | 상단 토글로 뷰 전환, Diff는 2개 실험 한정 텍스트 차이 강조(JSON/YAML 표시 지원) |
| A1-5 | **개선/악화 하이라이트 + 헤더 카운트** | 어느 방향이 나아졌는지 즉시 판독 | 소스 실험 대비 개선=녹색, 악화=적색 하이라이트. 열 헤더에 better/worse 카운트 버튼 → 클릭 시 해당 행만 필터 |
| A1-6 | **소스 실험 지정** | 비교 기준점을 명시적으로 만든다 | 실험 아이콘 호버 → "Set as source experiment" |
| A1-7 | **플레이그라운드 데이터셋 실행** | 프롬프트를 수동 실행이 아니라 예제 세트에 대해 검증 | "Test over dataset" 드롭다운, Start/Cmd+Enter 실행, 실행 중 Progress 열·진행바, `+Evaluator` 버튼으로 코드 없이 평가자 부착, 입력 변수와 데이터셋 키 일치 강제(변수 15개 상한) |

출처: §4의 [S1], [S2], [S3], [S4].

#### A2. Langfuse

| # | 패턴 | 해결하는 문제 | 관찰된 UI 어포던스 |
|---|---|---|---|
| A2-1 | **Timeline(지연 워터폴) 뷰** | 한 트레이스 안에서 어느 단계가 시간을 먹는지 판독 | trace에서 latency issue를 timeline/waterfall로 검사 |
| A2-2 | **프롬프트 버전 관리 + 버전 간 지표 비교** | 프롬프트 변경이 비용·지연·품질에 미친 영향을 추적 | UI에서 프롬프트 생성·버전 관리, 라벨로 환경 배포, 버전별 latency/cost/eval 점수 비교, trace와 프롬프트 연결 |
| A2-3 | **대시보드(품질·비용·지연)** | 서비스 수준 추세 감시 | dashboard에서 quality/cost/latency 지표 플롯 |
| A2-4 | **Agent Graph 시각화** | 복잡한 에이전트 워크플로 구조를 그래프로 이해 | agent workflow를 graph로 시각화 |
| A2-5 | **Annotation Queue** | 사람 검수 작업을 큐로 운영 | 사람 어노테이션 워크플로를 별도 큐 표면으로 분리 |

출처: [S5].

#### A3. Braintrust

| # | 패턴 | 해결하는 문제 | 관찰된 UI 어포던스 |
|---|---|---|---|
| A3-1 | **플레이그라운드 그리드 + 셀 스트리밍** | 여러 프롬프트·설정을 동시에 돌리고 결과를 즉시 수집 | 태스크(열) × 예제(행) 그리드, 결과가 그리드로 스트림. Run 또는 Cmd/Ctrl+Enter 전체 병렬 실행, 단일 태스크/행 실행도 가능 |
| A3-2 | **Diff 모드 + 비교 등급 필(pill)** | base와 변경안의 차이를 방향성까지 붙여 판독 | base 태스크를 diff 소스로 지정, 출력 차이·점수 변화·타이밍/토큰 변화를 하이라이트, 비교 열에 "Improvement / Regression / Tradeoff / Tie" 등급 필 표시 |
| A3-3 | **셀 단위 선호 기록(썸업/다운 + 코멘트)** | 사람의 판단을 즉시 신호로 포착 | 셀별 thumbs up/down + 자유 텍스트 코멘트 |
| A3-4 | **+ Experiment로 불변 스냅샷 승격** | 재실행이 결과를 덮어쓰므로, 좋은 설정은 고정 | 결과는 가변(재실행 시 덮어씀) — 좋은 구성은 "Promote to an experiment"로 불변 스냅샷화 |
| A3-5 | **URL 공유** | 협업·검토 전달 | 플레이그라운드를 URL로 공유 |

출처: [S6], [S7].

#### A4. Arize Phoenix

| # | 패턴 | 해결하는 문제 | 관찰된 UI 어포던스 |
|---|---|---|---|
| A4-1 | **트레이스 스팬 디버깅** | 한 실행을 단계별로 본다 | 모델 호출·검색·도구·커스텀 로직을 스팬으로 캡처, 스팬 단위 디버깅 |
| A4-2 | **사이드바이사이드 플레이그라운드 비교** | 프롬프트 변형을 나란히 검증 | 프롬프트 변형을 side-by-side 비교, 버전 관리·데이터셋 테스트·replay 지원 |
| A4-3 | **Span Replay** | 운영 예제로 실제 호출을 재실행 | "replaying LLM calls with different inputs" — 다른 입력으로 LLM 호출 재실행 |
| A4-4 | **트레이스→데이터셋 전환** | 운영 사례를 회귀 자산으로 | 트레이스를 그룹핑해 데이터셋화, 앱 버전별 재실행·비교 |

출처: [S8].

#### A5. W&B Weave (Agent Lens)

| # | 패턴 | 해결하는 문제 | 관찰된 UI 어포던스 |
|---|---|---|---|
| A5-1 | **대시보드 요약 카드** | 건강 상태를 한눈에 | Spans·Conversations·Tokens·Cost·Error rate·Agents 카드 + 시계열 차트, 시간창 선택기가 전 패널 구동 |
| A5-2 | **에이전트 카드 그리드** | 에이전트별 비용·지연·오류 비교 | 에이전트별 카드(마지막 활동, 버전 수, 활동 히스토그램, 대화·스팬 수, 비용, 평균 지연, 오류율 — 오류율>0이면 적색), 정렬 기준 선택 |
| A5-3 | **트레이스 워터폴 바 차트 + 트리 토글** | 지연 병목과 병렬 실행 파악 | 행 클릭 → 같은 trace ID 스팬 하이라이트 + 막대 워터폴(자식 스팬이 실제 duration 비율 막대), "Show trace tree" 아이콘으로 계층 트리 전환 |
| A5-4 | **Columns 버튼 + 헤더 호버 필터** | 표 밀도를 사용자가 제어 | 커스텀 속성을 열로 노출, 헤더 호버로 값/범위 필터 |
| A5-5 | **턴 상세의 토큰/비용 라인** | 호출 단위 경제성 | assistant 메시지에 모델·토큰·비용 라인(예: `18823 in · 96 out · $0.0717`), 캐시·추론 토큰 분해 |

출처: [S9].

### 1.2 카테고리 B — 파이프라인 런 뷰

#### B1. Dagster

| # | 패턴 | 해결하는 문제 | 관찰된 UI 어포던스 |
|---|---|---|---|
| B1-1 | **Runs 페이지 필터 + 런 상세 Gantt** | 런 목록 검색과 지연 분석 | job/run ID/상태/태그 필터, 런 상세에 "각 asset/op 실행 시간" Gantt + 필터 가능한 이벤트/로그 패널 |
| B1-2 | **Re-execute 버튼 + 재실행 런 그룹핑** | 같은 구성 재실행과 그 계보 추적 | 동일 config로 재실행, 관련 재실행 런을 우측 패널에 그룹핑 |
| B1-3 | **카탈로그 필터 + 저장된 선택** | 대규모 자산 목록 탐색 | asset key/kind/group/tag 필터, Dagster+는 저장된 필터 세트 공유 |
| B1-4 | **Overview("factory floor")** | 전체 활동 요약 | Runs/Jobs/Schedules/Sensors 탭별 요약 |

출처: [S10].

#### B2. Airflow

| # | 패턴 | 해결하는 문제 | 관찰된 UI 어포던스 |
|---|---|---|---|
| B2-1 | **Grid View (행=태스크, 열=런)** | 상태 히트맵으로 실패·재시도 패턴 판독 | "색과 툴팁으로 실패/재시도 태스크 식별", 셀 클릭 시 로그 열람 또는 상태 mark/clear, 런 범위 선택(예: last 25 runs) |
| B2-2 | **Graph View** | 의존성 디버깅 | 노드=태스크, 엣지=의존성, 런 전환 드롭다운, 노드 클릭 시 메타·이력 |
| B2-3 | **런 상세 Gantt** | 태스크 duration 시각화 | 런 단위 미니 간트 |
| B2-4 | **Rendered Templates 탭** | 템플릿이 실제 값으로 어떻게 렌더됐는지 확인 | 태스크 인스턴스 뷰의 탭(Logs / Rendered Templates / XCom / Events / Code / Details) |
| B2-5 | **상태 mark/clear 수동 조작** | 운영 개입 | 태스크 상태를 수동으로 successful/failed/cleared로 표시 |

출처: [S11].

#### B3. GitHub Actions

| # | 패턴 | 해결하는 문제 | 관찰된 UI 어포던스 |
|---|---|---|---|
| B3-1 | **런 요약 → Job → Step → 로그 계층 드릴다운** | 실행 결과의 점진적 공개 | Actions 탭 → 워크플로 사이드바 필터 → 런 목록 → 런 요약 페이지에 job/step별 상태와 로그 |
| B3-2 | **실시간 시각화 그래프** | 진행 중 런 모니터링 | 런마다 실시간 진행 그래프 |
| B3-3 | **과금 분(billable minutes) 표시** | 실행 비용 가시화 | job duration과 함께 과금 분 표시 |
| B3-4 | **상태 배지** | 상태의 외부 전달 | 저장소에 워크플로 상태 배지 표시 |

출처: [S12], [S13], [S14].

### 1.3 카테고리 C — 프롬프트 실험 UI

#### C1. LangSmith Playground
→ A1-7 참조. 추가로: 저장 프롬프트를 실험 재검토 시 참조하기 쉽도록 프롬프트 허브에 커밋하도록 안내, 데이터셋 입력 키와 프롬프트 변수 일치 강제. 출처 [S4].

#### C2. Braintrust Playground
→ A3-1~A3-5 참조. 추가로: Mustache/Nunjucks 템플릿(`{{input}}`), 저장 프롬프트의 호버 버전 서브메뉴, 행 클릭 시 트레이스 뷰어 사이드바이사이드 + "Run row" 버튼. 출처 [S7].

#### C3. Arize Phoenix Playground
→ A4-2, A4-3 참조. 출처 [S8].

**패치 실패 (§5 참조)**: Anthropic Console Workbench, OpenAI Playground — 두 제품 모두 공식 문서 페이지가 404 또는 JS 렌더링 전용으로 본문을 회수하지 못했다. 카테고리 C는 위 3개 소스로 충족하며, 실패 제품의 기능을 추측해 기술하지 않았다.

---

## 2. JTBD 매핑과 채택 결정

콘솔의 4개 사용자 작업(설계 문서 §6 파생):

- **J1. 설계된 플로우 파악** — S1–S12의 어떤 활동이 어떤 에이전트·프롬프트로 묶여 있는지 이해
- **J2. 수행 이력 추적** — 무엇이 언제 어떤 결과(성공/실패/비용/지연)로 호출됐는지 감사
- **J3. 안전한 실험** — 운영 SSOT을 건드리지 않고 오버라이드를 시도하고 그 근거를 남김
- **J4. 개선 제안 수용/기각** — AI 제안을 근거와 함께 검토하고 결정

### 2.1 매핑 표

| 패턴 (§1 참조) | 출처 | J1 | J2 | J3 | J4 | 결정 | 근거·변형 내용 |
|---|---|:--:|:--:|:--:|:--:|---|---|
| A1-1 목록+상세 패널 분할 | LangSmith | | ○ | | | **변형 채택** | 목록 밀도 유지는 채택하되 상세는 사이드 패널이 아니라 **행 인라인 확장**(details/summary)으로. 기존 앱은 table-scroll·ColGroup 밀도 표가 표준이고, 확장 행이 같은 지역 스크롤 맥락을 유지해 키보드·스크린리더 흐름이 단순해짐. → 화면문서 §5 |
| A1-2/A1-3 활동별 메타 행(토큰·비용·모델·링크) | LangSmith | | ○ | | | **채택** | 런 상세 확장의 activity→agent→llm_call 각 행에 latency·tokens·cost·classifiedBy 표시. `run_type` 분기 렌더는 스키마가 llm_call_log로 균질하므로 단일 행 렌더로 단순화. |
| A1-4 Diff 뷰 전환 | LangSmith | | | ○ | | **채택(변형)** | A/B 비교 표에 diff 강조를 채택하되 2개 한정(구성A=base, B=override)이라 뷰 전환 토글 없이 항상 diff 표시. |
| A1-5 개선/악화 하이라이트+카운트 | LangSmith | | | ○ | ○ | **채택(변형)** | 색 단독 금지(WCAG)이므로 색+등급 텍스트(개선/악화/동률)로. 헤더 카운트 필터는 v1 생략(단일 활동 비교에는 과잉). |
| A1-6 소스 실험 지정 | LangSmith | | | ○ | | **변형 채택** | "source experiment" 개념 → 드라이런 세션에서 **base는 카탈로그 원본으로 고정**되어 지정 행위 자체가 없음. 대신 비교 열 순서를 base→override로 고정해 동일 역할 수행. |
| A1-7 데이터셋 오버 실행 | LangSmith | | | ○ | | **기각 (v1)** | 설계 §6.6이 v1을 단일 활동 드라이런으로 한정 — 데이터셋 그리드는 후속 범위. 골든셋 시드는 선호 기록(J3)으로 대체. |
| A2-1 지연 워터폴 | Langfuse | | ○ | | | **채택** | 런 상세의 지연 타임라인을 EChart로. 다만 A5-3의 스팬 단위 막대가 아니라 **activity 레벨 막대**(llm_call 세부는 확장 행 텍스트). EChart는 `role="img"` + 데이터 테이블 대체 필수(§6.5 요구). |
| A2-2 프롬프트 버전 관리 | Langfuse | | | ○ | | **기각** | SSOT 불변(§6.6) — 콘솔은 프롬프트 버전을 만들지 않는다. 영구 반영은 제안 패키지→저장소 PR 경로뿐. 세션 오버라이드는 버전이 아니라 세션 스코프 상태. |
| A2-3 품질·비용·지연 대시보드 | Langfuse | | ○ | | | **변형 채택** | 전용 대시보드 화면 없이 런 레저 상단 요약 카드 + EChart 타임라인 1장으로 축소. 별도 대시보드 페이지는 범위 밖. |
| A2-4 Agent Graph | Langfuse | | | | | **기각** | §6.5 "신규 시각화 컴포넌트 최소화". 블루프린트는 단계 그리드/리스트로 충분 — J1의 단위는 "활동→에이전트→프롬프트"라 DAG 렌더가 해결하는 의존성 문제와 다름. |
| A2-5 Annotation Queue | Langfuse | | | ○ | ○ | **기각** | 선호 기록(J3)과 제안 수용/기각(J4)이 같은 역할을 더 가볍게 수행. 별도 큐 표면은 운영 부담 대비 가치 낮음. |
| A3-1 그리드+스트리밍 | Braintrust | | | ○ | | **변형 채택** | 그리드 대신 **2열 사이드바이사이드**(base vs override)로 축소. 단일 활동 범위에서 태스크×예제 그리드는 과잉. |
| A3-2 Diff+등급 필 | Braintrust | | | ○ | ○ | **채택** | base 대비 override 출력 diff + 등급 필(개선/악화/동률) — J3 판단과 J4 제안 근거 제시에 직결. |
| A3-3 셀 선호 기록 | Braintrust | | | ○ | | **변형 채택** | 썸업/다운 + 비고 한 줄 → 세션의 **선호 기록**(골든셋 시드, §6.6 (3)). 셀이 아니라 비교 결과 행 단위. |
| A3-4 불변 스냅샷 승격 | Braintrust | | | ○ | | **변형 채택** | "+Experiment"의 역할을 **제안 패키지 내보내기**(diff+드라이런 증거 동봉 → 저장소 PR)가 수행. 콘솔 내 스냅샷 저장은 하지 않음(§6.6 경계). |
| A3-5 URL 공유 | Braintrust | | | ○ | ○ | **채택** | 드라이런 세션을 전용 라우트(`/flows/dry-run/[sessionId]`)로 — 딥링크 가능해 검토자 전달이 URL 한 줄. |
| A3-3u 재실행 덮어쓰기 경고 | Braintrust | | | ○ | | **변형 채택** | 재실행은 기존 결과를 덮지 않고 세션에 **새 드라이런 런**으로 적재(dry_run_group_id). 비용 증가를 실행 전 확인 대화상자로 통제(§6.6 요구). |
| A4-3 Span Replay | Phoenix | | | ○ | | **채택(이미 설계됨)** | §6.6 "실제 운영 코드 경로 통과"와 동일 철학 — 드라이런이 실험 전용 복제 경로를 만들지 않는 것은 replay 개념과 같다. UI는 이를 칩("실코드 경로")으로 라벨링해 신뢰를 명시. |
| A5-1 요약 카드 | Weave | | ○ | | | **채택** | 런 레저 상단: 호출수·오류율·토큰·비용 카드(시간창 선택기 연동). |
| A5-2 에이전트 카드 그리드 | Weave | | ○ | | | **기각 (v1)** | agent_key 필터+집계 표로 충분. 카드 그리드는 로스터 화면(/agents)과 역할 중복. |
| A5-3 워터폴+트리 토글 | Weave | | ○ | | | **변형 채택** | 트리(계층)는 인라인 확장 행으로, 워터폴은 EChart로 — 두 패턴을 한 화면에 두되 토글이 아니라 병치. |
| A5-4 Columns 버튼 | Weave | | ○ | | | **기각 (v1)** | 필터·열을 고정 세트로 설계(커서 페이지네이션·감사 화면 특성상 재현성 우선). 후속 사용자 피드백에서 재검토. |
| A5-5 호출 단위 토큰/비용 라인 | Weave | | ○ | ○ | | **채택** | llm_call 행의 `tokens·cost` 라인 + 세션당 비용 표시(§6.6). |
| B1-1 런 필터 + Gantt | Dagster | | ○ | | | **채택** | 런 레저 필터 세트(agent_key·entity·ok·드라이런) + EChart 지연 타임라인이 Gantt 역할. |
| B1-2 재실행 그룹핑 | Dagster | | ○ | ○ | | **변형 채택** | dry_run_group_id로 세션 소속 드라이런 런을 그룹핑해 세션 상세에서 모아 보여줌. "Re-execute" 버튼은 드라이런 세션의 재실행으로 이관. |
| B1-3 저장된 필터 세트 | Dagster | | ○ | | | **기각 (v1)** | 고정 필터 세트 + URL 쿼리 동기로 충분. |
| B2-1 Grid 히트맵 | Airflow | | ○ | | | **변형 채택** | 단계×상태 히트맵은 블루프린트 뷰의 단계 요약에 "단계별 활동 수·최근 오류 카운트" 텍스트 형태로 흡수. 색+툴팁만으로 하는 상태 전달은 WCAG 위반이므로 아이콘+텍스트 칩으로 변형. |
| B2-4 Rendered Templates | Airflow | | ○ | ○ | | **변형 채택** | llm_call 행에서 **컨텍스트(meta_json)와 프롬프트 키**를 표시 — "렌더된 입력" 확인 니즈를 충족. v1은 전체 프롬프트 본문 렌더링은 생략(로그 본문은 장부에 없음). |
| B2-5 상태 mark/clear | Airflow | | | | | **기각** | 런 장부는 append-only(§6.5) — 상태 수동 수정 경로를 UI에 만들지 않는다. |
| B3-1 계층 드릴다운 | GitHub Actions | | ○ | | | **채택** | run → activity → agent → llm_call의 점진적 공개가 런 상세 확장의 뼈대. |
| B3-3 과금 표시 | GitHub Actions | | ○ | ○ | | **채택** | 세션/런 비용 표시 — 실행 전 비용 확인(§6.6)과 한 쌍. |
| C공통 파라미터 패널 | Playgrounds | | | ○ | | **기각 (v1)** | 모델·온도 등 파라미터 편집은 prompts.json/SSOT 소유. 오버라이드 편집기는 **프롬프트 본문 + agent 재배정(로스터 한정)** 두 축만 허용(§6.6 (1) 카탈로그/로스터 검증). |
| C공통 실행 전 비용 확인 | Playgrounds/§6.6 | | | ○ | | **채택** | ConfirmDialog(ADR-0082)로 예상 비용 확인 후 실행. |

### 2.2 채택 통계

- **채택/변형 채택 19건**, **기각 10건** (v1 범위 한정 기각이 대부분이며, 재검토 조건을 각 근거에 명시).
- 기각의 공통 이유 3가지: (1) §6.6 단일 활동 v1 범위, (2) §6.5 "신규 시각화 컴포넌트 최소화", (3) SSOT 불변·append-only 경계.

---

## 3. JTBD별 설계 방향 요약 (화면문서와의 연결)

| JTBD | 핵심 채택 패턴 | 화면문서 위치 |
|---|---|---|
| J1 설계된 플로우 파악 | 단계 그리드 요약(B2-1 변형) + 활동 드릴다운 + 트랙 배지 | §4 블루프린트 뷰 |
| J2 수행 이력 추적 | 요약 카드(A5-1) + 고정 필터(B1-1) + 인라인 계층 확장(B3-1, A1-1 변형) + EChart 타임라인(A2-1) + classifiedBy 칩 | §5 런 레저 뷰 |
| J3 안전한 실험 | 전용 세션 라우트(A3-5) + 2열 A/B diff(A3-2, A1-4) + 선호 기록(A3-3) + 비용 확인(B3-3) + 실코드 경로 칩(A4-3) | §6 드라이런 편집기 |
| J4 개선 제안 수용/기각 | 제안 카드 + 근거 동봉 + "수용=오버라이드 적용만" 칩(제안 전용 경계) | §7 AI 제안 패널 |

---

## 4. 출처 URL 목록 (실제 패치한 공식 문서)

| ID | URL | 패치 방법 |
|---|---|---|
| [S1] | https://docs.langchain.com/langsmith | WebFetch (docs.smith.langchain.com 308 리다이렉트 경유) |
| [S2] | https://docs.langchain.com/langsmith/view-traces | WebFetch |
| [S3] | https://docs.langchain.com/langsmith/compare-experiment-results | WebFetch |
| [S4] | https://docs.langchain.com/langsmith/run-evaluation-from-playground | WebFetch (sitemap.xml에서 경로 확정) |
| [S5] | https://langfuse.com/docs | WebFetch |
| [S6] | https://www.braintrust.dev/docs/evaluate | WebFetch |
| [S7] | https://www.braintrust.dev/docs/evaluate/playgrounds | WebFetch |
| [S8] | https://arize.com/docs/phoenix | WebFetch |
| [S9] | https://docs.coreweave.com/products/wandb/weave/guides/tracking/view-agent-activity | WebFetch (docs.wandb.ai/weave 301 경유 — Weave는 CoreWeave로 이관되어 Agent Lens로 계승됨) |
| [S10] | https://dagster.io/docs/concepts/webserver/ui | WebFetch (docs.dagster.io 308 리다이렉트 경유) |
| [S11] | https://airflow.apache.org/docs/apache-airflow/stable/ui.html | WebFetch |
| [S12] | https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows | WebFetch |
| [S13] | https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows/monitoring-workflows/about-monitoring-workflows | WebFetch |
| [S14] | https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows/monitoring-workflows/viewing-workflow-run-history | WebFetch |

## 5. 패치 실패 기록 (대체 소스로 충족, 추측 금지 준수)

| 대상 | 시도 URL | 결과 | 조치 |
|---|---|---|---|
| Anthropic Console Workbench | docs.claude.com → platform.claude.com `/docs/en/build-with-claude/prompt-engineering/use-the-workbench` (302 후 404), docs.anthropic.com 동일 경로(JS 전용 `__next_error__`) | 본문 회수 불가 | 카테고리 C는 LangSmith/Braintrust/Phoenix 플레이그라운드 3개 소스로 충족. Workbench 기능을 본 노트에 기술하지 않음. |
| OpenAI Playground | platform.openai.com/docs/playground → developers.openai.com 404, `/docs/guides/chat-playground` 404 | 본문 회수 불가 | 동일 조치. |

(또한 LangSmith 최초 진입 URL `docs.smith.langchain.com`은 308 리다이렉트로 [S1]로 해소됐고, W&B Weave는 `docs.wandb.ai/weave` 301 → CoreWeave 문서로 이관돼 있음을 확인했다 — 제품명은 관행상 Weave로 기재한다.)
