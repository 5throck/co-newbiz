---
lang: ko
lang_reason: source-material
counterpart: deployment.md
---

# Runbook — 배포 및 릴리스

**Owner**: release-engineer, platform-lead
**Design of record**: ADR-0014, `docs/security/security-baseline.md` §2 (배포 전 게이트)
**Status**: 전환(cutover) 이후(ADR-0069/0070, Phase 5/6, 2026-08-26). 오늘날 실제 존재하는 것을 다룹니다 — `app/web-next/`(Next.js, `/api/**`의 REST API와 웹 UI를 모두 서빙) 및 `mcp/co-newbiz/`(stdio MCP 서버). `app/server/`(Hono)와 기존 `app/web/`(Vite SPA)는 Phase 6에서 폐기되었습니다 — 마이그레이션 기록은 `docs/designs/2026-08-25-web-stack-migration-nextjs-prisma_ko.md` 참조. 컨테이너화/오케스트레이션 계층은 아직 없으며, 이 runbook은 직접 프로세스 배포 기준입니다.

## 1. 배포 전 게이트 (`docs/security/security-baseline.md` §2)

모든 릴리스 전에 실행, 예외 없음:

1. **시크릿/의존성 스캔**: `gitleaks detect -v --source .` — 유출 0건 필요. 주간 주기도 이를 다루지만, 주간 스캔이 최근에 실행되었다는 이유로 릴리스에서 생략하지 않습니다.
2. **테스트 스위트**: `bun test` — 실패 0건 필요.
3. **감사 게이트**: `bun scripts/audit.ts` — 오류 0건 필요(경고는 검토하되 반드시 차단하지는 않음).
4. **위협 모델 최신성 확인**: 이 릴리스가 신뢰 경계를 건드리는 경우(새 API 엔드포인트, 새 MCP 도구, 새 인증 경로), `docs/security/security-model.md` §2의 STRIDE 매트릭스와 §8의 검증 상태 테이블이 여전히 정확한지 확인 — 후속 작업이 아니라 같은 PR에서 갱신.

## 2. 빌드

```bash
cd app/web-next && bun install && bun run build
```

Next.js 자체 빌드가 하나의 프로세스에서 `/api/**`(Route Handlers)와 App Router 페이지를 모두 서빙 — 별도의 정적 서빙 단계나 dist 디렉터리 존재 확인이 필요 없습니다(이는 `app/server/index.ts`의 Hono 시절 메커니즘으로, Phase 6에서 폐기됨).

## 3. 데이터베이스

1. **마이그레이션 직전에 백업** (`docs/runbooks/backup-restore.md` §2-3) — 이것이 릴리스의 롤백 계획이며, 시간 압박 속에서 생략될 수 있는 별도 단계가 아닙니다.
2. `bun scripts/co-newbiz/newbiz.ts db:migrate` — 대기 중인 `db/migrations/*.sql`을 파일명 순서로 적용.
3. 이 릴리스의 모든 신규 마이그레이션에 `@reversible: true|false` 태그가 있는지 확인(`db-migration-governance`) — 되돌릴 수 없는 마이그레이션은 release-engineer + dba 공동 서명이 필요하며, 이 단계 이전이 아니라 이전에 획득해야 합니다.

## 4. 서버 시작

```bash
cd app/web-next && bun --bun run start
```

기본 포트 7749에서 실행(`package.json`의 `start` 스크립트; 2026-09-20, 일부 운영 환경에서 무관한 Docker 서비스가 8787을 점유함에 따라 Phase 5 컷오버 기본값이던 8787에서 변경). `bun run`이 아닌 `bun --bun`이 필요 — 그렇지 않으면 Next의 dev/start 스크립트가 Node 하에서 실행되며, Node는 `bun:sqlite`(`db/client.ts`의 import)를 해석할 수 없습니다. Phase 2에서 경험적으로 발견된 사항입니다.

헬스 체크: `GET /api/health`가 `{"status":"ok"}`를 반환해야 합니다. 이것이 ADR-0014가 요구하는 "직후 헬스 체크" 단계 — 프로세스가 크래시 없이 시작된 것만이 아니라, 릴리스를 완료로 간주하기 전에 확인해야 합니다.

## 5. MCP 서버 (클라이언트별)

MCP 서버는 각 AI 클라이언트 자체의 설정(Claude Code는 `.mcp.json`; 나머지 세 클라이언트의 설정 위치는 `docs/architecture/mcp-integration.md` §4 참조)을 통해 클라이언트별로 실행 — 별도로 배포된 서비스가 아니며, 각 클라이언트가 stdio 상에서 자체 `bun run mcp/co-newbiz/index.ts` 프로세스를 스폰합니다. REST API 표면을 변경하는 릴리스는 `dispatch()` 수준 테스트뿐 아니라 `tests/unit/mcp.test.ts`의 실제 stdio 전송 테스트도 통과하는지 확인해야 합니다 — 실제 클라이언트가 사용하는 JSON-RPC 와이어 프로토콜을 실제로 exercise하는 것은 그 테스트이기 때문입니다.

## 6. 롤백

헬스 체크 실패 또는 배포 후 문제 발생 시: `docs/runbooks/backup-restore.md` §3의 롤백 절차 — 위 3.1 단계에서 취한 마이그레이션 전 백업을 복원한 뒤 이전 릴리스의 코드를 재배포. DB 롤백과 코드 롤백은 분리되고 순서화된 두 개의 작업입니다; 최신 코드에 대해 DB만 복원하는 것(또는 그 반대)은 유효한 롤백 상태가 아닙니다.

## 7. 배포 후

1. 배포 후 예약 작업이 OS 스케줄러에 여전히 등록되어 있는지 확인(`batch-scheduling-operations`) — OS 수준 스케줄러 등록을 보존하지 않는 배포 프로세스가 이 확인이 존재하는 이유인 실제 리스크입니다.
2. `observability-and-alerting`의 작업 실행 모니터링이 배포 후 예정대로 예상 작업이 실행되는 것을 보여주는지 확인 — 배포 자체의 성공만이 아니라.

## 8. 관련 문서

- `docs/runbooks/backup-restore.md` — 이 runbook이 의존하는 롤백 메커니즘
- `docs/security/security-baseline.md` — 이 runbook이 실행하는 배포 전 게이트
- `skills/deployment-and-release/SKILL.md`, `skills/db-migration-governance/SKILL.md` — 이 runbook이 구현하는 운영 규율
