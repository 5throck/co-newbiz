// @version 1.1.0
/**
 * report.ts — builds report.json and the report.md rewrite note.
 *
 * Design: docs/designs/2026-11-18-humanize-polish-integration-design.md
 * (spec humanize-polish), "Review surface". The note follows the project's
 * review split (verified / could not verify / needs judgement) and never
 * carries bare "polished", "pass" or approval wording: the rewrite is a
 * proposal and only a person adopts it.
 */

import type { AnchorDiff } from "./anchors";

export type UnitStatus = "adopted" | "adopted_with_warning" | "unchanged" | "rolled_back" | "kept_original";

export interface UnitReport {
  id: string;
  status: UnitStatus;
  /** Why a unit was rolled back or warned (machine reasons). */
  reasons: string[];
  /** Character change rate from the deterministic gate (0..1), when judged. */
  changeRate?: number;
  /** Raw exit code of the upstream gate script, when run. */
  gateExit?: number;
  anchorDiffs: AnchorDiff[];
  /** The LLM's own summary block (self-reported, never relied on). */
  selfReport?: string;
  /** Upstream route recommendation recorded by the input shim. */
  routeHint?: string;
  /** True when the input shim could not score the unit. */
  metricsDegraded?: boolean;
  /** True when the input shim removed invisible characters from the unit. */
  sanitized?: boolean;
}

export type OverallStatus = "proposed" | "unchanged" | "partial" | "nothing_adopted" | "cannot_judge" | "not_polished";

export interface ReportInput {
  runId: string;
  genre: string;
  kind: string;
  pin: string;
  commit: string;
  units: UnitReport[];
  /** Whole-document change rate from the deterministic gate, when it ran. */
  documentChangeRate?: number;
  protectedBlocks: number;
  protectedIdentical: boolean;
  /** Extra could-not-verify items (e.g. helper failures). */
  extraUnverified?: string[];
  /** Set when nothing was attempted (excluded or tooling unusable). */
  notPolishedReason?: string;
}

export interface Report {
  status: OverallStatus;
  exitCode: 0 | 1 | 2 | 3;
  runId: string;
  genre: string;
  kind: string;
  upstream: { pin: string; commit: string };
  documentChangeRate?: number;
  protectedBlocks: number;
  protectedIdentical: boolean;
  units: UnitReport[];
  notPolishedReason?: string;
}

const pct = (r: number | undefined): string => (r === undefined ? "n/a" : `${(r * 100).toFixed(1)}%`);

/** Derive overall status and exit code from the per-unit results. */
export function overall(input: ReportInput): { status: OverallStatus; exitCode: 0 | 1 | 2 | 3 } {
  if (input.notPolishedReason) return { status: "not_polished", exitCode: 3 };
  const u = input.units;
  if (u.length === 0) return { status: "unchanged", exitCode: 0 };
  const cannotJudge = u.filter((x) => x.reasons.includes("gate-cannot-judge")).length;
  if (cannotJudge === u.length) return { status: "cannot_judge", exitCode: 3 };
  const adopted = u.filter((x) => x.status === "adopted" || x.status === "unchanged").length;
  const warned = u.filter((x) => x.status === "adopted_with_warning").length;
  if (adopted + warned === 0) return { status: "nothing_adopted", exitCode: 2 };
  if (adopted === u.length) {
    return { status: u.every((x) => x.status === "unchanged") ? "unchanged" : "proposed", exitCode: 0 };
  }
  return { status: "partial", exitCode: 1 };
}

export function buildReport(input: ReportInput): Report {
  const { status, exitCode } = overall(input);
  return {
    status,
    exitCode,
    runId: input.runId,
    genre: input.genre,
    kind: input.kind,
    upstream: { pin: input.pin, commit: input.commit },
    documentChangeRate: input.documentChangeRate,
    protectedBlocks: input.protectedBlocks,
    protectedIdentical: input.protectedIdentical,
    units: input.units,
    notPolishedReason: input.notPolishedReason,
  };
}

/** Render the reviewer-facing note. Always lists a non-empty "Could not verify" section. */
export function renderReportMd(input: ReportInput): string {
  const r = buildReport(input);
  const L: string[] = [];
  L.push("# Rewrite note (proposal)");
  L.push("");
  if (input.notPolishedReason) {
    L.push(`Status: not rewritten. ${input.notPolishedReason}`);
    L.push("The deliverable continues in its original wording.");
  } else {
    L.push(
      `Status: ${r.status.replace(/_/g, " ")}. This is a machine-made rewrite proposal of Korean prose. It is input to review, not a substitute for it, and a person still decides.`,
    );
  }
  L.push(
    `Upstream: Humanize KR ${input.pin} (commit ${input.commit.slice(0, 12)}); genre ${input.genre}; kind ${input.kind}; run ${input.runId}.`,
  );
  L.push("");

  L.push("## Verified (deterministic)");
  L.push("");
  L.push(
    "- Deterministic gates for this run: the anchor multiset (numbers with units, dates, statute references, Latin-script tokens, glossary terms, inline code, links, headings) and the change rate. The upstream five-axis gate is not part of this integration.",
  );
  if (input.units.length === 0) {
    L.push("- No prose unit was submitted for rewriting.");
  } else {
    L.push(
      `- Whole-document character change rate (script output, not the model's self-report): ${pct(input.documentChangeRate)}.`,
    );
    for (const u of input.units) {
      L.push(
        `- Unit ${u.id}: ${u.status.replace(/_/g, " ")}; change rate ${pct(u.changeRate)}${u.reasons.length ? `; ${u.reasons.join(", ")}` : ""}.`,
      );
    }
    const kept = input.units.filter((u) => u.status !== "rolled_back" && u.status !== "kept_original");
    if (kept.length > 0) {
      L.push(
        `- Numbers, dates, statute references, Latin-script tokens, glossary terms, inline code, links and heading markers are identical before and after in ${kept.length} adopted unit(s).`,
      );
    }
  }
  L.push(
    input.protectedIdentical
      ? `- Protected blocks (${input.protectedBlocks}: frontmatter, code, tables, quotations, comments, checklists, non-Hangul text) are byte-identical to the source.`
      : `- Protected blocks (${input.protectedBlocks}) were NOT confirmed byte-identical; do not use this output.`,
  );
  L.push("");

  L.push("## Could not verify");
  L.push("");
  L.push("- Whether the meaning is unchanged: no tool checks it.");
  L.push("- The model's own self-check and grade are self-reported and are not relied on.");
  L.push("- Register and nuance of hedged or conditional statements.");
  const degraded = input.units.filter((u) => u.metricsDegraded).map((u) => u.id);
  if (degraded.length) L.push(`- Units the input shim could not score: ${degraded.join(", ")}.`);
  const deeper = input.units
    .filter((u) => u.routeHint && u.routeHint !== "light" && u.routeHint !== "absent")
    .map((u) => `${u.id} (${u.routeHint})`);
  if (deeper.length) L.push(`- Upstream recommended a deeper route; not run: ${deeper.join(", ")}.`);
  const sanitized = input.units.filter((u) => u.sanitized).map((u) => u.id);
  if (sanitized.length)
    L.push(
      `- Invisible characters were removed from the input of unit(s) ${sanitized.join(", ")} by upstream text hygiene before the rewrite (not a provenance feature).`,
    );
  for (const x of input.extraUnverified ?? []) L.push(`- ${x}`);
  L.push("");

  L.push("## Needs judgement");
  L.push("");
  const warned = input.units.filter((u) => u.status === "adopted_with_warning");
  const rolled = input.units.filter((u) => u.status === "rolled_back" || u.status === "kept_original");
  if (warned.length === 0 && rolled.length === 0) {
    L.push(
      "- Read the changed phrasing of each unit against the original; the proposal is not adopted until a person decides.",
    );
  }
  for (const u of warned)
    L.push(`- Unit ${u.id} carries a warning (${u.reasons.join(", ") || "see gate"}); read it against the original.`);
  for (const u of rolled) {
    L.push(`- Unit ${u.id} was left in the original wording (${u.reasons.join(", ") || "no model output"}).`);
    for (const d of u.anchorDiffs.slice(0, 5))
      L.push(`  - anchor ${d.category}: "${d.token}" ${d.before} -> ${d.after}`);
  }
  for (const u of input.units) {
    if (u.selfReport)
      L.push(
        `- Unit ${u.id}: the model listed its own highlights (self-reported); review the changed phrasing directly.`,
      );
  }
  L.push("");
  L.push(
    "The original text stays retrievable from the run output until it is cleaned. Decision-support material only; the human reviewer remains accountable for the final text.",
  );
  L.push("");
  return L.join("\n");
}
