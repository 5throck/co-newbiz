// Admin — ADR index. Scans docs/adr/*.md (excluding README) and returns the
// ADR id, title, and status parsed from each file's markdown header. Read-only.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";

// import.meta.dirname does not survive Turbopack bundling (undefined in the
// production container — "paths[0] must be of type string", found
// empirically), so locate the repo root by walking up from cwd for the
// docs/adr marker — same discipline as scripts/co-newbiz/proc-resolve.ts.
function resolveDocsAdrDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "docs", "adr");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(process.cwd(), "docs", "adr");
}

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;

  const adrDir = resolveDocsAdrDir();
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
