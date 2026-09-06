---
lang: ko
lang_reason: source-material
counterpart: security-model.md
---

# 보안 모델 — co-newbiz

**Owner**: security-engineer (legal-counsel, compliance-officer 공동)
**Design of record**: design v1.0 §4-9-1 (task 4.5), ADR-0038/0039/0040/0012
**Status**: Stage 5 — 통제 항목 구현 완료(Wave 5.5-5.7)이며, 아래 신뢰 경계 다이어그램에 대해 재점검(re-walk)을 수행했습니다(Wave 5.9, `docs/security/security-baseline.md` §1에 따른 첫 분기 위협 모델 갱신). 다이어그램 작성(Stage 4) 이후 새로운 신뢰 경계는 도입되지 않았습니다: REST API 계층(Wave 5.6A), 웹 SPA(Wave 5.6B), MCP 서버(Wave 5.7A) 모두 다이어그램 그대로 리포지토리 계층으로 수렴합니다. 재점검의 증거는 아래 §9에 기록되어 있습니다.

## 1. 신뢰 경계 (Trust Boundaries)

```
[AI Client (Claude/Antigravity/Codex)] --stdio--> [MCP server] --REST--> [API layer] --repo layer--> [DB]
[Web Browser] --HTTPS--> [API layer] --repo layer--> [DB]
[CLI] --direct or REST--> [API layer / DB via repo layer]
```

**단일 시행 지점**: 위의 모든 경로는 프로젝트 멤버십 필터링(FR-SEC-03)을 위해 리포지토리 계층(`db/repositories/*.ts`)으로 수렴합니다. 해당 지점 위의 어떤 신뢰 경계도 리포지토리 계층의 것과 불일치할 수 있는 별도의 인가 로직을 갖는 것은 허용되지 않습니다.

## 2. STRIDE 위협 매트릭스

| 위협 | 벡터 | 통제 |
|---|---|---|
| **스푸핑(Spoofing)** | 탈취된 세션 쿠키 / API 토큰 | 해시된 토큰 저장, `httpOnly`+`secure`+`SameSite=Lax` 쿠키, 비밀번호 재설정 시 세션 폐기(FR-SEC-09) |
| **스푸핑(Spoofing)** | 에이전트 서비스 계정 사칭 | 에이전트 서비스 계정은 애초에 존재하지 않음 — 에이전트는 호출 사용자의 세션을 상속(설계 불변 경계 #1, FR-SEC-08) |
| **변조(Tampering)** | 리포지토리 계층을 우회한 직접 DB 쓰기 | 모든 접근은 `db/repositories/*.ts`를 통해 수행; 우회 쿼리 경로에 대한 코드 리뷰 + 정적 스캔(FR-SEC-03) |
| **변조(Tampering)** | 감사 로그 삭제 | Append-only `audit_log`, 관리자를 포함한 어떤 DB 역할에도 DELETE 권한 없음(FR-SEC-07, ADR-0012) |
| **부인(Repudiation)** | 사용자가 민감한 작업 수행을 부인 | 민감 테이블 읽기 접근에 대한 `data_access_log`(쓰기만이 아님); 모든 쓰기에 `audit_log` 기록 |
| **정보 노출(Information Disclosure)** | 비멤버가 프로젝트의 존재를 열거/탐지 | 기본 거부(deny-by-default) 멤버십; 비멤버는 403이 아닌 404를 받아 존재 자체가 노출되지 않음(FR-SEC-01) |
| **정보 노출(Information Disclosure)** | 멤버십 없이 `admin` 역할로 딜 데이터 열람 | 2축 모델(역할 × 멤버십) — admin은 시스템 관리 권한만 부여(FR-SEC-02) |
| **정보 노출(Information Disclosure)** | 개인 급여 데이터 노출 | `comp_benchmark`에 개인 단위 행 없음; `executive_ref`는 역할 기반 키이며 실명 불사용(FR-SEC-05, FR-MA-06) |
| **정보 노출(Information Disclosure)** | MNPI 프로젝트 데이터가 미승인 AI 클라이언트에 도달 | `mnpi_flag`는 해당 프로젝트를 MCP 기본 응답에서 제외; 명시적 스코프 토큰 오버라이드 자체도 감사 대상(FR-SEC-06) |
| **정보 노출(Information Disclosure)** | 관리자 콘솔을 통한 API 키 값 노출 | 콘솔은 존재 여부 + 최종 성공 타임스탬프만 표시 — 키 값을 렌더링할 수 있는 필드가 UI에 존재하지 않음(설계 §4-9) |
| **정보 노출(Information Disclosure)** | 월 그룹 제외 사용자가 간접 경로(예: 리포트 링크)로 프로젝트 접근 | `wall_group` 제외는 멤버십과 동일한 리포지토리 계층에서 시행 — 기본 프로젝트 엔드포인트에서만 시행되지 않음(FR-SEC-04) |
| **서비스 거부(Denial of Service)** | 통제되지 않는 아웃바운드 fetch 루프 | `ensure_fresh()`의 캐시 우선 설계 + 모든 아웃바운드 호출에 대한 `safeFetch()` SSRF 가드(FR-DATA-05/06) |
| **서비스 거부(Denial of Service)** | 무제한 MCP 쓰기 도구 호출 | × 표시 도구에 대한 토큰별 레이트 리밋, 읽기 도구 제한보다 엄격(`docs/architecture/mcp-integration.md` §5) |
| **권한 상승(Elevation of Privilege)** | 웨이버 승인 역할 혼동 | 계층별 승인 역할 테이블 고정(regulation=Group IC, procedure=process-governance-manager, checklist item=domain lead) — 낮은 권한의 행위자가 설정 변경 불가(`docs/governance/governance-operations.md` §2) |
| **권한 상승(Elevation of Privilege)** | MCP 도구 스코프 확장 | OpenAPI SSOT 드리프트 검사(`docs/architecture/mcp-integration.md` §6) — 매칭되는 REST 엔드포인트 없이 노출된 도구는 CI 실패 |

## 3. 데이터 분류 및 취급

| 민감도 | 예시 | 통제 |
|---|---|---|
| Restricted (MNPI) | `mnpi_flag=true` 프로젝트 데이터 | `insider_list`, 전체 접근 로깅, MCP 기본 제외, 접근 시 알림 배너 |
| Confidential | 임원 보상, 개인 직원 급여 | 가능한 집계 전용 저장, 역할 기반 대체 키, 상승된 역할의 API 접근 요구 |
| Internal | 딜 재무 정보, DD 결과, 비(非)MNPI 프로젝트 데이터 | 프로젝트 멤버십 게이팅 |
| Public (워크스페이스 내) | 용어집, 해석 레지스트리 | 프로젝트 스코핑 불필요 |

## 4. 인증 및 세션 보안

- PBKDF2-HMAC-SHA256, 210,000회 반복, 16바이트 솔트, 32바이트 키(OWASP 2023) — `scripts/lib/auth.ts`에서 재사용(ADR-0009).
- 평문 비밀번호는 오류 메시지나 감사 로그 페이로드를 포함하여 절대 로깅하지 않음.
- 비밀번호 재설정: 관리자가 임시 비밀번호 설정 → `must_change_password=1` + 기존 세션 폐기 → 사용자가 다른 작업 전에 전체 화면 변경 플로우를 강제 통과 → 새 비밀번호를 `password_history`와 대조.
- N회 실패 후 계정 잠금; 세션은 서버 측(DB)에 저장되어 강제 종료 가능.

## 5. 개인 데이터 최소화 (ADR-0039)

- 집계로 충분한 경우 개인 식별자를 수집하지 않음.
- 보존 기간: 딜 종료/마감 + N개월 → `retention_policy`를 통한 자동 삭제.
- 국경 간 이전: 해외 M&A는 문서화된 이전 근거가 필요하며, 해당 `region-profiles/<ISO2>.yaml` 항목에 기록.
- 보상 데이터를 다루는 모든 분석/통계 쿼리에는 가명 처리 뷰(`v_comp_anonymized`) 사용 — 승인된 역할이라도 해당 목적의 직접 테이블 접근은 허용되지 않음.

## 6. MNPI 취급 (ADR-0040)

- `mnpi_flag=true`는 추론이 아닌 프로젝트 분류 시점에 `legal-counsel`이 설정.
- `insider_list`는 자동 생성·유지되며, 멤버십 부여/철회 자체도 감사 로그에 기록.
- MNPI 플래그가 지정된 모든 프로젝트 화면/응답에 접근 배너 표시.
- 감사되는 스코프 토큰 오버라이드와 함께 MCP 기본 제외(위 §2).

## 7. 검증 (설계 §12 전방 참조 — "하나라도 빠지면 실패")

1. 비멤버로 로그인; 대상 프로젝트가 **어떤** 표면에도 나타나지 않는지 확인 — 목록, 검색, 직접 API 호출, 리포트, MCP 도구 응답 모두.
2. 프로젝트 멤버십 없이 `admin`으로 로그인; 딜 데이터에 여전히 접근 불가한지 확인.
3. 조작된 쿼리로 리포지토리 계층 우회 시도; 거부되거나 해당 코드 경로가 존재하지 않는지 확인.
4. 테스트 프로젝트에 `mnpi_flag=true` 설정; `insider_list`가 자동 채워지고, 모든 접근이 로깅되며, 스코프 없는 MCP 토큰의 응답에서 프로젝트가 제외되는지 확인.
5. `comp_benchmark`에 개인 단위 행 삽입 시도; 스키마/제약이 이를 거부하는지 확인(린 경고가 아님).
6. `management_package.executive_ref`에 실명 삽입 시도; 거부되는지 확인.
7. 관리자/DB 소유자를 포함한 모든 역할로 `audit_log` 삭제 시도; 성공 경로가 없는지 확인.
8. 직접 DB 덤프에서 비밀번호 복구 시도; 불가능한지 확인(해시 전용 저장, 올바른 알고리즘).

## 8. Wave 5.9 검증 상태 (첫 분기 위협 모델 갱신)

`docs/security/security-baseline.md` §1의 분기 주기에 따라, 마지막 검토 이후의 스키마/API 변경 사항을 대상으로 신뢰 경계 다이어그램(§1)에 대해 재점검을 수행 — 이 문서를 다시 읽는 것에 그치지 않고 이미 구축되고 이미 테스트된 코드에 대해 실제로 실행했습니다.

| # | §7 검증 항목 | 증거 |
|---|---|---|
| 1 | 비멤버는 어떤 표면에서도 프로젝트를 볼 수 없음 | `tests/unit/security.test.ts` §7-1 (리포지토리 계층); `tests/unit/api.test.ts` "비멤버의 직접 fetch는 404" (REST 계층); `tests/unit/mcp.test.ts` "비멤버는 REST 404를 그대로 받음" (MCP 계층) — 리포지토리 계층 한 번이 아니라 세 개의 신뢰 경계 경로 모두 독립적으로 확인 |
| 2 | 멤버십 없는 admin은 딜 데이터를 볼 수 없음 | `tests/unit/security.test.ts` §7-2; `tests/unit/api.test.ts` "멤버십 없는 admin은 아무것도 못 봄 (FR-SEC-02)" |
| 3 | 리포지토리 계층 우회 경로 없음 | `tests/unit/security.test.ts` §7-3은 `project.repository.ts`의 정확한 export 함수 집합(`createProject`/`getProjectIfVisible`/`listVisibleProjects`)을 단언 — 우회 export가 추가되면 이 테스트가 실패 |
| 4 | MNPI: `insider_list` 자동 생성, 접근 로깅, 스코프 없는 MCP 응답에서 제외 | `tests/unit/security.test.ts` §7-4; `tests/unit/api.test.ts` "기본 목록에서 MNPI 제외"; `tests/unit/mcp.test.ts`의 `list_projects`는 절대 `include_mnpi`를 전달하지 않음 |
| 5 | `comp_benchmark` 개인 단위 데이터는 스키마가 거부 | `tests/unit/security.test.ts` §7-5 (`PRAGMA table_info`로 k× CHECK 확인 — 린 경고가 아님) |
| 6 | `management_package.executive_ref` 실명 거부 | `tests/unit/security.test.ts` §7-6 (바이트 기반 서러게이트 키 CHECK) |
| 7 | `audit_log` 삭제는 어떤 역할도 불가능 | `tests/unit/security.test.ts` §7-7 (DB 트리거 거부); `app/server/admin.ts` 자체 모듈 주석도 API 계층에 DELETE 라우트가 없음을 확인 — 하나가 아닌 두 개의 독립적인 시행 계층 |
| 8 | DB 덤프에서 비밀번호 복구 불가 | `tests/unit/security.test.ts` §7-8 (해시 전용 저장, PBKDF2-HMAC-SHA256 확인 — "해시가 존재한다" 수준이 아님) |

위 번호 목록이 다루지 않는 코드에 대한 STRIDE 행 표본 검증:

- **DoS / 무제한 MCP 쓰기 도구 호출**: `mcp/co-newbiz/shared/rest-client.ts`의 분리된 읽기(60/분) 및 쓰기(10/분) 토큰 버킷, `tests/unit/mcp.test.ts`의 스코프 시행 테스트에서 확인
- **권한 상승 / MCP 도구 스코프 확장**: `mcp/co-newbiz/index.ts`의 11개 도구는 모두 실제 `app/server/` REST 엔드포인트와 1:1 매핑 — 매칭 엔드포인트 없는 도구는 없음(역방향 — MCP 도구 없는 엔드포인트 — 는 드리프트가 아닌 문서화된 의도적 연기)
- **변조 / 감사 로그 삭제**: 위 7번 항목에서 언급한 대로 이중 확인(DB 트리거 + API 라우트 부재)

이번 재점검에서 §2에 나열된 어떤 통제 항목도 회귀하거나 미구현 상태로 발견되지 않았습니다. Wave 5.6-5.9의 실제 구현으로 인해 새로운 STRIDE 행이 필요한 새로운 신뢰 경계도 도입되지 않았습니다.

## 9. 관련 문서

- `docs/security/security-baseline.md` — 반복 운영되는 보안 주기(스캔, 패칭, 접근 검토)
- `docs/architecture/api-spec.md` §1 — 이 모델이 정당화하는 접근 통제 규칙
- `docs/architecture/db-schema.md` §9 — 이 모델이 관할하는 정보 보호 테이블
- `docs/runbooks/backup-restore.md` — 이 분기 갱신에 대응하는 DR 훈련 문서
