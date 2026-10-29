// @version 1.1.0
// glossary/*.yaml -> app/web-next/lib/glossary-data.generated.ts (ADR-0022, FR-SYS-04).
// The YAML registry is the SSOT; the Next/Turbopack server bundle cannot read it at
// runtime, so the UI tooltip, /api/glossary, MCP lookup_term and the admin glossary
// page read this static projection. Validates via glossary/_validate.ts first.
// --check exits 1 on drift or on a validation failure; output is deterministic
// (files sorted by name, terms in YAML order).
//
// Usage: bun scripts/co-newbiz/generate-glossary-data.ts [--check]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as yaml from "js-yaml";
import { renderGlossaryDataModule } from "../../app/web-next/lib/glossary-generate.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const GLOSSARY_DIR = join(ROOT, "glossary");
const OUT = join(ROOT, "app/web-next/lib/glossary-data.generated.ts");
const OUT_REL = "app/web-next/lib/glossary-data.generated.ts";

const validation = Bun.spawnSync(["bun", join(GLOSSARY_DIR, "_validate.ts")], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
if (validation.exitCode !== 0) {
  console.error(new TextDecoder().decode(validation.stdout));
  console.error(new TextDecoder().decode(validation.stderr));
  console.error("glossary/_validate.ts failed; fix the registry before regenerating.");
  process.exit(1);
}

const files = readdirSync(GLOSSARY_DIR)
  .filter((f) => f.endsWith(".yaml") && !f.startsWith("_"))
  .sort();

const terms: Array<Record<string, unknown>> = [];
for (const file of files) {
  const doc = yaml.load(readFileSync(join(GLOSSARY_DIR, file), "utf8"), { schema: yaml.JSON_SCHEMA }) as {
    terms: Record<string, Record<string, unknown>>;
  };
  for (const [key, entry] of Object.entries(doc.terms)) terms.push({ key, ...entry });
}

const generated = renderGlossaryDataModule(terms);

const norm = (t: string) => t.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {
    /* missing = stale */
  }
  if (norm(current) !== norm(generated)) {
    console.error(`${OUT_REL} stale - regenerate with: bun scripts/co-newbiz/generate-glossary-data.ts (or: bun run glossary:generate)`);
    process.exit(1);
  }
  console.log("glossary-data.generated.ts is up to date.");
} else {
  writeFileSync(OUT, generated, "utf8");
  console.log(`${OUT_REL} generated (${terms.length} terms from ${files.length} files).`);
}
