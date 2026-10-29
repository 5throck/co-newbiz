---
lang: ko
lang_reason: source-material
---

# ADR-0146 — admin 역할과 업무 콘텐츠의 분리: 관리 콘솔 밖 업무 라우트 읽기·쓰기 차단

- Status: Accepted
- Date: 2026-09-30 (제안)
- Accepted: 2026-09-30 — 사용자(사람 검토자)가 검토 후 승인. OP-1~OP-3 해결, OP-4는 PR3에서 해결(2026-09-30)
- Deciders: 사용자 결정 (2026-09-30); platform-lead / security-engineer 검토 요청
- Design of record: 외부 설계 문서 [2026-08-19-co-newbiz-design_ko.md](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md) (ai-workspace-standards 저장소), 본 ADR. 권한 원칙의 저장소 내 출처: 프로젝트 `CLAUDE.md` "Non-Negotiable Boundaries" 1항 (에이전트는 호출 사용자의 권한을 상속하며 자체 계정이 없다)
- Related: ADR-0091 (관리 콘솔 분리), ADR-0094 (기회 읽기 표면 개방 — 본 ADR이 admin 역할에 한해 좁힘), ADR-0108 (공유 거버넌스 문서 라이브러리), ADR-0123 (공개 공유 토큰), ADR-0038 (L13 — admin의 딜 데이터 접근 제한), ADR-0095 (프로젝트 캐리어), ADR-0114 (business-target CRUD는 `app/api/admin/business-targets` 아래 admin 전용), ADR-0133, `docs/architecture/api-spec.md` §8, `docs/architecture/mcp-integration.md`

## Context

`admin`은 시스템 관리 역할이다. 그런데 현재 코드는 이 원칙을 일부 라우트에서만 지킨다.

- `projects/**` 라우트는 `visibleProject`를 통해 admin에게 404를 돌려준다.
- `opportunities/[id]/promote`는 admin을 `role_forbidden`(ADR-0091 문구)으로 거부한다
  (`app/web-next/app/api/opportunities/[id]/promote/route.ts` L13-25).
- `archive/deals`와 `projects` GET은 `isAdminDealBlocked(ctx)`
  (`app/web-next/lib/project-visibility.ts` L29-32)로 403 `role_required`를 돌려준다.

나머지 업무 라우트(기회 단계 콘텐츠)는 대부분 `role === "viewer"`만 인라인으로 막고 admin은 통과시킨다. 약 72개 쓰기 라우트 파일에 같은 검사가 복제되어 있다. 여기에 더해 `comments` POST는 `entity_type=opportunity`일 때 역할 검사가 전혀 없어서 viewer와 admin 모두 `deal_comment`에 쓸 수 있다. 이는 viewer 쓰기 권한의 별도 결함이기도 하다.

그 결과 ADR-0038 L13과 ADR-0091이 프로젝트 딜 데이터에 대해 정한 원칙이 기회 단계(S1-S7) 콘텐츠에는 적용되지 않고, 같은 사용자가 화면에 따라 서로 다른 권한을 갖게 된다.

## Decision

아래 항목은 사용자가 2026-09-30 결정했다. 열린 쟁점 OP-1~OP-3은 2026-09-30 승인 시점에 해결되었고, OP-4는 PR3에서 해결했다("열린 쟁점(Open points)" 참조). Decision 3의 `share/[token]` 항목은 PR3에서 사실 오류를 바로잡았다(아래 참조). 그 밖의 승인된 결정은 바뀌지 않았다.

1. **원칙.** `admin`은 시스템 관리 전용 역할이다. 관리 콘솔 밖의 업무 콘텐츠는 읽지도 쓰지도 못한다. ADR-0038 L13과 ADR-0091의 원칙을 프로젝트 딜 데이터에서 기회 단계 콘텐츠로 넓힌다. 이미 admin을 거부하는 projects 라우트와 promote 라우트에 나머지 라우트를 맞춘다.
2. **쓰기 차단 (POST/PUT/PATCH/DELETE).** `app/web-next/app/api` 아래 다음 그룹의 라우트 파일 약 72개가 대상이다: opportunities (20), brownfield (14), market-overview (12), our-company (10), companies (7), synergy (6), greenfield (2), agents/query (1). agents/query는 DB 변경이 아니라 LLM 질의지만 업무 콘텐츠 접근이므로 포함한다. `comments` POST도 포함하며, admin과 **viewer를 모두** 거부한다. viewer 쓰기 결함도 함께 닫힌다.
   - 오류 계약: viewer는 지금처럼 `role_required`(라우트별 문구), admin은 promote가 이미 쓰는 ADR-0091 문구와 함께 `role_forbidden`.
3. **읽기 차단 (GET).** 같은 업무 그룹의 GET 핸들러 약 60개가 대상이다: `opportunities/**`, `brownfield/**`, `greenfield/**`, `companies/**`, `market-overview/**`(ksic, value-chain-graph는 제외 — OP-2), `synergy/**`, `our-company/**`. 모두 `requireBusinessActor(ctx, "read")`를 호출해 admin에게 403 `role_forbidden`을 돌려준다(OP-1). 기존 `isAdminDealBlocked` 사용처(`archive/deals`, `archive/deals/[id]`, `projects` GET — 이전에는 403 `role_required`)도 PR3에서 `requireBusinessActor`로 옮겨 `role_forbidden`을 돌려준다.
   - **정정 (PR3): `share/[token]`은 대상이 아니다.** 초안은 이 라우트를 읽기 차단 목록에 넣었지만, 이는 인증 없이 쓰는 공개 토큰 라우트다(ADR-0123 #4: 추측할 수 없는 토큰을 가진 사람은 누구나 딜 스냅숏을 볼 수 있고, 폐기·만료된 링크는 `not_found`). 핸들러는 `authenticate`를 호출하지 않으므로 거부할 역할이 없다. 따라서 `share/[token]`은 역할 모델 밖에 있으며 변경하지 않는다.
   - **`library`, `library/[docId]` — 열어 둔다.** 공유 거버넌스 문서(ADR-0108)만 제공하고 딜·기회 콘텐츠가 없다.
   - **`data-changes` — 열어 둔다 (OP-4).** 공유 시장 데이터 시리즈의 `data_change_log`만 조회하며 딜·기회·프로젝트 컬럼이 없다.
   - **`synergy/web-search`.** GET이지만 유료 외부 검색을 호출하므로 `"write"` 모드를 쓴다. viewer는 자체 문구와 함께 `role_required`, admin은 `role_forbidden`.
   - `isAdminDealBlocked`(`app/web-next/lib/project-visibility.ts`)는 이제 호출자가 없다. ADR 본문이 이름을 언급하므로 남겨 두었고, doc 주석은 `requireBusinessActor`를 가리킨다.
4. **admin에게 계속 열어 두는 라우트 (변경 없음).** `/api/admin/**`; `glossary`, `glossary/[term]`(관리 용어집 화면, POST는 admin 전용); `notifications`; `auth/*`; `health`; `tokens`(본인 셀프서비스); 공유 참조 데이터(`industries`, `benchmarks`, `series`, `procedures/resolve`, `llm-status`, `users/lookup`, `agents/registry`, 그리고 OP-2에 따라 `market-overview`의 `ksic`, `value-chain-graph`). `/api/interpretations`는 현행을 유지한다. ADR 작성 시점에 확인한 결과 GET(L8)은 인증된 모든 역할에 열려 있고 POST(L20-24)만 admin 전용이다.
5. **Business Targets 관리 화면 (PR3에서 구현).** `app/web-next/components/admin/BusinessTargetsSection.tsx`는 현재 `GET /api/our-company/groups`와 `/groups/[id]`를 호출한다(L93, L108). `/api/admin/business-targets/**` 아래에 같은 기능의 admin 전용(`requireAdmin`) 조회 라우트를 추가하고 두 호출을 여기로 바꾼다. 그 뒤 `our-company/groups`는 admin을 거부한다. 이는 ADR-0114와 일치한다. 새 라우트는 OpenAPI/api-spec 원본에도 추가해야 한다. `tests/unit/openapi.test.ts`가 라우트 집합 일치를 검사하기 때문이다. 구현: `GET /api/admin/business-targets/groups`와 `/groups/[id]`(`requireAdmin`), 공용 로직은 `app/web-next/lib/our-company-groups.ts`(`listGroups`, `getGroupDetail`). `our-company/groups`와 `groups/[id]` GET은 admin을 거부한다.
6. **토큰과 MCP.** MCP 서버(`mcp/co-newbiz/shared/rest-client.ts`)는 bearer 토큰으로 HTTP만 호출하므로 토큰 소유자의 역할을 그대로 물려받는다. 따라서 쓰기 도구 세 개(`mcp/co-newbiz/tools/process.ts`의 `create_opportunity`, `record_gate_decision`, `create_route_decision`)는 analyst 토큰이 있어야 동작한다. **admin은 쓰기 범위 API 토큰을 발급할 수 없다.** 현재 `app/web-next/app/api/tokens/route.ts` L15-18은 viewer만 막는다. admin 토큰은 어차피 업무 라우트에서 쓸 수 없다. analyst의 MCP 도구 범위는 바뀌지 않으며, api-spec §8은 이미 admin 엔드포인트를 MCP에 노출하지 않는다고 적고 있다.
7. **중앙 헬퍼 (OP-3 해결).** `app/web-next/lib/auth.ts`의 `requireAdmin`(L152-157) 옆에 `requireBusinessActor(auth, mode: "read" | "write", opts?: { viewerMessage?: string }): Response | null`을 추가한다. 쓰기 모드: viewer → 403 `role_required`(문구는 `opts.viewerMessage`, 기본값은 일반 문구), admin → 403 `role_forbidden`. 읽기 모드: admin → 403 `role_forbidden`, viewer는 허용. admin 문구는 promote(ADR-0091)의 공용 문구를 재사용한다. 인라인 `role === "viewer"` 검사 약 72개를 기계적으로 이 헬퍼로 바꾼다.
   - UI 쪽 대응: `app/web-next/lib/project-write-access.ts`(`canWriteProject`, analyst 전용)에 더해, 기회 캐리어 화면용 비프로젝트 헬퍼를 새로 둔다. 대상 화면은 Greenfield, Brownfield, OurCompany 단계, 회사 상세, brownfield 타깃 상세, CommitteePanel, GateDecisionPanel(비프로젝트 캐리어), OpportunityFunnelStage, RouteDecisionStage, `opportunities/[id]` 페이지다. API가 admin을 거부하면 이 화면들도 analyst 전용이 된다.
8. **범위 밖 (영향 없음).** 스크립트, 시드, job worker, instrumentation은 HTTP가 아니라 DB에 직접 쓰므로 영향이 없다(`scripts/co-newbiz/seed-s1-s12-demo.ts`, `job-worker.ts`, `committee-deliberation.ts`, `watch-run.ts`, `newbiz.ts`). 계정·사용자 관리는 계속 admin 전용이다.

### Open points (2026-09-30 승인 시 정리)

- **OP-1 읽기 차단의 오류 코드 — Resolved.** 읽기 차단도 `role_forbidden`으로 통일한다(쓰기 차단, promote와 일치). 기존 `isAdminDealBlocked` 사용처(`archive/deals`, `archive/deals/[id]`, `projects` GET)는 PR3에서 403 `role_required`에서 `role_forbidden`으로 옮기고, `tests/unit/deal-archive.test.ts` L136-137의 단언도 함께 바꾼다. 기존 오류 계약이 바뀌는 비용(클라이언트가 `role_required`에 기대는지 확인 필요)은 감수하기로 했다.
- **OP-2 `market-overview`의 ksic와 value-chain-graph — Resolved.** 두 라우트는 공유 참조 데이터로 보고 차단에서 제외한다. Decision 4의 다른 참조 데이터 라우트와 함께 admin에게 열어 둔다.
- **OP-3 헬퍼 이름·시그니처 — Resolved (PM이 구현 세부로 결정).** `requireBusinessActor(auth, mode: "read" | "write", opts?: { viewerMessage?: string }): Response | null`, 위치는 `app/web-next/lib/auth.ts`. 동작은 Decision 7과 같다.
- **OP-4 `data-changes` — Resolved (PR3).** admin에게 열어 둔다. 핸들러는 공유 시장 데이터 시리즈의 `data_change_log`만 조회하며 딜·기회·프로젝트 컬럼이 없다. 같은 근거로 `library`/`library/[docId]`(공유 거버넌스 문서, ADR-0108)도 열어 둔다.

### Not verified (PR3 시점 갱신)

- 핸들러 본문은 기계적으로 변환했다. tsc, 단위 테스트 전체, grep으로 확인했지만 라우트마다 본문을 사람이 읽어 검토하지는 않았다.
- AppShell의 `markAllRead`가 admin 세션에서 업무 라우트에 닿는지 확인하지 못했다.
- 예외 라우트 테스트(`admin-business-read-guard`)는 "403이 아님"만 단언한다. 응답 본문이 올바른지는 단언하지 않는다.

## Consequences

- admin 역할의 권한이 모든 업무 라우트에서 같아진다(projects, promote, archive와 일치).
- `comments` POST의 viewer 쓰기 결함이 닫힌다.
- 중복된 인라인 역할 검사 약 72개가 헬퍼 하나로 모여, 새 라우트에서 같은 결함이 다시 생길 여지가 줄어든다.
- **알려진 파손.** admin `root` 쿠키로 업무 라우트를 호출하는 테스트는 analyst 로그인으로 바꿔야 한다. 대상은 `tests/unit/committee-boundary.test.ts`(약 20곳), `company-profile-status.test.ts`, `api.test.ts`(L353-355 부근 `GET /api/opportunities`를 root로 호출하는 부분은 403을 단언하도록 변경)이다. 감사하지 않은 파일 14개도 `loginCookie("root")`를 쓰므로 구현 시 각각 grep해야 한다: applies-when, committee-registry, company-competitor, execution-jobs, ic-package, mcp, navigation, openapi, portfolio, process-flow, runbook-registry, sim-engine, skill-graph, stage-aliases-registry.
- **읽기 코드 변경.** OP-1에 따라 `archive/deals`, `archive/deals/[id]`, `projects` GET의 admin 거부 코드가 `role_required`에서 `role_forbidden`으로 바뀐다(PR3). `tests/unit/deal-archive.test.ts` L136-137도 고친다.
- 새 테스트(`business-actor-guard`, `admin-business-write-guard`, `admin-business-read-guard`, `admin-business-targets-groups`)가 그룹별로 admin의 쓰기·읽기 403과 예외 라우트의 비차단을 단언한다.
- **ADR-0094를 admin 역할에 한해 좁힌다.** ADR-0094는 인증된 모든 역할이 기회를 읽을 수 있다("open read surface")고 정했다. 이제 admin은 제외된다. viewer와 analyst의 읽기는 그대로다. `tests/unit/api.test.ts`의 해당 테스트 제목도 바꾸었다.
- **`share/[token]`은 역할 모델 밖에 있다.** 토큰 보유자(링크를 가진 admin 포함)는 이 ADR의 적용을 받지 않는다. 공개 공유 의미를 바꾸려면 별도 ADR이 필요하다.
- **정리 후보 dead code.** `isAdminDealBlocked`는 호출자가 없다. 별도 정리 티켓으로 제거한다.
- 문서 갱신(PR3에서 완료): api-spec의 roles 열, mcp-integration의 문구. api-spec L80에는 waiver에 대해 "admin activates at filing time"이라고 적혀 있지만 코드는 `visibleProject`로 admin을 막는다. 이 불일치를 바로잡는다.
- admin 운영자가 업무 화면을 보려면 별도의 analyst 계정이 필요하다. 이는 최소 권한 원칙에 따른 의도된 결과다.

## Alternatives considered

- **(a) admin 허용 유지 (현상 유지).** 기각. projects, promote 라우트와 일관되지 않고 ADR-0091과도 어긋난다.
- **(b) `authenticate` 안에서 경로 접두어 정책으로 차단.** 기각. `/api/admin/**`와 glossary까지 막힐 수 있어 위험하고, 예외 목록이 암묵적인 규칙이 된다.
- **(c) 라우트별 인라인 검사.** 기각. 지금의 결함(검사 복제와 누락)을 그대로 되풀이한다.
- **(d) 라우트마다 호출하는 중앙 헬퍼.** 채택. 명시적이고 grep으로 찾을 수 있으며, 오류 계약이 한곳에 모인다.

## Rollout / PR plan

저장소의 순차 브랜치 규칙에 따라 PR마다 이전 PR이 머지된 뒤 연다.

1. **PR1** — 이 ADR (Proposed). 머지됨(#431).
2. **PR2** — 머지됨(#432). 이 ADR의 Accepted 전환 + 헬퍼 + 쓰기 라우트 + `comments` POST + `tokens`(admin 쓰기 토큰 차단) + 테스트 전환(root → analyst) + admin 쓰기 거부 테스트.
3. **PR3** — 이 변경. 읽기 라우트(`role_forbidden`) + `isAdminDealBlocked` 사용처의 `role_forbidden` 전환과 `deal-archive.test.ts` 단언 변경 + OP-4(`data-changes`) 결정 + `/api/admin/business-targets/**` 조회 라우트와 `BusinessTargetsSection` 호출 변경 + OpenAPI/api-spec 갱신(roles 열, 새 admin 라우트, L80 waiver 불일치) + mcp-integration 문구 + `share/[token]` 정정.
4. **PR4** — 남음. UI 헬퍼 + 기회 캐리어 화면들을 analyst 전용으로 전환. AppShell은 admin에게 관리 그룹만 보여 주므로 admin은 탐색으로 이 화면에 닿지 않는다. PR4 전까지의 차이는 표시상 문제에 그친다.

OP-1~OP-3은 2026-09-30 승인 시, OP-4는 PR3에서 해결되었다.

## Amendment 2026-10-29 — 개인 토큰 최대 유효기간 90일 → 180일 (항목 6)

- 개인 API 토큰의 허용 유효기간 집합을 {7, 30, 90}일에서 {7, 30, 90, 180}일로 넓히고 최대값을 180일로 한다(소유자 요청, 2026-10-29). 기본값은 30일 그대로다.
- 근거: 로컬 stdio MCP·스크립트용 토큰의 재발급 빈도를 줄인다. 위험 완화는 유지된다. 세션 전용 발급, 사용자당 활성 5개, 시간당 10회 발급 제한, 해지, `cnb_pat_` 접두어, 역할 재검증(viewer/admin은 `write` 불가)이 그대로이며, 180일 토큰은 목록에서 D-n과 7일 이내 만료 경고로 드러난다.
- 변경 범위: `db/lib/api-tokens.ts`, `app/web-next/lib/token-issue-access.ts`, `docs/architecture/openapi.yaml`, 자가발급 설계 문서 개정 노트. 스키마·스코프·OAuth 흐름 변경 없음.
