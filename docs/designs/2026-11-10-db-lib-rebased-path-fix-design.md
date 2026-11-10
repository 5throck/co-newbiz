---
lang: ko
lang_reason: source-material
---

# Design: db/lib 모듈 앵커 경로에 저장소 레이아웃 마커 검증 도입 — PR #857 동류 후속 (2026-11-10)

**Status**: Implemented (Row 0 설계 → Row 1 구현 → 검증)
**Spec ID**: 2026-11-10-db-lib-rebased-path-fix
**Scope**: `db/lib/kill-criteria.ts`, `db/lib/simulation.ts`, `db/lib/structure-simulation.ts`, 신규 `db/lib/repo-root.ts`, 단위 테스트 확장
**Origin**: PR #857 (2026-11-10-db-path-resolver-marker)의 동류 발견 표 중 "후속 수정 권장" 항목 — kill-criteria 레지스트리 디렉터리와 python 엔진 스크립트 앵커가 같은 재베이스 메커니즘의 영향을 받음

## 1. 문제 (PR #857 설계 §2에서 확정된 메커니즘)

Next/Turbopack dev 번들러는 `import.meta`를 심(shim)으로 대체한다: `import.meta.url` = `file://<ABSOLUTE_ROOT>/<module-id>`이고, 이 프로젝트의 dev 빌드에서 `ABSOLUTE_ROOT = <repo>/app`이다. `import.meta`에서 파일시스템 경로를 계산하는 코드는 검증 없이는 `<repo>/app/...`으로 재베이스된 위치를 가리킨다.

PR #857은 `db/client.ts`(`resolveDbPath`)와 `app/web-next/lib/dart-client.ts`(`resolveCorpCachePath`)를 마커(`db/migrations`) 기반으로 고쳤고, 같은 부류의 나머지 위치를 보고-only로 남겼다. 본 설계는 그 중 **db/lib의 세 모듈**을 수정한다:

| 위치 | 현재 계산 | 재베이스 시 |
|---|---|---|
| `db/lib/kill-criteria.ts:60-61` | `REGISTRY_DIR = HERE/../../procedures/_kill-criteria` | `<repo>/app/procedures/_kill-criteria` (부재) |
| `db/lib/simulation.ts:119,125` | venv python3, `python/monte_carlo.py` 앵커 | `<repo>/app/.venv/...`, `<repo>/app/python/...` (부재) |
| `db/lib/structure-simulation.ts:27` | `python/structure_sim.py` 앵커 | `<repo>/app/python/...` (부재) |

## 2. 결정 (Decision)

**공용 순수 헬퍼를 새로 만들고(db/lib/repo-root.ts), 각 모듈은 마커 검증 결과를 사용하되 마커 부재 시 기존 경로를 유지한다.** `db/client.ts`를 import하지 않는 이유는 dart-client 설계 결정 2와 동일하다: DB 모듈 전체(bun:sqlite lazy require 포함)를 번들 그래프로 끌어들이지 않기 위함. 새 모듈은 node:path만 의존한다(테스트에서 exists 주입).

1. **`db/lib/repo-root.ts` (신규)**: 순수 헬퍼 두 개를 export한다.
   - `findRepoRootByMarker({ start, exists })` — `start`에서 위로 8단계 순회하며 `db/migrations` 마커가 있는 디렉터리(= 저장소 루트)를 반환, 부재 시 `null`. 8단계 상한과 마커는 `resolveDbPath`와 동일.
   - `resolveRepoRoot({ cwd, here, exists })` — `here`(재베이스 가능한 모듈 디렉터리)에서 먼저 순회하고, 실패 시 `cwd`에서 순회한다. 정상 Bun 경로에서 `here` = `<repo>/db/lib`이므로 첫 적중이 실제 루트이고 결과는 기존 `here/../..` 계산과 바이트 동일하다. 재베이스된 `here` = `<repo>/app/db/lib`도 상위 순회 3단계 만에 실제 루트에 도달한다(재베이스 루트는 저장소의 하위 디렉터리이므로). `cwd` 폴백은 번들러 루트가 저장소 밖에 있는 경우를 덮는다.
2. **`db/lib/kill-criteria.ts`**: `REGISTRY_DIR`을 순수 함수 `resolveRegistryDir({ cwd, here, exists })`(export, 테스트용)로 계산 — 마커 루트 발견 시 `join(root, "procedures", "_kill-criteria")`, 미발견 시 **기존 `join(HERE, "..", "..", "procedures", "_kill-criteria")` 그대로**. 이렇게 하는 이유: 레지스트리가 정말로 없을 때 `loadRegistryEntries`의 readdirSync 실패가 오늘과 **동일한 메시지·동일한 expected 경로**로 throw되어야 하기 때문(ADR-0186 fail-closed, 설계 Decision 8). 오류 경로와 그 의미는 전혀 건드리지 않고 경로 **해석**만 마커 검증으로 바꾼다. `evaluateKillCriteria`의 동작은 불변.
3. **`db/lib/simulation.ts`**: 모듈 디렉터리에서 `resolveRepoRoot`로 루트를 구하고, `resolvePythonBin()`의 venv 경로와 `ENGINE_SCRIPT`는 `resolve(root, ...)`로 계산한다. 마커 미발견 시 기존 `here/../..` 베이스를 유지 — 이 경우 엔진 스폰은 오늘과 같이 큰 소리로 실패한다(침묵 부패가 아님). 정상 경로에서 `resolve(<repo>, ".venv", "bin", "python3")` / `resolve(<repo>, "python", "monte_carlo.py")`는 기존 계산과 바이트 동일.
4. **`db/lib/structure-simulation.ts`**: simulation.ts와 동일하게 `ENGINE_SCRIPT = join(root ?? 기존 베이스, "python", "structure_sim.py")`. 정상 경로 바이트 동일.
5. **테스트**: `tests/unit/db-path-resolver.test.ts`를 확장해 (PR #857과 같은 임시 디렉터리 실트리 방식으로) 새 헬퍼를 검증한다 — 재베이스 `here` 기각, 정상 경로 바이트 동일, `cwd` 폴백, 마커 전무 시 `null`, 그리고 kill-criteria의 fail-closed 계약 보존(마커 전무 시 `resolveRegistryDir`가 기존 경로를 반환 → 기존 throw 메시지 계약 유지). 기존 `kill-criteria*.test.ts`는 실제 레지스트리를 읽으므로 새 해석 경로의 회귀를 함께 잡는다.

### 보고-only (이번 범위 외, 근거 포함)

| 위치 | 내용 | 미수정 사유 |
|---|---|---|
| `db/migrate.ts:160-164` | `import.meta.dirname` → 폴백 `DB_DIR` | Turbopack 심에 `dirname`이 없으므로 항상 `DB_DIR` 분기. PR #857에서 `DEFAULT_DB_PATH`가 올바라졌으므로 `DB_DIR`도 연쇄적으로 올바름 — 이미 수리된 상태 |
| `scripts/co-newbiz/*`의 `import.meta` 앵커 전체(backup.ts, calibrate.ts, beta-series.ts, seed-benchmark-cases.ts, gate-integrity-shadow-report.ts 등) | Bun 전용 CLI 진입점/헬퍼 | 웹 번들이 scripts/ 아래 무엇도 import하지 않음(grep으로 확인 — app/web-next에서 scripts/ import 0건). `bun scripts/...`로 직접 실행되는 Bun 네이티브에서 `import.meta.dir/dirname/url`은 항상 정확함. 재베이스 메커니즘의 영향 반경 밖 |
| `scripts/lib/*`, `scripts/hooks/*` 등 | 작업공간 루트 앵커 | 동일 — Bun 전용, 웹 번들 미포함 |

## 3. 영향 파일

- `db/lib/repo-root.ts` (신규, `@version 1.0.0`)
- `db/lib/kill-criteria.ts` (`1.1.1` → `1.2.0`)
- `db/lib/simulation.ts` (`1.2.0` → `1.3.0`)
- `db/lib/structure-simulation.ts` (`1.0.0` → `1.1.0`)
- `tests/unit/db-path-resolver.test.ts` (`1.0.0` → `1.1.0`, describe 2개 추가)

## 4. 검증 계획

1. `bun run test:unit` → 전체 통과 (기존 kill-criteria / sim-engine / simulate 스위트 포함)
2. `bun scripts/typecheck-baseline.ts` → exit 0
3. `cd app/web-next && bunx tsc --noEmit` → 오류 없음
4. `bunx biome check` (편집·신규 파일 전부) → exit 0
5. `bun scripts/co-newbiz/i18n-lint.ts` → PASS (새 텍스트는 영어 주석에 한함 — 문자열/템플릿 리터럴에 한국어 없음)
6. 기능 스모크(네트워크/LLM 없이): repo 루트에서 `bun -e`로 kill-criteria의 레지스트리 해석을 import해 출력 — `<repo>/procedures/_kill-criteria`(존재) 여야 함. python 앵커도 동일 방식으로 `<repo>/python/*.py` 확인.

## 5. 불변 계약 (명시)

- 정상 Bun 경로에서 해석되는 모든 경로는 수정 전과 **바이트 동일**.
- ADR-0186 fail-closed는 약화되지 않는다: 레지스트리 디렉터리가 정말로 없으면 `kill_criteria_rejected: registry directory unreadable — expected <경로> (design Decision 8).`를 오늘과 같이 throw한다.
- 커밋하지 않는다(검증까지 수행 후 보고).
