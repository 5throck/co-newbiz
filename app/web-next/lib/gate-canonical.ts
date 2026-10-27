// Canonical JSON and snapshot hash - ADR-0186 design 3.15 ("hash canonicalization").
//
// The server and the recorder must derive the SAME hash from the same state, so
// the serialization is fixed:
//   * object keys sorted (UTF-16 code-unit order), arrays kept in the order the
//     builder produced (the builder sorts every set-like array by key/id),
//   * numbers in the shortest round-trip decimal with no exponent, -0 as 0,
//   * undefined properties dropped, null kept,
//   * volatile ids and timestamps removed before hashing (VOLATILE_KEYS).
// Pure and dependency-free (node:crypto only) so it is unit-testable in isolation.
import { createHash } from "node:crypto";

/** Property names that never enter the hash: they change without the decision-relevant state changing. */
export const VOLATILE_KEYS: ReadonlySet<string> = new Set(["computed_at", "eval_run_id", "assessment_id", "brief_id", "generated_at"]);

/** Expand a JS exponent string ("1e-7", "1.5e+21") to plain decimal digits. */
function expandExponent(text: string): string {
  const m = text.match(/^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/);
  if (!m) return text;
  const [, sign, intPart, fracPart = "", expRaw] = m;
  const exp = Number(expRaw);
  const digits = intPart + fracPart;
  const pointAt = intPart.length + exp;
  let out: string;
  if (pointAt <= 0) out = `0.${"0".repeat(-pointAt)}${digits}`;
  else if (pointAt >= digits.length) out = digits + "0".repeat(pointAt - digits.length);
  else out = `${digits.slice(0, pointAt)}.${digits.slice(pointAt)}`;
  if (out.includes(".")) out = out.replace(/0+$/, "").replace(/\.$/, "");
  return sign + out;
}

export function canonicalNumber(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`canonical_json: non-finite number ${String(n)} cannot be hashed`);
  if (Object.is(n, -0)) return "0";
  return expandExponent(String(n));
}

export function canonicalJson(value: unknown, omit: ReadonlySet<string> = new Set()): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean": return value ? "true" : "false";
    case "number": return canonicalNumber(value);
    case "string": return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v, omit))).join(",")}]`;
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([k, v]) => v !== undefined && !omit.has(k))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v, omit)}`).join(",")}}`;
    }
    default:
      throw new Error(`canonical_json: unsupported value of type ${typeof value}`);
  }
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The snapshot hash: SHA-256 of the canonical JSON with the volatile keys removed at every depth. */
export function snapshotHash(snapshot: unknown): string {
  return sha256Hex(canonicalJson(snapshot, VOLATILE_KEYS));
}
