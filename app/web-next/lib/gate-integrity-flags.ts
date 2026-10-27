// Gate-integrity per-family flags - ADR-0186 design 3.15 / section 7.
// The implementation lives in db/lib/gate-integrity-flags.ts (ADR-0186 P3) so the db layer (stage-gate
// derivation) and the app share one definition; this module keeps the original import path stable.
export * from "../../../db/lib/gate-integrity-flags.ts";
