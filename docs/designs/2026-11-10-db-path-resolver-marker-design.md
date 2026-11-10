---
lang: ko
lang_reason: source-material
---

# Design: DB 경로 리졸버에 저장소 레이아웃 마커 검증 도입 (2026-11-10)

**Status**: Implemented (사용자 승인 결함 수정 — Row 0 설계 → Row 1 구현 → 검증)
**Spec ID**: 2026-11-10-db-path-resolver-marker
**Scope**: `db/client.ts` `resolveDefaultDbPath()`, `app/web-next/lib/dart-client.ts` `cacheFile()`, `.gitignore`, 단위 테스트 (신규)
**Origin**: 2026-11-10 PM 결함 조사 — `next dev -p 7748`(cwd `app/web-next`) 기동 시각(08:44)에 빈 SQLite(`app/db/data/co-newbiz.sqlite`, 4,096B, 테이블 0개)와 `-shm/-wal`이 생성되었고, DART corp-code 캐시(9MB)가 `app/db/data/dart-corpcode-cache.json`에 계속 기록되고 있음

## 1. 문제와 증거

정식 DB는 `<repo>/db/data/co-newbiz.sqlite`(6MB)이며 실제로 사용 중 — **데이터 유실 없음**. 그러나:

| 이상 파일 | 관측 | 영향 |
|---|---|---|
| `app/db/data/co-newbiz.sqlite` (+`-shm`/`-wal`) | 4096B, 테이블 0개. 서버 기동 시각 08:44 생성 | 기동 시 한 번 열리고 방치 — 마이그레이션 미적용(테이블 0개가 그 증거) |
| `app/db/data/dart-corpcode-cache.json` | 9,136,932B, 계속 갱신 중(17:22) | 정식 `db/data/`가 아니라 그림자 위치에 캐시 기록 — 정식 위치의 캐시는 갱신되지 않음 |

`git status`에서 `?? app/db/`로 untracked이지만, 현재 `.gitignore`의 일치 규칙은 `*.sqlite`/`*.sqlite-wal`(L55/L96)뿐 — **`dart-corpcode-cache.json`은 무시 규칙이 없어 `git add -A` 한 번에 스테이징될 수 있다**.

## 2. 메커니즘

### 메커니즘 A — dart-client 캐시 경로 (코드로 확정)

`app/web-next/lib/dart-client.ts:147-161`의 `cacheFile()`이 cwd에서 위로 올라가며 **`db/data` 디렉터리의 존재 자체**를 저장소 루트 증거로 받아들인다. cwd가 `app/web-next`이면 `app/web-next/db/data`(부재) → `app/db/data`(한 번 생기면 존재) 순으로 순회하며, 첫 번째 적중을 반환한다. 빈 SQLite가 먼저 `app/db/data`를 만들어 놓으면(메커니즘 B) 이후 모든 DART corp-code 캐시는 그림자 위치에 기록된다.

### 메커니즘 B — db/client의 `here` 무조건 신뢰 (빌드 산출물로 확정)

`db/client.ts:22-46`의 `resolveDefaultDbPath()`은 `here = import.meta.dirname ?? import.meta.dir ?? dirname(fileURLToPath(import.meta.url))`을 얻은 뒤 `if (here) return join(here, "data", "co-newbiz.sqlite")`로 **검증 없이** 신뢰한다.

빌드 산출물로 재베이스가 확인된다 (`app/web-next/.next/dev/server/chunks/`):

- `db_0xlh729._.js:27-30` — Turbopack이 `import.meta`를 심(shim)으로 대체: `get url() { return \`file://${__turbopack_context__.P("db/client.ts")}\` }`. `dirname`/`dir`는 심에 없으므로 `here`는 URL 분기로 결정된다.
- `[turbopack]_runtime.js` (sourcemap 원문) — `Context.prototype.P = resolveAbsolutePath`이며, `resolveAbsolutePath(modulePath) = path.join(ABSOLUTE_ROOT, modulePath)`. `ABSOLUTE_ROOT`는 런타임 청크 위치에서 `distDir`을 벗겨낸 절대경로인데, 이 프로젝트의 dev 빌드에서는 `<repo>/app`으로 귀결된다.

결과: `import.meta.url` = `file://<repo>/app/db/client.ts` → `here` = `<repo>/app/db` → `join(here, "data", "co-newbiz.sqlite")` = `app/db/data/co-newbiz.sqlite`. 기동 시(instrumentation의 DB 접근) `getDb()`의 `mkdirSync`가 `app/db/data`를 만들고 빈 DB를 생성했다. 이는 파일 헤더 주석(`db/client.ts:18-21`)이 문서화한 과거 사고(`app/web-next/db/data/`)와 같은 부류의 재발이다 — 그때는 cwd 상대 기본값이 원인이었고, 이번에는 번들러가 재베이스한 `import.meta` 식별자가 원인이다.

> 결함 발생 당시 실제로 `app/db/data`를 만든 최초 진입점(정확히 어떤 모듈이 기동 중 `getDb()` 기본값을 쳤는지)까지는 특정하지 않았다 — 확정된 것은 (1) 재베이스된 `here`가 `app/db`를 가리킨다는 빌드 산출물 증거와 (2) 기동 시각 생성·테이블 0개라는 관측이다. 수정은 진입점과 무관하게 경로 해석 자체를 고정하므로 충분하다 (KNOWN vs INFERRED 구분).

## 3. 결정 (Decision)

**모든 경로 리졸버는 저장소 레이아웃 마커 `db/migrations` 하나로만 저장소 루트를 확정한다.** `db/migrations`는 마이그레이션 SSOT 디렉터리로, 그림자 디렉터리(`app/db/`, `app/web-next/db/`)에는 존재할 수 없고 정식 `<repo>/db/`에만 존재한다. `db/data` 존재는 저장소 루트의 증거가 될 수 없다 — 빈 DB 하나로 위조된다(이번 사고 그 자체).

1. **`db/client.ts`**: `here`는 `existsSync(join(here, "migrations"))`가 참일 때만 신뢰한다(정상 Bun 런타임에서 `here` = `<repo>/db`이므로 마커가 항상 참 — 기존 동작 불변). 마커가 없으면 기존 cwd 상승 순회로 넘어간다(이미 `db/migrations` 마커 사용). `CO_NEWBIZ_DB_PATH` 오버라이드는 최우선 유지. 테스트 가능성을 위해 순수 헬퍼 `resolveDbPath({ envPath, cwd, here, exists })`를 추출·export하고, `resolveDefaultDbPath()`는 실제 환경을 주입하는 얇은 래퍼가 된다.
2. **`app/web-next/lib/dart-client.ts`**: `cacheFile()`의 순회 조건을 `db/data` 존재 → `db/migrations` 마커로 바꾸고, 적중 시 `<마커 상위>/db/data/dart-corpcode-cache.json`을 반환. 최종 cwd 폴백 유지. 순수 헬퍼 `resolveCorpCachePath({ cwd, exists })`로 추출·export. 이 파일의 기존 관례(require + turbopackIgnore)를 유지하고 `db/client.ts` import는 넣지 않는다 — DB 모듈 전체가 번들 그래프로 끌려 들어가는 것을 피하는 게 이 파일의 설계 의도다.
3. **`.gitignore`**: `app/db/` 추가 — 우발적 `git add -A` 스테이징을 원천 차단. `app/web-next/db/data/**`(L99)는 이미 존재.
4. **운영 정리(별도 수행, 이 변경사항에 포함 안 됨)**: dev 서버 정지 → `app/db/` 삭제 → 재기동. 재기동 후 DART 캐시는 정식 위치에 1회 재다운로드된다(예산 소소한 소모, 기능 영향 없음). PM이 처리.

### 적용 대상 외 동류 발견 (보고만, 이번 범위 외)

| 위치 | 내용 | 미수정 사유 |
|---|---|---|
| `db/lib/kill-criteria.ts:60-61` | 같은 `import.meta.url` 신뢰 → 번들 시 `REGISTRY_DIR` = `<repo>/app/procedures/_kill-criteria`(부재). 단, 부재 시 **명시적으로 throw**(설계 Decision 8의 fail-closed) — 침묵 부패가 아니라 요청 시 큰 소리로 실패 | ADR-0186 P2 보안 경로. 실패 모드가 안전하며, 별도 설계 승인 권장 — 후속 과제로 보고 |
| `db/lib/simulation.ts:119,125`, `db/lib/structure-simulation.ts:27` | 동일 패턴으로 python 엔진 스크립트 경로 앵커 | 웹 번들에서 이 모듈의 python 실행 경로가 재베이스될 잠재 위험. 동일 마커 기법으로 후속 수정 권장 |
| `scripts/co-newbiz/backup.ts:34`, `restore.ts:38`, `committee-deliberation.ts:113`, `gen-pk-notnull-rebuild.ts:29` | cwd 상대 기본 경로 (Bun 전용 CLI) | 순회·존재 판정이 아니라 명시적 연산자 실행 계약. backup은 부재 시 throw, rebuild는 readonly라 생성 불가 |
| `scripts/co-newbiz/beta-series.ts:74`, `seed-benchmark-cases.ts:121`, `gate-integrity-shadow-report.ts:255`, `align-existing-projects.ts:35` | `import.meta.dir/dirname/url` 앵커 (Bun 전용 CLI) | 웹 앱에서 import하지 않음(grep 확인, gate-integrity는 `import.meta.main` 내부라 import 시 미실행) — Bun 네이티브에서 항상 정확 |
| `db/migrate.ts:160-164` | `import.meta.dirname` → 폴백 `DB_DIR` | Turbopack 심에 `dirname`이 없으므로 항상 `DB_DIR` 분기 — 본 수정으로 `DEFAULT_DB_PATH`가 올바라지면 연쇄적으로 올바름 |

## 4. 검증 계획

1. 신규 단위 테스트 `tests/unit/db-path-resolver.test.ts` — 임시 디렉터리 실트리 구성:
   - (a) 미끼: `<tmp>/repo/app/db/data`가 존재해도 `<tmp>/repo/db/migrations`가 더 위에 있으면 정식 경로 선택 (두 리졸버 공통)
   - (b) `here`가 `migrations` 없는 디렉터리 → 기각, cwd 상승 결과 채택
   - (c) `CO_NEWBIZ_DB_PATH` 오버라이드 최우선
   - (d) 정상 경로(`here` = 마커 있는 `db` 디렉터리) 불변
   - (e) 마커 전무 → cwd 폴백
2. `bun scripts/typecheck-baseline.ts` → exit 0
3. `cd app/web-next && bunx tsc --noEmit` → 오류 없음
4. `bunx biome check` (편집 파일 전부) → exit 0
5. `bun scripts/co-newbiz/i18n-lint.ts` → PASS (새 한국어는 JS 주석에 한함)
6. `bun run test:unit` → 전체 통과

## 5. 운영 정리 노트

dev 서버(`next dev -p 7748`) 정지 → `rm -rf app/db/` → 재기동. 정식 DB·정식 캐시에는 영향 없음. 캐시는 다음 DART corp-code 조회 시 1회 재다운로드. (이 디렉터리 삭제는 PM이 별도 수행 — 실행 중인 서버가 파일을 붙잡고 있어 본 변경과 동시 수행하지 않음.)
