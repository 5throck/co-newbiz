---
lang: ko
lang_reason: source-material
counterpart: mcp-admin-guide.md
---

# MCP 관리자 안내서 — 토큰 정책과 패키지 릴리스

> **언어**: [English](mcp-admin-guide.md) · **한국어**

**독자**: 시스템 관리자와 릴리스 담당자(release-engineer, sre)
**대상 아님**: AI 클라이언트를 연결하려는 사용자(`mcp-user-guide.md` 참조)

## 이 안내서가 다루는 것

개인 API 토큰 정책, `@co-newbiz/co-newbiz-mcp` 패키지를 두 레지스트리에 릴리스하는 절차, 릴리스에 필요한 시크릿, 그리고 `NPM_TOKEN`의 90일 순환. 근거: `docs/architecture/mcp-integration.md`, `.github/workflows/mcp-package.yml`, `docs/designs/2026-11-18-mcp-package-distribution-design.md`, 연결된 앱 화면의 소스.

## 1. 개인 API 토큰 정책

| 규칙 | 값 |
|---|---|
| 발급할 수 있는 사람 | analyst와 viewer. **관리자(admin)는 토큰을 발급할 수 없다**(읽기 권한도 마찬가지, `POST /api/tokens`가 403 `role_forbidden`을 돌려준다) |
| 권한 | `읽기 전용`(기본) 또는 `읽기·쓰기`. viewer는 `write`를 받지 못하고 analyst만 가질 수 있다 |
| 유효기간 선택지 | 7, 30, 90, 180일. 기본 30일 |
| 활성 토큰 상한 | 사용자당 5개. 여섯 번째 발급은 거절된다 |
| 역할 상속(ADR-0146) | MCP 서버는 bearer 토큰을 그대로 전달하므로 모든 도구는 토큰 주인의 역할로 돈다. 쓰기 도구와 `propose_*` 도구는 analyst 토큰이 필요하다 |
| 기존 admin 토큰 | 규칙 이전에 발급된 토큰은 만료까지 유효하다. admin 토큰은 업무 경로에서 403 `role_forbidden`을 받는다 |
| MNPI | `mnpi_flag=true` 프로젝트는 기본으로 도구 응답에서 빠진다 |
| 발급과 해지 | 로그인한 웹 화면에서만 된다. 토큰이나 에이전트는 발급·해지할 수 없다 |
| 보관 | 저장 때 해시로 둔다. 비밀값은 발급할 때 한 번만 보인다 |
| 감사 | 도구 호출마다 REST 호출과 `audit_log` 항목이 생긴다. 읽기 전용 호출도 마찬가지다 |
| 호출 제한 | 토큰별 제한이 웹 로그인 제한과 따로 걸린다. 쓰기 도구는 더 빡빡한 몫을 받는다 |

## 2. 패키지 릴리스

릴리스 담당자는 태그로 패키지를 발행한다. 둘레 점검은 `docs/runbooks/deployment.md`를 따른다.

1. `mcp/co-newbiz/package.json`의 버전을 올린다.
2. 태그 `mcp-vX.Y.Z`를 푸시한다. 태그 버전은 매니페스트 버전과 **같아야 한다**.
3. `guard` 잡은 태그와 매니페스트가 다르거나 tarball에 허용 목록 밖 파일이 있으면 실행을 실패시킨다(`mcp/co-newbiz` 하위 트리만 허용, `db/`·`app/`·`scripts/` 코드 불가, ADR-0011).
4. 이어서 같은 태그 커밋에서 발행 잡 둘이 병렬로 돈다(3절).
5. `smoke` 잡은 묶은 tarball을 설치하고 스텁 REST 서버를 상대로 stdio 악수(`initialize`, 이어서 `tools/list`)를 돌린다.

## 3. 이중 발행과 시크릿

| 잡 | 레지스트리 | 시크릿 | 역할 |
|---|---|---|---|
| `publish-npmjs` | `registry.npmjs.org` | `NPM_TOKEN` | 주 채널. 소비자는 익명으로 설치한다 |
| `publish` | `npm.pkg.github.com` | `MCP_PACKAGES_PAT` | 보조 채널 |

- `MCP_PACKAGES_PAT`는 **`write:packages` 권한의 클래식 PAT**이며 `co-newbiz` GitHub 조직 구성원이 소유한다. `co-newbiz` 조직이 있어야 한다.
- 두 잡이 같은 태그의 같은 매니페스트 버전을 발행하므로 레지스트리 사이에 버전이 어긋날 수 없다.
- `1.0.1`부터가 npmjs 라인이고 `1.0.0`은 GitHub Packages에만 있다.
- 두 시크릿 값은 어떤 문서에도 적지 않는다. 소비자는 둘 다 필요 없다: npmjs 익명 설치가 된다(2026-11-18 확인, tarball HTTP 200).

## 4. NPM_TOKEN 순환(90일마다)

**요건.** `NPM_TOKEN`은 `@co-newbiz/*`에 **읽기·쓰기(Read and write)** 권한을 가진 npm **세분화 접근 토큰(granular access token)** 이어야 하고 **2FA 우회(bypass 2FA)** 가 켜져 있어야 하며 만든 날부터 90일 안에 끝나야 한다. **90일마다, 만료 전에** 바꾼다.

**현재 상태.** 지금 쓰는 토큰은 2026-11-18에 설정했으므로 **2027-02-16쯤** 만료된다. 정확한 만료일은 npmjs.com(Access Tokens 화면)에서 확인해 아래 표에 적는다.

**실패 징후.** 토큰이 만료되었거나 권한이 모자라면 `publish-npmjs`가 E403으로 실패하고 다른 시크릿을 쓰는 GitHub Packages `publish` 잡은 그대로 통과한다. 2026-11-18의 첫 npmjs 발행 실패도 2FA 우회가 없어서 같은 E403이 났다. 토큰이 만료되지 않았음을 확인한 뒤에는 2FA 우회 설정을 살핀다.

**순환 절차.**

1. npmjs.com에서 새 세분화 토큰을 만든다: `@co-newbiz/*` 읽기·쓰기, 2FA 우회, 유효기간 90일 이하.
2. 저장소 시크릿 `NPM_TOKEN`을 바꾼다(GitHub 저장소 Settings, Secrets and variables, Actions).
3. 새 만료일과 다음 순환 기한을 아래 순환 기록에 적는다. 기한 며칠 전에 알림을 걸어 둔다.
4. npmjs.com에서 옛 토큰을 해지한다.
5. 다음 `mcp-v*` 릴리스에서 `publish-npmjs`가 초록인지 확인한다. 곧 릴리스가 없다면 다음 릴리스를 확인 시점으로 삼고 기록에 그렇게 적는다.

**순환 기록.** 순환할 때마다 이 표를 고친다. 토큰 값은 여기에 절대 적지 않는다.

| 토큰 생성일 | 만료일 | 다음 순환 기한 | 순환한 사람 | 릴리스에서 확인 |
|---|---|---|---|---|
| 2026-11-18 | 2027-02-16쯤(npmjs.com에서 확인) | 만료 전(날짜 확인 뒤 정함) | 기록 예정 | 다음 `mcp-v*` 릴리스 |

## 5. 사고 증상

| 증상 | 짐작되는 원인 | 먼저 볼 것 |
|---|---|---|
| `guard`가 버전 단계에서 실패 | 태그가 `mcp/co-newbiz/package.json` 버전과 다르다 | 매니페스트 버전을 올리고 태그를 다시 만든다 |
| `guard`가 tarball 단계에서 실패 | 허용 목록 밖 파일이 패키지에 들어갔다 | 나열된 파일을 읽고 패키지를 하위 트리 안에 둔다(ADR-0011) |
| `publish-npmjs`만 E403, `publish`는 통과 | `NPM_TOKEN` 만료 또는 권한 부족 | npmjs.com에서 만료일, 이어서 2FA 우회와 `@co-newbiz/*` 읽기·쓰기 설정을 살피고 순환한다(4절) |
| `publish` 실패 | `MCP_PACKAGES_PAT`가 잘못되었거나 만료되었거나 `co-newbiz` 조직 선행 조건이 빠졌다 | PAT 소유자, `write:packages` 권한, 조직을 확인한다 |
| `smoke` 실패 | tarball 내용이나 스텁 악수가 깨졌다 | 잡 로그를 읽는다. 워크플로에서 `smoke`는 `publish` 뒤에 돈다 |
| 소비자가 갓 발행한 버전을 설치하지 못한다 | 처음 발행 직후에는 레지스트리 조회가 잠시 늦을 수 있다. 2026-11-18에 몇 분간 404가 보였다. 한 번 본 일일 뿐 보장은 아니다 | 몇 분 뒤 다시 시도하고 그래도 안 되면 잡 결과를 확인한다 |

## 6. 호스팅 커넥터: DCR이 403을 돌려줄 때(Cloudflare)

**증상.** ChatGPT나 Claude.ai 커넥터를 만들 때 동적 클라이언트 등록(`POST /api/oauth/register`)에서 HTTP 403이 난다. 앱은 공개 OAuth 경로에서 403을 내지 않으므로 Cloudflare 가장자리(edge)가 원인일 가능성이 크다. Cloudflare는 앱이 아니라 관리자가 바꾼다.

### 6.1 가장자리인지 앱인지 가리기

1. Cloudflare에서 Security, Events를 연다. Host(`<APP_HOST>`, 그 환경이 서비스되는 호스트이며 그 환경의 CO_NEWBIZ_PUBLIC_ORIGIN 설정값을 쓴다), Path `/api/oauth/register`, 동작(action) 차단(block) 또는 도전(challenge)으로 거른다. 해당 이벤트가 작동한 서비스와 규칙 id를 알려 준다.
2. 앱에서는 같은 시각의 `oauth_dcr_refused` 감사 행을 찾는다. 앱은 자기가 거절한 요청마다 이 행을 남기며, `reason`, `status`, `ip_hash`, `request_id`, `cf_ray`가 들어 있다.
3. 앱 감사 행이 없는 403은 가장자리에서 온 것이다. 감사 행의 `cf_ray`와 Cloudflare 이벤트의 Ray ID를 맞추어 둘을 잇는다.

### 6.2 건너뛰기(Skip) 규칙 더하기

사용자 지정 규칙을 만들고 순서는 **맨 앞**에 둔다. 호스트는 환경마다 다르며 환경의 호스트는 바뀔 수 있다. 호스팅 커넥터를 서비스하는 호스트마다 규칙을 하나씩 더하고, 아래의 `<DEV_HOST>`나 `<PROD_HOST>`에 그 환경의 호스트를 적는다. 그 환경이 실제로 서비스되는 호스트를 쓴다. 이 호스트는 `CO_NEWBIZ_PUBLIC_ORIGIN`의 호스트와 같아야 한다. 그 환경의 `CO_NEWBIZ_PUBLIC_ORIGIN` 값에서 찾는다.

규칙 1, 이름 `Allow OAuth DCR and discovery (<ENV>)`, `<ENV>`는 `dev`, 호스트는 `<DEV_HOST>`:

```text
(http.host eq "<DEV_HOST>" and (http.request.uri.path in {"/api/oauth/register" "/api/oauth/token" "/api/oauth/revoke" "/.well-known/openid-configuration"} or starts_with(http.request.uri.path, "/.well-known/oauth-")))
```

규칙 2, 이름 `Allow OAuth DCR and discovery (<ENV>)`, `<ENV>`는 `prod`, 호스트는 `<PROD_HOST>`. 그 환경이 호스팅 커넥터를 서비스할 때만 더한다.

```text
(http.host eq "<PROD_HOST>" and (http.request.uri.path in {"/api/oauth/register" "/api/oauth/token" "/api/oauth/revoke" "/.well-known/openid-configuration"} or starts_with(http.request.uri.path, "/.well-known/oauth-")))
```

동작(두 규칙 모두): **Skip**. 대상은 All managed rules, Super Bot Fight Mode 규칙(요금제에 따라 다름), Browser Integrity Check다. 6.1의 이벤트가 먼저 지목한 서비스만 건너뛴다. 호스팅 클라이언트는 브라우저가 아닌 User-Agent를 보내며 도전 과제를 풀 수 없다.

`/api/mcp`와 `/oauth/authorize`는 규칙에 넣지 않고 그대로 보호한다. 이 경로들은 설계상 인증 없이 열려 있으므로(클라이언트 등록, 탐색) 보완 장치는 앱의 IP별 호출 제한, 리디렉션 호스트 허용 목록, 거절 감사다.

### 6.3 Cloudflare 클라이언트 IP 믿기

먼저 원본 서버 포트를 묶고(6.7), 그다음 운영 환경에 `CO_NEWBIZ_TRUST_PROXY_HEADERS=cloudflare`를 설정한다. 그러면 등록 호출 제한(IP당 시간당 20회, 메모리에만 있어 재시작하면 초기화)이 `CF-Connecting-IP`를 기준으로 걸린다. 설정하지 않으면 터널 뒤의 모든 클라이언트가 한 통을 같이 쓸 수 있다.

### 6.4 리디렉션 호스트 허용 목록

`CO_NEWBIZ_OAUTH_REDIRECT_HOST_ALLOWLIST`는 호스트를 쉼표로 이은 목록이다. 루프백 호스트는 언제나 허용한다. 막힌 호스트는 403이 아니라 400 `invalid_redirect_uri`를 돌려받는다.

- 운영에서는 반드시 설정한다. 설정하지 않으면 어떤 `https` 리디렉션 호스트로도 클라이언트를 등록할 수 있어, 피싱 동의 화면에 악용될 위험이 있다.
- 후보 호스트: `chatgpt.com`, `claude.ai`, `claude.com`. 목록을 정하기 전에 실제로 쓰는 커넥터마다 호스트를 확인한다.
- 설정은 관리자가 배포 환경에서 한다. 애플리케이션은 이 값을 스스로 정하지 않는다.

예시(호스트를 먼저 확인한다):

```text
CO_NEWBIZ_OAUTH_REDIRECT_HOST_ALLOWLIST=chatgpt.com,claude.ai,claude.com
```

서버는 예약된 클라이언트 이름도 거절한다. `client_name`에 ChatGPT·OpenAI, Claude·Anthropic, Gemini·Google, co-newbiz가 들어 있으면 모든 리디렉션 호스트가 그 브랜드 소유일 때만 받아들인다.

| 브랜드 | 허용하는 리디렉션 호스트 |
|---|---|
| ChatGPT / OpenAI | `chatgpt.com`, `openai.com` |
| Claude / Anthropic | `claude.ai`, `claude.com`, `anthropic.com` |
| Gemini / Google | `gemini.google.com`, `google.com` |
| co-newbiz | 애플리케이션 자체 호스트 |

거절하면 400 `invalid_client_metadata`를 돌려주고 감사 사유는 `reserved_client_name`이다. 실제 ChatGPT와 Claude.ai의 등록에는 영향이 없다.

### 6.5 거절 사유 코드

거절할 때마다 아래 사유 가운데 하나로 `oauth_dcr_refused` 행이 남는다.

| 사유 | 뜻 |
|---|---|
| `rate_limited` | IP별 등록 호출 한도에 이르렀다(HTTP 429) |
| `body_not_json` | 요청 본문이 올바른 JSON이 아니다 |
| `body_not_object` | JSON 본문이 객체가 아니다(배열, 문자열, null) |
| `response_type_unsupported` | `response_types`가 `["code"]`가 아니다 |
| `grant_unsupported` | `grant_types`에 `authorization_code`가 없다 |
| `redirect_host_not_allowed` | 리디렉션 URI의 호스트가 허용 목록에 없다(6.4) |
| `reserved_client_name` | `client_name`이 예약된 브랜드 이름을 쓰는데 리디렉션 호스트가 그 브랜드 소유가 아니다(6.4) |
| `invalid_client_metadata` | 등록 엔진이 클라이언트 메타데이터를 거절했다 |
| `invalid_redirect_uri` | 등록 엔진이 리디렉션 URI를 거절했다 |

### 6.6 제공하는 탐색 주소

- `/.well-known/oauth-authorization-server`(`/api/mcp` 꼬리가 붙은 주소도 같음)
- `/.well-known/openid-configuration`
- `/.well-known/oauth-protected-resource/api/mcp`

### 6.7 프록시 헤더를 믿기 전에 원본 서버 포트 묶기

앱의 공개 포트(`docker-compose.yml` 참고)를 모든 인터페이스에 여는 배포는 그대로 노출된다. 이 포트로 곧바로 들어오는 호출자는 `X-Forwarded-For`, `CF-Connecting-IP`, `X-Forwarded-Proto`, `cf-ray`를 위조할 수 있다. 아래 순서를 지킨다.

1. 포트를 루프백에만 연다(`127.0.0.1:<APP_PORT>:<APP_PORT>`). 또는 `cloudflared`를 compose 네트워크에 넣고 포트 공개를 멈춘다. 관리자가 하는 변경이다. 소유자의 승인 없이 포트를 바꾸지 않는다.
2. 그다음에야 `CO_NEWBIZ_TRUST_PROXY_HEADERS=cloudflare`를 설정한다(6.3).
3. 같은 내부망의 다른 호스트에서 `http://<호스트>:<APP_PORT>`가 거절되는지 확인한다.

감사 행의 `cf_ray` 값은 1단계를 마친 뒤에야 믿을 만한 증거가 된다.

### 6.8 감사 가명화 키

운영 환경에 `CO_NEWBIZ_AUDIT_IP_HMAC_KEY`를 설정한다. 비밀 값이므로 git에 올리지 않는다. 설정하지 않으면 `oauth_dcr_refused` 행에 `ip_hash`가 남지 않는다. 설정하면 `ip_hash`는 클라이언트 IP의 키 기반 가명 값이 되며, 키 없이는 되돌릴 수 없다.

## 관련 화면

- `연결된 앱`(`/settings`) — 사용자가 자기 토큰을 발급하고 해지하는 곳.
- `연결된 앱 관리`(`/admin/connected-apps`) — 등록된 OAuth 클라이언트를 한꺼번에 중단·시작하는 관리 콘솔 화면. [관리자 매뉴얼](admin-manual_ko.md) 7절 참조.
- `docs/runbooks/deployment.md` — 순환 요건을 이 안내서로 잇는 릴리스 절차.
- `docs/architecture/mcp-integration.md` — 구조와 클라이언트 등록.
- `mcp-user-guide.md` — 이 안내서의 사용자 쪽 짝.
