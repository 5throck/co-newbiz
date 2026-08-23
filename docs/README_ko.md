---
lang: ko
lang_reason: source-material
---

# 프로젝트 문서

`docs/` 인덱스 — co-newbiz 시스템의 거버넌스 문서, 엔지니어링 명세, 운영 기록.
프로젝트 정체성과 표준은 [`context.md`](context.md)에서 시작하고, 변형별
설정은 [`co-newbiz.context.md`](co-newbiz.context.md)에 있습니다.

## 명세와 계약

| 파일 | 목적 |
|------|------|
| [`context.md`](context.md) | 모든 AI 도구가 공유하는 불변 프로젝트 정체성 (아키텍처, 워크플로, 언어 정책) |
| [`co-newbiz.context.md`](co-newbiz.context.md) | 변형 설정 — 기술 스택, 에이전트, 스킬, 스크립트, 워크플로 |
| [`srs.md`](srs.md) | 소프트웨어 요구사항 명세 (13개 도메인 ~85개 FR, MoSCoW 우선순위) |
| [`traceability-matrix.md`](traceability-matrix.md) | 정책 조항 → 절차 → 요구사항 → 구현 → 검증 매핑 |
| [`db-schema.md`](db-schema.md) | 10개 도메인 데이터베이스 테이블 카탈로그 및 인덱스 근거 |
| [`api-spec.md`](api-spec.md) | REST 엔드포인트 카탈로그와 접근통제 계약 (`app/server/*.ts`) |
| [`openapi.yaml`](openapi.yaml) | OpenAPI 3.1 as-built 표면 — `tests/unit/openapi.test.ts`가 라우트와 대조 집행 |
| [`mcp-integration.md`](mcp-integration.md) | REST API 위의 MCP 도구 카탈로그 (ADR-0011: REST 전용 접근) |
| [`ui-spec.md`](ui-spec.md) | SPA 정보구조와 RAG 표시 계약 |
| [`rag-framework.md`](rag-framework.md) | 6차원 RAG 채점 규칙, 밴드, 히스테리시스, 게이트별 축소 판정 |

## 거버넌스와 운영

| 파일 | 목적 |
|------|------|
| [`process-map.md`](process-map.md) | Screening → Pre-FS → FS → DD → Entity IC → Group IC 게이트 맵과 kill criteria |
| [`raci.md`](raci.md) | 게이트별·도메인 리드별 RACI 표 |
| [`governance-operations.md`](governance-operations.md) | 컴플라이언스 모니터링, waiver, 해석 레지스트리, 정책 변경 파이프라인 |
| [`ops-cadence.md`](ops-cadence.md) | 운영 리듬: 순환 주기와 리뷰어 수용력 산정 |
| [`transition-plan.md`](transition-plan.md) | 워크스페이스 도입 순서와 진행 중 검토 처리 |
| [`dev-plan.md`](dev-plan.md) | 단계/웨이브 구현 계획과 수용 기준 |
| [`security-model.md`](security-model.md) | 신뢰 경계, STRIDE 매트릭스, 검증 체크리스트 (§8 상태) |
| [`security-baseline.md`](security-baseline.md) | 순환 보안 주기와 사전 배포 게이트 |
| [`VERSION_MANIFEST.md`](VERSION_MANIFEST.md) | 컴포넌트 버전 (common overlay / variant) |

## 디렉터리

| 디렉터리 | 내용 |
|-----------|----------|
| [`adr/`](adr/) | 아키텍처 결정 기록 — 인덱스는 `adr/README.md`, [memory/MEMORY.md](../memory/MEMORY.md)에도 미러링 |
| [`audits/`](audits/) | 준비도·컴플라이언스 감사 보고서 |
| [`decisions/`](decisions/) | 날짜별 의사결정 기록 (임계값 승인, 어휘, 안건 팩) |
| [`designs/`](designs/) | 주요 작업 라운드의 설계 문서(기록본) |
| [`lifecycle/`](lifecycle/) | 에이전트/스킬/스크립트 거버넌스 기록 (`agents/` 1:1 대응) |
| [`manuals/`](manuals/) | 3개 청중용 사용자 가이드 — business / admin / operations — 각각 한국어판(`*_ko.md`) 포함 |
| [`pilots/`](pilots/) | 절차를 검증한 실제 케이스 수동 파일럿 기록 |
| [`research/`](research/) | 출처를 갖춘 외부 조사 입력자료 |
| [`runbooks/`](runbooks/) | 운영 런북 (배포, 백업/복원) |

## 아키텍처 결정 기록 (ADR)

ADR은 Context / Decision / Consequences 형식으로 중요한 결정을 기록합니다.
권위 있는 인덱스는 [`adr/README.md`](adr/README.md)입니다.

### 수명주기

| 상태 | 의미 |
|--------|---------|
| Proposed | 검토 중 |
| Accepted | 현행 방식 |
| Deprecated | 더 이상 권장하지 않음 |
| Superseded | 더 최신 ADR로 대체됨 |

신규 ADR은 `scripts/co-newbiz/adr-new.ts`를 따릅니다 (번호 체계와 트리거
목록은 design §7); `adr-governance` 스킬 참조.
