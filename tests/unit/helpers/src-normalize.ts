// Layout-agnostic source normalizer for static-source tests.
// Static-source tests assert that component sources contain literal snippets. Without
// this, a Biome reformat (line wrapping, trailing commas) breaks them with no behavior change.
// Apply it to BOTH the source and the expected snippet.
export function normSrc(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/\s*([(){}[\]<>,;])\s*/g, "$1")
    .replace(/,([)\]}>])/g, "$1")
    .replace(/&&\(/g, "&&")
    .replace(/\?\(/g, "?")
    .replace(/:\(/g, ":");
}
