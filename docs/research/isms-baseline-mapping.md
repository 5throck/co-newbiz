# 리서치 노트 — 보안 베이스라인의 ISMS/ISO 27001 매핑

> 🌐 외부 참고 자료. 조사일: 2026-09-05. docs/security/security-baseline.md의 통제 항목을 국제 표준 관점에서 비교하기 위한 참고.

## 표준 관행

1. **위험 평가 우선**: 93개 Annex A 통제수단(2022판, 조직·사람·물리·기술 4주제)을 모두 구현할 필요는 없고, 위험 평가로 선별·정당화한 통제만 SoA(적용성 선언서)에 기재 (ZipSec, GAICC)
2. **감사 가능한 증적·명확한 책임자**가 실무 체크리스트의 공통 축 (ISMS.online 27 controls)
3. **프레임워크 매핑 재활용**: SOC 2·NIST CSF 통제를 ISO 27001로 매핑해 이중 구축 회피 (Strike Graph)
4. **소규모 팀 실무**: 경영 요구사항(4~10절)과 기술 통제 분리 접근, 기존 통제 재사용 (Cyberday, Sprinto)

## co-newbiz 매핑

- security-baseline의 항목별로 Annex A 4주제 태그를 붙이면 인증 준비 시 SoA 초안으로 전환 가능. 역할 최소권한·시크릿 관리 등 기존 규칙은 기술 통제 축에 직접 대응.

## 출처

- ISMS.online, "ISO 27001 MSP Checklist: 27 Essential Controls" — https://www.isms.online/managed-service-providers/iso-27001-msp-checklist-27-essential-controls-every-provider-must-implement/ (접근일 2026-09-05)
- ZipSec, "ISO 27001 Controls: What to Deploy" — https://www.zipsec.com/blog/iso-27001-controls (접근일 2026-09-05)
- Strike Graph, "SOC 2 vs ISO 27001" — https://www.strikegraph.com/blog/difference-between-iso-27001-and-soc-2 (접근일 2026-09-05)
- Cyberday, "ISO 27001 Compliance & Certification Checklist" — https://www.cyberday.ai/blog/iso-27001-compliance-and-certification-checklist (접근일 2026-09-05)
