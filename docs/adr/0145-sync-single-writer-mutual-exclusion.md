---
lang: ko
lang_reason: source-material
---

# ADR-0145 — 작업 트리 단일 작성자 원칙: dev-sync와 템플릿 업그레이드 엔진의 상호 배제

- Status: Accepted
- Date: 2026-09-23
- Deciders: New Business Review Lead (PM), 사용자 지시에 따름
- Design of record: `docs/designs/2026-09-12-dev-sync-scoped-staging-design.md` (scoped staging), PR #411/#413 기록 (2026-09-23 사건과 복구)
- Related: ADR-0074 (Universal Design Gate — 면제 경로와 무관하게 적용), `scripts/dev-sync.ts` step 6 (scoped staging), `skills/sync/SKILL.md`

## Context

2026-09-23 한 세션 안에서 템플릿 업그레이드 엔진(리싱크/upgrade-project 배달
소비 흐름)이 공유 작업 트리를 세 차례 리셋했다(stash
`pre-upgrade-snapshot` → pull → reset). 그 결과:

1. 진행 중이던 수정분이 두 번 사라졌고(stash 복원으로 구제),
2. dev-sync 커밋 12초 전 엔진이 스트라이크해 **커밋 5949fa54에 태스크 파일
   대신 엔진 아티팩트만 실려 PR #411로 머지됐다** — 실제 수정분은 stash에
   남아 별도 PR(#413)로 재상륙해야 했다,
3. 태스크와 무관한 작업 트리 잔재(graft 헬퍼 경로 수정 등)가 기본
   (non-scoped) 스윕 정책에 따라 커밋에 동봉됐다.

원인은 둘이다: (a) dev-sync와 업그레이드 엔진 사이에 작업 트리 상호 배제가
없고, (b) dev-sync step 6의 기본 스테이징은 태스크로 스테이지되지 않은
모든 작업 트리 변경을 커밋에 스윕한다(WARN만 출력).

## Decision

1. **단일 작성자 원칙(one writer per working tree).** dev-sync(`/sync`) 실행
   중 또는 직전에 템플릿 업그레이드 엔진(리싱크 배달 소비)을 돌리지 않는다,
   그 역도 마찬가지다. sync 전에 `ps aux | grep -iE "upgrade|dev-sync"`로
   엔진 동작 여부를 확인하고, `git status` 변화가 잡히면 중단한다.
2. **더러운 트리에서의 sync는 scoped staging을 쓴다.** 작업 트리에 태스크
   외 변경이 남아 있으면 `SYNC_SCOPED_STAGING=1`(또는 `--scoped-staging`)
   로 sync한다 — 태스크로 스테이지된 파일 + 파이프라인 생성 파일만 커밋된다.
   기본 스윕은 깨끗한 트리에서만 허용한다.
3. **복구 채널을 표준화한다.** 엔진의 `pre-upgrade-snapshot` stash는 tracked
   변경과 untracked 파일(stash의 제3 부모, `stash@{N}^3`)을 모두 보존한다.
   복구는 `git stash apply 'stash@{N}'` + untracked는
   `git show 'stash@{N}^3':<file>`로 한다. 엔진 스트라이크 흔적(reset
   reflog, 갑작스런 파일 소실)이 보이면 **푸시·머지된 커밋의 실제 내용을
   `git show <sha> --stat`으로 대조**하기 전까지 착수 결과를 신뢰하지
   않는다.
4. **PR 병합은 내용 검증을 포함한다.** 병합은 사람 게이트이며, 리뷰어는
   PR의 Files 탭이 주장한 변경과 일치하는지 확인한다 — 커밋 메시지만으로
   내용을 단정하지 않는다(사건 #411의 교훈).

## Consequences

- sync마다 사전 확인 한 단계가 늘지만, 커밋 내용 치환·무관 파일 동봉이라는
  침묵 사고를 차단한다.
- 엔진 스냅샷 stash가 일회용 잔재가 아니라 1급 복구 아티팩트로 다뤄진다 —
  함부로 drop하지 않는다.
- 본 ADR의 절차는 dev-sync/skill 파일에 코드로 강제되지 않는다(운영 규율).
  기계 강제가 필요해지면 scoped staging 기본화 또는 엔진 락 파일 도입을
  후속 ADR로 검토한다.
