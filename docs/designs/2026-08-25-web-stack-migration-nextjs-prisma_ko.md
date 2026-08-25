# 설계 — 웹 스택 전면 재구축 (Hono/Vite/bun:sqlite → Next.js/Prisma)

**상태**: Phase 1 진행 중 (스캐폴딩 + 스키마 역산 완료, ADR-0071로 PK 차단 이슈 해결; ADR-0069/0070은 여전히 Proposed — Phase 2 착수는 그 승인과 무관하게 사용자 지시로 진행)
**소유**: platform-lead(아키텍처), security-expert(ADR-0011 경계 보존), architect(마이그레이션 시퀀싱)
**관련**: ADR-0001(SQLite 채택), ADR-0002(DB 이식성), ADR-0010(현 웹 스택 — 본 설계로 대체 제안), ADR-0011(MCP는 REST-only — 본 설계로 대체 제안), ADR-0038/0039/0040(접근제어·PII·MNPI — 영향 확인 필요)

---

## 1. 배경과 트리거

세션 내 유압브레이커 권역×세그먼트×시나리오 매트릭스를 조회할 화면을 만드는 작업에서, 참고 프로젝트 `Projects/co-price`의 UI 패턴(`IntelligenceMatrix.tsx`)을 인용하다가, 사용자가 co-newbiz 앱 전체의 스택을 co-price와 동일하게(Next.js + Prisma) 전면 재구축할 것을 지시했다. 이 문서는 그 재구축을 **실행 가능한 단계로 쪼개기 위한 Phase 0 산출물**이며, 이 문서 자체는 코드를 변경하지 않는다.

## 2. 현재 아키텍처 인벤토리 (마이그레이션 대상)

| 레이어 | 현재 | 파일 수/범위 |
|---|---|---|
| REST API | Hono (`app/server/index.ts` + 9개 라우트 파일) | 34개 엔드포인트 |
| DB 접근 | `bun:sqlite` 직접 접근 (`db/client.ts`, `db/lib/*`, `db/repositories/*`) | 32개 마이그레이션, 원시 SQL 전역 |
| 프론트엔드 | React 18 + Vite + React Router, plain CSS 변수(`styles.css`) | `app/web/src/pages/*`(7), `components/*`(14) |
| 인증 | 자체 세션 쿠키 + PBKDF2-HMAC-SHA256(ADR-0009) + CSRF 이중제출 | `app/server/auth.ts`, `db/lib/accounts.ts` |
| MCP 경계 | `mcp/co-newbiz/`가 REST만 호출, DB 직접 접근 금지(ADR-0011) | 48개 MCP 툴, 전부 REST 릴레이 |

## 3. 목표 아키텍처 (co-price 스택 도입)

| 레이어 | 목표 |
|---|---|
| API | Next.js Route Handlers (`app/api/**/route.ts`) — Hono 라우트 1:1 매핑 |
| DB 접근 | Prisma 7 + `@prisma/adapter-better-sqlite3` — 현재 32개 마이그레이션을 Prisma 스키마로 역산 후 `prisma migrate` 체계로 전환 |
| 프론트엔드 | Next.js App Router + Tailwind CSS + Recharts (co-price와 동일) |
| 인증 | NextAuth (co-price 패턴) — 단, PBKDF2 해시·계정 lifecycle(pending→active, lockout)은 co-newbiz 고유 요구사항(ADR-0009, security-baseline §4)이므로 NextAuth의 Credentials Provider로 감싸되 해시 로직은 유지 |
| MCP 경계 | **재정의 필요 — §5 참조** |

## 4. 34개 REST 엔드포인트 매핑 (요약, 파일 단위)

| Hono 라우트 파일 | 대상 Next.js 구조 | 비고 |
|---|---|---|
| `projects.ts` | `app/api/projects/**` | membership 필터링 로직 이관 |
| `governance.ts` | `app/api/governance/**` | RAG/승인체인/컴플라이언스 |
| `analysis.ts` | `app/api/analysis/**` | assumption/simulation/series |
| `deal-review.ts` | `app/api/deal-review/**` | DD findings, antitrust 등 |
| `monitoring.ts` | `app/api/notifications/**`, `app/api/watches/**` | |
| `scorecard.ts` | `app/api/scorecard/**` | |
| `glossary.ts` | `app/api/glossary/**` | |
| `admin.ts` | `app/api/admin/**` | RequireAdmin 미들웨어 이관 |
| `pmi.ts` | `app/api/pmi/**` | key-talent, synergy 등 |
| `market.ts` | `app/api/market/**` | 밸류체인, 구조시뮬레이션, chain-sensitivities — 본 세션의 region/segment 확장 대상이었던 라우트 |

(엔드포인트별 상세 1:1 표는 실행 단계(Phase 2)에서 라우트 파일 단위로 작성 — 34개를 이 설계 문서 하나에 전개하면 검토 가능성이 떨어져 개요만 유지)

## 5. ADR-0011 경계의 보존 — 가장 중요한 결정

현재: `mcp/co-newbiz/`는 REST만 호출하고 DB에 직접 연결하지 않는다 — "단일 집행 지점(REST 레이어)에서 권한·감사로그를 처리하므로, 클라이언트별 우회가 아키텍처적으로 불가능하다"(ADR-0011 Consequences 원문).

Next.js 전환 시 위험: Next.js는 Route Handler(REST 등가)와 **Server Action**(클라이언트 컴포넌트에서 서버 함수를 직접 호출, DB 접근이 그 함수 내부에 있을 수 있음) 두 가지 서버 실행 경로를 제공한다. Server Action에서 Prisma를 직접 호출하는 패턴을 쓰면 "REST 레이어를 거치지 않는 DB 접근 경로"가 생겨 ADR-0011의 보장이 조용히 깨진다.

**결정(제안, ADR-0070 초안에서 확정)**: Server Action을 전면 금지하고, 모든 데이터 접근은 Route Handler를 통하도록 강제한다. 웹 UI도 Route Handler를 `fetch`로 호출하며, `mcp/co-newbiz/`도 동일 Route Handler를 호출한다 — 즉 **Route Handler가 ADR-0011의 "단일 집행 지점"을 계승**한다. 이 규율은 ESLint 규칙(`"use server"` 지시어 사용 금지 또는 Prisma import를 `app/api/**` 외부에서 금지하는 커스텀 lint)으로 기계적으로 강제되어야 하며, 코드 리뷰 관례만으로는 ADR-0011 수준의 보장을 재현하지 못한다.

## 6. 단계별 컷오버 시퀀스 (무중단 원칙)

1. **Phase 1 — 스캐폴딩**: `app/web-next/`(임시 경로)에 Next.js 프로젝트 생성, Prisma 스키마를 32개 마이그레이션에서 역산(`prisma db pull` 또는 수동 변환 — 정확도 검증 필요), 기존 SQLite 파일을 그대로 재사용(엔진 동일, ADR-0001 유지)
2. **Phase 2 — 라우트 포팅**: §4 매핑표 순서대로 라우트 파일 단위 포팅 + 단위 테스트 이식(`tests/unit/`의 REST 테스트를 Next.js Route Handler 테스트로 재작성)
3. **Phase 3 — 프론트엔드 포팅**: 7개 페이지 + 14개 컴포넌트를 App Router 구조로 이관, plain CSS → Tailwind 클래스 변환
4. **Phase 4 — 병행 운영(섀도 트래픽)**: 두 스택을 동시에 띄우고 MCP는 계속 Hono(8787)를 바라보게 유지, Next.js는 별도 포트에서 응답 정합성만 비교
5. **Phase 5 — 컷오버**: `.mcp.json`/`.env`의 `CO_NEWBIZ_API_BASE_URL`을 Next.js 포트로 전환, Hono 서버 결정적 종료
6. **Phase 6 — 폐기**: `app/server/`, 구 `app/web/`, `db/lib`·`db/repositories`의 raw-SQL 코드 삭제, `package.json` 스크립트 정리

각 Phase는 별도 PR/세션으로 진행 — 본 세션에서는 실행하지 않는다.

## 7. 미해결 질문 (Phase 0에서 답하지 않고 이관)

- ~~Prisma 스키마 역산의 정확도를 어떻게 검증할 것인가~~ — **Phase 1 스캐폴딩에서 실측 완료, 심각한 차단 이슈 확인 (2026-08-25)**:
  `bunx prisma db pull`로 실제 `db/data/co-newbiz.sqlite`(32개 마이그레이션 적용 상태)를 역산한 결과, **96개 모델 중 61개(63.5%)가 `@@ignore` 처리**되었고, 그 나머지를 포함해 **`prisma generate` 자체가 24건의 검증 오류로 전면 실패**했다. 근본 원인은 스키마 전역의 컨벤션: 모든 테이블이 `id TEXT PRIMARY KEY`로 선언되어 있는데, SQLite는 `INTEGER PRIMARY KEY`(rowid 별칭)와 달리 `TEXT PRIMARY KEY`에 `NOT NULL`을 자동 함의하지 않는다. Prisma는 이를 정확히 `id String?`로 역산하며, Prisma Client 생성기는 nullable `@id` 필드를 거부한다(예시: `chain_node_sensitivity`의 실제 DDL — `id TEXT PRIMARY KEY,` — 정확히 이 패턴이 마이그레이션 0001부터 0032까지 전역 반복).
  **해결 경로 3가지, 전부 비용이 크다**:
  1. 32개 마이그레이션이 만든 사실상 전체 테이블에 대해 `id TEXT PRIMARY KEY NOT NULL`로 재작성하는 신규 리빌드 마이그레이션(SQLite는 PK 제약 변경 시 컬럼 추가가 아닌 테이블 재작성 필요 — ADR-0061/migration 0028과 동일 패턴) — 사실상 전 테이블 대상이라 위험도가 매우 높고, 비즈니스 사유 없이 "스키마 도구 호환성"만을 이유로 하는 대규모 변경이 되어 별도 ADR·리뷰가 필요
  2. `prisma db pull`이 생성한 `schema.prisma`를 매번 수동 패치(96개 `@id` 필드의 `String?`→`String`) — `db pull` 재실행마다 덮어써지므로, "마이그레이션 변경 후 재역산"이라는 애초의 목적(본 파일 상단 주석에 기재)이 무력화됨
  3. `prisma db pull`을 신뢰 소스로 쓰지 않고 `schema.prisma`를 손으로 처음부터 작성 — 역산의 안전망(자동 정합성 검증) 자체를 포기
  **해결 완료 (2026-08-25, ADR-0071)**: 사용자가 옵션 1(전 테이블 리빌드)을 승인, 실행 완료. `scripts/co-newbiz/gen-pk-notnull-rebuild.ts`가 실제 스키마에서 리빌드 SQL을 자동 생성(수작업 타이핑 없음), 85/96 테이블에 `NOT NULL` 적용. 과정에서 3가지 실측 버그를 발견·수정: (1) 따옴표로 감싼 11개 테이블명 미인식, (2) `v_comp_anonymized` 뷰가 리네임 중 일시적으로 "no such table" 오류를 유발 — DROP/CREATE VIEW로 감쌈, (3) 이번 세션에서 실제로 생성된 계정·세션·토큰 데이터의 FK 제약으로 `DROP TABLE app_user`가 실패 — `db/migrate.ts`에 `-- @notransaction` 옵트아웃을 추가해 `PRAGMA foreign_keys=OFF/ON`이 실제로 동작하도록 해결(트랜잭션 내에서는 no-op이라는 SQLite 제약 때문). 샌드박스에서 FK 위반 0건·행수 일치·`integrity_check: ok` 검증 후 프로덕션에 적용. **결과: Prisma `@@ignore` 61→0, `prisma generate` 24건 오류→0건 성공.** 상세 근거는 [ADR-0071](../adr/0071-pk-not-null-rebuild.md) 참조.

  이 발견은 Phase 1이 "간단한 스캐폴딩"이 아니라 **DB 스키마 컨벤션 자체를 건드리는 결정**을 요구함을 보여주었다 — 사후적으로도 유효한 교훈이며, 부수적으로 마이그레이션 0019/0028의 "FK-ON 상태에서도 리빌드가 안전하다"는 주장이 실제로는 해당 테이블에 참조 행이 없었기 때문에만 성립했다는 점도 정정되었다(ADR-0071 Consequences).
  실측 아티팩트: `app/web-next/prisma/schema.prisma`(역산 결과, git에 커밋되어 있으니 재현 가능), `app/web-next/prisma.config.ts`(Prisma 7 설정 — datasource url이 schema.prisma에서 제거되어 별도 config 파일 필요했던 부수 발견 포함), `db/migrations/0033_pk_not_null_rebuild.sql`, `scripts/co-newbiz/gen-pk-notnull-rebuild.ts`
- NextAuth 도입 시 기존 `session`/`api_token` 테이블과의 관계 — 완전 교체 vs. 병행
- ADR-0038(project-level 접근제어)·ADR-0040(MNPI 접근 로깅)이 Route Handler 미들웨어로 얼마나 기계적으로 이관 가능한지
- `python/structure_sim.py` spawn 방식(args-array, shell 금지)이 Next.js 서버리스 배포 환경에서도 동일하게 유지 가능한지(배포 타깃이 확정되지 않음)

## 8. 본 설계가 다루지 않는 것

- 실제 코드 마이그레이션(Phase 1-6은 각각 별도 승인·실행 대상)
- co-price의 도메인 로직(가격 시뮬레이션 엔진 등) 이식 — 대상이 아님, 스택 도구만 참조
- 이번 세션에서 시작했던 유압브레이커 region/segment 스키마 확장과 `RegionSegmentMatrix` UI — 이 마이그레이션이 승인·완료된 이후, 새 스택 위에서 재설계
