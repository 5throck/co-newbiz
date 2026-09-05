---
lang: ko
lang_reason: source-material
---

# 프로젝트 문서

`docs/` 인덱스 — co-newbiz 시스템의 거버넌스 문서, 엔지니어링 명세, 운영 기록.
파일은 주제별 하위 폴더로 구성되며, 코드 의존성이 있는 4개 파일만 `docs/`
최상위에 그대로 둔다(`context.md`, `phase-definitions.md`, `process-flow.md`,
`skill-graph.{md,json,overrides.json}` — 아래 표 참조).
프로젝트 정체성과 표준은 [`context.md`](../context.md)에서 시작하고, 변형별
설정은 [`co-newbiz.context.md`](co-newbiz.context.md)에 있다.

## 주제 폴더

| 폴더 | 내용 |
|------|------|
| [`meta/`](../meta/) | 이 인덱스, 버전 매니페스트, 변형 컨텍스트 |
| [`architecture/`](../architecture/) | 엔지니어링 계약 — SRS, API 명세, OpenAPI, DB 스키마, UI 명세, MCP 통합 |
| [`governance/`](../governance/) | 프로세스·거버넌스 운영 — 프로세스 맵, RACI, RAG 프레임워크, 운영 주기, 추적성 매트릭스 |
| [`security/`](../security/) | 보안 모델, 베이스라인, 정책 |
| [`design/`](../design/) | 디자인 가이드와 철학·토큰·컴포넌트·표준화면·접근성 페이지 |
| [`dd/`](../dd/) | 실사 방법론 — 개요, 도메인 가이드, 발견사항 규칙, waiver, 밸류에이션 브릿지, 모범 사례 |
| [`planning/`](../planning/) | 개발 계획, 전환 계획, 웹 구현 계획, 파일럿 조사 |
| [`guidelines/`](../guidelines/) | 권장 등급 실무 가이드 — 전문가 인터뷰, 프록시 체인 홉 분류 |
| [`adr/`](../adr/) | 아키텍처 결정 기록 — 인덱스는 `adr/README.md`, [memory/MEMORY.md](../../memory/MEMORY.md)에도 미러링 |
| [`audits/`](../audits/) | 준비도·컴플라이언스 감사 보고서 |
| [`decisions/`](../decisions/) | 날짜별 의사결정 기록 (임계값 승인, 어휘, 안건 팩) |
| [`designs/`](../designs/) | 주요 작업 라운드의 설계 문서(기록본) |
| [`lifecycle/`](../lifecycle/) | 에이전트/스킬/스크립트 거버넌스 기록 (`agents/` 1:1 대응) |
| [`manuals/`](../manuals/) | 3개 청중용 사용자 가이드 — business / admin / operations — 각각 한국어판(`*_ko.md`) 포함 |
| [`pilots/`](../pilots/) | 절차를 검증한 실제 케이스 수동 파일럿 기록 |
| [`research/`](../research/) | 출처를 갖춘 외부 조사 입력자료 |
| [`runbooks/`](../runbooks/) | 운영 런북 (배포, 백업/복원) |

## 주제별 핵심 문서

- **정체성·표준** — [`context.md`](../context.md),
  [`co-newbiz.context.md`](co-newbiz.context.md),
  [`VERSION_MANIFEST.md`](VERSION_MANIFEST.md)
- **계약** — [`architecture/srs.md`](../architecture/srs.md),
  [`architecture/api-spec.md`](../architecture/api-spec.md),
  [`architecture/openapi.yaml`](../architecture/openapi.yaml),
  [`architecture/db-schema.md`](../architecture/db-schema.md),
  [`architecture/ui-spec.md`](../architecture/ui-spec.md),
  [`architecture/mcp-integration.md`](../architecture/mcp-integration.md)
- **거버넌스** — [`governance/process-map.md`](../governance/process-map.md),
  [`governance/raci.md`](../governance/raci.md),
  [`governance/rag-framework.md`](../governance/rag-framework.md),
  [`governance/governance-operations.md`](../governance/governance-operations.md),
  [`governance/ops-cadence.md`](../governance/ops-cadence.md),
  [`governance/traceability-matrix.md`](../governance/traceability-matrix.md)
- **보안** — [`security/security-model.md`](../security/security-model.md),
  [`security/security-baseline.md`](../security/security-baseline.md),
  [`security/security.md`](../security/security.md)
- **디자인** — [`design/design-guide.md`](../design/design-guide.md)와 같은 폴더의
  철학·토큰·컴포넌트·표준화면·접근성 페이지
- **실사** — [`dd/`](../dd/) 아래 7개 문서, 시작은
  [`dd/dd-overview.md`](../dd/dd-overview.md)

## 최상위 파일 (코드 의존성 — 이동 금지)

| 파일 | `docs/` 최상위에 두는 이유 |
|------|---------------------------|
| [`context.md`](../context.md) | `scripts/verify-scripts.ts`의 `findWorkspaceRoot()`가 루트 마커로 사용 |
| [`phase-definitions.md`](../phase-definitions.md) | `scripts/team-builder.ts`의 `updateWorkflowDocs()`가 이 정확한 경로에 기록 |
| [`process-flow.md`](../process-flow.md) | `scripts/co-newbiz/generate-process-flow.ts`와 `app/web-next/lib/process-flow.ts`가 읽고 씀 |
| [`skill-graph.md`](../skill-graph.md) / [`.json`](../skill-graph.json) / [`.overrides.json`](../skill-graph.overrides.json) | `scripts/generate-skill-graph.ts`, `scripts/verify-skill-graph.ts`, `/sync` 파이프라인이 읽고 씀 |

## 아키텍처 결정 기록 (ADR)

ADR은 Context / Decision / Consequences 형식으로 중요한 결정을 기록합니다.
권위 있는 인덱스는 [`adr/README.md`](../adr/README.md)입니다.

### 수명주기

| 상태 | 의미 |
|--------|---------|
| Proposed | 검토 중 |
| Accepted | 현행 방식 |
| Deprecated | 더 이상 권장하지 않음 |
| Superseded | 더 최신 ADR로 대체됨 |

신규 ADR은 `scripts/co-newbiz/adr-new.ts`를 따릅니다 (번호 체계와 트리거
목록은 design §7); `adr-governance` 스킬 참조.
