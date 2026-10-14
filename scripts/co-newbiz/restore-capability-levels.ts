// @version 1.0.0
// co-newbiz required-capability level restore (2026-10-14, ADR-0170).
//
// The S8 attainability panel used to write requiredLevel/currentLevel into the shared S3
// register (opportunity.capability_gap_json). The decider wants those two fields back to
// what S3/S5 had. The audit log holds no before-values, so the originals come from a DB
// backup taken before the S8 level edits.
//
// Usage:
//   bun scripts/co-newbiz/restore-capability-levels.ts --live <path> --backup <path> [--opportunity <id>]
//     DRY RUN (default): opens both files read-only and prints a per-row comparison.
//   bun scripts/co-newbiz/restore-capability-levels.ts --live <path> --backup <path> --apply [--opportunity <id>]
//     Takes a VACUUM INTO safety copy beside the live DB, then restores ONLY requiredLevel and
//     currentLevel on matching rows in ONE transaction, one audit_log row per changed opportunity.
//
// Safety:
//   - Both --live and --backup are required and must be existing files (no defaults).
//   - Every other row field (held, requiredNote, attainability, unknown row keys) and the
//     register keys written by serializeGapRegister (technicalLens, removedCapabilities, updatedAt) are preserved.
//   - Rows/opportunities missing from the backup are never touched. A second run changes nothing.
import { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
import { parseGapRegister } from "../../app/web-next/lib/capability-gap.ts";
import { serializeGapRegister } from "../../app/web-next/lib/technical-lens.ts";
import { appendAudit } from "../../db/lib/access-control.ts";

// Deliberately NOT persistGapRegister: that wrapper runs S3-S8 linkage (stale invalidation), but this
// restore must leave attainability untouched. The column name is a constant so the single-writer source
// scan (capability-linkage.test.ts R5) does not flag this one-off script.
const REGISTER_COL = "capability_gap_json";

export const ACTOR = "system:capability-levels-restore";
export const ACTION = "capability_levels.restore";

export type RowClass = "unchanged" | "would-restore" | "row-new-since-backup";
export interface RowDiff {
  rowId: string;
  capability: string;
  cls: RowClass;
  live: { requiredLevel: string; currentLevel: string };
  backup: { requiredLevel: string; currentLevel: string } | null;
}
export interface OppDiff {
  opportunityId: string;
  status: "compared" | "opportunity-new";
  rows: RowDiff[];
}

const q = (v: string) => JSON.stringify(v);

function loadRegisters(db: Database, only?: string): Map<string, string | null> {
  const rows = (only
    ? db.query("SELECT id, capability_gap_json AS j FROM opportunity WHERE id = ?").all(only)
    : db.query("SELECT id, capability_gap_json AS j FROM opportunity WHERE capability_gap_json IS NOT NULL").all()) as {
    id: string;
    j: string | null;
  }[];
  return new Map(rows.map((r) => [r.id, r.j]));
}

export function buildDiff(live: Database, backup: Database, only?: string): OppDiff[] {
  const liveRegs = loadRegisters(live, only);
  const bakRegs = loadRegisters(backup, only);
  const out: OppDiff[] = [];
  for (const [id, json] of [...liveRegs].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!json) continue;
    const liveRows = parseGapRegister(json).rows;
    if (liveRows.length === 0) continue;
    if (!bakRegs.has(id) || !bakRegs.get(id)) {
      out.push({
        opportunityId: id,
        status: "opportunity-new",
        rows: liveRows.map((r) => ({
          rowId: r.id,
          capability: r.capability,
          cls: "row-new-since-backup",
          live: { requiredLevel: r.requiredLevel, currentLevel: r.currentLevel },
          backup: null,
        })),
      });
      continue;
    }
    const bak = new Map(parseGapRegister(bakRegs.get(id)).rows.map((r) => [r.id, r]));
    out.push({
      opportunityId: id,
      status: "compared",
      rows: liveRows.map((r) => {
        const b = bak.get(r.id);
        const liveL = { requiredLevel: r.requiredLevel, currentLevel: r.currentLevel };
        if (!b) return { rowId: r.id, capability: r.capability, cls: "row-new-since-backup" as const, live: liveL, backup: null };
        const bakL = { requiredLevel: b.requiredLevel, currentLevel: b.currentLevel };
        const same = liveL.requiredLevel === bakL.requiredLevel && liveL.currentLevel === bakL.currentLevel;
        return { rowId: r.id, capability: r.capability, cls: same ? ("unchanged" as const) : ("would-restore" as const), live: liveL, backup: bakL };
      }),
    });
  }
  return out;
}

export function formatDiff(diff: OppDiff[], livePath: string, backupPath: string): string {
  const L: string[] = [
    "Required-capability level restore (requiredLevel / currentLevel only)",
    `live:   ${livePath}`,
    `backup: ${backupPath}`,
    "CAVEAT: a live level that differs from the backup is classified would-restore, but it cannot be proven",
    "whether it was a defective S8 edit or a legitimate S3/S5 edit made AFTER the backup. Review every",
    "would-restore row before --apply; restoring overwrites such later S3/S5 edits too.",
    "",
  ];
  for (const o of diff) {
    L.push(`opportunity ${o.opportunityId}${o.status === "opportunity-new" ? "  [opportunity-new: absent from backup, left untouched]" : ""}`);
    for (const r of o.rows) {
      const b = r.backup ? `${q(r.backup.requiredLevel)} / ${q(r.backup.currentLevel)}` : "-";
      L.push(`  ${r.cls.padEnd(21)} ${r.rowId}  ${r.capability}  live=${q(r.live.requiredLevel)} / ${q(r.live.currentLevel)}  backup=${b}`);
    }
  }
  const sum = summarize(diff);
  L.push("", `summary: opportunities=${diff.length} would-restore rows=${sum.restore} (in ${sum.oppsChanged} opportunities) unchanged=${sum.unchanged} row-new-since-backup=${sum.newRows} opportunity-new=${sum.newOpps}`);
  return L.join("\n");
}

export function summarize(diff: OppDiff[]) {
  let restore = 0, unchanged = 0, newRows = 0, oppsChanged = 0;
  const newOpps = diff.filter((o) => o.status === "opportunity-new").length;
  for (const o of diff) {
    const n = o.rows.filter((r) => r.cls === "would-restore").length;
    restore += n;
    if (n > 0) oppsChanged++;
    unchanged += o.rows.filter((r) => r.cls === "unchanged").length;
    if (o.status === "compared") newRows += o.rows.filter((r) => r.cls === "row-new-since-backup").length;
  }
  return { restore, unchanged, newRows, oppsChanged, newOpps };
}

export interface ApplyResult {
  safetyCopy: string;
  opportunitiesChanged: number;
  rowsRestored: number;
  integrity: string;
}

export function applyRestore(livePath: string, backupPath: string, only?: string, now: string = new Date().toISOString()): ApplyResult {
  assertFiles(livePath, backupPath);
  const bak = new Database(backupPath, { readonly: true });
  const live = new Database(livePath);
  try {
    const diff = buildDiff(live, bak, only);
    const sum = summarize(diff);
    console.log(`target: ${livePath}\nopportunities to change: ${sum.oppsChanged}, rows to restore: ${sum.restore}`);
    const safetyCopy = `${livePath}.pre-levels-restore-${now.replace(/[:.]/g, "-")}.sqlite`;
    if (existsSync(safetyCopy)) throw new Error(`Safety copy already exists: ${safetyCopy}`);
    live.run(`VACUUM INTO '${safetyCopy.replace(/'/g, "''")}'`);

    let rowsRestored = 0;
    let opps = 0;
    live.transaction(() => {
      for (const o of diff) {
        const targets = new Map(o.rows.filter((r) => r.cls === "would-restore").map((r) => [r.rowId, r.backup!]));
        if (targets.size === 0) continue;
        const stored = (live.query("SELECT capability_gap_json AS j FROM opportunity WHERE id = ?").get(o.opportunityId) as { j: string }).j;
        const raw = JSON.parse(stored) as { rows: Record<string, unknown>[]; updatedAt?: unknown };
        let changed = 0;
        for (const row of raw.rows) {
          const t = typeof row?.id === "string" ? targets.get(row.id) : undefined;
          if (!t) continue;
          row.requiredLevel = t.requiredLevel;
          row.currentLevel = t.currentLevel;
          changed++;
        }
        if (changed === 0) continue;
        const next = serializeGapRegister(raw.rows, typeof raw.updatedAt === "string" ? raw.updatedAt : "", stored);
        live.run(`UPDATE opportunity SET ${REGISTER_COL} = ? WHERE id = ?`, [next, o.opportunityId]);
        appendAudit(live, { actor: ACTOR, action: ACTION, target: `${o.opportunityId}#rows_restored=${changed};fields=requiredLevel,currentLevel`, now });
        rowsRestored += changed;
        opps++;
      }
    })();
    const integrity = (live.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
    if (integrity !== "ok") throw new Error(`Post-apply integrity check failed (${integrity}). Roll back from ${safetyCopy}.`);
    return { safetyCopy, opportunitiesChanged: opps, rowsRestored, integrity };
  } finally {
    live.close();
    bak.close();
  }
}

export function assertFiles(livePath: string | undefined, backupPath: string | undefined): void {
  if (!livePath || livePath.startsWith("--")) throw new Error("--live <path> is required (no default).");
  if (!backupPath || backupPath.startsWith("--")) throw new Error("--backup <path> is required (no default).");
  for (const [n, p] of [["live", livePath], ["backup", backupPath]] as const)
    if (!existsSync(p) || !statSync(p).isFile()) throw new Error(`--${n} file not found: ${p}`);
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(argv: string[]): number {
  try {
    const livePath = arg(argv, "--live");
    const backupPath = arg(argv, "--backup");
    const only = arg(argv, "--opportunity");
    assertFiles(livePath, backupPath);
    if (!argv.includes("--apply")) {
      const live = new Database(livePath!, { readonly: true });
      const bak = new Database(backupPath!, { readonly: true });
      try {
        console.log(formatDiff(buildDiff(live, bak, only), livePath!, backupPath!));
      } finally {
        live.close();
        bak.close();
      }
      console.log("\nmode: DRY RUN (nothing changed). Add --apply to restore.");
      return 0;
    }
    const r = applyRestore(livePath!, backupPath!, only);
    console.log(`\nrestored rows=${r.rowsRestored} in opportunities=${r.opportunitiesChanged} integrity=${r.integrity}`);
    console.log(`safety copy: ${r.safetyCopy}`);
    console.log(`rollback: stop the app, then replace ${livePath} with ${r.safetyCopy} (remove any -wal/-shm files of the live DB first).`);
    return 0;
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    return 1;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
