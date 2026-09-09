---
lang: ko
lang_reason: source-material
counterpart: spc-structuring-practice.md
---

# 리서치 노트 — SPC 활용 인수구조 표준 관행 (한국 포함)

> **언어**: [English](spc-structuring-practice.md) · **한국어**

> 🌐 외부 참고 자료. 조사일: 2026-09-05. S10 투자구조 설계(ADR-0045/0106)의 업계 관행 비교용.

## 표준 관행

1. **리스크 격리(ring-fencing)**: SPC는 인수 부채·채무를 후원사/모회사로부터 분리하는 그릇 (Investopedia, PKF)
2. **세제 효율**: debt push-down으로 인수자금 이자를 대상 법인 수준에서 비용 처리; 100% 자회사면 연결납세 제도 혜택 (한국)
3. **한국 실무**: PEF가 신규 법인(SPC)을 설립해 사업 양도 방식으로 인수하는 구조가 일반적 (Chambers Acquisition Finance 2026); LBO 이사 배임 책임 리스크(하이마트 사건 이래 판례 계열)는 구조 설계 시 필수 검토
4. **유의점**: 얇은 자본(thin-cap)/이자 비용 인식 제한, 해외 SPC 소득 과세立法 변동 — 구조 확정 전 세무·법무 확인 필수

## co-newbiz 매핑

- 비히클 enum `spc` + 4축 중 절세 구조·책임 격리 노트의 근거 자료. 확정 구조는 deal_structure_hypothesis에 기록.

## References (출처)

- Investopedia, "Special Purpose Vehicle (SPV)" — https://www.investopedia.com/terms/s/spv.asp (접근일 2026-09-05)
- PKF O'Connor Davies, "The Special Purpose Vehicle" — https://www.pkfod.com/insights/the-special-purpose-vehicle-facilitating-business-and-investment-across-the-globe/ (접근일 2026-09-05)
- Chambers, "Acquisition Finance 2026 — South Korea" — https://practiceguides.chambers.com/practice-guides/acquisition-finance-2026/south-korea/trends-and-developments (접근일 2026-09-05)
- KoreanLII, "Leveraged Buyout" — http://www.koreanlii.or.kr/w/index.php/Leveraged_buyout (접근일 2026-09-05)
- 서울대 학위논문, "LBO 이사의 배임 책임(하이마트 사건)" — https://s-space.snu.ac.kr/bitstream/10371/213617/1/05_Ok-Rial_Song.pdf (접근일 2026-09-05)
