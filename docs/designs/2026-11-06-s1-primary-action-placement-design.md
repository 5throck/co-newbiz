---
lang: ko
lang_reason: source-material
---

# S1 Primary Action Placement

- Spec ID: `2026-11-06-s1-primary-action-placement`
- Date: 2026-11-06
- Status: implemented

## Problem

S1 산업 목록 화면(`/market` 및 `/deals/[id]/s1`)에서 filled primary 버튼이
`StageFrame`의 "S1 시장분석" 제목(h1) 위에 떠 있다. 산업 목록 헤더
(`IndustryListSection.tsx` actions slot)에는 같은 폼을 토글하는
"＋ 신규 산업 분석" 버튼이 이미 있어, 같은 동작에 대한 CTA가 한 화면에
둘 이상 존재한다.

## Root cause

- `app/web-next/components/stages/market/MarketAnalysisStage.tsx` ~L122:
  `<MarketPrimaryAction ctx={ctx} />`이 `DealBreadcrumb`(L121)와
  `StageFrame`(L123, 제목 h1 포함) 사이에 렌더링된다.
- `MarketPrimaryAction`(동일 파일 ~L172-190)은 `canCurate`/`showNewForm`/
  `newName` 상태에 따라 신규 폼 열기·분석 실행을 대행하는 filled
  `PrimaryAction`이다. 신규 폼 열기는 목록 헤더 버튼
  (`IndustryListSection.tsx` ~L56-58, 같은 `setShowNewForm` 토글)과 중복이다.
- S2/S3/S4는 확인 결과 헤더 배치가 올바르다 — 결함은 S1에 한정된다.

## Doctrine reference

- Wave U UX overhaul (`docs/designs/2026-10-08-wave-u-ux-overhaul-design.md`
  section 5 rule): "one filled primary button per screen; everything else is
  secondary or tertiary. The primary action is verb plus object, placed in
  the page header (top right)" — 섹션 5 "Primary action" 행
  ("Exactly one `.btn-primary` per screen (script count)")도 같은 규칙이다.

## Decision

- D1: `MarketAnalysisStage.tsx` 목록 분기(~L122)에서 독립
  `<MarketPrimaryAction>` 렌더링을 제거한다. 신규 산업 분석의 단일 진입점은
  기존 목록 헤더의 "＋ 신규 산업 분석" 버튼이다(이미 같은 `showNewForm`을
  토글한다; 폼의 제출 버튼이 "분석 실행" 상태를 담당한다).
- D2: viewer(읽기 전용) 역할에는 버튼이 없어야 한다 — 목록 헤더 버튼은 이미
  `canCurate`로 숨긴다. 제거 후에도 화면에 filled primary 버튼이 새로
  생기지 않는다.
- D3: 제거 후 남는 사용처가 없어지면 `MarketPrimaryAction` 컴포넌트와 그
  주석(design §5 참조)을 정리한다 — 컴포넌트 주석에 단일 진입점이 목록
  헤더임을 남긴다. `PrimaryAction` 헤더 슬롯 인프라 자체는 S2-S4가 쓰므로
  건드리지 않는다.

## Affected files

- `app/web-next/components/stages/market/MarketAnalysisStage.tsx` — 목록
  분기에서 `<MarketPrimaryAction>` 제거 및 컴포넌트/주석 정리.

## Verification plan

- `/market`과 `/deals/[id]/s1` 양쪽에서 제목("S1 시장분석" h1)이 화면에서
  primary 버튼보다 먼저(above-the-fold 순서상 선행) 렌더링된다.
- 큐레이터(편집 가능) 화면에 filled primary CTA가 하나뿐이다 — 목록 헤더의
  "＋ 신규 산업 분석"뿐이며, 클릭 시 동일 폼이 열린다.
- viewer 역할에서 신규 분석 진입 버튼이 렌더링되지 않는다(기존과 동일).
- `bun run lint` (design-lint 포함)와 해당 화면 수동 확인으로 마무리한다.
