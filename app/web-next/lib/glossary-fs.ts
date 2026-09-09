import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

// Locate the repository glossary from whichever runtime anchor is active:
// `bun test` starts at the repo root, while `next start` commonly starts at
// app/web-next. Keep this filesystem helper out of read-only glossary routes
// so Turbopack does not NFT-trace the source YAML directory during builds.
export function findGlossaryDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "glossary");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate the glossary/ directory from cwd=${process.cwd()}.`);
}
