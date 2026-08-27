// Admin — ADR index. Scans docs/adr/*.md (excluding README) and returns the
// ADR id, title, and status parsed from each file's markdown header. Read-only.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;

  const adrDir = path.resolve(import.meta.dirname, "../../../../../../docs/adr");
  let files: string[] = [];
  try {
    files = readdirSync(adrDir).filter((f) => f.endsWith(".md") && !f.toUpperCase().startsWith("README"));
  } catch {
    return ok({ adrs: [] }, 200, { scanned_dir: adrDir });
  }

  const adrs = files
    .map((f) => {
      const raw = readFileSync(path.join(adrDir, f), "utf-8");
      const idMatch = f.match(/^(\d{4})-/);
      const id = idMatch ? `ADR-${idMatch[1]}` : f;
      const titleMatch = raw.match(/^#\s+ADR-\d+:\s*(.+)$/m);
      const statusMatch = raw.match(/^\*\*Status\*\*:\s*(.+)$/m);
      return {
        id,
        title: titleMatch ? titleMatch[1].trim() : f,
        status: statusMatch ? statusMatch[1].trim() : "Unknown",
        file: f,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  return ok({ adrs }, 200, { count: adrs.length, scanned_dir: adrDir });
}
