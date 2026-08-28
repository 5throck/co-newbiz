---
sync_version: 1
translated_from_hash: PLACEHOLDER
lang: ko
lang_reason: source-material
---

# co-newbiz

> **언어**: [English](README.md) · **한국어**
> **상태**: 🔧 활발한 개발 중 — v1.0.0
> 신사업 검토(new-business-review) AI 팀이자 시스템. 신사업 개발의 규정·절차·가이드라인·체크리스트와 그 상시 운영을 소유하고(axis A), 이를 시스템으로 구현·유지하며(axis B), 그 위에서 실제 딜 리뷰를 수행한다(axis C). 직접 시장 데이터가 없는 산업을 위한 proxy-chain 수요 추정과 함께 Green Field(신설)와 Brown Field(M&A)를 다룬다.

## 개요

`co-newbiz`는 신사업 검토 — Green Field(신설)와 Brown Field(M&A) — 를 위한 AI 에이전트 팀이자 시스템이다. 신사업 개발의 거버넌스(규정, 절차, 가이드라인, 체크리스트 — axis A)를 소유하고, 그 거버넌스를 시스템으로 구현·유지하며(axis B), 양자 위에서 실제 딜 리뷰를 수행한다(axis C). 이 팀의 시그니처 역량은 직접 시장 데이터가 없는 산업을 위한 proxy-chain 수요 추정이다(예: 크랭크축 → 선박용 엔진 → 선박, CGT/BHP/ton 단위환산 포함). 여기서 나오는 data-confidence 등급이 모든 하류 RAG 평가의 상한을 제한한다.

전체 아키텍처와 표준은 [docs/context.md](docs/context.md)를 참고하세요.

## 저장소 구조

```
co-newbiz/
  agents/            도메인 에이전트(기능, 기술, 산업, 지역) + _core/_shared
  policies/          그룹 및 개별 법인(entity) 수준 규정
  procedures/        references: + overrides를 갖춘 shared/entity/region/group 절차
  guidelines/        권장 등급(tier) 실무 문서
  checklists/        게이트 체크리스트, 항목 단위 mandatory:true/false
  templates/         산출물 템플릿(IC 메모 등)
  glossary/          비즈니스/재무/법무/기술/산업 용어 집합
  region-profiles/   지역별 규제·인센티브 프로필 (Stage 2+)
  docs/              프로세스 맵, 거버넌스 운영, 매뉴얼, ADR
  memory/            세션 로그와 회의록
```

## 빠른 시작

이것은 워크스페이스 템플릿의 beta 변형입니다. `templates/common`에서 상속하며 변형별 맞춤 설정을 포함합니다.

### Claude Code 사용자:

자세한 지침은 `CLAUDE.md`를 참고하세요.

### Gemini CLI 사용자:

자세한 지침은 `GEMINI.md`를 참고하세요.

## 팀 미션

**미션:** 신사업 검토 AI 팀이자 시스템. 신사업 개발의 규정·절차·가이드라인·체크리스트와 그 상시 운영을 소유하고(axis A), 이를 시스템으로 구현·유지하며(axis B), 그 위에서 실제 딜 리뷰를 수행한다(axis C). 직접 시장 데이터가 없는 산업을 위한 proxy-chain 수요 추정과 함께 Green Field(신설)와 Brown Field(M&A)를 다룬다.

## AI 팀 소개

당신의 파트너는 각기 고유한 역할을 가진 전문 에이전트들입니다. **프로젝트 매니저(PM)**가 유일한 진입점이며 나머지 팀을 조율합니다.

| 에이전트 | 역할 | 티어 | 모델 |
|---------|------|------|------|
| **antitrust-agent** | Antitrust 및 기업결합 통제 리뷰: 시장 정의, HHI 계산, 다중 관할 대응 | high | inherit |
| **backend-engineer** | Next.js Route Handler REST API, 인증, MCP 서버, analysis-engine CLI, 모니터링 | medium | inherit |
| **brownfield-agent** | M&A 리뷰 리드: 타깃 스크리닝, 딜 구조화, 부문 분리(carve-out) 평가 | high | inherit |
| **certification-agent** | 인증 및 규제 대응 — 허가(permit)와 구조적으로 분리하여 관리 | high | inherit |
| **commercial-dd-agent** | 상업적 DD: 고객 집중도, 가격 결정력, 채널 체크 | medium | inherit |
| **compliance-officer** | 거버넌스 운영 소유: 팀이 작성한 규칙을 실제로 굴리는 상시 업무 | high | inherit |
| **customer-retention-agent** | 인수 후 고객 이탈 리스크: 경영권 변동 조항 스캐닝, 고객 관련 리스크 평가 | medium | inherit |
| **data-architect** | ERD, 마스터 데이터 거버넌스, 정규화, 인덱싱, 마이그레이션, 이식성 | high | inherit |
| **dba** | 데이터베이스 운영: 백업/복원, 월간 복구 훈련, 성능 튜닝 | medium | inherit |
| **docs-writer** | 4개 도메인 전반의 문서 포맷팅과 언어 정책 집행 | medium | inherit |
| **financial-analyst** | 과거 재무 분석, 동종 비교 벤치마킹, 실적 품질(QoE) 분석, 성장 전망 | high | inherit |
| **frontend-engineer** | Next.js(App Router) UI, Recharts 시각화, RAG 대시보드, 관리 콘솔 | medium | inherit |
| **glossary-curator** | 용어집 소유: 등록, 검토, 중복 병합, 4개 도구 연동 | medium | inherit |
| **greenfield-agent** | 신설 리뷰 리드: 입지 선정, 인프라 평가, 인재 확보 | high | inherit |
| **group-review-agent** | 개별 법인 리뷰와 구별되는 그룹 레벨 리뷰: 포트폴리오 적합성, 그룹 내 정합성 | high | inherit |
| **hr-integration-agent** | 임원 보상 리뷰, 임직원 급여·복리후생 형평성 분석, 노무 관련 검토 | high | inherit |
| **incentive-agent** | 양방향 정책 혜택 관리: 지역 세제·인프라 지원 소싱 및 사후 관리 | medium | inherit |
| **industry-lead** | 산업 도메인 리드: 로스터 전반에서 쓰이는 산업 프로필 시스템 소유 | high | inherit |
| **infra-automation-engineer** | OS 설정, 서비스 등록, 예약 수집 스케줄러 | medium | inherit |
| **legal-counsel** | 국내외 법령, 계약, 규제 자문 | high | inherit |
| **market-intelligence-agent** | TAM/SAM/SOM 산정, 수요 전망, 경쟁사 증설 추적 | high | inherit |
| **partnership-agent** | 파트너 소싱 전략, 컴플라이언스 스크리닝을 포함한 파트너 실사 | medium | inherit |
| **platform-lead** | 기술(technical) 도메인 리드 | high | inherit |
| **pm** | 신사업 검토 리드(New Business Review Lead) — 4개 도메인 리드를 조율하고 스테이지 게이트를 집행하며 ADR을 승인 | high | inherit |
| **pmi-agent** | 인수 후 통합(PMI) 기획: 시너지 실현 추적과 통합 리스크 관리 | medium | inherit |
| **process-governance-manager** | 기능(functional) 도메인 리드 | high | inherit |
| **quant-methodologist** | proxy 산업 체인 방법론 소유: 단위 환산, 회귀 캘리브레이션 | high | inherit |
| **region-lead** | 지역 도메인 리드: 국내외를 포괄하는 지역 프로필 시스템 소유 | high | inherit |
| **release-engineer** | 빌드 및 배포 파이프라인, 마이그레이션 실행 순서, 롤백 절차 | medium | inherit |
| **risk-officer** | 레드팀(red-team) 기능 | high | inherit |
| **security-engineer** | 위협 모델링, 보안 베이스라인, 취약점·시크릿 관리 | high | inherit |
| **sre** | 모니터링과 알림, 로그 파이프라인, 사고 대응 및 사후 분석 | medium | inherit |
| **technical-dd-agent** | 기술 DD: 현장 방문, 잔여 설비 수명, TRL 평가 | medium | inherit |
| **valuation-agent** | DCF/NPV/IRR/Payback/DSCR 모델링, 실측·사용자 입력 기반 WACC 조립 | high | inherit |

## 스킬

팀은 120개 이상의 워크플로 스킬(거버넌스 문서 작성, 실사 플레이북, 재무 분석, 플랫폼 운영)을 갖추고 있습니다. 관리되는 인덱스는 [skills/SKILLS.md](skills/SKILLS.md)에 있으며, 개별 스킬 지침은 `skills/<name>/SKILL.md`와 그 미러 복사본(`.claude/skills/`, `.gemini/skills/`, `.agents/skills/`)에 있습니다.

## 세션 시작 체크리스트

1. [docs/context.md](docs/context.md)와 여기서 링크하는 설계 기록(design of record)을 읽을 것.
2. 현재 Stage를 확인할 것(설계서 §10 실행 순서 기준 — 코드보다 프로세스/거버넌스 문서가 먼저).
3. 새 작업을 시작하기 전에 `memory/MEMORY.md`에서 최신 세션·회의 항목을 확인할 것.
4. 모든 요청은 PM으로 라우팅 — 아래 참조.

## 멀티 에이전트 워크플로

PM이 **New Business Review Lead**로서 모든 전문가를 직접 디스패치하는 대신 4명의 도메인 리드(`process-governance-manager`, `platform-lead`, `industry-lead`, `region-lead`)를 조율합니다. 전체 역할 오버라이드와 3개 동등 축(거버넌스 소유, 시스템 구축, 딜 리뷰)은 [CLAUDE.md](CLAUDE.md)를 참고하세요.

## 협업 방법

협업 방식은 품질을 극대화하고 충돌을 방지하도록 구조화되어 있습니다. 표준 워크플로는 다음과 같습니다:

### A. PM 게이트웨이

항상 요청을 시작할 때 **PM**과 먼저 대화하세요. 전문 에이전트를 직접 호출하지 마세요. PM이 요청을 분석하고 적절한 전문가를 불러옵니다.

### B. 표준 워크플로 단계

1. **팀 구성:** PM이 필요한 전문 에이전트/스킬을 생성합니다.
2. **분류:** PM이 요청을 분류하고 읽기 전용 에이전트를 병렬로 배치합니다.
3. **분석:** PM이 조사 결과를 요구사항 + 완료 기준으로 종합합니다.
4. **설계:** 아키텍트가 구현 계획 + ADR을 작성합니다.
5. **구현:** 전문가가 구현하고, PM은 실패 시 최대 3회까지 반복합니다.
6. **마무리:** PM이 결정을 기록하고 `/sync`를 실행한 뒤 PR을 엽니다.

### C. 사용 가능한 명령어

일상적인 작업은 슬래시 명령어(Claude Code 및 Gemini CLI에서 Skill로 등록됨)로 구동됩니다:

- `/sync "feat: ..."` — 전체 파이프라인: memlog → changelog → audit → commit → PR.
- `/changelog "..."` — `CHANGELOG.md`에 항목 추가.
- `/memlog "summary"` — 오늘 세션 로그에 요약 추가.
- `/meeting` — 구조화된 인라인 다중 에이전트 토론 진행.

## 변형 유형

**유형**: web | cli | api | mcp

이 변형은 신사업 검토 거버넌스 팀과 그 지원 시스템을 구현합니다: 정책·절차·체크리스트 작성 및 운영, SQLite 기반 Next.js Route Handler REST API, 그 위의 MCP 서버, Python 연산 레이어, Green Field 및 Brown Field 딜 리뷰 워크플로. (원래 ADR-0010에 따라 Hono + React/Vite + ECharts로 구축되었으나, ADR-0069/0070(2026-08-26 승인)에 따라 Next.js + Prisma + Tailwind + Recharts로 이관되었습니다.)

> ⚠️ 프로토타입 변형 — 프로덕션 용도가 아닙니다.

에이전트/스킬/스크립트 수명주기 규칙은 [AGENTS.md](AGENTS.md) §8(Lifecycle Management)과 `docs/context.md`를 참조하세요.

## 라이선스

내부 워크스페이스 프로젝트 — 외부 배포용이 아닙니다. 상위 `ai_workspace` 저장소와 동일한 약관의 적용을 받습니다.

---

*최근 업데이트: 2026-08-24*
*Last Updated: 2026-08-28*
