# value-chain-linkage-analysis

> **`SKILL.md` 프론트매터에서 생성됨 (2026-08-28 per-skill README 표준, CONSTITUTION §6.2).** 자유롭게 보강하세요 — 이 파일은 자동 재생성되지 않습니다.

## 목적

`value_chain_link` 테이블의 전이율 계수를 통해 상류/하류 마진 및 수요 리스크 노출을 평가합니다 — `proxy_industry_chain`의 수요 추정 베타와는 의도적으로 별도 저장되며 공유 계수 참조가 없습니다. 두 질문에 대한 답이 다르며 공유될 경우 서로를 오염시키기 때문입니다(ADR-0025).

- **스코프(scope)**: `co-newbiz`
- **버전**: 1.1.0

## 사용 시점

- 위 목적에 해당하는 작업을 수행할 때 로드합니다 (`SKILL.md` 설명 참조).

## 사전 조건

none

## 사용 방법

```
<SKILL.md의 지시에 따라 호출 — 또는 플랫폼 스킬 레지스트리를 통해 AI 스킬로 로드>
```

권한 지침과 프론트매터는 [SKILL.md](SKILL.md)를 참조하세요.
