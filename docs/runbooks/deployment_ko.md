---
lang: ko
lang_reason: source-material
counterpart: deployment.md
---

# Runbook — 배포 및 릴리스

**Owner**: release-engineer, platform-lead
**Design of record**: ADR-0014, `docs/security/security-baseline.md` §2 (배포 전 게이트)
**Status**: 전환(cutover) 이후(ADR-0069/0070, Phase 5/6, 2026-08-26). 오늘날 실제 존재하는 것을 다룹니다 — `app/web-next/`(Next.js, `/api/**`의 REST API와 웹 UI를 모두 서빙) 및 `mcp/co-newbiz/`(stdio MCP 서버). `app/server/`(Hono)와 기존 `app/web/`(Vite SPA)는 Phase 6에서 폐기되었습니다 — 마이그레이션 기록은 `docs/designs/2026-08-25-web-stack-migration-nextjs-prisma_ko.md` 참조. 2026-09-21부터 운영은 운영 PC의 Docker 컨테이너로 실행됩니다(§8). 개발은 호스트에서 직접 프로세스로 실행합니다(§2–§4).

## 1. 배포 전 게이트 (`docs/security/security-baseline.md` §2)

모든 릴리스 전에 실행, 예외 없음:

1. **시크릿/의존성 스캔**: `gitleaks detect -v --source .` — 유출 0건 필요. 주간 주기도 이를 다루지만 주간 스캔이 최근에 실행되었다는 이유로 릴리스에서 생략하지 않습니다.
2. **테스트 스위트**: `bun test` — 실패 0건 필요.
3. **감사 게이트**: `bun scripts/audit.ts` — 오류 0건 필요(경고는 검토하되 반드시 차단하지는 않음).
4. **위협 모델 최신성 확인**: 이 릴리스가 신뢰 경계를 건드리는 경우(새 API 엔드포인트, 새 MCP 도구, 새 인증 경로), `docs/security/security-model.md` §2의 STRIDE 매트릭스와 §8의 검증 상태 테이블이 여전히 정확한지 확인 — 후속 작업이 아니라 같은 PR에서 갱신.

## 2. 빌드 (개발 / 직접 프로세스)

```bash
cd app/web-next && bun install && bun run build
```

Next.js 자체 빌드가 하나의 프로세스에서 `/api/**`(Route Handlers)와 App Router 페이지를 모두 서빙 — 별도의 정적 서빙 단계나 dist 디렉터리 존재 확인이 필요 없습니다(이는 `app/server/index.ts`의 Hono 시절 메커니즘으로, Phase 6에서 폐기됨).

## 3. 데이터베이스

1. **마이그레이션 직전에 백업** (`docs/runbooks/backup-restore.md` §2-3) — 이것이 릴리스의 롤백 계획이며 시간 압박 속에서 생략될 수 있는 별도 단계가 아닙니다.
2. `bun scripts/co-newbiz/newbiz.ts db:migrate` — 대기 중인 `db/migrations/*.sql`을 파일명 순서로 적용.
3. 이 릴리스의 모든 신규 마이그레이션에 `@reversible: true|false` 태그가 있는지 확인(`db-migration-governance`) — 되돌릴 수 없는 마이그레이션은 release-engineer + dba 공동 서명이 필요하며 이 단계 이전이 아니라 이전에 획득해야 합니다.

## 4. 서버 시작

```bash
cd app/web-next && bun --bun run start
```

기본 포트 7748에서 실행(`package.json`의 `dev`/`start` 스크립트; 2026-09-20까지 8787, 이후 7749, 2026-10-11에 7748로 교체 — 7749를 Cloudflare 터널이 가리키는 Docker 운영 컨테이너에 배정하기 위함). `bun run`이 아닌 `bun --bun`이 필요 — 그렇지 않으면 Next의 dev/start 스크립트가 Node 하에서 실행되며 Node는 `bun:sqlite`(`db/client.ts`의 import)를 해석할 수 없습니다. Phase 2에서 경험적으로 발견된 사항입니다.

헬스 체크: `GET /api/health`가 `{"status":"ok"}`를 반환해야 합니다. 이것이 ADR-0014가 요구하는 "직후 헬스 체크" 단계 — 프로세스가 크래시 없이 시작된 것만이 아니라, 릴리스를 완료로 간주하기 전에 확인해야 합니다.

## 5. MCP 서버 (클라이언트별)

MCP 서버는 각 AI 클라이언트 자체의 설정(Claude Code는 `.mcp.json`; 나머지 세 클라이언트의 설정 위치는 `docs/architecture/mcp-integration.md` §4 참조)을 통해 클라이언트별로 실행 — 별도로 배포된 서비스가 아니며 각 클라이언트가 stdio 상에서 자체 `bun run mcp/co-newbiz/index.ts` 프로세스를 스폰합니다. REST API 표면을 변경하는 릴리스는 `dispatch()` 수준 테스트뿐 아니라 `tests/unit/mcp.test.ts`의 실제 stdio 전송 테스트도 통과하는지 확인해야 합니다 — 실제 클라이언트가 사용하는 JSON-RPC 와이어 프로토콜을 실제로 exercise하는 것은 그 테스트이기 때문입니다.

## 6. 롤백

헬스 체크 실패 또는 배포 후 문제 발생 시: `docs/runbooks/backup-restore.md` §3의 롤백 절차 — 위 3.1 단계에서 취한 마이그레이션 전 백업을 복원한 뒤 이전 릴리스의 코드를 재배포. DB 롤백과 코드 롤백은 분리되고 순서화된 두 개의 작업입니다; 최신 코드에 대해 DB만 복원하는 것(또는 그 반대)은 유효한 롤백 상태가 아닙니다.

## 7. 배포 후

1. 배포 후 예약 작업이 OS 스케줄러에 여전히 등록되어 있는지 확인(`batch-scheduling-operations`) — OS 수준 스케줄러 등록을 보존하지 않는 배포 프로세스가 이 확인이 존재하는 이유인 실제 리스크입니다.
2. `observability-and-alerting`의 작업 실행 모니터링이 배포 후 예정대로 예상 작업이 실행되는 것을 보여주는지 확인 — 배포 자체의 성공만이 아니라.

## 8. 컨테이너 운영 배포 (Docker)

2026-09-21부터 운영 서버는 `docker/Dockerfile`로 빌드된 컨테이너로서 운영 PC에서 실행되며 개발은 호스트의 직접 프로세스로 유지됩니다(§2–§4). CI/CD 분담: **CI** — `main`에 push할 때마다 이미지를 빌드해 `ghcr.io/5throck/co-newbiz-web`에 push합니다(`latest` + `sha-<커밋>` 태그; `.github/workflows/docker.yml`). 앱 관련 변경이 있는 PR은 push 없이 빌드만 수행해 머지 전에 Dockerfile 파손을 조기 검출합니다. **CD** — push된 이미지를 운영 컨테이너에 반영하는 것은 의도된 수동 행위입니다: `bun scripts/deploy-web.ts`(또는 pull 대신 로컬 빌드는 `--build`).

배포는 ADR-0014 규율과 일대일로 대응합니다:

1. **마이그레이션 전 백업** — `docker/entrypoint.sh`는 기존 데이터베이스가 있는 상태의 모든 컨테이너 시작에서 SQLite 파일(WAL/SHM 사이드카 포함; 서버가 아직 실행 중이 아니므로 단순 복사가 일관된 스냅샷)을 `backups/pre-deploy-<timestamp>.db`로 복사합니다.
2. **마이그레이션** — 서버 부팅이 대기 중인 마이그레이션을 자동 적용합니다(`CO_NEWBIZ_BOOTSTRAP_MIGRATIONS=auto`, `app/web-next/instrumentation.ts`). 새 볼륨의 첫 부팅은 첫 관리자 계정도 부트스트랩합니다(무작위 비밀번호가 컨테이너 로그에 한 번 출력 — 확인: `docker logs co-newbiz-web | grep -i password`).
3. **직후 헬스 체크** — `bun scripts/deploy-web.ts`는 `http://127.0.0.1:7749/api/health`를 폴링하며 통과하지 못하면 롤백 힌트와 함께 실패합니다. 실패 시: 이전 이미지를 되돌리고(스크립트가 정확한 `docker tag` 명령을 출력) DB 쪽은 §6을 따릅니다 — 코드 롤백과 DB 롤백은 여전히 분리되고 순서화된 작업입니다.

구성: 호스트 포트 **7749** → 컨테이너 7749(compose `7749:7749`; 개발 서버는 7748, 8787은 무관한 로컬 Docker 서비스가 점유). 데이터베이스는 앱 자체의 `<repo>/db/data` 디렉터리에 마운트된 `co-newbiz-data` named volume에 존재합니다 — `CO_NEWBIZ_DB_PATH`를 다른 곳으로 지정하지 마십시오(`db/client.ts`가 DB 경로의 조부모 디렉터리에서 마이그레이션 위치를 도출합니다) — 컨테이너 교체는 데이터에 손대지 않습니다. 시크릿은 호스트 로컬의 `.env.prod`에만 존재합니다(`.env.sample`의 Production 섹션에서 생성; gitignore 처리, 이미지에 베이크되지 않음). 저장소가 비공개이므로 게시된 패키지도 비공개입니다: 첫 pull 전에 `read:packages` 권한의 PAT로 `docker login ghcr.io`를 1회 수행합니다(PAT 순환 후 재수행).

§7의 배포 후 확인은 동일하게 적용됩니다: 예약 작업은 ADR-0019에 따라 **호스트 OS 스케줄러**(launchd)에 등록된 채로 유지됩니다 — 컨테이너는 in-process 타이머를 실행하지 않으며 컨테이너 교체가 호스트 스케줄러 등록을 흔들어서는 안 됩니다.

### 운영자 전환 절차 (2026-10-11 포트 교체)

Cloudflare 터널(`cloudflared`, 운영 PC의 docker 컨테이너이며 설정은 이 저장소 밖에 있음)은 `https://newbiz.bizknights.org`를 호스트 포트 7749로 연결합니다. 교체 전 7749는 개발 서버였고, 교체 후에는 운영 컨테이너입니다. 순서대로 실행:

```bash
# 1. 현재 7749를 점유한 개발 서버 중지 (해당 터미널에서 Ctrl-C 또는)
lsof -ti tcp:7749 | xargs kill
# 2. 새 개발 포트로 개발 서버 시작
cd app/web-next && bun run dev            # http://localhost:7748
# 3. 운영 시작 (먼저 최신 이미지 pull, 로컬 빌드는 --build 추가)
docker compose pull web && docker compose up -d
bun scripts/deploy-web.ts                 # 대안: pull + up + 헬스 체크를 한 번에
curl -s http://127.0.0.1:7749/api/health  # {"status":"ok"} 기대
curl -sI https://newbiz.bizknights.org/ | head -1
```

개발 서버를 가리키는 Cloudflare 또는 Tailscale 호스트명(예: `dev-newbiz.bizknights.org`)을 새로 추가하면 루트 `.env`의 `CO_NEWBIZ_ALLOWED_DEV_ORIGINS`에 쉼표 또는 공백으로 구분해 넣습니다(스킴·포트 없는 호스트명 또는 IP, 코드 변경 불필요). 이후 개발 서버를 재시작해야 합니다. `next.config`는 시작 시점에 평가되고 루트 `.env`는 감시되지 않기 때문입니다. 그렇지 않으면 개발 서버가 `/_next/webpack-hmr`와 개발 청크에 403을 반환하여 페이지가 hydrate되지 않습니다. 운영 빌드는 이 변수를 무시합니다.

또한 `.env.prod`에 `CO_NEWBIZ_PUBLIC_ORIGIN=https://newbiz.bizknights.org`를 설정하고(`.env.sample`의 Production 섹션 참조), 로컬 MCP 클라이언트 설정은 `CO_NEWBIZ_API_BASE_URL=http://localhost:7748`(또는 공개 URL)로 갱신합니다. `co-newbiz-data` 볼륨이 이미 없으면 운영 컨테이너는 빈 볼륨으로 시작하며 첫 부팅 시 관리자 비밀번호는 `docker logs co-newbiz-web | grep -i password`로 확인합니다.

롤백: `docker compose down` 후 개발 서버를 다시 7749에서 시작(`cd app/web-next && bun --bun next dev -p 7749`)하여 터널이 이전처럼 서빙하게 하고 스크립트 복원은 포트 교체 커밋을 되돌립니다.

### 운영 환경 설정

컨테이너는 루트 `.env`가 아니라 `.env.prod`(compose `env_file`)를 읽습니다. git에 추적되는 `.env.sample`의 Production 섹션(placeholder만 포함) 주석 줄을 복사해 만들며 실제 파일은 gitignore 상태로 유지합니다. 변경은 `docker compose up -d --force-recreate` 후에만 적용됩니다.

| 변수 | 용도 | 형식 | 기본값 | 설정 시점 |
|---|---|---|---|---|
| `CO_NEWBIZ_PUBLIC_ORIGIN` | OAuth issuer와 MCP resource 식별자를 고정합니다. 없으면 요청 Host 헤더에서 origin을 얻으며, 위조된 Host로 바뀔 수 있습니다. | `https://host[:port]`, 경로 없음 | 미설정 | 운영에서는 항상(미설정 또는 형식 오류 시 부팅 로그에 경고) |
| `CO_NEWBIZ_MCP_ALLOWED_ORIGINS` | `/api/mcp`를 호출할 수 있는 추가 브라우저 Origin(공개 origin은 항상 허용). | origin 쉼표 목록 | 비어 있음 | 다른 origin의 브라우저 앱이 `/api/mcp`를 호출할 때만 |
| `CO_NEWBIZ_OAUTH_REDIRECT_HOST_ALLOWLIST` | OAuth 클라이언트 리디렉션 대상으로 허용할 호스트. | 호스트 쉼표 목록 | 비어 있음(https 또는 루프백만 허용) | 다른 호스트로 리디렉션하는 OAuth 클라이언트가 있을 때만 |
| `CO_NEWBIZ_ALLOWED_DEV_ORIGINS` | 개발 서버 HMR 호스트명. | 스킴 없는 호스트명/IP | 내장 목록 | 개발 전용(루트 `.env`), 운영에서는 무시 |

쿠키 세션 CSRF 검사는 요청 Origin의 호스트와 Host 헤더만 비교하므로 새 공개 호스트명은 브라우저에서 `/api/mcp`를 호출하지 않는 한 앱 설정이 필요 없습니다.

## 9. 관련 문서

- `docs/runbooks/backup-restore.md` — 이 runbook이 의존하는 롤백 메커니즘
- `docs/security/security-baseline.md` — 이 runbook이 실행하는 배포 전 게이트
- `skills/deployment-and-release/SKILL.md`, `skills/db-migration-governance/SKILL.md` — 이 runbook이 구현하는 운영 규율
