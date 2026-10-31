---
lang: ko
lang_reason: source-material
counterpart: scheduler.md
---

# 운영 절차서 — 스케줄러 틱 (OS 등록, 심박, 잡)

**담당**: infra-automation-engineer
**대상**: 운영자, release-engineer, sre
**설계 근거**: ADR-0189, `docs/designs/2026-10-29-scheduled-jobs-design.md` (§2.3 실행 환경, §6 장애 알림, §7 설치기, §8 P2, §9 수동 시험)
**상태**: active (P2). 설치기(`scripts/co-newbiz/scheduler-install.ts`)는 반영되었고 등록은 운영자가 실행합니다. 운영(prod) 등록은 P7에서 진행합니다.

## 1. 모델 개요

환경마다 하나의 OS 등록 항목이 60초마다 `bun scripts/co-newbiz/schedule-tick.ts`를 실행합니다. 틱은 짧게 살아 있는 디스패처입니다: 심박을 기록하고, 오래된 실행을 정리하고, 실행 시점에 `schedule_job`(사용 여부와 cron)을 읽고, 마감된 잡마다 `run-job.ts`를 한 번씩 띄운 뒤 종료합니다. 틱이 잡 코드를 직접 실행하지는 않습니다(ADR-0019/ADR-0189: 시계는 OS가 쥐고, 앱 안 타이머는 금지).

두 가지를 기억하세요:

- **관리자 토글과 cron 수정은 OS 재등록이 필요 없습니다.** OS 항목은 고정이고, 틱이 매분 `schedule_job.enabled`와 `cron_expr`를 읽으므로 `/admin/schedule` 화면의 변경은 1분 안에 반영됩니다.
- **OS 항목 제거가 전체 정지 스위치입니다.** 틱이 없으면 아무것도 실행되지 않습니다. 예약 잡도, "지금 실행" 요청도 처리되지 않고 심박이 오래됩니다(높은 심각도 알림, 설계 §6).

환경 분리(설계 §2.3):

| 환경 | OS 항목 (레이블 / 인스턴스) | 틱 명령 | DB |
|---|---|---|---|
| prod | `org.bizknights.co-newbiz.prod.tick` (launchd) | `docker exec -e CO_NEWBIZ_SCHEDULER_ENV=prod co-newbiz-web bun scripts/co-newbiz/schedule-tick.ts` | 컨테이너 볼륨 |
| dev | `org.bizknights.co-newbiz.dev.tick` (launchd) | `<bun> scripts/co-newbiz/schedule-tick.ts` | 호스트의 `db/data/co-newbiz.sqlite` |

틱은 `CO_NEWBIZ_SCHEDULER_ENV`(`prod`|`dev`)가 없으면 실행을 거부하고, 모든 `job_run`에 환경을 기록합니다. 개발 틱의 실행이 운영 실행으로 오인되는 일은 없습니다. 기본 cron 식은 KST(아시아/서울, 서머타임 없음) 기준으로 판정합니다.

launchd 항목은 LaunchDaemon이 아니라 LaunchAgent(사용자 세션)입니다. Docker Desktop이 사용자 세션에서 돌기 때문이며, 소유자 결정 D5로 수용한 대가는 **로그아웃 중에는 아무것도 실행되지 않는다**는 점입니다.

## 2. 설치 (dev, macOS)

설치기가 유일한 등록 경로입니다. `ops/scheduler/launchd/co-newbiz-tick.plist.tmpl`을 렌더링해 plist를 쓰고, 로그 디렉터리를 만들고, `launchctl bootstrap gui/$UID`까지 스스로 호출합니다. 설치에 `launchctl`을 손으로 호출할 일은 없습니다.

1. **계획 미리보기** (쓰기도 호출도 없음):

   ```bash
   bun scripts/co-newbiz/scheduler-install.ts --env dev --dry-run
   ```

   예상 출력(경로는 홈 디렉터리를 따릅니다):

   ```
   [dry-run] would write plist: ~/Library/LaunchAgents/org.bizknights.co-newbiz.dev.tick.plist
   [dry-run] would create log dir ~/Library/Logs/co-newbiz (mode 0700) with log files (mode 0600):
   [dry-run]   ~/Library/Logs/co-newbiz/dev-tick.out.log
   [dry-run]   ~/Library/Logs/co-newbiz/dev-tick.err.log
   [dry-run] would run: launchctl bootstrap gui/${UID} ~/Library/LaunchAgents/org.bizknights.co-newbiz.dev.tick.plist
   ```

2. **렌더링된 plist 확인** — launchd가 읽을 내용을 그대로 보려면:

   ```bash
   bun scripts/co-newbiz/scheduler-install.ts --env dev --print
   ```

   담고 있는 것: 레이블 `org.bizknights.co-newbiz.dev.tick`; `ProgramArguments` = `<bun> scripts/co-newbiz/schedule-tick.ts`; `WorkingDirectory` = 저장소 루트(dev만); `EnvironmentVariables` = 명시적 `PATH`(bun 디렉터리 + 시스템 경로 — launchd가 물려주는 PATH는 빈약함)와 `CO_NEWBIZ_SCHEDULER_ENV=dev`; `StartInterval 60`; `RunAtLoad false`; `ProcessType Background`; `AbandonProcessGroup true`(필수: 틱은 분리된 `run-job.ts` 자식을 띄우고 종료합니다 — 이 값이 없으면 launchd가 틱 종료 시 자식까지 죽입니다); 로그 경로. **시크릿은 없습니다.**

3. **설치**:

   ```bash
   bun scripts/co-newbiz/scheduler-install.ts --env dev
   ```

   설치기는 `installed: <plist 경로>`, 로그 경로, `launchctl print` 검증 명령을 출력합니다. 실패하면 0이 아닌 종료 코드와 함께 `launchctl bootstrap` 오류를 출력합니다. 레이블이 이미 로드된 상태라면 먼저 `--uninstall`을 실행하세요(§8).

쓰이는 위치:

| 산출물 | 경로 | 모드 |
|---|---|---|
| Plist | `~/Library/LaunchAgents/org.bizknights.co-newbiz.dev.tick.plist` | 0644 |
| 로그 디렉터리 | `~/Library/Logs/co-newbiz/` | 0700 |
| 표준 출력 로그 | `~/Library/Logs/co-newbiz/dev-tick.out.log` | 0600 |
| 표준 오류 로그 | `~/Library/Logs/co-newbiz/dev-tick.err.log` | 0600 |

그다음 잡 행을 시드하세요(§6) — 행이 없는 틱은 심박만 쓰고 끝납니다.

## 3. 설치 (prod)

운영 항목도 같은 macOS 호스트에 등록하지만, 틱은 `docker exec`로 **컨테이너 안에서** 실행됩니다(설계 §2.3): DB 작성자가 하나로 유지되고, 시크릿은 컨테이너 환경이 운반하며, 운영 SQLite 파일을 호스트에 마운트할 필요가 없습니다.

```bash
bun scripts/co-newbiz/scheduler-install.ts --env prod
```

설치 전에 수용할 사항:

- **`co-newbiz-web` 컨테이너가 떠 있어야 합니다.** 컨테이너가 내려가면 `docker exec`가 매분 실패하고, launchd가 `~/Library/Logs/co-newbiz/prod-tick.err.log`에 실패를 기록하며, 심박이 오래됩니다 → 높은 심각도 알림(§6). 이는 고장이 아니라 설계된 동작입니다 — 처방은 틱을 끄는 것이 아니라 컨테이너를 되살리는 것(`bun scripts/deploy-web.ts`)입니다.
- **컨테이너 환경 설정은 필요 없습니다.** `docker exec`는 launchd 잡의 환경을 컨테이너 안으로 전달하지 않으므로, 설치기가 실행 환경을 exec 자체에 주입합니다 — prod `ProgramArguments`가 `docker exec` 안에 `-e CO_NEWBIZ_SCHEDULER_ENV=prod`를 운반합니다(같은 플래그가 systemd `ExecStart`와 작업 스케줄러 `Arguments`에도 들어 있습니다). `bun scripts/co-newbiz/scheduler-install.ts --env prod --print`의 렌더링 결과:

  ```
  	<key>ProgramArguments</key>
  	<array>
  		<string>docker</string>
  		<string>exec</string>
  		<string>-e</string>
  		<string>CO_NEWBIZ_SCHEDULER_ENV=prod</string>
  		<string>co-newbiz-web</string>
  		<string>bun</string>
  		<string>scripts/co-newbiz/schedule-tick.ts</string>
  	</array>
  ```

- **운영 잡은 사용 켜진 상태로 시드되고, 개발 잡은 꺼진 상태로 시드됩니다**(소유자 결정 D3) — §6 참고.

## 4. 다른 OS 경로 (문서화됨, 자동 설치 아님)

설치기는 systemd(Linux)와 Windows 작업 스케줄러에도 같은 CLI를 지원하지만, 어느 쪽도 자동 부트스트랩하지 않습니다: 설치기는 파일을 쓰고 명령을 출력할 뿐 `systemctl`과 `schtasks`를 절대 실행하지 않습니다.

**systemd 사용자 타이머** — `--platform systemd`는 `ops/scheduler/systemd/co-newbiz-tick@.service`와 `.timer`를 `~/.config/systemd/user/`에 렌더링한 뒤 다음을 출력합니다:

```bash
systemctl --user daemon-reload
systemctl --user enable --now co-newbiz-tick@<env>.timer
```

타이머는 매분 실행됩니다(`OnCalendar=*-*-* *:*:00`, `Persistent=false` — 빠진 분은 틱 자체의 따라잡기 정책이 처리합니다, §7). 두 명령은 직접 실행하세요. 제거: `--uninstall`이 `systemctl --user disable --now co-newbiz-tick@<env>.timer` 명령을 출력하고 공용 템플릿 유닛을 제거합니다(두 환경 인스턴스가 모두 멈춥니다).

**Windows 작업 스케줄러** — `--platform schtasks`는 `ops/scheduler/schtasks/co-newbiz-tick.xml`의 렌더링 결과와 등록 명령을 출력합니다. 설치기를 실행한 기계에는 아무것도 쓰지 않습니다:

```
schtasks /Create /TN "co-newbiz-<env>-tick" /XML "<저장한-xml-경로>" /F
```

XML을 Windows 호스트의 파일로 저장하고 그 호스트에서 명령을 실행하세요. 작업은 매분 반복됩니다(`PT1M`, `StartWhenAvailable=true`). 제거(Windows 호스트): `schtasks /Delete /TN "co-newbiz-<env>-tick" /F`.

같은 주입이 systemd와 schtasks의 prod 변형에도 적용됩니다: 설치기가 `ExecStart` / `Arguments` 줄에 `-e CO_NEWBIZ_SCHEDULER_ENV=prod`를 넣으므로, 컨테이너 자체에는 환경 설정이 필요 없습니다.

## 5. 검증

### 5.1 launchd 등록

```bash
launchctl print gui/$UID/org.bizknights.co-newbiz.dev.tick
```

정상 출력에는 다음 핵심 줄이 있습니다(정확한 형식은 macOS 버전마다 다릅니다):

```
org.bizknights.co-newbiz.dev.tick => ...
	program = /Users/<you>/.bun/bin/bun
	arguments = (
		0: /Users/<you>/.bun/bin/bun
		1: scripts/co-newbiz/schedule-tick.ts
	)
	state = waiting
	run interval = 60000 milliseconds
	last exit code = 0 (no error)
```

실행 사이의 `state = waiting`은 정상입니다. 실행 후 `last exit code = 0`이면 틱이 깨끗하게 돌았다는 뜻이고, `could not find service`면 plist가 부트스트랩되지 않은 것입니다(§2 재실행). prod는 `prod.tick` 레이블을 씁니다.

### 5.2 심박

모든 틱은 **무엇보다 먼저** `schedule_heartbeat(env, last_tick_at)`을 갱신하므로, 이후에 실패해도 틱이 실행됐다는 사실은 남습니다(ADR-0189 결정 5). 3분보다 오래된 심박은 **높은 심각도** 알림입니다(설계 §6); 이후의 관리자 건강 배너도 같은 기준을 씁니다.

dev (호스트 DB):

```bash
sqlite3 db/data/co-newbiz.sqlite "SELECT env, last_tick_at, CAST((strftime('%s','now') - strftime('%s', last_tick_at)) / 60 AS INTEGER) AS minutes_ago FROM schedule_heartbeat;"
```

정상: `dev` 행 하나, `minutes_ago` 0 또는 1, 매분 갱신.

prod (컨테이너 안):

```bash
docker exec co-newbiz-web bun -e 'const { getDb } = await import("./db/client.ts"); console.log(getDb().query("SELECT env, last_tick_at FROM schedule_heartbeat").all())'
```

디스패처가 무엇을 판단하는지 보려면 틱을 손으로 실행하세요(분당 멱등 — 실행해도 안전):

```bash
CO_NEWBIZ_SCHEDULER_ENV=dev bun scripts/co-newbiz/schedule-tick.ts
```

JSON 요약(`env`, `tickAt`, `dispatched`, `skippedMissed`, `invalid`)을 출력하고 0으로 종료합니다. 종료 코드 2는 환경 변수 누락 또는 스케줄러 스키마(마이그레이션 0183) 미적용을 뜻합니다.

### 5.3 로그

| 파일 | 내용 |
|---|---|
| `~/Library/Logs/co-newbiz/<env>-tick.out.log` | 틱의 JSON 요약, 분당 한 줄 |
| `~/Library/Logs/co-newbiz/<env>-tick.err.log` | 틱 실패: 환경 거부, DB/스키마 오류, `docker exec` 실패(prod) |

쓸 만한 검색:

```bash
tail -20 ~/Library/Logs/co-newbiz/dev-tick.out.log
grep -c '"dispatched":\[\]' ~/Library/Logs/co-newbiz/dev-tick.out.log   # 아무것도 안 띄운 틱 수
tail -20 ~/Library/Logs/co-newbiz/dev-tick.err.log
```

틱 자체는 잡 작업을 하지 않으므로, 오류 로그가 깨끗하다고 잡이 성공한다는 뜻은 아닙니다 — 실행 결과는 `job_run`에서 확인하세요(§9).

## 6. 시드

`schedule_job` 행은 **꺼진 상태**로 만들어집니다(소유자 결정 D3) — 잡을 켜는 것은 별개의, 의도적인 관리자 행동입니다. 시드는 멱등입니다: 기존 행은 절대 건드리지 않으므로 관리자가 수정한 cron이나 사용 플래그가 덮어써지는 일이 없습니다.

두 경로 모두 등록된 모든 핸들러에 대해 같은 레지스트리 행을 씁니다:

**CLI (dev / 운영자):**

```bash
CO_NEWBIZ_SCHEDULER_ENV=dev bun scripts/co-newbiz/schedule-seed.ts --dry-run   # 미리보기: 쓰기 없음
CO_NEWBIZ_SCHEDULER_ENV=dev bun scripts/co-newbiz/schedule-seed.ts             # 없는 행만 삽입
```

출력은 JSON입니다: `{"env":"dev","dryRun":false,"inserted":[...],"existing":[...],"note":"rows are created disabled"}`. 특정 데이터베이스를 겨냥하려면 `--db-path <경로>`를 붙입니다.

**관리자 API (prod / 서버 DB):** `POST /api/admin/schedule-jobs/seed` (관리자 전용, 본문 `{"dryRun": true}` 선택). dry-run이 아닌 모든 호출은 감사 기록을 남깁니다(`schedule_job_seed`). 잡 활성화는 그 후 `/admin/schedule` 화면에서 합니다(또는 `PATCH /api/admin/schedule-jobs/[jobKey]`) — 시드 엔드포인트는 잡을 절대 켜지 않습니다.

어떤 행이 생기는지는 핸들러 레지스트리(`scripts/co-newbiz/jobs/index.ts`)가 정합니다: P2 시점 기준 `watch.evaluate`(30분마다)와 `gate_integrity.shadow_report`(월요일 08:00 KST). `collect.*`와 `retention.cleanup` 핸들러는 이후 단계(P5/P6)에 들어옵니다; 그 단계 이후 다시 시드하면 기존 행을 건드리지 않고 빠진 행만 추가됩니다.

잡이 예약 실행되려면 행이 **켜져** 있어야 합니다. 손으로 `run-job.ts`를 호출하면 꺼진 잡도 실행됩니다(`CO_NEWBIZ_SCHEDULER_ENV=dev bun scripts/co-newbiz/run-job.ts --job <job_key>`; 실행 주체 기본값 `operator:cli`) — "꺼짐"은 틱이 예약 실행하지 못하게 할 뿐 완전한 차단이 아닙니다.

## 7. 절전/깨어남 따라잡기

LaunchAgent는 호스트가 잘 들어 있는 동안 실행되지 않습니다. 깨어난 뒤 첫 틱에서 cron 분이 2분보다 과거인 실행은 **빠진 실행**으로 세고, 잡별 따라잡기 정책이 결정합니다(설계 §3.4, 소유자 결정 D7):

| 잡군 | 정책 | 절전 뒤 동작 |
|---|---|---|
| `watch.evaluate` | 건너뜀 | 빠진 실행은 실행 없이 소진; 다음 슬롯이 최대 30분 뒤 |
| 수집 / 보존 / 보고서 | 한 번 실행 | `trigger = 'catchup'`으로 따라잡기 한 번; `gate_integrity.shadow_report`는 빠진 실행에서 7일 이내일 때만 |

깨어난 뒤 확인 방법:

1. 깨어난 뒤 첫 틱 요약이 결과를 보여줍니다 — `"trigger":"catchup"`이 붙은 `dispatched` 항목과 `skippedMissed` 항목:

   ```bash
   tail -5 ~/Library/Logs/co-newbiz/dev-tick.out.log
   ```

2. 또는 감사 기록을 조회합니다:

   ```bash
   sqlite3 db/data/co-newbiz.sqlite "SELECT job_key, started_at, \"trigger\", status FROM job_run WHERE \"trigger\" = 'catchup' ORDER BY started_at DESC LIMIT 5;"
   ```

## 8. 제거

```bash
bun scripts/co-newbiz/scheduler-install.ts --env dev --uninstall
```

설치기는 레이블에 대해 `launchctl bootout gui/$UID`를 호출하고(최선 노력; 로드되지 않은 레이블은 제거를 실패시키지 않음) **그 환경의 plist만** 제거합니다. 다른 LaunchAgents는 절대 건드리지 않습니다. 원하면 먼저 `--dry-run`으로 계획을 보세요.

이것이 그 환경의 전체 정지 스위치입니다: 틱 없음 → 예약·수동 잡 실행 없음 → 3분 안에 심박 노후. `schedule_job` 행, `job_run` 이력, 관리자 화면은 그대로입니다. 한 호스트에 두 환경이 모두 등록되어 있다면 각각 제거하세요(`--env dev`, 이어서 `--env prod`).

systemd: `--uninstall`이 비활성 명령을 출력하고 공용 템플릿 유닛을 제거합니다. schtasks: `--uninstall`이 `schtasks /Delete` 명령을 출력합니다(Windows 호스트에서 실행).

## 9. 문제 해결

| 증상 | 가능한 원인 | 조치 |
|---|---|---|
| `launchctl print ... could not find service` | plist가 부트스트랩되지 않았거나 제거됨 | 설치기 재실행(§2/§3); `launchctl bootstrap`이 레이블이 이미 로드됐다고 보고하면 먼저 `--uninstall` |
| `launchctl print`에서 `last exit code`가 0이 아님 | 틱이 깨졌거나 실행을 거부 | `<env>-tick.err.log` 확인; prod에서 종료 코드 2와 `CO_NEWBIZ_SCHEDULER_ENV must be set` = 설치된 항목에 `-e CO_NEWBIZ_SCHEDULER_ENV=prod` exec 플래그가 없음 — `bun scripts/co-newbiz/scheduler-install.ts --env prod --print`로 확인한 뒤 `--uninstall`하고 재설치(§3) |
| `out.log`에 아무것도 없음, 새 실행 없음 | launchd가 아예 실행하지 않음 | plist 존재와 `launchctl print`의 `run interval = 60000` 확인; 로그아웃/로그인이 LaunchAgents를 다시 읽게 함; `err.log`의 spawn 오류 확인 |
| 심박 `minutes_ago` > 3 | 틱이 실행되지 않음(높은 심각도, §6) | 위 행들을 순서대로 점검; 심박은 틱이 실제로 끝났을 때만 움직임 |
| `err.log`에 `bun: command not found` | bun 이동/삭제; plist PATH는 설치 시점에 잡은 bun 디렉터리를 고정 | bun 바이너리를 복구한 뒤 `--uninstall` + 재설치로 PATH 재렌더링 |
| 잡 행이 가만히 있음, 심박은 정상 | 잡이 시드됐지만 켜지지 않음(D3) | `/admin/schedule`에서 활성화; `sqlite3 db/data/co-newbiz.sqlite "SELECT job_key, enabled, cron_expr FROM schedule_job;"`로 확인 |
| 잡이 실패하거나 시간 초과 | 핸들러 오류, 시간 초과, 비정상 종료 | `sqlite3 db/data/co-newbiz.sqlite "SELECT job_key, started_at, status, substr(COALESCE(error,''),1,200) FROM job_run WHERE env IS NOT NULL ORDER BY started_at DESC LIMIT 10;"` — `error`는 스크러빙됩니다(시크릿으로 보이는 텍스트 가림) 2 KB로 잘립니다; `status = 'timeout'`과 `error = 'timeout_or_crash'`는 프로세스가 죽고 다음 틱의 정리가 행을 닫았다는 뜻 |
| 같은 잡이 연속 3회 실패 | 반복 실패 | 설계 §6 기준 높은 심각도 알림; 다시 켜기 전에 원인(자격증명, 네트워크) 해소; API 키 누락은 `failed`가 아니라 `skipped`(`credential_missing`)로 끝남 |
| prod: 심박 노후, `prod-tick.err.log`에 `docker exec` 오류 | 컨테이너 중단 또는 재시작 | `docker ps`, 이어서 `bun scripts/deploy-web.ts`로 재배포; 틱을 끄지 마세요 — 컨테이너 중단 중 심박 노후는 설계된 알림입니다 |

전체 SRE 알림 세트(심박, 잡 지연, 연속 3회 실패)는 설계 §6에 있습니다. "지금 실행" 요청 경로(큐 등록 → 다음 틱 청구)는 웹 프로세스 안에서 잡을 절대 실행하지 않습니다(ADR-0019/ADR-0189).

## 10. 관련 문서

- `docs/runbooks/deployment.md` — 배포 파이프라인; §8이 prod 틱이 실행에 들어가는 운영 컨테이너를 다룹니다
- `docs/runbooks/rag-host-scheduler.md` — ADR-0189 이전의 호스트 수준 RAG 신선도 잡(이 틱과 독립)
- `docs/adr/0189-amend-adr-0019-launchd-and-docker-scheduler-model.md`, `docs/designs/2026-10-29-scheduled-jobs-design.md` — 결정 D1–D8과 설치기 계약
