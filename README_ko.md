---
sync_version: 1
translated_from_hash: PLACEHOLDER
lang: ko
lang_reason: source-material
---

# co-newbiz

> **언어**: [English](README.md) · **한국어**
> **상태**: ⚠️ Beta — v0.1.0
> New-business-review AI team and system. Owns the regulations, procedures, guidelines and checklists for new business development and their ongoing operation (axis A), implements and maintains them as a system (axis B), and performs the actual deal reviews on top of that (axis C). Covers Green Field (new establishment) and Brown Field (M&A), with proxy-chain demand estimation for industries that have no direct market data.

## 개요

New-business-review AI team and system. Owns the regulations, procedures, guidelines and checklists for new business development and their ongoing operation (axis A), implements and maintains them as a system (axis B), and performs the actual deal reviews on top of that (axis C). Covers Green Field (new establishment) and Brown Field (M&A), with proxy-chain demand estimation for industries that have no direct market data.. 전체 아키텍처와 표준은 docs/context.md를 참고하세요.

## 빠른 시작

이것은 워크스페이스 템플릿의 beta 변형입니다. `templates/common`에서 상속하며 변형별 맞춤 설정을 포함합니다.

### Claude Code 사용자:

자세한 지침은 `CLAUDE.md`를 참고하세요.

### Gemini CLI 사용자:

자세한 지침은 `GEMINI.md`를 참고하세요.

## 팀 미션

**미션:** New-business-review AI team and system. Owns the regulations, procedures, guidelines and checklists for new business development and their ongoing operation (axis A), implements and maintains them as a system (axis B), and performs the actual deal reviews on top of that (axis C). Covers Green Field (new establishment) and Brown Field (M&A), with proxy-chain demand estimation for industries that have no direct market data.

## AI 팀 소개

당신의 파트너는 각기 고유한 역할을 가진 전문 에이전트들입니다. **프로젝트 매니저(PM)**가 유일한 진입점이며 나머지 팀을 조율합니다.

| 에이전트 | 역할 | 티어 | 모델 |
|---------|------|------|------|
| **antitrust-agent** | Antitrust and merger-control review: market definition, HHI calculation, multi-j | high | inherit |
| **backend-engineer** | Hono REST API, authentication, MCP server, the analysis-engine CLI, and the moni | medium | inherit |
| **brownfield-agent** | M&A review lead: target screening, deal structuring, and carve-out assessment | high | inherit |
| **certification-agent** | Certification and regulatory response, kept structurally distinct from permits | high | inherit |
| **commercial-dd-agent** | Commercial due diligence: customer concentration, pricing power, channel checks, | medium | inherit |
| **compliance-officer** | Owns governance operation: the standing work of running the rules the team write | high | inherit |
| **customer-retention-agent** | Post-acquisition customer attrition risk: change-of-control clause scanning, cus | medium | inherit |
| **data-architect** | ERD, master data governance, normalization, indexing, migration, and portability | high | inherit |
| **dba** | Database operations: backup/restore, monthly recovery drills, performance tuning | medium | inherit |
| **docs-writer** | Document formatting and language-policy enforcement across all four domains | medium | inherit |
| **financial-analyst** | Historical financial analysis, peer benchmarking, quality-of-earnings, and growt | high | inherit |
| **frontend-engineer** | React/Vite UI, ECharts visualizations, the RAG dashboard, the admin console, and | medium | inherit |
| **glossary-curator** | Owns the glossary: registration, review, duplicate merging, and the four tooling | medium | inherit |
| **greenfield-agent** | New-establishment review lead: site selection, infrastructure assessment, talent | high | inherit |
| **group-review-agent** | Group-level review distinct from entity-level review: portfolio fit, intra-group | high | inherit |
| **hr-integration-agent** | Executive compensation review, employee pay-and-benefits parity analysis, and la | high | inherit |
| **incentive-agent** | Bidirectional policy-benefit management: sourcing regional tax and infrastructur | medium | inherit |
| **industry-lead** | Domain lead for industry, owning the industry profile system used across the ros | high | inherit |
| **infra-automation-engineer** | OS configuration, service registration, the scheduled-collection scheduler, and  | medium | inherit |
| **legal-counsel** | Domestic and overseas statute, contract, and regulatory advisory | high | inherit |
| **market-intelligence-agent** | TAM/SAM/SOM sizing, demand forecasting, competitor capacity-expansion tracking,  | high | inherit |
| **partnership-agent** | Partner sourcing strategy, partner due diligence including compliance screening, | medium | inherit |
| **platform-lead** | Domain lead for technical | high | inherit |
| **pmi-agent** | Post-merger integration planning: synergy realization tracking and integration r | medium | inherit |
| **process-governance-manager** | Domain lead for functional | high | inherit |
| **quant-methodologist** | Owns the proxy industry chain methodology: unit conversion, regression calibrati | high | inherit |
| **region-lead** | Domain lead for region, owning the region profile system covering domestic and o | high | inherit |
| **release-engineer** | Build and deployment pipeline, migration execution ordering, and rollback proced | medium | inherit |
| **risk-officer** | Red-team function | high | inherit |
| **security-engineer** | Threat modeling, security baseline, vulnerability and secrets management, and im | high | inherit |
| **sre** | Monitoring and alerting, log pipeline, and incident response with post-incident  | medium | inherit |
| **technical-dd-agent** | Technical due diligence: site visits, remaining equipment life, TRL assessment,  | medium | inherit |
| **valuation-agent** | DCF/NPV/IRR/Payback/DSCR modeling, WACC assembly from live and user-supplied inp | high | inherit |

## 스킬

- **accessibility-audit**: 
- **agent-lifecycle-manager**: 
- **explain-me**: 
- **gateguard**: 
- **k-dart**: 
- **k-law**: 
- **mece-logic-auditor**: 
- **meeting-facilitation**: 
- **presenter-mode**: 
- **project-review**: 
- **sarif-exporter**: 
- **script-lifecycle-manager**: 
- **security-scan**: 
- **skill-lifecycle-manager**: 
- **sound-synth**: 
- **standup-synthesizer**: 
- **stride-threat-matrix**: 
- **swe-solve**: 
- **sync**: 
- **team-builder**: 
- **translate**: 
- **update-bun-packages**: 
- **validate-docs-links**: 
- **zod-contract-gate**: 

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

**유형**: consulting

이 변형은 Strategy consulting for AI-assisted business consulting engagements에 중점을 둡니다.

> **⚠️ 베타 변형** — 프로덕션 용도가 아닙니다.

- **클라이언트 참여**: 0/2 (변형 거버넌스 규칙 참조)
- **베타 기간**: 0/2개월
- **추가 검증**: 대기 중

승급 기준은 `scripts/helpers/variant-governance-rules.ts`를 참조하세요.

---

*최근 업데이트: 2026-08-20*
*Last Updated: 2026-08-19*
