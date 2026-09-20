# Dev Default Port 8787 → 7749

- Spec ID: `2026-09-20-dev-port-7749`
- Date: 2026-09-20
- Status: **Implemented**
- Related: ADR-0069/0070 (Phase 5 cutover set 8787; historical context in `docs/runbooks/deployment.md`)

## Requirements

- REQ-P1: `app/web-next` dev and start scripts default to port 7749.
- REQ-P2: Every operator-facing default that assumes the old port follows: `.claude/launch.json`, `README.md`, deployment runbooks (en/ko), `.env.sample`, the MCP REST-client fallback, and the deal-pipeline-orchestration skill note.
- REQ-P3: Operator-local `.env` (`CO_NEWBIZ_API_BASE_URL`) is updated out-of-band (untracked file), not in this change.
- REQ-P4: No runtime behavior depends on the old port number; `tests/unit/api.test.ts`'s `host: localhost:8787` header fixture is port-agnostic and stays.

## Design

Config-only change. Port 8787 collided with an unrelated local Docker service on the operator's machine; 7749 is the user-designated default going forward. All references are updated together so a fresh clone serves on 7749 with no env overrides.

## Verification

- [x] `bunx tsc --noEmit` clean
- [x] `bun run test:unit` green
- [x] Dev server starts and answers on 7749 (`curl /login` → 200)
