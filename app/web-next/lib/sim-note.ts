// Client-safe parser for the simulation `note` string written by
// business-case-generator ("key=value; key=value"). NO imports: shared by the
// server generator and client components so both read one grammar.

/** key=value map; entries are separated by ";" (optional following spaces). */
export function parseSimNote(note: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!note) return out;
  for (const part of note.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** Numeric note value; strips one trailing unit suffix "x" ("3.00x" -> 3). null if missing/empty/"null"/non-numeric. */
export function noteNumber(value: string | null | undefined): number | null {
  if (value == null) return null;
  const raw = value.trim().replace(/x$/i, "").trim();
  if (raw === "" || raw.toLowerCase() === "null" || raw.toLowerCase() === "nan") return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}
