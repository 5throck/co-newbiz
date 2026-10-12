---
lang: ko
lang_reason: source-material
counterpart: beta-series-collection.md
---

**대상**: 운영자, 딜 분석가
**책임**: backend-engineer
**화면**: /projects/[id]/wacc

## 목적

일별종가 시계열(코스피/코스닥 지수 + 주식회사/대상사 종가)은 WACC 베타 회귀 패널의 "수집 데이터 불러오기" 액션에 쓰입니다. `scripts/co-newbiz/beta-series.ts`로 수집하며 `newbiz fetch`와 같은 ensure_fresh 경로로 `fact_market_observation`에 적재됩니다.

## 스케줄링 스토리

로컬에서는 호스트 스케줄러가 돌지 않으므로 수집은 **수동**입니다(호스트 cron 확보 전까지 — 같은 패턴은 [rag-host-scheduler.md](rag-host-scheduler.md) 참고). 매월 한 번 이상 실행하세요. ensure_fresh 덕에 재실행은 캐시 히트라 과잉 수집은 API 할당량만 소모합니다.

```bash
bun scripts/co-newbiz/beta-series.ts --project <md_project.id>            # 최근 약 13개월
bun scripts/co-newbiz/beta-series.ts --project <id> --from 2025-10 --to 2026-10
```

단축코드가 자동 해석되지 않으면 `--ticker 회사명=058050`으로 지정할 수 있습니다. 해석된 단축코드는 `db/data/krx-stock-code-cache.json`에 캐시됩니다.

## 전제: KRX 서비스 승인

KRX 데이터 마켓플레이스 키에 6개 서비스(idx/kospi_dd_trd 등 6개)의 승인이 필요합니다. 미승인 상태에서는 모든 호출이 `respCode 401 — Unauthorized API Call`이고 스크립트는 관측 0건으로 종료합니다(재신청: 포털 마이페이지 → API 사용 신청). 승인 후 재실행하세요.

## 요청 방식: 서비스·평일마다 한 번 호출

KRX 일별 서비스는 모두 기준일 하나(`basDd=YYYYMMDD`)를 받아 그날의 모든 행(같은 계열의 모든 지수, 또는 그 시장의 모든 상장 종목)을 돌려줍니다. 기간 조회(`bgnDd`/`endDd`)는 지원되지 않으며, 보내면 HTTP 200에 빈 `OutBlock_1`이 옵니다. 요청·필드 이름은 2026-10-12에 실제 호출로 확인했습니다.

- 수집기는 달마다 평일을 하나씩 돌며(토·일과 미래 날짜는 건너뜀) 서비스를 하루 한 번씩 호출합니다. 동시 호출은 2개이고 호출 사이를 250ms 이상 띄우며, 네트워크 오류·5xx·호출 제한(403/429, 더 긴 대기)에는 한 번 다시 시도합니다.
- 하루치 응답은 (서비스, 날짜) 단위로 프로세스 안에 캐시되므로 코스닥 지수와 코스닥 상장사 시계열은 하루 한 번의 호출을 함께 씁니다.
- 평일인데 `OutBlock_1`이 비어 있으면 휴장일로 보고 건너뛰며 개수만 셉니다.
- 지수 행은 `IDX_NM`이 정확히 `코스피`/`코스닥`이고 `CLSPRC_IDX`가 숫자인 행만 고릅니다. `코스피 (외국주포함)`처럼 종가가 빈 행은 쓰지 않습니다. 종목 행은 `ISU_CD`(6자리 단축코드)로 고르고 종가는 `TDD_CLSPRC`입니다.
- 종목 기본정보(`sto/*_isu_base_info`)는 비어 있지 않은 가장 최근 평일의 `basDd`로 호출하고 `ISU_ABBRV`/`ISU_NM`을 정확히 일치 → 앞부분 일치 → 포함 순으로 맞춥니다. 후보가 여럿이면 짐작하지 않고 알립니다.

**호출량**: 대략 평일 수 × 서비스 수입니다. 13개월은 평일 약 280일이고 코스피 지수·코스닥 지수·종목 서비스 하나를 쓰면 약 850회, 여기에 회사마다 기본정보 호출 1~2회가 더해집니다. 실행당 기본 호출 한도는 2000회이며 `--budget N`으로 바꿀 수 있습니다. 스크립트는 호출 수, 캐시 적중 수, 빈 날짜 수를 출력합니다.

## 문제 해결

| 증상 | 뜻 | 조치 |
|---|---|---|
| 관측 0건, "every KRX payload was empty" | 잘못된 요청 인자(`basDd` 대신 기간) 또는 범위가 모두 휴장일 | 스크립트 버전 확인, `--from/--to` 넓히기 |
| `respCode 401 ... re-apply` | 키는 유효하나 서비스 미승인·만료 | 포털 마이페이지 → API 사용 신청에서 재신청 |
| 재시도 후에도 `HTTP 403`/`5xx`/시간 초과 | KRX 호출 제한(동시 4개에서 관찰) 또는 장애 | 기다렸다 재실행(재실행은 캐시 적중) |
| `not found in KOSDAQ master` / `ambiguous` | 회사 이름이 상장 약칭과 다름 | `--ticker 회사명=<6자리 코드>`로 지정 |
| `call budget exhausted` | 범위에 비해 한도가 작음 | `--budget` 올리거나 범위 줄이기 |
