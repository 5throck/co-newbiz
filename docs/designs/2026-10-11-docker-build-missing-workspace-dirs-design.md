# Docker Build Missing Workspace Directories — Design

- **Date**: 2026-10-11
- **Status**: draft (Design Gate Row 0)
- **Owner**: release-engineer
- **ADR**: none required (build/config only; no DB schema, auth model or MCP scope change)

## 1. Root cause

`docker compose build web` fails in the build stage (`bun run build`) with Turbopack "Module not found" for `../../../../mcp/co-newbiz/registry.ts` (the `/api/mcp` route) and `../../packages/core-scoring/src/data-confidence.ts` / `rag-engine.ts` (re-exported by `db/lib`). The Dockerfile copies only `db`, `scripts`, `procedures`, `process`, `docs` and `app/web-next`, and the whitelist `.dockerignore` excludes everything else, so top-level `mcp/` and `packages/` are absent from the image build context. The follow-on "export not found" errors come from the same missing re-export targets. CI was blocked by billing, so the break was never caught.

## 2. Fix (config only)

- Dockerfile build stage: `COPY mcp`, `COPY packages`, `COPY glossary`, `COPY config`.
- Dockerfile runtime stage: the same four trees are copied from the build stage (the app imports `mcp/` and `packages/` at runtime; `findGlossaryDir()` throws without `glossary/`; `llm-usage.ts` reads `config/llm-pricing.yaml`).
- `.dockerignore`: re-include `mcp/**`, `packages/**`, `glossary/**`, `config/**`; keep tests and nested node_modules out.
- Verified: root `bun.lock` has a single workspace (root), so the deps stage already resolves the frozen lockfile; `python/` is optional (sim engine probe) and stays excluded.

## 3. Verification

`docker compose build web` succeeds; an ephemeral container (no volume, host port 7790) answers `/api/health` and `/login`; unit tests for docker/runbook/library pass.

## 4. Rollback

Revert the Dockerfile and `.dockerignore` edits; no data or schema is affected.
