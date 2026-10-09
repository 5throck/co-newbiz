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
