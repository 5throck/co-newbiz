// @version 1.0.0
/**
 * Bootstrap plaintext-banner tripwire — E3 (design
 * 2026-11-11-owner-decisions-intake-batch §5.3 test 2; DEC-20261111-02 D2
 * tripwire pattern). The regression this batch exists to kill — the
 * first-boot admin password printed to the container log — must not be able
 * to return silently: instrumentation.ts must never interpolate the
 * generated password into any console output, must route the credential
 * through writeBootstrapPasswordFile, and must keep the fail-closed order
 * (file write BEFORE createUser).
 */
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const instrumentation = readFileSync(join(import.meta.dirname, "../../app/web-next/instrumentation.ts"), "utf8");

describe("bootstrap password never reaches the container log (E3 tripwire)", () => {
  test("no console output interpolates the generated password", () => {
    // The plaintext banner was `password: ${password}` — the interpolation
    // itself is banned anywhere in the file, not just in that exact shape.
    // (The needle is assembled so noTemplateCurlyInString stays silent.)
    const needle = "$" + "{password}";
    expect(instrumentation).not.toContain(needle);
    expect(instrumentation).not.toMatch(/password:\s*\$\{/);
    // Belt-and-braces: the historical banner text is gone, not commented out.
    expect(instrumentation).not.toContain("FIRST-BOOT BOOTSTRAP");
    expect(instrumentation).not.toContain("printed once; change it at first login");
  });

  test("the credential is written once to the 0600 file helper", () => {
    expect(instrumentation).toContain("writeBootstrapPasswordFile");
    expect(instrumentation).toContain("bootstrapPasswordFilePath");
    // The path policy (env override name, default file name) lives in the lib —
    // instrumentation resolves via the helper, not its own constants.
    expect(instrumentation).toContain("bootstrap-password-file");
    expect(instrumentation).not.toContain("bootstrap-admin-password.txt");
  });

  test("fail-closed order: the file write precedes createUser (write failure aborts bootstrap)", () => {
    const writeAt = instrumentation.indexOf("writeBootstrapPasswordFile(");
    const createAt = instrumentation.indexOf("createUser(db,");
    expect(writeAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(-1);
    expect(writeAt).toBeLessThan(createAt);
  });

  test("the success log names only the path, never the value", () => {
    // The pointer line survives (the operator still learns WHERE), but it
    // interpolates the path only — the value ban is global (test above).
    expect(instrumentation).toMatch(/password written once to \$\{passwordFilePath\} \(0600\)/);
    expect(instrumentation).toMatch(/\[bootstrap\] could not write the initial-admin password file/);
  });
});
