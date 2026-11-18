---
lang: en
date: 2026-11-18
status: draft-for-approval
owner: backend-engineer (design), pm (dispatch)
related: tests/unit/, db/client.ts, scripts/co-newbiz/scheduler-install.ts, ADR-0074 (Design Gate)
spec: windows-test-suite-compatibility
---

# Design — Windows compatibility for the unit test suite

## Problem

The full unit suite (`bun run test:unit`) fails on Windows (93 failures across 41 files) while the same suite passes on macOS (operator workstation) and Linux CI. Failures vary between runs, so the pre-push changed-path gate intermittently blocks every push whose range includes main's test files (observed while merging #910/#911).

Diagnosis (bisection-verified, minimal repro in session log):

1. **bun:sqlite prepared statements hold the Windows file lock after `db.close()`** — a `db.prepare(...).all()` that is never finalized keeps the DB file locked even after the connection closes. All test cleanup that does `rmSync(tempDir)` after `resetDb()` then throws EBUSY, and bun marks the whole test failed (test bodies pass). On POSIX, unlink-on-open is allowed, so this never surfaced. Verified: `Bun.gc(true)` after close releases locks held by *unreferenced* statements; statements still referenced (module-cached) stay locked.
2. **Script CLI tools leak their own connections** — `scripts/co-newbiz/restore-capability-levels.ts` (and similar tools used by tests) opens `new Database(...)` handles it never closes.
3. **Platform-assertion tests** — POSIX chmod expectations (`bootstrap-password-file`), macOS launchd plist snapshots and PATH-split assertions (`scheduler-p1/p2`, where `hostPath` renders `dirname(bunPath)` with Windows separators and `PATH.split(":")` breaks on `C:\`), and an external-tool dependency (`zip` binary in `brownfield-business-report-extract`, already the established grace pattern for `plutil`).
4. **Stale dependency installs on this workstation** (nodemailer/next-intl unresolvable) — environment repair, not code: `bun install` at root and in `app/web-next` (done in diagnosis).

## Decision

Fix the *lock mechanism* and the *cleanup contracts* rather than rewriting hundreds of `prepare()` call sites.

1. **`db/client.ts` `resetDb()`**: after `_db.close()`, run `Bun.gc(true)` so unreferenced prepared statements are finalized before the caller deletes files. Documented as the Windows rationale; behavior on POSIX unchanged.
2. **New test preload `tests/helpers/test-env-guard.ts`** (registered via a new `bunfig.toml` → `[test] preload`): on `win32` only, wraps `bun:sqlite` `Database.prototype.close` so every close — including the many `new Database()` handles tests create outside `db/client.ts` — runs `Bun.gc(true)` immediately after closing, finalizing unreferenced statements before the test's cleanup deletes the temp dir. Verified empirically: an EBUSY-producing `prepare().all()` + close + rm becomes clean with the hook; patching `fs.rmSync` itself does **not** propagate to ESM import bindings in bun (probed), so the hook lives on the sqlite class, not on fs. POSIX platforms run unpatched (zero overhead in CI).
3. **New shared helper `tests/helpers/rm-dir-safe.ts`** — `rmDirSafe(dir: string): void`: try `rmSync`; on failure run `Bun.gc(true)` and retry (up to 3 attempts, backoff); on final failure emit one stderr warning and give up **without throwing** (a leftover temp dir must never fail a test). For cleanup sites whose DB handles cannot be closed (e.g. a never-closed inline readonly handle).
4. **Connection-leak repair where handles are never closed** (GC cannot reclaim an open bun:sqlite lock — verified): `tests/unit/restore-capability-levels.test.ts`'s inline `json()` probe closes its handle; same sweep applied to scripts the failing tests exercise (`restore-capability-levels.ts` closes all `new Database()` handles; `align-existing-projects.ts`, `gate-integrity-shadow-report.ts` where cleanup fails without it).
5. **Platform-aware tests (with comments; no behavior change on macOS/Linux)**:
   - `bootstrap-password-file`: POSIX permission-mode assertions skip on `win32` (Windows has no POSIX perms; the code under test is correct there).
   - `scheduler-p1`/`scheduler-p2-install`: the launchd-path-dependent assertions (snapshot, PATH-split, host-bin, dry-run exit code) skip on `win32` — launchd agents only ever render/run on macOS, and `hostPath` renders host-dependent paths that snapshots recorded on POSIX. Pure-logic assertions (labels) stay running on every platform where they pass today.
   - `brownfield-business-report-extract`: skip when the `zip` binary is absent (same graceful pattern as `plutil` in `scheduler-p2-install`).
6. **Re-triage after the lock fix**: the residual assertion mismatches (`table-sizing` ratchet, DOM-contract, snapshot diffs) are re-run after steps 1–5; each remaining failure is classified (path-separator, font/metrics) and fixed or platform-gated individually rather than blanket-skipped.

## Out of scope

- Refactoring all `db.prepare()` call sites to finalize (the GC-after-close approach removes the need).
- Re-baselining `KNOWN_OFFENDERS` / snapshot files recorded on macOS (platform-gating is the honest state until a cross-platform renderer exists).

## Verification

`bun run test:unit` twice consecutively on Windows with **0 failures**, plus `bun test` unchanged-green checks on the touched suites; CI (Linux) stays green — no test that passes on macOS/Linux today may be removed, only platform-gated with a recorded reason.

## Config table

| Item | Value |
|---|---|
| New helper | `tests/helpers/rm-dir-safe.ts` (`rmDirSafe`), `tests/helpers/test-env-guard.ts` (win32-only close hook) |
| New config | `bunfig.toml` → `[test] preload` pointing at the guard (repo has no bunfig today) |
| Behavior change | `db/client.ts` `resetDb()` gains a post-close `Bun.gc(true)`; `Database.prototype.close` patched under win32 test preload only (production runtime untouched) |
| Platform gates | win32 skips: chmod assertions, launchd path assertions; missing-tool skip: `zip` |
| Risk | A referenced (module-cached) statement or a never-closed handle keeps the lock → `rmDirSafe` warns and leaves the temp dir; acceptable (OS temp cleanup), never test-fatal |
