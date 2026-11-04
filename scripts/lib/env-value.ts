// @version 1.0.0
/**
 * env-value.ts — one `.env` value parser for every reader in this repo.
 *
 * The four `.env` readers used to disagree: Next.js (the surface operators
 * actually use) runs dotenv 16.3.1 and strips an inline `# comment` after a
 * value; env-keys.ts, root-env.ts and prisma.config.ts did not. Measured
 * 2026-11-04, `CO_NEWBIZ_LLM_PROVIDER=custom  # openai-compatible | ...`
 * loaded as a 64-character value on the non-dotenv path and as `custom` on
 * the dotenv path. Design: docs/designs/2026-08-31-pipeline-execution-environment.md
 * §2.5 (shared parser) and §4 (verification cases).
 *
 * Semantics mirror dotenv's `#` rule, deliberately — the divergence being
 * closed is a third rule on top of it, not a missing one:
 *   - trim, then a leading `"`, `'` or backtick starts a quoted value; a `#`
 *     inside the quotes is literal, and an unterminated quote returns the
 *     remainder verbatim;
 *   - an unquoted value stops at the FIRST `#` (whitespace-preceded or not,
 *     as dotenv's `[^#\r\n]+` does), and the result is trimmed.
 *
 * Escape sequences are NOT implemented. Two known divergences from dotenv,
 * measured against the `@next/env` build in app/web-next/node_modules (both
 * pinned by tests so a future change is deliberate, not incidental):
 *   - `K="a\"b"`: dotenv keeps the quoted text raw (`a\"b`); this parser ends
 *     the quoted value at the first `"` and returns `a\`. So a backslash does
 *     not escape a quote here.
 *   - `K="a"b"`: dotenv reads the whole rest of the line and returns `a"b`
 *     (its quoted alternative is greedy, then falls back to the bare value
 *     rule); this parser returns `a`. A trailing fragment after the closing
 *     quote is ignored, not rejected.
 *
 * Corollary: a value needing a literal `#` must be quoted. Not supported, by
 * decision (§2.5 out-of-scope): escape expansion, `export ` prefixes,
 * `key: value` colon form, multiline values.
 */

/**
 * Parse the raw right-hand side of a `KEY=value` line into its value.
 *
 * @param raw Everything after the first `=` on the line, untrimmed.
 * @param keyName When given, an unquoted value truncated at a `#` emits one
 *   `console.warn` naming the key. The value itself is never logged — not even
 *   a fragment of it. Callers pass the key they read off the line.
 */
export function parseEnvValue(raw: string, keyName?: string): string {
  const value = raw.trim();
  if (value === "") return "";
  const quote = value[0];
  if (quote === '"' || quote === "'" || quote === "`") {
    const close = value.indexOf(quote, 1);
    // Unterminated quote: echo the remainder rather than throw (best effort).
    if (close === -1) return value.slice(1);
    return value.slice(1, close);
  }
  const hash = value.indexOf("#");
  if (hash === -1) return value.trim();
  // Truncation is the exact failure class this parser closes, so it is never
  // silent: an operator who meant the `#` must quote the value. Name the key
  // only — the value may be a secret.
  if (keyName) {
    console.warn(
      `[env-value] ${keyName}: value truncated at "#" — quote the value to keep it verbatim`,
    );
  }
  return value.slice(0, hash).trim();
}
