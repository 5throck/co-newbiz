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

## 앱에서 수집 ("수집 실행")

분석가는 WACC 베타 패널에서 같은 수집을 시작할 수 있습니다. 1단계 → 수집 데이터 → "수집 실행" 버튼(쓸 만한 수집 데이터가 없을 때 표시, 복사용 명령은 대체 수단으로 그대로 둠). 버튼은 `POST /api/projects/<id>/wacc/beta-series/collect`를 호출하고, 이 경로는 곧바로 `202`를 돌려준 뒤 웹 서버 안에서 `runBetaCollection`(`scripts/co-newbiz/beta-series-core.ts`, CLI와 같은 핵심 코드)을 실행합니다. 패널은 같은 경로를 `GET`으로 확인하다가 끝나면 상태와 데이터를 다시 불러옵니다. 처음 수집은 몇 분 걸립니다(서비스별·평일별 KRX 호출 1건씩, 기본 최근 13개월).

- 서버에 `KRX_API_KEY`가 있어야 하며(없으면 `503 krx_api_key_missing`), 프로젝트 구성원인 분석가 계정이어야 합니다(조회자 403, 비구성원·관리자 404).
- 프로젝트당 한 번에 하나(`409 already_running`), 서버 전체로도 한 번에 하나(`409 collection_busy`)만 실행됩니다. KRX 어댑터의 실행 상태가 프로세스 전체에서 공유되기 때문입니다.
- 실행마다 `job_run` 행(`job_key = beta-series.collect`, trigger `manual`, actor = 호출한 사용자)과 `audit_log` 항목 `beta_series.collect_requested`가 남습니다. 서버가 중간에 죽은 실행은 60분 뒤 정리 작업이 실패로 바꾸기 전까지 `running`으로 남으니, 그 뒤 다시 실행하세요(재실행은 캐시 히트).
- 수집 중 실패는 HTTP 오류가 아니라 실행 상태(`failed` + 사유)로 보입니다.

## 앱에서 ECOS 금리 수집 ("ECOS 금리 수집 실행")

WACC 참조값 카드는 ECOS 시계열 세 개를 수집하기 전까지 무위험이자율과 가산금리를 "가져오지 못한 항목"으로 알립니다. 세 시계열은 국고채 3년(ECOS `721Y001`, 항목 `5020000`), 회사채 3년 AA-(항목 `7020000`), 회사채 3년 BBB-(항목 `7030000`, ADR-0208: 등급별 가산금리 산정의 하단 기준점이며 없으면 AA- 값으로 대체됩니다)입니다. 분석가는 WACC 패널의 "ECOS 금리 수집 실행"으로 직접 수집할 수 있고, 끝나면 패널이 참조값을 다시 불러옵니다. 버튼은 `POST /api/projects/<id>/wacc/ecos/collect`를 호출합니다(베타 경로와 같은 방식: 곧바로 `202`, 패널이 `GET`으로 확인). 이 경로는 `fetch --source ecos`의 라이브러리로 세 시계열의 최근 12개월을 수집합니다.

- 서버에 `ECOS_API_KEY`가 있어야 하며(없으면 `503 ecos_api_key_missing`), 프로젝트 구성원인 분석가 계정이어야 합니다(조회자 403, 비구성원·관리자 404).
- ECOS 시계열은 시장 공통이라 실행 자리와 상태가 전역입니다. 한 번 도는 중에 다시 요청하면 `409 already_running`이고, `GET`은 최근 실행을 모든 구성원에게 보여 줍니다.
- 실행마다 `job_run` 행(trigger `manual`, actor = 호출한 사용자)과 `audit_log` 항목 `wacc_ecos.collect_requested`가 남습니다. 수집 중 실패는 HTTP 오류가 아니라 실행 상태(`failed` + 사유)로 보입니다.
- 공개 시험 키 `sample`은 요청당 10행으로 제한되어 12개월 수집에는 모자랍니다. 서버 키는 개인 ECOS 인증키여야 합니다.

## 앱에서 공시 신용등급 수집 (ADR-0208 2단계)

`credit_spread` 참조값은 대상 회사의 신용등급을 따릅니다. 등급은 먼저 DART에서 가져오며(`rating_source: "disclosed"`), 수집하기 전에는 기본값 `BBB-`와 사유 `rating_not_collected`, 수집 안내가 카드에 보이고 "모두 적용"은 이 행을 건너뜁니다. `POST /api/projects/<id>/wacc/credit-rating/collect`(후보 대상 회사는 `?target_id=<id>`)로 수집합니다. 곧바로 `202`가 오고, 화면은 `GET`으로 확인한 뒤 `GET .../wacc/suggestions`를 다시 불러옵니다. 이 조회는 저장된 값만 읽고 DART를 부르지 않습니다.

회사마다 한 번의 실행이 하는 일은 이렇습니다. (1) 최신 사업보고서를 찾습니다(저장된 `dart_disclosure` 목록이 먼저이고, 없거나 13개월보다 오래됐으면 유형 지정 `list.json` `pblntf_detail_ty=A001`). (2) 그 보고서를 `rcept_no`와 파서 버전마다 딱 한 번 내려받아 신용평가 항목과 채무증권 발행실적 표를 읽습니다. (3) OpenDART `bdRs.json`(공모만 해당)에서 최근 18개월 증권신고서의 `cdrt_int` 등급을 보충합니다. 결과는 바꿀 수 없는 `dart_credit_rating_snapshot` 행(마이그레이션 0200) 하나씩으로 남습니다.

- 서버에 `DART_API_KEY`가 있어야 하며(없으면 `503 dart_api_key_missing`), 프로젝트 구성원인 분석가여야 하고(조회자 403, 비구성원·관리자 404), 회사에 DART 고유번호가 있어야 합니다(없으면 `400 no_dart_corp_code`, 회사가 없으면 `400 no_subject_company`).
- 프로젝트당 하나, 회사당 하나만 동시에 실행됩니다(`409 already_running`). DART 근거는 프로젝트 사이에 공유됩니다.
- 실행마다 `job_run` 행(`job_key = wacc-credit-rating.collect`, trigger `manual`, actor = 호출한 사용자)과 `audit_log` 항목 `wacc_credit_rating.collect_requested`가 남습니다. 실패는 HTTP 오류가 아니라 실행 상태(`failed` + 사유)로 보입니다. DART 단계가 모두 실패했을 때만 실행이 실패하고, 일부만 실패하면 성공한 실행에 `warnings`로 남습니다.
- 결과 읽는 법: `report_status`는 기록된 해석 상태입니다. 등급이 없다고 "무등급"으로 읽지 않습니다. `not_disclosed`(공시가 해당 없음이라 적음), `section_present_no_bond_rating`(예: 기업어음 등급뿐), `section_absent`, `parse_failed`(서식 변경: 파서 수정 요청)는 모두 기본 등급을 남기고 `disclosed_status`가 이유를 알려 줍니다. 일시적인 내려받기 실패는 아무것도 쓰지 않으므로 다음 실행이 다시 시도합니다.
- 파서 버전(`CREDIT_RATING_PARSER_VERSION`)을 올리면 공시마다 한 번씩 다시 읽고, 이전 버전의 저장분은 조회에서 무시합니다.
- 마이그레이션 0200을 되돌리면 저장분만 지워지며 DART에서 다시 받을 수 있습니다.

## 지수 선택 (상장시장 기준)

베타 회귀는 기본적으로 종목의 **상장시장 지수**와 짝지어 계산합니다. 코스닥 상장사(예: 로보티즈 108490, 레인보우로보틱스 277810)는 코스닥 지수, 코스피 상장사는 코스피 지수와 회귀합니다. 다른 지수도 패널의 "시장 지수" 선택 상자("수집 데이터 불러오기" 옆)나 `GET .../wacc/beta-series?index=KOSPI|KOSDAQ`로 고를 수 있습니다.

- 수집기는 해석한 단축코드와 상장시장을 DB 원천 계층(`raw_payload`, id `krx:stock-master:<md_company.id>`)에 기록하고 웹 경로는 여기서 읽습니다(로컬 `krx-stock-code-cache.json`은 웹 앱에서 보이지 않습니다).
- 상장시장 기록이 없으면(이 기록이 생기기 전에 수집한 경우) 예전처럼 코스피를 기본으로 씁니다.
- 기본 지수에 수집 데이터가 없고 다른 지수에는 있으면 그쪽으로 바꾸고 `hint_code: index_fallback`으로 알립니다. 빈 시계열과 몰래 짝짓지 않습니다.

v1.2.0 이전에 수집한 회사는 한 번만 아래를 실행해 상장시장을 채웁니다(여러 번 실행해도 같은 결과, KRX 호출 없음, API 키 불필요 — 로컬 캐시만 읽음):

```bash
bun scripts/co-newbiz/beta-series.ts --project <md_project.id> --backfill-market
```

## 전제: KRX 서비스 승인

KRX 데이터 마켓플레이스 키에 6개 서비스(idx/kospi_dd_trd 등 6개)의 승인이 필요합니다. 미승인 상태에서는 모든 호출이 `respCode 401 — Unauthorized API Call`이고 스크립트는 관측 0건으로 종료합니다(재신청: 포털 마이페이지 → API 사용 신청). 승인 후 재실행하세요.

## 요청 방식: 서비스·평일마다 한 번 호출

KRX 일별 서비스는 모두 기준일 하나(`basDd=YYYYMMDD`)를 받아 그날의 모든 행(같은 계열의 모든 지수, 또는 그 시장의 모든 상장 종목)을 돌려줍니다. 기간 조회(`bgnDd`/`endDd`)는 지원되지 않으며 보내면 HTTP 200에 빈 `OutBlock_1`이 옵니다. 요청·필드 이름은 2026-10-12에 실제 호출로 확인했습니다.

- 수집기는 달마다 평일을 하나씩 돌며(토·일과 미래 날짜는 건너뜀) 서비스를 하루 한 번씩 호출합니다. 동시 호출은 2개이고 호출 사이를 250ms 이상 띄우며 네트워크 오류·5xx·호출 제한(403/429, 더 긴 대기)에는 한 번 다시 시도합니다.
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
