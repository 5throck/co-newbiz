// committee-flags — feature flags for the committee meeting engine
// (ADR-0196). Kept in a dependency-free module so deliberation.ts and the
// deterministic seats (committee-agents.ts) can share one switch without an
// import cycle or pulling the DB client into the seats.

/**
 * CO_NEWBIZ_COMMITTEE_RESPONSIVE — responsive rounds (ADR-0196 §2.1).
 * "1" / "true" turns on the round 2+ response contract, the member's own
 * previous position in the prompt, and the extended position-meta tail on
 * deterministic seats. Default OFF: unset or any other value keeps the
 * pre-ADR-0196 prompt byte-identical (design §5, phase A). Read at call time
 * so tests and pilots can flip it without a restart.
 */
export function isCommitteeResponsive(): boolean {
  const v = (process.env.CO_NEWBIZ_COMMITTEE_RESPONSIVE ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

/** Meeting engine of a committee session (ADR-0204). */
export type CommitteeEngine = "turns" | "rounds";

/**
 * CO_NEWBIZ_COMMITTEE_ENGINE — the default meeting engine for NEW sessions
 * (design 2026-11-20 §14.2 / §15.3, ADR-0204). "turns" = turn-based dialogue
 * meeting, "rounds" = the ADR-0096 round engine. Unset or empty → "rounds"
 * until the S6/S4 live check flips the default. Any other value THROWS: a
 * mistyped flag is never coerced into either engine. Read at call time so
 * tests and pilots can flip it without a restart. The resolved value is
 * stored once in session meta.engine and never changes afterwards.
 */
export function committeeEngineDefault(): CommitteeEngine {
  const raw = (process.env.CO_NEWBIZ_COMMITTEE_ENGINE ?? "").trim().toLowerCase();
  if (raw === "") return "rounds";
  if (raw === "turns" || raw === "rounds") return raw;
  throw new Error(
    `CO_NEWBIZ_COMMITTEE_ENGINE must be 'turns' or 'rounds' (got '${process.env.CO_NEWBIZ_COMMITTEE_ENGINE}')`,
  );
}

/** Validate an explicit engine request (CLI flag / API option); throws on anything else. */
export function parseCommitteeEngine(value: unknown): CommitteeEngine {
  if (value === "turns" || value === "rounds") return value;
  throw new Error(`engine must be 'turns' or 'rounds' (got '${String(value)}')`);
}
