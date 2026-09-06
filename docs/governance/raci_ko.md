---
lang: ko
lang_reason: source-material
counterpart: raci.md
---

# RACI — 스테이지 게이트 검토 프로세스

**Owner**: process-governance-manager
**Design of record**: design v1.0 §2-3 / `docs/governance/process-map.md`
**범례**: R = Responsible(작업 수행) · A = Accountable(의사결정 소유, 행당 1명) · C = Consulted(협의) · I = Informed(통보)

## 게이트 레벨 RACI

| 게이트 | Analyst | Entity IC | Group IC | process-governance-manager | compliance-officer | legal-counsel | risk-officer |
|---|---|---|---|---|---|---|---|
| Screening | R | I | — | C | I | C (인허가 경로) | C (Kill Criteria 사전 점검) |
| Pre-FS | R | I | — | C | I | C | C |
| FS | R | I | — | C | C (체크리스트 완전성) | C | C |
| DD | R | I | — | I | C | R (legal-risk register) | C |
| Entity IC | R (메모 작성) | A | I | I | C | C | C (Kill Criteria 점검) |
| Group IC | C (지원) | R (랭킹 입력) | A | I | I | I | C |

## 도메인 리드 RACI (횡단)

| 활동 | process-governance-manager | platform-lead | industry-lead | region-lead | PM |
|---|---|---|---|---|---|
| 프로시저 개정 | R | C | C | C | A |
| RAG 규칙/임계값 변경 | R | C | — | — | A |
| 시스템 스키마 변경 | C | R | — | — | A |
| 지역 프로필 갱신 | C | I | — | R | A |
| 산업 프로필 갱신 | C | I | R | — | A |
| ADR 작성 | C | C | C | C | A |

## 거버넌스 운영 RACI

| 활동 | compliance-officer | process-governance-manager | 도메인 리드 (해당 시) |
|---|---|---|---|
| 컴플라이언스 모니터링 | R | I | I |
| 워이버 승인 — 규제 레이어 | C | C | A = Group IC (표에는 미표시, 이 표 외부) |
| 워이버 승인 — 프로시저 레이어 | C | A | I |
| 워이버 승인 — 체크리스트 항목 | I | C | A |
| 해석(interpretation) 응답 | C | C | A (해당 문서의 `owner_agent`) |
| 거버넌스 KPI 보고 | R | A | I |

## 비고

- **Entity IC는 자체 게이트에 대해 Consulted가 아니라 Accountable이다** — 이것이 "각 엔터티는 그룹과 구조적으로 다른 질문을 가진다"(design §2-3)는 문구의 운영적 의미다. 그룹이 검토를 서두르더라도 Entity IC는 우회될 수 없다.
- **Group IC의 Accountable 역할은 예/아니오보다 랭킹 결정인 경우가 많다**(ADR-0029) — `group_agenda` 랭킹 입력에 대한 "R"은 실제로는 경쟁하는 각 엔터티에 있으며, 랭킹이 계산되는 비교 가능한 입력을 생산하는 주체가 엔터티이기 때문이다.
- Entity/Group IC 행 항목이 없는 게이트(Screening~DD)는 설계상 analyst/도메인 구조 외부에 Accountable 당사자가 없다 — 이들은 작업 레벨 게이트이지 의사결정 게이트가 아니며, 첫 의사결정 게이트는 Entity IC다.
- 이 표는 `docs/governance/process-map.md`와 `docs/manuals/business-manual.md`에서 중복 없이 참조된다 — 사본이 하나 더 있으면 서로 어긋난다.
