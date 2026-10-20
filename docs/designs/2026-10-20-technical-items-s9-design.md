---
lang: ko
lang_reason: source-material
---

# S8 기술적 타당성 T2~T5 — S9 판정 기록·S8 탭 반영 설계 (Implemented)

- **일자**: 2026-10-20
- **상태**: Implemented (2026-10-20 — 마이그레이션 0157, `technical-items` 라우트, S9 기술 탭 기록 블록, S8 T1~T6 탭화, 렌즈 파생·T6 짝 검증 진행도, 소스 가드 테스트)
- **원 질의**: decider round 4 — "해당 내용은 S9로 이동해서 통합되어야 하는 내용이 아닐까", "T1~T6가 S8에 탭 형태로 볼 수 있어야"
- **관련**: ADR-0169 (S8 기술·재무 렌즈), 2026-10-14-s8-technical-financial-lens, 2026-10-19-brownfield-capability-dd-design (같은 사이드카 패턴)

## 1. 문제

S8 기술적 타당성 렌즈(ADR-0169 release 1)는 T2 기술 성숙도(TRL)·T3 핵심 인력·설비·시설·T4 지식재산·라이선스·T5 인허가·인증을 "다음 릴리스에서 입력 기능이 열립니다"로 비워 두었다. 이 항목들의 근거(실측·설비 잔존·IP 검색·인허가 현황)는 모두 S9 실사·검증의 영역이므로, S8에서 따로 판정 입력을 열면 같은 사실을 두 단계에서 이중 기록하게 된다 — 필요 역량 판정을 S9 capability-dd로 옮긴 것과 같은 문제다.

## 2. 결정

- **판정 주전장은 S9.** S9 기술 실사 탭 하단에 "S8 기술 항목 판정 (T2~T5)" 블록을 두고, 사람(analyst+)이 항목별 충족/주의/미충족 + 근거(조사내역 인용)를 기록한다. 라우트 `GET/PUT /api/projects/{id}/technical-items`, 감사 `technical_item.recorded`, 경계 #2(에이전트 기록 불가).
- **저장은 사이드카.** `opportunity.technical_item_verdicts_json`(마이그레이션 0157) — 렌즈 JSON(`capability_gap_json`)과 분리되어 S3 재저장·무효화 연쇄와 무관. 항목 키당 최신 1건.
- **S8은 파생 반영.** `summarizeTechnicalLens`가 S9 판정을 읽어 T2~T5를 derived·judged로 만든다. 경고 전용 렌즈이므로 미충족도 스트립에서는 주의로 표시하고 노트에 실제 판정·기록자·근거를 싣는다. 판정이 없으면 "S9 실사·검증 — 기술 탭에서 판정을 기록하세요"로 안내한다.
- **T6 = 짝 검증 진행도.** T2~T5 네 항목 모두에 S9 판정이 있을 때 T6가 판정됨(충족)으로 바뀌고, 그 전까지 `S9 판정 N/4 기록됨`을 보여준다. 기존 verification 불일치 카운트(`mismatchCount`)는 유지.
- **S8 UI는 T1~T6 탭.** `TechnicalLensPanel`이 6개 항목을 tablist로 렌더한다 — T1 탭은 필요 역량 달성 가능성 패널(통합 5열 표), T2~T5 탭은 S9 파생 판정 뷰 + S9 기술 탭 링크, T6 탭은 항목별 S9 근거 목록.

## 3. 범위 밖

- T2~T5 판정의 AI 초안 제안(사람 검토 후 기록) — 후속.
- 조사내역(dd_finding) 구조화 참조(현재는 근거 노트에 텍스트 인용).
- 그린필드 S5 기술 항목 — S5는 역량 판정만 다루며 T2~T5는 트랙 공통으로 S9에서 기록한다.

## 4. 검증

- 유닛: `technical-item-verdicts.test.ts`(lib 규칙·렌즈 파생·T6 진행도·소스 가드), `technical-lens.test.ts` 핀 갱신, `openapi.test.ts`.
- 브라우저(브라운필드 프로젝트): S9 기술 탭 블록 4행 렌더 → T2 충족 기록 → S8 기술 탭 6개 탭, T2 "✓ 충족 · S9 판정 (충족) — 기록자·일시·근거", T6 "S9 판정 1/4 기록됨".
