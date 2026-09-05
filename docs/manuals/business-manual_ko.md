---
sync_version: 1
translated_from_hash: PLACEHOLDER
lang: ko
lang_reason: source-material
---

# 비즈니스 매뉴얼 — analyst와 위원회 심사자

> **언어**: [English](business-manual.md) · **한국어**

**독자**: analyst, Entity IC / Group IC reviewer
**대상 아님**: 시스템 운영자(`operations-manual.md` 참조) 및 시스템 관리자(`admin-manual.md` 참조) — 이 분리는 의도된 것이다. 세 매뉴얼을 하나로 합치면 아무도 끝까지 읽지 않게 된다(design 10.5절).

## 이 매뉴얼이 다루는 것

각 게이트에서 무엇을 해야 하는지, 체크리스트를 어떻게 읽는지, 산출물이 어디로 가는지, 그리고 RAG 등급과 Kill Criteria 판정 결과를 어떻게 해석하는지.

## 1. 게이트별 역할

권위 있는 산출물/승인자/RACI 표는 `docs/governance/process-map.md`를 참조할 것. 요약하면:

| 게이트 | analyst인 경우 | IC reviewer인 경우 |
|---|---|---|
| Screening | 초기 산출물 작성(후보지 숏리스트 또는 타깃 롱리스트) | 아직 참여하지 않음 |
| Pre-FS | 딜 스폰서와 함께 WACC/hurdle IRR 입력값 확정 | 아직 참여하지 않음 |
| FS | 밸류에이션과 성장 전망 완료, (BF) 6검증자 교차검증 개시 | 아직 참여하지 않음 |
| DD | 모든 DD 발견사항을 `value_impact`(정수, 단위 = KRW 백만원 — ADR-0061)와 함께 `dd_finding`으로 착지 — 발견사항을 서술로만 남기지 말 것 | 아직 참여하지 않음 |
| (S10 투자구조 설계 — DD와 Entity IC 사이) | 투자구조 가설(비히클: SPC 포함)·4축 검토(절세·책임격리·레버리지·엑싯)를 기록하고 완료 처리하며, 자금조달 sources & uses를 균형시킨다 (ADR-0106). 완료되지 않으면 S11로 진행 불가 | 아직 참여하지 않음 — IC가 심의하는 구조는 이 단계의 산출물 |
| Entity IC | IC 메모 준비(템플릿 참조) | 검토하고, AI가 제안한 RAG 등급을 확인 또는 정정 — **정정하는 경우 사유를 붙인다** — 승인/거절/추가 작업 요청 |
| Group IC | 요청받으면 랭킹 논의 지원 | 이 제안을 동시 진행 중인 `group_agenda` 항목들과 비교해 랭킹; 승인/거절/**조건부** 결정 |

## 2. 체크리스트 읽는 법

체크리스트는 필수 항목과 권장 항목이 섞여 있다(항목별 `mandatory: true/false` — `checklists/*.yaml` 참조). 필수 항목은 활성 waiver가 없으면 게이트를 막는다. 권장 항목의 부재는 waiver가 아니라 사유 진술만 있으면 충분하다.

## 3. RAG 등급 읽는 법

- **종합 색상 하나를 표면값으로 받아들이지 말 것** — 6차원 세부내역을 읽을 것. 종합 Green은 data confidence를 포함해 *6개 차원 전부*가 Green일 때만 나온다.
- **data confidence가 전체를 제한한다.** 종합 Amber인데 재무 차원이 강하게 보이면 data confidence부터 확인할 것 — B등급 proxy chain은 숫자가 아무리 좋아 보여도 전체 평가를 Amber로 제한한다.
- **rationale 행은 색상이 아니라 어떤 rule이 발화했는지를 알려준다.** 그렇지 않다면 결함이다 — 플래그하라.
- **Amber 등급은 무엇을 하면 등급이 올라가는지 말해줘야 한다.** "Data confidence B"는 실행 가능한 정보가 아니다. "A에 도달하려면 직접 출하 데이터를 확인하라"가 실행 가능한 정보다.

## 4. Kill Criteria

Kill Criteria 적중은 프로젝트를 정지시킨다. 권고 사항이 아니다. 구속력 있는 목록은 `policies/group/neb-policy.md` §4를 참조할 것. 하나를 무시하려면 명시적인 Group IC 결정이 필요하다 — 어느 analyst도, 어느 단일 reviewer도 Kill Criteria를 일방적으로 면제할 수 없다.

## 5. 산출물이 가는 곳

- IC 메모: `templates/deliverables/ic-memo-template.md` — Stage 4/5에서 시스템이 착지하면 산출물 출력 폴더 구조를 함께 참조.
- DD 발견사항: 해당하는 `dd_finding` 스키마에 기록하고 `assumption_key`에 연결.
- 회의 결과: `memory/meeting-*.md`, 액션 아이템은 설계의 명시적 규칙에 따라 라우팅 — 소유자와 착지 위치 없는 액션 아이템은 존재하지 않는다.

## 6. Brown Field 특수 주제 — 평가 순서

미팅 M5에 따라, 밸류에이션을 조립할 때 6개 필수 검증자는 다음 순서로 확정한다: (1) antitrust + HR 통합의 현금흐름 일정 효과, (2) 고객 유지 + 인센티브 수익/비용 빌드, (3) 인증 이전가능성은 **마지막**. 이전 불가능한 인증은 인수 프리미엄 전체를 걷어낼 수 있으므로, 그 인증을 이미 전제한 밸류에이션에 대고 계산되어서는 안 된다.
