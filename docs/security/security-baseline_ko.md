---
lang: ko
lang_reason: source-material
counterpart: security-baseline.md
---

# 보안 베이스라인 — co-newbiz

**Owner**: security-engineer
**Design of record**: design v1.0 §4-12 (task 4.5), `docs/security/security-model.md`
**Status**: Stage 5 — 실행 가능하며 최초 실행된 Wave 5.9. §1의 주간 의존성/시크릿 스캔(`gitleaks detect`, 98개 커밋에서 유출 0건)과 §1의 분기 위협 모델 갱신(`docs/security/security-model.md` §8, Wave 5.7A까지의 모든 스키마/API 변경에 대해 재점검)은 이번 웨이브에서 의도로만 문서화된 것이 아니라 실제로 실행되었습니다. 남은 Stage-5 표시 행들(월간/연간 주기 항목, 스케줄러 의존)은 `docs/governance/ops-cadence.md`에 따라 자체 캘린더에 따라 활성화되며 아직 첫 실제 실행 시기가 되지 않았습니다.

## 1. 반복 주기 (`docs/governance/ops-cadence.md` §1의 테이블 구조 재사용)

| 주기 | 작업 | Owner |
|---|---|---|
| 주간 | 의존성 취약점 스캔(`security-scan` 스킬), 시크릿 스캔(gitleaks), 오탐 알림 검토 | security-engineer |
| 월간 | 접근 권한 검토(누가 어느 프로젝트의 멤버인지, 여전히 정당한지) | security-engineer, compliance-officer |
| 분기 | 위협 모델 갱신(`docs/security/security-model.md`의 STRIDE 매트릭스를 마지막 검토 이후 스키마/API 변경에 대해 재점검), DR 훈련 | security-engineer, platform-lead |
| 의존성 버전업 시 | 머지 전 CVE 확인 | release-engineer |
| §9 테이블을 건드리는 스키마 변경 시(`docs/architecture/db-schema.md`) | 머지 전 보안 검토 필수 — 특히 정보 보호 테이블은 선택 사항이 아님 | security-engineer + data-architect 공동 서명 |

## 2. 배포 전 게이트

- `security-scan` — 진행을 위해 Critical 발견 사항 0건 필요(설계 §12 검증 항목).
- `stride-threat-matrix` — 신뢰 경계를 건드리는 변경 시 `docs/security/security-model.md` §2의 STRIDE 매트릭스에 대해 재실행.
- `sarif-exporter` — 발견 사항을 SARIF로 내보내 추적.
- 시크릿: API 키는 절대 커밋하지 않음; `.env`/`.env.sample` 분리는 워크스페이스의 기존 pre-commit 훅으로 시행.

## 3. 취약점 관리

- 의존성 업데이트는 워크스페이스의 `update-bun-packages` 도구로 추적되며 위의 주간 주기로 적용.
- 패치가 없는 Critical/High CVE는 security-engineer의 즉각적인 리스크 수용 결정을 유발하며, 기록됩니다(조용히 연기되지 않음).

## 4. 접근 통제 검토

- 월간: 모든 활성 `project_member` 행을 해당 인원이 여전히 활성 필요를 갖는지와 교차 확인 — 오래된 멤버십은 수동 만료를 기다리지 않고 철회.
- `wall_group` 배정은 지속적 적합성을 검토(예: 이후 해소된 이해충돌).
- 관리자 역할 보유자 목록은 분기별 검토 — 관리자 수는 기본적으로 증가하는 것이 아니라 설계상 최소로 유지되어야 함.

## 5. 사고 대응

1. `sre`가 심각도를 분류·결정(`docs/governance/ops-cadence.md` 컨텍스트에서 재사용 — 사고 대응은 운영 및 보안 사안 모두에 걸치기 때문).
2. 사고가 `mnpi_flag=true` 프로젝트와 관련된 경우, `data_access_log`와 `insider_list` 기록이 사고 기록의 일부가 됨 — 나중에 덧붙이는 것이 아님.
3. 프로덕션 보안 사고에는 사후 분석이 필수이며, 결과는 분기 위협 모델 갱신에 반영.
4. 감사 로그 무결성에 영향을 주는 보안 사고는(append-only 시행을 고려하면 드물겠지만) 로그가 시스템 책임성의 근간이라는 점에서 기본적으로 Critical 심각도로 취급.

## 6. 웹훅 및 아웃바운드 페이로드 검토

- 웹훅 페이로드(RAG 전환 알림, 배치 실패 알림)를 검토하여 민감한 재무 수치나 보상 데이터가 포함되지 않도록 함 — 요약 수준 콘텐츠만 허용, 상세는 인증된 후속 API 호출로 확인.

## 7. 관련 문서

- `docs/security/security-model.md` — 이 베이스라인이 운영적으로 유지하는 위협 모델
- `docs/governance/ops-cadence.md` — 이 베이스라인의 주기가 포함된 더 넓은 운영 리듬
