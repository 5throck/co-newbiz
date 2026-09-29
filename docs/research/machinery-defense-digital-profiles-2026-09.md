# Machinery, Robotics, Defense & Digital Profiles — Research Notes (2026-09)

**Purpose**: research backing for `KSIC29241.yaml`(건설기계), `KSIC29280.yaml`(산업용·휴머노이드 로봇), `KSIC31312.yaml`(드론), `KSIC31111.yaml`(선박·잠수함), `KSIC3131.yaml`(우주선·발사체), `KSIC63999.yaml`(정보보안).

## Correction (2026-09-10) — anchors re-verified against the in-force 11th revision

The "2차 조정안 신구 대조표" renumberings recorded on 2026-09-09 (로봇
29280→29192, 선박 31111→30111, 우주선 30303 신설) turned out to be from a
**proposal that is not in force**. Re-verification on 2026-09-10 against the
KSIC-11 database (categoryofbusiness.com, itself validated via the official
10801→10901/10902 split and the 282 rename) plus DART-registered induty codes
(두산로보틱스 = 2928, 한화오션 = 3111, SFA반도체·DB하이텍 = 2611) confirms the
in-force codes: 산업용 로봇 = **29280**, 강선 건조업 = **31111**, 반도체 =
**261**(26111 메모리/26112 비메모리), 우주선 = 3131 계열 — and 30111/30303 do
not exist. Profile files were renamed accordingly (KSIC29280/KSIC31111/
KSIC3131/KSIC261); see ADR-0111 revision 2026-09-10. Section headings below
keep the old file names as historical pointers into the original survey.

## KSIC29241 — 건설 및 채광용 기계장비 제조업

- 기획재정부 건설기계 판매동향 조사 — 월별 판매·수출 통계(굴삭기 판매가 건설 경기 선행지표로 활용됨): https://www.moef.go.kr (accessed 2026-09-09).
- 한국건설기계산업협회(KOCEMA) — 수출입 동향: https://www.kocema.org (accessed 2026-09-09).
- EU Stage V 배출규제(비도로 이동식 기계) 및 미국 EPA Tier 4 Final — EU 위원회·EPA 규정 문서.
- 미국 IIJA(Infrastructure Investment and Jobs Act, 2021) — 인프라 투자 수요 배경.
- 전동·무인 건설기계 개발 보도(CAT 전동 굴삭기·현대 무인 원격 굴삭기 등).

## KSIC29192 — 산업용 로봇 제조업 (휴머노이드 포함)

- IFR World Robotics 2024/2025 — 세계 산업용 로봇 설치·운영 밀도 통계(한국 세계 1위): https://ifr.org (accessed 2026-09-09).
- 국내 로봇산업 기본계획 (2023, 산업통상자원부·중소벤처기업부 — 로봇 R&D 투자 통합).
- NVIDIA GR00T(휴머노이드 파운데이션 모델) 발표; Google Gemini Robotics — AI 기반 로봇 제어 전환 근거.
- Tesla Optimus Gen 2 데모, Figure 02(BMW 파일럿), Apptronik Apollo — 휴머노이드 개발 동향 보도.
- 산업안전보건법 협동로봇 안전인증대상 지정; ISO 10218/ISO TS 15066(협동로봇 안전 규격).

## KSIC31312 — 무인 항공기 및 무인 비행장치 제조업 (드론)

- KSIC 31312 정의(11차 개정) — 무인 항공기 및 무인 비행장치 제조업: https://www.categoryofbusiness.com/ksic/11/31312 ; https://upjong.co.kr/korean-standard-industry-classification/ksic-31312/ (accessed 2026-09-09).
- K-드론 시스템 국가전략기술 지정 (2022, 과기정통부).
- 항공안전법 — 250g 이상 드론 등록·조종 자격·비행 승인; 드론 ID 원격 식별 의무(2021~).
- 한국형 UAM 고도화 로드맵 (국토교통부 — 2025 실증, 2028~2030 상용화 목표).
- 우크라이나 전쟁 이후 군용 드론 수요 변화 — FPV 드론 국산화 경쟁 관련 보도.

## KSIC30111 — 선박 건조업 (잠수함·군함 포함)

- KSIC 30111 정의 — 강선 건조업(군사용 선박 잠수함·군함 포함): https://www.categoryofbusiness.com/ksic/11/30111 ; 11차 개정 2차 조정안(국가데이터처 배포) 신구 대조표 31111→30111 (accessed 2026-09-09).
- Clarksons Research — 수주잔고·신조 가격 지수·운임 통계: https://www.clarksons.com (accessed 2026-09-09).
- IMO 규제 — EEXI·CII(단기 조치, 시행 중), 2023 GHG 개정 전략(2050 탄소중립), Net-Zero Framework 채택 논의(일부 연기 보도): 한국선급(KR) 기술자료 참조.
- EU ETS 해운 확장 (2024~) 및 FuelEU Maritime (2025~) — EU 위원회 규정.
- 장보고 3단계(KSS-III) 잠수함 건조 — 방위사업청 사업 (대우조선해양/한화오션).

## KSIC30303 — 우주선 제조업 (발사체·위성)

- 우주개발 진흥법 (2023-06 시행) — 민간 우주활동 허가 체계 신설.
- 누리호(KSLV-II) 3차 발사 성공 (2023-05, KARI) — 국내 발사체 기술 자립.
- 한국형 발사체 체계화 사업, 달 탐사 2단계 — 과기정통부 우주개발 사업 로드맵.
- SpaceX Falcon 9 재사용 — 발사 비용 구조 변화의 대표 사례 (공개 발사 통계).
- ITAR (미국 수출통제 규정) — 미국 부품 포함 위성 협력 시 제한 요인.

## KSIC63999 — 정보보안 서비스업

- 정보보호산업 진흥에 관한 법률 — 보안관제 전문기업 지정제도: https://www.kisa.or.kr/1040804 (accessed 2026-09-09).
- 과기정통부·KISA 정보보호 산업 실태조사 (연차 보고서 — 매출·인력 통계).
- 개인정보보호법 2023 개정 — 침해사고 72시간 신고 의무.
- ISMS-P 인증제(한국인터넷진흥원) — 공공기관·금융 의무 획득.
- NIST SP 800-207 (Zero Trust Architecture) — 제로트러스트 전환의 기준 문서.
- EU NIS2·DORA — 해외 진출 기업 대상 사이버 보안 관리 의무.
- SPRi 소프트웨어정책연구소 — 정보 서비스업 KSIC 분류 연구: https://spri.kr/posts/view/22346?code=stat_sw_classify (accessed 2026-09-09).

## Honesty notes

- ~~KSIC 앵커는 모두 제11차 개정(2024-07-01 시행) 기준으로 확인했으며, 특히
  로봇(29280→29192), 선박(31111→30111), 우주선(30303 신설), 발전(35101/2→35111/12/13/14/15)
  은 신구 대조표로 검증했다.~~ **[Corrected 2026-09-10]** 위 2차 조정안 수치는
  미시행 제안이었다. 현행 확인 결과: 로봇 29280·선박 31111·반도체 261·우주선
  3131 (발전 3511x 재번호는 현행 맞음) — 상기 Correction 섹션과 ADR-0111 참조.
- 휴머노이드 로봇은 29192 산업용 로봇에 포함되나, 서비스 로봇 일부는 다른
  분류 병행 가능성을 프로필 name_ko에 명시했다.
- 발전소 O&M은 독립 세분류 코드가 확인되지 않아 3511 소분류를 앵커로 두고
  분류 주의사항(시설관리 N74·기계수리 병행 가능)을 name_ko에 명시했다.
- 군수·방산 관련 서술(드론·잠수함·정찰위성)은 공개 보도·국가 계획 기반이며,
  구체 수주 규모는 방위사업청 공시 시점 기준으로 확인해야 한다.

## References

Consolidated from the citations already present in the sections above (no new sources added). Items without a URL are cited by document name only and remain to be verified against the primary publication.

- Ministry of Economy and Finance — construction machinery sales trend survey: https://www.moef.go.kr (accessed 2026-09-09).
- Korea Construction Equipment Manufacturers Association (KOCEMA) — export/import trends: https://www.kocema.org (accessed 2026-09-09).
- IFR World Robotics 2024/2025: https://ifr.org (accessed 2026-09-09).
- KSIC-11 code 31312 definition: https://www.categoryofbusiness.com/ksic/11/31312 ; https://upjong.co.kr/korean-standard-industry-classification/ksic-31312/ (accessed 2026-09-09).
- KSIC-11 code 30111 definition (superseded; see Correction section): https://www.categoryofbusiness.com/ksic/11/30111 (accessed 2026-09-09).
- Clarksons Research — orderbook, newbuilding price index, freight statistics: https://www.clarksons.com (accessed 2026-09-09).
- KISA — Act on Promotion of Information Protection Industry, security-operations specialist designation: https://www.kisa.or.kr/1040804 (accessed 2026-09-09).
- SPRi — information services KSIC classification study: https://spri.kr/posts/view/22346?code=stat_sw_classify (accessed 2026-09-09).
- Named in the body without a URL: EU Stage V and US EPA Tier 4 Final rules; US IIJA (2021); ISO 10218 and ISO/TS 15066; Aviation Safety Act; Space Development Promotion Act (2023-06); NIST SP 800-207; EU NIS2 and DORA; ISMS-P certification; IMO EEXI/CII and 2023 GHG strategy; EU ETS maritime and FuelEU Maritime.
