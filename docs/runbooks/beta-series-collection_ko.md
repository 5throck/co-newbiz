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

## 이자보상배율 추정과 재무 다시 동기화 (ADR-0208 3단계)

회사에 최신 공시 회사채 등급도, 최신 신용조사기관 등급도 없으면 `credit_spread` 참조값은 **추정** 등급(`rating_source: "synthetic"`, 칩 "이자보상배율 추정")을 씁니다. 이자보상배율 = 영업이익과 이자비용이 모두 있는 가장 최근 사업연도의 영업이익 ÷ 이자비용이고, `region-profiles/KR.yaml`(`credit_rating_references.synthetic`)의 공표 등급표로 등급을 정합니다. 신용평가사가 부여한 등급이 아닌 추정치라서 "모두 적용"에는 포함되지 않고(`credit_rating_synthetic_basis`), 행에서 개별로 적용합니다. 같은 값으로 차입비용 점검도 합니다(실효이자율 = 이자비용 ÷ 이자 붙는 차입금의 평균을 시장 Kd와 비교). 경고만 하고 숫자를 바꾸지 않습니다.

입력은 수집기가 전에는 읽지 않던 DART 계정입니다. 이자비용(`dart_AdjustmentsForInterestExpenses` / `ifrs-full_InterestExpense`), 금융비용, 이자지급(두 줄), 세전이익, 차입금 항목이며 마이그레이션 `0201_md_account_interest_debt.sql`이 계정을 만듭니다. **이번 배포 전에 재무를 동기화한 회사에는 이 값이 하나도 없어** 카드가 기본 등급과 `synthetic_interest_not_collected`를 보이고, "참조 데이터 수집" 영역에 "재무 데이터" 행과 **재무 동기화 실행** 버튼이 나타납니다(기존 `POST /api/companies/<id>/sync`를 부릅니다).

배포 뒤 한 번만 하는 다시 동기화:

1. 마이그레이션 0201을 먼저 적용합니다(마이그레이션이 수집기 배포보다 앞, ADR-0014). 다른 마이그레이션처럼 데이터베이스를 백업하고, 되돌릴 때는 파일 안의 `ROLLBACK-SQL` 블록을 씁니다(새 계정과 그 계정의 값만 지웁니다).
2. 마이그레이션이 `dart_corp_sync_state.financial_checked_at`을 비웁니다. 그래서 다음 **증분** 동기화(ADR-0199, S6 일괄 평가)가 동기화된 모든 회사의 최신 사업연도를 다시 받아 새 계정을 채웁니다. 증분 동기화는 이미 닫힌 이전 연도를 다시 받지 않습니다.
3. **수동** 회사 동기화(`POST /api/companies/<id>/sync`, 회사 화면의 "DART 재무 동기화" 버튼과 WACC 패널의 새 행)는 언제나 5개 연도를 받아 모든 연도를 채웁니다. 지금 가치평가하는 회사에는 이 방법을 쓰세요. 차입비용 점검은 2개 연도의 차입금 잔액 평균이 필요합니다(한 해뿐이면 기말 잔액을 쓰고 그렇게 표시합니다).
4. 건너뛰어도 잃는 것은 없습니다. 새 계정이 없는 회사는 기본 등급과 다시 동기화 안내를 유지하고, 법정세율 제안은 세전이익이 저장되기 전까지 영업이익을 쓰다가 저장되면 세전이익을 우선합니다.

결과 읽는 법: `synthetic.reason_code`가 추정이 없는 이유를 말합니다. `synthetic_interest_not_collected`(다시 동기화), `synthetic_no_interest_expense`(최근 연도에 이자 없음), `synthetic_no_financials`, `synthetic_not_applicable_financial`(은행·보험 등, 등록부 규칙 `synthetic.financial_sector`가 회사 이름으로 판별). 이자 우선순위는 이자비용, 이자지급(영업+재무활동 합계), 금융비용(이자보다 크게 잡히는 대용치) 순입니다. 점검이 없는 이유는 `crosscheck_unavailable_*`와 `crosscheck_unreliable_non_positive_debt`. `crosscheck_implied_far_below_market` 경고는 실제 차입비용이 시장 Kd보다 크게 낮다는 뜻입니다(정책금융·저리 차입 여부 확인). 실효이자율이 무위험수익률보다 낮을 때도 같은 기준으로 경고합니다입니다.

## 금융투자협회 등급별 수익률: 자동 수집은 기본 꺼짐 (ADR-0208 4단계)

신용 가산금리는 ECOS의 두 기준점 사이를 보간하는 대신, 금융투자협회(KOFIA)가 공표하는 신용등급별 회사채 수익률
(`kofiabond.or.kr`, 시가평가 > 채권시가평가수익률 > 일자별, 채권평가사 평균, 공모 무보증 회사채 AAA~BBB−, 3년 구간)로
바로 계산할 수 있다. 이때 제안의 `spread_basis`는 `"kofia_grade"`이고 칩은 "등급별 수익률(금융투자협회)"이다. 가산금리 =
그 등급의 3년 수익률 − **같은 날짜**의 금투협 국고채 3년 수익률이며, 보간하지 않는다. 제안의 무위험이자율은 그대로 ECOS 값이다.

**잠금 장치.** 금투협은 이 자료의 API를 공개하지 않았고 자동 수집을 허용한다고 확인해 주지도 않았다(설계 4.1절: 약관에서
관련 조항을 찾지 못함, `robots.txt` 없음, 2022-08-05 문의 답변은 이 수익률이 단순 참고용이며 책임지지 않는다고만 밝히고 자동화·재배포에는
말이 없음). 그래서 다음을 지킨다.

- 자동 수집은 저장소 루트 `.env`에 **`CO_NEWBIZ_KOFIA_COLLECT=on`** 일 때만 돈다(바꾼 뒤 서버를 다시 시작). 기본값과 그 밖의 모든 값은
  **꺼짐**이다. 금투협이 이 수익률의 자동 수집을 허용한다고 **서면으로** 확인해 줄 때까지 꺼 둔다. 켜기 전에 그 확인서를 ADR-0208 기록과 함께 보관한다.
- 꺼짐: `POST /api/projects/<id>/wacc/kofia/collect`는 `503 kofia_collect_disabled`로 답하고(실행 기록·감사 기록·네트워크 호출 없음), 수집기도
  스스로 거절하며(스크립트나 시험이 실수로 가져오지 못함), WACC 화면의 "참조 데이터 수집"에는 금투협 행이 **보이지 않는다**.
  가산금리는 전과 같이 ECOS 방식으로 계산한다.
- 켜짐: 분석가는 "참조 데이터 수집"에서 "등급별 수익률" 행을 본다. 한 번 실행은 POST 세 번(최신 공표일, 열 머리, 그날 자료)이며 순서대로, 일반 클라이언트
  User-Agent로, 쿠키·로그인 없이 보낸다. 그날의 국고채 3년과 열 개 등급을 일 단위 관측값(`kofia:ktb:3y`,
  `kofia:corp-public-unsecured:<등급>:3y`, 출처 `kofia`, 단위 percent)으로 저장한다. 필요할 때마다 실행하면 되고(매번 가장 최근 하루), 같은 날을 다시
  돌리면 아무것도 쓰지 않는다. 실행마다 `job_run`(`wacc-kofia.collect`)과 감사 기록 `wacc_kofia.collect_requested`가 남는다.
- **저장된 자료는 스위치와 상관없이 항상 읽는다.** 스위치를 끄면 가져오기만 멈출 뿐 이미 모은 값을 감추지 않는다. 금투협 자료 사용 자체를 멈추려면 먼저
  결정(ADR)을 받고, 지우지는 않는다.

**정기 수집(자료가 들어오는 길)과 수동 버튼(보조).** 제안은 금투협 자료를 가져오지 않는다. `GET .../wacc/suggestions`는 저장된 관측값만 읽는다(아래 상태도
저장된 자료와 일정 행에서만 만든다). 저장소는 스케줄러 잡 **`collect.kofia`**(ADR-0019/ADR-0189, `docs/runbooks/scheduler_ko.md`)가 최신으로 유지하며, 기본은
**평일 18:45 KST**다(`collect.krx` 15분 뒤. 금투협은 공표 시각을 밝히지 않아, 그날 수익률이 18:30 KST부터 공표된다고 가정하고 더 늦게 공표되면 다음 날 실행이 따라잡는다).
cron은 관리자 일정 화면에서 바꾼다(OS 재등록 불필요).

- 같은 잠금 장치: `CO_NEWBIZ_KOFIA_COLLECT`가 `on`이 아니면 잡 실행은 **건너뜀(skipped)** 으로 끝나고(`job_run.detail_json`에 `kofia_collect_off`) 네트워크 호출이
  없다. 이 잡은 전용 핸들러이고 수집기는 일부러 `SOURCE_ADAPTERS`에 **넣지 않았으므로**, 일반 `fetch` / `md:sync` / `collect.*` 경로로는 금투협에 닿을 수 없다.
- 실행마다 서비스의 최신 공표일을 묻고(POST 1회), 그날이 이미 저장돼 있으면 거기서 멈춘다(공휴일 평일은 POST 1회). 아니면 그날을 가져와 저장하고(POST 3회),
  마지막 저장일 이후 최근 10일 이내에 빠진 영업일을 채운다(하루당 POST 2회, 최신부터. 행이 없는 날=공휴일은 건너뛰고, 실패한 날은 실행 상세에 남기고
  보충을 멈추되 실행을 실패시키지는 않는다). 하루치는 한 트랜잭션으로 저장하므로 그날은 온전히 들어가거나 아예 없다. 실행 상세에 `max_published_date`,
  `days_stored`, `days_already_stored`, `backfill_no_data`, `backfill_failed`가 남는다. 화면 구성이 바뀌면 실행이 실패하고(재시도 없음, `batch_failure` 알림),
  5xx·시간 초과는 재시도한다(최대 2회).
- **수동 버튼은 불필요하게 가져오지 않는다.** 저장 자료가 최신이면(마지막 저장일이 18:30 KST 공표가 지난 가장 최근 평일에 닿았거나, 그 시각 이후의 성공한 확인이
  더 새로운 것이 없음을 봤다면=공휴일 처리) 클릭은 `200 up_to_date`("이미 최신", 최신일 표시)로 답한다: 네트워크 호출·실행 기록·감사 기록 없음. 오래됐으면 분석가
  누구의 클릭이든 최신 하루를 수집한다(보충 없음). 프로젝트 경로에는 강제 옵션이 없다: 관리자는 프로젝트 경로에 접근할 수 없다(FR-SEC-03). 관리자는 관리자 일정
  화면에서 `collect.kofia`를 **지금 실행**해 다시 수집한다(수동 실행은 최신 하루를 다시 가져오며, 값이 같으면 쓰지 않고 다르면 새 개정으로 저장).
- 화면 행에는 마지막 저장일, 이 가산금리에 쓰였는지, **다음 정기 실행**(KST)이 보이고, 잡이 꺼져 있거나 아직 등록되지 않았다면 그렇게 보인다.

알려진 것과 모르는 것(2026-11-27 확인: 페이지 자체의 클라이언트 파일을 읽고 세 호출을 한 번씩 시험, 로그인 없음): 이 페이지는 문서화되지 않은 XML 서비스
하나를 부른다(`POST https://www.kofiabond.or.kr/proframeWeb/XMLSERVICES/`, 앱 `BIS-KOFIABOND`, 서비스 `BISBndSrtPrcSrchSO`, 기능
`getExistMaxDate`·`getHeadList`·`selectDay`). 응답에는 기대한 행이 있었다. **확인하지 못한 것**: 이 서비스가 계속 같은 모양일지(내부용이며 계약이 아님), 그리고
금투협이 자동화를 허락하는지 여부. 화면 구성이 바뀌면 실행은 **실패**하고(`not a service response`, `no 3-year column`, `no KTB row` 등) 아무것도 쓰지 않으며,
0으로 읽는 일은 없다. 그때는 새 응답으로 시험 자료(`tests/fixtures/kofia/`)를 만들어 파서(`db/lib/kofia-grade-yield.ts`, `KOFIA_PARSER_VERSION`)를 고친다.

결과 읽기: WACC 카드의 신용 행에 칩, 등급 수익률, 같은 날짜 국고채, 날짜, 금투협 페이지 링크가 보인다. 확정 감사 기록에는 인용한 월에서 서버가 다시 계산한 값으로
`spread_basis=kofia_grade`, `kofia_date=<날짜>`, `kofia_series=<id>`가 남는다. 금투협 자료는 같은 달이거나 더 오래된 ECOS 달보다 우선하고, 금투협 자료가 아직 따라오지
못한 더 최신 ECOS 달이 있으면 ECOS가 우선한다. 금투협이 공표하지 않는 등급(BB+ 이하)은 ECOS 방식으로 계산한다.

## 금융위 채권 교차 확인 (data.go.kr, ADR-0208 4단계)

WACC 카드의 신용 가산금리 옆에서 **유통 채권 조회**를 누르면 회사의 유통 중인 채권(표면이율, 만기, 잔액)과 잔액이 큰 다섯 개의 최근 시세 수익률을
data.go.kr 금융위원회 채권 API `금융위원회_채권기본정보`(`getBondBasiInfo_V2`)와 `금융위원회_채권시세정보`(`getBondPriceInfo_V2`)에서 가져와 보여 준다. 이것은
**참고 증거일 뿐**이다. 적용값이 아니고, "일괄 적용"에 들어가지 않으며, 저장하지 않고, 감사 기록의 입력도 아니다.
`GET /api/projects/<id>/wacc/bond-evidence`(선택 `?target_id=`).

- 키: `DATA_GO_KR_API_KEY`, 데이터셋마다 활용신청 한 번(둘 다 개발계정으로 승인됨, 2028-11-26 전에 연장, 등록부 `docs/runbooks/data-go-kr-datasets.yaml`). 키가 없으면
  `503 data_go_kr_api_key_missing`. `SERVICE_KEY_IS_NOT_REGISTERED_ERROR`(새 승인이 아직 반영되지 않았거나 승인 안 된 데이터셋)는 HTTP 오류가 **아니다**: 답은 `200`,
  `evidence.status: "unavailable"`, `reason_code: "service_key_not_registered"`이고 화면은 잠시 뒤 다시 조회하라고 알려 준다. 호출 한도 초과(`quota_exceeded`)와 승인 만료
  (`service_expired`)도 같은 방식으로 보인다.
- 키 모양: `.env`의 키는 **Encoding** 형태(퍼센트 이스케이프)다. 클라이언트는 한 번 풀고 한 번만 이스케이프한다. 이 키를 `curl --data-urlencode`나
  `URLSearchParams`에 그대로 넣으면 두 번 이스케이프되어, 키가 맞는데도 `SERVICE_KEY_IS_NOT_REGISTERED_ERROR`가 나온다.
- 발행사 찾기: **이름**으로 한다(`md_company.name_ko`, 회사 형태 단어와 띄어쓰기는 무시). `md_company`에는 10자리 사업자등록번호(`biz_reg_no`)만 있고 이 API가 쓰는 13자리
  법인등록번호(`crno`)는 없으며, `crno`만으로 조회하면 결과가 믿을 수 없다(30,422건이 돌아옴). 응답의 `crno`는 증거로 보여 주고, 같은 이름에 `crno`가 여럿이면
  `ambiguous_issuer`로 아무것도 보여 주지 않는다.
- 비용: 한 번 누를 때 기본정보 호출 한 번과 시세 조회 최대 다섯 번(시세 API에는 발행사 조건이 없고 거래가 있던 날만 나오며, 조회 구간은 12개월), 서버 안에서 15분 동안 보관한다. 개발계정은 호출량이
  제한된다.
- 이용 조건(공공누리): 기본정보는 **제2유형**(출처표시, 상업적 이용 금지, 상업적 이용은 한국예탁결제원과 계약), 시세정보는 **제4유형**(출처표시, 상업적 이용 금지, **변경 금지**,
  재배포 금지, 상업적 이용은 한국거래소에서 구매). 화면에는 두 데이터셋 링크와 함께 이 고지가 나오고, 시세 수익률은 게시된 값 그대로 거래일과 함께 보여 주며 저장·내보내기를 하지 않는다. 내부 가치평가 업무가
  "상업적 이용"인지는 법무 검토(설계 4.2절) 사항이며 여기서 정하지 않는다.
- 2026-11-27에 저장소 키로 실제 호출해 확인: 두 기능 모두 HTTP 200 / `resultCode 00`으로 답했고 필드 이름은 등록부 비고에 적었다. 확인하지 못한 것: 채권이 수천 건인 발행사의 동작(클라이언트는
  100건씩 최대 세 쪽만 읽음)과 쪽 나누기 순서 보장(보장을 가정하지 않음).

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
