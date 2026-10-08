---
lang: ko
lang_reason: source-material
counterpart: rag-host-scheduler.md
---

# 운영 절차서 — RAG 신선도 재산출 (호스트 스케줄러 인계)

담당: infra-automation-engineer. 대상: 운영자. Wave F-5 (설계 `2026-10-08-wave-f-process-closure` §5).

## 목적

웹 앱은 RAG 제안 등급을 필요할 때 다시 계산합니다: IC 게이트의 진행 브리프를 만들 때와 IC 패키지를 읽을 때마다 (`db/lib/rag-service.ts` `recomputeRag`). 아무도 열지 않은 프로젝트는 오래된 제안이 그대로 남습니다. 운영 컨테이너에는 의도적으로 스케줄러가 없으므로, 신선도 점검은 호스트에서 실행합니다.

## 실행 명령

```
bun scripts/co-newbiz/rag.ts --stale [--db-path <경로>]
```

모든 프로젝트를 돌며 `recomputeRag(..., "stale_read")`를 호출합니다. 입력이 바뀌지 않았으면 아무것도 쓰지 않고 `unchanged`로 보고합니다. 실행 주체는 `cli:watch-cycle`(계정이 아닌 표식)입니다.

## 권장 주기

하루 한 번(예: 오전 6시). 등급 유지 기간이 7일이라 더 자주 돌려도 얻는 정보가 없습니다.

## 확인 기준

1. 데이터베이스 사본에 한 번 실행해 `error`가 없는지 확인합니다.
2. 두 번째 실행에서 `unchanged`/`nothing_to_assess`만 나오는지 확인합니다.
3. `gate_decision`·`approval`·`venture_transition_decision`에 기록이 생기지 않았는지 확인합니다 (이 작업은 등급을 제안만 합니다).

## 경계

등급은 제안입니다. 데이터 신뢰도가 상한을 정합니다. 평가가 미완이면 종합 등급이 없고 화면에는 "미산정"으로 표시됩니다.
