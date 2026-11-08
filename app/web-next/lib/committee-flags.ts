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
