# auth-and-account-management

> **`SKILL.md` 프론트매터에서 생성됨 (2026-08-28 per-skill README 표준, CONSTITUTION §6.2).** 자유롭게 보강하세요 — 이 파일은 자동 재생성되지 않습니다.

## 목적

Wave 5.5/5.6A에서 구축된 계정 라이프사이클(대기 -> 활성, 잠금, 비밀번호 재설정)과 API 토큰 발급을 운영합니다 — PBKDF2-HMAC-SHA256 해싱(FR-SEC-09, `scripts/lib/auth.ts`에서 재사용, 절대 재구현하지 않음), 존재 여부가 노출되지 않는 인증 실패, 그리고 충족될 때까지 정확히 3개 경로(me/logout/password-change)만 허용하는 비밀번호 변경 필수 게이트를 다룹니다.

- **스코프(scope)**: `co-newbiz`
- **버전**: 1.0.0

## 사용 시점

- 위 목적에 해당하는 작업을 수행할 때 로드합니다 (`SKILL.md` 설명 참조).

## 사전 조건

none

## 사용 방법

```
<SKILL.md의 지시에 따라 호출 — 또는 플랫폼 스킬 레지스트리를 통해 AI 스킬로 로드>
```

권한 지침과 프론트매터는 [SKILL.md](SKILL.md)를 참조하세요.
