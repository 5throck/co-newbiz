---
lang: ko
lang_reason: source-material
doc_type: explanation
verified_on: 2026-10-23
---
# 신규사업 검토 사용자 안내서

**목적:** 화면에서 무엇을 어디서 누르는지를 사용자 여정 순서대로 설명한다. 규정과 절차의 내용은 `procedures/*.yaml`이 기준이고 이 안내서는 "어디를 눌러 하는가"만 다룬다. 역할 중심의 기존 설명은 [업무 매뉴얼](../../manuals/business-manual_ko.md), [관리자 매뉴얼](../../manuals/admin-manual_ko.md), [운영 매뉴얼](../../manuals/operations-manual_ko.md)에 있다.

> [!NOTE]
> 이 시스템은 의사결정 지원 도구다. 게이트 승인, 투자 결정, 진출방식(트랙) 결정은 사람만 기록한다. AI는 초안과 제안만 만든다. 안내서의 화면 그림은 모두 **데모 자료**로 찍었다. 이름과 숫자는 내 화면과 다르다.

## 여정 개요

공통 단계 S1~S4를 지나 S4에서 길이 갈라지고 S8부터 두 길이 다시 만나 S12까지 함께 간다.

<svg viewBox="0 0 908 150" width="100%" role="img" xmlns="http://www.w3.org/2000/svg">
  <title>여정 지도: S4에서 갈라져 S8에서 다시 만난다</title>
  <defs>
    <marker id="wiki-ah" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 z" fill="var(--border)"></path>
    </marker>
  </defs>
  <text x="64" y="31" text-anchor="end" font-size="12" fill="var(--muted-fg)">공통</text>
  <text x="64" y="73" text-anchor="end" font-size="12" fill="var(--muted-fg)">그린필드</text>
  <text x="64" y="117" text-anchor="end" font-size="12" fill="var(--muted-fg)">브라운필드</text>
  <rect x="72" y="14" width="54" height="26" rx="6" fill="none" stroke="var(--border)"></rect>
  <text x="99" y="31.5" text-anchor="middle" font-size="13" fill="var(--fg)">S1</text>
  <line x1="126" y1="27" x2="142" y2="27" stroke="var(--border)" stroke-width="1.2" marker-end="url(#wiki-ah)"></line>
  <rect x="148" y="14" width="54" height="26" rx="6" fill="none" stroke="var(--border)"></rect>
  <text x="175" y="31.5" text-anchor="middle" font-size="13" fill="var(--fg)">S2</text>
  <line x1="202" y1="27" x2="218" y2="27" stroke="var(--border)" stroke-width="1.2" marker-end="url(#wiki-ah)"></line>
  <rect x="224" y="14" width="54" height="26" rx="6" fill="none" stroke="var(--border)"></rect>
  <text x="251" y="31.5" text-anchor="middle" font-size="13" fill="var(--fg)">S3</text>
  <line x1="278" y1="27" x2="294" y2="27" stroke="var(--border)" stroke-width="1.2" marker-end="url(#wiki-ah)"></line>
  <circle cx="287" cy="27" r="3.5" fill="var(--primary)"></circle>
  <rect x="300" y="14" width="54" height="26" rx="6" fill="none" stroke="var(--border)"></rect>
  <text x="327" y="31.5" text-anchor="middle" font-size="13" fill="var(--fg)">S4</text>
  <line x1="354" y1="27" x2="368" y2="27" stroke="var(--border)" stroke-width="1.2"></line>
  <line x1="368" y1="27" x2="368" y2="113" stroke="var(--border)" stroke-width="1.2"></line>
  <line x1="368" y1="69" x2="381" y2="69" stroke="var(--border)" stroke-width="1.2" marker-end="url(#wiki-ah)"></line>
  <circle cx="375" cy="69" r="3" fill="var(--primary)"></circle>
  <line x1="368" y1="113" x2="381" y2="113" stroke="var(--border)" stroke-width="1.2" marker-end="url(#wiki-ah)"></line>
  <circle cx="375" cy="113" r="3" fill="var(--primary)"></circle>
  <rect x="386" y="56" width="54" height="26" rx="6" fill="var(--primary)" fill-opacity="0.08" stroke="var(--border)"></rect>
  <text x="413" y="73.5" text-anchor="middle" font-size="13" fill="var(--fg)">S5</text>
  <line x1="440" y1="69" x2="556" y2="69" stroke="var(--border)" stroke-width="1.2" marker-end="url(#wiki-ah)"></line>
  <text x="501" y="52" text-anchor="middle" font-size="12" fill="var(--muted-fg)">S6·S7 건너뜀</text>
  <rect x="562" y="56" width="54" height="26" rx="6" fill="none" stroke="var(--border)"></rect>
  <text x="589" y="73.5" text-anchor="middle" font-size="13" fill="var(--fg)">S8</text>
  <rect x="386" y="100" width="54" height="26" rx="6" fill="var(--primary)" fill-opacity="0.08" stroke="var(--border)"></rect>
  <text x="413" y="117.5" text-anchor="middle" font-size="13" fill="var(--fg)">S6</text>
  <line x1="440" y1="113" x2="452" y2="113" stroke="var(--border)" stroke-width="1.2" marker-end="url(#wiki-ah)"></line>
  <rect x="458" y="100" width="54" height="26" rx="6" fill="var(--primary)" fill-opacity="0.08" stroke="var(--border)"></rect>
  <text x="485" y="117.5" text-anchor="middle" font-size="13" fill="var(--fg)">S7</text>
  <line x1="512" y1="113" x2="556" y2="113" stroke="var(--border)" stroke-width="1.2" marker-end="url(#wiki-ah)"></line>
  <circle cx="537" cy="113" r="3" fill="var(--primary)"></circle>
  <rect x="562" y="100" width="54" height="26" rx="6" fill="none" stroke="var(--border)"></rect>
  <text x="589" y="117.5" text-anchor="middle" font-size="13" fill="var(--fg)">S8</text>
  <line x1="616" y1="69" x2="632" y2="69" stroke="var(--border)" stroke-width="1.2"></line>
  <line x1="616" y1="113" x2="632" y2="113" stroke="var(--border)" stroke-width="1.2"></line>
  <line x1="632" y1="69" x2="632" y2="113" stroke="var(--border)" stroke-width="1.2"></line>
  <line x1="632" y1="91" x2="644" y2="91" stroke="var(--border)" stroke-width="1.2" marker-end="url(#wiki-ah)"></line>
  <circle cx="639" cy="91" r="3" fill="var(--primary)"></circle>
  <rect x="650" y="78" width="48" height="26" rx="6" fill="none" stroke="var(--border)"></rect>
  <text x="674" y="95.5" text-anchor="middle" font-size="13" fill="var(--fg)">S9</text>
  <line x1="698" y1="91" x2="710" y2="91" stroke="var(--border)" stroke-width="1.2" marker-end="url(#wiki-ah)"></line>
  <circle cx="704" cy="91" r="3" fill="var(--primary)"></circle>
  <rect x="716" y="78" width="48" height="26" rx="6" fill="none" stroke="var(--border)"></rect>
  <text x="740" y="95.5" text-anchor="middle" font-size="13" fill="var(--fg)">S10</text>
  <line x1="764" y1="91" x2="776" y2="91" stroke="var(--border)" stroke-width="1.2" marker-end="url(#wiki-ah)"></line>
  <rect x="782" y="78" width="48" height="26" rx="6" fill="none" stroke="var(--border)"></rect>
  <text x="806" y="95.5" text-anchor="middle" font-size="13" fill="var(--fg)">S11</text>
  <line x1="830" y1="91" x2="848" y2="91" stroke="var(--border)" stroke-width="1.2" marker-end="url(#wiki-ah)"></line>
  <circle cx="839" cy="87" r="2.6" fill="var(--primary)"></circle>
  <circle cx="839" cy="95" r="2.6" fill="var(--primary)"></circle>
  <rect x="854" y="78" width="48" height="26" rx="6" fill="none" stroke="var(--border)"></rect>
  <text x="878" y="95.5" text-anchor="middle" font-size="13" fill="var(--fg)">S12</text>
  <text x="72" y="146" font-size="12" fill="var(--muted-fg)">작은 원: 게이트 기록 자리 (Screening · Pre-FS · Target Screening · FS · DD · 법인·그룹)</text>
</svg>

## 처음이라면

| 상황 | 볼 쪽 |
|---|---|
| 로그인부터 데모 안건 읽기까지 15분 | [01-시작하기](01-시작하기.md) |
| 내 역할(분석가, 프로젝트 리드, 투자심의 위원, 열람자, 운영자)에 맞는 읽기 순서 | [04-역할별-시작-페이지](04-역할별-시작-페이지.md) |
| 막히면 | [81-문제-해결](81-문제-해결.md), [80-자주-묻는-질문](80-자주-묻는-질문.md) |

## 그린필드와 브라운필드 한눈에 비교

두 길은 S4에서 갈라지고 S8에서 다시 만난다.

| | 그린필드 (자체 진출) | 브라운필드 (결합 진출) |
|---|---|---|
| 뜻 | 우리 역량으로 새로 세워서 들어감 | 기존 기업·자산과 결합해서 들어감 |
| 길 | S1~S4 → **S5** → S8~S12 | S1~S4 → **S6~S7** → S8~S12 |
| S4에서 기록하는 것 | `트랙`을 Greenfield로(`라우트`는 선택) | `트랙`을 Brownfield로 + `라우트`(M&A, JV 등, 필수) |
| 쓰지 않는 단계 | S6, S7 | S5 |
| S5~S7에서 하는 일 | 역량 격차, 부지, 인허가, 인센티브 | 후보군 기준, 긴 목록, 짧은 목록, 대상 선정 |
| S8 사업성 | 대상 하나(단일 범위) | 대상별 분석 + 사람이 대상 선정 |
| S9 실사 | 지정 회사 없이 프로젝트 기준 | 선정 대상 기준 + M&A 6대 검증, 특수 주제 |
| S10 투자구조 | `설립 법인 형태`, 실행 기준선, 투자 분할 집행 | `투자 주체`, 거래 구조, `차입·여신` |
| S11 투자심의 뒤 | 설립 실행 5단계 | PMI 킥오프(클로징) |
| S12 사후 관리 | 실행 기준선 대비 차이 | PMI(핵심 인력, 시너지 인증) |
| 여정 안내 | [10-그린필드-여정](10-그린필드-여정.md) | [11-브라운필드-여정](11-브라운필드-여정.md) |
| 처음부터 끝까지 | [90-따라하기-점검표-그린필드](90-따라하기-점검표-그린필드.md) | [91-따라하기-점검표-브라운필드](91-따라하기-점검표-브라운필드.md) |

브라운필드는 곧 인수합병(M&A)이라는 뜻이 아니다. 화면 안내문에도 "Brownfield ≠ M&A"라고 적혀 있으며 M&A, JV, 전략적 투자 등 라우트 유형을 따로 고른다.

## 여정 순서대로 찾기

### 0. 시작과 화면 익히기

- [01-시작하기](01-시작하기.md), [02-역할과-권한](02-역할과-권한.md), [03-용어집-링크](03-용어집-링크.md), [04-역할별-시작-페이지](04-역할별-시작-페이지.md)
- [12-공통-화면-둘러보기](12-공통-화면-둘러보기.md): 보드, 결정 대기함, 연결된 앱, 용어집

### 1. 공통 단계 (S1~S4)

| 단계 | 하는 일 | 안내 쪽 |
|---|---|---|
| S1 시장분석 | 어디에 기회가 있는가 | [20-공통-S1-시장분석](20-공통-S1-시장분석.md) |
| S2 기회 발굴 | 무엇을 할 것인가 | [21-공통-S2-기회-발굴](21-공통-S2-기회-발굴.md) |
| S3 시너지·전략적 적합성 | 우리가 해야 하는가 | [22-공통-S3-시너지-전략적-적합성](22-공통-S3-시너지-전략적-적합성.md) |
| S4 진출방식 결정 | 어떻게 들어갈 것인가 (갈림길) | [23-공통-S4-진출방식-결정](23-공통-S4-진출방식-결정.md) |

### 2. 그린필드 여정

[10-그린필드-여정](10-그린필드-여정.md) → [40 S5 자체 진출](40-그린필드-S5-자체-진출.md) → [41 S8 사업성 분석](41-그린필드-S8-사업성-분석.md) → [42 S9 실사](42-그린필드-S9-실사.md) → [43 S10 실행 기준선](43-그린필드-S10-실행-기준선.md) → [44 S11 설립 실행](44-그린필드-S11-설립-실행.md) → [45 S12 사후 관리](45-그린필드-S12-사후-관리.md)

### 3. 브라운필드 여정

[11-브라운필드-여정](11-브라운필드-여정.md) → [50 S6 대상 후보 발굴](50-브라운필드-S6-대상-후보-발굴.md) → [51 S7 대상 선정](51-브라운필드-S7-대상-선정.md) → [52 S8 사업성 분석](52-브라운필드-S8-사업성-분석.md) → [53 S9 실사](53-브라운필드-S9-실사.md) → [54 S10 거래 구조](54-브라운필드-S10-거래-구조.md) → [55 S11 클로징](55-브라운필드-S11-클로징.md) → [56 S12 통합 PMI](56-브라운필드-S12-통합-PMI.md)

### 4. 두 길이 다시 만나는 단계 (S8~S12 공통)

| 단계 | 공통 개요 쪽 |
|---|---|
| S8 사업성 분석 | [30-공통-S8-사업성-분석](30-공통-S8-사업성-분석.md) |
| S9 실사 | [31-공통-S9-실사](31-공통-S9-실사.md) |
| S10 투자구조 설계 | [32-공통-S10-투자심의-전](32-공통-S10-투자심의-전.md) |
| S11 투자심의와 실행 | [33-공통-S11-투자심의와-실행](33-공통-S11-투자심의와-실행.md) |
| S12 사후 관리 | [34-공통-S12-사후-관리](34-공통-S12-사후-관리.md) |

### 5. 프로젝트 보조 화면과 운영

- [60-프로젝트-화면-안내](60-프로젝트-화면-안내.md): 추진계획, WACC, 재무분석, 타임라인, 리스크 히트맵, 가치사슬 연계, 백테스트, 보고서, 에이전트 실행 이력, 외부 안전 공유
- [70-관리자-화면-안내](70-관리자-화면-안내.md): 운영자 콘솔

### 6. 도움과 기록

- [80-자주-묻는-질문](80-자주-묻는-질문.md), [81-문제-해결](81-문제-해결.md), [82-변경-이력](82-변경-이력.md)

## 내 역할로 시작하기

| 나는 | 먼저 볼 곳 |
|---|---|
| 분석가 (프로젝트 구성원) | [20](20-공통-S1-시장분석.md), [21](21-공통-S2-기회-발굴.md), [22](22-공통-S3-시너지-전략적-적합성.md), 이어서 [31](31-공통-S9-실사.md) |
| 프로젝트 리드 | [23-공통-S4-진출방식-결정](23-공통-S4-진출방식-결정.md), 그다음 내 트랙의 여정 |
| 투자심의 위원 | [02-역할과-권한](02-역할과-권한.md), [33-공통-S11-투자심의와-실행](33-공통-S11-투자심의와-실행.md) |
| 열람자 | [01-시작하기](01-시작하기.md), [34-공통-S12-사후-관리](34-공통-S12-사후-관리.md) |
| 운영자 (관리자) | [70-관리자-화면-안내](70-관리자-화면-안내.md), [관리자 매뉴얼](../../manuals/admin-manual_ko.md) |

## 핵심 요약

- 이 안내서는 "어디를 눌러 하는가"만 다루고 규정·절차의 기준은 `procedures/*.yaml`이다.
- 두 길은 S4에서 갈라지고 S8에서 다시 만난다.
- 게이트 승인, 투자 결정, 진출방식 결정은 사람만 기록하고 AI는 초안과 제안만 만든다.
- GO는 `이 진행의 현재 상태`를 읽고 항목별 사유를 적어야 기록되고, 법인·그룹 GO는 기록한 사람이 아닌 다른 검토자가 두 번째로 확인해야 효력이 생긴다([33-공통-S11-투자심의와-실행](33-공통-S11-투자심의와-실행.md)).
- 막히면 [81-문제-해결](81-문제-해결.md)과 [80-자주-묻는-질문](80-자주-묻는-질문.md)을 본다.

다음: [01-시작하기](01-시작하기.md)
