# mcp-server-integration

> **`SKILL.md` 프론트매터에서 생성됨 (2026-08-28 per-skill README 표준, CONSTITUTION §6.2).** 자유롭게 보강하세요 — 이 파일은 자동 재생성되지 않습니다.

## 목적

ADR-0011의 협상 불가 규칙에 따라 `mcp/co-newbiz/`에 MCP 도구를 설계하고 추가합니다: 서버는 오직 REST API만 호출하며 직접 DB 연결은 절대 하지 않습니다 — `bun:test` 파일 스캔(`tests/unit/mcp.test.ts`)으로 강제되며 단순 설계 문서가 아닙니다. 새 도구는 먼저 대응하는 REST 엔드포인트가 필요합니다(`rest-api-design`); 없으면 `docs/mcp-integration.md` §6에 따라 Stage 5 CI 실패입니다.

- **스코프(scope)**: `co-newbiz`
- **버전**: 1.0.0

## 사용 시점

- 위 목적에 해당하는 작업을 수행할 때 로드합니다 (`SKILL.md` 설명 참조).

## 사전 조건

(none)

## 사용 방법

```
<SKILL.md의 지시에 따라 호출 — 또는 플랫폼 스킬 레지스트리를 통해 AI 스킬로 로드>
```

권한 지침과 프론트매터는 [SKILL.md](SKILL.md)를 참조하세요.
