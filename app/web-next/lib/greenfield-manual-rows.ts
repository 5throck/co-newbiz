// S5 투자비 manual rows: stable per-row identity + the "incomplete row" guard (review finding
// 2026-11-17 #2/#3). Pure and client-safe.
import type { ManualCostLine } from "./capability-cost-lines.ts";

let seq = 0;
/** UI-only stable id for a manual row (kept on both the live row and the last-saved snapshot so the
 *  saved/unsaved chips track rows across deletions). Stripped from every POST payload. */
export function nextManualRowId(): string {
  seq += 1;
  return `m${seq}`;
}

/** True when a row carries any content besides the item name (amount, note, category, period or
 *  세부 과목). A row with content but NO name is incomplete and must never be dropped silently. */
export function manualRowHasContent(l: ManualCostLine): boolean {
  return (
    (typeof l.amount === "number" && l.amount !== 0) ||
    (typeof l.note === "string" && l.note.trim() !== "") ||
    l.category !== undefined ||
    l.period !== undefined ||
    l.subCategory !== undefined
  );
}

/** Rows with content but no item name — the incomplete rows finding #2 blocks saving on. */
export function manualRowsWithoutName(lines: readonly ManualCostLine[]): ManualCostLine[] {
  return lines.filter((l) => !l.line.trim() && manualRowHasContent(l));
}

/** True when the live row differs from its same-id saved snapshot (a row with no snapshot yet is dirty). */
export function manualRowDirtyByRow(line: ManualCostLine, snapshot: readonly ManualCostLine[]): boolean {
  const s = line.rowId ? snapshot.find((x) => x.rowId === line.rowId) : undefined;
  return !s || JSON.stringify(s) !== JSON.stringify(line);
}

/** Strips the UI-only row ids before a POST payload is built (the stored line shape stays unchanged). */
export function stripManualRowIds(lines: readonly ManualCostLine[]): Array<Omit<ManualCostLine, "rowId">> {
  return lines.map((l) => {
    const { rowId: _rowId, ...rest } = l;
    return rest;
  });
}
