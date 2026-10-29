// Parses the status line of an ADR markdown header. Accepts both header
// formats in docs/adr: `**Status**: X` and `- Status: X`.
export function parseAdrStatus(raw: string): string | null {
  const m = raw.match(/^(?:\*\*Status\*\*|-\s*Status|-\s*\*\*Status\*\*):\s*(.+)$/m);
  return m ? m[1].trim() : null;
}
