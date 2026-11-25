// @version 1.1.0 (2026-11-24: family `target`, default enforce - ADR-0206). 1.0.0 (moved from app/web-next/lib in ADR-0186 P3 so the db layer shares the flag SSOT; app/web-next/lib/gate-integrity-flags.ts re-exports it)
// Gate-integrity per-family flags - ADR-0186 design 3.15 / section 7.
// Kept dependency-free so low-level libs (dd-checklist-tailor) can read a mode
// without pulling the HTTP helpers in lib/gate-integrity.ts.
//
// CO_NEWBIZ_GATE_INTEGRITY_<FAMILY> = off | shadow | enforce. Defaults:
// production -> shadow, anything else (unit, dev, scenario) -> off. A scenario
// environment opts in by setting the variable. Read on each call; the
// operational contract is "restart to change" (a deployed process environment
// is fixed).
//   off     : the rule does not run (legacy behavior, byte-identical).
//   shadow  : the rule runs and a would-block is recorded as an audit row
//             `gate_integrity.would_block:<code>`, de-duplicated per
//             (entity, gate, code, day); the request is NOT blocked.
//   enforce : the rule blocks with its error code.
// HOLD and KILL are never blocked by any family (ADR-0186 principle 5).
//
// Exception to the defaults above (ADR-0206, 2026-11-24 owner decision): family `target` (a GO while the
// selected/adopted S8 target is no longer on the Short List) defaults to `enforce` in EVERY environment, with
// no shadow release. The variable stays as the operator escape hatch (`shadow` / `off`) like every family.

export const GATE_INTEGRITY_FAMILIES = [
  "rationale",
  "snapshot_ack",
  "kill_binding",
  "validators",
  "wacc",
  "ladder",
  "maker_checker",
  "waiver",
  "divergence",
  "target",
] as const;
export type GateIntegrityFamily = (typeof GATE_INTEGRITY_FAMILIES)[number];
export type GateIntegrityMode = "off" | "shadow" | "enforce";

export function gateIntegrityEnvName(family: GateIntegrityFamily): string {
  return `CO_NEWBIZ_GATE_INTEGRITY_${family.toUpperCase()}`;
}

const warnedInvalid = new Set<string>();

/** Families whose default does not follow the production-shadow / elsewhere-off rule. */
const FAMILY_DEFAULT_MODE: Partial<Record<GateIntegrityFamily, GateIntegrityMode>> = { target: "enforce" };

export function gateIntegrityMode(
  family: GateIntegrityFamily,
  env: Record<string, string | undefined> = process.env,
): GateIntegrityMode {
  const raw = env[gateIntegrityEnvName(family)]?.trim().toLowerCase();
  if (raw === "off" || raw === "shadow" || raw === "enforce") return raw;
  if (raw && !warnedInvalid.has(`${family}=${raw}`)) {
    warnedInvalid.add(`${family}=${raw}`);
    console.warn(
      `[gate-integrity] ${gateIntegrityEnvName(family)}="${raw}" is not off|shadow|enforce; using the default.`,
    );
  }
  return FAMILY_DEFAULT_MODE[family] ?? (env.NODE_ENV === "production" ? "shadow" : "off");
}
