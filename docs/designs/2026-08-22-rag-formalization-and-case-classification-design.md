# co-newbiz — 판단체계 형식화 · 분류 축 재설계 · 워크플로우 공백 보완 설계 문서

**Status**: Stage 0 — 설계 문서(확정), 구현 착수 전 사용자 승인 대기
**Owner**: process-governance-manager (risk-officer / compliance-officer / data-architect / platform-lead / market-intelligence-agent / quant-methodologist / brownfield-agent / greenfield-agent / legal-counsel 공동 검토)
**소스**: 2026-08-22 6관점 미팅 검토를 거친 개정 계획(세션 계획서 `fuzzy-mapping-forest`)을 정식 설계 문서로 승격
**연관 ADR**: 0046-0050(신규, 아래 §6) / 개정 대상: ADR-0016, ADR-0037, ADR-0045

> 이 문서는 저장소에 남는 정식 설계 산출물이다. ADR-0032("문서 우선 실행 순서")에 따라, 아래 PR 시퀀스의 어떤 코드도 이 문서와 §6의 ADR 초안이 승인되기 전에는 착수하지 않는다.

---

## 1. 문제 정의 — 4대 구조적 결함

빌드는 Stage 5까지 끝났으나, 검토 결과 아래 네 가지 구조적 결함이 확인됐다.

### 1.1 RAG 6차원 중 3개가 형식화되지 않았다

`market` / `technical_execution` / `risk` 세 차원은 채점 함수가 없고, 호출자가 시나리오 JSON에 등급을 손으로 적어 넣는다. `docs/governance/rag-framework.md`에는 이 세 차원의 판정 기준이 **산문으로도 존재하지 않는다.** `rag_rule` 테이블은 스키마상 존재하나, 확인된 사실은 다음과 같다:

- INSERT 0건
- 읽는 코드 0건

### 1.2 Kill Criteria가 발화 불가능하다

11개 절차 YAML에 선언된 `kill_criteria`를 파싱하는 코드가 없다. 미팅에서 정량 확인된 수치:

- **17건 선언**
- **실행가능 0건**

### 1.3 GF/BF와 사내벤처/R&BD 축이 뭉개져 있다

- `md_project`는 3컬럼 스텁으로 `case_type`이 없다.
- `case_subtype: rbd`는 산문에만 존재하고 스키마에 반영돼 있지 않다.
- 결과적으로 사내벤처(내부기원 신사업)가 타겟 롱리스트·HHI 사전심사·QoE 정상화 절차를 그대로 통과한다 — 검증자가 원래 걸러야 할 케이스를 걸러내지 못한다.

### 1.4 M&A 워크플로우에 4개 단계가 부재하다

사용자가 제시한 15단계 M&A 체인과 현재 구현을 대조한 결과:

| 구분 | 건수 |
|---|---|
| 완전 구현 | 7 |
| 부분 구현 | 4 |
| **부재** | **4** (Strategic Fit, Market DD, Legal DD, Financing) |

---

## 2. 미팅 종합 — 7개 뒤집힘(원안이 틀렸음이 미팅에서 밝혀진 지점)

각 항목은 어느 관점이 지적했는지, 그리고 원설계의 어떤 전제가 무너졌는지를 포함한다.

### 뒤집힘 1 (치명, 4개 관점 독립 수렴) — 분류는 waiver보다 약한 waiver다

**제기**: risk-officer, compliance-officer, process-governance-manager, brownfield-agent — 네 관점이 **각자 독립적으로** 동일한 결론에 도달했다.

`project_case_classification`이 `origin='internal'`이면 6대 검증자를 통째로 스킵시키는데, 이 테이블은 `waiver`(승인자·만료일·이력·철회를 전부 보유)와 비교해 **작성자 하나 외엔 아무 통제가 없다.** UPDATE 한 줄이 waiver 없이 waiver와 같은 효과를 낸다. 이 6대 검증자는 ADR-0037로 명시적 no-waiver 대상이다 — **waiver보다 헐거운 우회로가 waiver 금지 규칙 옆에 생긴다.**

스키마 검증이 이 위에 세 가지 구현 불능 사실을 추가로 확인했다:

- `md_project`에 **stage 컬럼이 없어** "Screening 시점 동결"을 코드가 판정할 수 없다.
- `compliance_check.result`에 **`not_applicable` 값이 없어**, 분류로 스킵된 검증자는 `result='pass'`("충족함")로 기록된다 — 감사기록에 거짓 진술이 남는다.
- DD 종료 교차검증(`origin` vs `dd_finding.rbd_source`)은 **정작 잡아야 할 사례에서 눈이 먼다** — `origin=internal`로 잘못 분류돼 R&BD 단계가 스킵되면 애초에 `rbd_source` 행이 생기지 않으므로 비교 대상 자체가 없다.

**개정**: PR-5b는 원설계로 진행하지 않는다. §3 결정 5(전면 재설계)로 대체.

### 뒤집힘 2 (치명) — `enabled=0` 반조작 장치는 실제로 없었다

**제기**: 스키마 검증(data-architect/platform-lead)

계획은 "에이전트가 유효한 활성 규칙을 물리적으로 생산할 수 없다"고 주장했으나, 실사 결과 `governance_doc`에 쓰기 통제가 전혀 없고 **`rag_rule.enabled`의 DB 기본값이 1**이었다(문서 주장과 정반대). 스키마 검증이 시정 DDL을 제시했다 — §3 결정 2 참조.

### 뒤집힘 3 (높음) — PR-4의 "정직하지만 불편한 unassessed"는 실제로 안전 회귀다

**제기**: 스키마 검증

`overall=null` 전환 시 `rankGroupAgenda`가 **null을 non-Red로 취급**(`?1:0`)해 미평가 프로젝트가 Amber 프로젝트보다 유리하게 랭킹된다. 게다가 UI는 마지막 등급을 그대로 보여줘, 정직한 공백이 아니라 **스테일한 확신 등급**으로 나타난다. PR-4 범위에 이 두 지점 수정을 필수로 편입한다.

### 뒤집힘 4 (치명, 시장차원) — `concentration_hhi`를 "경쟁강도"에 매핑한 것은 틀렸다

**제기**: market-intelligence-agent, quant-methodologist

`value_chain_link.concentration_hhi`는 상하방 교섭력(전후방 산업 집중도) 지표이지 수평적 경쟁강도가 아니다 — 두 개념은 서로 반대 방향을 가리킬 수 있어 **조용히 오판정**을 만든다. §3 결정 6(개정)에서 분리한다.

### 뒤집힘 5 (치명, 분류실무) — `origin` 3값에 진짜 양자 JV가 들어갈 자리가 없다

**제기**: brownfield-agent, greenfield-agent

두 회사가 대등하게 기술을 출자해 신설법인을 만드는 순수 JV는 `internal`도 `external`도 아니고, 계획이 정의한 `hybrid`(수동적 소수지분 투자)에도 맞지 않는다 — **지배구조가 반대인 두 딜이 같은 버킷에 섞인다.**

### 뒤집힘 6 (치명, 분류실무) — PR-5a의 HHI 게이팅 설계 자체가 틀렸다

**제기**: brownfield-agent, greenfield-agent

`origin=internal`로 독과점 심사를 끄는 안은, 카브아웃 사업부가 **이미 외부 시장에서 경쟁 중인지**와 무관하게 꺼진다. 이미 경쟁 중인 사업부가 분사돼 새 파트너와 결합하면 독과점 노출이 오히려 커질 수 있다 — 계획이 경계하던 "조용한 거짓 skip"이 완화책이 아니라 **PR-5a 게이팅 설계 그 자체에 내장**돼 있었다.

### 뒤집힘 7 (높음, 법무) — 인증 이전가능성 방어는 kill-criterion만으로 불충분

**제기**: legal-counsel

`transferability_basis='inferred'`를 kill-criterion(게이트 시점, `enabled=1` 필요)으로만 막으면, **write 시점부터 게이트 평가 시점 사이**에 추론값이 그대로 유통된다. 비협상 경계 #5("추론 금지")는 지연 허용 규칙이 아니다.

---

## 3. 핵심 설계 결정 1-9

### 결정 1: `condition_expr`은 타입드 JSON 술어 AST — 단, 3치 논리표 명시 필수

```ts
export type Predicate =
  | { op: "all_of" | "any_of" | "none_of"; of: Predicate[] }
  | { op: "at_least"; k: number; of: Predicate[] }
  | { op: "cmp"; var: string; cmp: "lt"|"lte"|"gt"|"gte"|"eq"|"neq"; value: Scalar; unit?: string }
  | { op: "in"; var: string; values: Scalar[] }
  | { op: "is_null"; var: string }
  | { op: "count"; var: string; cmp: "lt"|"lte"|"gt"|"gte"|"eq"; value: number };
```

**신규(스키마 검증 F-17a, PR-1 착수 전 필수)**: "참조 var 중 하나라도 missing → UNASSESSED"라는 원안의 평탄 규칙은 **틀렸다.** Kleene 3치 논리가 필요하다:

- `any_of(TRUE, UNASSESSED)` = **TRUE** — 이미 한 분기가 참이면 다른 분기의 결측이 뒤집을 수 없다
- `at_least(k=2, [TRUE,TRUE,UNASSESSED])` = **TRUE**
- `all_of(FALSE, UNASSESSED)` = **FALSE**
- `none_of`는 대칭 규칙을 따른다

연산자별 진리표를 **ADR(0046)에 명시**하고, PR-1에 연산자별 테스트 매트릭스를 포함한다. 관대한 방향으로 틀리면 계획이 막으려던 거짓 통과가 재현되고, 보수적 방향으로 틀리면 기능이 영구히 죽는다.

**신규(스키마 검증 F-2)**: `rag_rule`은 **0행·0독자**이므로 이번이 마지막 안전한 창구다. 가산 마이그레이션이 아니라 **DROP+CREATE로 재정의**한다:

```sql
DROP TABLE rag_rule;   -- 0 rows, 0 readers 확인됨 — 마지막 안전 창구
CREATE TABLE rag_rule (
  id TEXT PRIMARY KEY,
  rule_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  stage_gate TEXT NOT NULL CHECK (stage_gate IN ('screening','pre_fs','fs','dd','entity_ic','group_ic')),
  dimension TEXT NOT NULL CHECK (dimension IN ('financial','market','data_confidence','regulatory_permit','technical_execution','risk','overall')),
  grade TEXT NOT NULL CHECK (grade IN ('green','amber','red')),
  condition_expr TEXT NOT NULL,
  priority INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),   -- 기본값 반전
  policy_id TEXT REFERENCES governance_doc(id),
  thresholds_source TEXT,
  created_at TEXT NOT NULL,
  CHECK (enabled = 0 OR (policy_id IS NOT NULL AND thresholds_source IS NOT NULL))  -- 결정 2의 방어를 SQL로
);
CREATE UNIQUE INDEX idx_rag_rule_key ON rag_rule(rule_key, version);
CREATE INDEX idx_rag_rule ON rag_rule(stage_gate, dimension, priority);
```

한국어 렌더링(`renderKo`)은 **거버넌스 산출물**(리뷰어가 서명하는 대상)이므로 조사(은/는·이/가·을/를·와/과) 선택과 부정 스코프까지 요구된다 — 6연산자×6단위×N변수 조합을 다루는 실질 작업으로, **PR-1 산정을 3배로 재평가**한다(스키마 검증 F-17b).

### 결정 2: 증거 레지스트리 — DB에 실재하는 테이블로

**신규(스키마 검증 F-6)**: 원안의 "레지스트리가 리팩터 문제를 해결한다"는 주장은 절반만 참이다. 물리 컬럼 개명은 레지스트리 1곳으로 해결되지만, **레지스트리 키 자체의 개명**은 모든 규칙 파일·`applies_when`·이미 쓰인 `dimension_input` 행을 건드리며 SQL로 "이 var를 참조하는 규칙"을 답할 수 없다(LIKE는 인덱스 불가+오탐). 조인 테이블을 신설한다:

```sql
CREATE TABLE evidence_var (
  var_key TEXT PRIMARY KEY,
  label_ko TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN ('number','string','boolean')),
  unit TEXT CHECK (unit IS NULL OR unit IN ('ratio','pp','krw','months','x','count')),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('column','computed','asserted')),
  requires_evidence_ref INTEGER NOT NULL DEFAULT 0 CHECK (requires_evidence_ref IN (0,1)),
  max_age_days INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE rag_rule_variable (
  rule_id TEXT NOT NULL REFERENCES rag_rule(id),
  var_key TEXT NOT NULL REFERENCES evidence_var(var_key),
  PRIMARY KEY (rule_id, var_key)
);
CREATE INDEX idx_rag_rule_variable_var ON rag_rule_variable(var_key);
```

**신규(스키마 검증 F-7/F-8/F-9) — 동적 쿼리 대신 런 단위 스냅샷.** 원안의 `{kind:"column", table, column, aggregate:"latest"}`는 세 가지로 깨진다:

- (a) `certification`·`incentive`·`permit` 등 **절반 이상의 테이블에 타임스탬프가 없어** "latest"가 정의 불가
- (b) `table`/`column`이 문자열 보간되므로 **식별자 인젝션 표면**(에이전트가 레지스트리를 저술하는 미래 계획과 충돌)
- (c) 평가당 var마다 쿼리 1회로 **N+1**이 감시주기 안에서 프로젝트 수만큼 배가

해법: 런당 1회 채워지는 스냅샷 테이블로 대체한다.

```sql
CREATE TABLE project_variable_snapshot (
  run_id TEXT NOT NULL REFERENCES run(id),
  project_id TEXT NOT NULL REFERENCES md_project(id),
  var_key TEXT NOT NULL REFERENCES evidence_var(var_key),
  value_num NUMERIC, value_text TEXT,
  evidence_ref TEXT, observed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('present','missing','stale')),
  PRIMARY KEY (run_id, project_id, var_key)
);
```

채우기는 **손으로 작성·코드리뷰된 var-family별 SQL**(동적 문자열 조합 아님) — 인젝션 표면 0, 평가당 쿼리 1회, `latest` 순서 컬럼을 family별로 정적 결정, ADR-0005(run 기반 버전관리)가 이미 다른 모든 산출물에 요구하는 재현성을 여기에도 준다. `dimension_input`은 스냅샷을 채우는 소스 중 하나로 격하 — 특수 케이스가 아니다.

`requires_evidence_ref`는 현재 **장식**이다(`value_chain_link.evidence_ref` 등이 형식 제약 없는 nullable TEXT) — `document` 테이블 FK 또는 검증된 URI 패턴 요구를 PR-6/8 범위에 포함(하드 블로킹은 아님, v1.1 경화 항목으로 명시).

### 결정 3: 판단 vs 측정 — `dimension_input`은 런 스코프·이력형

**신규(스키마 검증 F-15/F-16, compliance-officer #12)**: 원안의 `project_id TEXT PRIMARY KEY` 단일행 설계는 **분류 이력을 삭제**한다 — 거짓 skip을 잡아야 할 바로 그 감사흔적을 없앤다. `run_id` 부재로 재현 불가, 단위 스냅샷 부재로 레지스트리 단위 변경 시 과거 단언이 조용히 재해석된다.

```sql
CREATE TABLE dimension_input (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES run(id),
  project_id TEXT NOT NULL REFERENCES md_project(id),
  var_key TEXT NOT NULL REFERENCES evidence_var(var_key),
  value_kind TEXT NOT NULL CHECK (value_kind IN ('num','text','bool')),
  value_text TEXT, value_num NUMERIC, unit TEXT,
  evidence_ref TEXT NOT NULL,
  asserted_by TEXT NOT NULL,
  reviewed_by TEXT,              -- 신규: 교차도메인 2차 검토자, 채점 반영 전 요구
  rationale TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  superseded_by TEXT REFERENCES dimension_input(id),
  CHECK ((value_kind='num' AND value_num IS NOT NULL AND value_text IS NULL)
      OR (value_kind!='num' AND value_text IS NOT NULL AND value_num IS NULL))
);
CREATE UNIQUE INDEX idx_dimension_input_live ON dimension_input(project_id, var_key) WHERE superseded_by IS NULL;
CREATE INDEX idx_dimension_input_project ON dimension_input(project_id, observed_at DESC);
```

`reviewed_by`는 신규 — compliance-officer·legal-counsel 공통 지적: 인간 단언이 검토 없이 곧바로 최종 등급을 만들면 **비협상 경계 #2(AI 2차 검토 + 인간 최종)**를 우회한다. `reviewed_by`(다른 도메인)가 채워지기 전엔 스코어링에 반영하지 않는다.

**우측 승 채택(시장차원 #5)**: right-to-win은 단일 판단이 아니라 `right_to_win.customer_overlap` / `right_to_win.tech_overlap` / `right_to_win.brand_transferability` **3개 var로 분해**한다 — 스키마 비용 0.

### 결정 4: 기존 3개 차원은 교체하지 않는다 — 단, 미러 행 시딩은 보류

기존 방침 유지: `financial`/`data_confidence`/`regulatory_permit`은 TS 함수가 계속 실행 경로다.

**신규(스키마 검증 F-18)**: `financialBand()`의 IEEE-754 보정(`(0.12-0.10)*100 === 1.9999999999999836`)을 범용 `cmp` 술어가 그대로 재현하지 못하면 패리티 테스트가 **경계값에서 확정적으로 실패**한다. `regulatoryPermitGrade`의 2차 반환값(`remedyShape`)도 AST가 표현 못 한다. **`financial`·`regulatory_permit`은 미러 행을 시딩하지 않는다** — 패리티 없는 미러 행은 부채라는 원안의 자체 경고를 그대로 따른다. `data_confidence`만 미러링 대상으로 유지(3-way switch라 재현 용이).

### 결정 5 (전면 재설계): 6대 검증자 완결성 점검 — waiver 등가 통제로

**결정 5a — 분류 쓰기 권한은 비대칭이다** (거버넌스 라운드1 합의):

- `origin='external'`(검증자 세트를 늘리기만 함) → 단독 작성 가능, `rationale` 필수
- `origin ∈ {internal, hybrid, joint}`(검증자 세트를 줄임) → **2자 승인 필수**, `approver_role`(process-governance-manager 권한 이상) + `approved_by` + `approved_at` — waiver와 최소 동급의 비용

**결정 5b — 분류는 append-only 이력 테이블이다**:

```sql
CREATE TABLE project_case_classification (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  case_type TEXT NOT NULL CHECK (case_type IN ('greenfield','brownfield')),
  origin TEXT NOT NULL CHECK (origin IN ('internal','external','hybrid','joint')),  -- 4값(뒤집힘5)
  technology_track TEXT NOT NULL DEFAULT 'none' CHECK (technology_track IN ('none','rbd')),
  classified_by TEXT NOT NULL,
  approver_role TEXT, approved_by TEXT, approved_at TEXT,   -- origin이 축소형일 때만 필수, 애플리케이션 레이어에서 강제
  classified_at TEXT NOT NULL,
  rationale TEXT NOT NULL,
  superseded_by TEXT REFERENCES project_case_classification(id)
);
CREATE UNIQUE INDEX idx_case_classification_live ON project_case_classification(project_id) WHERE superseded_by IS NULL;
```

`joint`(진짜 양자 JV, 대등 출자·공동 지배)를 `hybrid`(수동적 소수지분 투자, 파일럿 014형)와 분리 — 지배구조가 반대인 딜이 같은 버킷에 안 섞이게.

**결정 5c — `md_project`에 stage 컬럼 추가** (risk-officer F2 — "Screening 시점 동결"을 코드가 판정할 최소 전제):

```sql
ALTER TABLE md_project ADD COLUMN current_stage_gate TEXT
  CHECK (current_stage_gate IS NULL OR current_stage_gate IN ('screening','pre_fs','fs','dd','entity_ic','group_ic'));
```

FS 진입 후 `case_type`/`origin` 변경은 위 승인 경로 + `compliance_check` 사유 기록을 모두 요구한다.

**결정 5d — `compliance_check.result`에 `not_applicable` 추가** (거버넌스 #2):

```sql
-- compliance_check 재정의 (0행 여부 확인 후 additive 또는 rebuild)
result TEXT NOT NULL CHECK (result IN ('pass','blocked','reason_required','waived','not_applicable'))
```

분류로 스킵된 검증자마다 **행 1개**를 쓴다 — `detail`에 `renderKo(applies_when)` 문장 + 분류 행 id + `classified_by`/`approved_by`. 6대 검증자 완결성은 이제 boolean이 아니라 **"6 선언 / N 해당 / M 완료"** 세 숫자로 기록한다(원안이 kill-criteria에는 이미 적용했던 원칙을 여기에도 확장). `not_applicable` 행은 재분류 시 **무효화·재평가**된다.

**결정 5e — HHI/독과점 게이팅은 `origin`이 아니라 사실 기반 var로** (분류실무 #2, CRITICAL):

```yaml
applies_when: { op: "in", var: "target.has_external_market_presence", values: [true] }
```

`target.has_external_market_presence`는 `dimension_input`으로 단언되는 사실(카브아웃 사업부가 현재 외부 시장에서 경쟁 중인가) — `origin`과 직교. `origin=internal`은 여전히 타겟-롱리스트 단계(step 1)만 면제한다. QoE(`brownfield-fs` step 1)는 완전 스킵이 아니라 **경량 필수**로 하향(카브아웃 원가배분·이전가격도 조작 가능하므로).

**결정 5f — DD 교차검증은 스킵된 증거가 아니라 스킵 여부와 무관하게 생성되는 증거로** (risk-officer F3):

`origin` vs `dd_finding.rbd_source` 비교는 R&BD 단계가 스킵되면 무력하다는 지적을 받아, `certification`·`antitrust_finding`·CoC 계약 스캔 결과처럼 **분류와 무관하게 생성되는 증거**를 1차 교차검증 대상으로 삼는다. `origin` vs `rbd_source` 비교는 R&BD 단계가 실제로 돈 경우의 보조 신호로 격하한다.

**결정 5g — 교차검증 결과는 조건부 차단** (분류실무 #5): 원안의 상시-차단 대신, **최초 분류에 rationale/evidence_ref가 부실했던 경우만 차단**하고, 근거 있는 최초 분류가 DD에서 정직하게 뒤집힌 경우는 **비차단 수정**(재분류 + 스킵됐던 해당 단계 재실행 트리거)으로 — DD가 가설을 검증하다 틀렸다고 밝히는 것은 위반이 아니라 정상 작동이라는 지적을 반영한다.

### 결정 6 (개정): 시장 차원 증거 매핑 정정

| 사용자 축 | 원안 매핑 | 개정 |
|---|---|---|
| 교섭력(상하방) | — | `market.bargaining_power_hhi` ← `value_chain_link.concentration_hhi` (원래 의미대로) |
| **경쟁강도(수평)** | `concentration_hhi` (오매핑) | **신규 var** `market.competitive_intensity` ← `fact_industry` 관례 또는 `dimension_input` |
| 고객 Lock-in | `switching_cost_grade` | 유지, 단 CHECK 제약 추가(현재 무제약 TEXT — in-술어가 오타로 조용히 불일치) |
| TAM·성장률 | `fact_industry` metric_key | 유지 |
| 진입장벽 | `dimension_input` | 유지 |
| Right-to-Win | `dimension_input` 단일 | **3개 var로 분해**(결정 3) |
| 규제 | `regulatory_permit` 차원과 중복 배제 | 유지 |

**신규**: `value_chain_link` 기반 var는 `r2 < 0.6` 시 `gradeChain()`과 동일한 기준으로 **저신뢰 배제**(현재 부재 — 결측과 저신뢰를 구분 못 함).

**신규 — 게이트별 축소 판정** (`docs/governance/rag-framework.md`에 §5-부속으로 명문화, Task 2로 선반영):

- Screening: `market` Amber 상한 기본, TAM/성장률만 평가, 나머지 축은 unassessed
- Pre-FS: TAM/성장률 출처화, 6축은 아직 unassessed
- DD: 전체 6축 `value_chain_link` 증거 활성화, Amber 상한 해제

### 결정 7: `applies_when` — 결정 5e의 사실 기반 var를 포함해 같은 술어 언어 재사용

기존 설계 유지. 미충족 단계는 **"사유와 함께 skip"**으로 기록(조용히 사라지지 않음). 신규: 법무 지적대로, 내부기원 프로젝트의 skip은 review 모델의 기존 어휘(verified/could-not-verify/**needs-judgement**)에서 **needs-judgement**로 표기 — PR-9가 실제 내용(법인설립·IP양도·TUPE)을 채우기 전까지 "적용안됨"이 아니라 "아직 판단 안 됨"으로 정직하게 남긴다.

### 결정 8: Kill Criteria — 실행 가능 비율을 게이트로

기존 레지스트리 설계 유지(YAML 불변). **신규(risk-officer F7)**: "선언 N / 실행가능 M"을 rationale 문자열에 묻지 않고 **`_validate.ts --strict`가 체크인된 기준선 대비 하락 시 실패**하도록, `scripts/audit.ts` 출력에도 노출한다.

**신규(분류실무 #6c)**: kill-criteria 레지스트리도 `rag_rule`과 동일한 `enabled=0`/`governance_doc` 반조작 게이트를 적용한다 — 원안은 이 비대칭을 놓쳤다.

**신규(risk-officer F8)**: `risk` var에 **파트너 소싱 실패**(`partner_candidate.status`+`dependency_risk`, ADR-0031)를 추가 — risk-officer 자신의 3대 킬트리거 중 하나가 원안에서 완전히 누락돼 있었다.

### 결정 9 (신규, 사용자 확인 필요 — 거버넌스 라운드1 최대 이견, §5에서 확정): 미검증 규칙의 Green 상한

D-M3-1~4가 비보정 상태로 실사용됐다는 선례(process-governance-manager)와, 그 선례의 진짜 통제는 문서화가 아니라 **인간이 매 등급을 직접 확인하는 절차 자체**였다는 반박(compliance-officer)이 맞섰다. compliance-officer 제안을 채택: **미검증 market/technical/risk 규칙은 `enabled=1`이어도 Amber·Red만 낼 수 있고 Green을 낼 수 없다.** ADR-0016의 overall 규칙이 이미 "6개 전부 Green이어야 Green"을 요구하므로, 세 차원에 Amber 상한을 거는 비용은 사실상 0(유용한 Red 신호는 그대로 살아있음)이라는 게 채택 근거다. 캘리브레이션(과거 5-10건 재현, 원안의 FR-RAG-07 대응)이 끝나면 상한을 해제한다.

---

## 4. 12개 셀 분류표

3축(`case_type` × `origin` × `technology_track`)에서 `origin`이 4값(뒤집힘 5로 `joint` 추가)이 되며, `case_type`은 2값(`greenfield`/`brownfield`), `technology_track`은 2값(`none`/`rbd`)이다. 아래는 원 계획이 정의한 12개 셀(3축 조합 중 파일럿이 실제로 다룬 셀 + 홈리스 셀)이다.

| # | case_type | origin | technology_track | 파일럿 매핑 | 비고 |
|---|---|---|---|---|---|
| 1 | greenfield | external | none | — | 순수 외부 신설(전형) |
| 2 | greenfield | external | rbd | — | 외부 파트너 R&BD 공동개발 신설 |
| 3 | greenfield | internal | none | — | 순수 사내 신설(비R&BD) |
| 4 | greenfield | internal | rbd | — | 사내 R&BD 신설 |
| 5 | greenfield | hybrid | none | — | 수동적 소수지분 참여 신설 |
| 6 | greenfield | hybrid | rbd | — | 소수지분 + R&BD |
| 7 | greenfield | joint | none | — | **신규(뒤집힘5)**: 대등 출자 JV, 비R&BD |
| 8 | greenfield | joint | rbd | — | 대등 출자 JV + 공동 R&BD |
| 9 | greenfield | internal | none (사내벤처 특화) | — | **홈리스** — 순수 사내벤처, 사업성 검증 게이트 부재(분류실무 #4) |
| 10 | greenfield | internal | rbd (사내벤처 특화) | — | **홈리스** — 사내벤처 + R&BD, 동일 사유 |
| 11 | brownfield | external | none | 파일럿 001(HD현대重-STX重工), 008(딜리버리히어로-우아형제) | 전형적 M&A |
| 12 | brownfield | internal | none | — | 카브아웃/계열사간 이전 — 뒤집힘6의 HHI 게이팅 결함이 정확히 여기서 발생 |

홈리스 셀 9/10(순수 사내벤처)은 §5 PR-10과 §7 "남은 사용자 결정"에서 별도 미팅이 필요한 신규 도메인 콘텐츠로 남겨둔다 — 이번 계획은 첫 단추(스키마상 셀 존재)만 놓는다. `hybrid`(파일럿 014형)와 `joint`(순수 JV)는 지배구조가 반대이므로 절대 병합하지 않는다(뒤집힘 5).

---

## 5. PR 시퀀스

### Stage 0 — 설계 문서 작성 및 승인 (구현 착수 전 필수)

| # | 작업 | 산출물 |
|---|---|---|
| 0.1 | 이 계획(미팅 검토 반영본)을 정식 설계 문서로 작성 | 본 문서 |
| 0.2 | 미팅 전사 정식 기록 | `memory/meeting-2026-08-22-rag-formalization-review.md` — 6개 관점 라운드1 결과 + 7개 뒤집힘 + 2개 미해결 후 사용자 확정 내역을 스킬 표준 형식(아젠다/라운드별 발언/종합/액션아이템)으로 |
| 0.3 | ADR 초안 5건 우선 작성 (구현이 실제로 걸리는 것부터) | `docs/adr/0046-*`(술어 AST+증거레지스트리) / `0047-*`(3축 분류모델+case_subtype폐기+project_policy_pin) / `0048-*`(ADR-0037 개정) / `0049-*`(ADR-0016 개정, UNASSESSED 4번째 상태) / `0050-*`(ADR-0045 errata 각주) |
| 0.4 | `docs/governance/rag-framework.md`에 market 게이트별 축소판정 서브섹션 선반영(§5-부속, 결정 6) — 코드보다 문서가 먼저 | 문서만, 코드 없음 (본 세션 Task 2로 완료) |
| 0.5 | `docs/decisions/open/{market,technical-execution,risk}-thresholds.md` 3건 — 미검증 임계값 미팅 아젠다 초안 | PR-9 전 사용자 승인 대상 |
| — | **게이트**: 0.1-0.5 완료 후 사용자 승인 → PR-0 착수 | |

기준선: `bun test` 278 pass / 0 fail(스키마 검증 재현 확인), `bun scripts/audit.ts` 통과, openapi 드리프트 게이트.

| PR | 내용 | 비고 |
|---|---|---|
| **PR-0** 발견 | `_validate.ts` 참조 무결성(warn) + `walkAllSteps` + **경고 항상 출력**(risk-officer F11 — 현재 VERBOSE 없으면 침묵). `graph-map.ts`. `PRAGMA foreign_keys=ON` 부팅경로 확인(risk-officer F10) | 위험 없음 |
| **PR-1** 술어 엔진 | AST + **3치 논리표를 ADR에 명시 후 구현**(결정 1) + `renderKo`(3배 재산정, 한국어 조사 규칙 포함) + `zod`를 **직접 의존성으로 추가**(현재 전이의존만 — 스키마 F-12) | 중간(과소산정 위험 해소됨) |
| **PR-2** 마이그레이션 (구 0012 분할 A) | `certification` 5컬럼 + **`rag_rule` DROP+CREATE**(결정 1) + `evidence_var`/`rag_rule_variable`(결정 2). PR-3과 같은 릴리스 | 낮음 |
| **PR-3** kill-criteria + 경계#5 수정 | 레지스트리(predicate 대부분 null) + `ProcedureDoc` 필드 + **brownfield-dd 9단계 skill_key를 `certification-transferability`로, 해당 SKILL.md owner를 `legal-counsel`로**(법무 #1, #6 — "사용자 결정"에서 "확정 결함"으로 재분류) + **`transferability_basis='inferred'`는 write 시점에 레포지토리 레이어에서 하드 차단**(kill-criterion만으로는 불충분 — 뒤집힘7) | 낮음 |
| **PR-4** 분류 인프라 (구 0012 분할 B) | `dimension_input`(결정 3, `reviewed_by` 포함) + `project_case_classification`(결정 5b, 4값 origin) + `deal_structure_hypothesis` + `md_project.current_stage_gate`(결정 5c) + `compliance_check.result` 확장(결정 5d). **코드가 그 형태를 증명하는 PR-5와 같은 릴리스 창구**(스키마 F-14) | 낮음 |
| **PR-5** 분류 라우팅 — 결정 5 전체 | 5a(사실기반 게이팅, 결정 5e) 먼저, 5b(승인 비대칭 쓰기 경로, 결정 5a) 다음, 5c(완결성 점검 — `not_applicable` 3-숫자 기록, 결정 5d) 마지막. **각각 별도로 착지**(원안의 split 유지, 단 내용 전면 교체) + `project_policy_pin` 백필(거버넌스 #8 — 기존 파일럿 011-014 포함 전 프로젝트가 무분류로 하드블록되는 것을 막는 필수 단계, 원안 누락) | 5c가 잔여 최고위험(§5.1) |
| **PR-6** market 차원 | 결정 6의 정정된 매핑 + 게이트별 축소판정 + `min_r2` 저신뢰 배제 + `right_to_win` 3분해 | 중간 |
| **PR-7** technical + risk | technical: `certification`/`permit`/`dd_finding` 위. risk: `contingent_liability`+`covenant_test`+**파트너소싱**(결정 8), `antitrust_finding` 명시적 제외 | 중간 |
| **PR-8** 스킬 그래프 경화 | `requires_tools`/`requires_skills`/`related_skills`/`procedure_keys`, output_type 레지스트리, `decision_authority: human`, **`case_subtype` 로직의 4개 미러 사본**(`skills/`+`.claude/`+`.gemini/`+`.agents/`) 전부 소탕(거버넌스 #13 — 원안은 정본만 다뤘음) | 낮음 |
| **PR-9** 규칙 활성화 | 미팅 승인 후. `enabled=1`+`policy_id`+`thresholds_source`. **미검증 market/technical/risk 규칙은 Green 등급 상한(Amber 캡) 적용**(결정 9) | 중간 |
| **PR-10** 워크플로우 공백 | Strategic Fit(각사), Market DD, Legal DD(CoC IP라이선스 조항 포함), Financing, **내부기원 법인설립·IP양도·TUPE 단계**(법무 #4), **GF-internal 사전 사업성 검증 게이트**(분류실무 #4, 셀 9/10) | 설계 논의 필요 |

### 5.1 잔여 최고위험

원안의 PR-5b(waiver 무력화)는 결정 5 전면 재설계로 해소를 시도했다. **잔여 최고위험은 PR-5c(완결성 점검의 신규 로직 자체가 초회 실행부터 정확해야 한다는 점)** — risk-officer F6: 이 통제는 오늘 프로덕션 호출자가 0건이라, "기존 통제를 분류인지로 만드는" 것이 아니라 **"통제를 만들면서 동시에 분류인지로 만드는"** 상황이다. 완화: PR-5c를 무조건(6개 전부 필수) 버전으로 먼저 파일럿 세트에 그린으로 만든 뒤, 같은 PR 안에서 `applies_when` 조건을 얹는다 — 두 단계를 시간차 없이도 논리적으로 분리해 커밋한다.

두 번째: PR-6(시장)이 `docs/governance/rag-framework.md`에 산문 자체가 없는 상태에서 시작하므로, PR-1의 3치 논리 정확성과 PR-2의 저신뢰 배제가 먼저 자리잡지 않으면 첫 시장 규칙부터 결함이 재생산된다.

### 5.2 반조작 스테이징

1. `enabled=0`이 **DB 기본값**(결정 1 DDL) — 시드로더 관례가 아니라 CHECK 제약
2. `enabled=1`은 SQL `CHECK`로 `policy_id`+`thresholds_source` 필수(결정 1) + zod가 트리 내 `_threshold_placeholder` 부재를 추가 검증
3. `docs/decisions/open/{market,technical-execution,risk}-thresholds.md` — 미팅 아젠다
4. 그 동안 `dimension_input`이 채점하되 `reviewed_by`(교차도메인) 전까지 반영 안 함(결정 3)
5. **신규**: `enabled=1`로 전환된 후에도 캘리브레이션 전까지 Green 상한(결정 9)

### 5.3 검증

```bash
cd Projects/co-newbiz && bun test && bun scripts/audit.ts
cd Projects/co-newbiz && bun procedures/_validate.ts && bun scripts/co-newbiz/graph-map.ts --check
```

- **PR-1**: 3치 논리표의 6개 연산자 전부에 대한 진리표 테스트. `financialBand`의 IEEE-754 경계값이 범용 `cmp`로도 동일 결과를 내는가(패리티 사전검증)
- **PR-2/4**: `PRAGMA foreign_keys=ON`이 실제로 걸린 채 신규 FK 위반이 거부되는가
- **PR-5a**: `target.has_external_market_presence=true`인 `origin=internal` 카브아웃이 HHI 심사를 여전히 받는가(뒤집힘6 재발 방지)
- **PR-5b**: `origin=internal` 승인 없는 UPDATE가 **거부**되는가. `origin=external`→`internal` 다운그레이드에 `approver_role` 없이 시도 시 실패하는가
- **PR-5c**: 스킵된 검증자가 `result='not_applicable'`로 기록되고(**`pass` 아님**), `renderKo` 문장을 포함하는가. 재분류 시 기존 `not_applicable` 행이 무효화되는가. **12개 셀 × 검증자 적용성 전수 테스트**, 분류 데이터 손상 시나리오(행 없음·null·미지 enum) 전부에서 전형적 M&A 셀은 6개 전원 필수임을 단언
- **PR-9**: `enabled=1`+미검증 규칙이 Amber까지만 내고 Green을 못 내는가. `rankGroupAgenda`가 null을 Red보다는 유리하게, 그러나 확정 Green/Amber보다는 불리하게 처리하는가

---

## 6. ADR 목록

기존(원안, 이미 대상으로 식별돼 있던 것):

- 술어 AST + 증거 레지스트리
- 3축 분류 모델(4값 origin 포함)
- `case_subtype` 폐기
- `commercialization_path` enum + SRS 오기 정정(FR-RBD-04, ADR 아님 — SRS erratum으로 격하, PGM 확인)
- `applies_when` 도입
- 분류 스코프 절차 변형
- kill-criteria 레지스트리
- 인간 결정 단계 표기
- TS 채점기 존치(financial·regulatory_permit만, data_confidence 제외 미러링)
- market·technical·risk 임계값

**신규(미팅에서 6건 추가)**:

- ADR-0037 개정("6개 전부" → "해당분")
- ADR-0016 개정(UNASSESSED가 네 번째 상태, D-M3-3 삼분법 개정)
- `compliance_check.result` enum 확장
- `dimension_input`을 스코어링 경로로 인정하는 것(경계#2 관련)
- ADR-0045 정정 — **errata 각주로, 원문 Decision 텍스트는 불변**(2026-08-20 결정을 "선행 사실"로 Context에 인용, "supersedes ADR-NNNN"은 쓰지 않음 — 존재하지 않는 ADR을 승계했다고 쓸 수 없음)
- kill-criteria의 override 제거-금지 규칙에 대한 "법적으로 부적용" 예외 경로(법무 #5 — 삭제 아닌 상위 리전규정의 supersession 기록)

**Stage 0.3에서 지금 초안 작성하는 것 (5건)**:

| ADR | 제목(가안) | 다루는 결정 |
|---|---|---|
| 0046 | 술어 AST + 증거 레지스트리 | 결정 1, 2 |
| 0047 | 3축 분류 모델 + `case_subtype` 폐기 + `project_policy_pin` | 결정 5b, §7 사용자 확정 사항 2 |
| 0048 | ADR-0037 개정("6개 전부" → "해당분") | 결정 5d, 5e |
| 0049 | ADR-0016 개정, UNASSESSED 4번째 상태 | 결정 1(3치 논리), 뒤집힘 3 |
| 0050 | ADR-0045 errata 각주 | ADR-0045 정정 |

나머지 ADR(market/technical/risk 임계값, `commercialization_path` enum 등)은 각 PR 착수 시점에 함께 작성한다 — Stage 0.3의 범위가 아니다.

---

## 7. 사용자 확정 사항

1. **결정 9(Green 상한)**: **채택 확정.** 미검증 market/technical/risk 규칙은 `enabled=1` 이후에도 캘리브레이션 완료 전까지 Amber 상한(Green 불가).
2. **`case_subtype` 폐기 ADR**: **1건으로 확정.** 3축 분류 ADR(0047)에 통합하고, `project_policy_pin`(기존 파일럿 011-014 포함 프로젝트의 소급 처리) 결정을 그 ADR의 필수 섹션으로 강제.

### 남은 사용자 결정 (규모가 작거나 후속 PR에서 결정 가능)

1. `evidence_ref`를 `document` 테이블 FK로 강제할지, v1.1 경화 항목으로 미룰지 — PR-2/8 범위
2. 셀 9/10(순수 사내벤처) 및 내부기원 법인설립 단계의 실제 절차 콘텐츠(PR-10) — 신규 도메인 콘텐츠, 미팅도 첫 단추만 제시. PR-10 착수 시 별도 미팅 권장

---

## 8. 부록 — 그 밖에 보완할 결함 (미팅에서 확인)

- `legal-counsel`이 어떤 절차에서도 디스패치되지 않는다(확인됨) — PR-3에서 9단계 이관으로 최소 1건 해소, 나머지(경영진보상 CoC 법률자문, `deal_structure_hypothesis`의 세무/책임격리 항목)는 PR-10 범위
- `certification-transferability` 스킬 owner가 `certification-agent`인데 `legal-counsel.md`는 이 판단을 자신의 책임이라 명시 — **두 에이전트 파일의 모순**, PR-3에서 함께 정정
- MNPI/insider-list가 `dimension_input`·`deal_structure_hypothesis`의 신규 쓰기 경로에 걸리는지 확인 안 됨(법무 #6) — PR-4 범위에 포함
- floating-point 금액(`REAL`)이 이미 저장소 전역에 위반돼 있고, `dimension_input.value_num`도 같은 패턴을 상속 — 이번 계획 범위에서 전체 시정은 하지 않되, 알려진 부채로 ADR에 기록(스키마 F-3)
- `db:export --dialect postgres`는 존재하지 않는다 — 이식성 주장은 전부 미검증 상태(스키마 F-4), 이번 계획 범위 밖이나 별도 플래그

---

## 관련 문서

- `docs/governance/rag-framework.md` — §5-부속(market 게이트별 축소판정, 결정 6)을 본 설계와 동시에 갱신(Task 2)
- `docs/adr/0016-*`, `0037-*`, `0045-*` — 개정 대상
- `memory/meeting-2026-08-22-rag-formalization-review.md` — 소스 미팅 전사(Stage 0.2, 별도 산출물)
