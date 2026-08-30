// Governance library index — surfaces the axis-A artifacts (checklists,
// operating manuals, policies/regulations) that live as files in the repo
// but were previously invisible in the UI. Read-only: the files on disk are
// the system of record (policies/*.md, docs/manuals/*.md, checklists/*.yaml);
// this module only indexes and serves them. Checklist frontmatter is parsed
// with a small line scanner instead of a YAML dependency — the fields we need
// (title, gate, enforceability, version, owner_agent, item count) are flat
// top-level keys, and the dependency budget of web-next stays untouched.
import * as fs from "node:fs";
import path from "node:path";

export type LibraryCategory = "checklist" | "manual" | "policy";

export interface LibraryDocSummary {
  id: string;
  category: LibraryCategory;
  title: string;
  file: string;
  gate?: string;
  enforceability?: string;
  version?: string;
  owner_agent?: string;
  item_count?: number;
  lang: "en" | "ko";
}

export interface LibraryDocContent extends LibraryDocSummary {
  content: string;
}

function repoRoot(): string {
  // web-next runs with cwd = app/web-next; the repo root is two levels up.
  // Walk up defensively so a different cwd (next start, tests) still resolves.
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, "checklists")) && fs.existsSync(path.join(dir, "policies"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function readText(file: string): string {
  // Normalize CRLF — repo files on Windows carry \r\n, which would break the
  // frontmatter strip and inline parsing.
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

function frontmatterField(text: string, key: string): string | undefined {
  // Flat top-level `key: value` before the first bare `items:`/blank-line body.
  // Trailing `# comment` is not part of the value.
  const match = text.match(new RegExp(`^${key}:\\s*"?([^"#\\n]*?)"?\\s*(?:#.*)?$`, "m"));
  return match ? match[1].trim() : undefined;
}

function firstHeading(text: string): string | undefined {
  const match = text.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : undefined;
}

function listYaml(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".yaml") && !f.startsWith("_"))
      .sort();
  } catch {
    return [];
  }
}

function listMd(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return [];
  }
}

function listMdRecursive(dir: string, relPrefix = ""): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(relPrefix + entry.name);
    } else if (entry.isDirectory()) {
      out.push(...listMdRecursive(path.join(dir, entry.name), `${relPrefix}${entry.name}/`));
    }
  }
  return out.sort();
}

function checklists(): LibraryDocSummary[] {
  const root = repoRoot();
  return listYaml(path.join(root, "checklists")).map((file) => {
    const text = readText(path.join(root, "checklists", file));
    return {
      id: `chk-${file.replace(/\.yaml$/, "")}`,
      category: "checklist" as const,
      title: frontmatterField(text, "title") ?? file.replace(/\.yaml$/, ""),
      file: `checklists/${file}`,
      gate: frontmatterField(text, "gate"),
      enforceability: frontmatterField(text, "enforceability"),
      version: frontmatterField(text, "version"),
      owner_agent: frontmatterField(text, "owner_agent"),
      item_count: (text.match(/^\s+- id:/gm) ?? []).length,
      lang: "en" as const,
    };
  });
}

function manuals(): LibraryDocSummary[] {
  const root = repoRoot();
  return listMd(path.join(root, "docs", "manuals")).map((file) => {
    const ko = file.endsWith("_ko.md");
    return {
      id: `man-${file.replace(/\.md$/, "")}`,
      category: "manual" as const,
      title: firstHeading(readText(path.join(root, "docs", "manuals", file))) ?? file,
      file: `docs/manuals/${file}`,
      lang: (ko ? "ko" : "en") as "ko" | "en",
    };
  });
}

function policies(): LibraryDocSummary[] {
  const root = repoRoot();
  return listMdRecursive(path.join(root, "policies")).map((rel) => {
    const text = readText(path.join(root, "policies", rel));
    const stem = rel.replace(/\.md$/, "");
    return {
      id: `pol-${stem.replace(/[/.]/g, "-")}`,
      category: "policy" as const,
      title: firstHeading(text) ?? rel,
      file: `policies/${rel}`,
      lang: (/_ko\.md$/.test(rel) ? "ko" : "en") as "ko" | "en",
    };
  });
}

const CATEGORIES: LibraryCategory[] = ["checklist", "manual", "policy"];

export function listLibrary(): LibraryDocSummary[] {
  return [...checklists(), ...manuals(), ...policies()];
}

export function getLibraryDoc(id: string): LibraryDocContent | null {
  const doc = listLibrary().find((d) => d.id === id);
  if (!doc) return null;
  const root = repoRoot();
  return { ...doc, content: readText(path.join(root, doc.file)) };
}

export function isLibraryCategory(value: string): value is LibraryCategory {
  return (CATEGORIES as string[]).includes(value);
}

// ── Checklist item extraction ────────────────────────────────────────────
// The gate checklists are flat `- id:` blocks under a top-level `items:`
// key with per-item `text` / `mandatory` / `waiver_eligible` flags. A line
// scanner covers that structure without a YAML dependency (same rationale
// as the frontmatter parser above).

export interface ChecklistItemDef {
  id: string;
  text: string;
  mandatory: boolean;
  waiver_eligible: boolean;
}

function unquote(v: string): string {
  return v.replace(/^"(.*)"$/, "$1").trim();
}

export function getChecklistItems(checklistDocId: string): ChecklistItemDef[] | null {
  const doc = listLibrary().find((d) => d.id === checklistDocId && d.category === "checklist");
  if (!doc) return null;
  const root = repoRoot();
  const text = readText(path.join(root, doc.file));
  const itemsStart = text.match(/^items:\s*$/m);
  if (!itemsStart) return [];
  const lines = text.slice((itemsStart.index ?? 0) + itemsStart[0].length).split("\n");
  const items: ChecklistItemDef[] = [];
  let current: ChecklistItemDef | null = null;
  for (const line of lines) {
    const idMatch = line.match(/^\s+- id:\s*(\S+)\s*$/);
    if (idMatch) {
      current = { id: idMatch[1], text: "", mandatory: false, waiver_eligible: false };
      items.push(current);
      continue;
    }
    // A non-indented top-level key after the items block ends it.
    if (/^\S/.test(line)) break;
    if (!current) continue;
    const field = line.match(/^\s+(text|mandatory|waiver_eligible):\s*(.*)$/);
    if (!field) continue;
    if (field[1] === "text") current.text = unquote(field[2]);
    else if (field[1] === "mandatory") current.mandatory = field[2].trim() === "true";
    else current.waiver_eligible = field[2].trim() === "true";
  }
  return items.filter((i) => i.id !== "" && i.text !== "");
}

/** DD workspace kinds → their gate-checklist doc ids. */
export const DD_WORKSPACE_CHECKLISTS: Record<string, string> = {
  commercial: "chk-commercial-dd-checklist",
  technical: "chk-technical-dd-checklist",
  legal: "chk-legal-dd-checklist",
};
