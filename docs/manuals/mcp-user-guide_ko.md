---
lang: ko
lang_reason: source-material
counterpart: mcp-user-guide.md
---

# MCP 사용자 안내서 — AI 클라이언트 연결하기

> **언어**: [English](mcp-user-guide.md) · **한국어**

**독자**: AI 클라이언트(Claude Code, Claude Desktop, Gemini CLI, Codex, Claude.ai, ChatGPT)로 co-newbiz를 쓰려는 analyst와 viewer
**대상 아님**: 관리자와 릴리스 담당자(`mcp-admin-guide.md` 참조)

## 이 안내서가 다루는 것

MCP로 AI 클라이언트를 co-newbiz에 연결하는 방법 — 어느 길을 고를지, 개인 API 토큰을 발급하는 법, 설정 예시를 등록하는 법, 도구가 할 수 있는 일, 연결이 안 될 때 살필 것. 구조 설명은 `docs/architecture/mcp-integration.md`에 있고, 이 안내서는 쓰는 법만 다룬다.

## 1. 길 고르기

| 길 | 쓰임 | 인증 값 |
|---|---|---|
| 호스팅 앱 커넥터(OAuth) | Claude.ai, ChatGPT 같은 호스팅 AI 앱 | `연결된 앱` 화면에 적힌 커넥터 주소. 개인 토큰은 쓰지 않는다 |
| 개인 API 토큰 | 내 컴퓨터에서 도는 stdio MCP 서버(Claude Code, Claude Desktop, Gemini CLI, Codex)나 내 스크립트 | `연결된 앱` 화면에서 내가 발급한 토큰 |

**개인 API 토큰을 호스팅 AI 앱에 붙여 넣지 않는다.** 개인 토큰은 내 컴퓨터에서 도는 소프트웨어용이다.

## 2. 토큰 발급하기

1. 왼쪽 메뉴 `연결된 앱`을 연다(`/settings`는 이 화면으로 바로 옮겨 간다).
2. 개인 API 토큰 양식에서 `라벨 (필수)`을 쓴다.
3. `권한`을 고른다: `읽기 전용`(기본) 또는 `읽기·쓰기`.
4. `유효기간`을 고른다: 7일, 30일, 90일, 180일(기본 30일).
5. **토큰 발급**을 누른다.

화면이 지키는 한도:

- 활성 토큰은 **최대 5개**까지 둘 수 있다. 자리를 내려면 하나를 해지한다.
- **관리자(admin)는 토큰을 발급할 수 없다.** analyst와 viewer는 발급할 수 있다.
- **viewer는 읽기 전용 토큰만 받는다.** `읽기·쓰기` 토큰은 analyst 역할이 있어야 한다.
- 발급과 해지는 **로그인한 웹 화면에서만** 된다. 토큰이나 에이전트는 토큰을 만들거나 해지할 수 없다.

토큰 목록에는 상태 표지(활성, 만료됨, 해지됨)와 만료까지 남은 날수를 보여 주는 `D-n` 표지가 나온다.

## 3. 한 번만 보이는 비밀값

1. 토큰을 발급하면 나오는 창이 비밀값을 **딱 한 번** 보여 준다. 창을 닫으면 사라지고 다시 볼 수 없다.
2. 그 자리에서 복사한다. 복사는 두 가지다: 토큰 자체 복사, 설정 예시 복사(`설정 예시 복사`).
3. 설정 예시는 `command: bunx`, `args: ["-y", "@co-newbiz/co-newbiz-mcp"]`가 든 `mcpServers` 블록이다. `CO_NEWBIZ_API_BASE_URL`과 `CO_NEWBIZ_API_TOKEN`이 미리 채워져 있다.

내 컴퓨터에 필요한 것은 **bun** 하나뿐이다. `.npmrc`도 설치용 토큰도 필요 없다. 발급한 토큰은 API 호출을 인증할 뿐 패키지를 내려받는 값이 아니다. 패키지는 npmjs에서 익명으로 설치된다: `npm view @co-newbiz/co-newbiz-mcp`가 `1.0.1`을 돌려주었고 tarball이 인증 없이 내려받아졌다(HTTP 200, 2026-11-18 확인).

## 4. AI 클라이언트에 설정 예시 등록하기

`mcpServers` 항목을 클라이언트의 설정 파일에 붙여 넣는다.

| 클라이언트 | 설정 파일 위치 |
|---|---|
| Claude Code | 프로젝트의 `.mcp.json` |
| Claude Desktop | `claude_desktop_config.json`의 `mcpServers` |
| Antigravity / Gemini CLI | `.gemini/settings.json` |
| Codex 앱 / CLI | `~/.codex/config.toml`의 `[mcp_servers.*]` |

Codex는 TOML을 쓰므로 같은 command, args, env 값을 `[mcp_servers.co-newbiz]` 표로 옮긴다. 파일을 저장한 뒤 클라이언트를 다시 시작한다. 이 파일에는 내 토큰이 들어 있으므로 비밀 파일로 다룬다.

## 5. 도구가 할 수 있는 일과 없는 일

- **도구는 내 역할을 그대로 따른다**(ADR-0146). 서버는 내 토큰을 REST API에 전달할 뿐이므로 도구는 내가 할 수 있는 일만 할 수 있다. 쓰기 도구와 `propose_*` 도구는 analyst 토큰이 필요하다.
- **`propose_*` 도구는 제안 초안만 만든다.** 제안은 확인 링크(`/proposals/{id}/confirm`)를 돌려준다. 사람이 자기 웹 화면에서 이 링크를 열어 살펴보고 확정한다. 결정을 남기는 쪽은 언제나 사람이다. 제안은 72시간 뒤 만료된다.
- **MNPI 표시가 붙은 프로젝트는 기본으로 도구 응답에서 빠진다.**
- **관리 기능은 열려 있지 않다**: 사용자 관리, 데이터베이스 관리, 배치·일정 관리, 규정·절차 작성, 마스터 데이터 정정.
- 도구 호출마다 REST 호출과 `audit_log` 항목이 생긴다. 읽기 전용 호출도 마찬가지다.

이 도구가 내놓는 AI 산출물은 의사결정 지원 자료다. 투자 조언이나 법률 의견이 아니다.

## 6. 문제 풀기

| 증상 | 살필 것 |
|---|---|
| 클라이언트가 인증 오류를 보인다 | 토큰 목록을 연다. 상태 표지가 만료됨이나 해지됨이거나 `D-n` 표지가 만료를 가리키면 새 토큰을 발급해 클라이언트 설정을 바꾼다 |
| 토큰을 발급할 수 없다 | 활성 토큰이 이미 5개이거나, 역할이 admin이거나(관리자는 발급 불가), 웹 로그인이 끝난 경우다 |
| 쓰기 도구가 403 `role_forbidden`으로 실패한다 | 토큰이나 역할에 쓰기 권한이 없다. viewer는 읽기 전용이고, 쓰기에는 `읽기·쓰기` 권한의 analyst 토큰이 필요하다 |
| `bunx`를 찾을 수 없다 | bun을 설치하고 클라이언트를 다시 시작한다 |
| 도구가 데이터를 주지 않거나 연결 오류가 난다 | `CO_NEWBIZ_API_BASE_URL`이 웹 앱을 여는 주소와 같은지 확인한다 |
| 갓 발행한 패키지 버전이 보이지 않는다 | 처음 발행한 직후에는 레지스트리 조회가 잠시 늦을 수 있다. 2026-11-18에 조회가 몇 분간 404를 돌려준 적이 있다. 한 번 본 일일 뿐 보장은 아니다. 몇 분 뒤 다시 시도한다 |
| 보조 경로인 GitHub Packages가 필요하다 | `~/.npmrc`에 `@co-newbiz:registry=https://npm.pkg.github.com` 스코프 매핑과 `read:packages` PAT를 담은 `//npm.pkg.github.com/:_authToken=` 행을 둔다. 어느 GitHub 계정의 자체 PAT든 된다 |

문제가 이어지면 토큰 행 메뉴의 `식별자 복사`로 가린 식별자를 복사해 관리자에게 보낸다. 식별자는 비밀이 아니다. 토큰 자체가 비밀이다.

## 관련 화면

- `연결된 앱`(`/settings`) — 토큰 발급·목록·해지, 호스팅 앱용 커넥터 주소.
- `/wiki` — 사용자 안내서 위키의 인앱 뷰어. 연결된 앱 따라하기는 `docs/wiki/ko/12-공통-화면-둘러보기.md` §6에 있다.
- `docs/architecture/mcp-integration.md` — 구조, 도구 목록, 클라이언트 등록.
