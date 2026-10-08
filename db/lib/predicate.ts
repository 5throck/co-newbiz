// @version 1.1.0
/**
 * Predicate AST (ADR-0046) — moved to packages/core-scoring/src/predicate.ts
 * in Wave D (pure: parse + tri-state evaluation, no DB/fs/env). Re-exported
 * here so existing db/lib importers keep their import path.
 */
export * from "../../packages/core-scoring/src/predicate.ts";
